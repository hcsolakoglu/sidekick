import assert from "node:assert/strict";
import test from "node:test";
import {
  commandcodeEngine,
  PERMISSION_DENIED_EXIT_CODE,
} from "../../dist/core/engines/commandcode.js";
import {
  capabilityRegistry,
  createControls,
  evidenceVersionMatches,
  isHarnessControls,
  reprojectControls,
  resolveControls,
} from "../../dist/core/controls.js";

const version = "commandcode 1.88.5";
const context = {
  action: "spawn",
  session: "",
  prompt: "hello",
  promptFile: "/tmp/prompt",
  outputFile: "/tmp/last.txt",
  model: "",
  mode: "",
  delayMs: 1,
  env: {},
};

function controlsFor(extra = {}) {
  return resolveControls({
    engine: "commandcode",
    model: "deepseek/deepseek-v4.1-flash",
    action: "initial",
    toolVersion: version,
    ...extra,
  });
}

function ndjson(...values) {
  return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

test("Command Code spawn argv carries the headless profile and native controls", () => {
  const controls = controlsFor({
    effort: "low",
    permission: "yolo",
    maxTurns: "12",
    toolsAll: true,
    addDirs: ["/work/a", "/work/b"],
  });
  const built = commandcodeEngine.build({
    ...context,
    controls,
    addDirs: ["/work/a", "/work/b"],
  });
  assert.equal(built.command, "commandcode");
  assert.equal(built.stdin, undefined);
  assert.deepEqual(built.args, [
    "--print=hello",
    "--output-format",
    "json",
    "--model",
    "deepseek/deepseek-v4.1-flash",
    "--effort",
    "low",
    "--yolo",
    "--max-turns",
    "12",
    "--tools-all",
    "--add-dir",
    "/work/a",
    "--add-dir",
    "/work/b",
    "--trust",
    "--skip-onboarding",
    "--no-auto-update",
  ]);
});

test("Command Code resume uses --resume and non-yolo permission modes stay native", () => {
  const controls = controlsFor({ permission: "plan" });
  const built = commandcodeEngine.build({
    ...context,
    action: "resume",
    session: "session-1",
    controls,
  });
  assert.deepEqual(built.args.slice(0, 4), [
    "--print=hello",
    "--output-format",
    "json",
    "--resume",
  ]);
  assert.equal(built.args[4], "session-1");
  assert.ok(built.args.includes("--permission-mode"));
  assert.equal(built.args[built.args.indexOf("--permission-mode") + 1], "plan");
  assert.ok(!built.args.includes("--yolo"));
});

test("Command Code omits tools-all and add-dir when they were not requested", () => {
  const built = commandcodeEngine.build({ ...context, controls: controlsFor() });
  assert.ok(!built.args.includes("--tools-all"));
  assert.ok(!built.args.includes("--add-dir"));
  assert.equal(built.args[built.args.indexOf("--model") + 1], "deepseek/deepseek-v4.1-flash");
  assert.ok(!built.args.includes("--effort"));
  assert.ok(!built.args.includes("--yolo"));
});

test("Command Code command override precedes the default executable", () => {
  const built = commandcodeEngine.build({
    ...context,
    controls: controlsFor(),
    env: { SIDEKICK_ENGINE_COMMANDCODE_CMD: '"C:\\Tools\\commandcode.exe" wrapper' },
  });
  assert.equal(built.command, "C:\\Tools\\commandcode.exe");
  assert.equal(built.args[0], "wrapper");
});

test("Command Code parses NDJSON sessions and final text", () => {
  const stdout = ndjson(
    { type: "event", event: { type: "run_start", sessionId: "session-1" } },
    {
      type: "event",
      event: {
        type: "run_end",
        result: {
          finalText: "OK",
          stopReason: "end_turn",
          nextState: { sessionId: "session-1" },
        },
      },
    },
    {
      type: "result",
      subtype: "success",
      sessionId: "session-1",
      stopReason: "end_turn",
      finalText: "OK",
    },
  );
  const parsed = commandcodeEngine.parse(stdout, context);
  assert.equal(parsed.session, "session-1");
  assert.equal(parsed.output, "OK");
  assert.equal(parsed.exitCode, undefined);
});

test("Command Code falls back to run_end nextState when the result line omits the session", () => {
  const stdout = ndjson({
    type: "event",
    event: {
      type: "run_end",
      result: { finalText: "done", stopReason: "end_turn", nextState: { sessionId: "from-state" } },
    },
  });
  const parsed = commandcodeEngine.parse(stdout, context);
  assert.equal(parsed.session, "from-state");
  assert.equal(parsed.output, "done");
});

test("Command Code maps permission_denied to a failing run without leaking the prompt", () => {
  const stdout = ndjson(
    { type: "event", event: { type: "run_start", sessionId: "session-1" } },
    {
      type: "event",
      event: {
        type: "tool_queued",
        toolCallId: "call-1",
        toolName: "shell_command",
        input: { command: "rm -r ./build" },
      },
    },
    {
      type: "event",
      event: { type: "tool_denied", toolCallId: "call-1", toolName: "shell_command" },
    },
    {
      type: "event",
      event: {
        type: "run_end",
        result: { finalText: "I could not continue.", stopReason: "permission_denied" },
      },
    },
    {
      type: "result",
      subtype: "success",
      sessionId: "session-1",
      stopReason: "permission_denied",
      finalText: "I could not continue.",
    },
  );
  const parsed = commandcodeEngine.parse(stdout, { ...context, prompt: "secret prompt text" });
  assert.equal(parsed.exitCode, PERMISSION_DENIED_EXIT_CODE);
  assert.equal(parsed.session, "session-1");
  assert.match(parsed.output, /permission_denied/u);
  assert.match(parsed.output, /shell_command/u);
  assert.match(parsed.output, /rm -r \.\/build/u);
  assert.doesNotMatch(parsed.output, /secret prompt text/u);
});

test("Command Code keeps the CLI exit for max-turns runs and explains the stop", () => {
  const stdout = ndjson({
    type: "result",
    subtype: "max_turns",
    sessionId: "session-1",
    stopReason: "max_turns",
    finalText: "partial answer",
  });
  const parsed = commandcodeEngine.parse(stdout, context);
  assert.equal(parsed.exitCode, undefined);
  assert.match(parsed.output, /max-turns/u);
  assert.match(parsed.output, /partial answer/u);
});

test("Command Code preserves non-JSON output as the result", () => {
  const parsed = commandcodeEngine.parse("not json\n", context);
  assert.equal(parsed.output, "not json\n");
  assert.equal(parsed.session, "");
});

test("Command Code does not echo an already-parsed event stream when the run has no text", () => {
  const stdout = ndjson({ type: "event", event: { type: "run_start", sessionId: "session-1" } });
  const parsed = commandcodeEngine.parse(stdout, context);
  assert.equal(parsed.output, "");
  assert.equal(parsed.session, "session-1");
});

test("Command Code effort is value-gated and model-aware evidence is honest", () => {
  const effort = controlsFor({ effort: "max" }).effort;
  assert.equal(effort.requested, "max");
  assert.equal(effort.applied?.key, "--effort");
  assert.throws(
    () => controlsFor({ effort: "ultra" }),
    (error) => error?.exitCode === 2 && /not accepted|unsupported/iu.test(error.message),
  );
  const record = capabilityRegistry.find(
    (entry) =>
      entry.engine === "commandcode" &&
      entry.axis === "effort" &&
      entry.action === "initial" &&
      entry.toolVersion === version,
  );
  assert.ok(record);
  assert.equal(record.modelDependent, false);
  assert.ok(record.values.includes("off"));
  assert.ok(record.values.includes("max"));
});

test("Command Code permission values fail closed outside the documented set", () => {
  assert.equal(controlsFor({ permission: "yolo" }).permission.applied?.key, "--yolo");
  assert.throws(
    () => controlsFor({ permission: "autonomous" }),
    (error) => error?.exitCode === 2 && /not accepted|unsupported/iu.test(error.message),
  );
});

test("Command Code max turns require a positive integer and stay engine-scoped", () => {
  assert.equal(controlsFor({ maxTurns: "9" }).maxTurns?.applied?.key, "--max-turns");
  assert.throws(
    () => controlsFor({ maxTurns: "0" }),
    (error) => error?.exitCode === 2 && /positive integer/u.test(error.message),
  );
  assert.throws(
    () => controlsFor({ maxTurns: "abc" }),
    (error) => error?.exitCode === 2 && /positive integer/u.test(error.message),
  );
  assert.throws(
    () =>
      resolveControls({
        engine: "codex",
        model: "gpt-5.6",
        maxTurns: "9",
        action: "initial",
        toolVersion: "codex-cli 0.164.0",
      }),
    (error) => error?.exitCode === 2 && /unverified|unsupported/iu.test(error.message),
  );
});

test("Command Code add-dir, tools-all, sandbox, and workspace trust stay fail-closed", () => {
  const controls = controlsFor({ addDirs: ["/work/a"], toolsAll: true });
  assert.equal(controls.addDirs?.requested, true);
  assert.equal(controls.addDirs?.applied?.key, "--add-dir");
  assert.equal(controls.toolsAll?.applied?.key, "--tools-all");
  assert.throws(
    () => controlsFor({ sandbox: "workspace-write" }),
    (error) => error?.exitCode === 2 && /unverified|unsupported/iu.test(error.message),
  );
  assert.throws(
    () => controlsFor({ workspaceTrust: true }),
    (error) => error?.exitCode === 2 && /unverified|unsupported/iu.test(error.message),
  );
  assert.throws(
    () =>
      resolveControls({
        engine: "mock",
        toolsAll: true,
        action: "initial",
        toolVersion: "simulated",
      }),
    (error) => error?.exitCode === 2 && /unverified|unsupported/iu.test(error.message),
  );
});

test("Command Code resume reprojection keeps max turns, tools-all, and add-dir evidence", () => {
  const controls = controlsFor({ maxTurns: "9", toolsAll: true, addDirs: ["/work/a"] });
  const resumed = reprojectControls(controls, "commandcode", "resume", ["/work/a"]);
  assert.equal(resumed.maxTurns?.applied?.key, "--max-turns");
  assert.equal(resumed.toolsAll?.applied?.key, "--tools-all");
  assert.equal(resumed.addDirs?.applied?.key, "--add-dir");
  assert.equal(resumed.addDirs?.applied?.observedValueRedacted, "1 directories");
});

test("persisted control snapshots without the Command Code axes still validate", () => {
  const controls = createControls({
    engine: "commandcode",
    model: "deepseek/deepseek-v4.1-flash",
    action: "initial",
  });
  assert.equal(isHarnessControls(controls), true);
  const legacy = { ...controls };
  delete legacy.maxTurns;
  delete legacy.addDirs;
  delete legacy.toolsAll;
  assert.equal(isHarnessControls(legacy), true);
});

test("Command Code evidence covers patch releases of the same release line", () => {
  assert.equal(evidenceVersionMatches("commandcode", version, "commandcode 1.88.7"), true);
  assert.equal(evidenceVersionMatches("commandcode", version, "commandcode 1.89.0"), false);
  assert.equal(evidenceVersionMatches("commandcode", version, "unverified"), false);
});
