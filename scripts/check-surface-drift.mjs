import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = join(root, "docs", "cli-surface.json");

function flagsIn(value) {
  return [
    ...new Set(
      [...value.matchAll(/(?:^|[\s[])(--[a-z][a-z0-9-]*|-[a-z])(?=[\s,\]])/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort();
}

function commandPath(usage) {
  const tokens = usage.slice("sidekick ".length).trim().split(/\s+/);
  const path = [];
  for (const token of tokens) {
    if (token.startsWith("[") || token.startsWith("-") || /^[A-Z][A-Z_-]*$/.test(token)) break;
    path.push(token);
  }
  return path.join(" ");
}

export function extractSurface(help) {
  const lines = help.replaceAll("\r\n", "\n").split("\n");
  const usageLines = lines.filter((line) => /^  sidekick\s+/.test(line)).map((line) => line.trim());
  const commands = usageLines.map((usage) => ({ path: commandPath(usage), flags: flagsIn(usage) }));
  const globalStart = lines.findIndex((line) => line === "Global options:");
  const globalLines =
    globalStart < 0 ? [] : lines.slice(globalStart + 1).filter((line) => /^  -/.test(line));
  return { schemaVersion: 1, commands, globalFlags: flagsIn(globalLines.join(" ")) };
}

function fail(messages) {
  process.stderr.write(
    `CLI surface drift detected:\n${messages.map((message) => `- ${message}`).join("\n")}\n` +
      "Update --help, README.md, skills/*, CHANGELOG.md, and docs/cli-surface.json in the same change.\n",
  );
  process.exitCode = 1;
}

function main() {
  const help = execFileSync(process.execPath, [join(root, "bin", "sidekick.js"), "--help"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const actual = extractSurface(help);
  const expected = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const problems = [];

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    problems.push(`built help does not match ${snapshotPath}`);
    problems.push(`expected ${JSON.stringify(expected)}`);
    problems.push(`actual   ${JSON.stringify(actual)}`);
  }

  const readme = readFileSync(join(root, "README.md"), "utf8");
  const genericSkill = readFileSync(join(root, "skills", "AGENTS.md"), "utf8");
  for (const { path } of actual.commands) {
    const command = path.split(" ")[0];
    const token = new RegExp(`\\b${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (!token.test(readme)) problems.push(`command ${command} is missing from README.md`);
    if (!token.test(genericSkill))
      problems.push(`command ${command} is missing from skills/AGENTS.md`);
  }

  if (problems.length) fail(problems);
  else
    process.stdout.write(
      `CLI surface matches docs/cli-surface.json (${actual.commands.length} commands).\n`,
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
