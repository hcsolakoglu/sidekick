import { join } from "node:path";
import { getEngine } from "../core/engines/index.js";
import { evidencedToolVersion, resolveControls } from "../core/controls.js";
import { validateAdoptedSession, withDirectoryDiscoveryLock } from "../core/run-service.js";
import { enginePlatformSupport } from "../core/platform-support.js";
import type { RunStore } from "../core/run-store.js";
import { CliError } from "../utils/errors.js";
import { directory, parseBooleanOption, parseOptions, parseTransportOption } from "./shared.js";
import { validateName } from "../core/run-store.js";

export async function adoptCommand(args: string[], store: RunStore): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    options: {
      session: { type: "string" },
      dir: { type: "string" },
      model: { type: "string" },
      provider: { type: "string" },
      transport: { type: "string" },
      effort: { type: "string" },
      permission: { type: "string" },
      sandbox: { type: "string" },
      "workspace-trust": { type: "string" },
      mode: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const [engineName, name] = positionals;
  if (!engineName || !name || !values.session)
    throw new CliError("usage: sidekick adopt ENGINE NAME --session ID [options]");
  validateName(name);
  if (!values.session.trim() || /[\r\n\0]/u.test(values.session))
    throw new CliError("--session must be a non-empty single-line ID");
  const session = values.session;
  const engine = getEngine(engineName);
  const support = enginePlatformSupport(engine.name);
  if (support.level === "unsupported") throw new CliError(support.detail);
  if (support.level === "beta") process.stderr.write(`sidekick: warning: ${support.detail}\n`);
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
    action: "adopt",
    toolVersion: evidencedToolVersion(engine.name),
  });
  const cwd = await directory(values.dir);
  const valid = await withDirectoryDiscoveryLock(store, engine.name, cwd, () =>
    validateAdoptedSession(engine.name, session, cwd),
  );
  if (valid === false) throw new CliError(`${engine.name} session not found: ${session}`);
  if (valid === null)
    process.stderr.write(
      `sidekick: warning: ${engine.name} session existence could not be validated\n`,
    );
  await store.initialize();
  await store.withLock(name, async () => {
    const prompt = `Adopted existing ${engine.name} session ${session}.\n`;
    await store.create(
      {
        name,
        engine: engine.name,
        directory: cwd,
        model: values.model ?? "",
        mode: values.mode ?? "",
        controls,
      },
      prompt,
      session,
    );
    const turn = store.turnPath(name, 1);
    await store.complete(name, turn, 0, session, prompt);
    await store.atomicWrite(join(turn, "adopted"), "true\n");
  });
  process.stdout.write(
    values.json
      ? `${JSON.stringify({ name, engine: engine.name, status: "done", run: 1, session, controls })}\n`
      : `${name}\n`,
  );
  return 0;
}
