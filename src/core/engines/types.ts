export type EngineName = "codex" | "devin" | "claude" | "hermes" | "mock";
export type WorkerAction = "spawn" | "resume" | "fallback";

export interface EngineContext {
  action: WorkerAction;
  session: string;
  prompt: string;
  promptFile: string;
  outputFile: string;
  model: string;
  mode: string;
  delayMs: number;
  env: NodeJS.ProcessEnv;
}

export interface EngineInvocation {
  command: string;
  args: string[];
  stdin?: string;
}

export interface EngineResult {
  output: string;
  session: string;
}

export interface Engine {
  readonly name: EngineName;
  build(context: EngineContext): EngineInvocation;
  parse(stdout: string, context: EngineContext): EngineResult;
}
