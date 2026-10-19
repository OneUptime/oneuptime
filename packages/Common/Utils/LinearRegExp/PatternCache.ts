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
 * compiled pattern - with the states its matcher has met so far - is kept
 * here, the least recently used dropped first. A pattern that cannot be
 * compiled is kept too, so it is refused once rather than once per record.
 */

export const MAX_CACHED_PATTERNS: number = 256;

const cache: Map<string, LinearRegExp | Error> = new Map<
  string,
  LinearRegExp | Error
>();

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

  if (cache.size >= MAX_CACHED_PATTERNS) {
    const oldest: string | undefined = cache.keys().next().value;

    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }

  cache.set(key, compiled);

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

// Test seam: forget every compiled pattern.
export function clearLinearRegExpCache(): void {
  cache.clear();
}
