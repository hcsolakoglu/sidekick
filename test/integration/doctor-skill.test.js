import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { runCli, temporary } from "../helpers.js";

test("doctor reports machine-readable engine support and resolution", async () => {
  const sandbox = await temporary();
  const result = await runCli(["doctor", "mock", "--json"], {
    env: { SIDEKICK_HOME: join(sandbox, "home") },
  });
  assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(typeof report.platform, "string");
  assert.deepEqual(
    report.results.map(({ engine, support, installed, resolution }) => ({
      engine,
      support,
      installed,
      resolution,
    })),
    [{ engine: "mock", support: "supported", installed: true, resolution: "direct" }],
  );
});

test("skill install writes each harness format to its supported location", async () => {
  const sandbox = await temporary();
  const env = {
    SIDEKICK_HOME: join(sandbox, "state"),
    CLAUDE_CONFIG_DIR: join(sandbox, "claude"),
    CODEX_HOME: join(sandbox, "codex"),
    DEVIN_CONFIG_DIR: join(sandbox, "devin"),
    HERMES_HOME: join(sandbox, "hermes"),
  };
  for (const harness of ["claude-code", "codex", "devin", "hermes"]) {
    const result = await runCli(["skill", "install", harness, "--json"], { env, cwd: sandbox });
    assert.equal(result.code, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.harness, harness);
    assert.ok(value.installed.length >= 1);
  }
  assert.match(
    await readFile(join(sandbox, "claude", "skills", "sidekick", "SKILL.md"), "utf8"),
    /name: sidekick/u,
  );
  assert.match(await readFile(join(sandbox, "codex", "AGENTS.md"), "utf8"), /sidekick managed/u);
  assert.match(
    await readFile(join(sandbox, ".windsurf", "rules", "sidekick.md"), "utf8"),
    /Sidekick orchestration/u,
  );
  assert.match(
    await readFile(join(sandbox, "hermes", "skills", "sidekick", "SKILL.md"), "utf8"),
    /metadata:\n {2}hermes:/u,
  );
});
