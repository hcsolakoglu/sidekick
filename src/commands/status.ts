import { refresh } from "../core/run-service.js";
import type { RunRecord, RunStore } from "../core/run-store.js";
import { CliError } from "../utils/errors.js";
import { parseOptions } from "./shared.js";

const DEFAULT_STATUS_LIMIT = 20;
const MAX_STATUS_LIMIT = 1000;

export interface StatusJson {
  name: string;
  engine: string;
  status: string;
  exitCode: number | null;
  run: number;
  session: string;
  directory: string;
  updatedAt: string;
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
    updatedAt: record.meta.updatedAt,
  };
}

export async function statusCommand(args: string[], store: RunStore): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    options: {
      all: { type: "boolean", default: false },
      limit: { type: "string", default: String(DEFAULT_STATUS_LIMIT) },
      running: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  if (positionals.length) throw new CliError("status takes no positional arguments");

  const limit = parseStatusLimit(values.limit);
  const scan = await store.scanSummaries();
  const refreshed = new Map(
    await Promise.all(
      scan.records
        .filter((record) => record.status === "running")
        .map(async (record) => [record.meta.name, await refresh(store, record)] as const),
    ),
  );
  const records = scan.records.map((record) => refreshed.get(record.meta.name) ?? record);
  const ordered = records.sort(compareRecords);
  const running = ordered.filter((record) => record.status === "running");
  const terminal = ordered.filter((record) => record.status !== "running");
  const visible = values.running
    ? running
    : values.all
      ? ordered
      : [...running, ...terminal.slice(0, limit)];
  const total = values.running ? running.length : ordered.length;
  const report = {
    runs: visible.map(statusJson),
    total,
    shown: visible.length,
    truncated: visible.length < total,
    skipped: scan.skipped,
  };
  if (values.json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    process.stdout.write(
      `${"NAME".padEnd(32)} ${"ENGINE".padEnd(8)} ${"STATUS".padEnd(10)} ${"EXIT".padEnd(5)} ${"RUN".padEnd(4)} ${"UPDATED".padEnd(24)} SESSION\n`,
    );
    for (const record of visible)
      process.stdout.write(
        `${record.meta.name.padEnd(32)} ${record.meta.engine.padEnd(8)} ${record.status.padEnd(10)} ${String(record.exitCode ?? "").padEnd(5)} ${String(record.meta.activeRun).padEnd(4)} ${record.meta.updatedAt.padEnd(24)} ${record.session}\n`,
      );
  }
  if (report.truncated)
    process.stderr.write(
      `sidekick: showing ${report.shown} of ${report.total} runs; use --all for complete history\n`,
    );
  if (scan.skipped.length) {
    const names = scan.skipped.map((entry) => `${entry.name} (${entry.reason})`).join(", ");
    process.stderr.write(
      `sidekick: skipped ${scan.skipped.length} run directories: ${names}; inspect with clean --dry-run\n`,
    );
  }
  return 0;
}

function parseStatusLimit(value: string | undefined): number {
  if (!value || !/^\d+$/u.test(value)) throw new CliError("--limit must be a non-negative integer");
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit > MAX_STATUS_LIMIT)
    throw new CliError(`--limit must be between 0 and ${MAX_STATUS_LIMIT}`);
  return limit;
}

function compareRecords(left: RunRecord, right: RunRecord): number {
  const runningDifference = Number(right.status === "running") - Number(left.status === "running");
  if (runningDifference) return runningDifference;
  return (
    right.meta.updatedAt.localeCompare(left.meta.updatedAt) ||
    left.meta.name.localeCompare(right.meta.name)
  );
}
