import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { processIdentity, processIdentityMatches, stopProcess } from "../../dist/core/process.js";

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
    const child = spawn(
      process.execPath,
      [
        "-e",
        "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)",
      ],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    assert.ok(child.pid);
    const descendantPid = await new Promise((resolve) =>
      child.stdout.once("data", (value) => resolve(Number(String(value).trim()))),
    );
    await stopProcess(child.pid);
    assert.throws(() => process.kill(-child.pid, 0));
    assert.throws(() => process.kill(descendantPid, 0));
  },
);
