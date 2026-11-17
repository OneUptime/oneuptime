/*
 * Types of SourceMapSupportCaches.js: the budget for what source-map-support
 * keeps between stack traces, which Transpiler.js and
 * PrecompiledSourceMaps.js both give it (see its header).
 */

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
