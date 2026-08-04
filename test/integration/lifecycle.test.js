import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { pidFor, root, runCli, temporary } from "../helpers.js";

async function waitForFileMatch(path, pattern, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await readFile(path, "utf8").catch(() => "");
    if (pattern.test(value)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.match(await readFile(path, "utf8").catch(() => ""), pattern);
}

async function writeLegacyRun(home, name, status = "done") {
  const base = join(home, "runs", name);
  await mkdir(join(base, "run-1"), { recursive: true });
  const files = {
    engine: "mock\n",
    dir: `${home}\n`,
    active_run: "1\n",
    status: `${status}\n`,
    exit: "0\n",
    session: "legacy-session\n",
    mode: "normal\n",
    model: "legacy-model\n",
    prompt: "legacy prompt\n",
    "out.log": "legacy output\n",
  };
  for (const [file, value] of Object.entries(files)) await writeFile(join(base, file), value);
  await writeFile(join(base, "run-1", "prompt"), "legacy prompt\n");
  await writeFile(join(base, "run-1", "out.log"), "legacy output\n");
  await writeFile(join(base, "run-1", "status"), `${status}\n`);
  await writeFile(join(base, "run-1", "exit"), "0\n");
  return base;
}

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

test("invalid control preflight leaves a fresh home untouched", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const result = await runCli(
    ["spawn", "devin", "invalid-control", "--mode", "smart", "--dir", sandbox, "--", "probe"],
    { env: { SIDEKICK_HOME: home } },
  );
  assert.equal(result.code, 2);
  await assert.rejects(stat(home), { code: "ENOENT" });
});

test("wait --all reports every selected run", async () => {
  const sandbox = await temporary();
  const env = { SIDEKICK_HOME: join(sandbox, "home"), SIDEKICK_MOCK_DELAY_MS: "2000" };
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

test("status, clean, and wait apply engine and canonical directory filters", async () => {
  const sandbox = await temporary();
  const other = join(sandbox, "other");
  await mkdir(other, { recursive: true });
  const env = { SIDEKICK_HOME: join(sandbox, "home"), SIDEKICK_MOCK_DELAY_MS: "3000" };
  await runCli(["adopt", "mock", "same-dir", "--session", "same", "--dir", sandbox], { env });
  await runCli(["adopt", "mock", "other-dir", "--session", "other", "--dir", other], { env });
  await runCli(["spawn", "mock", "active-filter", "--dir", sandbox, "--", "work"], { env });

  const filtered = JSON.parse(
    (await runCli(["status", "--all", "--engine", "mock", "--dir", sandbox, "--json"], { env }))
      .stdout,
  );
  assert.deepEqual(filtered.runs.map(({ name }) => name).sort(), ["active-filter", "same-dir"]);
  assert.deepEqual(filtered.filters, { engine: "mock", directory: sandbox });

  const positionalFilter = await runCli(
    ["wait", "same-dir", "--engine", "mock", "--timeout", "1"],
    { env },
  );
  assert.equal(positionalFilter.code, 2);
  const cleaned = JSON.parse(
    (await runCli(["clean", "--engine", "mock", "--dir", sandbox, "--json"], { env })).stdout,
  );
  assert.deepEqual(cleaned.removed, ["same-dir"]);
  assert.deepEqual(cleaned.skippedRunning, ["active-filter"]);
  assert.deepEqual(cleaned.filters, { engine: "mock", directory: sandbox });
  await runCli(
    ["wait", "--all", "--engine", "mock", "--dir", sandbox, "--timeout", "5", "--quiet"],
    { env },
  );
  const remaining = JSON.parse((await runCli(["status", "--all", "--json"], { env })).stdout);
  assert.deepEqual(remaining.runs.map(({ name }) => name).sort(), ["active-filter", "other-dir"]);
});

test("status keeps active runs visible while bounding terminal history", async () => {
  const sandbox = await temporary();
  const env = { SIDEKICK_HOME: join(sandbox, "home"), SIDEKICK_MOCK_DELAY_MS: "10000" };
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      runCli(
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
      ),
    ),
  );
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

test("clean removes terminal runs and skips active runs", async () => {
  const sandbox = await temporary();
  const env = { SIDEKICK_HOME: join(sandbox, "home"), SIDEKICK_MOCK_DELAY_MS: "10000" };
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
  env.SIDEKICK_MOCK_DELAY_MS = "20";
  await runCli(["send", "active", "--force", "--", "finish"], { env });
  await runCli(["wait", "active", "--timeout", "5", "--quiet"], { env });
  assert.equal((await runCli(["clean", "active"], { env })).stdout, "removed 1\n");
});

test("clean dry-run is non-destructive and surfaces legacy state", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const env = { SIDEKICK_HOME: home };
  await runCli(["adopt", "mock", "finished", "--session", "done-1", "--dir", sandbox], { env });
  const legacy = join(home, "runs", "legacy-only");
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "engine"), "mock\n");
  await writeFile(join(legacy, "status"), "done\n");

  const planned = await runCli(["clean", "--dry-run", "--json"], { env });
  assert.equal(planned.code, 0);
  const plan = JSON.parse(planned.stdout);
  assert.deepEqual(plan.removed, []);
  assert.deepEqual(plan.wouldRemove, ["finished"]);
  assert.deepEqual(plan.skipped, [{ name: "legacy-only", reason: "no-meta", engine: "mock" }]);
  assert.match(planned.stderr, /unreadable or legacy/u);
  assert.match(await readFile(join(home, "runs", "finished", "meta.json"), "utf8"), /finished/u);
  assert.match(await readFile(join(legacy, "status"), "utf8"), /done/u);
});

