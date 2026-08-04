import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
  appendFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { CliError } from "../utils/errors.js";
import { isHarnessControls, type HarnessControls } from "./controls.js";
import type { EngineName } from "./engines/types.js";
import { processIdentity, processIdentityMatches } from "./process.js";

export type RunStatus = "running" | "done" | "died" | "cancelled";
export interface RunMeta {
  schemaVersion: 1;
  name: string;
  engine: EngineName;
  directory: string;
  model: string;
  mode: string;
  controls?: HarnessControls;
  activeRun: number;
  createdAt: string;
  updatedAt: string;
  onComplete?: string;
}
export interface RunRecord {
  meta: RunMeta;
  status: RunStatus;
  exitCode: number | null;
  session: string;
  output: string;
  pid: number | null;
  identity: string;
}
export type RunStoreSkipReason = "no-meta" | "corrupt-meta" | "unreadable";
export interface RunStoreSkipped {
  name: string;
  reason: RunStoreSkipReason;
  engine?: EngineName;
  directory?: string;
}
export interface RunStoreScan {
  records: RunRecord[];
  skipped: RunStoreSkipped[];
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const ENGINE_NAMES: readonly EngineName[] = ["codex", "devin", "claude", "hermes", "mock"];
export function validateName(name: string): void {
  if (!NAME_RE.test(name) || name === "." || name === "..")
    throw new CliError("name must match [A-Za-z0-9][A-Za-z0-9._-]{0,79}");
}

export function sidekickHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.SIDEKICK_HOME || join(homedir(), ".sidekick");
}

export class RunStore {
  readonly root: string;
  readonly runs: string;
  readonly locks: string;
  readonly discoveryLocks: string;
  private interrupted = false;

  constructor(root = sidekickHome()) {
    this.root = root;
    this.runs = join(root, "runs");
    this.locks = join(root, "locks");
    this.discoveryLocks = join(root, "discovery-locks");
  }

  async initialize(): Promise<void> {
    await mkdir(this.runs, { recursive: true, mode: 0o700 });
    await mkdir(this.locks, { recursive: true, mode: 0o700 });
  }

  interrupt(): void {
    this.interrupted = true;
  }
  runPath(name: string): string {
    validateName(name);
    return join(this.runs, name);
  }
  turnPath(name: string, number: number): string {
    return join(this.runPath(name), `run-${number}`);
  }

