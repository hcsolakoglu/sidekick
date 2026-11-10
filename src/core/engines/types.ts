export type EngineName = "codex" | "devin" | "claude" | "hermes" | "commandcode" | "mock";
export type WorkerAction = "spawn" | "resume" | "fallback";

import type { HarnessControls } from "../controls.js";

export interface EngineContext {
  action: WorkerAction;
  session: string;
  prompt: string;
  promptFile: string;
  outputFile: string;
  model: string;
  mode: string;
  controls?: HarnessControls;
  delayMs: number;
  env: NodeJS.ProcessEnv;
  /** Extra workspace directories captured at spawn/adopt (Command Code --add-dir). */
  addDirs?: string[];
}

export interface EngineInvocation {
  command: string;
  args: string[];
  stdin?: string;
}

export interface EngineResult {
  output: string;
  session: string;
  /**
   * Terminal exit code the adapter can prove when the harness process itself exits 0.
   * Command Code ends a run with exit 0 on a policy denial, which would otherwise look
   * successful; only adapters that detect such a stop reason set this.
   */
  exitCode?: number;
}

export interface Engine {
  readonly name: EngineName;
  /** Engine-scoped run inputs beyond the control axes; spawn/adopt gate on these. */
  readonly options?: {
    readonly addDirs?: boolean;
  };
  build(context: EngineContext): EngineInvocation;
  parse(stdout: string, context: EngineContext): EngineResult;
}
