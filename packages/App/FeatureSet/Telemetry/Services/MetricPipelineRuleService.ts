import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import InMemoryTTLCache from "Common/Server/Infrastructure/InMemoryTTLCache";
import MetricPipelineEngine, {
  MutableMetricRow,
} from "Common/Server/Utils/Telemetry/MetricPipelineEngine";
import { clearLinearRegExpCache } from "Common/Utils/LinearRegExp/PatternCache";

export interface MetricRulesForProject {
  projectRules: Array<MetricPipelineRule>;
  rulesByServiceId: Map<string, Array<MetricPipelineRule>>;
}

const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds
const MAX_CACHED_PROJECTS: number = 10_000;

const ruleCache: InMemoryTTLCache<MetricRulesForProject> =
  new InMemoryTTLCache<MetricRulesForProject>(MAX_CACHED_PROJECTS);

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
   * then project-wide rules on whatever survives - as the one engine for
   * metrics runs them (Common/Server/Utils/Telemetry/MetricPipelineEngine,
   * which Data Security's proof of a metric rule runs too, #10753).
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

    return MetricPipelineEngine.applyRules(
      row,
      serviceRules,
      rules.projectRules,
    );
  }

  // Testing helper — clears the in-memory caches.
  public static clearCache(): void {
    ruleCache.clear();
    MetricPipelineEngine.clearWarnedPatterns();
    // The compiled patterns too, so a pattern is compiled again.
    clearLinearRegExpCache();
  }
}
