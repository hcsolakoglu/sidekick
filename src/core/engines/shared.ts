import { CliError } from "../../utils/errors.js";

export function commandOverride(name: string, fallback: string, env: NodeJS.ProcessEnv): string[] {
  const raw = env[`SIDEKICK_ENGINE_${name.toUpperCase()}_CMD`];
  return raw ? splitCommand(raw) : [fallback];
}

export function splitCommand(raw: string): string[] {
  const values: string[] = [];
  let value = "";
  let quote = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] ?? "";
    if (quote) {
      if (char === quote) quote = "";
      else if (char === "\\" && quote === '"' && ["\\", '"'].includes(raw[index + 1] ?? ""))
        value += raw[++index];
      else value += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (/\s/u.test(char)) {
      if (value) {
        values.push(value);
        value = "";
      }
    } else value += char;
  }
  if (quote) throw new CliError("unterminated quote in engine command override");
  if (value) values.push(value);
  if (!values.length) throw new CliError("engine command override cannot be empty");
  return values;
}

export function invocation(prefix: string[], args: string[], stdin?: string) {
  const [command, ...leading] = prefix;
  if (!command) throw new CliError("engine command is empty");
  return stdin === undefined
    ? { command, args: [...leading, ...args] }
    : { command, args: [...leading, ...args], stdin };
}
