import { CliError } from "../../utils/errors.js";
import { claudeEngine } from "./claude.js";
import { codexEngine } from "./codex.js";
import { devinEngine } from "./devin.js";
import { hermesEngine } from "./hermes.js";
import { mockEngine } from "./mock.js";
import type { Engine, EngineName } from "./types.js";

const engines: Record<EngineName, Engine> = {
  codex: codexEngine,
  devin: devinEngine,
  claude: claudeEngine,
  hermes: hermesEngine,
  mock: mockEngine,
};
export const engineNames = Object.keys(engines) as EngineName[];
export function getEngine(name: string): Engine {
  if (!(name in engines))
    throw new CliError(`unknown engine: ${name}`, 2, `Choose one of: ${engineNames.join(", ")}`);
  return engines[name as EngineName];
}
