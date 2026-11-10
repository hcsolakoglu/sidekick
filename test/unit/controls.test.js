import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilityKey,
  capabilityRegistry,
  createControls,
  createLegacyControls,
  evidenceVersionMatches,
  hasLegacyControls,
  isHarnessControls,
  resolveControls,
  serializeControls,
} from "../../dist/core/controls.js";

const base = {
  engine: "mock",
  provider: "native",
  model: "",
  transport: "cli-subprocess",
  action: "initial",
};

test("createControls keeps requested, applied, and effective observations separate", () => {
  const controls = createControls({ ...base, mode: "" });
  assert.equal(controls.model.requested, null);
  assert.equal(controls.model.applied, null);
  assert.equal(controls.model.effective, null);
  assert.equal(controls.model.status, "unknown");
  assert.equal(controls.permission.status, "unknown");
});

test("resolveControls maps Codex legacy workspace mode to a native applied observation", () => {
  const controls = resolveControls({
    engine: "codex",
    provider: "native",
    model: "gpt-5.3-codex",
    transport: "cli-subprocess",
    mode: "workspace-write",
    action: "initial",
    toolVersion: "codex-cli 0.167.0",
  });
  assert.equal(controls.sandbox.requested, "workspace-write");
  assert.equal(controls.sandbox.applied?.mechanism, "cli-flag");
  assert.equal(controls.sandbox.applied?.value, "workspace-write");
  assert.equal(controls.sandbox.applied?.source, "native-argv");
  assert.equal(controls.sandbox.effective, null);
  const permission = resolveControls({
    ...base,
    engine: "codex",
    model: "gpt-5.3-codex",
    permission: "never",
    action: "initial",
    toolVersion: "codex-cli 0.167.0",
  });
  assert.equal(permission.permission.applied?.configPath, "approval_policy");
});

test("Devin smart is parser-accepted for 3000.12.x but fails closed on older evidence", () => {
  const controls = resolveControls({
    engine: "devin",
    provider: "native",
    model: "glm-5-2",
    transport: "cli-subprocess",
    mode: "smart",
    action: "initial",
    toolVersion: "devin 3000.12.32",
  });
  assert.equal(controls.permission.requested, "smart");
  assert.equal(controls.permission.applied?.value, "smart");
  assert.equal(controls.permission.applied?.key, "--permission-mode");
  assert.throws(
    () =>
      resolveControls({
        engine: "devin",
        provider: "native",
        model: "glm-5-2",
        transport: "cli-subprocess",
        mode: "smart",
        action: "initial",
        toolVersion: "devin 3000.11.205",
      }),
    (error) => error?.exitCode === 2 && /unsupported|unverified|smart/iu.test(error.message),
  );
});

test("legacy Codex mode never emits an unsupported sandbox label", () => {
  assert.throws(
    () =>
      resolveControls({
        ...base,
        engine: "codex",
        model: "gpt-5.3-codex",
        mode: "high",
        action: "initial",
        toolVersion: "codex-cli 0.167.0",
      }),
    (error) => error?.exitCode === 2 && /not accepted|unsupported/iu.test(error.message),
  );
});

test("capability value sets reject unsupported explicit values", () => {
  assert.throws(
    () =>
      resolveControls({
        ...base,
        engine: "codex",
        model: "gpt-5.3-codex",
        permission: "not-a-codex-policy",
        action: "initial",
        toolVersion: "codex-cli 0.167.0",
      }),
    (error) => error?.exitCode === 2 && /not accepted|unsupported/iu.test(error.message),
  );
});

test("Claude effort validation uses exact model value sets", () => {
  const supported = resolveControls({
    ...base,
    engine: "claude",
    model: "claude-opus-4-6",
    effort: "max",
    action: "initial",
    toolVersion: "2.1.321 (Claude Code)",
  });
  assert.equal(supported.effort.applied?.value, "max");
  assert.throws(
    () =>
      resolveControls({
        ...base,
        engine: "claude",
        model: "claude-opus-4-6",
        effort: "xhigh",
        action: "initial",
        toolVersion: "2.1.321 (Claude Code)",
      }),
    (error) => error?.exitCode === 2 && /not accepted|unsupported/iu.test(error.message),
  );
  assert.throws(
    () =>
      resolveControls({
        ...base,
        engine: "claude",
        model: "unknown-model",
        effort: "high",
        action: "initial",
        toolVersion: "2.1.321 (Claude Code)",
      }),
    (error) => error?.exitCode === 2 && /unverified|model-dependent/iu.test(error.message),
  );
});

