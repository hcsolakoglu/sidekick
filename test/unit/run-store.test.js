import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { RunStore, validateName } from "../../dist/core/run-store.js";
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
