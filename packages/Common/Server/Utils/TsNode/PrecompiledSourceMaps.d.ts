/*
 * Types of PrecompiledSourceMaps.js, which every image's start command
 * requires before the JavaScript its build compiled (see its header). It is
 * JavaScript because it is loaded before anything that could compile
 * TypeScript.
 */

export interface PrecompiledSourceMap {
  // The map file: its sources name the TypeScript beside it, relative to it.
  url: string;
  map: string;
}

/*
 * Installs source maps and the refusal of TypeScript; false when ts-node is
 * registered (it has its own) or this already ran.
 */
export function install(): boolean;

export function retrieveSourceMap(source: unknown): PrecompiledSourceMap | null;

export function refuseTypeScript(module: unknown, fileName: string): never;
