import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { delimiter, dirname, extname, isAbsolute, join, normalize } from "node:path";
import { CliError } from "../utils/errors.js";

export interface ResolvedCommand {
  command: string;
  leadingArgs: string[];
  source: "direct" | "path" | "node-script" | "npm-shim";
  shim?: string;
}

export interface ResolveCommandOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") return env[name] ?? "";
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? (env[key] ?? "") : "";
}

async function usable(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(path, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function windowsExtensions(command: string, env: NodeJS.ProcessEnv): string[] {
  if (extname(command)) return [""];
  const raw = envValue(env, "PATHEXT", "win32") || ".COM;.EXE;.BAT;.CMD";
  return [
    "",
    ...raw
      .split(";")
      .filter(Boolean)
      .map((value) => value.toLowerCase()),
  ];
}

async function findOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  const hasDirectory = isAbsolute(command) || /[\\/]/u.test(command);
  const directories = hasDirectory
    ? [""]
    : envValue(env, "PATH", platform)
        .split(platform === "win32" ? ";" : delimiter)
        .filter(Boolean);
  const extensions = platform === "win32" ? windowsExtensions(command, env) : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = normalize(
        directory ? join(directory, `${command}${extension}`) : `${command}${extension}`,
      );
      if (await usable(candidate, platform)) return candidate;
      if (platform === "win32" && extension) {
        const upper = normalize(
          directory
            ? join(directory, `${command}${extension.toUpperCase()}`)
            : `${command}${extension.toUpperCase()}`,
        );
        if (await usable(upper, platform)) return upper;
      }
    }
  }
  return undefined;
}

async function resolveNpmShim(shim: string): Promise<ResolvedCommand | undefined> {
  let body: string;
  try {
    body = await readFile(shim, "utf8");
  } catch {
    return undefined;
  }
  // npm's Windows shim ends by invoking a target under %dp0% and forwarding %*.
  // Resolve that target ourselves so prompts never pass through cmd.exe parsing.
  const matches = [...body.matchAll(/["']%dp0%[\\/]([^"'\r\n]+?)["']\s+%\*/giu)];
  const relative = matches.at(-1)?.[1];
  if (!relative || relative.includes("%")) return undefined;
  const target = normalize(join(dirname(shim), ...relative.split(/[\\/]/u)));
  if (!(await usable(target, "win32"))) return undefined;
  if ([".js", ".cjs", ".mjs"].includes(extname(target).toLowerCase())) {
    return { command: process.execPath, leadingArgs: [target], source: "npm-shim", shim };
  }
  if ([".exe", ".com"].includes(extname(target).toLowerCase())) {
    return { command: target, leadingArgs: [], source: "npm-shim", shim };
  }
  return undefined;
}

export async function resolveCommand(
  command: string,
  options: ResolveCommandOptions = {},
): Promise<ResolvedCommand> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const found = await findOnPath(command, env, platform);
  if (!found) throw new CliError(`executable not found: ${command}`, 127);
  if (platform === "win32" && [".cmd", ".bat"].includes(extname(found).toLowerCase())) {
    const resolved = await resolveNpmShim(found);
    if (resolved) return resolved;
    throw new CliError(
      `cannot safely execute Windows batch shim: ${found}`,
      127,
      "Install the engine's native binary or set its SIDEKICK_ENGINE_<NAME>_CMD override to an .exe or JavaScript entry point.",
    );
  }
  if (platform === "win32" && [".js", ".cjs", ".mjs"].includes(extname(found).toLowerCase())) {
    return { command: process.execPath, leadingArgs: [found], source: "node-script" };
  }
  return { command: found, leadingArgs: [], source: isAbsolute(command) ? "direct" : "path" };
}
