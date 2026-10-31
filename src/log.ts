// Writing into `head` or a closed pipe is not an error.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
}

export interface OutputOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  noColor?: boolean;
}

export type Output = ReturnType<typeof createOutput>;

export function createOutput(options: OutputOptions) {
  const color = !options.noColor && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  const paint = (code: string, value: string): string => (color ? `\x1b[${code}m${value}\x1b[0m` : value);

  const write = (stream: NodeJS.WriteStream, value: string): void => {
    if (stream.destroyed) return;
    stream.write(value.endsWith("\n") ? value : `${value}\n`);
  };

  return {
    color,
    bold: (value: string) => paint("1", value),
    dim: (value: string) => paint("2", value),
    red: (value: string) => paint("31", value),
    green: (value: string) => paint("32", value),
    yellow: (value: string) => paint("33", value),
    cyan: (value: string) => paint("36", value),

    info: (value: string) => {
      if (!options.quiet) write(process.stdout, value);
    },
    progress: (value: string) => {
      if (!options.quiet && !options.json) write(process.stderr, value);
    },
    debug: (value: string) => {
      if (options.verbose) write(process.stderr, paint("2", value));
    },
    warn: (value: string) => write(process.stderr, `${paint("33", "warning:")} ${value}`),
    error: (value: string) => write(process.stderr, `${paint("31", "error:")} ${value}`),
    event: (value: Record<string, unknown>) => {
      if (options.json) write(process.stdout, JSON.stringify(value));
    },
    json: (value: unknown) => write(process.stdout, JSON.stringify(value, null, 2)),
  };
}
