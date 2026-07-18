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
await new Promise((resolve) => setTimeout(resolve, Number(values.delay ?? 20)));
const prompt = await readFile(values["prompt-file"] ?? "", "utf8");
const session = values.session || `mock-${randomUUID()}`;
process.stdout.write(
  `SIDEKICK_MOCK_SESSION=${session}\nmock ${values.action ?? "spawn"}: ${prompt.trim()}\n`,
);
