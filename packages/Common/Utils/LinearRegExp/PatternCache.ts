import LinearRegExp, {
  LinearRegExpOptions,
  refusePatternTooLong,
} from "./LinearRegExp";
import {
  describePatternProblemReason,
  PatternProblemError,
} from "./PatternProblem";

/*
 * PATTERNS PEOPLE WROTE, COMPILED ONCE.
 *
 * A rule's pattern is matched against every alert, monitor or log line the
 * rule looks at; compiling it each time would cost more than matching. The
 * compiled pattern is kept here, the least recently used dropped first. A
 * pattern that cannot be compiled is kept too, so it is refused once rather
 * than once per record.
 *
 * Bounded three ways: by how many patterns, by how many steps they compiled
 * to together - a short pattern such as .{0,4000} compiles to thousands of
 * steps - and by how many characters of text they keep together, since each
 * is kept by its text and a refusal's message can hold the text again. The
 * patterns kept here are written by the people of every project. A pattern
 * longer than any that can run is never kept: it is refused before it is
 * read.
 */

export const MAX_CACHED_PATTERNS: number = 1024;
export const MAX_CACHED_PATTERN_STEPS: number = 1_000_000;
export const MAX_CACHED_PATTERN_CHARACTERS: number = 4_000_000;

interface CachedPattern {
  compiled: LinearRegExp | Error;
  // What it compiled to, and how much text it keeps: what it costs to keep.
  steps: number;
  characters: number;
}

const cache: Map<string, CachedPattern> = new Map<string, CachedPattern>();
let cachedSteps: number = 0;
let cachedCharacters: number = 0;

function toCached(key: string, compiled: LinearRegExp | Error): CachedPattern {
  return {
    compiled: compiled,
    steps: compiled instanceof LinearRegExp ? compiled.steps : 0,
    /*
     * The key holds the pattern's text; the compiled pattern holds it again
     * as its source, and a SyntaxError's message quotes it.
     */
    characters:
      key.length +
      (compiled instanceof LinearRegExp
        ? compiled.source.length
        : compiled.message.length),
  };
}

function forget(key: string): void {
  const entry: CachedPattern | undefined = cache.get(key);

  if (entry === undefined) {
    return;
  }

  cachedSteps -= entry.steps;
  cachedCharacters -= entry.characters;
  cache.delete(key);
}

// Drops the least recently used patterns until this one fits.
function makeRoom(entry: CachedPattern): void {
  // From the least recently used on, dropping as it goes.
  for (const oldest of cache.keys()) {
    if (
      cache.size < MAX_CACHED_PATTERNS &&
      cachedSteps + entry.steps <= MAX_CACHED_PATTERN_STEPS &&
      cachedCharacters + entry.characters <= MAX_CACHED_PATTERN_CHARACTERS
    ) {
      return;
    }

    forget(oldest);
  }
}

/*
 * The pattern compiled for linear-time matching, from the cache when it was
 * compiled before. Throws what compiling throws: the engine's SyntaxError for
 * what is not a regular expression, PatternProblemError for one that cannot
 * run in linear time (a back-reference, or too large).
 */
export function getLinearRegExp(
  source: string,
  flags: string = "",
  options?: LinearRegExpOptions,
): LinearRegExp {
  /*
   * Longer than any pattern that can run: refused before it is read, and
   * never kept - its text would be its key, and a request can carry
   * megabytes of it.
   */
  refusePatternTooLong(source);

  const key: string = [
    flags,
    options?.captures === true ? "captures" : "",
    options?.maxSteps ?? "",
    source,
  ].join("\u0000");
  const cached: CachedPattern | undefined = cache.get(key);

  if (cached !== undefined) {
    // Most recently used goes last.
    cache.delete(key);
    cache.set(key, cached);

    if (cached.compiled instanceof Error) {
      throw cached.compiled;
    }

    return cached.compiled;
  }

  let compiled: LinearRegExp | Error;

  try {
    compiled = new LinearRegExp(source, flags, options);
  } catch (error: unknown) {
    compiled = error instanceof Error ? error : new Error(String(error));
  }

  const entry: CachedPattern = toCached(key, compiled);

  makeRoom(entry);
  cache.set(key, entry);
  cachedSteps += entry.steps;
  cachedCharacters += entry.characters;

  if (compiled instanceof Error) {
    throw compiled;
  }

  return compiled;
}

// The compiled pattern, or null when it cannot be compiled for any reason.
export function tryGetLinearRegExp(
  source: string,
  flags: string = "",
  options?: LinearRegExpOptions,
): LinearRegExp | null {
  try {
    return getLinearRegExp(source, flags, options);
  } catch {
    return null;
  }
}

/*
 * What stops a pattern that is a regular expression from running, in words
 * for the person who wrote it: the end of a sentence that starts "This
 * pattern ...". Null for an error of another kind (a SyntaxError says what is
 * wrong in its own words).
 */
export function describePatternProblem(error: unknown): string | null {
  if (!(error instanceof PatternProblemError)) {
    return null;
  }

  return describePatternProblemReason(error.reason);
}

// How many steps the cached patterns compiled to together, for tests.
export function getCachedPatternSteps(): number {
  return cachedSteps;
}

// How many characters of text the cached patterns keep together, for tests.
export function getCachedPatternCharacters(): number {
  return cachedCharacters;
}

// How many patterns are cached, refusals included, for tests.
export function getCachedPatternCount(): number {
  return cache.size;
}

// Test seam: forget every compiled pattern.
export function clearLinearRegExpCache(): void {
  cache.clear();
  cachedSteps = 0;
  cachedCharacters = 0;
}
