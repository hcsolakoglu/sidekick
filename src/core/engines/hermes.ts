import type { Engine } from "./types.js";
import { commandOverride, invocation } from "./shared.js";

export const hermesEngine: Engine = {
  name: "hermes",
  build(context) {
    const args = ["--pass-session-id"];
    if (context.model) args.push("--model", context.model);
    if (context.action === "resume" && context.session) args.push("--resume", context.session);
    args.push("--oneshot", context.prompt);
    return invocation(commandOverride("hermes", "hermes", context.env), args);
  },
  parse(stdout, context) {
    const lines = stdout.split(/\r?\n/u);
    const match = lines.find((line) => /^SESSION_ID=/u.test(line));
    return {
      session: match?.slice("SESSION_ID=".length).trim() || context.session,
      output: stdout,
    };
  },
};
