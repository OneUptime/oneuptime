import LogScrubPatternType from "../Log/LogScrubPatternType";

/*
 * THE ATTRIBUTES A SCRUB RULE NAMES (#10366).
 *
 * A scrub rule can name the attributes it reads, by key
 * (LogScrubRule.attributeKeys, TraceScrubRule.attributeKeys):
 *
 *  - a Named Attributes rule (pattern type namedKeys) hides the WHOLE
 *    value of each attribute it names, whatever the value is - a person's
 *    name under customer_name, which no pattern can tell from a street;
 *  - any other pattern rule that names keys looks for its pattern only in
 *    the values of those attributes ("Only in these attributes"), so a
 *    pattern too broad for every value - nine digits, a routing number -
 *    is narrow enough for one attribute.
 *
 * A key names an attribute exactly, or by a dotted prefix: user names
 * user.full_name and user.email; request.headers names every header sent
 * as request.headers.<name>. Keys are matched without regard to case, as a
 * Sensitive Attribute Keys rule matches, and with their numbered parts
 * folded as Data Security names a place (gen_ai.prompt[].content is
 * gen_ai.prompt.0.content, gen_ai.prompt.1.content ...), so the key of a
 * finding's location names the attribute it was found in. Only an
 * attribute map's own keys are read, never a key inside a value: a list's,
 * a map's or a JSON text's whole value is hidden under a key that matches.
 *
 * Pure, and the same in ingest (Server/Utils/Telemetry/LogScrubEngine,
 * TraceScrubEngine), Data Security's coverage and proof, the readers
 * lookup and the rule form.
 */

export const SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE: string =
  LogScrubPatternType.NamedKeys;

// The most keys a rule names, and the longest key: an attribute key the scans read is at most 256.
export const MAX_SCRUB_RULE_KEYS: number = 50;
export const MAX_SCRUB_RULE_KEY_LENGTH: number = 256;

function isAllDigits(text: string): boolean {
  if (text.length === 0) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

/*
 * An attribute key with its numbered parts folded, as Data Security names a
 * place (Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner's
 * foldAttributeKey reads this): gen_ai.prompt.3.content is
 * gen_ai.prompt[].content, so the twenty messages of a chat are one place.
 */
export function foldAttributeKey(key: string): string {
  let folded: string = "";

  for (const part of key.split(".")) {
    if (isAllDigits(part)) {
      folded += "[]";
    } else {
      folded += folded.length > 0 ? "." + part : part;
    }
  }

  return folded;
}

// A key as a rule compares it: folded, in lower case.
export function toComparedScrubRuleKey(key: string): string {
  return foldAttributeKey(key.trim()).toLowerCase();
}

// A line break or a tab, which no attribute key a rule names holds.
const LINE_BREAK_OR_TAB: RegExp = /[\r\n\t]/;

// Whether a key is one a rule can keep: some text, no line breaks or tabs, not too long.
function isKeptKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= MAX_SCRUB_RULE_KEY_LENGTH &&
    !LINE_BREAK_OR_TAB.test(key)
  );
}

/*
 * The keys a rule keeps, from what was saved or typed: a list of texts,
 * or one text of keys each on a line or between commas, each trimmed,
 * compared folded and in lower case, kept once, at most MAX_SCRUB_RULE_KEYS
 * of them. Anything else names nothing.
 */
export function readScrubRuleKeys(value: unknown): Array<string> {
  const raw: Array<unknown> = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : [];
  const keys: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }

    const key: string = item.trim();

    if (!isKeptKey(key)) {
      continue;
    }

    const compared: string = toComparedScrubRuleKey(key);

    if (!compared || seen.has(compared)) {
      continue;
    }

    seen.add(compared);
    keys.push(key);

    if (keys.length >= MAX_SCRUB_RULE_KEYS) {
      break;
    }
  }

  return keys;
}

export enum ScrubRuleKeysProblem {
  // A Named Attributes rule that names no attribute hides nothing.
  Missing = "Missing",
  TooMany = "TooMany",
  TooLong = "TooLong",
}

/*
 * What stops a rule's keys from being saved, or null: a Named Attributes
 * rule needs at least one; no rule names more than MAX_SCRUB_RULE_KEYS, or
 * a key longer than MAX_SCRUB_RULE_KEY_LENGTH.
 */
export function checkScrubRuleKeys(data: {
  patternType: unknown;
  attributeKeys: unknown;
}): ScrubRuleKeysProblem | null {
  const given: Array<unknown> = Array.isArray(data.attributeKeys)
    ? data.attributeKeys
    : typeof data.attributeKeys === "string"
      ? data.attributeKeys.split(/[\n,]/)
      : [];
  const texts: Array<string> = given
    .filter((item: unknown): item is string => {
      return typeof item === "string";
    })
    .map((item: string): string => {
      return item.trim();
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });

  if (
    texts.some((item: string): boolean => {
      return item.length > MAX_SCRUB_RULE_KEY_LENGTH;
    })
  ) {
    return ScrubRuleKeysProblem.TooLong;
  }

  const distinct: Set<string> = new Set<string>(
    texts.map((item: string): string => {
      return toComparedScrubRuleKey(item);
    }),
  );

  if (distinct.size > MAX_SCRUB_RULE_KEYS) {
    return ScrubRuleKeysProblem.TooMany;
  }

  if (
    data.patternType === SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE &&
    readScrubRuleKeys(texts).length === 0
  ) {
    return ScrubRuleKeysProblem.Missing;
  }

  return null;
}

/*
 * Whether one of a rule's keys names an attribute: the attribute's key,
 * folded and in lower case, is the rule's key, or starts with it and a dot
 * or a folded number (user names user.email and user[].email).
 */
export function doesScrubRuleKeyName(
  ruleKey: string,
  attributeKey: string,
): boolean {
  const named: string = toComparedScrubRuleKey(ruleKey);
  const key: string = toComparedScrubRuleKey(attributeKey);

  if (!named || !key) {
    return false;
  }

  return (
    key === named || key.startsWith(named + ".") || key.startsWith(named + "[")
  );
}

/*
 * A rule's keys, compiled once for every attribute a record holds: the
 * exact keys in a set, the rest read as prefixes.
 */
export class ScrubRuleKeyMatcher {
  private readonly keys: ReadonlyArray<string>;
  private readonly exact: Set<string>;

  public constructor(keys: ReadonlyArray<string>) {
    this.keys = keys
      .map((key: string): string => {
        return toComparedScrubRuleKey(key);
      })
      .filter((key: string): boolean => {
        return key.length > 0;
      });
    this.exact = new Set<string>(this.keys);
  }

  public get isEmpty(): boolean {
    return this.keys.length === 0;
  }

  public matches(attributeKey: string): boolean {
    if (this.keys.length === 0 || typeof attributeKey !== "string") {
      return false;
    }

    const key: string = toComparedScrubRuleKey(attributeKey);

    if (this.exact.has(key)) {
      return true;
    }

    for (const named of this.keys) {
      if (key.startsWith(named + ".") || key.startsWith(named + "[")) {
        return true;
      }
    }

    return false;
  }
}

// Whether a rule's pattern type reads keys rather than values: Sensitive Attribute Keys or Named Attributes.
export function isKeyTargetedScrubPatternType(patternType: unknown): boolean {
  return (
    patternType === LogScrubPatternType.SensitiveKeys ||
    patternType === LogScrubPatternType.NamedKeys
  );
}
