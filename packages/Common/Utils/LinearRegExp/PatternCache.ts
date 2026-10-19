import LinearRegExp, { LinearRegExpOptions } from "./LinearRegExp";
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
 * Bounded twice: by how many patterns, and by how many steps they compiled
 * to together - a short pattern such as .{0,4000} compiles to thousands of
 * steps, and the patterns kept here are written by the people of every
 * project.
 */

export const MAX_CACHED_PATTERNS: number = 1024;
export const MAX_CACHED_PATTERN_STEPS: number = 1_000_000;

const cache: Map<string, LinearRegExp | Error> = new Map<
  string,
  LinearRegExp | Error
>();
let cachedSteps: number = 0;

function stepsOf(entry: LinearRegExp | Error): number {
  return entry instanceof LinearRegExp ? entry.steps : 0;
}

// Drops the least recently used patterns until one of `steps` more fits.
function makeRoom(steps: number): void {
  for (const oldest of Array.from(cache.keys())) {
    if (
      cache.size < MAX_CACHED_PATTERNS &&
      cachedSteps + steps <= MAX_CACHED_PATTERN_STEPS
    ) {
      return;
    }

    cachedSteps -= stepsOf(cache.get(oldest)!);
    cache.delete(oldest);
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
  const key: string = [
    flags,
    options?.captures === true ? "captures" : "",
    options?.maxSteps ?? "",
    source,
  ].join("\u0000");
  const cached: LinearRegExp | Error | undefined = cache.get(key);

  if (cached !== undefined) {
    // Most recently used goes last.
    cache.delete(key);
    cache.set(key, cached);

    if (cached instanceof Error) {
      throw cached;
    }

    return cached;
  }

  let compiled: LinearRegExp | Error;

  try {
    compiled = new LinearRegExp(source, flags, options);
  } catch (error: unknown) {
    compiled = error instanceof Error ? error : new Error(String(error));
  }

  makeRoom(stepsOf(compiled));
  cache.set(key, compiled);
  cachedSteps += stepsOf(compiled);

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

// Test seam: forget every compiled pattern.
export function clearLinearRegExpCache(): void {
  cache.clear();
  cachedSteps = 0;
}
