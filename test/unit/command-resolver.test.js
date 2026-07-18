import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveCommand } from "../../dist/core/command-resolver.js";
import { enginePlatformSupport, engineStatePath } from "../../dist/core/platform-support.js";
import { windowsTreeKillArgs } from "../../dist/core/process.js";
import { temporary } from "../helpers.js";

test("resolves an npm .cmd shim to Node plus its JavaScript entry without a shell", async () => {
  const root = await temporary();
  const bin = join(root, "bin");
  const entry = join(bin, "node_modules", "agent", "cli.js");
  await mkdir(join(bin, "node_modules", "agent"), { recursive: true });
  await writeFile(entry, "console.log('agent')\n");
  await writeFile(
    join(bin, "agent.cmd"),
    '@ECHO off\r\n"%dp0%\\node_modules\\agent\\cli.js" %*\r\n',
  );
  const resolved = await resolveCommand("agent", {
    platform: "win32",
    env: { Path: bin, PATHEXT: ".EXE;.CMD" },
  });
  assert.deepEqual(resolved, {
    command: process.execPath,
    leadingArgs: [entry],
    source: "npm-shim",
    shim: join(bin, "agent.cmd"),
  });
});

test("rejects opaque Windows batch shims instead of shell-interpolating prompts", async () => {
  const root = await temporary();
  const shim = join(root, "agent.cmd");
  await writeFile(shim, "@echo off\r\necho %*\r\n");
  await assert.rejects(
    resolveCommand("agent", { platform: "win32", env: { PATH: root, PATHEXT: ".CMD" } }),
    /cannot safely execute Windows batch shim/u,
  );
});

test("resolves native executable paths directly", async () => {
  const root = await temporary();
  const executable = join(root, process.platform === "win32" ? "agent.exe" : "agent");
  await writeFile(executable, "");
  await chmod(executable, 0o700);
  const resolved = await resolveCommand(executable);
  assert.equal(resolved.command, executable);
  assert.equal(resolved.source, "direct");
});

test("Windows tree termination uses taskkill child-tree flags", () => {
  assert.deepEqual(windowsTreeKillArgs(4321), ["/PID", "4321", "/T", "/F"]);
});

test("platform matrix distinguishes supported and beta native Windows engines", () => {
  assert.equal(enginePlatformSupport("codex", "win32", {}).level, "supported");
  assert.equal(enginePlatformSupport("devin", "win32", {}).level, "supported");
  assert.equal(enginePlatformSupport("claude", "win32", {}).level, "supported");
  assert.equal(enginePlatformSupport("hermes", "win32", {}).level, "beta");
  assert.equal(
    engineStatePath("codex", { USERPROFILE: "C:\\Users\\Ada" }, "win32"),
    "C:\\Users\\Ada\\.codex",
  );
});
