import LogScrubAction from "../Log/LogScrubAction";
import LogScrubField from "../Log/LogScrubField";
import LogScrubPatternType from "../Log/LogScrubPatternType";
import TraceScrubAction from "../Trace/TraceScrubAction";
import TraceScrubField from "../Trace/TraceScrubField";
import TraceScrubPatternType from "../Trace/TraceScrubPatternType";
import LinearRegExp from "../../Utils/LinearRegExp/LinearRegExp";
import { getLinearRegExp } from "../../Utils/LinearRegExp/PatternCache";
import {
  PatternProblemError,
  PatternWorkLimitError,
} from "../../Utils/LinearRegExp/PatternProblem";

/*
 * WHAT A LOG OR TRACE SCRUB RULE STARTS WITH, AND WHAT MAKES ONE SCRUB
 * NOTHING.
 *
 * Shared by the models (their column defaults), the server's save-time check
 * (Server/Utils/ScrubRuleValidation.ts), the ingest engines
 * (App/FeatureSet/Telemetry/Services/LogScrubRuleService.ts and
 * TraceScrubRuleService.ts) and the dashboard's create forms, so the four can
 * never disagree on what a rule does.
 *
 * The bug this file is the fix for: a "Custom Regex" rule could be saved with
 * an empty pattern, or one that does not compile. Ingest skips such a rule
 * (it has nothing to match with), so the rule looked active in the rules
 * table while the personal data it was made for was stored in the clear. A
 * rule is now refused unless ingest can actually use it, and the rules table
 * flags the ones saved before that.
 */

// The pattern type whose matches are found with the rule's own regex.
export const SCRUB_RULE_CUSTOM_PATTERN_TYPE: string =
  LogScrubPatternType.Custom;

/*
 * The pattern type that scrubs the whole value of an attribute whose key
 * looks sensitive (password, token, ...). It reads attribute keys, so a
 * rule's fields-to-scrub choice does not apply to it: logs scrub attributes,
 * spans their attributes and event attributes.
 */
export const SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE: string =
  LogScrubPatternType.SensitiveKeys;

/*
 * The flags ingest compiles a custom pattern with: every match in the text,
 * case-sensitive.
 */
export const SCRUB_RULE_REGEX_FLAGS: string = "g";

/*
 * WHAT INGEST SCRUBS WITH.
 *
 * A rule's pattern, compiled: a custom pattern - written by the project's
 * people and run over every record the project sends, on ingest that every
 * project shares - runs on the linear-time matcher (Utils/LinearRegExp), so
 * no pattern can make one record take time out of proportion to its length;
 * a built-in pattern (email, credit card, ...) is OneUptime's own and keeps
 * JavaScript's RegExp.
 */
export interface ScrubRegExp {
  readonly source: string;
  readonly flags: string;
  // Whether the text holds a match: a sensitive-keys rule reads keys so.
  test(text: string): boolean;
  // Every match replaced by what `replacer` returns for it.
  replace(text: string, replacer: (matchedText: string) => string): string;
}

class CustomScrubRegExp implements ScrubRegExp {
  public readonly source: string;
  public readonly flags: string;
  private readonly pattern: LinearRegExp;

  public constructor(pattern: LinearRegExp) {
    this.pattern = pattern;
    this.source = pattern.source;
    this.flags = pattern.flags;
  }

  public test(text: string): boolean {
    try {
      return this.pattern.test(text);
    } catch (error: unknown) {
      if (error instanceof PatternWorkLimitError) {
        // Taken as holding what the rule scrubs, as replace does.
        return true;
      }

      throw error;
    }
  }

  public replace(
    text: string,
    replacer: (matchedText: string) => string,
  ): string {
    try {
      return this.pattern.replace(text, replacer);
    } catch (error: unknown) {
      if (error instanceof PatternWorkLimitError) {
        /*
         * A pattern built so that finding every match would read the text
         * over and over: rather than store what it was written to hide, the
         * whole value is scrubbed.
         */
        return replacer(text);
      }

      throw error;
    }
  }
}

class BuiltInScrubRegExp implements ScrubRegExp {
  public readonly source: string;
  public readonly flags: string;
  private readonly regex: RegExp;

