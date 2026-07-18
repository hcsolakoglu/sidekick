import { commandOverride } from "../core/engines/shared.js";
import { engineNames } from "../core/engines/index.js";
import type { EngineName } from "../core/engines/types.js";
import { resolveCommand } from "../core/command-resolver.js";
import { enginePlatformSupport, engineStatePath, platformLabel } from "../core/platform-support.js";
import type { RunStore } from "../core/run-store.js";
import { CliError } from "../utils/errors.js";
import { parseOptions } from "./shared.js";

interface DoctorResult {
  engine: EngineName;
  support: "supported" | "beta" | "unsupported";
  installed: boolean;
  executable: string | null;
  resolution: string | null;
  statePath: string;
  detail: string;
  error: string | null;
}

function engineCommand(engine: EngineName, env: NodeJS.ProcessEnv): string {
  if (engine === "mock") return process.execPath;
  return commandOverride(engine, engine, env)[0] ?? engine;
}

export async function doctorCommand(args: string[], store: RunStore): Promise<number> {
  void store;
  const { values, positionals } = parseOptions(args, {
    options: { json: { type: "boolean", default: false } },
  });
  const selected = positionals.length ? positionals : engineNames;
  for (const name of selected) {
    if (!engineNames.includes(name as EngineName))
      throw new CliError(`unknown engine: ${name}`, 2, `Choose one of: ${engineNames.join(", ")}`);
  }
  const results: DoctorResult[] = [];
  for (const name of selected as EngineName[]) {
    const support = enginePlatformSupport(name);
    try {
      const resolved = await resolveCommand(engineCommand(name, process.env));
      results.push({
        engine: name,
        support: support.level,
        installed: true,
        executable: resolved.command,
        resolution: resolved.source,
        statePath: engineStatePath(name),
        detail: support.detail,
        error: null,
      });
    } catch (error) {
      results.push({
        engine: name,
        support: support.level,
        installed: false,
        executable: null,
        resolution: null,
        statePath: engineStatePath(name),
        detail: support.detail,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ platform: platformLabel(), results })}\n`);
  } else {
    process.stdout.write(
      `${"ENGINE".padEnd(9)} ${"SUPPORT".padEnd(11)} ${"INSTALLED".padEnd(10)} DETAILS\n`,
    );
    for (const result of results) {
      const details = result.error
        ? `${result.detail}; ${result.error}`
        : `${result.detail}; ${result.resolution}: ${result.executable}; state: ${result.statePath}`;
      process.stdout.write(
        `${result.engine.padEnd(9)} ${result.support.padEnd(11)} ${String(result.installed).padEnd(10)} ${details}\n`,
      );
    }
  }
  return results.some((result) => result.support === "unsupported" || !result.installed) ? 1 : 0;
}
