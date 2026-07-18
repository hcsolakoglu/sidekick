import { refresh } from "../core/run-service.js";
import type { RunRecord, RunStore } from "../core/run-store.js";
import { CliError } from "../utils/errors.js";
import { parseOptions } from "./shared.js";

export interface StatusJson {
  name: string;
  engine: string;
  status: string;
  exitCode: number | null;
  run: number;
  session: string;
  directory: string;
}
export function statusJson(record: RunRecord): StatusJson {
  return {
    name: record.meta.name,
    engine: record.meta.engine,
    status: record.status,
    exitCode: record.exitCode,
    run: record.meta.activeRun,
    session: record.session,
    directory: record.meta.directory,
  };
}

export async function statusCommand(args: string[], store: RunStore): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    options: { json: { type: "boolean", default: false } },
  });
  if (positionals.length) throw new CliError("status takes no positional arguments");
  const records = await Promise.all((await store.list()).map((record) => refresh(store, record)));
  if (values.json) process.stdout.write(`${JSON.stringify({ runs: records.map(statusJson) })}\n`);
  else {
    process.stdout.write(
      `${"NAME".padEnd(24)} ${"ENGINE".padEnd(8)} ${"STATUS".padEnd(8)} ${"EXIT".padEnd(5)} ${"RUN".padEnd(4)} SESSION\n`,
    );
    for (const record of records)
      process.stdout.write(
        `${record.meta.name.padEnd(24)} ${record.meta.engine.padEnd(8)} ${record.status.padEnd(8)} ${String(record.exitCode ?? "").padEnd(5)} ${String(record.meta.activeRun).padEnd(4)} ${record.session}\n`,
      );
  }
  return 0;
}
