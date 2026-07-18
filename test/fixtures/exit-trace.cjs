const { appendFileSync } = require("node:fs");

const path = process.env.SIDEKICK_TEST_EXIT_TRACE;
function record(event, code) {
  if (!path) return;
  appendFileSync(
    path,
    `${JSON.stringify({ event, code, pid: process.pid, exitCode: process.exitCode ?? null })}\n`,
  );
}

process.on("beforeExit", (code) => record("beforeExit", code));
process.on("exit", (code) => record("exit", code));
