/*
 * Types of Transpiler.js, the ts-node transpiler every OneUptime server runs
 * its TypeScript with (see its header). It is JavaScript because ts-node
 * loads it before it can load TypeScript.
 */

export interface TsNodeTranspilerCreateOptions {
  service: {
    options: { compiler?: string | undefined };
    config: { options: Record<string, unknown> };
    projectLocalResolveHelper: (
      specifier: string,
      fallbackToTsNodeRelative: boolean,
    ) => string;
  };
  nodeModuleEmitKind?: "nodecjs" | "nodeesm" | undefined;
}

export interface TsNodeTranspileOutput {
  outputText: string;
  sourceMapText: string;
  diagnostics?: ReadonlyArray<unknown> | undefined;
}

export interface TsNodeTranspiler {
  transpile: (
    input: string,
    options: { fileName: string },
  ) => TsNodeTranspileOutput;
}

export interface KeptSourceMap {
  url: string;
  map: {
    version: 3;
    file: string;
    sources: Array<string>;
    names: Array<string>;
    mappings: string;
    sourcesContent?: Array<string>;
  };
}

export function create(
  createOptions: TsNodeTranspilerCreateOptions,
): TsNodeTranspiler | undefined;

/*
 * The compiler options a module is compiled with outside development, from
 * those ts-node gives the transpiler; Precompile.js compiles images with
 * them.
 */
export function runtimeCompilerOptions(
  serviceCompilerOptions: Record<string, unknown>,
): Record<string, unknown>;

export function retrieveSourceMap(source: unknown): KeptSourceMap | null;

/*
 * An object for source-map-support to keep as a cache, holding at most
 * `budget` of what `weigh` says its values cost, the ones used last.
 */
export function leastRecentlyUsed<T>(
  budget: number,
  weigh: (value: T) => number,
  entries?: Record<string, T>,
): Record<string, T>;

// Gives source-map-support's shared caches those budgets; false if it cannot.
export function boundSourceMapSupportCaches(): boolean;

export function sourceMapCacheEntryBytes(entry: unknown): number;

export function fileContentsCacheEntryCharacters(text: unknown): number;

export const SOURCE_MAP_CACHE_BYTES: number;

export const FILE_CONTENTS_CACHE_CHARACTERS: number;

export function keepsSourceMapsOutsideCode(): boolean;

export function keptSourceMapCount(): number;

export function keptSourceMapBytes(): number;
