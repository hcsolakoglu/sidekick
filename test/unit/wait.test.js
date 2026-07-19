import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { cachedIdentityMatcher, changeOrDelay } from "../../dist/commands/wait.js";

test("wait delay settles after filesystem watchers finish closing", async () => {
  const watcher = new EventEmitter();
  let closed = false;
  watcher.close = () => {
    setImmediate(() => {
      closed = true;
      watcher.emit("close");
    });
  };

  await changeOrDelay(["run"], 0, new AbortController().signal, () => watcher, "linux");
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
      throw new Error("Windows polling must not open a watcher");
    },
    "win32",
  );
  assert.equal(watched, false);
});

test("wait briefly reuses a live process identity verification", async () => {
  let currentTime = 1000;
  let queries = 0;
  let alive = true;
  const matches = async () => {
    queries += 1;
    return true;
  };
  const cached = cachedIdentityMatcher(
    250,
    matches,
    () => alive,
    () => currentTime,
    "win32",
  );

  assert.equal(await cached(42, "win32|token|created"), true);
  assert.equal(await cached(42, "win32|token|created"), true);
  assert.equal(queries, 1);

  currentTime += 250;
  assert.equal(await cached(42, "win32|token|created"), true);
  assert.equal(queries, 2);

  alive = false;
  assert.equal(await cached(42, "win32|token|created"), false);
  assert.equal(queries, 2);
});
