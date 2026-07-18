import { open, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { join } from "node:path";
import type { RunStore } from "../core/run-store.js";
import { CliError } from "../utils/errors.js";
import { parseOptions } from "./shared.js";

export async function tailCommand(
  args: string[],
  store: RunStore,
  signal: AbortSignal,
): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    options: { lines: { type: "string", short: "n", default: "40" } },
  });
  const [name] = positionals;
  const lines = Number(values.lines);
  if (!name || positionals.length !== 1 || !Number.isInteger(lines) || lines < 0)
    throw new CliError("usage: sidekick tail NAME [-n LINES]");
  if (!(await store.exists(name))) throw new CliError(`unknown run: ${name}`);
  const path = join(store.runPath(name), "out.log");
  let offset = 0;
  const initial = await store.readText(path);
  const selected = initial
    .split(/\r?\n/u)
    .slice(-lines - 1)
    .join("\n");
  process.stdout.write(selected);
  offset = Buffer.byteLength(initial);
  return new Promise((resolve) => {
    const watcher = watch(store.runPath(name), (_event, file) => {
      void (async () => {
        if (file !== "out.log") return;
        try {
          const size = (await stat(path)).size;
          if (size < offset) offset = 0;
          const handle = await open(path, "r");
          const buffer = Buffer.alloc(size - offset);
          try {
            await handle.read(buffer, 0, buffer.length, offset);
          } finally {
            await handle.close();
          }
          offset = size;
          process.stdout.write(buffer);
        } catch {
          /* retry on next event */
        }
      })();
    });
    signal.addEventListener(
      "abort",
      () => {
        watcher.close();
        resolve(130);
      },
      { once: true },
    );
  });
}