test("migrate previews and atomically converts legacy state idempotently", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const env = { SIDEKICK_HOME: home };
  const legacy = await writeLegacyRun(home, "legacy-convert");

  const planned = await runCli(["migrate", "--dry-run", "--json"], { env });
  assert.equal(planned.code, 0);
  assert.deepEqual(JSON.parse(planned.stdout), {
    migrated: [],
    wouldMigrate: ["legacy-convert"],
    quarantined: [],
    wouldQuarantine: [],
    restored: [],
    wouldRestore: [],
    skipped: [],
    errors: [],
  });
  await assert.rejects(readFile(join(legacy, "meta.json")));

  const applied = await runCli(["migrate", "--apply", "--json"], { env });
  assert.equal(applied.code, 0, applied.stderr);
  assert.deepEqual(JSON.parse(applied.stdout).migrated, ["legacy-convert"]);
  const record = JSON.parse((await runCli(["status", "--all", "--json"], { env })).stdout).runs[0];
  const metadata = JSON.parse(await readFile(join(legacy, "meta.json"), "utf8"));
  assert.deepEqual(
    {
      name: record.name,
      engine: record.engine,
      status: record.status,
      exitCode: record.exitCode,
      run: record.run,
      session: record.session,
      model: metadata.model,
      mode: metadata.mode,
    },
    {
      name: "legacy-convert",
      engine: "mock",
      status: "done",
      exitCode: 0,
      run: 1,
      session: "legacy-session",
      model: "legacy-model",
      mode: "normal",
    },
  );
  assert.match(await readFile(join(legacy, "status"), "utf8"), /^done\n$/u);
  assert.match(await readFile(join(legacy, "session"), "utf8"), /^legacy-session\n$/u);

  const repeated = await runCli(["migrate", "legacy-convert", "--apply", "--json"], { env });
  assert.equal(repeated.code, 0);
  assert.deepEqual(JSON.parse(repeated.stdout), {
    migrated: [],
    wouldMigrate: [],
    quarantined: [],
    wouldQuarantine: [],
    restored: [],
    wouldRestore: [],
    skipped: [{ name: "legacy-convert", reason: "not-legacy" }],
    errors: [],
  });
});

test("migrated legacy runs preserve controls through send fallback", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const env = { SIDEKICK_HOME: home, SIDEKICK_MOCK_DELAY_MS: "25" };
  await writeLegacyRun(home, "legacy-send");

  const migrated = await runCli(["migrate", "legacy-send", "--apply", "--json"], { env });
  assert.equal(migrated.code, 0);
  const meta = JSON.parse(await readFile(join(home, "runs", "legacy-send", "meta.json"), "utf8"));
  assert.equal(meta.controls.model.applied.source, "legacy");
  assert.equal(meta.controls.model.status, "requested");
  assert.equal(meta.controls.transport.requested, null);

  await runCli(["send", "legacy-send", "--", "continue"], { env });
  const result = JSON.parse(
    (await runCli(["wait", "legacy-send", "--timeout", "5", "--json"], { env })).stdout,
  );
  assert.equal(result.status, "done");
  assert.equal(result.session, "legacy-session");
  assert.equal(result.output, "mock resume: continue\n");

  const migratedMeta = JSON.parse(
    await readFile(join(home, "runs", "legacy-send", "meta.json"), "utf8"),
  );
  assert.equal(migratedMeta.controls.transport.requested, "cli-subprocess");
  assert.equal(migratedMeta.controls.transport.applied.source, "adapter");
  assert.equal(migratedMeta.controls.transport.status, "applied");
  assert.notEqual(migratedMeta.controls.model.applied?.source, "legacy");
});

