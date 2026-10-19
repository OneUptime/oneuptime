import { parsePattern, PatternFlags } from "./Parser";
import { ParsedPattern } from "./Syntax";
import { PatternProblemError, PatternProblemReason } from "./PatternProblem";
import { CompiledPattern, compilePattern, DEFAULT_MAX_STEPS } from "./Program";
import {
  AnchoredOutcome,
  computeLookaroundTables,
  computeMatchStarts,
  execAnchored,
  positionBit,
  testProgram,
  WorkMeter,
} from "./Matcher";

/*
 * A JAVASCRIPT REGULAR EXPRESSION, MATCHED IN TIME IN LINE WITH THE TEXT.
 *
 * JavaScript's own RegExp backtracks: for some patterns - (a+)+$, or
 * ^.*a.*a.*a.*b$ - the time to say "no match" doubles with every character,
 * or grows with a high power of the text's length, so one short pattern can
 * hold a process for minutes or years. That is fine for patterns OneUptime
 * writes, and not for patterns the people using OneUptime write: those run
 * on servers, workers and ingest that every project shares.
 *
 * This class runs the same patterns - JavaScript's syntax and JavaScript's
 * answers: the same match, the same groups, case-insensitivity and \s as
 * JavaScript has them - with matchers whose work for each code unit of the
 * text is bounded by the size of the pattern, never by the text's length
 * (see Matcher.ts). Look-aheads and look-behinds work too.
 *
 * What it refuses (PatternProblemError, see PatternProblem.ts): a
 * back-reference (\1, \k<name>), which no matcher can run in linear time; a
 * pattern too large - longer than MAX_PATTERN_LENGTH, compiling to more steps
 * than maxSteps, nesting groups or empty-matching repeats too deep, or
 * holding too many look-arounds (Parser.ts, Program.ts); and, when captures
 * are asked for, a capturing group inside (?=...) or (?<=...). A pattern
 * that is not a regular expression at all throws the SyntaxError the running
 * engine's RegExp throws for it, word for word.
 *
 * Every question - test, exec, replace, matchAll - may take a number of
 * steps in line with the text's length (Matcher.ts, WorkMeter): a pattern
 * built to take more throws PatternWorkLimitError instead of holding the
 * process, and the caller decides what that means.
 *
 * Flags: i, m, s and g - and no u or v (no caller has needed them).
 */

export interface LinearRegExpOptions {
  // Whether exec reports what groups captured. Off: only where a match is.
  captures?: boolean | undefined;
  // How many steps the pattern may compile to (Program.ts DEFAULT_MAX_STEPS).
  maxSteps?: number | undefined;
}

export interface LinearRegExpMatch {
  // Where the match starts.
  index: number;
  // Where it ends: the position after its last code unit.
  end: number;
  // The text it matched.
  value: string;
  /*
   * What each group captured, group 1 first; undefined for a group that took
   * no part. Empty unless the pattern was compiled with captures.
   */
  captures: Array<string | undefined>;
  // Named groups' captures, by name (with captures only).
  groups: Record<string, string | undefined>;
}

const SUPPORTED_FLAGS: string = "gims";

/*
 * The longest pattern compiled, in code units: compiling costs time in line
 * with the pattern, and a pattern a person writes - a rule's, a scrub
 * rule's - or a grok pattern expanded from its library (at most 20,000) is
 * shorter.
 */
export const MAX_PATTERN_LENGTH: number = 20_000;

export default class LinearRegExp {
  public readonly source: string;
  public readonly flags: string;
  public readonly global: boolean;
  public readonly ignoreCase: boolean;
  public readonly multiline: boolean;
  public readonly dotAll: boolean;
  public readonly capturesGroups: boolean;

  private readonly compiled: CompiledPattern;

