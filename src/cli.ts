import { adoptCommand } from "./commands/adopt.js";
import { cleanCommand } from "./commands/clean.js";
import { resultCommand } from "./commands/result.js";
import { sendCommand } from "./commands/send.js";
import { spawnCommand } from "./commands/spawn.js";
import { statusCommand } from "./commands/status.js";
import { tailCommand } from "./commands/tail.js";
import { waitCommand } from "./commands/wait.js";
import { executeWorker } from "./core/run-service.js";
import { RunStore } from "./core/run-store.js";
import type { WorkerAction } from "./core/engines/types.js";
import { CliError, errorExitCode, formatError } from "./utils/errors.js";

export const VERSION = "0.1.0";
export const HELP = `sidekick ${VERSION} — persistent local multi-agent orchestration

Usage:
  sidekick spawn ENGINE NAME [--dir PATH] [--model MODEL] [--mode MODE] -- PROMPT
  sidekick send NAME [--force] -- PROMPT
  sidekick wait [NAME ...] [--all] [--timeout SECONDS] [--quiet] [--json]
  sidekick adopt ENGINE NAME --session ID [--dir PATH] [--model MODEL] [--mode MODE]
  sidekick tail NAME [-n LINES]
  sidekick status [--json]
  sidekick result NAME [--json]
  sidekick clean [NAME ...]

Engines: codex, devin, claude, hermes, mock

Global options:
  -h, --help       Show this help
  -v, --version    Print the version

Configuration precedence: command flag > environment > default.
Environment: SIDEKICK_HOME, SIDEKICK_ENGINE_<NAME>_CMD, NO_COLOR, FORCE_COLOR, CI.
Exit codes: 0 success, 1 internal error, 2 usage error, 124 wait timeout, 130 interrupted.
`;

export async function run(argv: string[], store = new RunStore()): Promise<number> {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  await store.initialize();
  const [command, ...args] = argv;
  const abort = new AbortController();
  const interrupt = () => {
    store.interrupt();
    abort.abort();
  };
  process.once("SIGINT", interrupt);
  try {
    switch (command) {
      case "spawn":
        return await spawnCommand(args, store);
      case "send":
        return await sendCommand(args, store);
      case "wait":
        return await waitCommand(args, store, abort.signal);
      case "adopt":
        return await adoptCommand(args, store);
      case "tail":
        return await tailCommand(args, store, abort.signal);
      case "status":
        return await statusCommand(args, store);
      case "result":
        return await resultCommand(args, store);
      case "clean":
        return await cleanCommand(args, store);
      case "_worker": {
        const [name, turn, action] = args;
        if (!name || !turn || !action || !["spawn", "resume", "fallback"].includes(action))
          throw new CliError("invalid worker invocation", 1);
        return await executeWorker(store, name, Number(turn), action as WorkerAction);
      }
      default:
        throw new CliError(`unknown command: ${command}`, 2, "Run sidekick --help for usage.");
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
}

async function main(): Promise<void> {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = errorExitCode(error);
  }
}

if (process.env.SIDEKICK_NO_AUTO !== "1") await main();
