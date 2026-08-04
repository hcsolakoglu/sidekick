import { spawnSync } from "node:child_process";
import { CliError } from "../utils/errors.js";
import type { EngineName } from "./engines/types.js";
import { splitCommand } from "./engines/shared.js";

export type ControlAction = "initial" | "adopt" | "resume" | "fallback";
export type ControlAxis =
  | "model"
  | "provider"
  | "transport"
  | "effort"
  | "permission"
  | "sandbox"
  | "workspaceTrust"
  | "agentProfile"
  | "budget"
  | "cwdRestore";
export type Transport =
  "cli-subprocess" | "chat-completions" | "responses" | "stdin" | "prompt-file" | "unknown";
export type ObservationStatus = "requested" | "applied" | "clamped" | "unknown" | "unsupported";
export type ObservationSource =
  | "user"
  | "legacy"
  | "adapter"
  | "native-argv"
  | "native-config"
  | "native-environment"
  | "provider-reported"
  | "runtime-output"
  | "unknown";
export type CapabilitySupport = "native" | "unsupported" | "simulated" | "unverified";

export interface ControlObservation<T> {
  requested: T | null;
  applied: {
    mechanism:
      "cli-flag" | "config-override" | "model-variant" | "inherit-native" | "omitted" | "none";
    value: T | string | null;
    source: ObservationSource;
    key?: string;
    configPath?: string;
    observedValueRedacted?: string;
    reason?: string;
    argv?: string[];
  } | null;
  effective: {
    value: T | string | null;
    source: "provider-reported" | "runtime-output" | "unknown";
    fieldPath?: string;
    artifactPath?: string;
    observedValueRedacted?: string;
    reason?: string;
  } | null;
  status: ObservationStatus;
}

export interface HarnessControls {
  model: ControlObservation<string>;
  provider: ControlObservation<string>;
  transport: ControlObservation<Transport>;
  effort: ControlObservation<string>;
  permission: ControlObservation<string>;
  sandbox: ControlObservation<string | boolean>;
  workspaceTrust: ControlObservation<boolean>;
  agentProfile: ControlObservation<string>;
  budget: ControlObservation<string>;
  cwdRestore: ControlObservation<boolean>;
}

export interface CapabilityRecord {
  engine: EngineName;
  provider: string;
  model: string;
  transport: Transport;
  toolVersion: string;
  axis: ControlAxis;
  action: ControlAction;
  support: CapabilitySupport;
  modelDependent: boolean;
  values?: readonly string[];
  verifiedModels?: readonly string[];
  detail: string;
}

export interface ResolveControlsInput {
  engine: EngineName;
  provider?: string;
  model?: string;
  transport?: Transport;
  mode?: string;
  effort?: string;
  permission?: string;
  sandbox?: string | boolean;
  workspaceTrust?: boolean;
  agentProfile?: string;
  budget?: string;
  cwdRestore?: boolean;
  action: ControlAction;
  toolVersion?: string;
}

export const CONTROL_AXES: readonly ControlAxis[] = [
  "model",
  "provider",
  "transport",
  "effort",
  "permission",
  "sandbox",
  "workspaceTrust",
  "agentProfile",
  "budget",
  "cwdRestore",
];

const DEVIN_VERSION = "devin 3000.3.27";
const CODEX_VERSION = "codex-cli 0.146.0";
const CLAUDE_VERSION = "2.1.221 (Claude Code)";
const SIMULATED_VERSION = "simulated";
const DEFAULT_PROVIDER = "native";
const DEFAULT_TRANSPORT: Transport = "cli-subprocess";

const CLAUDE_EFFORT_ALL_MODELS = [
  "fable",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
] as const;
const CLAUDE_EFFORT_LIMITED_MODELS = ["claude-opus-4-6", "claude-sonnet-4-6"] as const;

function claudeEffortRecords(action: ControlAction): CapabilityRecord[] {
  const all = CLAUDE_EFFORT_ALL_MODELS.map((model) =>
    record(
      "claude",
      "native",
      model,
      DEFAULT_TRANSPORT,
      CLAUDE_VERSION,
      "effort",
      action,
      "native",
      false,
      "Claude model supports the full locally documented effort range.",
      undefined,
      ["low", "medium", "high", "xhigh", "max"],
    ),
  );
  const limited = CLAUDE_EFFORT_LIMITED_MODELS.map((model) =>
    record(
      "claude",
      "native",
      model,
      DEFAULT_TRANSPORT,
      CLAUDE_VERSION,
      "effort",
      action,
      "native",
      false,
      "Claude model supports effort without xhigh.",
      undefined,
      ["low", "medium", "high", "max"],
    ),
  );
  return [...all, ...limited];
}

