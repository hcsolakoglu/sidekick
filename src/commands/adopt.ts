import { join } from "node:path";
import { getEngine } from "../core/engines/index.js";
import { validateAdoptedSession } from "../core/run-service.js";
import { enginePlatformSupport } from "../core/platform-support.js";
import type { RunStore } from "../core/run-store.js";
import { CliError } from "../utils/errors.js";
import { directory, parseOptions } from "./shared.js";

export async function adoptCommand(args: string[], store: RunStore): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    options: {
      session: { type: "string" },
      dir: { type: "string" },
      model: { type: "string" },
      mode: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const [engineName, name] = positionals;
  if (!engineName || !name || !values.session)
    throw new CliError("usage: sidekick adopt ENGINE NAME --session ID [options]");
  if (/[\r\n\0]/u.test(values.session))
    throw new CliError("--session must be a non-empty single-line ID");
  const engine = getEngine(engineName);
  const support = enginePlatformSupport(engine.name);
  if (support.level === "unsupported") throw new CliError(support.detail);
  if (support.level === "beta") process.stderr.write(`sidekick: warning: ${support.detail}\n`);
  const cwd = await directory(values.dir);
  const valid = await validateAdoptedSession(engine.name, values.session, cwd);
  if (valid === false) throw new CliError(`${engine.name} session not found: ${values.session}`);
  if (valid === null)
    process.stderr.write(
      `sidekick: warning: ${engine.name} session existence could not be validated\n`,
    );
  await store.withLock(name, async () => {
    const prompt = `Adopted existing ${engine.name} session ${values.session}.\n`;
    await store.create(
      {
        name,
        engine: engine.name,
        directory: cwd,
        model: values.model ?? "",
        mode: values.mode ?? "",
      },
      prompt,
      values.session,
    );
    const turn = store.turnPath(name, 1);
    await store.complete(name, turn, 0, values.session ?? "", prompt);
    await store.atomicWrite(join(turn, "adopted"), "true\n");
  });
  process.stdout.write(
    values.json
      ? `${JSON.stringify({ name, engine: engine.name, status: "done", run: 1, session: values.session })}\n`
      : `${name}\n`,
  );
  return 0;
}
