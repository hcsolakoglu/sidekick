import { getEngine } from "../core/engines/index.js";
import { evidencedToolVersion, resolveControls } from "../core/controls.js";
import { startWorker, withEngineSlot } from "../core/run-service.js";
import { enginePlatformSupport } from "../core/platform-support.js";
import type { RunStore } from "../core/run-store.js";
import { CliError } from "../utils/errors.js";
import {
  directory,
  parseBooleanOption,
  parseOptions,
  parseTransportOption,
  promptFrom,
  validatePromptSource,
} from "./shared.js";
import { validateName } from "../core/run-store.js";

export async function spawnCommand(args: string[], store: RunStore): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    options: {
      dir: { type: "string" },
      model: { type: "string" },
      provider: { type: "string" },
      transport: { type: "string" },
      effort: { type: "string" },
      permission: { type: "string" },
      sandbox: { type: "string" },
      "workspace-trust": { type: "string" },
      mode: { type: "string" },
      "on-complete": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const [engineName, name, ...promptParts] = positionals;
  if (!engineName || !name)
    throw new CliError("usage: sidekick spawn ENGINE NAME [options] -- PROMPT");
  const engine = getEngine(engineName);
  const support = enginePlatformSupport(engine.name);
  if (support.level === "unsupported") throw new CliError(support.detail);
  if (support.level === "beta") process.stderr.write(`sidekick: warning: ${support.detail}\n`);
  validateName(name);
  validatePromptSource(promptParts);
  const workspaceTrust = parseBooleanOption(values["workspace-trust"], "--workspace-trust");
  const transport = parseTransportOption(values.transport);
  const controls = resolveControls({
    engine: engine.name,
    model: values.model ?? "",
    ...(values.provider ? { provider: values.provider } : {}),
    ...(transport ? { transport } : {}),
    mode: values.mode ?? "",
    ...(values.effort ? { effort: values.effort } : {}),
    ...(values.permission ? { permission: values.permission } : {}),
    ...(values.sandbox ? { sandbox: values.sandbox } : {}),
    ...(workspaceTrust === undefined ? {} : { workspaceTrust }),
    action: "initial",
    toolVersion: evidencedToolVersion(engine.name),
  });
  const cwd = await directory(values.dir);
  const prompt = await promptFrom(promptParts);
  await store.initialize();
  await store.withLock(name, async () => {
    await withEngineSlot(store, engine.name, async () => {
      await store.create(
        {
          name,
          engine: engine.name,
          directory: cwd,
          model: values.model ?? "",
          mode: values.mode ?? "",
          controls,
          onComplete: values["on-complete"] ?? process.env.SIDEKICK_ON_COMPLETE ?? "",
        },
        prompt,
      );
      await startWorker(store, name, 1, "spawn");
    });
  });
  process.stdout.write(
    values.json
      ? `${JSON.stringify({ name, engine: engine.name, status: "running", run: 1, controls })}\n`
      : `${name}\n`,
  );
  return 0;
}
