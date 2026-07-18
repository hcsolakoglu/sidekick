import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "bin", "sidekick.js");
const workspace = mkdtempSync(join(tmpdir(), "sidekick-smoke-"));
const env = {
  ...process.env,
  SIDEKICK_HOME: join(workspace, "state"),
  SIDEKICK_MOCK_DELAY_MS: "10",
  NO_COLOR: "1",
};

function sidekick(args) {
  return execFileSync(process.execPath, [cli, ...args], { cwd: workspace, env, encoding: "utf8" });
}

try {
  sidekick(["spawn", "mock", "roundtrip", "--dir", workspace, "--json", "--", "first turn"]);
  const first = JSON.parse(sidekick(["wait", "roundtrip", "--timeout", "10", "--json"]));
  if (first.status !== "done" || first.exitCode !== 0)
    throw new Error(`spawn/wait failed: ${JSON.stringify(first)}`);
  const sessionBefore = readFileSync(
    join(env.SIDEKICK_HOME, "runs", "roundtrip", "session"),
    "utf8",
  ).trim();
  sidekick(["send", "roundtrip", "--json", "--", "second turn"]);
  const second = JSON.parse(sidekick(["wait", "roundtrip", "--timeout", "10", "--json"]));
  const sessionAfter = readFileSync(
    join(env.SIDEKICK_HOME, "runs", "roundtrip", "session"),
    "utf8",
  ).trim();
  if (
    second.status !== "done" ||
    second.exitCode !== 0 ||
    !sessionBefore ||
    sessionAfter !== sessionBefore
  ) {
    throw new Error(
      `send/resume failed: ${JSON.stringify({ second, sessionBefore, sessionAfter })}`,
    );
  }
  process.stdout.write(
    "mock spawn -> wait -> send -> wait roundtrip passed with session persistence.\n",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
