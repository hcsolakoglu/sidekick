import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { CliError } from "../utils/errors.js";
import type { EngineName } from "./engines/types.js";

export type RunStatus = "running" | "done" | "died";
export interface RunMeta {
  schemaVersion: 1;
  name: string;
  engine: EngineName;
  directory: string;
  model: string;
  mode: string;
  activeRun: number;
  createdAt: string;
  updatedAt: string;
}
export interface RunRecord {
  meta: RunMeta;
  status: RunStatus;
  exitCode: number | null;
  session: string;
  output: string;
  pid: number | null;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
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
  private interrupted = false;

  constructor(root = sidekickHome()) {
    this.root = root;
    this.runs = join(root, "runs");
    this.locks = join(root, "locks");
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
    await rename(temporary, path);
  }

  async readText(path: string, fallback = ""): Promise<string> {
    try {
      return await readFile(path, "utf8");
    } catch {
      return fallback;
    }
  }

  async withLock<T>(name: string, callback: () => Promise<T>): Promise<T> {
    validateName(name);
    const lockPath = join(this.locks, `run-${name}.lock`);
    const deadline = Date.now() + 10_000;
    while (true) {
      if (this.interrupted) throw new CliError("interrupted", 130);
      try {
        await mkdir(lockPath);
        await writeFile(join(lockPath, "owner"), `${process.pid}\n`, { mode: 0o600 });
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
        try {
          const owner = Number((await readFile(join(lockPath, "owner"), "utf8")).trim());
          let ownerAlive = false;
          if (owner > 0) {
            try {
              process.kill(owner, 0);
              ownerAlive = true;
            } catch {
              /* dead owner */
            }
          }
          const info = await stat(lockPath);
          if ((!ownerAlive && owner > 0) || (!owner && Date.now() - info.mtimeMs > 30_000)) {
            await rm(lockPath, { recursive: true, force: true });
            continue;
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
      return JSON.parse(raw) as RunMeta;
    } catch {
      throw new CliError(`corrupt metadata for run: ${name}`, 1);
    }
  }

  async read(name: string): Promise<RunRecord> {
    const base = this.runPath(name);
    const meta = await this.readMeta(name);
    const [status, exit, session, output, pid] = await Promise.all([
      this.readText(join(base, "status")),
      this.readText(join(base, "exit")),
      this.readText(join(base, "session")),
      this.readText(join(base, "out.log")),
      this.readText(join(base, "pid")),
    ]);
    return {
      meta,
      status: (status.trim() || "died") as RunStatus,
      exitCode: /^-?\d+$/u.test(exit.trim()) ? Number(exit.trim()) : null,
      session: session.trim(),
      output,
      pid: /^\d+$/u.test(pid.trim()) ? Number(pid.trim()) : null,
    };
  }

  async list(): Promise<RunRecord[]> {
    let entries: string[] = [];
    try {
      entries = await readdir(this.runs);
    } catch {
      return [];
    }
    const records: RunRecord[] = [];
    for (const name of entries.sort()) {
      try {
        records.push(await this.read(name));
      } catch {
        /* skip non-run entries */
      }
    }
    return records;
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

  async writePid(name: string, turn: string, pid: number): Promise<void> {
    await Promise.all([
      this.atomicWrite(join(this.runPath(name), "pid"), `${pid}\n`),
      this.atomicWrite(join(turn, "pid"), `${pid}\n`),
    ]);
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
    await Promise.all([
      this.atomicWrite(join(turn, "out.log"), normalized),
      this.atomicWrite(join(turn, "session"), session ? `${session}\n` : ""),
      this.atomicWrite(join(turn, "exit"), `${exitCode}\n`),
      this.atomicWrite(join(turn, "status"), `${status}\n`),
      this.atomicWrite(join(base, "out.log"), normalized),
      this.atomicWrite(join(base, "exit"), `${exitCode}\n`),
      this.atomicWrite(join(base, "status"), `${status}\n`),
      ...(session ? [this.atomicWrite(join(base, "session"), `${session}\n`)] : []),
    ]);
  }

  async remove(name: string): Promise<void> {
    await rm(this.runPath(name), { recursive: true, force: true });
  }
}
