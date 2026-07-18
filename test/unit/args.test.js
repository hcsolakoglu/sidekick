import test from "node:test";
import assert from "node:assert/strict";
import { runCli, temporary } from "../helpers.js";

test("usage failures exit 2", async () => {
  const home = await temporary();
  const result = await runCli(["spawn"], { env: { SIDEKICK_HOME: home } });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /usage: sidekick spawn/u);
  assert.equal(result.stdout, "");
});

test("unknown options exit 2", async () => {
  const home = await temporary();
  const result = await runCli(["status", "--wat"], { env: { SIDEKICK_HOME: home } });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unknown option/u);
});
