import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readdir, unlink, utimes, writeFile } from "node:fs/promises";
import { RunStore, validateName } from "../../dist/core/run-store.js";
import { refresh } from "../../dist/core/run-service.js";
import { temporary } from "../helpers.js";

test("atomic writes never leave temporary files", async () => {
  const root = await temporary();
  const store = new RunStore(root);
  await store.initialize();
  const target = join(root, "value");
  await Promise.all(
    Array.from({ length: 20 }, (_, index) => store.atomicWrite(target, `value-${index}\n`)),
  );
  assert.match(await store.readText(target), /^value-\d+\n$/u);
  assert.deepEqual(
    (await readdir(root)).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("reaps stale empty legacy lock files", async () => {
  const root = await temporary();
  const store = new RunStore(root);
  await store.initialize();
  const lock = join(root, "locks", "run-legacy.lock");
  await writeFile(lock, "");
  await utimes(lock, new Date(0), new Date(0));
  let called = false;
  await store.withLock("legacy", async () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal((await readdir(join(root, "locks"))).includes("run-legacy.lock"), false);
});

test("reaps dead-pid legacy lock files without waiting for mtime", async () => {
  const root = await temporary();
  const store = new RunStore(root);
  await store.initialize();
  const lock = join(root, "locks", "run-dead-pid.lock");
  await writeFile(lock, "2147483647\n");
  const started = Date.now();
  await store.withLock("dead-pid", async () => undefined);
  assert.ok(Date.now() - started < 1_000);
});

test("name validation prevents traversal", () => {
  assert.doesNotThrow(() => validateName("worker-1.ok"));
  assert.throws(() => validateName("../escape"), /name must match/u);
});

test("a superseded turn records itself without publishing run state", async () => {
  const root = await temporary();
  const store = new RunStore(root);
  await store.initialize();
  await store.create(
    { name: "one", engine: "mock", directory: root, model: "", mode: "" },
    "first",
  );
  const stale = store.turnPath("one", 1);
  await store.initializeTurn("one", 2, "second", "");

  // The worker killed by --force finishes late and reports its own failure.
  await store.complete("one", stale, 3221226505, "", "killed output\n", "cancelled");

  const record = await store.read("one");
  assert.equal(record.status, "running", "replacement turn must stay active");
  assert.notEqual(record.output, "killed output\n");
  assert.equal(await store.readText(join(stale, "exit")), "3221226505\n");
});

test("run metadata and turn state round-trip", async () => {
  const root = await temporary();
  const store = new RunStore(root);
  await store.initialize();
  await store.create(
    { name: "one", engine: "mock", directory: root, model: "", mode: "" },
    "hello",
  );
  const record = await store.read("one");
  assert.equal(record.meta.schemaVersion, 1);
  assert.equal(record.status, "running");
  assert.equal(record.meta.activeRun, 1);
});

test("summary scans avoid output logs and report legacy or corrupt state", async () => {
  const root = await temporary();
  const store = new RunStore(root);
  await store.initialize();
  await store.create(
    { name: "readable", engine: "mock", directory: root, model: "", mode: "" },
    "hello",
  );
  await store.complete(
    "readable",
    store.turnPath("readable", 1),
    0,
    "mock-session",
    "large output\n",
  );
  await store.create(
    { name: "missing-status", engine: "mock", directory: root, model: "", mode: "" },
    "hello",
  );
  await unlink(join(root, "runs", "missing-status", "status"));
  await mkdir(join(root, "runs", "legacy"), { recursive: true });
  await writeFile(join(root, "runs", "legacy", "engine"), "mock\n");
  await writeFile(join(root, "runs", "legacy", "status"), "done\n");
  await mkdir(join(root, "runs", "corrupt"), { recursive: true });
  await writeFile(join(root, "runs", "corrupt", "meta.json"), "{not-json\n");
  await mkdir(join(root, "runs", "malformed"), { recursive: true });
  await writeFile(join(root, "runs", "malformed", "meta.json"), "{}\n");
  await writeFile(join(root, "runs", "not-a-directory"), "ignore\n");
  await mkdir(join(root, "runs", "bad name"), { recursive: true });

  const scan = await store.scanSummaries();
  assert.equal(scan.records[0]?.output, "");
  assert.deepEqual(
    scan.skipped.sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: "bad name", reason: "unreadable" },
      { name: "corrupt", reason: "corrupt-meta" },
      { name: "legacy", reason: "no-meta", engine: "mock" },
      { name: "malformed", reason: "corrupt-meta" },
      { name: "missing-status", reason: "unreadable", engine: "mock", directory: root },
    ],
  );
  assert.equal((await store.read("readable")).output, "large output\n");
});

test("dead-worker repair cannot overwrite a completion published under the run lock", async () => {
  const root = await temporary();
  const store = new RunStore(root);
  await store.initialize();
  await store.create(
    { name: "race", engine: "mock", directory: root, model: "", mode: "" },
    "first",
  );
  const record = await store.read("race");
  let probeCount = 0;
  let workerCompletion = Promise.resolve();
  const identityMatches = async () => {
    probeCount += 1;
    if (probeCount === 2) {
      workerCompletion = store.withLock("race", () =>
        store.complete("race", store.turnPath("race", 1), 0, "mock-session", "done\n", "done"),
      );
    }
    return false;
  };

  await refresh(store, record, identityMatches);
  await workerCompletion;
  assert.equal((await store.read("race")).status, "done");
});
