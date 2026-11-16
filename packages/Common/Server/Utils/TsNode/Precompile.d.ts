/*
 * Types of Precompile.js, which compiles a server's TypeScript to JavaScript
 * when its image is built (see its header). It is JavaScript because it runs
 * in an image's build stage before anything is compiled.
 */

export interface PrecompileOptions {
  project: string;
  roots: Array<string>;
  jobs: number;
}

export interface PrecompileSummary {
  files: Array<string>;
  fromOtherPackages: Array<string>;
  javaScriptBytes: number;
  sourceMapBytes: number;
  milliseconds: number;
  jobs: number;
}

export interface CompilerForProject {
  compilerPath: string;
  compilerOptions: Record<string, unknown>;
  ignoredDiagnostics: Array<number>;
}

export interface CompileResult {
  failures: Array<string>;
  javaScriptBytes: number;
  sourceMapBytes: number;
}

export function precompile(options: PrecompileOptions): Promise<PrecompileSummary>;

export function parseArguments(argv: Array<string>): PrecompileOptions;

export function compilerOptionsFor(project: string): CompilerForProject;

export function findTypeScript(root: string): {
  compiled: Array<string>;
  otherPackages: Set<string>;
};

export function resolveRelativeImport(
  fromFile: string,
  specifier: string,
): string | null;

export function importedFromOtherPackages(
  ts: unknown,
  files: Array<string>,
  otherPackages: Set<string>,
  roots: Array<string>,
): Array<string>;

export function compileFiles(
  ts: unknown,
  files: Array<string>,
  compilerOptions: Record<string, unknown>,
  ignoredDiagnostics: Array<number>,
): CompileResult;

export function compileInWorkers(
  files: Array<string>,
  compiler: CompilerForProject,
  jobs: number,
): Promise<CompileResult>;

export function gitCheckoutOf(directory: string): string | null;

export const DIAGNOSTICS_TS_NODE_IGNORES: Array<number>;