test("legacy controls are visibly provisional until worker preflight resolves them", () => {
  const controls = createLegacyControls({
    ...base,
    engine: "mock",
    model: "legacy-model",
    mode: "normal",
    action: "initial",
  });
  assert.equal(hasLegacyControls(controls), true);
  assert.equal(controls.model.applied?.source, "legacy");
  assert.equal(controls.model.status, "requested");
  assert.equal(controls.transport.requested, null);
  assert.equal(controls.transport.applied, null);
  assert.equal(isHarnessControls(controls), true);
});

test("createControls is action-aware for Codex sandbox and adopt provenance", () => {
  const initial = resolveControls({
    engine: "codex",
    model: "gpt-5.3-codex",
    sandbox: "workspace-write",
    action: "initial",
    toolVersion: "codex-cli 0.167.0",
  });
  assert.equal(initial.sandbox.applied?.mechanism, "cli-flag");
  assert.equal(initial.sandbox.applied?.key, "--sandbox");

  const resume = resolveControls({
    engine: "codex",
    model: "gpt-5.3-codex",
    sandbox: "workspace-write",
    action: "resume",
    toolVersion: "codex-cli 0.167.0",
  });
  assert.equal(resume.sandbox.applied?.mechanism, "config-override");
  assert.equal(resume.sandbox.applied?.configPath, "sandbox_mode");

  const adopted = resolveControls({
    engine: "devin",
    model: "glm-5-2",
    permission: "normal",
    action: "adopt",
    toolVersion: "devin 3000.12.32",
  });
  assert.equal(adopted.permission.applied?.mechanism, "none");
  assert.equal(adopted.permission.applied?.source, "adapter");
  assert.equal(adopted.model.applied?.mechanism, "none");
});

test("Devin worker defaults are recorded as adapter-applied when omitted", () => {
  const controls = resolveControls({
    engine: "devin",
    action: "initial",
    toolVersion: "devin 3000.12.32",
  });
  assert.equal(controls.model.requested, null);
  assert.equal(controls.model.applied?.value, "glm-5.2");
  assert.equal(controls.model.applied?.source, "adapter");
  assert.equal(controls.permission.requested, null);
  assert.equal(controls.permission.applied?.value, "auto");
  assert.equal(controls.permission.applied?.source, "adapter");
});
test("Devin permission and sandbox use the required cross-product oracle", () => {
  const autonomous = resolveControls({
    ...base,
    engine: "devin",
    model: "glm-5-2",
    permission: "autonomous",
    sandbox: true,
    action: "initial",
    toolVersion: "devin 3000.12.32",
  });
  assert.equal(autonomous.permission.applied?.value, "autonomous");
  assert.equal(autonomous.sandbox.applied?.value, true);

  assert.throws(
    () =>
      resolveControls({
        ...base,
        engine: "devin",
        model: "glm-5-2",
        permission: "normal",
        sandbox: true,
        action: "initial",
        toolVersion: "devin 3000.12.32",
      }),
    (error) => error?.exitCode === 2 && /requires permission=autonomous/iu.test(error.message),
  );
});

test("adopt has an explicit capability action and malformed controls fail closed", () => {
  const adopted = resolveControls({
    ...base,
    engine: "devin",
    model: "glm-5-2",
    mode: "normal",
    action: "adopt",
    toolVersion: "devin 3000.12.32",
  });
  assert.equal(adopted.permission.applied?.value, "auto");
  assert.equal(isHarnessControls(adopted), true);
  assert.equal(isHarnessControls({ ...adopted, model: [] }), false);
  assert.equal(
    isHarnessControls({ ...adopted, permission: { ...adopted.permission, applied: [] } }),
    false,
  );
});
test("Codex effort is value-gated for any model, not a curated model allowlist", () => {
  const gpt56 = resolveControls({
    ...base,
    engine: "codex",
    model: "gpt-5.6",
    effort: "medium",
    action: "initial",
    toolVersion: "codex-cli 0.167.0",
  });
  assert.equal(gpt56.effort.requested, "medium");
  assert.equal(gpt56.effort.applied?.configPath, "model_reasoning_effort");

  const sol = resolveControls({
    ...base,
    engine: "codex",
    model: "gpt-5.6-codex",
    effort: "high",
    action: "initial",
    toolVersion: "codex-cli 0.167.0",
  });
  assert.equal(sol.effort.applied?.value, "high");

  const maxEffort = resolveControls({
    ...base,
    engine: "codex",
    model: "gpt-5.6",
    effort: "max",
    action: "initial",
    toolVersion: "codex-cli 0.167.0",
  });
  assert.equal(maxEffort.effort.applied?.value, "max");
  assert.equal(maxEffort.effort.applied?.configPath, "model_reasoning_effort");

  assert.throws(
    () =>
      resolveControls({
        ...base,
        engine: "codex",
        effort: "ultra",
        model: "gpt-5.6",
        toolVersion: "codex-cli 0.167.0",
      }),
    (error) => error?.exitCode === 2 && /not accepted|unsupported/iu.test(error.message),
  );
});

