import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { pidFor, root, runCli, temporary } from "../helpers.js";

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

test("doctor reports machine-readable engine support and resolution", async () => {
  const sandbox = await temporary();
  const result = await runCli(["doctor", "mock", "--json"], {
    env: { SIDEKICK_HOME: join(sandbox, "home") },
  });
  assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(typeof report.platform, "string");
  assert.deepEqual(
    report.results.map(({ engine, support, installed, resolution }) => ({
      engine,
      support,
      installed,
      resolution,
    })),
    [{ engine: "mock", support: "supported", installed: true, resolution: "direct" }],
  );
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

test("cancel tree-stops a turn while preserving its resumable session", async () => {
  const sandbox = await temporary();
  const env = { SIDEKICK_HOME: join(sandbox, "home"), SIDEKICK_MOCK_DELAY_MS: "20" };
  await runCli(["spawn", "mock", "cancelled", "--dir", sandbox, "--", "first"], { env });
  const first = JSON.parse(
    (await runCli(["wait", "cancelled", "--timeout", "5", "--json"], { env })).stdout,
  );
  env.SIDEKICK_MOCK_DELAY_MS = "10000";
  await runCli(["send", "cancelled", "--", "slow"], { env });
  const cancelled = await runCli(["cancel", "cancelled", "--json"], { env });
  assert.deepEqual(JSON.parse(cancelled.stdout), {
    name: "cancelled",
    status: "cancelled",
    exitCode: -1,
    session: first.session,
  });
  env.SIDEKICK_MOCK_DELAY_MS = "20";
  await runCli(["send", "cancelled", "--json", "--", "resume"], { env });
  const resumed = JSON.parse(
    (await runCli(["wait", "cancelled", "--timeout", "5", "--json"], { env })).stdout,
  );
  assert.equal(resumed.session, first.session);
  assert.match(resumed.output, /mock resume: resume/u);
});

test("spawn send adopt and clean have pure JSON output", async () => {
  const sandbox = await temporary();
  const env = { SIDEKICK_HOME: join(sandbox, "home"), SIDEKICK_MOCK_DELAY_MS: "20" };
  const spawned = JSON.parse(
    (await runCli(["spawn", "mock", "json-run", "--json", "--dir", sandbox, "--", "hi"], { env }))
      .stdout,
  );
  assert.deepEqual(spawned, { name: "json-run", engine: "mock", status: "running", run: 1 });
  await runCli(["wait", "json-run", "--timeout", "5", "--quiet"], { env });
  const sent = JSON.parse(
    (await runCli(["send", "json-run", "--json", "--", "again"], { env })).stdout,
  );
  assert.equal(sent.run, 2);
  await runCli(["wait", "json-run", "--timeout", "5", "--quiet"], { env });
  const adopted = JSON.parse(
    (
      await runCli(
        ["adopt", "mock", "json-adopt", "--session", "existing", "--dir", sandbox, "--json"],
        { env },
      )
    ).stdout,
  );
  assert.equal(adopted.session, "existing");
  const cleaned = JSON.parse(
    (await runCli(["clean", "json-run", "json-adopt", "--json"], { env })).stdout,
  );
  assert.deepEqual(cleaned.removed.sort(), ["json-adopt", "json-run"]);
});

test("engine stdout streams live and completed logs obey the size cap", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const env = {
    SIDEKICK_HOME: home,
    SIDEKICK_MOCK_DELAY_MS: "20",
    SIDEKICK_MOCK_STREAM_MS: "500",
    SIDEKICK_MOCK_OUTPUT_BYTES: "10000",
    SIDEKICK_MAX_LOG_MB: "0.001",
  };
  await runCli(["spawn", "mock", "streaming", "--dir", sandbox, "--", "hello"], { env });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.match(
    await readFile(join(home, "runs", "streaming", "out.log"), "utf8"),
    /mock progress/u,
  );
  await runCli(["wait", "streaming", "--timeout", "5", "--quiet"], { env });
  // 0.001 MB, the configured cap. Assert the real limit rather than a padded
  // one so an overshoot reports the size it actually wrote.
  const cap = Math.floor(0.001 * 1024 * 1024);
  const { size } = await stat(join(home, "runs", "streaming", "out.log"));
  assert.ok(size <= cap, `out.log is ${size} bytes, over the ${cap} byte cap`);
});

test("completion hook runs after terminal state and receives run metadata", async () => {
  const sandbox = await temporary();
  const hookOutput = join(sandbox, "hook.txt");
  const hook = `"${process.execPath}" "${join(root, "test", "fixtures", "hook.js")}" "${hookOutput}"`;
  const env = { SIDEKICK_HOME: join(sandbox, "home"), SIDEKICK_MOCK_DELAY_MS: "20" };
  await runCli(
    ["spawn", "mock", "hooked", "--on-complete", hook, "--dir", sandbox, "--", "hello"],
    { env },
  );
  await runCli(["wait", "hooked", "--timeout", "5", "--quiet"], { env });
  for (let index = 0; index < 20; index += 1) {
    const value = await readFile(hookOutput, "utf8").catch(() => "");
    if (value) {
      assert.equal(value, "hooked:done:0\n");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("completion hook did not run");
});

test("per-engine concurrency caps reject excess starts", async () => {
  const sandbox = await temporary();
  const env = {
    SIDEKICK_HOME: join(sandbox, "home"),
    SIDEKICK_MOCK_DELAY_MS: "10000",
    SIDEKICK_MAX_CONCURRENT_MOCK: "1",
  };
  await runCli(["spawn", "mock", "only", "--dir", sandbox, "--", "one"], { env });
  const excess = await runCli(["spawn", "mock", "excess", "--dir", sandbox, "--", "two"], { env });
  assert.equal(excess.code, 1);
  assert.match(excess.stderr, /concurrency limit reached/u);
  await runCli(["cancel", "only"], { env });
});

test("clean retention keeps the newest terminal runs", async () => {
  const sandbox = await temporary();
  const env = { SIDEKICK_HOME: join(sandbox, "home") };
  await runCli(["adopt", "mock", "old", "--session", "one", "--dir", sandbox], { env });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await runCli(["adopt", "mock", "new", "--session", "two", "--dir", sandbox], { env });
  const cleaned = JSON.parse(
    (await runCli(["clean", "--keep-last", "1", "--older-than", "0ms", "--json"], { env })).stdout,
  );
  assert.deepEqual(cleaned.removed, ["old"]);
  assert.deepEqual(cleaned.kept, ["new"]);
});

test("skill install writes each harness format to its supported location", async () => {
  const sandbox = await temporary();
  const env = {
    SIDEKICK_HOME: join(sandbox, "state"),
    CLAUDE_CONFIG_DIR: join(sandbox, "claude"),
    CODEX_HOME: join(sandbox, "codex"),
    DEVIN_CONFIG_DIR: join(sandbox, "devin"),
    HERMES_HOME: join(sandbox, "hermes"),
  };
  for (const harness of ["claude-code", "codex", "devin", "hermes"]) {
    const result = await runCli(["skill", "install", harness, "--json"], { env, cwd: sandbox });
    assert.equal(result.code, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.harness, harness);
    assert.ok(value.installed.length >= 1);
  }
  assert.match(
    await readFile(join(sandbox, "claude", "skills", "sidekick", "SKILL.md"), "utf8"),
    /name: sidekick/u,
  );
  assert.match(await readFile(join(sandbox, "codex", "AGENTS.md"), "utf8"), /sidekick managed/u);
  assert.match(
    await readFile(join(sandbox, ".windsurf", "rules", "sidekick.md"), "utf8"),
    /Sidekick orchestration/u,
  );
  assert.match(
    await readFile(join(sandbox, "hermes", "skills", "sidekick", "SKILL.md"), "utf8"),
    /metadata:\n {2}hermes:/u,
  );
});
