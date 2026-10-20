import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import PatternWorkScope from "Common/Server/Utils/PatternWorkScope";
import InMemoryTTLCache from "Common/Server/Infrastructure/InMemoryTTLCache";
import LinearRegExp from "Common/Utils/LinearRegExp/LinearRegExp";
import {
  clearLinearRegExpCache,
  getLinearRegExp,
} from "Common/Utils/LinearRegExp/PatternCache";
import { PatternWorkLimitError } from "Common/Utils/LinearRegExp/PatternProblem";
import { patternWorkRefusesQuestions } from "Common/Utils/LinearRegExp/PatternWork";

export interface MetricRulesForProject {
  projectRules: Array<MetricPipelineRule>;
  rulesByServiceId: Map<string, Array<MetricPipelineRule>>;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds
const MAX_CACHED_PROJECTS: number = 10_000;

const ruleCache: InMemoryTTLCache<MetricRulesForProject> =
  new InMemoryTTLCache<MetricRulesForProject>(MAX_CACHED_PROJECTS);

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

// What the memo keeps a pattern by: itself, or its length and beginning.
function warnedPatternKey(pattern: string): string {
  return pattern.length <= REGEX_MEMO_MAX_KEY_LENGTH
    ? pattern
    : `${pattern.length}\u0000${pattern.slice(0, REGEX_MEMO_MAX_KEY_LENGTH)}`;
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
        `Invalid regex "${key}" (first seen on MetricPipelineRule ${ruleId}; warned once per pattern — every rule using it treats the filter as non-matching): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return null;
  }
}

/*
 * Treat the metric row's attributes as a loose JSONObject. The ingest pipeline
 * builds rows with `attributes: JSONObject` and `attributeKeys: string[]`.
 */
interface MutableMetricRow extends JSONObject {
  name?: JSONValue;
  attributes?: JSONValue;
  attributeKeys?: JSONValue;
}

export default class MetricPipelineRuleService {
  public static async loadRules(
    projectId: ObjectID,
  ): Promise<MetricRulesForProject> {
    const cacheKey: string = projectId.toString();
    const cached: MetricRulesForProject | undefined = ruleCache.get(cacheKey);

    // The object is truthy even with zero rules — negative caching preserved.
    if (cached) {
      return cached;
    }

    const service: DatabaseService<MetricPipelineRule> =
      new DatabaseService<MetricPipelineRule>(MetricPipelineRule);

    const rows: Array<MetricPipelineRule> = await service.findBy({
      query: {
        projectId: projectId,
        isEnabled: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      sort: {
        sortOrder: SortOrder.Ascending,
      },
      select: {
        _id: true,
        serviceId: true,
        ruleType: true,
        filterCondition: true,
        filters: true,
        renameFromKey: true,
        renameToKey: true,
        addAttributeKey: true,
        addAttributeValue: true,
        redactReplacement: true,
        samplePercentage: true,
        sortOrder: true,
      },
      props: { isRoot: true },
    });

    const projectRules: Array<MetricPipelineRule> = [];
    const rulesByServiceId: Map<string, Array<MetricPipelineRule>> = new Map();

    for (const rule of rows) {
      if (rule.serviceId) {
        const key: string = rule.serviceId.toString();
        const bucket: Array<MetricPipelineRule> =
          rulesByServiceId.get(key) ?? [];
        bucket.push(rule);
        rulesByServiceId.set(key, bucket);
      } else {
        projectRules.push(rule);
      }
    }

    const result: MetricRulesForProject = { projectRules, rulesByServiceId };
    ruleCache.set(cacheKey, result, CACHE_TTL_MS);
    return result;
  }

  /*
   * Returns a mutated row, or null if the row should be dropped.
   *
   * Evaluation order: service-scoped rules first (may drop via Drop/Filter/Sample),
   * then project-wide rules on whatever survives.
   */
  public static applyRules(
    row: MutableMetricRow,
    serviceId: ObjectID | undefined,
    rules: MetricRulesForProject,
  ): MutableMetricRow | null {
    /*
     * The record's texts add their share to the batch's work allowance when
     * the first of these patterns is asked about it
     * (Common/Server/Utils/PatternWorkScope.ts).
     */
    PatternWorkScope.handOverRecord(row);

    const serviceKey: string | undefined = serviceId?.toString();
    const serviceRules: Array<MetricPipelineRule> = serviceKey
      ? rules.rulesByServiceId.get(serviceKey) ?? []
      : [];

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

    for (const rule of rules.projectRules) {
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

  private static applyOne(
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
          attrs[to] = attrs[from] as JSONValue;
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
        attrs[key] = rule.addAttributeValue ?? "";
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
      );
    }

    return false;
  }

  private static compareStringValue(
    actual: string,
    conditionType: MetricPipelineRuleFilterConditionType,
    expected: string | undefined,
    rule: MetricPipelineRule,
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

          matched = re.test(actual);
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
      default:
        return false;
    }
  }

  private static getAttributes(row: MutableMetricRow): JSONObject {
    const value: JSONValue = row.attributes as JSONValue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as JSONObject;
    }
    const fresh: JSONObject = {};
    row.attributes = fresh;
    return fresh;
  }

  // Testing helper — clears the in-memory caches.
  public static clearCache(): void {
    ruleCache.clear();
    warnedInvalidPatterns.clear();
    // The compiled patterns too, so a pattern is compiled again.
    clearLinearRegExpCache();
  }
}
