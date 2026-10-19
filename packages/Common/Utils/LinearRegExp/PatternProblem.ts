/*
 * WHY A PATTERN THAT IS A VALID JAVASCRIPT REGULAR EXPRESSION CANNOT RUN HERE.
 *
 * The matcher in this folder takes time in line with the text it reads,
 * whatever the pattern. A few things a JavaScript regular expression can say
 * cannot be matched that way, and a pattern that uses one is refused instead
 * of run; the reason says which, so the person who wrote it can be told what
 * to change.
 */

export enum PatternProblemReason {
  /*
   * \1 or \k<name>: "the same text as that group matched". Matching it can
   * take time that grows exponentially with the text, so no linear-time
   * matcher offers it.
   */
  BackReference = "BackReference",
  /*
   * The pattern compiles to more steps than a pattern may have - mostly a
   * large count such as .{0,5000}, which is written once but repeats its
   * body thousands of times.
   */
  TooLarge = "TooLarge",
  /*
   * A capturing group inside (?=...) or (?<=...), where a caller needs what
   * the groups captured (a grok pattern's fields).
   */
  CaptureInsideLookaround = "CaptureInsideLookaround",
}

export class PatternProblemError extends Error {
  public readonly reason: PatternProblemReason;

  public constructor(reason: PatternProblemReason, message: string) {
    super(message);
    this.name = "PatternProblemError";
    this.reason = reason;
  }
}

/*
 * Thrown by a replace that reached its work limit: the matches could not all
 * be found within a number of steps in line with the text's length. The
 * caller decides what that means - a scrub rule scrubs the whole value.
 */
export class PatternWorkLimitError extends Error {
  public constructor() {
    super(
      "The pattern needed more work to find every match than this text's length allows.",
    );
    this.name = "PatternWorkLimitError";
  }
}

/*
 * Why a pattern cannot run, in words for the person who wrote it: the rest
 * of a sentence that starts "This pattern ..." (or "The custom pattern ...").
 */
export function describePatternProblemReason(
  reason: PatternProblemReason,
): string {
  switch (reason) {
    case PatternProblemReason.BackReference:
      return "refers back to what an earlier group matched (\\1 or \\k<name>). Patterns are run in time that grows only in line with the text they read, which a back-reference cannot do. Write the pattern without it.";
    case PatternProblemReason.TooLarge:
      return "is too large to run. Shorten it, or repeat its parts fewer times.";
    case PatternProblemReason.CaptureInsideLookaround:
    default:
      return "captures a group inside a look-ahead or look-behind. Use a non-capturing group (?:...) there.";
  }
}
