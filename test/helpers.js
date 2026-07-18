import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

export const root = resolve(import.meta.dirname, "..");
export const cli = join(root, "bin", "sidekick.js");

export async function temporary() {
  return mkdtemp(join(tmpdir(), "sidekick-test-"));
}

export function runCli(args, options = {}) {
  // FORCE_COLOR alongside NO_COLOR makes Node emit a warning on stderr, which
  // breaks output assertions for anyone whose terminal exports it.
  const inherited = { ...process.env };
  delete inherited.FORCE_COLOR;
  return new Promise((resolvePromise, reject) => {
    const diagnosticArgs = process.env.SIDEKICK_TEST_NO_MAGLEV === "1" ? ["--no-maglev"] : [];
    const child = spawn(process.execPath, [...diagnosticArgs, cli, ...args], {
      cwd: options.cwd ?? root,
      env: { ...inherited, NO_COLOR: "1", CI: "true", ...options.env },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (value) => stdout.push(value));
    child.stderr.on("data", (value) => stderr.push(value));
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolvePromise({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        pid: child.pid,
      }),
    );
    child.stdin.end(options.stdin);
  });
}

export async function pidFor(home, name) {
  return Number((await readFile(join(home, "runs", name, "pid"), "utf8")).trim());
}
