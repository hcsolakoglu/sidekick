import type { Engine, EngineResult } from "./types.js";
import { commandOverride, controlBoolean, controlString, invocation } from "./shared.js";

/**
 * Command Code exits 0 when a tool call is denied by the user's `ask` permission rules:
 * headless runs cannot prompt, so the policy denial ends the run as a normal stop.
 * Sidekick records this dedicated code so a dispatcher never mistakes it for success.
 */
export const PERMISSION_DENIED_EXIT_CODE = 126;

const MAX_DENIED_COMMAND_LENGTH = 200;

interface EventRecord {
  type?: unknown;
  sessionId?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  result?: unknown;
  event?: unknown;
  finalText?: unknown;
  stopReason?: unknown;
  nextState?: unknown;
  subtype?: unknown;
}

export const commandcodeEngine: Engine = {
  name: "commandcode",
  options: { addDirs: true },
  build(context) {
    const model = controlString(context.controls, "model", context.model);
    const effort = controlString(context.controls, "effort", "");
    const permission = controlString(context.controls, "permission", "");
    const maxTurns = controlString(context.controls, "maxTurns", "");
    const toolsAll = controlBoolean(context.controls, "toolsAll");
    const args = [`--print=${context.prompt}`, "--output-format", "json"];
    if (context.action === "resume" && context.session) args.push("--resume", context.session);
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    if (permission === "yolo") args.push("--yolo");
    else if (permission) args.push("--permission-mode", permission);
    if (maxTurns) args.push("--max-turns", maxTurns);
    if (toolsAll === true) args.push("--tools-all");
    for (const directory of context.addDirs ?? []) args.push("--add-dir", directory);
    // Headless hygiene: a detached worker cannot answer a trust or onboarding prompt,
    // and a self-update would restart the binary in the middle of a turn.
    args.push("--trust", "--skip-onboarding", "--no-auto-update");
    return invocation(commandOverride("commandcode", "commandcode", context.env), args);
  },
  parse(stdout, context): EngineResult {
    let session = context.action === "resume" ? context.session : "";
    let finalText = "";
    let stopReason = "";
    let subtype = "";
    let sawStream = false;
    const queuedTools = new Map<string, unknown>();
    const denied: Array<{ toolName: string; command: string }> = [];
    for (const line of stdout.split(/\r?\n/u)) {
      const value = parseRecord(line);
      if (!value) continue;
      sawStream = true;
      const event =
        value.type === "event" && isRecord(value.event) ? (value.event as EventRecord) : undefined;
      if (event) {
        if (event.type === "run_start" && typeof event.sessionId === "string")
          session = event.sessionId;
        else if (event.type === "tool_queued" && typeof event.toolCallId === "string")
          queuedTools.set(event.toolCallId, event.input);
        else if (event.type === "tool_denied" && typeof event.toolName === "string") {
          const input =
            typeof event.toolCallId === "string" ? queuedTools.get(event.toolCallId) : undefined;
          denied.push({ toolName: event.toolName, command: deniedCommand(input) });
        } else if (event.type === "run_end" && isRecord(event.result)) {
          const result = event.result as EventRecord;
          if (!finalText && typeof result.finalText === "string") finalText = result.finalText;
          if (!stopReason && typeof result.stopReason === "string") stopReason = result.stopReason;
          const state = isRecord(result.nextState) ? (result.nextState as EventRecord) : undefined;
          if (!session && typeof state?.sessionId === "string") session = state.sessionId;
        }
        continue;
      }
      if (value.type !== "result") continue;
      subtype = typeof value.subtype === "string" ? value.subtype : subtype;
      if (typeof value.sessionId === "string" && value.sessionId) session = value.sessionId;
      if (typeof value.finalText === "string" && value.finalText) finalText = value.finalText;
      if (typeof value.stopReason === "string" && value.stopReason) stopReason = value.stopReason;
    }
    if (subtype === "max_turns" && !stopReason) stopReason = "max_turns";
    const notes: string[] = [];
    let exitCode: number | undefined;
    if (stopReason === "permission_denied") {
      exitCode = PERMISSION_DENIED_EXIT_CODE;
      notes.push(
        "sidekick: commandcode stopped with permission_denied: a tool call required approval and headless runs treat ask rules as denials.",
      );
      for (const entry of denied)
        notes.push(
          `sidekick: denied tool: ${entry.toolName}${entry.command ? ` (${entry.command})` : ""}`,
        );
    } else if (stopReason === "max_turns" || subtype === "max_turns") {
      notes.push("sidekick: commandcode reached its max-turns cap (exit code 8).");
    } else if (stopReason && stopReason !== "end_turn") {
      notes.push(`sidekick: commandcode stopped with ${stopReason}.`);
    }
    const output = [finalText.trimEnd(), ...notes].filter(Boolean).join("\n");
    return {
      session,
      // A parsed event stream already lives in raw.log; only unparsable stdout is echoed back.
      output: output || (sawStream ? "" : stdout),
      ...(exitCode === undefined ? {} : { exitCode }),
    };
  },
};

function parseRecord(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only a one-line shell command is surfaced; other tool inputs may hold file or prompt content. */
function deniedCommand(input: unknown): string {
  if (!isRecord(input) || typeof input.command !== "string") return "";
  const command = input.command.replace(/\s/gu, " ").trim();
  return command.length > MAX_DENIED_COMMAND_LENGTH
    ? `${command.slice(0, MAX_DENIED_COMMAND_LENGTH)}…`
    : command;
}
