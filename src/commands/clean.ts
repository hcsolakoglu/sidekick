import type { RunStore } from "../core/run-store.js";
import { refresh } from "../core/run-service.js";
import { CliError } from "../utils/errors.js";
import {
  matchesRunFilters,
  normalizeDirectoryFilter,
  parseEngineFilter,
  parseOptions,
} from "./shared.js";

const TERMINAL_STATUSES = new Set(["done", "died", "cancelled"]);

export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/u.exec(value.trim());
  if (!match) throw new CliError("duration must look like 30m, 24h, or 7d");
  const amount = Number(match[1]);
  const units: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return amount * (units[match[2] ?? ""] ?? 0);
}

export async function cleanCommand(args: string[], store: RunStore): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    options: {
      "older-than": { type: "string" },
      "keep-last": { type: "string", default: "0" },
      "dry-run": { type: "boolean", default: false },
      engine: { type: "string" },
      dir: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const keepLast = Number(values["keep-last"]);
  if (!Number.isInteger(keepLast) || keepLast < 0)
    throw new CliError("--keep-last must be a non-negative integer");
  const cutoff = values["older-than"] ? Date.now() - parseDuration(values["older-than"]) : Infinity;
  const selected = positionals.length ? new Set(positionals) : null;
  const engineFilter = parseEngineFilter(values.engine);
  const directoryFilter = normalizeDirectoryFilter(values.dir);
  const filters = {
    ...(engineFilter ? { engine: engineFilter } : {}),
    ...(directoryFilter ? { directory: directoryFilter } : {}),
  };
  const scan = await store.scanSummaries();
  const records = (
    await Promise.all(
      scan.records
        .filter((record) => matchesRunFilters(record, filters))
        .map((record) =>
          record.status === "running" ? refresh(store, record) : Promise.resolve(record),
        ),
    )
  )
    .filter((record) => !selected || selected.has(record.meta.name))
    .sort(
      (left, right) =>
        right.meta.updatedAt.localeCompare(left.meta.updatedAt) ||
        left.meta.name.localeCompare(right.meta.name),
    );
  const protectedNames = new Set(
    records
      .filter((record) => TERMINAL_STATUSES.has(record.status))
      .slice(0, keepLast)
      .map((record) => record.meta.name),
  );
  const removed: string[] = [];
  const wouldRemove: string[] = [];
  const skippedRunning: string[] = [];
  const skippedUnknown: string[] = [];
  const kept: string[] = [];
  for (const record of records) {
    const name = record.meta.name;
    if (record.status === "running") {
      skippedRunning.push(name);
      process.stderr.write(`sidekick: skipping running run: ${name}\n`);
      continue;
    }
    if (!TERMINAL_STATUSES.has(record.status)) {
      skippedUnknown.push(name);
      process.stderr.write(`sidekick: skipping run with unknown status: ${name}\n`);
      continue;
    }
    const updatedAt = Date.parse(record.meta.updatedAt);
    if (protectedNames.has(name) || !Number.isFinite(updatedAt) || updatedAt > cutoff) {
      kept.push(name);
      continue;
    }
    if (values["dry-run"]) {
      wouldRemove.push(name);
      continue;
    }
    await store.withLock(name, async () => {
      const current = await refresh(store, await store.readSummary(name), undefined, false);
      if (current.status === "running") {
        skippedRunning.push(name);
        return;
      }
      if (!TERMINAL_STATUSES.has(current.status)) {
        skippedUnknown.push(name);
        return;
      }
      await store.remove(name);
      removed.push(name);
    });
  }
  const skipped = scan.skipped.filter(
    (entry) =>
      (!selected || selected.has(entry.name)) &&
      (!engineFilter || entry.engine === engineFilter) &&
      (!directoryFilter ||
        (entry.directory && normalizeDirectoryFilter(entry.directory) === directoryFilter)),
  );
  if (values.json)
    process.stdout.write(
      `${JSON.stringify({ removed, wouldRemove, skippedRunning, skippedUnknown, kept, skipped, filters: { engine: engineFilter ?? null, directory: directoryFilter ?? null } })}\n`,
    );
  else
    process.stdout.write(
      `${values["dry-run"] ? "would remove" : "removed"} ${values["dry-run"] ? wouldRemove.length : removed.length}\n`,
    );
  if (skipped.length)
    process.stderr.write(
      `sidekick: skipped ${skipped.length} unreadable or legacy run directories; only readable terminal runs are eligible\n`,
    );
  return 0;
}
