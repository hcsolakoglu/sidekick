import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { CliError } from "../utils/errors.js";

export function parseOptions<T extends ParseArgsConfig>(args: string[], config: T) {
  try {
    return parseArgs({ ...config, args, strict: true, allowPositionals: true });
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
}

export async function directory(value: string | undefined): Promise<string> {
  const path = resolve(value ?? process.cwd());
  try {
    if ((await stat(path)).isDirectory()) return path;
  } catch {
    /* handled below */
  }
  throw new CliError(`not a directory: ${path}`);
}

export async function promptFrom(positionals: string[]): Promise<string> {
  if (positionals.length) return positionals.join(" ");
  if (!process.stdin.isTTY && process.env.CI !== "true") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
    const value = Buffer.concat(chunks).toString("utf8");
    if (value) return value;
  }
  throw new CliError("prompt required after -- or on stdin");
}

export async function fallbackPrompt(
  base: string,
  turns: number[],
  followup: string,
): Promise<string> {
  const chunks = [
    "A previous harness session could not be resumed because no session ID was exposed.",
    "Use this recorded transcript as context, then answer the final FOLLOW-UP.\n",
  ];
  for (const number of turns) {
    const root = `${base}/run-${number}`;
    const oldPrompt = await readFile(`${root}/prompt`, "utf8").catch(() => "");
    const oldOutput = await readFile(`${root}/out.log`, "utf8").catch(() => "");
    chunks.push(
      `USER (run-${number}):\n${oldPrompt.trim()}`,
      `ASSISTANT (run-${number}):\n${oldOutput.trim()}`,
    );
  }
  chunks.push(`FOLLOW-UP:\n${followup}`);
  return chunks.join("\n\n");
}
