import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runCli, temporary } from "../helpers.js";

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
