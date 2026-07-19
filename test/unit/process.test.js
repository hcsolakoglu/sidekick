import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { processIdentity, processIdentityMatches, stopProcess } from "../../dist/core/process.js";

async function waitForIdentity(pid, token) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const identity = await processIdentity(pid, token);
    if (identity) return identity;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`process identity was not observable for PID ${pid}`);
}

async function waitForIdentityExit(pid, identity) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!(await processIdentityMatches(pid, identity))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(
    await processIdentityMatches(pid, identity),
    false,
    `process identity still exists for PID ${pid}`,
  );
}

test("process identity rejects a reused PID identity", async () => {
  const identity = await processIdentity(process.pid);
  assert.ok(identity);
  assert.equal(await processIdentityMatches(process.pid, identity), true);
  assert.equal(await processIdentityMatches(process.pid, `${identity}-reused`), false);
});

test(
  "POSIX stop terminates a detached worker process group",
  { skip: process.platform === "win32" },
  async () => {
    const token = `sidekick-process-test-${randomUUID()}`;
    const descendantScript = "setInterval(()=>{},1000)";
    const parentScript =
      `const c=require('child_process').spawn(process.execPath,` +
      `${JSON.stringify(["-e", descendantScript, token])},{stdio:'ignore'});` +
      `console.log(c.pid);setInterval(()=>{},1000)`;
    const child = spawn(process.execPath, ["-e", parentScript], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    assert.ok(child.pid);
    const descendantPid = await new Promise((resolve) =>
      child.stdout.once("data", (value) => resolve(Number(String(value).trim()))),
    );
    const descendantIdentity = await waitForIdentity(descendantPid, token);
    await stopProcess(child.pid);
    assert.throws(() => process.kill(-child.pid, 0));
    await waitForIdentityExit(descendantPid, descendantIdentity);
  },
);
