import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runCli, temporary } from "../helpers.js";

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
