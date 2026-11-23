import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";
import {
  compileScrubRuleCustomRegex,
  SCRUB_RULE_BUILT_IN_PATTERNS,
  SCRUB_RULE_SENSITIVE_KEY_REGEX,
  ScrubRegExp,
  scrubRegExpFromBuiltIn,
  scrubRegExpFromRanges,
} from "../../../../Types/Telemetry/ScrubRule";
import {
  readScrubRuleKeys,
  ScrubRuleKeyMatcher,
} from "../../../../Types/Telemetry/ScrubRuleKeys";
import { readOwnValue } from "../../../../Utils/LookupTable";
import ScrubIpAddress from "../../../../Utils/Telemetry/ScrubIpAddress";

/*
 * A SCRUB RULE AS INGEST RUNS IT, COMPILED ONCE (#10366).
 *
 * The log and trace engines (LogScrubEngine, TraceScrubEngine) and Data
 * Security's proof (DataSecurity/Telemetry/TelemetryScrubProof) run a
 * rule as this compiles it, so a rule proven on a finding's records is the
 * rule ingest runs:
 *
 *  - regex: what it finds in a value - a built-in pattern, what Data
 *    Security calls an IP address, the rule's own custom pattern - or, for
 *    a Sensitive Attribute Keys rule, the key pattern it reads keys with. A
 *    Named Attributes rule finds nothing in a value: its regex matches no
 *    text, so a walker that reads only values (a session replay's) leaves
 *    its records as they are;
 *  - keys: the attributes it names (attributeKeys) - the ones a Named
 *    Attributes rule hides whole, or the only ones a pattern rule reads.
 *    None for a rule that reads every attribute.
 *
 * Null for a rule that scrubs nothing: a pattern type no engine knows, a
 * custom pattern that does not compile, a Named Attributes rule that names
 * no attribute.
 */

// A saved rule as the engines read it: a LogScrubRule or a TraceScrubRule.
export interface ScrubEngineRule {
  _id?: unknown;
  id?: ObjectID | null | undefined;
  projectId?: ObjectID | string | null | undefined;
  name?: string | null | undefined;
  patternType?: string | null | undefined;
  customRegex?: string | null | undefined;
  scrubAction?: string | null | undefined;
  fieldsToScrub?: string | null | undefined;
  serviceId?: unknown;
  attributeKeys?: unknown;
}

export interface CompiledScrubRule<
  TRule extends ScrubEngineRule = ScrubEngineRule,
> {
  rule: TRule;
  regex: ScrubRegExp;
  keys?: ScrubRuleKeyMatcher | undefined;
}

// What a Named Attributes rule finds in a value: nothing.
const NO_TEXT: ScrubRegExp = scrubRegExpFromRanges({
  source: "(?!)",
  flags: "g",
  findRanges: (): Array<[number, number]> => {
    return [];
  },
});

export function isSensitiveKeysRule(rule: ScrubEngineRule): boolean {
  return (rule.patternType || "") === LogScrubPatternType.SensitiveKeys;
}

export function isNamedKeysRule(rule: ScrubEngineRule): boolean {
  return (rule.patternType || "") === LogScrubPatternType.NamedKeys;
}

// A rule that reads keys, not values: Sensitive Attribute Keys or Named Attributes.
export function isKeyTargetedRule(rule: ScrubEngineRule): boolean {
  return isSensitiveKeysRule(rule) || isNamedKeysRule(rule);
}

/*
 * What a rule finds in a value, as ingest compiles it - or null when it
 * finds nothing at all. A Named Attributes rule's is NO_TEXT.
 */
export function getScrubRuleRegex(rule: ScrubEngineRule): ScrubRegExp | null {
  const patternType: string = rule.patternType || "";

  if (patternType === LogScrubPatternType.Custom) {
    /*
     * Null for a pattern that is empty or does not compile: the rule
     * scrubs nothing. The API refuses to save such a rule, and the rules
     * table flags the ones saved before it did - all three judge the
     * pattern with Common/Types/Telemetry/ScrubRule, so they cannot
     * disagree on what ingest does with it.
     */
    return compileScrubRuleCustomRegex(rule.customRegex);
  }

  /*
   * SensitiveKeys compiles to the KEY regex — it is matched against
   * attribute keys (not values) by the attribute scrub loop, and skipped
   * entirely by scrubString.
   */
  if (patternType === LogScrubPatternType.SensitiveKeys) {
    return scrubRegExpFromBuiltIn(SCRUB_RULE_SENSITIVE_KEY_REGEX);
  }

  if (patternType === LogScrubPatternType.NamedKeys) {
    return NO_TEXT;
  }

  // What Data Security calls an IP address, found by its own detectors.
  if (patternType === LogScrubPatternType.IPAddress) {
    return ScrubIpAddress.toScrubRegExp();
  }

  /*
   * The saved rule's own word: a pattern type no table lists matches
   * nothing (a plain read answered "constructor" with a function).
   */
  const builtIn: RegExp | undefined = readOwnValue(
    SCRUB_RULE_BUILT_IN_PATTERNS,
    patternType,
  );

  // An instance of its own, so lastIndex is independent per use.
  return builtIn ? scrubRegExpFromBuiltIn(builtIn) : null;
}

/*
 * A rule compiled for the engines, or null when it scrubs nothing. A
 * Sensitive Attribute Keys rule reads every key, whatever keys it names.
 */
export function compileScrubRule<TRule extends ScrubEngineRule>(
  rule: TRule,
): CompiledScrubRule<TRule> | null {
  const regex: ScrubRegExp | null = getScrubRuleRegex(rule);

  if (!regex) {
    return null;
  }

  if (isSensitiveKeysRule(rule)) {
    return { rule, regex };
  }

  const keys: Array<string> = readScrubRuleKeys(rule.attributeKeys);

  if (keys.length === 0) {
    return isNamedKeysRule(rule) ? null : { rule, regex };
  }

  return { rule, regex, keys: new ScrubRuleKeyMatcher(keys) };
}

/*
 * Whether a pattern rule reads an attribute's value: every one, or - for a
 * rule that names keys - those it names. A key-targeted rule reads keys,
 * not values, and is asked elsewhere.
 */
export function doesRuleReadAttribute(
  compiled: Pick<CompiledScrubRule, "keys">,
  key: string,
): boolean {
  return !compiled.keys || compiled.keys.matches(key);
}

// The rule's id, as a counter names it: "" for a rule with none.
export function getScrubRuleIdText(rule: ScrubEngineRule): string {
  const id: unknown = rule.id || rule._id;

  return id ? String(id).toLowerCase() : "";
}
