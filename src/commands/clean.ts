import type { RunStore } from "../core/run-store.js";
import { refresh } from "../core/run-service.js";
import { parseOptions } from "./shared.js";

export async function cleanCommand(args: string[], store: RunStore): Promise<number> {
  const { positionals } = parseOptions(args, { options: {} });
  const targets = positionals.length
    ? positionals
    : (await store.list()).map((record) => record.meta.name);
  let removed = 0;
  for (const name of targets) {
    if (!(await store.exists(name))) continue;
    await store.withLock(name, async () => {
      const record = await refresh(store, await store.read(name));
      if (record.status === "running") {
        process.stderr.write(`sidekick: skipping running run: ${name}\n`);
        return;
      }
      await store.remove(name);
      removed += 1;
    });
  }
  process.stdout.write(`removed ${removed}\n`);
  return 0;
}