  public constructor(
    source: string,
    flags: string = "",
    options?: LinearRegExpOptions,
  ) {
    for (const flag of flags) {
      if (!SUPPORTED_FLAGS.includes(flag)) {
        throw new Error(
          `LinearRegExp does not support the "${flag}" flag (supported: ${SUPPORTED_FLAGS}).`,
        );
      }
    }

    /*
     * The running engine decides what is a regular expression, and says what
     * is wrong with what is not: the message people saw before. Building a
     * RegExp only parses the pattern; it is never run.
     */
    LinearRegExp.checkSyntax(source, flags);

    if (source.length > MAX_PATTERN_LENGTH) {
      throw new PatternProblemError(
        PatternProblemReason.TooLarge,
        `The pattern is longer than ${MAX_PATTERN_LENGTH} characters.`,
      );
    }

    this.source = source;
    this.flags = flags;
    this.global = flags.includes("g");
    this.ignoreCase = flags.includes("i");
    this.multiline = flags.includes("m");
    this.dotAll = flags.includes("s");
    this.capturesGroups = options?.captures === true;

    const patternFlags: PatternFlags = {
      ignoreCase: this.ignoreCase,
      multiline: this.multiline,
      dotAll: this.dotAll,
    };
    this.compiled = LinearRegExp.compile(source, patternFlags, {
      captures: this.capturesGroups,
      maxSteps: options?.maxSteps ?? DEFAULT_MAX_STEPS,
    });
  }

  private static compile(
    source: string,
    flags: PatternFlags,
    options: { captures: boolean; maxSteps: number },
  ): CompiledPattern {
    try {
      const parsed: ParsedPattern = parsePattern(source, flags);

      return compilePattern(parsed, options);
    } catch (error: unknown) {
      /*
       * Reading and compiling call themselves once per group; the limits on
       * nesting keep that well inside the stack, and a pattern that still
       * runs out of it is refused as too large rather than thrown as an
       * error of the engine.
       */
      if (error instanceof RangeError) {
        throw new PatternProblemError(
          PatternProblemReason.TooLarge,
          "The pattern is too large to compile.",
        );
      }

      throw error;
    }
  }

  private static checkSyntax(source: string, flags: string): void {
    // Throws the engine's own SyntaxError for what is not a pattern.
    RegExp(source, flags);
  }

  // How many capturing groups the pattern has.
  public get captureCount(): number {
    return this.compiled.captureCount;
  }

  /*
   * How many steps the pattern compiled to, its look-arounds and the copy
   * read backwards included: what it costs to keep.
   */
  public get steps(): number {
    return this.compiled.totalSteps;
  }

  // Whether the pattern matches anywhere in the text.
  public test(text: string): boolean {
    const meter: WorkMeter = this.meterFor(text);

    return testProgram(
      this.compiled.main,
      text,
      this.tablesFor(text, meter),
      meter,
    );
  }

  /*
   * The first match at or after `from`, as JavaScript's exec would find it
   * with lastIndex at `from`; null when there is none.
   */
  public exec(text: string, from: number = 0): LinearRegExpMatch | null {
    if (from > text.length) {
      return null;
    }

    const meter: WorkMeter = this.meterFor(text);
    const tables: Array<Uint8Array> = this.tablesFor(text, meter);
    const starts: Uint8Array = computeMatchStarts(
      this.compiled,
      text,
      tables,
      meter,
    );
    const slots: Array<number> | null = this.searchFrom({
      text: text,
      from: from,
      tables: tables,
      starts: starts,
      captures: this.capturesGroups,
      meter: meter,
    });

    return slots === null ? null : this.toMatch(text, slots);
  }

  /*
   * Every match, as String.prototype.replace with a global pattern finds
   * them: left to right, none overlapping, and after an empty match the next
   * search starts one code unit further on. Each match is replaced by what
   * `replacer` returns for its text.
   *
   * Throws PatternWorkLimitError when finding the matches would take more
   * steps than the text's length allows - a pattern built so that every
   * search reads on to the end of the text would take the square of it.
   */
  public replace(
    text: string,
    replacer: (matchedText: string) => string,
  ): string {
    if (!this.test(text)) {
      // Most texts hold no match: one quick reading says so.
      return text;
    }

    const pieces: Array<string> = [];
    let copiedUpTo: number = 0;

    this.forEachMatch(text, false, (slots: Array<number>): void => {
      const start: number = slots[0]!;
      const end: number = slots[1]!;

      pieces.push(text.slice(copiedUpTo, start));
      pieces.push(replacer(text.slice(start, end)));
      copiedUpTo = end;
    });

    pieces.push(text.slice(copiedUpTo));

    return pieces.join("");
  }

