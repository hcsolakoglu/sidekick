import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Engine } from "./types.js";
import { invocation } from "./shared.js";

export const mockEngine: Engine = {
  name: "mock",
  build(context) {
    return invocation(
      [process.execPath],
      [
        fileURLToPath(new URL("./mock-runner.js", import.meta.url)),
        "--delay",
        String(context.delayMs),
        "--session",
        context.session,
        "--action",
        context.action,
        "--prompt-file",
        context.promptFile,
      ],
    );
  },
  parse(stdout, context) {
    const match = stdout.match(/^SIDEKICK_MOCK_SESSION=(.+)$/mu);
    const session = match?.[1]?.trim() || context.session || `mock-${randomUUID()}`;
    return { session, output: stdout.replace(/^SIDEKICK_MOCK_SESSION=.*\r?\n?/mu, "") };
  },
};
