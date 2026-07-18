import { readFileSync } from "node:fs";
import type { Engine } from "./types.js";
import { commandOverride, invocation } from "./shared.js";

export const codexEngine: Engine = {
  name: "codex",
  build(context) {
    const prefix = commandOverride("codex", "codex", context.env);
    const args =
      context.action === "resume" && context.session
        ? [
            "exec",
            "resume",
            "--json",
            "-o",
            context.outputFile,
            ...(context.model ? ["--model", context.model] : []),
            context.session,
            "-",
          ]
        : [
            "exec",
            "--json",
            "-o",
            context.outputFile,
            "--skip-git-repo-check",
            ...(context.model ? ["--model", context.model] : []),
            ...(context.mode ? ["--sandbox", context.mode] : []),
            "-",
          ];
    return invocation(prefix, args, context.prompt);
  },
  parse(stdout, context) {
    let session = context.action === "resume" ? context.session : "";
    const messages: string[] = [];
    for (const line of stdout.split(/\r?\n/u)) {
      try {
        const event = JSON.parse(line) as {
          type?: string;
          thread_id?: string;
          item?: { type?: string; text?: string };
        };
        if (event.type === "thread.started") session = event.thread_id ?? "";
        if (
          event.type === "item.completed" &&
          event.item?.type === "agent_message" &&
          event.item.text
        )
          messages.push(event.item.text);
      } catch {
        /* non-JSON output is retained as fallback */
      }
    }
    let fileOutput = "";
    try {
      fileOutput = readFileSync(context.outputFile, "utf8").trim();
    } catch {
      /* optional */
    }
    return { session, output: fileOutput || messages.join("\n") || stdout };
  },
};
