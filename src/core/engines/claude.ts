import type { Engine } from "./types.js";
import { commandOverride, controlString, invocation } from "./shared.js";

export const claudeEngine: Engine = {
  name: "claude",
  build(context) {
    const args = ["--print", "--output-format", "json"];
    const model = controlString(context.controls, "model", context.model);
    const permission = controlString(context.controls, "permission", context.mode);
    if (model) args.push("--model", model);
    if (permission)
      args.push("--permission-mode", permission === "accept-edits" ? "acceptEdits" : permission);
    const effort = controlString(context.controls, "effort", "");
    if (effort) args.push("--effort", effort);
    if (context.action === "resume" && context.session) args.push("--resume", context.session);
    return invocation(commandOverride("claude", "claude", context.env), args, context.prompt);
  },
  parse(stdout, context) {
    try {
      const value = JSON.parse(stdout) as { session_id?: string; result?: string };
      return { session: value.session_id ?? context.session, output: value.result ?? stdout };
    } catch {
      return { session: context.session, output: stdout };
    }
  },
};
