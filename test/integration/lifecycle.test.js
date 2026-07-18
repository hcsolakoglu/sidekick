import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { pidFor, runCli, temporary } from "../helpers.js";

test("spawn wait result and send resume persist a session", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const env = { SIDEKICK_HOME: home, SIDEKICK_MOCK_DELAY_MS: "25" };
  assert.equal(
    (await runCli(["spawn", "mock", "alpha", "--dir", sandbox, "--", "hello"], { env })).stdout,
    "alpha\n",
  );
  const first = await runCli(["wait", "alpha", "--all", "--timeout", "5", "--json"], { env });
  assert.equal(first.code, 0);
  const firstJson = JSON.parse(first.stdout);
  assert.equal(firstJson.status, "done");
  assert.match(firstJson.session, /^mock-/u);
  assert.equal(firstJson.output, "mock spawn: hello\n");
  const session = (await readFile(join(home, "runs", "alpha", "session"), "utf8")).trim();
  await runCli(["send", "alpha", "--", "follow up"], { env });
  const second = await runCli(["wait", "alpha", "--all", "--timeout", "5", "--json"], { env });
  const secondJson = JSON.parse(second.stdout);
  assert.equal(secondJson.session, session);
  assert.equal(secondJson.output, "mock resume: follow up\n");
  const result = await runCli(["result", "alpha", "--json"], { env });
  assert.deepEqual(JSON.parse(result.stdout), secondJson);
});

test("wait --all reports every selected run", async () => {
  const sandbox = await temporary();
  const env = { SIDEKICK_HOME: join(sandbox, "home"), SIDEKICK_MOCK_DELAY_MS: "30" };
  await Promise.all([
    runCli(["spawn", "mock", "one", "--dir", sandbox, "--", "first"], { env }),
    runCli(["spawn", "mock", "two", "--dir", sandbox, "--", "second"], { env }),
  ]);
  const waited = await runCli(["wait", "one", "two", "--all", "--timeout", "5", "--quiet"], {
    env,
  });
  assert.equal(waited.code, 0);
  assert.deepEqual(waited.stdout.trim().split(/\r?\n/u).sort(), ["one 0", "two 0"]);
});

test("adopt creates a completed resumable run", async () => {
  const sandbox = await temporary();
  const env = { SIDEKICK_HOME: join(sandbox, "home") };
  const adopted = await runCli(
    ["adopt", "mock", "legacy", "--session", "existing-123", "--dir", sandbox],
    { env },
  );
  assert.equal(adopted.code, 0);
  const status = JSON.parse((await runCli(["status", "--json"], { env })).stdout);
  assert.deepEqual(
    status.runs.map(({ name, engine, status, exitCode, run, session }) => ({
      name,
      engine,
      status,
      exitCode,
      run,
      session,
    })),
    [
      {
        name: "legacy",
        engine: "mock",
        status: "done",
        exitCode: 0,
        run: 1,
        session: "existing-123",
      },
    ],
  );
  await runCli(["send", "legacy", "--", "continue"], { env });
  const result = JSON.parse(
    (await runCli(["wait", "legacy", "--timeout", "5", "--json"], { env })).stdout,
  );
  assert.equal(result.session, "existing-123");
});

test("clean removes terminal runs and skips active runs", async () => {
  const sandbox = await temporary();
  const env = { SIDEKICK_HOME: join(sandbox, "home"), SIDEKICK_MOCK_DELAY_MS: "1000" };
  await runCli(["adopt", "mock", "finished", "--session", "done-1", "--dir", sandbox], { env });
  await runCli(["spawn", "mock", "active", "--dir", sandbox, "--", "working"], { env });
  const cleaned = await runCli(["clean", "finished", "active"], { env });
  assert.equal(cleaned.stdout, "removed 1\n");
  assert.match(cleaned.stderr, /skipping running run: active/u);
  const status = JSON.parse((await runCli(["status", "--json"], { env })).stdout);
  assert.deepEqual(
    status.runs.map((run) => run.name),
    ["active"],
  );
  await runCli(["send", "active", "--force", "--", "finish"], { env });
  await runCli(["wait", "active", "--timeout", "5", "--quiet"], { env });
  assert.equal((await runCli(["clean", "active"], { env })).stdout, "removed 1\n");
});

test("dead workers are detected and repaired", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const env = { SIDEKICK_HOME: home, SIDEKICK_MOCK_DELAY_MS: "10000" };
  await runCli(["spawn", "mock", "doomed", "--dir", sandbox, "--", "slow"], { env });
  const pid = await pidFor(home, "doomed");
  process.kill(pid, process.platform === "win32" ? undefined : "SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const status = JSON.parse((await runCli(["status", "--json"], { env })).stdout).runs[0];
  assert.equal(status.status, "died");
  assert.equal(status.exitCode, -1);
  assert.match((await runCli(["result", "doomed"], { env })).stdout, /worker process died/u);
});

test("wait timeout is 124 and force resend replaces active turn", async () => {
  const sandbox = await temporary();
  const env = { SIDEKICK_HOME: join(sandbox, "home"), SIDEKICK_MOCK_DELAY_MS: "1000" };
  await runCli(["spawn", "mock", "slow", "--dir", sandbox, "--", "first"], { env });
  assert.equal((await runCli(["wait", "slow", "--timeout", "0.01"], { env })).code, 124);
  assert.equal((await runCli(["send", "slow", "--force", "--", "replacement"], { env })).code, 0);
  const done = await runCli(["wait", "slow", "--timeout", "5", "--json"], { env });
  assert.equal(done.code, 0);
  assert.match(JSON.parse(done.stdout).output, /replacement/u);
});
