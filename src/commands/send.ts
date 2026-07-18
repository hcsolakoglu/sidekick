import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { forceStop, refresh, startWorker, withEngineSlot } from "../core/run-service.js";
import type { RunStore } from "../core/run-store.js";
import { CliError } from "../utils/errors.js";
import { fallbackPrompt, parseOptions, promptFrom } from "./shared.js";

export async function sendCommand(args: string[], store: RunStore): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    options: {
      force: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  const [name, ...promptParts] = positionals;
  if (!name) throw new CliError("usage: sidekick send NAME [--force] -- PROMPT");
  const prompt = await promptFrom(promptParts);
  await store.withLock(name, async () => {
    if (!(await store.exists(name))) throw new CliError(`unknown run: ${name}`);
    let record = await refresh(store, await store.read(name));
    if (record.status === "running") {
      if (!values.force)
        throw new CliError(`run is still running: ${name}; use --force to stop it and resend`);
      await forceStop(store, record);
      record = await store.read(name);
    }
    const number = await store.nextTurn(name);
    let actual = prompt;
    let action: "resume" | "fallback" = "resume";
    if (!record.session) {
      const entries = await readdir(store.runPath(name));
      const turns = entries
        .map((value) => /^run-(\d+)$/u.exec(value)?.[1])
        .filter(Boolean)
        .map(Number)
        .sort((a, b) => a - b);
      actual = await fallbackPrompt(store.runPath(name), turns, prompt);
      action = "fallback";
    }
    await withEngineSlot(store, record.meta.engine, async () => {
      const turn = await store.initializeTurn(name, number, actual, record.session);
      await Promise.all([
        store.atomicWrite(join(turn, "followup"), prompt),
        store.atomicWrite(join(turn, "resume_mode"), `${action}\n`),
      ]);
      await startWorker(store, name, number, action);
    });
  });
  const current = await store.read(name);
  process.stdout.write(
    values.json
      ? `${JSON.stringify({ name, engine: current.meta.engine, status: current.status, run: current.meta.activeRun })}\n`
      : `${name}\n`,
  );
  return 0;
}
