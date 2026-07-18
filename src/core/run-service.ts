import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getEngine } from "./engines/index.js";
import { commandOverride } from "./engines/shared.js";
import type { WorkerAction } from "./engines/types.js";
import { launchWorker, processIdentityMatches, runProcess, stopProcess } from "./process.js";
import { RunStore, type RunRecord } from "./run-store.js";
import { engineStatePath } from "./platform-support.js";
import { CliError } from "../utils/errors.js";
import { splitCommand } from "./engines/shared.js";

const DEFAULT_MAX_LOG_MB = 10;

export function maxLogBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SIDEKICK_MAX_LOG_MB;
  const value = raw === undefined ? DEFAULT_MAX_LOG_MB : Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new CliError("SIDEKICK_MAX_LOG_MB must be a positive number");
  return Math.max(1024, Math.floor(value * 1024 * 1024));
}

export async function refresh(store: RunStore, record: RunRecord): Promise<RunRecord> {
  if (record.status === "running" && !(await processIdentityMatches(record.pid, record.identity))) {
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

export async function withEngineSlot<T>(
  store: RunStore,
  engine: string,
  callback: () => Promise<T>,
): Promise<T> {
  const raw = process.env[`SIDEKICK_MAX_CONCURRENT_${engine.toUpperCase()}`];
  if (raw === undefined) return callback();
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1)
    throw new CliError(
      `SIDEKICK_MAX_CONCURRENT_${engine.toUpperCase()} must be a positive integer`,
    );
  return store.withLock(`capacity-${engine}`, async () => {
    const records = await Promise.all((await store.list()).map((record) => refresh(store, record)));
    const running = records.filter(
      (record) => record.meta.engine === engine && record.status === "running",
    ).length;
    if (running >= limit)
      throw new CliError(`${engine} concurrency limit reached (${running}/${limit})`, 1);
    return callback();
  });
}

export async function forceStop(store: RunStore, record: RunRecord): Promise<void> {
  if (record.pid && (await processIdentityMatches(record.pid, record.identity)))
    await stopProcess(record.pid);
  const turn = store.turnPath(record.meta.name, record.meta.activeRun);
  await store.complete(
    record.meta.name,
    turn,
    -1,
    record.session,
    `${record.output}sidekick: worker stopped by --force\n`,
    "cancelled",
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
  const maximum = maxLogBytes();
  await store.atomicWrite(
    join(turn, "command.json"),
    `${JSON.stringify([invocation.command, ...invocation.args], null, 2)}\n`,
  );
  const execute = async () => {
    const before =
      action === "resume"
        ? new Map<string, string>()
        : await discoverSessions(record.meta.engine, record.meta.directory);
    let stream = Promise.resolve();
    const append = (path: string, chunk: string) => {
      stream = stream.then(() => store.appendLog(path, chunk, maximum));
      return stream;
    };
    const result = await runProcess(invocation.command, invocation.args, {
      cwd: record.meta.directory,
      ...(invocation.stdin === undefined ? {} : { stdin: invocation.stdin }),
      maxCaptureBytes: maximum,
      onStdout: async (chunk) => {
        await append(join(turn, "raw.log"), chunk);
        await append(join(store.runPath(name), "out.log"), chunk);
      },
      onStderr: (chunk) => append(join(turn, "stderr.log"), chunk),
    });
    await stream;
    const parsed = engine.parse(result.stdout, context);
    if (!parsed.session && action !== "resume") {
      const after = await discoverSessions(record.meta.engine, record.meta.directory);
      parsed.session = newestSession(before, after);
    }
    const output = result.stderr.trim()
      ? `${parsed.output.trimEnd()}\n\n[stderr]\n${result.stderr.trimEnd()}\n`
      : parsed.output;
    await store.complete(name, turn, result.code, parsed.session, capText(output, maximum));
    return result.code;
  };
  try {
    if (action !== "resume" && ["devin", "hermes"].includes(record.meta.engine)) {
      const digest = createHash("sha256").update(record.meta.directory).digest("hex").slice(0, 20);
      return await store.withLock(`discover-${record.meta.engine}-${digest}`, execute);
    }
    return await execute();
  } catch (error) {
    const code =
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error instanceof CliError && error.exitCode === 127)
        ? 127
        : 125;
    const message =
      code === 127
        ? `sidekick: executable not found: ${invocation.command}\n`
        : `sidekick worker error: ${error instanceof Error ? error.message : String(error)}\n`;
    await store.complete(name, turn, code, record.session, message);
    return code;
  } finally {
    await runCompletionHook(store, record, turn, maximum);
  }
}

// Callers persist this through RunStore.complete, which appends a trailing
// newline when one is missing. Reserve room for it so the stored log honours
// the cap exactly instead of exceeding it by a byte.
function capText(value: string, maximum: number): string {
  const content = Buffer.from(value, "utf8");
  if (content.length <= maximum) return value;
  const marker = Buffer.from("[sidekick: earlier output truncated]\n", "utf8");
  const kept = content.subarray(content.length - maximum + marker.length + 1);
  const text = Buffer.concat([marker, kept]).toString("utf8");
  return text.endsWith("\n") ? text : `${text}\n`;
}

async function runCompletionHook(
  store: RunStore,
  record: RunRecord,
  turn: string,
  maximum: number,
): Promise<void> {
  const raw = record.meta.onComplete || process.env.SIDEKICK_ON_COMPLETE;
  if (!raw) return;
  try {
    const [command, ...args] = splitCommand(raw);
    if (!command) return;
    const current = await store.read(record.meta.name);
    const result = await runProcess(command, args, {
      cwd: record.meta.directory,
      env: {
        ...process.env,
        SIDEKICK_RUN_NAME: record.meta.name,
        SIDEKICK_RUN_STATUS: current.status,
        SIDEKICK_RUN_EXIT_CODE: String(current.exitCode ?? ""),
        SIDEKICK_RUN_SESSION: current.session,
      },
      maxCaptureBytes: maximum,
    });
    await store.appendLog(join(turn, "hook.log"), `${result.stdout}${result.stderr}`, maximum);
  } catch (error) {
    await store.appendLog(
      join(turn, "hook.log"),
      `sidekick completion hook error: ${error instanceof Error ? error.message : String(error)}\n`,
      maximum,
    );
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
      const database = new sqlite.DatabaseSync(join(engineStatePath("hermes"), "state.db"), {
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
  const root = join(
    engineStatePath(engine === "codex" ? "codex" : "claude"),
    engine === "codex" ? "sessions" : "projects",
  );
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
