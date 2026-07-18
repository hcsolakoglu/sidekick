import type { RunStore } from "../core/run-store.js";
import { CliError } from "../utils/errors.js";
import { parseOptions } from "./shared.js";

export async function resultCommand(args: string[], store: RunStore): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    options: { json: { type: "boolean", default: false } },
  });
  const [name] = positionals;
  if (!name || positionals.length !== 1) throw new CliError("usage: sidekick result NAME [--json]");
  if (!(await store.exists(name))) throw new CliError(`unknown run: ${name}`);
  const record = await store.read(name);
  if (values.json)
    process.stdout.write(
      `${JSON.stringify({ name, status: record.status, exitCode: record.exitCode, session: record.session, output: record.output })}\n`,
    );
  else process.stdout.write(record.output);
  return 0;
}
