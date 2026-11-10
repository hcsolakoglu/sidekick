import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { runCli, temporary } from "../helpers.js";

test("commandcode spawn, wait, and send resume reuse the NDJSON session", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const extra = join(sandbox, "extra");
  await mkdir(extra, { recursive: true });
  const argsLog = join(sandbox, "args.log");
  const fake = join(sandbox, "fake-commandcode.mjs");
  await writeFile(
    fake,
    `import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("1.88.5"); process.exit(0); }
appendFileSync(${JSON.stringify(argsLog)}, JSON.stringify(args) + "\\n");
readFileSync(0, "utf8");
const resume = args.indexOf("--resume");
const session = resume >= 0 ? args[resume + 1] : "cc-session-1";
const text = resume >= 0 ? "OK2" : "OK";
const denied = process.env.FAKE_COMMANDCODE_DENY === "1";
console.log(JSON.stringify({ type: "event", event: { type: "run_start", sessionId: session } }));
if (denied) {
  console.log(JSON.stringify({ type: "event", event: { type: "tool_queued", toolCallId: "c1", toolName: "shell_command", input: { command: "rm -r ./build" } } }));
  console.log(JSON.stringify({ type: "event", event: { type: "tool_denied", toolCallId: "c1", toolName: "shell_command" } }));
}
console.log(JSON.stringify({ type: "event", event: { type: "run_end", result: { finalText: text, stopReason: denied ? "permission_denied" : "end_turn", nextState: { sessionId: session } } } }));
console.log(JSON.stringify({ type: "result", subtype: "success", sessionId: session, stopReason: denied ? "permission_denied" : "end_turn", finalText: text, usage: {} }));
if (process.env.FAKE_COMMANDCODE_MAX === "1") process.exitCode = 8;
`,
  );
  const env = {
    SIDEKICK_HOME: home,
    SIDEKICK_ENGINE_COMMANDCODE_CMD: `${process.execPath} ${fake}`,
    SIDEKICK_TOOL_VERSION_COMMANDCODE: "commandcode 1.88.5",
  };
  await runCli(
    [
      "spawn",
      "commandcode",
      "worker",
      "--dir",
      sandbox,
      "--model",
      "deepseek/deepseek-v4.1-flash",
      "--effort",
      "low",
      "--permission",
      "yolo",
      "--max-turns",
      "7",
      "--add-dir",
      extra,
      "--tools-all",
      "true",
      "--",
      "hello",
    ],
    { env },
  );
  const first = JSON.parse(
    (await runCli(["wait", "worker", "--timeout", "10", "--json"], { env })).stdout,
  );
  assert.equal(first.status, "done");
  assert.equal(first.exitCode, 0);
  assert.equal(first.session, "cc-session-1");
  assert.equal(first.output.trim(), "OK");
  const spawnArgs = JSON.parse((await readFile(argsLog, "utf8")).split("\n")[0]);
  assert.deepEqual(spawnArgs.slice(0, 2), ["--print=hello", "--output-format"]);
  assert.ok(spawnArgs.includes("--yolo"));
  assert.equal(spawnArgs[spawnArgs.indexOf("--max-turns") + 1], "7");
  assert.equal(spawnArgs[spawnArgs.indexOf("--effort") + 1], "low");
  assert.equal(spawnArgs[spawnArgs.indexOf("--add-dir") + 1], extra);
  assert.ok(spawnArgs.includes("--tools-all"));
  assert.ok(spawnArgs.includes("--skip-onboarding"));
  assert.ok(spawnArgs.includes("--no-auto-update"));
  const meta = JSON.parse(await readFile(join(home, "runs", "worker", "meta.json"), "utf8"));
  assert.deepEqual(meta.addDirs, [extra]);
  assert.equal(meta.controls.maxTurns.requested, "7");
  assert.equal(meta.controls.toolsAll.requested, true);

  await runCli(["send", "worker", "--", "follow up"], { env });
  const second = JSON.parse(
    (await runCli(["wait", "worker", "--timeout", "10", "--json"], { env })).stdout,
  );
  assert.equal(second.status, "done");
  assert.equal(second.session, "cc-session-1");
  assert.equal(second.output.trim(), "OK2");
  const resumeArgs = JSON.parse((await readFile(argsLog, "utf8")).split("\n").filter(Boolean)[1]);
  assert.equal(resumeArgs[resumeArgs.indexOf("--resume") + 1], "cc-session-1");
  assert.ok(resumeArgs.includes("--max-turns"));
});

