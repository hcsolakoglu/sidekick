import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    delay: { type: "string" },
    session: { type: "string" },
    action: { type: "string" },
    "prompt-file": { type: "string" },
  },
});
const prompt = await readFile(values["prompt-file"] ?? "", "utf8");
const session = values.session || `mock-${randomUUID()}`;
if (process.env.SIDEKICK_MOCK_STREAM_MS) {
  process.stdout.write("mock progress\n");
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.SIDEKICK_MOCK_STREAM_MS)));
}
await new Promise((resolve) => setTimeout(resolve, Number(values.delay ?? 20)));
process.stdout.write(
  `SIDEKICK_MOCK_SESSION=${session}\nmock ${values.action ?? "spawn"}: ${prompt.trim()}${"x".repeat(Number(process.env.SIDEKICK_MOCK_OUTPUT_BYTES ?? 0))}\n`,
);
