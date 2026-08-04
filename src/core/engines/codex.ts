import { readFileSync } from "node:fs";
import type { Engine } from "./types.js";
import { commandOverride, controlString, invocation } from "./shared.js";

export const codexEngine: Engine = {
  name: "codex",
  build(context) {
    const prefix = commandOverride("codex", "codex", context.env);
    const model = controlString(context.controls, "model", context.model);
    const sandbox = controlString(context.controls, "sandbox", context.mode);
    const permission = controlString(context.controls, "permission", "");
    const permissionOverride = permission ? ["-c", `approval_policy=${permission}`] : [];
    const effort = controlString(context.controls, "effort", "");
    const effortOverride = effort ? ["-c", `model_reasoning_effort=${effort}`] : [];
    const args =
      context.action === "resume" && context.session
        ? [
            "exec",
            "resume",
            "--json",
            "-o",
            context.outputFile,
            ...(model ? ["--model", model] : []),
            ...(sandbox ? ["-c", `sandbox_mode=${sandbox}`] : []),
            ...permissionOverride,
            ...effortOverride,
            context.session,
            "-",
          ]
        : [
            "exec",
            "--json",
            "-o",
            context.outputFile,
            "--skip-git-repo-check",
            ...(model ? ["--model", model] : []),
            ...(sandbox ? ["--sandbox", sandbox] : []),
            ...permissionOverride,
            ...effortOverride,
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
