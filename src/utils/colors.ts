export interface Colors {
  bold(value: string): string;
  green(value: string): string;
  red(value: string): string;
  yellow(value: string): string;
}

export function colors(env: NodeJS.ProcessEnv = process.env, stream = process.stderr): Colors {
  const enabled =
    env.FORCE_COLOR !== undefined
      ? env.FORCE_COLOR !== "0"
      : env.NO_COLOR === undefined && env.CI !== "true" && stream.isTTY;
  const wrap = (code: number) => (value: string) =>
    enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
  return { bold: wrap(1), green: wrap(32), red: wrap(31), yellow: wrap(33) };
}
