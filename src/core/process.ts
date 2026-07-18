import { closeSync, openSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { RunStore } from "./run-store.js";
import { resolveCommand } from "./command-resolver.js";

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function launchWorker(
  store: RunStore,
  name: string,
  turn: string,
  action: string,
): Promise<number> {
  const out = openSync(join(turn, "worker.stdout.log"), "a");
  const error = openSync(join(turn, "worker.stderr.log"), "a");
  try {
    const token = randomUUID();
    const child = spawn(
      process.execPath,
      [process.argv[1] ?? "", "_worker", name, String(turn.split(/run-/u).pop()), action, token],
      {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", out, error],
        env: process.env,
      },
    );
    child.unref();
    const pid = child.pid ?? 0;
    const identity = await processIdentity(pid, token);
    await store.writePid(name, turn, pid, identity);
    return pid;
  } finally {
    closeSync(out);
    closeSync(error);
  }
}

export function isProcessAlive(pid: number | null): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function processIdentity(pid: number, token = ""): Promise<string> {
  if (!isProcessAlive(pid)) return "";
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const end = stat.lastIndexOf(")");
      const fields = stat.slice(end + 2).split(" ");
      const started = fields[19] ?? "";
      const command = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
      if (token && !command.includes(token)) return "";
      return `linux|${token}|${started}`;
    } catch {
      return "";
    }
  }
  if (process.platform === "win32") {
    // CreationDate is a DateTime under CIM, and DateTime + string throws in
    // PowerShell, so format it explicitly. A missing process writes nothing,
    // which must read as "no identity" rather than an empty-but-truthy one.
    const script =
      `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; ` +
      `if($p){Write-Output ("{0}|{1}" -f $p.CreationDate.ToFileTimeUtc(), $p.CommandLine)}`;
    const result = await capture("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    const value = result.stdout.trim();
    if (result.code !== 0 || !value || (token && !value.includes(token))) return "";
    return `win32|${token}|${value}`;
  }
  // -ww keeps ps from truncating the command to the terminal width, which would
  // make the identity depend on where it was sampled from.
  const result = await capture("ps", ["-ww", "-p", String(pid), "-o", "lstart=", "-o", "command="]);
  const value = result.stdout.trim();
  if (result.code !== 0 || !value || (token && !value.includes(token))) return "";
  return `${process.platform}|${token}|${value}`;
}

export async function processIdentityMatches(
  pid: number | null,
  expected: string,
): Promise<boolean> {
  if (!pid || !expected || !isProcessAlive(pid)) return false;
  const token = expected.split("|")[1] ?? "";
  return (await processIdentity(pid, token)) === expected;
}

export async function stopProcess(pid: number): Promise<void> {
  if (process.platform === "win32") {
    const result = await runProcess("taskkill.exe", windowsTreeKillArgs(pid), {
      cwd: process.cwd(),
    });
    if (result.code !== 0 && isProcessAlive(pid))
      throw new Error(`taskkill failed for PID ${pid}: ${result.stderr.trim() || result.code}`);
    // taskkill returns before the process has actually exited. Wait it out, as
    // the POSIX path does, so a caller that replaces the turn cannot have the
    // dying worker write its own completion over the new one.
    for (let index = 0; index < 20; index += 1) {
      if (!isProcessAlive(pid)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`failed to stop process ${pid}`);
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
  for (let index = 0; index < 20; index += 1) {
    if (!isProcessGroupAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already stopped */
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (isProcessGroupAlive(pid)) throw new Error(`failed to stop process group ${pid}`);
}

function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function windowsTreeKillArgs(pid: number): string[] {
  return ["/PID", String(pid), "/T", "/F"];
}

export function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    stdin?: string;
    env?: NodeJS.ProcessEnv;
    onStdout?: (chunk: string) => void | Promise<void>;
    onStderr?: (chunk: string) => void | Promise<void>;
    maxCaptureBytes?: number;
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    void resolveCommand(command, { env: options.env ?? process.env })
      .then((resolved) => {
        const child = spawn(resolved.command, [...resolved.leadingArgs, ...args], {
          cwd: options.cwd,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: options.env ?? process.env,
        });
        const stdout = new CappedCapture(options.maxCaptureBytes);
        const stderr = new CappedCapture(options.maxCaptureBytes);
        const pending: Promise<void>[] = [];
        child.stdout.on("data", (chunk: Buffer) => {
          stdout.push(chunk);
          if (options.onStdout)
            pending.push(Promise.resolve(options.onStdout(chunk.toString("utf8"))));
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr.push(chunk);
          if (options.onStderr)
            pending.push(Promise.resolve(options.onStderr(chunk.toString("utf8"))));
        });
        child.on("error", reject);
        child.on(
          "close",
          (code) =>
            void Promise.all(pending)
              .then(() =>
                resolve({
                  code: code ?? 125,
                  stdout: stdout.toString(),
                  stderr: stderr.toString(),
                }),
              )
              .catch(reject),
        );
        child.stdin.end(options.stdin);
      })
      .catch(reject);
  });
}

class CappedCapture {
  private readonly maximum: number;
  private readonly headMaximum: number;
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private truncated = false;

  constructor(maximum = 16 * 1024 * 1024) {
    this.maximum = Math.max(1024, maximum);
    this.headMaximum = Math.floor(this.maximum / 4);
  }

  push(chunk: Buffer): void {
    let remainder = chunk;
    if (this.head.length < this.headMaximum) {
      const needed = this.headMaximum - this.head.length;
      this.head = Buffer.concat([this.head, chunk.subarray(0, needed)]);
      remainder = chunk.subarray(Math.min(needed, chunk.length));
    }
    if (!remainder.length) return;
    const tailMaximum = this.maximum - this.headMaximum;
    this.tail = Buffer.concat([this.tail, remainder]);
    if (this.tail.length > tailMaximum) {
      this.tail = this.tail.subarray(this.tail.length - tailMaximum);
      this.truncated = true;
    }
  }

  toString(): string {
    const marker = this.truncated
      ? Buffer.from("\n[sidekick: captured output truncated]\n")
      : Buffer.alloc(0);
    return Buffer.concat([this.head, marker, this.tail]).toString("utf8");
  }
}

function capture(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", () => resolve({ code: 125, stdout: "", stderr: "" }));
    child.on("close", (code) =>
      resolve({
        code: code ?? 125,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}
