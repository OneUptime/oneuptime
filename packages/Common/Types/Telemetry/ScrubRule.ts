import LogScrubAction from "../Log/LogScrubAction";
import LogScrubField from "../Log/LogScrubField";
import LogScrubPatternType from "../Log/LogScrubPatternType";
import TraceScrubAction from "../Trace/TraceScrubAction";
import TraceScrubField from "../Trace/TraceScrubField";
import TraceScrubPatternType from "../Trace/TraceScrubPatternType";

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
 * or null when it cannot be: empty, or not a regular expression. A rule
 * whose pattern compiles to null scrubs nothing.
 */
export function compileScrubRuleCustomRegex(
  customRegex: unknown,
): RegExp | null {
  if (typeof customRegex !== "string" || customRegex.length === 0) {
    return null;
  }

  try {
    return new RegExp(customRegex, SCRUB_RULE_REGEX_FLAGS);
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

  let regex: RegExp;

  try {
    regex = new RegExp(customRegex, SCRUB_RULE_REGEX_FLAGS);
  } catch (error: unknown) {
    return {
      problem: ScrubRuleCustomRegexProblem.Invalid,
      reason: getRegexSyntaxErrorReason(error),
    };
  }

  regex.lastIndex = 0;

  if (regex.exec("") !== null) {
    return { problem: ScrubRuleCustomRegexProblem.MatchesEmptyText };
  }

  return null;
}

/**
 * Whether a stored rule scrubs nothing at all: ingest skips a rule of a
 * pattern type it does not know, and a custom rule whose pattern is empty or
 * does not compile. The rules tables flag such rules, saved before the
 * server refused them, so nobody takes them for protection.
 */
export function doesScrubRuleScrubNothing(data: {
  patternType: unknown;
  customRegex: unknown;
  knownPatternTypes: ReadonlyArray<string>;
}): boolean {
  if (
    typeof data.patternType !== "string" ||
    !data.knownPatternTypes.includes(data.patternType)
  ) {
    return true;
  }

  if (data.patternType !== SCRUB_RULE_CUSTOM_PATTERN_TYPE) {
    return false;
  }

  return compileScrubRuleCustomRegex(data.customRegex) === null;
}
