import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pidFor, runCli, temporary } from "../helpers.js";

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

test("status keeps active runs visible while bounding terminal history", async () => {
  const sandbox = await temporary();
  const env = { SIDEKICK_HOME: join(sandbox, "home"), SIDEKICK_MOCK_DELAY_MS: "10000" };
  // Adopts share one directory-discovery lock with a 10 s wait, so a burst of 25
  // processes can time out on slow runners. Adopt in small batches and require success.
  for (let start = 0; start < 25; start += 5) {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, offset) => {
        const index = start + offset;
        return runCli(
          [
            "adopt",
            "mock",
            `terminal-${String(index).padStart(2, "0")}`,
            "--session",
            `session-${index}`,
            "--dir",
            sandbox,
          ],
          { env },
        );
      }),
    );
    for (const result of results) assert.equal(result.code, 0, result.stderr);
  }
  await runCli(["spawn", "mock", "active", "--dir", sandbox, "--", "working"], { env });

  const bounded = JSON.parse((await runCli(["status", "--json"], { env })).stdout);
  assert.equal(bounded.total, 26);
  assert.equal(bounded.shown, 21);
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.runs.some((run) => run.name === "active"));

  const limited = JSON.parse((await runCli(["status", "--limit", "3", "--json"], { env })).stdout);
  assert.equal(limited.shown, 4);
  assert.equal(limited.runs[0].name, "active");

  const runningOnly = JSON.parse(
    (await runCli(["status", "--limit", "0", "--json"], { env })).stdout,
  );
  assert.equal(runningOnly.total, 26);
  assert.equal(runningOnly.shown, 1);
  assert.deepEqual(
    runningOnly.runs.map((run) => run.name),
    ["active"],
  );

  const running = JSON.parse((await runCli(["status", "--running", "--json"], { env })).stdout);
  assert.deepEqual(
    running.runs.map((run) => run.name),
    ["active"],
  );

  const complete = JSON.parse((await runCli(["status", "--all", "--json"], { env })).stdout);
  assert.equal(complete.shown, 26);
  await runCli(["cancel", "active"], { env });
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
