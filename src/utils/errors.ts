export class CliError extends Error {
  readonly exitCode: number;
  readonly hint: string | undefined;

  constructor(message: string, exitCode = 2, hint?: string) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

export function errorExitCode(error: unknown): number {
  return error instanceof CliError ? error.exitCode : 1;
}

export function formatError(error: unknown): string {
  if (error instanceof CliError) {
    return `sidekick: ${error.message}${error.hint ? `\nHint: ${error.hint}` : ""}`;
  }
  return `sidekick: internal error: ${error instanceof Error ? error.message : String(error)}`;
}
