/*
 * Types for SmokeTestNpmPackage.js, which stays plain CommonJS so CI runs it
 * with node alone on every Node.js line the package supports. Its tests
 * import it through these.
 */

export interface TypeScriptMode {
  name: string;
  directory: string;
  // The extension its sources get: nodenext reads .cts and .mts by it.
  extension: string;
  options: Record<string, string | boolean>;
}

export const PACKAGE_NAME: string;
export const ROOT_VALUES: Readonly<Record<string, string>>;
export const CORE_MODULES: ReadonlyArray<string>;
export const TYPESCRIPT_MODES: ReadonlyArray<TypeScriptMode>;

export function publishedModules(installed: string): Array<string>;
export function apiAndModelsProblems(report: unknown): Array<string>;
export function lastJsonLine(stdout: string): unknown;
export function isNetworkFailure(stderr: string): boolean;