  async exists(name: string): Promise<boolean> {
    try {
      await access(this.runPath(name), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async atomicWrite(path: string, value: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = join(
      dirname(path),
      `.${path.split(/[\\/]/u).pop() ?? "value"}.${process.pid}.${randomUUID()}.tmp`,
    );
    await writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporary, path);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (
          !["EACCES", "EBUSY", "EEXIST", "ENOTEMPTY", "EPERM"].includes(code ?? "") ||
          attempt >= 5
        ) {
          await unlink(temporary).catch(() => undefined);
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
      }
    }
  }

  async readText(path: string, fallback = ""): Promise<string> {
    try {
      return await readFile(path, "utf8");
    } catch {
      return fallback;
    }
  }

  async withLock<T>(name: string, callback: () => Promise<T>): Promise<T> {
    return this.withLockRoot(this.locks, `run-${name}.lock`, name, callback);
  }

  async withDiscoveryLock<T>(name: string, callback: () => Promise<T>): Promise<T> {
    return this.withLockRoot(this.discoveryLocks, `discovery-${name}.lock`, name, callback);
  }

  private async withLockRoot<T>(
    root: string,
    lockName: string,
    name: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    validateName(name);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const lockPath = join(root, lockName);
    const deadline = Date.now() + 10_000;
    while (true) {
      if (this.interrupted) throw new CliError("interrupted", 130);
      try {
        await mkdir(lockPath);
        await writeFile(
          join(lockPath, "owner"),
          `${JSON.stringify({ pid: process.pid, identity: await processIdentity(process.pid) })}\n`,
          { mode: 0o600 },
        );
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
        try {
          const lockInfo = await lstat(lockPath);
          if (!lockInfo.isDirectory()) {
            const raw = (await readFile(lockPath, "utf8")).trim();
            const legacyPid = Number(raw);
            const ownerAlive =
              Number.isInteger(legacyPid) && legacyPid > 0 ? isPidAlive(legacyPid) : false;
            const stale = Date.now() - lockInfo.mtimeMs > 30_000;
            if ((Number.isInteger(legacyPid) && legacyPid > 0 && !ownerAlive) || (stale && !raw)) {
              await unlink(lockPath).catch(() => undefined);
              continue;
            }
          } else {
            const raw = (await readFile(join(lockPath, "owner"), "utf8")).trim();
            const legacyPid = Number(raw);
            const owner = Number.isInteger(legacyPid)
              ? { pid: legacyPid, identity: "" }
              : (JSON.parse(raw) as { pid: number; identity: string });
            const ownerAlive = owner.identity
              ? await processIdentityMatches(owner.pid, owner.identity)
              : owner.pid > 0 && isPidAlive(owner.pid);
            const info = await stat(lockPath);
            if (
              (!ownerAlive && owner.pid > 0) ||
              (!owner.pid && Date.now() - info.mtimeMs > 30_000)
            ) {
              await rm(lockPath, { recursive: true, force: true });
              continue;
            }
          }
        } catch {
          /* lock owner may still be writing its marker */
        }
        if (Date.now() >= deadline) throw new CliError(`timed out acquiring lock for ${name}`, 1);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      return await callback();
    } finally {
      await rm(lockPath, { recursive: true, force: true });
    }
  }

  async create(
    meta: Omit<RunMeta, "schemaVersion" | "activeRun" | "createdAt" | "updatedAt">,
    prompt: string,
    session = "",
  ): Promise<void> {
    const base = this.runPath(meta.name);
    if (await this.exists(meta.name)) throw new CliError(`run already exists: ${meta.name}`);
    await mkdir(base, { mode: 0o700 });
    const now = new Date().toISOString();
    await this.atomicWrite(
      join(base, "meta.json"),
      `${JSON.stringify({ ...meta, schemaVersion: 1, activeRun: 1, createdAt: now, updatedAt: now }, null, 2)}\n`,
    );
    await this.atomicWrite(join(base, "session"), session ? `${session}\n` : "");
    await this.initializeTurn(meta.name, 1, prompt, session);
  }

  async initializeTurn(
    name: string,
    number: number,
    prompt: string,
    session: string,
  ): Promise<string> {
    const base = this.runPath(name);
    const turn = this.turnPath(name, number);
    await mkdir(turn, { mode: 0o700 });
    await Promise.all([
      this.atomicWrite(join(turn, "prompt"), prompt),
      this.atomicWrite(join(turn, "status"), "running\n"),
      this.atomicWrite(join(turn, "exit"), "\n"),
      this.atomicWrite(join(turn, "session"), session ? `${session}\n` : ""),
      this.atomicWrite(join(turn, "out.log"), ""),
      this.atomicWrite(join(base, "status"), "running\n"),
      this.atomicWrite(join(base, "exit"), "\n"),
      this.atomicWrite(join(base, "out.log"), ""),
    ]);
    const meta = await this.readMeta(name);
    await this.atomicWrite(
      join(base, "meta.json"),
      `${JSON.stringify({ ...meta, activeRun: number, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    return turn;
  }

  async readMeta(name: string): Promise<RunMeta> {
    const raw = await this.readText(join(this.runPath(name), "meta.json"));
    if (!raw) throw new CliError(`unknown run: ${name}`);
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRunMeta(parsed, name)) throw new Error("schema mismatch");
      return parsed;
    } catch {
      throw new CliError(`corrupt metadata for run: ${name}`, 1);
    }
  }

  async updateMeta(
    name: string,
    patch: Partial<Pick<RunMeta, "controls" | "onComplete">>,
  ): Promise<RunMeta> {
    const meta = await this.readMeta(name);
    const updated = { ...meta, ...patch, updatedAt: new Date().toISOString() };
    await this.atomicWrite(
      join(this.runPath(name), "meta.json"),
      `${JSON.stringify(updated, null, 2)}\n`,
    );
    return updated;
  }

  async read(name: string): Promise<RunRecord> {
    return this.readRecord(name, true);
  }

  /** Read state needed for summaries without loading potentially large logs. */
  async readSummary(name: string): Promise<RunRecord> {
    return this.readRecord(name, false);
  }

  private async readRecord(name: string, includeOutput: boolean): Promise<RunRecord> {
    const base = this.runPath(name);
    const meta = await this.readMeta(name);
    try {
      await access(join(base, "status"), constants.F_OK);
    } catch {
      throw new CliError(`unreadable run state: ${name}`, 1);
    }
    const [status, exit, session, output, pid, identity] = await Promise.all([
      this.readText(join(base, "status")),
      this.readText(join(base, "exit")),
      this.readText(join(base, "session")),
      includeOutput ? this.readText(join(base, "out.log")) : Promise.resolve(""),
      this.readText(join(base, "pid")),
      this.readText(join(base, "identity")),
    ]);
    const normalizedStatus = status.trim();
    if (!normalizedStatus) throw new CliError(`unreadable run state: ${name}`, 1);
    return {
      meta,
      status: normalizedStatus as RunStatus,
      exitCode: /^-?\d+$/u.test(exit.trim()) ? Number(exit.trim()) : null,
      session: session.trim(),
      output,
      pid: /^\d+$/u.test(pid.trim()) ? Number(pid.trim()) : null,
      identity: identity.trim(),
    };
  }

  async list(): Promise<RunRecord[]> {
    return (await this.scan(true)).records;
  }

  async listSummaries(): Promise<RunRecord[]> {
    return (await this.scan(false)).records;
  }

  async scanSummaries(): Promise<RunStoreScan> {
    return this.scan(false);
  }

  private async scan(includeOutput: boolean): Promise<RunStoreScan> {
    let entries: Array<{ name: string; isDirectory(): boolean }> = [];
    try {
      entries = await readdir(this.runs, { withFileTypes: true });
    } catch {
      return { records: [], skipped: [] };
    }
    const records: RunRecord[] = [];
    const skipped: RunStoreSkipped[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const name = entry.name;
      let isDirectory = entry.isDirectory();
      if (!isDirectory) {
        try {
          isDirectory = (await lstat(join(this.runs, name))).isDirectory();
        } catch {
          continue;
        }
      }
      if (!isDirectory) continue;
      let base: string;
      try {
        base = this.runPath(name);
      } catch {
        skipped.push({ name, reason: "unreadable" });
        continue;
      }
      let hasMeta = false;
      try {
        await access(join(base, "meta.json"), constants.F_OK);
        hasMeta = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          skipped.push({
            name,
            reason: "unreadable",
            ...(await readFilterMetadata(base)),
          });
          continue;
        }
      }
      if (hasMeta) {
        try {
          records.push(await this.readRecord(name, includeOutput));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          skipped.push({
            name,
            reason: message.startsWith("corrupt metadata") ? "corrupt-meta" : "unreadable",
            ...(await readFilterMetadata(base)),
          });
        }
        continue;
      }
      try {
        await access(base, constants.F_OK);
        skipped.push({ name, reason: "no-meta", ...(await readFilterMetadata(base)) });
      } catch {
        // The run was removed between readdir and the metadata check.
      }
    }
    return { records, skipped };
  }

  async nextTurn(name: string): Promise<number> {
    const entries = await readdir(this.runPath(name));
    return (
      Math.max(
        0,
        ...entries
          .map((entry) => /^run-(\d+)$/u.exec(entry)?.[1])
          .filter(Boolean)
          .map(Number),
      ) + 1
    );
  }

  async writePid(name: string, turn: string, pid: number, identity: string): Promise<void> {
    await Promise.all([
      this.atomicWrite(join(this.runPath(name), "pid"), `${pid}\n`),
      this.atomicWrite(join(turn, "pid"), `${pid}\n`),
      this.atomicWrite(join(this.runPath(name), "identity"), `${identity}\n`),
      this.atomicWrite(join(turn, "identity"), `${identity}\n`),
    ]);
  }

  async appendLog(path: string, value: string, maxBytes: number): Promise<void> {
    if (!value) return;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await appendFile(path, value, { encoding: "utf8", mode: 0o600 });
    const size = (await stat(path)).size;
    if (size <= maxBytes) return;
    const content = await readFile(path);
    const marker = Buffer.from("[sidekick: earlier log output truncated]\n", "utf8");
    const keep = Math.max(0, maxBytes - marker.length);
    await this.atomicWrite(
      path,
      Buffer.concat([marker, content.subarray(content.length - keep)]).toString("utf8"),
    );
  }

  async complete(
    name: string,
    turn: string,
    exitCode: number,
    session: string,
    output: string,
    status: RunStatus = "done",
  ): Promise<void> {
    const base = this.runPath(name);
    const normalized = output && !output.endsWith("\n") ? `${output}\n` : output;
    const meta = await this.readMeta(name);
    // A turn that has since been replaced (--force resend, cancel) must still
    // record its own result, but must not publish it as the run's current
    // state — otherwise a slow dying worker overwrites the turn that replaced
    // it, and the run reports the killed process's exit code.
    const current = turn === this.turnPath(name, meta.activeRun);
    await Promise.all([
      this.atomicWrite(join(turn, "out.log"), normalized),
      this.atomicWrite(join(turn, "session"), session ? `${session}\n` : ""),
      this.atomicWrite(join(turn, "exit"), `${exitCode}\n`),
      ...(current
        ? [
            this.atomicWrite(join(base, "out.log"), normalized),
            this.atomicWrite(join(base, "exit"), `${exitCode}\n`),
            this.atomicWrite(
              join(base, "meta.json"),
              `${JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }, null, 2)}\n`,
            ),
            ...(session ? [this.atomicWrite(join(base, "session"), `${session}\n`)] : []),
          ]
        : []),
    ]);
    // Status is the commit marker: readers that observe a terminal value must
    // also be able to observe the corresponding output, exit code, and session.
    await Promise.all([
      this.atomicWrite(join(turn, "status"), `${status}\n`),
      ...(current ? [this.atomicWrite(join(base, "status"), `${status}\n`)] : []),
    ]);
  }

  async remove(name: string): Promise<void> {
    await rm(this.runPath(name), { recursive: true, force: true });
  }
}

async function readFilterMetadata(
  base: string,
): Promise<Pick<RunStoreSkipped, "engine" | "directory">> {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(join(base, "meta.json"), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      metadata = parsed as Record<string, unknown>;
  } catch {
    /* Fall through to legacy marker files. */
  }

  const engineValue =
    typeof metadata.engine === "string"
      ? metadata.engine
      : (await readFile(join(base, "engine"), "utf8").catch(() => "")).trim();
  const directoryValue =
    typeof metadata.directory === "string"
      ? metadata.directory
      : (await readFile(join(base, "dir"), "utf8").catch(() => "")).trim();
  return {
    ...(ENGINE_NAMES.includes(engineValue as EngineName)
      ? { engine: engineValue as EngineName }
      : {}),
    ...(directoryValue ? { directory: directoryValue } : {}),
  };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isRunMeta(value: unknown, name: string): value is RunMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const meta = value as Record<string, unknown>;
  return (
    meta.schemaVersion === 1 &&
    meta.name === name &&
    typeof meta.engine === "string" &&
    ENGINE_NAMES.includes(meta.engine as EngineName) &&
    typeof meta.directory === "string" &&
    typeof meta.model === "string" &&
    typeof meta.mode === "string" &&
    Number.isSafeInteger(meta.activeRun) &&
    Number(meta.activeRun) > 0 &&
    typeof meta.createdAt === "string" &&
    Number.isFinite(Date.parse(meta.createdAt)) &&
    typeof meta.updatedAt === "string" &&
    Number.isFinite(Date.parse(meta.updatedAt)) &&
    (meta.onComplete === undefined || typeof meta.onComplete === "string") &&
    (meta.controls === undefined || isHarnessControls(meta.controls))
  );
}