test("commandcode permission_denied is recorded as a failing run", async () => {
  const sandbox = await temporary();
  const fake = join(sandbox, "fake-commandcode.mjs");
  await writeFile(
    fake,
    `import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("1.88.5"); process.exit(0); }
readFileSync(0, "utf8");
console.log(JSON.stringify({ type: "event", event: { type: "run_start", sessionId: "denied-1" } }));
console.log(JSON.stringify({ type: "event", event: { type: "tool_queued", toolCallId: "c1", toolName: "shell_command", input: { command: "rm -r ./build" } } }));
console.log(JSON.stringify({ type: "event", event: { type: "tool_denied", toolCallId: "c1", toolName: "shell_command" } }));
console.log(JSON.stringify({ type: "event", event: { type: "run_end", result: { finalText: "stopped", stopReason: "permission_denied", nextState: { sessionId: "denied-1" } } } }));
console.log(JSON.stringify({ type: "result", subtype: "success", sessionId: "denied-1", stopReason: "permission_denied", finalText: "stopped", usage: {} }));
`,
  );
  const env = {
    SIDEKICK_HOME: join(sandbox, "home"),
    SIDEKICK_ENGINE_COMMANDCODE_CMD: `${process.execPath} ${fake}`,
    SIDEKICK_TOOL_VERSION_COMMANDCODE: "commandcode 1.88.5",
  };
  await runCli(["spawn", "commandcode", "denied", "--dir", sandbox, "--", "hello"], { env });
  const result = JSON.parse(
    (await runCli(["wait", "denied", "--timeout", "10", "--json"], { env })).stdout,
  );
  assert.equal(result.status, "done");
  assert.equal(result.exitCode, 126);
  assert.equal(result.session, "denied-1");
  assert.match(result.output, /permission_denied/u);
  assert.match(result.output, /shell_command/u);
  assert.match(result.output, /rm -r \.\/build/u);
});

test("commandcode keeps exit code 8 when the turn cap is reached", async () => {
  const sandbox = await temporary();
  const fake = join(sandbox, "fake-commandcode.mjs");
  await writeFile(
    fake,
    `import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("1.88.5"); process.exit(0); }
readFileSync(0, "utf8");
console.log(JSON.stringify({ type: "event", event: { type: "run_start", sessionId: "cap-1" } }));
console.log(JSON.stringify({ type: "event", event: { type: "run_end", result: { finalText: "partial", stopReason: "max_turns", nextState: { sessionId: "cap-1" } } } }));
console.log(JSON.stringify({ type: "result", subtype: "max_turns", sessionId: "cap-1", stopReason: "max_turns", finalText: "partial", usage: {} }));
process.exitCode = 8;
`,
  );
  const env = {
    SIDEKICK_HOME: join(sandbox, "home"),
    SIDEKICK_ENGINE_COMMANDCODE_CMD: `${process.execPath} ${fake}`,
    SIDEKICK_TOOL_VERSION_COMMANDCODE: "commandcode 1.88.5",
  };
  await runCli(["spawn", "commandcode", "cap", "--dir", sandbox, "--", "hello"], { env });
  const result = JSON.parse(
    (await runCli(["wait", "cap", "--timeout", "10", "--json"], { env })).stdout,
  );
  assert.equal(result.status, "done");
  assert.equal(result.exitCode, 8);
  assert.match(result.output, /max-turns/u);
});

test("commandcode-only run inputs fail closed for other engines", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const env = { SIDEKICK_HOME: home };
  const addDir = await runCli(
    ["spawn", "codex", "bad-add-dir", "--add-dir", sandbox, "--dir", sandbox, "--", "probe"],
    { env },
  );
  assert.equal(addDir.code, 2);
  assert.match(addDir.stderr, /--add-dir is not supported/iu);
  const maxTurns = await runCli(
    ["spawn", "codex", "bad-max-turns", "--max-turns", "3", "--dir", sandbox, "--", "probe"],
    { env },
  );
  assert.equal(maxTurns.code, 2);
  assert.match(maxTurns.stderr, /maxTurns|max-turns|unverified|unsupported/iu);
  const toolsAll = await runCli(
    ["spawn", "codex", "bad-tools", "--tools-all", "true", "--dir", sandbox, "--", "probe"],
    { env },
  );
  assert.equal(toolsAll.code, 2);
  assert.match(toolsAll.stderr, /toolsAll|tools-all|unverified|unsupported/iu);
  await assert.rejects(stat(home), { code: "ENOENT" });
});

test("commandcode adoption validates the session transcript path", async () => {
  const sandbox = await temporary();
  const home = join(sandbox, "home");
  const project = join(sandbox, "userhome", ".commandcode", "projects", "sandbox");
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "adopted-session.jsonl"), "{}\n");
  const env = {
    SIDEKICK_HOME: home,
    HOME: join(sandbox, "userhome"),
    SIDEKICK_TOOL_VERSION_COMMANDCODE: "commandcode 1.88.5",
  };
  const adopted = await runCli(
    ["adopt", "commandcode", "existing", "--session", "adopted-session", "--dir", sandbox],
    { env },
  );
  assert.equal(adopted.code, 0, adopted.stderr);
  const missing = await runCli(
    ["adopt", "commandcode", "missing", "--session", "not-there", "--dir", sandbox],
    { env },
  );
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /session not found/iu);
});