test("migrate quarantines unsupported legacy state but never moves running state", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const env = { SIDEKICK_HOME: home };
  const unsupported = await writeLegacyRun(home, "legacy-unsupported", "paused");
  const running = await writeLegacyRun(home, "legacy-running", "running");

  const planned = await runCli(["migrate", "--quarantine", "--json"], { env });
  assert.equal(planned.code, 0);
  const plan = JSON.parse(planned.stdout);
  assert.deepEqual(plan.wouldMigrate, []);
  assert.deepEqual(
    plan.wouldQuarantine.map(({ name }) => name),
    ["legacy-unsupported"],
  );
  assert.deepEqual(plan.skipped, [{ name: "legacy-running", reason: "running" }]);
  assert.match(plan.quarantineRoot, /legacy-quarantine/u);
  assert.match(await readFile(join(unsupported, "status"), "utf8"), /^paused\n$/u);

  const applied = await runCli(["migrate", "--apply", "--quarantine", "--json"], { env });
  assert.equal(applied.code, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.deepEqual(
    result.quarantined.map(({ name }) => name),
    ["legacy-unsupported"],
  );
  assert.deepEqual(result.skipped, [{ name: "legacy-running", reason: "running" }]);
  await assert.rejects(readFile(join(home, "runs", "legacy-unsupported", "status")));
  assert.match(await readFile(join(result.quarantined[0].path, "status"), "utf8"), /^paused\n$/u);
  assert.match(await readFile(join(running, "status"), "utf8"), /^running\n$/u);

  const restorePlan = await runCli(["migrate", "legacy-unsupported", "--restore", "--json"], {
    env,
  });
  assert.equal(restorePlan.code, 0);
  assert.deepEqual(JSON.parse(restorePlan.stdout).wouldRestore, ["legacy-unsupported"]);
  const restored = await runCli(
    ["migrate", "legacy-unsupported", "--restore", "--apply", "--json"],
    { env },
  );
  assert.equal(restored.code, 0, restored.stderr);
  assert.deepEqual(JSON.parse(restored.stdout).restored, ["legacy-unsupported"]);
  assert.match(
    await readFile(join(home, "runs", "legacy-unsupported", "status"), "utf8"),
    /^paused\n$/u,
  );
});

test("migrate skips invalid names and quarantines stale running state", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const env = { SIDEKICK_HOME: home };
  const invalid = await writeLegacyRun(home, "legacy invalid", "paused");
  const stale = await writeLegacyRun(home, "legacy-stale", "running");
  await writeFile(join(stale, "pid"), "2147483647\n");

  const applied = await runCli(["migrate", "--apply", "--quarantine", "--json"], { env });
  assert.equal(applied.code, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.deepEqual(
    result.quarantined.map(({ name }) => name),
    ["legacy-stale"],
  );
  assert.deepEqual(result.skipped, [{ name: "legacy invalid", reason: "invalid-name" }]);
  assert.match(await readFile(join(invalid, "status"), "utf8"), /^paused\n$/u);
  assert.match(await readFile(join(result.quarantined[0].path, "status"), "utf8"), /^running\n$/u);
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
  const home = join(sandbox, "home");
  const env = { SIDEKICK_HOME: home, SIDEKICK_MOCK_DELAY_MS: "1000" };
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
  assert.deepEqual(
    { name: spawned.name, engine: spawned.engine, status: spawned.status, run: spawned.run },
    { name: "json-run", engine: "mock", status: "running", run: 1 },
  );
  assert.equal(spawned.controls.transport.requested, "cli-subprocess");
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
  await waitForFileMatch(join(home, "runs", "streaming", "out.log"), /mock progress/u);
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
