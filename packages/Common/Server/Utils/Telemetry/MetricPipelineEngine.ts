import MetricPipelineRule from "../../../Models/DatabaseModels/MetricPipelineRule";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import MetricPipelineRuleFilterCondition, {
  isMetricFilterPatternType,
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "../../../Types/Metrics/MetricPipelineRuleType";
import {
  CUSTOM_PATTERN_READINGS,
  mayReadOtherwise,
  ScrubRegExp,
  scrubRegExpUnderKey,
} from "../../../Types/Telemetry/ScrubRule";
import {
  ReadingNeeds,
  TextReading,
  TextReadings,
} from "../../../Utils/DataSecurity/TextReadings";
import LinearRegExp from "../../../Utils/LinearRegExp/LinearRegExp";
import { compileBuiltInScrubPattern } from "../../../Utils/Telemetry/ScrubBuiltInPatterns";
import { getLinearRegExp } from "../../../Utils/LinearRegExp/PatternCache";
import { PatternWorkLimitError } from "../../../Utils/LinearRegExp/PatternProblem";
import { patternWorkRefusesQuestions } from "../../../Utils/LinearRegExp/PatternWork";
import { writeOwnValue } from "../../../Utils/LookupTable";
import logger from "../Logger";
import PatternWorkScope from "../PatternWorkScope";

/*
 * A METRIC ROW AS A PROJECT'S PIPELINE RULES LEAVE IT: THE ONE ENGINE FOR
 * METRICS (#10753).
 *
 * Ingest (App/FeatureSet/Telemetry/Services/MetricPipelineRuleService,
 * which loads and caches each project's rules) and Data Security's proof of
 * a metric rule on a finding's data points (DataSecurity/Telemetry/
 * TelemetryScrubProof) run every metric pipeline rule here, so a rule proven
 * on a finding's records is the rule ingest runs - as the log and trace
 * scrub engines are shared (Telemetry/ScrubEngine, #10366). Moved here from
 * the service as it was: which rules a row meets (its filters, All or Any),
 * and what each rule type does - Drop, Filter, Sample, Rename Metric,
 * Rename / Add / Remove / Redact Attribute.
 */

/*
 * Compiled-regex memo for MatchesRegex / DoesNotMatchRegex filters.
 * applyRules runs per metric ROW, and compiling the pattern (plus a warn log
 * for invalid patterns) per row is exactly the per-record cost the 60s rule
 * cache exists to avoid. Patterns are compiled once per process; an invalid
 * pattern is stored as null and warned about once, not per datapoint. The
 * size cap only guards against a pathological churn of distinct patterns —
 * normal deployments hold one entry per configured regex rule.
 *
 * The patterns are the project's own and run on ingest every project shares,
 * against attribute values the project's senders choose, so they run on the
 * linear-time matcher (Utils/LinearRegExp): JavaScript's syntax and answers,
 * in time in line with the value. A back-reference (\1) cannot run that
 * way; such a filter is invalid like any pattern that does not compile.
 * The compiled patterns are kept in the matcher's own cache
 * (getLinearRegExp), bounded by the steps they hold; this memo only
 * remembers which patterns were warned about - by at most the first
 * REGEX_MEMO_MAX_KEY_LENGTH characters of each: a filter saved before such
 * filters were refused can carry a pattern of megabytes, and a memo of a
 * thousand of them would hold gigabytes.
 */
const REGEX_MEMO_MAX_ENTRIES: number = 1000;
const REGEX_MEMO_MAX_KEY_LENGTH: number = 1000;
const warnedInvalidPatterns: Set<string> = new Set<string>();

// Each built-in pattern a Matches Pattern Type filter names, compiled once: five at most.
const compiledPatternTypes: Map<string, ScrubRegExp | null> = new Map<
  string,
  ScrubRegExp | null
>();

// What the memo keeps a pattern by: itself, or its length and beginning.
function warnedPatternKey(pattern: string): string {
  return pattern.length <= REGEX_MEMO_MAX_KEY_LENGTH
    ? pattern
    : `${pattern.length}\u0000${pattern.slice(0, REGEX_MEMO_MAX_KEY_LENGTH)}`;
}

// How a warning shows a pattern: whole, or its beginning and its length.
function shownPattern(pattern: string): string {
  return pattern.length <= REGEX_MEMO_MAX_KEY_LENGTH
    ? `"${pattern}"`
    : `"${pattern.slice(0, REGEX_MEMO_MAX_KEY_LENGTH)}…" (${pattern.length} characters)`;
}

/*
 * The compiled pattern, or null when it cannot be compiled - warned about
 * once. Throws PatternWorkLimitError when it was not compiled only because
 * the batch's work allowance is spent (Common/Utils/LinearRegExp/
 * PatternWork.ts): nothing is wrong with the pattern then.
 */
function getCompiledRegex(
  pattern: string,
  ruleId: string,
): LinearRegExp | null {
  try {
    return getLinearRegExp(pattern);
  } catch (err) {
    if (err instanceof PatternWorkLimitError) {
      throw err;
    }

    const key: string = warnedPatternKey(pattern);

    if (!warnedInvalidPatterns.has(key)) {
      if (warnedInvalidPatterns.size >= REGEX_MEMO_MAX_ENTRIES) {
        warnedInvalidPatterns.clear();
      }

      warnedInvalidPatterns.add(key);
      logger.warn(
        `Invalid regex ${shownPattern(pattern)} (first seen on MetricPipelineRule ${ruleId}; warned once per pattern — every rule using it treats the filter as non-matching): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return null;
  }
}

/*
 * The rule types that hide what their filters match: they drop the row, or
 * remove or redact an attribute.
 */
const HIDING_RULE_TYPES: ReadonlySet<MetricPipelineRuleType> = new Set([
  MetricPipelineRuleType.Drop,
  MetricPipelineRuleType.RedactAttribute,
  MetricPipelineRuleType.RemoveAttribute,
]);

/*
 * The readings a hiding rule's pattern also tries a value in: a Custom
 * Regex log or trace rule's (ScrubRule's CUSTOM_PATTERN_READINGS).
 */
const PATTERN_READINGS: ReadingNeeds = CUSTOM_PATTERN_READINGS;

/*
 * Whether a pattern matches a value in a reading beside the value as
 * written - its percent-escapes read, a "+" read as the space a URL's
 * query string writes it for, every script's digits read by their values,
 * a number's fullwidth signs and separators read as ASCII
 * (Utils/DataSecurity/TextReadings, #11031, #11033, #11199, #11115), the
 * other dashes between its digits as hyphens and the fullwidth ASCII block
 * as ASCII (#11385) - as a Custom Regex log or trace rule reads one.
 * Asked only of a rule that hides, for Matches Regex: so the metric rule
 * "Scrub it" makes from a data type's patterns (a token, an IBAN) hides a
 * value Data Security finds encoded, with "+"s between its groups, in
 * another script's digits or typed in fullwidth, and no rule ever hides
 * less than it did - Does Not Match Regex, and a Filter, Sample or Rename
 * rule, read the value as written alone, as before.
 */
function matchesInOtherReadings(re: LinearRegExp, value: string): boolean {
  if (!mayReadOtherwise(value)) {
    return false;
  }

  const readings: Array<TextReading> = new TextReadings(value).readingsFor(
    PATTERN_READINGS,
  );

  for (let index: number = 1; index < readings.length; index++) {
    if (re.test(readings[index]!.text)) {
      return true;
    }
  }

  return false;
}

/*
 * Treat the metric row's attributes as a loose JSONObject. The ingest pipeline
 * builds rows with `attributes: JSONObject` and `attributeKeys: string[]`.
 */
export interface MutableMetricRow extends JSONObject {
  name?: JSONValue;
  attributes?: JSONValue;
  attributeKeys?: JSONValue;
}

export default class MetricPipelineEngine {
  /*
   * Returns a mutated row, or null if the row should be dropped.
   *
   * Evaluation order: service-scoped rules first (may drop via Drop/Filter/Sample),
   * then project-wide rules on whatever survives.
   */
  public static applyRules(
    row: MutableMetricRow,
    serviceRules: ReadonlyArray<MetricPipelineRule>,
    projectRules: ReadonlyArray<MetricPipelineRule>,
  ): MutableMetricRow | null {
    /*
     * The record's texts add their share to the batch's work allowance when
     * the first of these patterns is asked about it
     * (Common/Server/Utils/PatternWorkScope.ts).
     */
    PatternWorkScope.handOverRecord(row);

    let current: MutableMetricRow | null = row;

    /*
     * Attribute-key bookkeeping is deferred: rule evaluation only reads the
     * attributes map itself, never attributeKeys, so mutating rules mark the
     * row dirty and the sorted key list is rebuilt ONCE after all rules ran
     * instead of once per mutating rule per row.
     */
    const state: { attributeKeysDirty: boolean } = {
      attributeKeysDirty: false,
    };

    for (const rule of serviceRules) {
      current = this.applyOne(current!, rule, state);
      if (current === null) {
        return null;
      }
    }

    for (const rule of projectRules) {
      current = this.applyOne(current!, rule, state);
      if (current === null) {
        return null;
      }
    }

    if (state.attributeKeysDirty && current) {
      current.attributeKeys = Object.keys(this.getAttributes(current)).sort();
    }

    return current;
  }

  public static applyOne(
    row: MutableMetricRow,
    rule: MetricPipelineRule,
    state: { attributeKeysDirty: boolean },
  ): MutableMetricRow | null {
    const matched: boolean = this.matches(row, rule);

    /*
     * Filter has inverse semantics: it is an allowlist.
     * A Filter rule keeps matched rows and drops everything else.
     */
    if (rule.ruleType === MetricPipelineRuleType.Filter) {
      return matched ? row : null;
    }

    // All other rule types are no-ops for non-matching rows.
    if (!matched) {
      return row;
    }

    switch (rule.ruleType) {
      case MetricPipelineRuleType.Drop:
        return null;

      case MetricPipelineRuleType.Sample: {
        const pct: number =
          typeof rule.samplePercentage === "number"
            ? rule.samplePercentage
            : 100;
        if (Math.random() * 100 >= pct) {
          return null;
        }
        return row;
      }

      case MetricPipelineRuleType.RenameMetric: {
        const to: string | undefined = rule.renameToKey || undefined;
        if (to) {
          row.name = to;
        }
        return row;
      }

      case MetricPipelineRuleType.RenameAttribute: {
        const from: string | undefined = rule.renameFromKey || undefined;
        const to: string | undefined = rule.renameToKey || undefined;
        if (!from || !to) {
          return row;
        }
        const attrs: JSONObject = this.getAttributes(row);
        if (Object.prototype.hasOwnProperty.call(attrs, from)) {
          // As the row's own key, even one named __proto__.
          writeOwnValue(attrs, to, attrs[from] as JSONValue);
          delete attrs[from];
          row.attributes = attrs;
          state.attributeKeysDirty = true;
        }
        return row;
      }

      case MetricPipelineRuleType.AddAttribute: {
        const key: string | undefined = rule.addAttributeKey || undefined;
        if (!key) {
          return row;
        }
        const attrs: JSONObject = this.getAttributes(row);
        writeOwnValue(attrs, key, rule.addAttributeValue ?? "");
        row.attributes = attrs;
        state.attributeKeysDirty = true;
        return row;
      }

      case MetricPipelineRuleType.RemoveAttribute: {
        const key: string | undefined = rule.addAttributeKey || undefined;
        if (!key) {
          return row;
        }
        const attrs: JSONObject = this.getAttributes(row);
        if (Object.prototype.hasOwnProperty.call(attrs, key)) {
          delete attrs[key];
          row.attributes = attrs;
          state.attributeKeysDirty = true;
        }
        return row;
      }

      case MetricPipelineRuleType.RedactAttribute: {
        const key: string | undefined = rule.addAttributeKey || undefined;
        if (!key) {
          return row;
        }
        const attrs: JSONObject = this.getAttributes(row);
        if (Object.prototype.hasOwnProperty.call(attrs, key)) {
          attrs[key] = rule.redactReplacement || "[REDACTED]";
          row.attributes = attrs;
        }
        return row;
      }

      default:
        logger.warn(
          `Unknown MetricPipelineRuleType: ${String(rule.ruleType)} (rule id=${String(rule._id)})`,
        );
        return row;
    }
  }

  private static matches(
    row: MutableMetricRow,
    rule: MetricPipelineRule,
  ): boolean {
    const filters: Array<MetricPipelineRuleFilterCondition> = Array.isArray(
      rule.filters,
    )
      ? rule.filters
      : [];

    // No filters means match everything (keeps parity with Workspace Notification Rule).
    if (filters.length === 0) {
      return true;
    }

    const combineWith: FilterCondition =
      rule.filterCondition === FilterCondition.Any
        ? FilterCondition.Any
        : FilterCondition.All;

    if (combineWith === FilterCondition.Any) {
      for (const filter of filters) {
        if (this.evaluateFilter(row, filter, rule)) {
          return true;
        }
      }
      return false;
    }

    for (const filter of filters) {
      if (!this.evaluateFilter(row, filter, rule)) {
        return false;
      }
    }
    return true;
  }

  private static evaluateFilter(
    row: MutableMetricRow,
    filter: MetricPipelineRuleFilterCondition,
    rule: MetricPipelineRule,
  ): boolean {
    if (!filter || !filter.checkOn || !filter.conditionType) {
      return false;
    }

    if (filter.checkOn === MetricPipelineRuleFilterCheckOn.MetricName) {
      const metricName: string =
        typeof row.name === "string" ? row.name : String(row.name ?? "");
      return this.compareStringValue(
        metricName,
        filter.conditionType,
        filter.value,
        rule,
      );
    }

    if (filter.checkOn === MetricPipelineRuleFilterCheckOn.Attribute) {
      const key: string | undefined = filter.attributeKey?.trim() || undefined;
      if (!key) {
        return false;
      }
      const attrs: JSONObject = this.getAttributes(row);
      const keyExists: boolean = Object.prototype.hasOwnProperty.call(
        attrs,
        key,
      );

      if (
        filter.conditionType === MetricPipelineRuleFilterConditionType.IsPresent
      ) {
        return keyExists;
      }
      if (
        filter.conditionType ===
        MetricPipelineRuleFilterConditionType.IsNotPresent
      ) {
        return !keyExists;
      }

      const rawValue: JSONValue = keyExists
        ? (attrs[key] as JSONValue)
        : (undefined as unknown as JSONValue);
      const valueAsString: string =
        typeof rawValue === "string"
          ? rawValue
          : rawValue === undefined || rawValue === null
            ? ""
            : String(rawValue);

      if (
        filter.conditionType === MetricPipelineRuleFilterConditionType.IsEmpty
      ) {
        return !keyExists || valueAsString === "";
      }
      if (
        filter.conditionType ===
        MetricPipelineRuleFilterConditionType.IsNotEmpty
      ) {
        return keyExists && valueAsString !== "";
      }

      // Value-based comparisons require the key to be present.
      if (!keyExists) {
        return false;
      }
      return this.compareStringValue(
        valueAsString,
        filter.conditionType,
        filter.value,
        rule,
        key,
      );
    }

    return false;
  }

  /*
   * `key`: the attribute the value is of, when it is one - a Matches
   * Pattern Type filter reads the value as that key says (#11383).
   */
  private static compareStringValue(
    actual: string,
    conditionType: MetricPipelineRuleFilterConditionType,
    expected: string | undefined,
    rule: MetricPipelineRule,
    key?: string | undefined,
  ): boolean {
    const expectedValue: string = expected ?? "";

    switch (conditionType) {
      case MetricPipelineRuleFilterConditionType.EqualTo:
        return actual === expectedValue;
      case MetricPipelineRuleFilterConditionType.NotEqualTo:
        return actual !== expectedValue;
      case MetricPipelineRuleFilterConditionType.Contains:
        return actual.includes(expectedValue);
      case MetricPipelineRuleFilterConditionType.NotContains:
        return !actual.includes(expectedValue);
      case MetricPipelineRuleFilterConditionType.StartsWith:
        return actual.startsWith(expectedValue);
      case MetricPipelineRuleFilterConditionType.EndsWith:
        return actual.endsWith(expectedValue);
      case MetricPipelineRuleFilterConditionType.MatchesRegex:
      case MetricPipelineRuleFilterConditionType.DoesNotMatchRegex: {
        if (patternWorkRefusesQuestions(actual)) {
          /*
           * The batch's work allowance is spent: no answer, so the filter
           * does not match (as below), without a lookup.
           */
          return false;
        }

        let matched: boolean;

        try {
          const re: LinearRegExp | null = getCompiledRegex(
            expectedValue,
            String(rule._id),
          );

          if (!re) {
            // Invalid pattern — warned once when first compiled.
            return false;
          }

          matched =
            re.test(actual) ||
            (conditionType ===
              MetricPipelineRuleFilterConditionType.MatchesRegex &&
              HIDING_RULE_TYPES.has(rule.ruleType as MetricPipelineRuleType) &&
              matchesInOtherReadings(re, actual));
        } catch (error: unknown) {
          if (!(error instanceof PatternWorkLimitError)) {
            throw error;
          }

          /*
           * No answer: the pattern needed more work than the value - or
           * what is left of the batch's work allowance - allows. The
           * filter does not match, as for an invalid pattern, negated or
           * not.
           */
          return false;
        }

        return conditionType ===
          MetricPipelineRuleFilterConditionType.MatchesRegex
          ? matched
          : !matched;
      }
      case MetricPipelineRuleFilterConditionType.MatchesPatternType:
        return MetricPipelineEngine.holdsPatternType(
          actual,
          expectedValue,
          key,
        );
      default:
        return false;
    }
  }

  /*
   * Whether a value holds what a built-in Pattern Type finds - the very
   * pattern a log or trace scrub rule of that type runs
   * (Utils/Telemetry/ScrubBuiltInPatterns): what Data Security calls an IP
   * address, an email address, a card number, a phone number or a US
   * Social Security number, found by its own detectors in every reading
   * they read (#10934, #10935, #10936, #10960, #11112) - a national number
   * or nine digits beside the word that names them in the value (#11114),
   * or under an attribute whose key names them, as a log or trace rule
   * reads one (`key`, ScrubRegExp.underKey, #11383): 02012345678 under
   * `user.phone` - and a number typed in fullwidth (#11115). A value that
   * names no pattern type matches nothing, as an invalid regex does.
   * OneUptime's own patterns, each bounded: no work allowance is asked.
   */
  private static holdsPatternType(
    actual: string,
    patternType: string,
    key?: string | undefined,
  ): boolean {
    if (!actual || !isMetricFilterPatternType(patternType)) {
      return false;
    }

    let pattern: ScrubRegExp | null | undefined =
      compiledPatternTypes.get(patternType);

    if (pattern === undefined) {
      pattern = compileBuiltInScrubPattern(patternType);
      compiledPatternTypes.set(patternType, pattern);
    }

    return (
      pattern !== null &&
      scrubRegExpUnderKey(pattern, key, actual).test(actual)
    );
  }

  public static getAttributes(row: MutableMetricRow): JSONObject {
    const value: JSONValue = row.attributes as JSONValue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as JSONObject;
    }
    const fresh: JSONObject = {};
    row.attributes = fresh;
    return fresh;
  }

  // The patterns warned about, forgotten - with the service's own caches (MetricPipelineRuleService.clearCache).
  public static clearWarnedPatterns(): void {
    warnedInvalidPatterns.clear();
  }
}