  /*
   * Every match, as String.prototype.matchAll finds them with a global
   * pattern; bounded the same way as replace.
   */
  public matchAll(text: string): Array<LinearRegExpMatch> {
    const matches: Array<LinearRegExpMatch> = [];

    if (!this.test(text)) {
      return matches;
    }

    this.forEachMatch(
      text,
      this.capturesGroups,
      (slots: Array<number>): void => {
        matches.push(this.toMatch(text, slots));
      },
    );

    return matches;
  }

  private forEachMatch(
    text: string,
    captures: boolean,
    onMatch: (slots: Array<number>) => void,
  ): void {
    // One meter for every search: together they read the text in line with it.
    const meter: WorkMeter = this.meterFor(text);
    const tables: Array<Uint8Array> = this.tablesFor(text, meter);
    const starts: Uint8Array = computeMatchStarts(
      this.compiled,
      text,
      tables,
      meter,
    );
    let searchFrom: number = 0;

    while (searchFrom <= text.length) {
      const slots: Array<number> | null = this.searchFrom({
        text: text,
        from: searchFrom,
        tables: tables,
        starts: starts,
        captures: captures,
        meter: meter,
      });

      if (slots === null) {
        return;
      }

      onMatch(slots);

      const start: number = slots[0]!;
      const end: number = slots[1]!;
      searchFrom = end === start ? end + 1 : end;
    }
  }

  /*
   * The match exec finds from `from`: the leftmost position at or after it
   * where a match starts (starts), and the match a backtracking engine takes
   * from there.
   */
  private searchFrom(data: {
    text: string;
    from: number;
    tables: ReadonlyArray<Uint8Array>;
    starts: Uint8Array;
    captures: boolean;
    meter: WorkMeter;
  }): Array<number> | null {
    for (let start: number = data.from; start <= data.text.length; start++) {
      if (positionBit(data.starts, start) !== 1) {
        continue;
      }

      const outcome: AnchoredOutcome = execAnchored(
        this.compiled.main,
        data.text,
        start,
        data.tables,
        data.captures,
        data.meter,
      );

      if (outcome.slots !== null) {
        return outcome.slots;
      }
    }

    return null;
  }

  // The work one question about this text may take (Matcher.ts, WorkMeter).
  private meterFor(text: string): WorkMeter {
    return WorkMeter.forText(text.length, this.compiled.totalSteps);
  }

  private tablesFor(text: string, meter: WorkMeter): Array<Uint8Array> {
    if (this.compiled.lookarounds.length === 0) {
      return [];
    }

    return computeLookaroundTables(this.compiled, text, meter);
  }

  private toMatch(text: string, slots: Array<number>): LinearRegExpMatch {
    const index: number = slots[0]!;
    const end: number = slots[1]!;
    const captures: Array<string | undefined> = [];
    const groups: Record<string, string | undefined> = {};

    if (this.capturesGroups) {
      for (
        let group: number = 1;
        group <= this.compiled.captureCount;
        group++
      ) {
        const start: number = slots[group * 2]!;
        const stop: number = slots[group * 2 + 1]!;
        const value: string | undefined =
          start >= 0 && stop >= 0 ? text.slice(start, stop) : undefined;

        captures.push(value);

        const name: string | null | undefined =
          this.compiled.captureNames[group - 1];

        /*
         * Two groups may share a name in different alternatives: the one
         * that took part gives the value.
         */
        if (name && groups[name] === undefined) {
          groups[name] = value;
        }
      }
    }

    return {
      index: index,
      end: end,
      value: text.slice(index, end),
      captures: captures,
      groups: groups,
    };
  }
}
