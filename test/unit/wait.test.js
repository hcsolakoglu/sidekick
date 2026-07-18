import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { changeOrDelay } from "../../dist/commands/wait.js";

test("wait delay settles after filesystem watchers finish closing", async () => {
  const watcher = new EventEmitter();
  let closed = false;
  watcher.close = () => {
    setImmediate(() => {
      closed = true;
      watcher.emit("close");
    });
  };

  await changeOrDelay(["run"], 0, new AbortController().signal, () => watcher);
  assert.equal(closed, true);
});

test("Windows wait uses bounded polling without opening filesystem watchers", async () => {
  let watched = false;
  await changeOrDelay(
    ["run"],
    0,
    new AbortController().signal,
    () => {
      watched = true;
      throw new Error("Windows must not create a filesystem watcher");
    },
    "win32",
  );
  assert.equal(watched, false);
});