  public constructor(regex: RegExp) {
    // An instance of its own, so lastIndex is never shared.
    this.regex = new RegExp(regex.source, regex.flags);
    this.source = regex.source;
    this.flags = regex.flags;
  }

  public test(text: string): boolean {
    this.regex.lastIndex = 0;
    const matches: boolean = this.regex.test(text);
    this.regex.lastIndex = 0;
    return matches;
  }

  public replace(
    text: string,
    replacer: (matchedText: string) => string,
  ): string {
    this.regex.lastIndex = 0;
    return text.replace(this.regex, (matchedText: string): string => {
      return replacer(matchedText);
    });
  }
}

/*
 * A built-in pattern, which OneUptime wrote, as ingest scrubs with it.
 * Never pass a pattern a project wrote here: compileScrubRuleCustomRegex is
 * for those.
 */
export function scrubRegExpFromBuiltIn(regex: RegExp): ScrubRegExp {
  return new BuiltInScrubRegExp(regex);
}

export const LOG_SCRUB_PATTERN_TYPES: ReadonlyArray<string> =
  Object.values(LogScrubPatternType);

export const TRACE_SCRUB_PATTERN_TYPES: ReadonlyArray<string> = Object.values(
  TraceScrubPatternType,
);

export const LOG_SCRUB_FIELDS: ReadonlyArray<string> =
  Object.values(LogScrubField);

export const TRACE_SCRUB_FIELDS: ReadonlyArray<string> =
  Object.values(TraceScrubField);

export interface ScrubRuleDefaults {
  scrubAction: string;
  fieldsToScrub: string;
  isEnabled: boolean;
}

/*
 * What a new rule does when its creator leaves these alone: replace every
 * match with [REDACTED], wherever in the record it is, from the moment it is
 * saved. The models' column defaults (TableColumn and the database's own),
 * the API schema and the dashboard form all read them from here.
 */
export const LOG_SCRUB_RULE_DEFAULTS: ScrubRuleDefaults = {
  scrubAction: LogScrubAction.Redact,
  fieldsToScrub: LogScrubField.Both,
  isEnabled: true,
};

export const TRACE_SCRUB_RULE_DEFAULTS: ScrubRuleDefaults = {
  scrubAction: TraceScrubAction.Redact,
  fieldsToScrub: TraceScrubField.All,
  isEnabled: true,
};

export enum ScrubRuleCustomRegexProblem {
  // No pattern at all, or only spaces.
  Missing = "Missing",
  // Not a regular expression the engine can compile.
  Invalid = "Invalid",
  /*
   * A regular expression, but one the linear-time matcher cannot run: it
   * refers back to what a group matched (\1, \k<name>), or it is too
   * large.
   */
  CannotRun = "CannotRun",
  /*
   * Compiles, but matches empty text - "\d*", "(secret)?" - so a global
   * replace puts the rule's replacement between every character of every
   * record it reads.
   */
  MatchesEmptyText = "MatchesEmptyText",
}

export interface ScrubRuleCustomRegexCheck {
  problem: ScrubRuleCustomRegexProblem;
  // For an Invalid pattern: what the regular expression engine said.
  reason?: string | undefined;
  // For a pattern that cannot run: why (PatternProblem.ts).
  cannotRunReason?: PatternProblemError["reason"] | undefined;
}

// "Invalid regular expression: /(/g: Unterminated group" -> its last part.
const REGEX_SYNTAX_ERROR_PREFIX: RegExp =
  /^Invalid regular expression: \/[\s\S]*\/[a-z]*: /;

/**
 * What the regular expression engine says is wrong with a pattern, without
 * the pattern repeated in front of it: "Unterminated group".
 */
export function getRegexSyntaxErrorReason(error: unknown): string {
  const message: string =
    error instanceof Error ? error.message : String(error || "");

  return message.replace(REGEX_SYNTAX_ERROR_PREFIX, "").trim() || message;
}

/**
 * A custom pattern compiled the way ingest compiles it - ingest calls this -
 * or null when it cannot be: empty, not a regular expression, or one the
 * linear-time matcher cannot run (a back-reference). A rule whose pattern
 * compiles to null scrubs nothing.
 */
