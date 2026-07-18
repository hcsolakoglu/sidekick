import { readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { getEngine } from "./engines/index.js";
import { commandOverride } from "./engines/shared.js";
import type { WorkerAction } from "./engines/types.js";
import { isProcessAlive, launchWorker, runProcess, stopProcess } from "./process.js";
import { RunStore, type RunRecord } from "./run-store.js";

export async function refresh(store: RunStore, record: RunRecord): Promise<RunRecord> {
  if (record.status === "running" && !isProcessAlive(record.pid)) {
    const turn = store.turnPath(record.meta.name, record.meta.activeRun);
    const message = `${record.output}sidekick: worker process died before recording completion\n`;
    await store.complete(record.meta.name, turn, -1, record.session, message, "died");
    return store.read(record.meta.name);
  }
  return record;
}

export async function startWorker(
  store: RunStore,
  name: string,
  turnNumber: number,
  action: WorkerAction,
): Promise<number> {
  return launchWorker(store, name, store.turnPath(name, turnNumber), action);
}

export async function forceStop(store: RunStore, record: RunRecord): Promise<void> {
  if (record.pid && isProcessAlive(record.pid)) await stopProcess(record.pid);
  const turn = store.turnPath(record.meta.name, record.meta.activeRun);
  await store.complete(
    record.meta.name,
    turn,
    -1,
    record.session,
    `${record.output}sidekick: worker stopped by --force\n`,
    "died",
  );
}

export async function executeWorker(
  store: RunStore,
  name: string,
  turnNumber: number,
  action: WorkerAction,
): Promise<number> {
  const record = await store.read(name);
  const turn = store.turnPath(name, turnNumber);
  const promptFile = join(turn, "prompt");
  const prompt = await store.readText(promptFile);
  const outputFile = join(turn, "last.txt");
  const engine = getEngine(record.meta.engine);
  const context = {
    action,
    session: record.session,
    prompt,
    promptFile,
    outputFile,
    model: record.meta.model,
    mode: record.meta.mode,
    delayMs: Number(process.env.SIDEKICK_MOCK_DELAY_MS ?? 20),
    env: process.env,
  };
  const invocation = engine.build(context);
  await store.atomicWrite(
    join(turn, "command.json"),
    `${JSON.stringify([invocation.command, ...invocation.args], null, 2)}\n`,
  );
  const execute = async () => {
    const before =
      action === "resume"
        ? new Map<string, string>()
        : await discoverSessions(record.meta.engine, record.meta.directory);
    const result = await runProcess(invocation.command, invocation.args, {
      cwd: record.meta.directory,
      ...(invocation.stdin === undefined ? {} : { stdin: invocation.stdin }),
    });
    await writeFile(join(turn, "raw.log"), result.stdout, "utf8");
    await writeFile(join(turn, "stderr.log"), result.stderr, "utf8");
    const parsed = engine.parse(result.stdout, context);
    if (!parsed.session && action !== "resume") {
      const after = await discoverSessions(record.meta.engine, record.meta.directory);
      parsed.session = newestSession(before, after);
    }
    const output = result.stderr.trim()
      ? `${parsed.output.trimEnd()}\n\n[stderr]\n${result.stderr.trimEnd()}\n`
      : parsed.output;
    await store.complete(name, turn, result.code, parsed.session, output);
    return result.code;
  };
  try {
    if (action !== "resume" && ["devin", "hermes"].includes(record.meta.engine)) {
      const digest = createHash("sha256").update(record.meta.directory).digest("hex").slice(0, 20);
      return await store.withLock(`discover-${record.meta.engine}-${digest}`, execute);
    }
    return await execute();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code === "ENOENT" ? 127 : 125;
    const message =
      code === 127
        ? `sidekick: executable not found: ${invocation.command}\n`
        : `sidekick worker error: ${error instanceof Error ? error.message : String(error)}\n`;
    await store.complete(name, turn, code, record.session, message);
    return code;
  }
}

async function discoverSessions(engine: string, directory: string): Promise<Map<string, string>> {
  if (engine === "devin") {
    try {
      const [command, ...leading] = commandOverride("devin", "devin", process.env);
      if (!command) return new Map();
      const result = await runProcess(command, [...leading, "list", "--format", "json"], {
        cwd: directory,
      });
      const values = JSON.parse(result.stdout) as Array<{ id?: string; last_activity_at?: string }>;
      return new Map(
        values
          .filter((value) => value.id)
          .map((value) => [value.id ?? "", value.last_activity_at ?? ""]),
      );
    } catch {
      return new Map();
    }
  }
  if (engine === "hermes") {
    try {
      const sqlite = await import("node:sqlite");
      const database = new sqlite.DatabaseSync(join(homedir(), ".hermes", "state.db"), {
        readOnly: true,
      });
      try {
        const rows = database
          .prepare("SELECT id, started_at FROM sessions WHERE cwd = ? ORDER BY started_at DESC")
          .all(directory) as Array<{ id: string; started_at: string }>;
        return new Map(rows.map((row) => [String(row.id), String(row.started_at)]));
      } finally {
        database.close();
      }
    } catch {
      /* Node 20 has no built-in SQLite; use the Hermes read-only listing command. */
    }
    try {
      const [command, ...leading] = commandOverride("hermes", "hermes", process.env);
      if (!command) return new Map();
      const result = await runProcess(
        command,
        [...leading, "sessions", "list", "--workspace", directory, "--limit", "1000"],
        { cwd: directory },
      );
      const rows = result.stdout.split(/\r?\n/u);
      const found = new Map<string, string>();
      rows.forEach((row, index) => {
        const id = /(?:^|\s)([A-Za-z0-9][A-Za-z0-9_-]{7,})\s*$/u.exec(row)?.[1];
        if (id && !["Workspace", "Active", "Preview", "Title"].includes(id))
          found.set(id, String(rows.length - index).padStart(6, "0"));
      });
      return found;
    } catch {
      return new Map();
    }
  }
  return new Map();
}

function newestSession(before: Map<string, string>, after: Map<string, string>): string {
  return (
    [...after]
      .filter(([id]) => !before.has(id))
      .sort((left, right) => right[1].localeCompare(left[1]))[0]?.[0] ?? ""
  );
}

export async function validateAdoptedSession(
  engine: string,
  session: string,
  directory: string,
): Promise<boolean | null> {
  if (engine === "mock") return true;
  if (engine === "devin" || engine === "hermes") {
    const sessions = await discoverSessions(engine, directory);
    return sessions.size ? sessions.has(session) : null;
  }
  const root =
    engine === "codex"
      ? join(homedir(), ".codex", "sessions")
      : join(homedir(), ".claude", "projects");
  try {
    const pending = [root];
    while (pending.length) {
      const current = pending.pop();
      if (!current) break;
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.name.endsWith(".jsonl")) {
          if (engine === "codex" ? entry.name.includes(session) : entry.name === `${session}.jsonl`)
            return true;
        }
      }
    }
    return false;
  } catch {
    return null;
  }
}
