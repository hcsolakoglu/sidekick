import type { Engine } from "./types.js";
import { commandOverride, controlBoolean, controlString, invocation } from "./shared.js";

export const devinEngine: Engine = {
  name: "devin",
  build(context) {
    const model = controlString(context.controls, "model", context.model || "glm-5.2");
    const permission = controlString(context.controls, "permission", context.mode || "auto");
    const sandbox = controlBoolean(context.controls, "sandbox");
    const workspaceTrust = controlBoolean(context.controls, "workspaceTrust");
    const args = [
      "--prompt-file",
      context.promptFile,
      "--model",
      model,
      "--permission-mode",
      permission,
    ];
    if (sandbox === true) args.push("--sandbox");
    if (workspaceTrust !== undefined)
      args.push("--respect-workspace-trust", String(workspaceTrust));
    if (context.action === "resume" && context.session) args.push("--resume", context.session);
    args.push("--print");
    return invocation(commandOverride("devin", "devin", context.env), args);
  },
  parse(stdout, context) {
    return { output: stdout, session: context.session };
  },
};
