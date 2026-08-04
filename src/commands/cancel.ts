import { forceStop, refresh } from "../core/run-service.js";
import type { RunStore } from "../core/run-store.js";
import { CliError } from "../utils/errors.js";
import { parseOptions } from "./shared.js";

export async function cancelCommand(args: string[], store: RunStore): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    options: { json: { type: "boolean", default: false } },
  });
  const [name] = positionals;
  if (!name || positionals.length !== 1) throw new CliError("usage: sidekick cancel NAME [--json]");
  if (!(await store.exists(name))) throw new CliError(`unknown run: ${name}`);
  const record = await store.withLock(name, async () => {
    const current = await refresh(store, await store.read(name), undefined, false);
    if (current.status === "running") await forceStop(store, current);
    return store.read(name);
  });
  process.stdout.write(
    values.json
      ? `${JSON.stringify({ name, status: record.status, exitCode: record.exitCode, session: record.session })}\n`
      : `${name} ${record.status}\n`,
  );
  return 0;
}
