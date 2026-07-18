import test from "node:test";
import assert from "node:assert/strict";
import { CliError, errorExitCode, formatError } from "../../dist/utils/errors.js";

test("CLI errors map to requested exit codes and one formatter", () => {
  const error = new CliError("bad input", 124, "try later");
  assert.equal(errorExitCode(error), 124);
  assert.equal(formatError(error), "sidekick: bad input\nHint: try later");
  assert.equal(errorExitCode(new Error("boom")), 1);
  assert.equal(formatError(new Error("boom")), "sidekick: internal error: boom");
});
