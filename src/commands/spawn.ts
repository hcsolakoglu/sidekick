import { getEngine } from "../core/engines/index.js";
import { startWorker } from "../core/run-service.js";
import { enginePlatformSupport } from "../core/platform-support.js";
import type { RunStore } from "../core/run-store.js";
import { CliError } from "../utils/errors.js";
import { directory, parseOptions, promptFrom } from "./shared.js";

export async function spawnCommand(args: string[], store: RunStore): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    options: { dir: { type: "string" }, model: { type: "string" }, mode: { type: "string" } },
  });
  const [engineName, name, ...promptParts] = positionals;
  if (!engineName || !name)
    throw new CliError("usage: sidekick spawn ENGINE NAME [options] -- PROMPT");
  const engine = getEngine(engineName);
  const support = enginePlatformSupport(engine.name);
  if (support.level === "unsupported") throw new CliError(support.detail);
  if (support.level === "beta") process.stderr.write(`sidekick: warning: ${support.detail}\n`);
  const prompt = await promptFrom(promptParts);
  const cwd = await directory(values.dir);
  await store.withLock(name, async () => {
    await store.create(
      {
        name,
        engine: engine.name,
        directory: cwd,
        model: values.model ?? "",
        mode: values.mode ?? "",
      },
      prompt,
    );
    await startWorker(store, name, 1, "spawn");
  });
  process.stdout.write(`${name}\n`);
  return 0;
}
