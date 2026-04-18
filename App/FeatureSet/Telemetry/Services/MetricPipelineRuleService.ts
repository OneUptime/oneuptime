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

export interface MetricRulesForProject {
  projectRules: Array<MetricPipelineRule>;
  rulesByServiceId: Map<string, Array<MetricPipelineRule>>;
}

interface CacheEntry {
  rules: MetricRulesForProject;
  loadedAt: number;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds
const ruleCache: Map<string, CacheEntry> = new Map();

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
    const cached: CacheEntry | undefined = ruleCache.get(cacheKey);

    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.rules;
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
    ruleCache.set(cacheKey, { rules: result, loadedAt: Date.now() });
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
    const serviceKey: string | undefined = serviceId?.toString();
    const serviceRules: Array<MetricPipelineRule> = serviceKey
      ? rules.rulesByServiceId.get(serviceKey) ?? []
      : [];

    let current: MutableMetricRow | null = row;

    for (const rule of serviceRules) {
      current = this.applyOne(current!, rule);
      if (current === null) {
        return null;
      }
    }

    for (const rule of rules.projectRules) {
      current = this.applyOne(current!, rule);
      if (current === null) {
        return null;
      }
    }

    return current;
  }

  private static applyOne(
    row: MutableMetricRow,
    rule: MetricPipelineRule,
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
          row.attributeKeys = Object.keys(attrs).sort();
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
        row.attributeKeys = Object.keys(attrs).sort();
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
          row.attributeKeys = Object.keys(attrs).sort();
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

      if (filter.conditionType === MetricPipelineRuleFilterConditionType.IsPresent) {
        return keyExists;
      }
      if (
        filter.conditionType === MetricPipelineRuleFilterConditionType.IsNotPresent
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

      if (filter.conditionType === MetricPipelineRuleFilterConditionType.IsEmpty) {
        return !keyExists || valueAsString === "";
      }
      if (
        filter.conditionType === MetricPipelineRuleFilterConditionType.IsNotEmpty
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
        try {
          const re: RegExp = new RegExp(expectedValue);
          const matched: boolean = re.test(actual);
          return conditionType ===
            MetricPipelineRuleFilterConditionType.MatchesRegex
            ? matched
            : !matched;
        } catch (err) {
          logger.warn(
            `Invalid regex on MetricPipelineRule ${String(rule._id)}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return false;
        }
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

  // Testing helper — clears the in-memory cache.
  public static clearCache(): void {
    ruleCache.clear();
  }
}
