import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { extractSurface } from "../../scripts/check-surface-drift.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("surface extraction is CRLF-safe and preserves subcommands", () => {
  const help = [
    "Usage:",
    "  sidekick spawn ENGINE NAME [--dir PATH] [--json] -- PROMPT",
    "  sidekick skill install HARNESS [--force] [--json]",
    "",
    "Global options:",
    "  -h, --help  Show help",
    "  -v, --version  Show version",
  ].join("\r\n");

  assert.deepEqual(extractSurface(help), {
    schemaVersion: 1,
    commands: [
      { path: "spawn", flags: ["--dir", "--json"] },
      { path: "skill install", flags: ["--force", "--json"] },
    ],
    globalFlags: ["--help", "--version", "-h", "-v"],
  });
});

test("committed CLI surface and documentation pass the drift gate", () => {
  const output = execFileSync(
    process.execPath,
    [join(root, "scripts", "check-surface-drift.mjs")],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  assert.match(output, /12 commands/);
});
