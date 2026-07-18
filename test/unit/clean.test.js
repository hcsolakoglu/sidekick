import test from "node:test";
import assert from "node:assert/strict";
import { parseDuration } from "../../dist/commands/clean.js";

test("retention durations parse deterministically", () => {
  assert.equal(parseDuration("500ms"), 500);
  assert.equal(parseDuration("30m"), 1_800_000);
  assert.equal(parseDuration("7d"), 604_800_000);
  assert.throws(() => parseDuration("forever"), /duration must look/u);
});
