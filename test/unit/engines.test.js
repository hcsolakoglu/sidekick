import test from "node:test";
import assert from "node:assert/strict";
import { codexEngine } from "../../dist/core/engines/codex.js";
import { devinEngine } from "../../dist/core/engines/devin.js";
import { claudeEngine } from "../../dist/core/engines/claude.js";
import { hermesEngine } from "../../dist/core/engines/hermes.js";
import { splitCommand } from "../../dist/core/engines/shared.js";
import { createControls } from "../../dist/core/controls.js";

const context = {
  action: "spawn",
  session: "",
  prompt: "hello",
  promptFile: "C:\\Work Files\\prompt.txt",
  outputFile: "C:\\Work Files\\last.txt",
  model: "",
  mode: "",
  delayMs: 1,
  env: {},
};

test("codex resume skips the git repo check like the initial turn", () => {
  const initial = codexEngine.build(context);
  const resumed = codexEngine.build({ ...context, action: "resume", session: "abc" });
  assert.ok(initial.args.includes("--skip-git-repo-check"));
  assert.ok(resumed.args.includes("--skip-git-repo-check"));
  assert.deepEqual(resumed.args.slice(0, 2), ["exec", "resume"]);
});

test("command override parser preserves quoted Windows paths", () => {
  assert.deepEqual(splitCommand('"C:\\Program Files\\Agent\\agent.exe" --flag'), [
    "C:\\Program Files\\Agent\\agent.exe",
    "--flag",
  ]);
});

test("engine builders use argv arrays and expected prompt transport", () => {
  const codex = codexEngine.build(context);
  assert.equal(codex.command, "codex");
  assert.equal(codex.stdin, "hello");
  assert.ok(codex.args.includes(context.outputFile));
  const devin = devinEngine.build(context);
  assert.ok(devin.args.includes(context.promptFile));
  assert.equal(devin.stdin, undefined);
  const claude = claudeEngine.build({ ...context, action: "resume", session: "session-1" });
  assert.deepEqual(claude.args.slice(-2), ["--resume", "session-1"]);
  assert.equal(claude.stdin, "hello");
  const hermes = hermesEngine.build(context);
  assert.deepEqual(hermes.args.slice(-2), ["--oneshot", "hello"]);
});

test("Claude controls emit permission and effort only through native flags", () => {
  const controls = createControls({
    engine: "claude",
    provider: "native",
    transport: "cli-subprocess",
    permission: "accept-edits",
    effort: "high",
    action: "initial",
  });
  const built = claudeEngine.build({ ...context, controls });
  assert.deepEqual(built.args.slice(0, 10), [
    "--print",
    "--output-format",
    "json",
    "--permission-mode",
    "acceptEdits",
    "--effort",
    "high",
  ]);
});

test("Codex resume applies sandbox and approval overrides through -c", () => {
  const controls = createControls({
    engine: "codex",
    sandbox: "workspace-write",
    permission: "never",
    action: "resume",
  });
  const built = codexEngine.build({
    ...context,
    action: "resume",
    session: "thread-1",
    controls,
  });
  assert.ok(built.args.includes("sandbox_mode=workspace-write"));
  assert.ok(built.args.includes("approval_policy=never"));
  assert.equal(built.args.includes("--sandbox"), false);
  assert.deepEqual(built.args.slice(-2), ["thread-1", "-"]);
});

test("Hermes emits the native per-run reasoning flag", () => {
  const controls = createControls({ engine: "hermes", effort: "high", action: "initial" });
  const built = hermesEngine.build({ ...context, controls });
  assert.deepEqual(built.args, ["--pass-session-id", "--reasoning", "high", "--oneshot", "hello"]);
});

test("Devin emits the parser-accepted smart permission", () => {
  const controls = createControls({ engine: "devin", permission: "smart", action: "initial" });
  const built = devinEngine.build({ ...context, controls });
  assert.deepEqual(built.args.slice(0, 6), [
    "--prompt-file",
    context.promptFile,
    "--model",
    "glm-5.2",
    "--permission-mode",
    "smart",
  ]);
});

test("engine command environment override precedes default", () => {
  const built = codexEngine.build({
    ...context,
    env: { SIDEKICK_ENGINE_CODEX_CMD: '"C:\\Tools\\codex.exe" wrapper' },
  });
  assert.equal(built.command, "C:\\Tools\\codex.exe");
  assert.equal(built.args[0], "wrapper");
});
