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

test("engine command environment override precedes default", () => {
  const built = codexEngine.build({
    ...context,
    env: { SIDEKICK_ENGINE_CODEX_CMD: '"C:\\Tools\\codex.exe" wrapper' },
  });
  assert.equal(built.command, "C:\\Tools\\codex.exe");
  assert.equal(built.args[0], "wrapper");
});
