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
