import { closeSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { RunStore } from "./run-store.js";

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
    const child = spawn(
      process.execPath,
      [process.argv[1] ?? "", "_worker", name, String(turn.split(/run-/u).pop()), action],
      {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", out, error],
        env: process.env,
      },
    );
    child.unref();
    await store.writePid(name, turn, child.pid ?? 0);
    return child.pid ?? 0;
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

export async function stopProcess(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  for (let index = 0; index < 20; index += 1) {
    if (!isProcessAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already stopped */
  }
}

export function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; stdin?: string; env?: NodeJS.ProcessEnv },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env ?? process.env,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code: code ?? 125,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
    child.stdin.end(options.stdin);
  });
}
