import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { runCli, temporary } from "../helpers.js";

test("version output snapshot", async () => {
  const result = await runCli(["--version"]);
  assert.deepEqual(
    { code: result.code, stdout: result.stdout, stderr: result.stderr },
    { code: 0, stdout: "0.1.0\n", stderr: "" },
  );
});

test("help output snapshot and fast path", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "uninitialized-home");
  const result = await runCli(["--help"], { env: { SIDEKICK_HOME: home } });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^sidekick 0\.1\.0/u);
  assert.match(result.stdout, /SIDEKICK_HOME/u);
  assert.match(result.stdout, /124 wait timeout/u);
  await assert.rejects(access(home), { code: "ENOENT" });
});
