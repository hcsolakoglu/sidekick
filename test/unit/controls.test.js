import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilityKey,
  capabilityRegistry,
  createControls,
  createLegacyControls,
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
    toolVersion: "codex-cli 0.146.0",
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
    toolVersion: "codex-cli 0.146.0",
  });
  assert.equal(permission.permission.applied?.configPath, "approval_policy");
});

test("resolveControls rejects Devin smart until version-specific evidence promotes it", () => {
  assert.throws(
    () =>
      resolveControls({
        engine: "devin",
        provider: "native",
        model: "glm-5-2",
        transport: "cli-subprocess",
        mode: "smart",
        action: "initial",
        toolVersion: "devin 3000.3.27",
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
        toolVersion: "codex-cli 0.146.0",
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
        toolVersion: "codex-cli 0.146.0",
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
    toolVersion: "2.1.221 (Claude Code)",
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
        toolVersion: "2.1.221 (Claude Code)",
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
        toolVersion: "2.1.221 (Claude Code)",
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
    toolVersion: "codex-cli 0.146.0",
  });
  assert.equal(initial.sandbox.applied?.mechanism, "cli-flag");
  assert.equal(initial.sandbox.applied?.key, "--sandbox");

  const resume = resolveControls({
    engine: "codex",
    model: "gpt-5.3-codex",
    sandbox: "workspace-write",
    action: "resume",
    toolVersion: "codex-cli 0.146.0",
  });
  assert.equal(resume.sandbox.applied?.mechanism, "config-override");
  assert.equal(resume.sandbox.applied?.configPath, "sandbox_mode");

  const adopted = resolveControls({
    engine: "devin",
    model: "glm-5-2",
    permission: "normal",
    action: "adopt",
    toolVersion: "devin 3000.3.27",
  });
  assert.equal(adopted.permission.applied?.mechanism, "none");
  assert.equal(adopted.permission.applied?.source, "adapter");
  assert.equal(adopted.model.applied?.mechanism, "none");
});

test("Devin worker defaults are recorded as adapter-applied when omitted", () => {
  const controls = resolveControls({
    engine: "devin",
    action: "initial",
    toolVersion: "devin 3000.3.27",
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
    toolVersion: "devin 3000.3.27",
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
        toolVersion: "devin 3000.3.27",
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
    toolVersion: "devin 3000.3.27",
  });
  assert.equal(adopted.permission.applied?.value, "auto");
  assert.equal(isHarnessControls(adopted), true);
  assert.equal(isHarnessControls({ ...adopted, model: [] }), false);
  assert.equal(
    isHarnessControls({ ...adopted, permission: { ...adopted.permission, applied: [] } }),
    false,
  );
});
test("model-dependent effort without verified model fails closed", () => {
  assert.throws(
    () =>
      resolveControls({
        ...base,
        engine: "codex",
        effort: "max",
        model: "unknown-model",
        toolVersion: "codex-cli 0.146.0",
      }),
    (error) => error?.exitCode === 2 && /unverified|model-dependent/iu.test(error.message),
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
    toolVersion: "devin 3000.3.27",
  });
  const parsed = JSON.parse(serializeControls(controls));
  assert.equal(parsed.permission.requested, "normal");
  assert.equal(parsed.permission.applied.value, "auto");
  assert.equal(parsed.permission.applied.key, "--permission-mode");
  assert.equal(parsed.permission.applied.configPath, undefined);
  assert.equal(parsed.permission.applied.observedValueRedacted, "auto");
  assert.equal(parsed.permission.effective, null);
});
