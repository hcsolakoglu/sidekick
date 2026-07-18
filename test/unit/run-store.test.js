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
