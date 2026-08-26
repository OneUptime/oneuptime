import Metric from "../../../Models/AnalyticsModels/Metric";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { LlmTokenTypeAttributeKeys } from "../../../Types/Telemetry/LlmMetricConventions";
import LlmMetricQuery, {
  LlmMetricScope,
  LlmMetricTokenTotals,
} from "../../../Utils/Telemetry/LlmMetricQuery";
import AggregateBy from "../../Types/AnalyticsDatabase/AggregateBy";
import MetricService from "../../Services/MetricService";
import CaptureSpan from "./CaptureSpan";

/*
 * Metric-sourced LLM token and cost totals.
 *
 * The LLM feature reads spans first — a GenAI span carries model, tokens and
 * cost on one row, which is the richest source and the only one that can back
 * the per-call views. This module is the SECOND source, for the emitters that
 * publish GenAI metrics but no GenAI spans:
 *
 *   - An OpenTelemetry SDK wired for metrics without tracing.
 *   - AI gateways and vendor exporters that publish spend/usage counters and
 *     never export traces.
 *
 * Callers must not add these totals to the span-sourced ones. Instrumentations
 * that emit both (OpenLLMetry is the common case) would then be counted twice,
 * and for a cost budget that gates alerting a doubled figure is worse than a
 * missing one. LlmCostBudgetEvaluator therefore treats this as a FALLBACK: it
 * is consulted only when the span-sourced total for the same scope is zero.
 *
 * Query construction and result folding live in the isomorphic
 * Common/Utils/Telemetry/LlmMetricQuery, so the dashboard's AI / LLM overview
 * asks the same questions of the same data. This module only adds the
 * AggregateBy envelope and executes them with root props.
 */

export { LlmMetricScope, LlmMetricTokenTotals };

export default class LlmMetricSpend {
  /**
   * Aggregate descriptor for the cost sum: one total over the whole window.
   *
   * `value` is the right column for every point type here — for a histogram
   * ClickHouse stores the bucket sum in it, and MetricService resolves the
   * point type before building the statement so distribution metrics skip the
   * materialized views. Cost metrics are counters (delta or cumulative spend),
   * so summing them across the window is the intended reduction.
   */
  public static buildCostAggregateBy(
    scope: LlmMetricScope,
  ): AggregateBy<Metric> {
    return {
      query: LlmMetricQuery.buildCostQuery(scope),
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: scope.startTime,
      endTimestamp: scope.endTime,
      // One total over the whole window — no time bucketing.
      aggregationInterval: AggregationInterval.Total,
      /*
       * Same reasoning as the span path: this figure feeds budget monitors, so
       * a query timeout must fail loudly rather than return a
       * silently-partial sum that would understate spend and suppress a real
       * breach.
       */
      timeoutOverflowMode: "throw",
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    } as AggregateBy<Metric>;
  }

  /**
   * Aggregate descriptor for the token sum.
   *
   * Grouping by every candidate token-type attribute key in ONE query —
   * rather than issuing a query per key and per direction — is what keeps this
   * both complete and free of double counting: each returned group carries the
   * attribute values that produced it, so LlmMetricQuery.reduceTokenRows
   * classifies them against the full set of recognized spellings instead of
   * the query having to pick one.
   */
  public static buildTokenAggregateBy(
    scope: LlmMetricScope,
  ): AggregateBy<Metric> {
    return {
      query: LlmMetricQuery.buildTokenQuery(scope),
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: scope.startTime,
      endTimestamp: scope.endTime,
      aggregationInterval: AggregationInterval.Total,
      groupByAttributeKeys: [...LlmTokenTypeAttributeKeys],
      timeoutOverflowMode: "throw",
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    } as AggregateBy<Metric>;
  }

  /** Metric-sourced spend in USD for the scope, or 0 when nothing matched. */
  @CaptureSpan()
  public static async getCostInUSD(scope: LlmMetricScope): Promise<number> {
    const result: AggregatedResult = await MetricService.aggregateBy(
      this.buildCostAggregateBy(scope),
    );

    return LlmMetricQuery.sumAggregatedRows(result?.data);
  }

  /** Metric-sourced input/output token totals for the scope. */
  @CaptureSpan()
  public static async getTokenTotals(
    scope: LlmMetricScope,
  ): Promise<LlmMetricTokenTotals> {
    const result: AggregatedResult = await MetricService.aggregateBy(
      this.buildTokenAggregateBy(scope),
    );

    return LlmMetricQuery.reduceTokenRows(result?.data);
  }
}