test("capability keys are versioned and registry keys are unique", () => {
  const keys = capabilityRegistry.map((entry) => capabilityKey(entry));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes("mock|native||cli-subprocess|simulated|model|initial"));
  assert.ok(keys.every((key) => key.split("|").length === 7));
});

test("controls JSON round-trip preserves provenance fields", () => {
  const controls = resolveControls({
    engine: "devin",
    provider: "native",
    model: "glm-5-2",
    transport: "cli-subprocess",
    mode: "normal",
    action: "initial",
    toolVersion: "devin 3000.12.32",
  });
  const parsed = JSON.parse(serializeControls(controls));
  assert.equal(parsed.permission.requested, "normal");
  assert.equal(parsed.permission.applied.value, "auto");
  assert.equal(parsed.permission.applied.key, "--permission-mode");
  assert.equal(parsed.permission.applied.configPath, undefined);
  assert.equal(parsed.permission.applied.observedValueRedacted, "auto");
  assert.equal(parsed.permission.effective, null);
});

test("evidence covers patch releases of self-updating engines but nothing else", () => {
  assert.equal(evidenceVersionMatches("devin", "devin 3000.11.92", "devin 3000.11.205"), true);
  assert.equal(evidenceVersionMatches("devin", "devin 3000.11.92", "devin 3000.12.1"), false);
  assert.equal(evidenceVersionMatches("codex", "codex-cli 0.164.0", "codex-cli 0.164.4"), true);
  assert.equal(evidenceVersionMatches("codex", "codex-cli 0.164.0", "codex-cli 0.165.0"), false);
  assert.equal(
    evidenceVersionMatches("commandcode", "commandcode 1.88.5", "commandcode 1.88.9"),
    true,
  );
  assert.equal(
    evidenceVersionMatches("commandcode", "commandcode 1.88.5", "commandcode 1.89.0"),
    false,
  );
  // Pre-releases, unknown versions, and two-part versions fail closed.
  assert.equal(
    evidenceVersionMatches("codex", "codex-cli 0.164.0", "codex-cli 0.164.1-alpha.1"),
    false,
  );
  assert.equal(evidenceVersionMatches("codex", "codex-cli 0.164.0", "unverified"), false);
  assert.equal(evidenceVersionMatches("devin", "devin 3000.11", "devin 3000.12"), false);
  // Claude and Hermes keep exact matching.
  assert.equal(
    evidenceVersionMatches("claude", "2.1.221 (Claude Code)", "2.1.222 (Claude Code)"),
    false,
  );
  assert.equal(
    evidenceVersionMatches("claude", "2.1.221 (Claude Code)", "2.1.221 (Claude Code)"),
    true,
  );
});

test("a patch-newer Devin or Codex runtime keeps explicit controls verified", () => {
  const devin = resolveControls({
    ...base,
    engine: "devin",
    model: "swe-2-high",
    toolVersion: "devin 3000.12.99",
    workspaceTrust: false,
  });
  assert.equal(devin.workspaceTrust.applied.value, false);
  const codex = resolveControls({
    ...base,
    engine: "codex",
    toolVersion: "codex-cli 0.167.7",
    effort: "high",
    sandbox: "workspace-write",
  });
  assert.equal(codex.effort.applied.value, "high");
  assert.throws(
    () =>
      resolveControls({
        ...base,
        engine: "codex",
        toolVersion: "codex-cli 0.168.0",
        effort: "high",
      }),
    /unverified/u,
  );
});

test("Hermes reasoning is a native per-run effort control for 0.22.5", () => {
  const controls = resolveControls({
    ...base,
    engine: "hermes",
    effort: "ultra",
    action: "initial",
    toolVersion: "Hermes Agent v0.22.5",
  });
  assert.equal(controls.effort.applied?.mechanism, "cli-flag");
  assert.equal(controls.effort.applied?.value, "ultra");
  assert.equal(controls.effort.applied?.key, "--reasoning");
  assert.throws(
    () =>
      resolveControls({
        ...base,
        engine: "hermes",
        effort: "ultra",
        action: "initial",
        toolVersion: "Hermes Agent v0.19.0",
      }),
    (error) => error?.exitCode === 2 && /unverified|unsupported/iu.test(error.message),
  );
  assert.throws(
    () =>
      resolveControls({
        ...base,
        engine: "hermes",
        effort: "turbo",
        action: "initial",
        toolVersion: "Hermes Agent v0.22.5",
      }),
    (error) => error?.exitCode === 2 && /not accepted|unsupported/iu.test(error.message),
  );
});
