import { randomUUID } from "node:crypto";
import { access, lstat, mkdir, readFile, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { engineNames } from "./engines/index.js";
import type { EngineName } from "./engines/types.js";
import { processIdentityMatches } from "./process.js";
import { RunStore, validateName, type RunMeta } from "./run-store.js";

const TERMINAL_STATUSES = new Set(["done", "died", "cancelled"]);
const KNOWN_STATUSES = new Set(["running", ...TERMINAL_STATUSES]);

export interface LegacyRunInspection {
  name: string;
  source: string;
  status: string;
  pid: number | null;
  identity: string;
  meta?: RunMeta;
  reason?: string;
}

export interface LegacyRunScan {
  entries: LegacyRunInspection[];
}

export interface MigrationBatch {
  root: string;
  id: string;
}

export type QuarantineResult =
  "quarantined" | "already-managed" | "running" | "eligible" | "invalid-name";

export type RestoreResult = "restored" | "missing" | "target-exists" | "ambiguous";

export function createMigrationBatch(root: string): MigrationBatch {
  const id = `${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;
  return { id, root: join(root, "legacy-quarantine", id) };
}

export async function scanLegacyRuns(store: RunStore): Promise<LegacyRunScan> {
  let entries: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    entries = await readdir(store.runs, { withFileTypes: true });
  } catch {
    return { entries: [] };
  }

  const legacy: LegacyRunInspection[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const source = join(store.runs, entry.name);
    let isDirectory = entry.isDirectory();
    if (!isDirectory) {
      try {
        isDirectory = (await lstat(source)).isDirectory();
      } catch {
        continue;
      }
    }
    if (!isDirectory || (await fileExists(join(source, "meta.json")))) continue;
    legacy.push(await inspectLegacyRun(source, entry.name));
  }
  return { entries: legacy };
}

export async function migrateLegacyRun(
  store: RunStore,
  entry: LegacyRunInspection,
): Promise<"migrated" | "already-managed" | "skipped"> {
  if (!entry.meta) return "skipped";
  return store.withLock(entry.name, async () => {
    if (await fileExists(join(entry.source, "meta.json"))) return "already-managed";
    const current = await inspectLegacyRun(entry.source, entry.name);
    if (!current.meta) return "skipped";
    const metadataPath = join(entry.source, "meta.json");
    await store.atomicWrite(metadataPath, `${JSON.stringify(current.meta, null, 2)}\n`);
    try {
      const migrated = await store.readSummary(entry.name);
      if (migrated.meta.schemaVersion !== 1 || migrated.meta.name !== entry.name)
        throw new Error("metadata validation failed");
    } catch (error) {
      await unlink(metadataPath).catch(() => undefined);
      throw error;
    }
    return "migrated";
  });
}

export async function quarantineLegacyRun(
  store: RunStore,
  entry: LegacyRunInspection,
  batch: MigrationBatch,
): Promise<QuarantineResult> {
  try {
    validateName(entry.name);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("name must match"))
      return "invalid-name";
    throw error;
  }
  const destination = join(batch.root, entry.name);
  const move = async () => {
    if (await fileExists(join(entry.source, "meta.json"))) return "already-managed" as const;
    const current = await inspectLegacyRun(entry.source, entry.name);
    if (current.reason === "running") return "running" as const;
    if (current.meta) return "eligible" as const;
    await mkdir(batch.root, { recursive: true, mode: 0o700 });
    await rename(entry.source, destination);
    return "quarantined" as const;
  };

  return store.withLock(entry.name, move);
}

export async function restoreLegacyRun(store: RunStore, name: string): Promise<RestoreResult> {
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") return "missing";
  try {
    validateName(name);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("name must match")) return "missing";
    throw error;
  }
  const candidates = await findQuarantinedRuns(store.root, name);
  if (!candidates.length) return "missing";
  if (candidates.length > 1) return "ambiguous";
  const source = candidates[0];
  if (!source) return "missing";
  const target = join(store.runs, name);
  const move = async (): Promise<RestoreResult> => {
    if (await fileExists(target)) return "target-exists";
    await rename(source, target);
    return "restored";
  };
  return store.withLock(name, move);
}

async function inspectLegacyRun(source: string, name: string): Promise<LegacyRunInspection> {
  const base: LegacyRunInspection = {
    name,
    source,
    status: "",
    pid: null,
    identity: "",
  };
  try {
    validateName(name);
    const engineValue = await requiredText(source, "engine");
    const directory = await requiredText(source, "dir");
    const activeRunValue = await requiredText(source, "active_run");
    const status = await requiredText(source, "status");
    const activeRun = Number(activeRunValue);
    base.status = status;
    base.pid = parsePid(await optionalText(source, "pid"));
    base.identity = (await optionalText(source, "identity")).trim();

    if (!engineNames.includes(engineValue as EngineName)) {
      return { ...base, reason: "unknown-engine" };
    }
    if (!Number.isSafeInteger(activeRun) || activeRun <= 0) {
      return { ...base, reason: "invalid-active-run" };
    }
    if (!KNOWN_STATUSES.has(status)) {
      return (await isLive(base.pid, base.identity))
        ? { ...base, reason: "running" }
        : { ...base, reason: "unknown-status" };
    }
    if (status === "running") {
      if (!base.pid) return { ...base, reason: "running" };
      return (await isLive(base.pid, base.identity))
        ? { ...base, reason: "running" }
        : { ...base, reason: "stale-running" };
    }

    const times = await treeModificationTimes(source);
    const model = (await optionalText(source, "model")).trim();
    const mode = (await optionalText(source, "mode")).trim();
    const onComplete = (await optionalText(source, "on_complete")).trim();
    const meta: RunMeta = {
      schemaVersion: 1,
      name,
      engine: engineValue as EngineName,
      directory,
      model,
      mode,
      activeRun,
      createdAt: new Date(times.min).toISOString(),
      updatedAt: new Date(times.max).toISOString(),
      ...(onComplete ? { onComplete } : {}),
    };
    return {
      ...base,
      status,
      meta,
    };
  } catch (error) {
    return {
      ...base,
      reason: error instanceof Error ? error.message : "unreadable",
    };
  }
}

async function requiredText(source: string, name: string): Promise<string> {
  const value = (await readFile(join(source, name), "utf8")).trim();
  if (!value) throw new Error(`missing-${name}`);
  return value;
}

async function optionalText(source: string, name: string): Promise<string> {
  try {
    return await readFile(join(source, name), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function parsePid(value: string): number | null {
  return /^\d+$/u.test(value.trim()) ? Number(value.trim()) : null;
}

async function isLive(pid: number | null, identity: string): Promise<boolean> {
  if (!pid) return false;
  if (identity) return processIdentityMatches(pid, identity);
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function treeModificationTimes(path: string): Promise<{ min: number; max: number }> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error("contains-symlink");
  let min = info.mtimeMs;
  let max = info.mtimeMs;
  if (!info.isDirectory()) return { min, max };
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = await treeModificationTimes(join(path, entry.name));
    min = Math.min(min, child.min);
    max = Math.max(max, child.max);
  }
  return { min, max };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findQuarantinedRuns(root: string, name: string): Promise<string[]> {
  const quarantineRoot = join(root, "legacy-quarantine");
  let batches: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    batches = await readdir(quarantineRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const batch of batches) {
    if (!batch.isDirectory()) continue;
    const candidate = join(quarantineRoot, batch.name, name);
    try {
      if ((await lstat(candidate)).isDirectory()) paths.push(candidate);
    } catch {
      /* A quarantine entry may have been restored or removed concurrently. */
    }
  }
  return paths;
}
