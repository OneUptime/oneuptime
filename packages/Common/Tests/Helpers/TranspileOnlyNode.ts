import { spawnSync, SpawnSyncReturns } from "child_process";

/*
 * Runs a script in a fresh Node that loads TypeScript the way production
 * does: the images start with `node --require ts-node/register Index.ts` and
 * TS_NODE_TRANSPILE_ONLY, so each .ts file is transpiled on its own to
 * CommonJS as it is required - no type check, no bundler, no jest. This does
 * the same with Common's own TypeScript, so a test can require a Common
 * module (by absolute path) exactly as the App and the workers load it,
 * outside jest's module registry, mocks and environment.
 *
 * The script is plain JavaScript; it may require .ts files. What it prints
 * to stdout comes back in the result.
 */

const COMPILER_OPTIONS: string = JSON.stringify({
  // ts-node's compilerOptions in Common's and App's tsconfig.json.
  module: "commonjs",
  target: "es2017",
  esModuleInterop: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
});

export function runTranspileOnlyNode(
  script: string,
  options: { cwd: string; timeoutMs?: number },
): SpawnSyncReturns<string> {
  const hook: string = `
    const transpileOnlyFs = require("fs");
    const transpileOnlyTs = require(${JSON.stringify(require.resolve("typescript"))});
    const transpileOnlyOptions = transpileOnlyTs.convertCompilerOptionsFromJson(
      ${COMPILER_OPTIONS},
      process.cwd(),
    ).options;

    require.extensions[".ts"] = (module, filename) => {
      const output = transpileOnlyTs.transpileModule(
        transpileOnlyFs.readFileSync(filename, "utf8"),
        { fileName: filename, compilerOptions: transpileOnlyOptions },
      ).outputText;
      module._compile(output, filename);
    };
  `;

  return spawnSync(process.execPath, ["-e", `${hook}\n${script}`], {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 120000,
    // A server process: no browser globals, whatever jest's environment has.
    env: { ...process.env },
  });
}

// The last line of stdout that is a JSON object, parsed.
export function lastJsonLine<T>(result: SpawnSyncReturns<string>): T {
  const lines: Array<string> = (result.stdout || "")
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("{");
    });

  if (lines.length === 0) {
    throw new Error(
      `The script printed no JSON (exit ${String(result.status)}):\n${result.stderr}`,
    );
  }

  return JSON.parse(lines[lines.length - 1] as string) as T;
}
