import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { refresh } from "../core/run-service.js";
import type { RunRecord, RunStore } from "../core/run-store.js";
import { isProcessAlive, processIdentityMatches } from "../core/process.js";
import { CliError } from "../utils/errors.js";
import { parseOptions } from "./shared.js";

export function changeOrDelay(
  paths: string[],
  delay: number,
  signal: AbortSignal,
  watchPath: typeof watch = watch,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    // FSWatcher teardown is timing-sensitive on Windows Node 24 and can
    // native-fast-fail during force-resend. The bounded timer is sufficient.
    const watchers =
      platform === "win32"
        ? []
        : paths.map((path) => {
            try {
              return watchPath(path, { persistent: false }, finish);
            } catch {
              return undefined;
            }
          });
    const timer = setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
    function finish(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      void Promise.all(watchers.map(closeWatcher)).then(() => resolve());
    }
  });
}

function closeWatcher(watcher: FSWatcher | undefined): Promise<void> {
  if (!watcher) return Promise.resolve();
  return new Promise((resolve) => {
    watcher.once("close", resolve);
    watcher.close();
  });
}

export function cachedIdentityMatcher(
  maximumAgeMs = 250,
  matches: typeof processIdentityMatches = processIdentityMatches,
  alive: typeof isProcessAlive = isProcessAlive,
  now: () => number = Date.now,
  platform: NodeJS.Platform = process.platform,
): typeof processIdentityMatches {
  const verified = new Map<string, number>();
  return async (pid, expected) => {
    if (platform !== "win32") return matches(pid, expected);
    if (!pid || !expected) return false;
    const key = `${pid}\0${expected}`;
    if (!alive(pid)) {
      verified.delete(key);
      return false;
    }
    const checkedAt = verified.get(key);
    if (checkedAt !== undefined && now() - checkedAt < maximumAgeMs) return true;
    const result = await matches(pid, expected);
    if (result) verified.set(key, now());
    else verified.delete(key);
    return result;
  };
}

export async function waitCommand(
  args: string[],
  store: RunStore,
  signal: AbortSignal,
): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    options: {
      timeout: { type: "string" },
      all: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  const timeout = values.timeout === undefined ? undefined : Number(values.timeout);
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 0))
    throw new CliError("--timeout must be a non-negative number");
  let records: RunRecord[];
  if (positionals.length) {
    const missing = (
      await Promise.all(positionals.map(async (name) => ((await store.exists(name)) ? "" : name)))
    ).filter(Boolean);
    if (missing.length) throw new CliError(`unknown run(s): ${missing.join(", ")}`);
    records = await Promise.all(positionals.map((name) => store.read(name)));
  } else {
    records = (await store.listSummaries()).filter((record) => record.status === "running");
    if (!records.length) throw new CliError("no running runs");
  }
  const deadline = timeout === undefined ? Infinity : Date.now() + timeout * 1000;
  const reported = new Set<string>();
  const identityMatches = cachedIdentityMatcher();
  while (true) {
    if (signal.aborted) return 130;
    records = await Promise.all(
      records.map((record) =>
        store.read(record.meta.name).then((current) => refresh(store, current, identityMatches)),
      ),
    );
    for (const record of records) {
      if (record.status !== "running" && !reported.has(record.meta.name)) {
        reported.add(record.meta.name);
        if (values.json)
          process.stdout.write(
            `${JSON.stringify({ name: record.meta.name, status: record.status, exitCode: record.exitCode, session: record.session, output: record.output })}\n`,
          );
        else {
          process.stdout.write(`${record.meta.name} ${record.exitCode ?? "?"}\n`);
          if (!values.quiet && record.output) process.stdout.write(record.output);
        }
        if (!values.all || reported.size === records.length) return 0;
      }
    }
    if (Date.now() >= deadline) return 124;
    await changeOrDelay(
      records.map((record) => store.runPath(record.meta.name)),
      Math.min(500, Math.max(1, deadline - Date.now())),
      signal,
    );
  }
}
