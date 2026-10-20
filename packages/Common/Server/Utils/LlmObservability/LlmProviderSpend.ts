import Metric from "../../../Models/AnalyticsModels/Metric";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Query from "../../../Types/BaseDatabase/Query";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import {
  LLM_PROVIDER_COST_METRIC_NAME,
  LLM_PROVIDER_MODEL_ATTRIBUTE,
  LLM_PROVIDER_NAME_ATTRIBUTE,
} from "../../../Types/LlmObservability/LlmProviderUsageMetrics";
import ObjectID from "../../../Types/ObjectID";
import MetricService from "../../Services/MetricService";
import AggregateBy from "../../Types/AnalyticsDatabase/AggregateBy";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * What the connected AI provider accounts report a project spent: the sum
 * of oneuptime.llm.provider.cost over a time range, optionally for one
 * provider (gen_ai.provider.name) and one model.
 *
 * A provider's cost points sit at the start of their UTC day, so "today so
 * far" is the sum from today's midnight - the figure a budget compares with
 * its daily limit.
 */

export interface LlmProviderSpendScope {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  // gen_ai.provider.name, e.g. "openai". Empty: every provider.
  provider?: string | undefined;
  // The model exactly as the provider names it. Empty: every model.
  model?: string | undefined;
}

export default class LlmProviderSpend {
  public static buildQuery(scope: LlmProviderSpendScope): Query<Metric> {
    const query: Record<string, unknown> = {
      projectId: scope.projectId,
      name: LLM_PROVIDER_COST_METRIC_NAME,
      time: new InBetween(scope.startTime, scope.endTime),
    };

    const attributes: Record<string, string> = {};

    if (scope.provider && scope.provider.trim()) {
      attributes[LLM_PROVIDER_NAME_ATTRIBUTE] = scope.provider.trim();
    }

    if (scope.model && scope.model.trim()) {
      attributes[LLM_PROVIDER_MODEL_ATTRIBUTE] = scope.model.trim();
    }

    if (Object.keys(attributes).length > 0) {
      query["attributes"] = attributes;
    }

    return query as Query<Metric>;
  }

  public static buildAggregateBy(
    scope: LlmProviderSpendScope,
  ): AggregateBy<Metric> {
    return {
      query: LlmProviderSpend.buildQuery(scope),
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: scope.startTime,
      endTimestamp: scope.endTime,
      aggregationInterval: AggregationInterval.Total,
      /*
       * The figure gates a budget's alerting: a timed-out read must fail,
       * never answer a silently partial sum.
       */
      timeoutOverflowMode: "throw",
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    } as AggregateBy<Metric>;
  }

  @CaptureSpan()
  public static async getCostInUSD(scope: LlmProviderSpendScope): Promise<number> {
    const result: AggregatedResult = await MetricService.aggregateBy(
      LlmProviderSpend.buildAggregateBy(scope),
    );

    const total: number = (result?.data || []).reduce(
      (sum: number, row: AggregatedModel): number => {
        const value: number = Number(row.value || 0);
        return Number.isFinite(value) ? sum + value : sum;
      },
      0,
    );

    // A provider's corrections can never make a day's cost negative.
    return Math.max(0, Math.round(total * 1e6) / 1e6);
  }
}
