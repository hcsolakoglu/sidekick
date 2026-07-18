import type { Engine } from "./types.js";
import { commandOverride, invocation } from "./shared.js";

export const claudeEngine: Engine = {
  name: "claude",
  build(context) {
    const args = ["--print", "--output-format", "json"];
    if (context.model) args.push("--model", context.model);
    if (context.mode)
      args.push(
        "--permission-mode",
        context.mode === "accept-edits" ? "acceptEdits" : context.mode,
      );
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