function adapterSurfaceRecords(
  engine: EngineName,
  toolVersion: string,
  actions: readonly ControlAction[] = ["initial", "adopt", "resume", "fallback"],
): CapabilityRecord[] {
  return actions.flatMap((action) => [
    record(
      engine,
      DEFAULT_PROVIDER,
      "*",
      DEFAULT_TRANSPORT,
      toolVersion,
      "provider",
      action,
      "native",
      false,
      "Native provider is the evidenced provider.",
      undefined,
      [DEFAULT_PROVIDER],
    ),
    record(
      engine,
      DEFAULT_PROVIDER,
      "*",
      DEFAULT_TRANSPORT,
      toolVersion,
      "transport",
      action,
      "native",
      false,
      "CLI subprocess is the evidenced transport.",
      undefined,
      [DEFAULT_TRANSPORT],
    ),
  ]);
}

export const capabilityRegistry: readonly CapabilityRecord[] = [
  record(
    "mock",
    "native",
    "",
    DEFAULT_TRANSPORT,
    SIMULATED_VERSION,
    "model",
    "initial",
    "simulated",
    false,
    "Deterministic mock model observation.",
  ),
  record(
    "mock",
    "native",
    "",
    DEFAULT_TRANSPORT,
    SIMULATED_VERSION,
    "permission",
    "initial",
    "simulated",
    false,
    "Deterministic mock permission observation.",
  ),
  record(
    "mock",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    SIMULATED_VERSION,
    "effort",
    "initial",
    "simulated",
    false,
    "Deterministic mock effort observation.",
    undefined,
    ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"],
  ),
  record(
    "mock",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    SIMULATED_VERSION,
    "effort",
    "resume",
    "simulated",
    false,
    "Deterministic mock effort observation.",
    undefined,
    ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"],
  ),
  record(
    "mock",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    SIMULATED_VERSION,
    "effort",
    "adopt",
    "simulated",
    false,
    "Deterministic mock effort observation.",
    undefined,
    ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"],
  ),
  record(
    "mock",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    SIMULATED_VERSION,
    "effort",
    "fallback",
    "simulated",
    false,
    "Deterministic mock effort observation.",
    undefined,
    ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "provider",
    "initial",
    "native",
    false,
    "Native provider is the only evidenced provider.",
    undefined,
    ["native"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "transport",
    "initial",
    "native",
    false,
    "CLI subprocess is the evidenced transport.",
    undefined,
    ["cli-subprocess"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "permission",
    "initial",
    "native",
    false,
    "Codex approval_policy is applied through -c.",
    undefined,
    ["untrusted", "on-request", "never", "granular"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "sandbox",
    "initial",
    "native",
    false,
    "Initial --sandbox value is accepted by codex exec.",
    undefined,
    ["read-only", "workspace-write", "danger-full-access"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "sandbox",
    "resume",
    "native",
    false,
    "Resume uses -c sandbox_mode because resume help omits --sandbox.",
    undefined,
    ["read-only", "workspace-write", "danger-full-access"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "effort",
    "initial",
    "native",
    true,
    "model_reasoning_effort is model-dependent.",
    ["gpt-5.3-codex"],
    ["minimal", "low", "medium", "high", "xhigh"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "effort",
    "resume",
    "native",
    true,
    "Resume uses -c model_reasoning_effort when model evidence exists.",
    ["gpt-5.3-codex"],
    ["minimal", "low", "medium", "high", "xhigh"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "permission",
    "resume",
    "native",
    false,
    "Resume uses -c approval_policy.",
    undefined,
    ["untrusted", "on-request", "never", "granular"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "provider",
    "adopt",
    "native",
    false,
    "Adopt persists the evidenced native provider.",
    undefined,
    ["native"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "transport",
    "adopt",
    "native",
    false,
    "Adopt persists the evidenced CLI transport.",
    undefined,
    ["cli-subprocess"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "sandbox",
    "adopt",
    "native",
    false,
    "Adopted controls use the initial Codex sandbox contract.",
    undefined,
    ["read-only", "workspace-write", "danger-full-access"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "effort",
    "adopt",
    "native",
    true,
    "Adopt persists model-dependent effort for later resume.",
    ["gpt-5.3-codex"],
    ["minimal", "low", "medium", "high", "xhigh"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "permission",
    "adopt",
    "native",
    false,
    "Adopt persists approval_policy for later resume.",
    undefined,
    ["untrusted", "on-request", "never", "granular"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "permission",
    "fallback",
    "native",
    false,
    "Fallback preserves approval_policy.",
    undefined,
    ["untrusted", "on-request", "never", "granular"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "sandbox",
    "fallback",
    "native",
    false,
    "Fallback preserves sandbox_mode.",
    undefined,
    ["read-only", "workspace-write", "danger-full-access"],
  ),
  record(
    "codex",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CODEX_VERSION,
    "effort",
    "fallback",
    "native",
    true,
    "Fallback preserves model-dependent effort.",
    ["gpt-5.3-codex"],
    ["minimal", "low", "medium", "high", "xhigh"],
  ),
  ...adapterSurfaceRecords("codex", CODEX_VERSION, ["resume", "fallback"]),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "model",
    "initial",
    "native",
    false,
    "Devin --model is explicit.",
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "model",
    "resume",
    "native",
    false,
    "Devin --model remains explicit with --resume.",
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "provider",
    "initial",
    "native",
    false,
    "Native provider is the only evidenced provider.",
    undefined,
    ["native"],
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "transport",
    "initial",
    "native",
    false,
    "CLI subprocess is the evidenced transport.",
    undefined,
    ["cli-subprocess"],
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "permission",
    "initial",
    "native",
    false,
    "normal/accept-edits/dangerous are parser-accepted; smart is not promoted.",
    undefined,
    ["normal", "accept-edits", "dangerous", "autonomous"],
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "permission",
    "resume",
    "native",
    false,
    "normal/accept-edits/dangerous are parser-accepted; smart is not promoted.",
    undefined,
    ["normal", "accept-edits", "dangerous", "autonomous"],
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "sandbox",
    "initial",
    "native",
    false,
    "Autonomous is coupled to --sandbox.",
    undefined,
    ["true", "false"],
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "sandbox",
    "resume",
    "native",
    false,
    "Autonomous is coupled to --sandbox.",
    undefined,
    ["true", "false"],
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "workspaceTrust",
    "initial",
    "native",
    false,
    "--respect-workspace-trust accepts true|false.",
    undefined,
    ["true", "false"],
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "workspaceTrust",
    "resume",
    "native",
    false,
    "--respect-workspace-trust accepts true|false.",
    undefined,
    ["true", "false"],
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "effort",
    "initial",
    "unsupported",
    false,
    "Devin has no independent --effort flag.",
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "effort",
    "resume",
    "unsupported",
    false,
    "Devin has no independent --effort flag.",
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "provider",
    "adopt",
    "native",
    false,
    "Adopt persists the evidenced native provider.",
    undefined,
    ["native"],
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "transport",
    "adopt",
    "native",
    false,
    "Adopt persists the evidenced CLI transport.",
    undefined,
    ["cli-subprocess"],
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "permission",
    "adopt",
    "native",
    false,
    "Adopt validates the same Devin permission vocabulary.",
    undefined,
    ["normal", "accept-edits", "dangerous", "autonomous"],
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "sandbox",
    "adopt",
    "native",
    false,
    "Adopt validates the autonomous sandbox coupling.",
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "workspaceTrust",
    "adopt",
    "native",
    false,
    "Adopt persists workspace trust explicitly.",
    undefined,
    ["true", "false"],
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "permission",
    "fallback",
    "native",
    false,
    "Fallback preserves Devin permission.",
    undefined,
    ["normal", "accept-edits", "dangerous", "autonomous"],
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "sandbox",
    "fallback",
    "native",
    false,
    "Fallback preserves autonomous sandbox coupling.",
  ),
  record(
    "devin",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    DEVIN_VERSION,
    "workspaceTrust",
    "fallback",
    "native",
    false,
    "Fallback preserves workspace trust.",
    undefined,
    ["true", "false"],
  ),
  ...adapterSurfaceRecords("hermes", "Hermes Agent v0.19.0"),
  ...adapterSurfaceRecords("devin", DEVIN_VERSION, ["fallback"]),
  record(
    "hermes",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    "Hermes Agent v0.19.0",
    "model",
    "initial",
    "native",
    false,
    "Hermes --model is supported by the Sidekick adapter.",
  ),
  record(
    "hermes",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    "Hermes Agent v0.19.0",
    "model",
    "resume",
    "native",
    false,
    "Hermes --model is supported by the Sidekick adapter.",
  ),
  record(
    "hermes",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    "Hermes Agent v0.19.0",
    "effort",
    "initial",
    "unverified",
    true,
    "Global Hermes config is not a per-run proof.",
  ),
  ...adapterSurfaceRecords("claude", CLAUDE_VERSION),
  record(
    "claude",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CLAUDE_VERSION,
    "permission",
    "initial",
    "native",
    false,
    "Claude --permission-mode is locally evidenced.",
    undefined,
    ["accept-edits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"],
  ),
  record(
    "claude",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CLAUDE_VERSION,
    "permission",
    "resume",
    "native",
    false,
    "Claude --permission-mode is locally evidenced for resume.",
    undefined,
    ["accept-edits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"],
  ),
  record(
    "claude",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CLAUDE_VERSION,
    "permission",
    "adopt",
    "native",
    false,
    "Adopt persists Claude permission mode.",
    undefined,
    ["accept-edits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"],
  ),
  record(
    "claude",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CLAUDE_VERSION,
    "permission",
    "fallback",
    "native",
    false,
    "Fallback preserves Claude permission mode.",
    undefined,
    ["accept-edits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"],
  ),
  ...claudeEffortRecords("initial"),
  record(
    "claude",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CLAUDE_VERSION,
    "effort",
    "initial",
    "native",
    true,
    "Claude --effort is locally evidenced but model-dependent.",
    undefined,
    ["low", "medium", "high", "xhigh", "max"],
  ),
  ...claudeEffortRecords("resume"),
  record(
    "claude",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CLAUDE_VERSION,
    "effort",
    "resume",
    "native",
    true,
    "Claude --effort is locally evidenced but model-dependent.",
    undefined,
    ["low", "medium", "high", "xhigh", "max"],
  ),
  ...claudeEffortRecords("adopt"),
  record(
    "claude",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CLAUDE_VERSION,
    "effort",
    "adopt",
    "native",
    true,
    "Adopt persists model-dependent Claude effort.",
    undefined,
    ["low", "medium", "high", "xhigh", "max"],
  ),
  ...claudeEffortRecords("fallback"),
  record(
    "claude",
    "native",
    "*",
    DEFAULT_TRANSPORT,
    CLAUDE_VERSION,
    "effort",
    "fallback",
    "native",
    true,
    "Fallback preserves model-dependent Claude effort.",
    undefined,
    ["low", "medium", "high", "xhigh", "max"],
  ),
];

export function evidencedToolVersion(
  engine: EngineName,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env[`SIDEKICK_TOOL_VERSION_${engine.toUpperCase()}`];
  if (override) return override;
  if (engine === "mock") return SIMULATED_VERSION;
  let commandParts: string[];
  try {
    commandParts = env[`SIDEKICK_ENGINE_${engine.toUpperCase()}_CMD`]
      ? splitCommand(env[`SIDEKICK_ENGINE_${engine.toUpperCase()}_CMD`] ?? "")
      : [engine];
  } catch {
    return "unverified";
  }
  const [command, ...prefix] = commandParts;
  if (!command) return "unverified";
  const result = spawnSync(command, [...prefix, "--version"], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
  });
  if (result.status !== 0 || result.error) return "unverified";
  return normalizeToolVersion(engine, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

function normalizeToolVersion(engine: EngineName, output: string): string {
  const firstLine =
    output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  if (!firstLine) return "unverified";
  if (engine === "devin") return firstLine.match(/^devin\s+\S+/iu)?.[0] ?? "unverified";
  if (engine === "codex") return firstLine.match(/^codex-cli\s+\S+/iu)?.[0] ?? "unverified";
  if (engine === "hermes") return firstLine.match(/^Hermes Agent\s+v\S+/u)?.[0] ?? "unverified";
  if (engine === "claude") return firstLine.match(/^\S+\s+\([^)]*\)/u)?.[0] ?? "unverified";
  return firstLine;
}

export function isHarnessControls(value: unknown): value is HarnessControls {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const controls = value as Record<string, unknown>;
  return CONTROL_AXES.every((axis) => isObservation(controls[axis]));
}

export function capabilityKey(entry: CapabilityRecord): string {
  return [
    entry.engine,
    entry.provider,
    entry.model,
    entry.transport,
    entry.toolVersion,
    entry.axis,
    entry.action,
  ].join("|");
}

export function createControls(input: ResolveControlsInput): HarnessControls {
  const mode = input.mode ?? "";
  const permission = input.permission ?? permissionFromLegacy(input.engine, mode);
  const sandbox = input.sandbox ?? sandboxFromLegacy(input.engine, mode);
  const model = input.model ?? "";
  const provider = input.provider ?? "";
  const transport = input.transport ?? DEFAULT_TRANSPORT;
  const effort = input.effort ?? "";

  return {
    model: observation(
      model || null,
      model ? applied("cli-flag", model, "native-argv", "--model", model) : null,
    ),
    provider: observation(
      provider || null,
      provider ? applied("none", provider, "adapter", undefined, provider) : null,
    ),
    transport: observation(
      transport,
      applied("none", transport, "adapter", undefined, transport),
      "applied",
    ),
    effort: effortObservation(input.engine, effort, input),
    permission: permissionObservation(input.engine, permission),
    sandbox: sandboxObservation(input.engine, sandbox),
    workspaceTrust: booleanObservation(
      input.workspaceTrust,
      input.workspaceTrust === undefined
        ? null
        : applied(
            "cli-flag",
            input.workspaceTrust,
            "native-argv",
            "--respect-workspace-trust",
            String(input.workspaceTrust),
          ),
    ),
    agentProfile: observation(input.agentProfile ?? null, null),
    budget: observation(input.budget ?? null, null),
    cwdRestore: booleanObservation(input.cwdRestore, null),
  };
}

export function createLegacyControls(input: ResolveControlsInput): HarnessControls {
  const controls = createControls(input);
  return Object.fromEntries(
    CONTROL_AXES.map((axis) => {
      const current = controls[axis];
      if (!current.applied) return [axis, current];
      return [
        axis,
        {
          ...current,
          applied: { ...current.applied, source: "legacy" as const },
          status: current.requested === null ? "unknown" : "requested",
        },
      ];
    }),
  ) as HarnessControls;
}

export function hasLegacyControls(controls: HarnessControls): boolean {
  return CONTROL_AXES.some((axis) => controls[axis].applied?.source === "legacy");
}

export function resolveControls(input: ResolveControlsInput): HarnessControls {
  const normalized = normalizeInput(input);
  validateExplicit(normalized);
  return createControls(normalized);
}

export function serializeControls(controls: HarnessControls): string {
  return `${JSON.stringify(controls, null, 2)}\n`;
}

function normalizeInput(input: ResolveControlsInput): ResolveControlsInput {
  const mode = input.mode?.trim() ?? "";
  const permission = input.permission?.trim() || undefined;
  const effort = input.effort?.trim() || undefined;
  const sandbox = normalizeSandbox(input.sandbox ?? sandboxFromLegacy(input.engine, mode));
  if (mode === "high" && input.engine === "devin")
    throw new CliError(
      "--mode high is not a Devin reasoning control; use --effort with a verified model",
      2,
    );

  if (input.engine === "devin" && (permission === undefined || permission === "")) {
    if (mode === "auto")
      return compact({ ...input, mode: "normal", permission: "normal", effort, sandbox });
    if (mode) return compact({ ...input, permission: mode, effort, sandbox });
  }
  if (input.engine === "codex" && mode) return compact({ ...input, effort, sandbox });
  if (input.engine === "claude" && mode) return compact({ ...input, effort, permission: mode });
  if (input.engine === "hermes" && mode)
    throw new CliError("Hermes does not have a verified per-run --mode control", 2);
  return compact({ ...input, mode, permission, effort, sandbox });
}

function validateExplicit(input: ResolveControlsInput): void {
  const toolVersion = input.toolVersion ?? "unknown";
  if (input.engine === "devin" && input.permission === "smart")
    throw unsupported(
      "Devin permission smart is unverified for the evidenced parser; refusing to emit it",
    );
  if (input.engine === "devin" && input.permission === "autonomous" && input.sandbox !== true)
    throw unsupported("Devin autonomous permission requires sandbox=true");
  if (input.engine === "devin" && input.sandbox === true && input.permission !== "autonomous")
    throw unsupported("Devin sandbox=true requires permission=autonomous");

  const explicit: Array<[ControlAxis, string | boolean | undefined]> = [
    ["provider", input.provider],
    ["transport", input.transport],
    ["effort", input.effort],
    ["permission", input.permission],
    ["sandbox", input.sandbox],
    ["workspaceTrust", input.workspaceTrust],
  ];
  for (const [axis, value] of explicit) {
    if (value === undefined || value === "") continue;
    if (axis === "effort" && value === "auto") continue;
    const entry = findCapability(
      input.engine,
      input.provider ?? DEFAULT_PROVIDER,
      input.model ?? "",
      input.transport ?? DEFAULT_TRANSPORT,
      toolVersion,
      axis,
      input.action,
    );
    if (!entry || entry.support === "unsupported" || entry.support === "unverified")
      throw unsupported(
        `${axis}=${String(value)} is ${entry?.support ?? "unverified"} for ${input.engine}/${toolVersion}`,
      );
    if (entry.values && !entry.values.includes(String(value)))
      throw unsupported(
        `${axis}=${String(value)} is not accepted by ${input.engine}/${toolVersion}`,
      );
    if (entry.modelDependent && !entry.verifiedModels?.includes(input.model ?? ""))
      throw unsupported(
        `${axis}=${String(value)} is model-dependent and unverified for ${input.model}`,
      );
  }
}

function findCapability(
  engine: EngineName,
  provider: string,
  model: string,
  transport: Transport,
  toolVersion: string,
  axis: ControlAxis,
  action: ControlAction,
): CapabilityRecord | undefined {
  return (
    capabilityRegistry.find(
      (entry) =>
        entry.engine === engine &&
        entry.provider === provider &&
        entry.model === model &&
        entry.transport === transport &&
        entry.toolVersion === toolVersion &&
        entry.axis === axis &&
        entry.action === action,
    ) ??
    capabilityRegistry.find(
      (entry) =>
        entry.engine === engine &&
        entry.provider === provider &&
        entry.model === "*" &&
        entry.transport === transport &&
        entry.toolVersion === toolVersion &&
        entry.axis === axis &&
        entry.action === action,
    )
  );
}

function permissionFromLegacy(engine: EngineName, mode: string): string | undefined {
  if (!mode || !["devin", "claude"].includes(engine)) return undefined;
  return mode === "auto" && engine === "devin" ? "normal" : mode;
}

function sandboxFromLegacy(engine: EngineName, mode: string): string | boolean | undefined {
  if (engine === "codex" && mode) return mode;
  if (engine === "devin" && mode === "autonomous") return true;
  return undefined;
}

function normalizeSandbox(value: string | boolean | undefined): string | boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function effortObservation(
  engine: EngineName,
  effort: string,
  input: ResolveControlsInput,
): ControlObservation<string> {
  if (!effort) return observation<string>(null, null);
  if (effort === "auto") return observation<string>("auto", applied("omitted", null, "adapter"));
  if (engine === "devin")
    return observation(
      effort,
      applied("model-variant", input.model ?? "", "adapter", "--model", input.model ?? ""),
    );
  if (engine === "claude")
    return observation(effort, applied("cli-flag", effort, "native-argv", "--effort", effort));
  if (engine === "mock")
    return observation(effort, applied("none", effort, "adapter", undefined, effort));
  return observation(
    effort,
    applied("config-override", effort, "native-config", "model_reasoning_effort", effort),
  );
}

function permissionObservation(
  engine: EngineName,
  value: string | undefined,
): ControlObservation<string> {
  if (!value) return observation<string>(null, null);
  if (engine === "devin") {
    const native = value === "normal" ? "auto" : value;
    return observation(
      value,
      applied("cli-flag", native, "native-argv", "--permission-mode", native),
    );
  }
  if (engine === "codex")
    return observation(
      value,
      applied("config-override", value, "native-config", "approval_policy", value),
    );
  const native = engine === "claude" && value === "accept-edits" ? "acceptEdits" : value;
  return observation(
    value,
    applied("cli-flag", native, "native-argv", "--permission-mode", native),
  );
}

function sandboxObservation(
  engine: EngineName,
  value: string | boolean | undefined,
): ControlObservation<string | boolean> {
  if (value === undefined || value === "") return observation<string | boolean>(null, null);
  if (engine === "devin" && value === true)
    return observation(true, applied("cli-flag", true, "native-argv", "--sandbox", "true"));
  if (engine === "devin" && value === false)
    return observation(false, applied("omitted", null, "adapter", undefined, "omitted"));
  return observation(value, applied("cli-flag", value, "native-argv", "--sandbox", String(value)));
}

function observation<T>(
  requested: T | null,
  appliedValue: ControlObservation<T>["applied"],
  status?: ObservationStatus,
): ControlObservation<T> {
  return {
    requested,
    applied: appliedValue,
    effective: null,
    status: status ?? (requested === null ? "unknown" : appliedValue ? "applied" : "requested"),
  };
}

function compact(input: object): ResolveControlsInput {
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
  }
  return record as unknown as ResolveControlsInput;
}

function booleanObservation(
  requested: boolean | undefined,
  appliedValue: ControlObservation<boolean>["applied"],
): ControlObservation<boolean> {
  return observation(requested ?? null, appliedValue);
}

function applied<T>(
  mechanism: NonNullable<ControlObservation<T>["applied"]>["mechanism"],
  value: T | string | null,
  source: ObservationSource,
  key?: string,
  observedValueRedacted?: string,
): NonNullable<ControlObservation<T>["applied"]> {
  const result: NonNullable<ControlObservation<T>["applied"]> = { mechanism, value, source };
  if (key !== undefined) {
    result.key = key;
    if (source === "native-config") result.configPath = key;
  }
  if (observedValueRedacted !== undefined) result.observedValueRedacted = observedValueRedacted;
  return result;
}

function record(
  engine: EngineName,
  provider: string,
  model: string,
  transport: Transport,
  toolVersion: string,
  axis: ControlAxis,
  action: ControlAction,
  support: CapabilitySupport,
  modelDependent: boolean,
  detail: string,
  verifiedModels?: readonly string[],
  values?: readonly string[],
): CapabilityRecord {
  const entry: CapabilityRecord = {
    engine,
    provider,
    model,
    transport,
    toolVersion,
    axis,
    action,
    support,
    modelDependent,
    detail,
  };
  if (verifiedModels?.length) entry.verifiedModels = verifiedModels;
  if (values?.length) entry.values = values;
  return entry;
}

function isObservation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const requested = value.requested;
  const appliedValue = value.applied;
  const effectiveValue = value.effective;
  return (
    "requested" in value &&
    isScalar(requested) &&
    (appliedValue === null || isAppliedObservation(appliedValue)) &&
    (effectiveValue === null || isEffectiveObservation(effectiveValue)) &&
    typeof value.status === "string" &&
    ["requested", "applied", "clamped", "unknown", "unsupported"].includes(value.status)
  );
}

function isAppliedObservation(value: unknown): boolean {
  if (!isRecord(value) || !isScalar(value.value)) return false;
  const mechanisms = [
    "cli-flag",
    "config-override",
    "model-variant",
    "inherit-native",
    "omitted",
    "none",
  ];
  const sources = [
    "user",
    "legacy",
    "adapter",
    "native-argv",
    "native-config",
    "native-environment",
    "provider-reported",
    "runtime-output",
    "unknown",
  ];
  return (
    typeof value.mechanism === "string" &&
    mechanisms.includes(value.mechanism) &&
    typeof value.source === "string" &&
    sources.includes(value.source) &&
    validOptionalStrings(value, ["key", "configPath", "observedValueRedacted", "reason"]) &&
    (value.argv === undefined ||
      (Array.isArray(value.argv) && value.argv.every((item) => typeof item === "string")))
  );
}

function isEffectiveObservation(value: unknown): boolean {
  if (!isRecord(value) || !isScalar(value.value)) return false;
  const sources = ["provider-reported", "runtime-output", "unknown"];
  return (
    typeof value.source === "string" &&
    sources.includes(value.source) &&
    validOptionalStrings(value, ["fieldPath", "artifactPath", "observedValueRedacted", "reason"])
  );
}

function validOptionalStrings(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => value[key] === undefined || typeof value[key] === "string");
}

function isScalar(value: unknown): value is string | boolean | null {
  return value === null || ["string", "boolean"].includes(typeof value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unsupported(message: string): CliError {
  return new CliError(`unsupported or unverified control: ${message}`, 2);
}
