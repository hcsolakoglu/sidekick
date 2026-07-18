import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { runCli } from "../helpers.js";

test("version output snapshot", async () => {
  const result = await runCli(["--version"]);
  assert.deepEqual(
    { code: result.code, stdout: result.stdout, stderr: result.stderr },
    { code: 0, stdout: "0.1.0\n", stderr: "" },
  );
});

test("help output snapshot and fast path", async () => {
  const started = performance.now();
  const result = await runCli(["--help"]);
  const elapsed = performance.now() - started;
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^sidekick 0\.1\.0/u);
  assert.match(result.stdout, /SIDEKICK_HOME/u);
  assert.match(result.stdout, /124 wait timeout/u);
  assert.ok(elapsed < 150, `help took ${elapsed.toFixed(1)}ms`);
});