export function compileScrubRuleCustomRegex(
  customRegex: unknown,
): ScrubRegExp | null {
  if (typeof customRegex !== "string" || customRegex.length === 0) {
    return null;
  }

  try {
    return new CustomScrubRegExp(
      getLinearRegExp(customRegex, SCRUB_RULE_REGEX_FLAGS),
    );
  } catch {
    return null;
  }
}

/**
 * What stops a custom pattern from being saved, or null when it is one
 * ingest can scrub with. Stricter than compileScrubRuleCustomRegex, which
 * says what ingest does with a stored pattern: only spaces count as no
 * pattern, and one that matches empty text is a mistake to refuse.
 */
export function checkScrubRuleCustomRegex(
  customRegex: unknown,
): ScrubRuleCustomRegexCheck | null {
  if (typeof customRegex !== "string" || customRegex.trim().length === 0) {
    return { problem: ScrubRuleCustomRegexProblem.Missing };
  }

  let regex: LinearRegExp;

  try {
    regex = getLinearRegExp(customRegex, SCRUB_RULE_REGEX_FLAGS);
  } catch (error: unknown) {
    if (error instanceof PatternProblemError) {
      return {
        problem: ScrubRuleCustomRegexProblem.CannotRun,
        cannotRunReason: error.reason,
      };
    }

    return {
      problem: ScrubRuleCustomRegexProblem.Invalid,
      reason: getRegexSyntaxErrorReason(error),
    };
  }

  if (matchesEmptyText(regex)) {
    return { problem: ScrubRuleCustomRegexProblem.MatchesEmptyText };
  }

  return null;
}

/*
 * Text that holds the characters scrubbed values sit among - letters,
 * digits, spaces, separators, an address, a key and its value - so a
 * pattern that matches nothing but a position somewhere in a record ("\b",
 * "(?=@)", "(?<=:)\s*", "x*(?=y)") is caught as surely as one that matches
 * empty text on its own ("\d*").
 */
const EMPTY_MATCH_PROBES: ReadonlyArray<string> = [
  "",
  "a",
  "token=abc123; user@example.com",
  "key: value, x y z",
  "Aa1 -_.,:;=/\\@#$%&*+?!()[]{}<>'\"`|^~\t\n",
];

// Whether a compiled pattern ever matches no text at all.
function matchesEmptyText(regex: LinearRegExp): boolean {
  for (const probe of EMPTY_MATCH_PROBES) {
    // matchAll steps past an empty match, so this always ends.
    for (const match of regex.matchAll(probe)) {
      if (match.value === "") {
        return true;
      }
    }
  }

  return false;
}

/**
 * Whether a stored rule scrubs nothing at all: ingest skips a rule of a
 * pattern type it does not know and a custom rule whose pattern is empty or
 * does not compile, and a rule whose fields-to-scrub it does not know
 * matches but scrubs none of the record's fields (a sensitive-keys rule
 * aside: it always scrubs attributes). The rules tables flag such rules,
 * saved before the server refused them, so nobody takes them for protection.
 */
export function doesScrubRuleScrubNothing(data: {
  patternType: unknown;
  customRegex: unknown;
  fieldsToScrub: unknown;
  knownPatternTypes: ReadonlyArray<string>;
  knownFieldsToScrub: ReadonlyArray<string>;
}): boolean {
  if (
    typeof data.patternType !== "string" ||
    !data.knownPatternTypes.includes(data.patternType)
  ) {
    return true;
  }

  /*
   * Left empty, ingest scrubs every field; a value it does not know, none of
   * them.
   */
  if (
    data.patternType !== SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE &&
    typeof data.fieldsToScrub === "string" &&
    data.fieldsToScrub.length > 0 &&
    !data.knownFieldsToScrub.includes(data.fieldsToScrub)
  ) {
    return true;
  }

  if (data.patternType !== SCRUB_RULE_CUSTOM_PATTERN_TYPE) {
    return false;
  }

  return compileScrubRuleCustomRegex(data.customRegex) === null;
}
