import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunStore } from "../core/run-store.js";
import { CliError } from "../utils/errors.js";
import { parseOptions } from "./shared.js";

const skillRoot = fileURLToPath(new URL("../../skills", import.meta.url));
const START = "<!-- sidekick managed start -->";
const END = "<!-- sidekick managed end -->";

export async function skillCommand(args: string[], store: RunStore): Promise<number> {
  void store;
  const [action, ...rest] = args;
  if (action !== "install")
    throw new CliError(
      "usage: sidekick skill install <claude-code|codex|devin|hermes> [--force] [--json]",
    );
  const { values, positionals } = parseOptions(rest, {
    options: {
      force: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  const [harness] = positionals;
  if (!harness || positionals.length !== 1)
    throw new CliError(
      "usage: sidekick skill install <claude-code|codex|devin|hermes> [--force] [--json]",
    );
  const installed: string[] = [];
  if (harness === "claude-code") {
    const root = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    installed.push(
      await installFile(
        join(skillRoot, "claude-code", "SKILL.md"),
        join(root, "skills", "sidekick", "SKILL.md"),
        values.force,
      ),
    );
  } else if (harness === "codex") {
    const root = process.env.CODEX_HOME || join(homedir(), ".codex");
    installed.push(
      await installFile(
        join(skillRoot, "claude-code", "SKILL.md"),
        join(root, "skills", "sidekick", "SKILL.md"),
        values.force,
      ),
    );
    installed.push(
      await installManaged(join(skillRoot, "codex", "AGENTS.md"), join(root, "AGENTS.md")),
    );
  } else if (harness === "devin") {
    const config =
      process.env.DEVIN_CONFIG_DIR ||
      join(
        process.env.XDG_CONFIG_HOME || process.env.APPDATA || join(homedir(), ".config"),
        "devin",
      );
    installed.push(
      await installFile(
        join(skillRoot, "claude-code", "SKILL.md"),
        join(config, "skills", "sidekick", "SKILL.md"),
        values.force,
      ),
    );
    installed.push(
      await installFile(
        join(skillRoot, "devin", "rule.md"),
        join(process.cwd(), ".windsurf", "rules", "sidekick.md"),
        values.force,
      ),
    );
  } else if (harness === "hermes") {
    const root = process.env.HERMES_HOME || join(homedir(), ".hermes");
    installed.push(
      await installFile(
        join(skillRoot, "hermes", "SKILL.md"),
        join(root, "skills", "sidekick", "SKILL.md"),
        values.force,
      ),
    );
  } else {
    throw new CliError(`unknown harness: ${harness}`);
  }
  process.stdout.write(
    values.json
      ? `${JSON.stringify({ harness, installed })}\n`
      : installed.map((path) => `installed ${path}\n`).join(""),
  );
  return 0;
}

async function installFile(source: string, target: string, force: boolean): Promise<string> {
  const content = await readFile(source, "utf8");
  const existing = await readFile(target, "utf8").catch(() => "");
  if (existing && existing !== content && !force)
    throw new CliError(`refusing to overwrite ${target}; rerun with --force`);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, content, { encoding: "utf8", mode: 0o600 });
  return target;
}

async function installManaged(source: string, target: string): Promise<string> {
  const body = (await readFile(source, "utf8")).trim();
  const block = `${START}\n${body}\n${END}`;
  const existing = await readFile(target, "utf8").catch(() => "");
  const pattern = new RegExp(`${START}[\\s\\S]*?${END}`, "u");
  const content = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trimEnd()}${existing ? "\n\n" : ""}${block}\n`;
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, content, { encoding: "utf8", mode: 0o600 });
  return target;
}
