import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { runCli, temporary } from "../helpers.js";

test("devin session discovery sorts numeric last_activity_at epoch values", async () => {
  // Devin >=3000.11 lists last_activity_at as epoch seconds; two new sessions force a sort.
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const state = join(sandbox, "ran");
  const fake = join(sandbox, "fake-devin.mjs");
  await writeFile(
    fake,
    `import { existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
if (args.includes("--version")) console.log("devin 3000.11.92 (test)");
else if (args[0] === "list") {
  const sessions = [{ id: "old", last_activity_at: 1000 }];
  if (existsSync(state)) {
    sessions.push({ id: "new-a", last_activity_at: 2000 }, { id: "new-b", last_activity_at: 3000 });
  }
  console.log(JSON.stringify(sessions));
} else {
  writeFileSync(state, "1");
  console.log("devin ok");
}
`,
  );
  const env = {
    SIDEKICK_HOME: home,
    SIDEKICK_ENGINE_DEVIN_CMD: `${process.execPath} ${fake}`,
  };
  await runCli(["spawn", "devin", "numeric", "--dir", sandbox, "--", "hello"], { env });
  const result = await runCli(["wait", "numeric", "--timeout", "10", "--json"], { env });
  assert.equal(result.code, 0);
  const json = JSON.parse(result.stdout);
  assert.equal(json.status, "done");
  assert.equal(json.session, "new-b");
});

test("tail prints a finished run and a followed run, then exits", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const env = { SIDEKICK_HOME: home, SIDEKICK_MOCK_DELAY_MS: "300" };
  await runCli(["spawn", "mock", "tailed", "--dir", sandbox, "--", "hello"], { env });
  const followed = await runCli(["tail", "tailed"], { env });
  assert.equal(followed.code, 0);
  assert.match(followed.stdout, /mock spawn: hello/u);
  const finished = await runCli(["tail", "tailed", "-n", "5"], { env });
  assert.equal(finished.code, 0);
  assert.match(finished.stdout, /mock spawn: hello/u);
});

test("tail exits cleanly when the followed run disappears", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const env = { SIDEKICK_HOME: home, SIDEKICK_MOCK_DELAY_MS: "3000" };
  await runCli(["spawn", "mock", "vanishing", "--dir", sandbox, "--", "slow"], { env });
  const tailed = runCli(["tail", "vanishing"], { env });
  // Let tail pass its initial exists check and enter the follow loop.
  await new Promise((resolve) => setTimeout(resolve, 700));
  await rm(join(home, "runs", "vanishing"), { recursive: true, force: true });
  const result = await tailed;
  assert.equal(result.code, 2);
  assert.equal(result.stderr, "sidekick: unknown run: vanishing\n");
});

test("an engine that exits without reading stdin records its failure instead of dying", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const fake = join(sandbox, "fake-codex.sh");
  await writeFile(
    fake,
    `#!/bin/sh
[ "$1" = "--version" ] && { echo "codex-cli 0.164.0"; exit 0; }
echo "not logged in" >&2
exit 3
`,
    { mode: 0o755 },
  );
  const env = { SIDEKICK_HOME: home, SIDEKICK_ENGINE_CODEX_CMD: fake };
  await runCli(["spawn", "codex", "early", "--dir", sandbox, "--", "x".repeat(100_000)], { env });
  const result = await runCli(["wait", "early", "--timeout", "10", "--json"], { env });
  const json = JSON.parse(result.stdout);
  assert.equal(json.status, "done");
  assert.equal(json.exitCode, 3);
  assert.match(json.output, /not logged in/u);
});

test("codex resumes reuse the CODEX_HOME captured at spawn", async () => {
  // Multi-account setups keep one CODEX_HOME per account; a resume from another shell must not switch.
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const fake = join(sandbox, "fake-codex.sh");
  await writeFile(
    fake,
    `#!/bin/sh
[ "$1" = "--version" ] && { echo "codex-cli 0.164.0"; exit 0; }
cat >/dev/null
echo '{"type":"thread.started","thread_id":"t-1"}'
echo "{\\"type\\":\\"item.completed\\",\\"item\\":{\\"type\\":\\"agent_message\\",\\"text\\":\\"home=\${CODEX_HOME:-unset}\\"}}"
`,
    { mode: 0o755 },
  );
  const base = { SIDEKICK_HOME: home, SIDEKICK_ENGINE_CODEX_CMD: fake };
  const accountA = join(sandbox, "acct-a");
  const outputOf = async () =>
    JSON.parse((await runCli(["wait", "acct", "--timeout", "10", "--json"], { env: base })).stdout)
      .output;
  await runCli(["spawn", "codex", "acct", "--dir", sandbox, "--", "hi"], {
    env: { ...base, CODEX_HOME: accountA },
  });
  assert.equal((await outputOf()).trim(), `home=${accountA}`);
  await runCli(["send", "acct", "--", "again"], {
    env: { ...base, CODEX_HOME: join(sandbox, "b") },
  });
  assert.equal((await outputOf()).trim(), `home=${accountA}`);
  await runCli(["send", "acct", "--", "again"], { env: base });
  assert.equal((await outputOf()).trim(), `home=${accountA}`);
});
