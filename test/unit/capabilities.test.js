import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const cli = join(root, "bin", "sidekick.js");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, SIDEKICK_HOME: join(root, ".tmp-capabilities-test") },
  });
}

test("capabilities returns versioned pure JSON for a selected engine", () => {
  const output = execFileSync(process.execPath, [cli, "capabilities", "mock", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  const value = JSON.parse(output);
  assert.equal(value.schemaVersion, 1);
  assert.deepEqual(value.selectedEngines, ["mock"]);
  assert.ok(
    value.capabilities.every((entry) =>
      ["native", "unsupported", "simulated", "unverified"].includes(entry.support),
    ),
  );
  assert.ok(
    value.capabilities.every((entry) => entry.observation && "requested" in entry.observation),
  );
});

test("capabilities rejects unknown engine without partial stdout", () => {
  const result = run(["capabilities", "unknown", "--json"]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /unknown engine/iu);
});

test("capabilities resolves exact Claude model effort value sets", () => {
  const result = run(["capabilities", "claude", "--model", "claude-opus-4-6", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  const effortEntries = value.capabilities.filter(
    (entry) => entry.axis === "effort" && entry.model === "claude-opus-4-6",
  );
  assert.equal(effortEntries.length, 4);
  assert.ok(effortEntries.every((entry) => !entry.values.includes("xhigh")));
  assert.equal(
    value.capabilities.some((entry) => entry.model === "*" && entry.axis === "effort"),
    false,
  );
});

test("capabilities scopes model-dependent gates per engine", () => {
  const single = run(["capabilities", "codex", "--model", "claude-opus-4-7", "--json"]);
  assert.equal(single.status, 2);
  assert.equal(single.stdout, "");
  assert.match(single.stderr, /model-dependent|unverified/iu);

  const multi = run(["capabilities", "claude", "codex", "--model", "claude-opus-4-7", "--json"]);
  assert.equal(multi.status, 2);
  assert.equal(multi.stdout, "");
  assert.match(multi.stderr, /codex\/effort|model-dependent/iu);

  const verified = run(["capabilities", "codex", "--model", "gpt-5.3-codex", "--json"]);
  assert.equal(verified.status, 0, verified.stderr);
  const value = JSON.parse(verified.stdout);
  assert.ok(
    value.capabilities.some(
      (entry) => entry.engine === "codex" && entry.axis === "effort" && entry.modelDependent,
    ),
  );
});
