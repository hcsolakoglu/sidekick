import type { EngineName } from "../core/engines/types.js";
import {
  CONTROL_AXES,
  capabilityKey,
  capabilityRegistry,
  createControls,
  evidencedToolVersion,
  type CapabilityRecord,
  type CapabilitySupport,
} from "../core/controls.js";
import { parseOptions } from "./shared.js";
import { CliError } from "../utils/errors.js";

const ENGINES: readonly EngineName[] = ["codex", "devin", "claude", "hermes", "mock"];

export function capabilitiesCommand(args: string[]): number {
  const { values, positionals } = parseOptions(args, {
    options: {
      model: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  if (!values.json) throw new CliError("capabilities requires --json", 2);

  const selected = positionals.length ? positionals : [...ENGINES];
  const unknown = selected.filter((engine) => !ENGINES.includes(engine as EngineName));
  if (unknown.length) throw new CliError(`unknown engine: ${unknown.join(", ")}`, 2);

  const model = values.model ?? "";
  const runtimeVersions = new Map<EngineName, string>();
  for (const engine of selected as EngineName[])
    runtimeVersions.set(engine, evidencedToolVersion(engine));

  const allRecords = capabilityRegistry.filter((entry) => selected.includes(entry.engine));
  let exactNativeModel = false;
  if (model) {
    exactNativeModel = allRecords.some(
      (entry) => entry.model === model && entry.support === "native",
    );
    const unresolved = allRecords.find(
      (entry) =>
        entry.model === "*" &&
        entry.modelDependent &&
        entry.support === "native" &&
        !exactNativeModel &&
        !entry.verifiedModels?.includes(model),
    );
    if (unresolved)
      throw new CliError(
        `model-dependent capability is unverified: ${model} (${unresolved.engine}/${unresolved.axis})`,
        2,
      );
  }
  const records = model
    ? allRecords.filter(
        (entry) =>
          entry.model === model ||
          (entry.model === "*" && !(entry.modelDependent && exactNativeModel)),
      )
    : allRecords;

  const output = {
    schemaVersion: 1,
    selectedEngines: selected,
    model: model || null,
    capabilities: records.map((entry) =>
      toOutput(entry, model, runtimeVersions.get(entry.engine) ?? "unverified"),
    ),
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return 0;
}

function toOutput(entry: CapabilityRecord, model: string, runtimeVersion: string) {
  const controls = createControls({
    engine: entry.engine,
    provider: entry.provider,
    model: model || (entry.model === "*" ? "" : entry.model),
    transport: entry.transport,
    action: entry.action,
    toolVersion: entry.toolVersion,
  });
  const versionMatches = entry.toolVersion === runtimeVersion;
  const support: CapabilitySupport = versionMatches ? entry.support : "unverified";
  const detail = versionMatches
    ? entry.detail
    : `${entry.detail} Runtime toolVersion=${runtimeVersion}; evidence requires ${entry.toolVersion}.`;
  const result: {
    key: string;
    engine: EngineName;
    provider: string;
    model: string;
    transport: string;
    toolVersion: string;
    runtimeToolVersion: string;
    axis: string;
    action: string;
    support: CapabilitySupport;
    modelDependent: boolean;
    detail: string;
    observation: unknown;
    values?: readonly string[];
    verifiedModels?: readonly string[];
  } = {
    key: capabilityKey(entry),
    engine: entry.engine,
    provider: entry.provider,
    model: model || entry.model,
    transport: entry.transport,
    toolVersion: entry.toolVersion,
    runtimeToolVersion: runtimeVersion,
    axis: entry.axis,
    action: entry.action,
    support,
    modelDependent: entry.modelDependent,
    detail,
    observation: controls[entry.axis],
  };
  if (entry.values) result.values = entry.values;
  if (entry.verifiedModels) result.verifiedModels = entry.verifiedModels;
  return result;
}

export { CONTROL_AXES };
