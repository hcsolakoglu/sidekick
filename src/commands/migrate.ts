import {
  createMigrationBatch,
  findQuarantinedRuns,
  migrateLegacyRun,
  quarantineLegacyRun,
  restoreLegacyRun,
  scanLegacyRuns,
  type LegacyRunInspection,
} from "../core/legacy-migration.js";
import { join } from "node:path";
import type { RunStore } from "../core/run-store.js";
import { CliError } from "../utils/errors.js";
import { parseOptions } from "./shared.js";

interface MigrationOutput {
  migrated: string[];
  wouldMigrate: string[];
  quarantined: Array<{ name: string; path: string }>;
  wouldQuarantine: Array<{ name: string; path: string }>;
  restored: string[];
  wouldRestore: string[];
  skipped: Array<{ name: string; reason: string }>;
  errors: Array<{ name: string; message: string }>;
  quarantineRoot?: string;
}

export async function migrateCommand(args: string[], store: RunStore): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    options: {
      apply: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      quarantine: { type: "boolean", default: false },
      restore: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  const apply = Boolean(values.apply);
  const dryRun = Boolean(values["dry-run"]);
  const quarantine = Boolean(values.quarantine);
  const restore = Boolean(values.restore);
  if (apply && dryRun) throw new CliError("--apply and --dry-run cannot be used together");
  if (restore && quarantine)
    throw new CliError("--restore and --quarantine cannot be used together");
  if (restore) {
    if (!positionals.length) throw new CliError("--restore requires at least one NAME");
    return restoreCommand(positionals, apply, Boolean(values.json), store);
  }

  const selected = positionals.length ? new Set(positionals) : null;
  const scan = await scanLegacyRuns(store);
  const output: MigrationOutput = {
    migrated: [],
    wouldMigrate: [],
    quarantined: [],
    wouldQuarantine: [],
    restored: [],
    wouldRestore: [],
    skipped: [],
    errors: [],
  };
  const batch = quarantine ? createMigrationBatch(store.root) : undefined;
  if (batch) output.quarantineRoot = batch.root;
  const entries = scan.entries.filter((entry) => !selected || selected.has(entry.name));
  const seen = new Set(entries.map((entry) => entry.name));
  if (apply && entries.length) await store.initialize();

  for (const name of positionals) {
    if (!seen.has(name)) output.skipped.push({ name, reason: "not-legacy" });
  }

  for (const entry of entries) {
    if (entry.meta) {
      if (!apply) {
        output.wouldMigrate.push(entry.name);
        continue;
      }
      try {
        const result = await migrateLegacyRun(store, entry);
        if (result === "migrated") output.migrated.push(entry.name);
        else output.skipped.push({ name: entry.name, reason: "already-managed" });
      } catch (error) {
        output.errors.push({ name: entry.name, message: errorMessage(error) });
      }
      continue;
    }

    const reason = entry.reason ?? "unreadable";
    if (quarantine && batch && reason !== "running") {
      if (!apply) {
        output.wouldQuarantine.push({ name: entry.name, path: quarantinePath(batch, entry) });
        continue;
      }
      try {
        const result = await quarantineLegacyRun(store, entry, batch);
        if (result === "quarantined")
          output.quarantined.push({ name: entry.name, path: quarantinePath(batch, entry) });
        else output.skipped.push({ name: entry.name, reason: result });
      } catch (error) {
        output.errors.push({ name: entry.name, message: errorMessage(error) });
      }
      continue;
    }
    output.skipped.push({ name: entry.name, reason });
  }

  const planning = !apply || dryRun;
  if (values.json) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } else {
    const action = planning ? "would migrate" : "migrated";
    process.stdout.write(
      `${action} ${planning ? output.wouldMigrate.length : output.migrated.length}\n`,
    );
    if (output.wouldQuarantine.length || output.quarantined.length)
      process.stdout.write(
        `${planning ? "would quarantine" : "quarantined"} ${planning ? output.wouldQuarantine.length : output.quarantined.length}\n`,
      );
  }
  if (output.skipped.length)
    process.stderr.write(`sidekick: skipped ${output.skipped.length} legacy run entries\n`);
  if (output.errors.length)
    process.stderr.write(`sidekick: failed to migrate ${output.errors.length} run entries\n`);
  return output.errors.length ? 1 : 0;
}

function quarantinePath(batch: { root: string }, entry: LegacyRunInspection): string {
  return join(batch.root, entry.name);
}

async function restoreCommand(
  names: string[],
  apply: boolean,
  json: boolean,
  store: RunStore,
): Promise<number> {
  const output = {
    restored: [] as string[],
    wouldRestore: [] as string[],
    skipped: [] as Array<{ name: string; reason: string }>,
    errors: [] as Array<{ name: string; message: string }>,
  };
  if (apply) await store.initialize();
  for (const name of names) {
    try {
      const candidates = await findQuarantinedRuns(store.root, name);
      if (!candidates.length) {
        output.skipped.push({ name, reason: "missing" });
      } else if (candidates.length > 1) {
        output.skipped.push({ name, reason: "ambiguous" });
      } else if (!apply) {
        output.wouldRestore.push(name);
      } else {
        const result = await restoreLegacyRun(store, name);
        if (result === "restored") output.restored.push(name);
        else output.skipped.push({ name, reason: result });
      }
    } catch (error) {
      output.errors.push({ name, message: errorMessage(error) });
    }
  }
  if (json) process.stdout.write(`${JSON.stringify(output)}\n`);
  else
    process.stdout.write(
      `${apply ? "restored" : "would restore"} ${apply ? output.restored.length : output.wouldRestore.length}\n`,
    );
  if (output.skipped.length)
    process.stderr.write(`sidekick: skipped ${output.skipped.length} restore entries\n`);
  if (output.errors.length)
    process.stderr.write(`sidekick: failed to restore ${output.errors.length} run entries\n`);
  return output.errors.length ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
