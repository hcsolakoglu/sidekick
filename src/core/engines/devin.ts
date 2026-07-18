import type { Engine } from "./types.js";
import { commandOverride, invocation } from "./shared.js";

export const devinEngine: Engine = {
  name: "devin",
  build(context) {
    const args = [
      "--prompt-file",
      context.promptFile,
      "--model",
      context.model || "glm-5.2",
      "--permission-mode",
      context.mode || "auto",
    ];
    if (context.action === "resume" && context.session) args.push("--resume", context.session);
    args.push("--print");
    return invocation(commandOverride("devin", "devin", context.env), args);
  },
  parse(stdout, context) {
    return { output: stdout, session: context.session };
  },
};
