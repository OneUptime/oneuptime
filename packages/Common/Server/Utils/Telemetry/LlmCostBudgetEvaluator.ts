import LlmCostBudget from "../../../Models/DatabaseModels/LlmCostBudget";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Span from "../../../Models/AnalyticsModels/Span";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Query from "../../../Types/BaseDatabase/Query";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import AggregateBy from "../../Types/AnalyticsDatabase/AggregateBy";
import LlmCostBudgetService from "../../Services/LlmCostBudgetService";
import MetricService from "../../Services/MetricService";
import SpanService from "../../Services/SpanService";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import LlmMetricSpend, { LlmMetricScope } from "./LlmMetricSpend";
import TelemetryUtil from "./Telemetry";

/*
 * Evaluates LLM cost budgets against the day's LLM spend.
 *
 * Spend is sourced from GenAI trace spans first and, when a scope produced no
 * span spend at all, from the GenAI metric stream instead (see resolveSpend
 * and Common/Server/Utils/Telemetry/LlmMetricSpend.ts). That second source is
 * what lets a metrics-only emitter — an SDK exporting metrics without traces,
 * or a gateway that publishes spend counters and no spans — hold a budget at
 * all. The two are never summed; see resolveSpend for why.
 *
 * The worker job (App/FeatureSet/Workers/Jobs/Llm/EvaluateLlmCostBudgets.ts)
 * calls evaluateAllBudgets() on a 15-minute tick. For each enabled budget it
 * sums the UTC day's spend from ClickHouse (scoped by the budget's optional
 * service / provider / model filters), stamps the spend back onto the budget
 * row for the dashboard, and publishes two gauge metrics:
 *
 *   oneuptime.llm.budget.spend.usd      — the day's spend so far, in USD
 *   oneuptime.llm.budget.percent.used   — spend as a percent of the budget
 *
 * Budgets do NOT alert directly. Alerting is a Metrics monitor on these
 * series — filter by the oneuptime.llm.budget.id attribute (stable across
 * renames; the name attribute is for charts and changes when the budget is
 * renamed) — which brings thresholds, formulas, anomaly baselines, incidents
 * and on-call routing without a parallel alerting pipeline here.
 *
 * The series gets ONE point per budget per 15-minute sweep. A monitor on it
 * must use a rolling window of at least 15 minutes (30 recommended): the
 * 1-minute default would see an empty series between sweeps and flap.
 */

export const LLM_BUDGET_SPEND_METRIC_NAME: string =
  "oneuptime.llm.budget.spend.usd";
export const LLM_BUDGET_PERCENT_METRIC_NAME: string =
  "oneuptime.llm.budget.percent.used";

// Attribute keys carried by both budget metrics, for monitor/chart filtering.
export const LLM_BUDGET_ID_ATTRIBUTE: string = "oneuptime.llm.budget.id";
export const LLM_BUDGET_NAME_ATTRIBUTE: string = "oneuptime.llm.budget.name";
export const LLM_BUDGET_PROVIDER_ATTRIBUTE: string =
  "oneuptime.llm.budget.provider";
export const LLM_BUDGET_MODEL_ATTRIBUTE: string = "oneuptime.llm.budget.model";
export const LLM_BUDGET_SERVICE_ID_ATTRIBUTE: string =
  "oneuptime.llm.budget.service.id";

/*
 * Matches the derived-metric retention the trace/metric recording rules use.
 * The series exists for monitors and short-range charts; long-range spend
 * history belongs to the spans themselves.
 */
const BUDGET_METRIC_RETENTION_IN_DAYS: number = 15;

/*
 * Which telemetry signal a budget's spend figure came from. "none" means both
 * sources were empty — a genuinely idle scope, not a failure.
 */
export type LlmSpendSource = "spans" | "metrics" | "none";

export interface LlmResolvedSpend {
  spendInUSD: number;
  source: LlmSpendSource;
}

export default class LlmCostBudgetEvaluator {
  /**
   * Percent of the daily budget consumed. 0 when the budget is missing or
   * invalid — never NaN/Infinity, since these values feed monitors.
   */
  public static computePercentUsed(data: {
    spendInUSD: number;
    dailyBudgetInUSD: number;
  }): number {
    if (
      !isFinite(data.dailyBudgetInUSD) ||
      data.dailyBudgetInUSD <= 0 ||
      !isFinite(data.spendInUSD) ||
      data.spendInUSD < 0
    ) {
      return 0;
    }

    const percent: number = (data.spendInUSD / data.dailyBudgetInUSD) * 100;

    // Trim float noise; hundredth-of-a-percent resolution is plenty.
    return Math.round(percent * 100) / 100;
  }

  /**
   * Start of the UTC day `now` falls in. UTC-explicit (not process-zone) so
   * the budget day is the same day everywhere OneUptime runs.
   */
  public static getUtcDayStart(now: Date): Date {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  /**
   * Build the ClickHouse span filter for a budget: the UTC day so far,
   * LLM spans only, narrowed by the budget's optional service / provider /
   * model scoping.
   */
  public static buildSpanQuery(data: {
    budget: LlmCostBudget;
    dayStart: Date;
    now: Date;
  }): Query<Span> {
    const query: Query<Span> = {
      projectId: data.budget.projectId!,
      isLlmSpan: true,
      /*
       * Bound rows to the window — aggregateBy's startTimestamp/endTimestamp
       * only pick the bucket grid, they do not filter rows.
       */
      startTime: new InBetween(data.dayStart, data.now),
    } as Query<Span>;

    if (data.budget.serviceId) {
      (query as Record<string, unknown>)["primaryEntityId"] =
        data.budget.serviceId;
    }

    if (data.budget.llmSystem) {
      (query as Record<string, unknown>)["llmSystem"] = data.budget.llmSystem;
    }

    if (data.budget.llmModel) {
      (query as Record<string, unknown>)["llmRequestModel"] =
        data.budget.llmModel;
    }

    return query;
  }

  /**
   * Build the two metric rows one evaluation publishes for one budget.
   * Pure — mirrors the derived-metric row shape the trace recording rules
   * write — so the series shape is unit-testable.
   */
  public static buildBudgetMetricRows(data: {
    budget: LlmCostBudget;
    spendInUSD: number;
    percentUsed: number;
    now: Date;
  }): Array<JSONObject> {
    const attributes: Record<string, string> = {
      [LLM_BUDGET_ID_ATTRIBUTE]: data.budget.id?.toString() || "",
      [LLM_BUDGET_NAME_ATTRIBUTE]: data.budget.name || "",
    };

    if (data.budget.serviceId) {
      attributes[LLM_BUDGET_SERVICE_ID_ATTRIBUTE] =
        data.budget.serviceId.toString();
    }

    if (data.budget.llmSystem) {
      attributes[LLM_BUDGET_PROVIDER_ATTRIBUTE] = data.budget.llmSystem;
    }

    if (data.budget.llmModel) {
      attributes[LLM_BUDGET_MODEL_ATTRIBUTE] = data.budget.llmModel;
    }

    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      data.now,
      BUDGET_METRIC_RETENTION_IN_DAYS,
    );

    const buildRow: (name: string, value: number) => JSONObject = (
      name: string,
      value: number,
    ): JSONObject => {
      return {
        _id: ObjectID.generateTimeOrdered().toString(),
        projectId: data.budget.projectId!.toString(),
        createdAt: OneUptimeDate.toClickhouseDateTime(data.now),
        time: OneUptimeDate.toClickhouseDateTime(data.now),
        timeUnixNano: (data.now.getTime() * 1_000_000).toString(),
        primaryEntityType: ServiceType.OpenTelemetry,
        name: name,
        metricPointType: MetricPointType.Gauge,
        value: value,
        attributes: attributes,
        attributeKeys: Object.keys(attributes).sort(),
        retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
      };
    };

    return [
      buildRow(LLM_BUDGET_SPEND_METRIC_NAME, data.spendInUSD),
      buildRow(LLM_BUDGET_PERCENT_METRIC_NAME, data.percentUsed),
    ];
  }

  /**
   * Evaluate every enabled budget. One bad budget never aborts the sweep.
   */
  @CaptureSpan()
  public static async evaluateAllBudgets(): Promise<void> {
    const budgets: Array<LlmCostBudget> = await LlmCostBudgetService.findBy({
      query: {
        isEnabled: true,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        dailyBudgetInUSD: true,
        serviceId: true,
        llmSystem: true,
        llmModel: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (budgets.length === 0) {
      return;
    }

    logger.debug(
      `Llm:EvaluateLlmCostBudgets: evaluating ${budgets.length} enabled budget(s)`,
    );

    const now: Date = new Date();

    for (const budget of budgets) {
      try {
        await this.evaluateBudget({ budget, now });
      } catch (err) {
        logger.error(
          `LLM cost budget ${budget.id?.toString()} for project ${budget.projectId?.toString() ?? "?"} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { projectId: budget.projectId?.toString() } as LogAttributes,
        );
      }
    }
  }

  /**
   * Evaluate one budget: sum the day's spend, stamp it on the row, and
   * publish the spend / percent-used metric points.
   */
  @CaptureSpan()
  public static async evaluateBudget(data: {
    budget: LlmCostBudget;
    now: Date;
  }): Promise<void> {
    const budget: LlmCostBudget = data.budget;

    if (!budget.id || !budget.projectId || !budget.dailyBudgetInUSD) {
      return;
    }

    const dayStart: Date = this.getUtcDayStart(data.now);

    const resolved: LlmResolvedSpend = await this.resolveSpend({
      budget: budget,
      dayStart: dayStart,
      now: data.now,
    });

    const spendInUSD: number = resolved.spendInUSD;

    logger.debug(
      `LLM cost budget ${budget.id.toString()}: spend ${spendInUSD} USD sourced from ${resolved.source}`,
    );

    const percentUsed: number = this.computePercentUsed({
      spendInUSD: spendInUSD,
      dailyBudgetInUSD: budget.dailyBudgetInUSD,
    });

    // Stamp the spend for the dashboard's Budgets tab.
    await LlmCostBudgetService.updateOneById({
      id: budget.id,
      data: {
        currentDaySpendInUSD: spendInUSD,
        spendLastEvaluatedAt: data.now,
      },
      props: {
        isRoot: true,
      },
    });

    await this.writeBudgetMetrics({
      budget: budget,
      spendInUSD: spendInUSD,
      percentUsed: percentUsed,
      now: data.now,
    });
  }

  /**
   * Translate a budget's scope into the equivalent metric-stream scope, so
   * the span query and the metric query narrow to the same slice of traffic.
   *
   * Service scoping is exact — Span.primaryEntityId and Metric.primaryEntityId
   * are the same telemetry-service id. Provider/model scoping matches the
   * primary semantic-convention attribute keys only; see the caveat on
   * LlmMetricSpend.
   */
  public static buildMetricScope(data: {
    budget: LlmCostBudget;
    dayStart: Date;
    now: Date;
  }): LlmMetricScope {
    return {
      projectId: data.budget.projectId!,
      startTime: data.dayStart,
      endTime: data.now,
      serviceId: data.budget.serviceId,
      llmSystem: data.budget.llmSystem,
      llmModel: data.budget.llmModel,
    };
  }

  /**
   * The day's spend for a budget, and which telemetry signal it came from.
   *
   * Spans are authoritative: a GenAI span carries model, tokens and cost on
   * one row, and it is the only source that can also back the per-call views.
   * Metrics are consulted ONLY when the span-sourced total is zero.
   *
   * That ordering is a deliberate fallback rather than a sum. Instrumentations
   * that emit both signals (OpenLLMetry is the common case) would otherwise be
   * counted twice, and for a budget that gates alerting an inflated figure is
   * worse than a missing one — it fires on spend that never happened. The
   * fallback turns on exactly for the emitters that need it: those publishing
   * GenAI metrics and no GenAI spans, whose span total is structurally zero.
   *
   * Known limit, documented rather than papered over: a scope where SOME
   * services emit spans and others emit only metrics resolves to "spans" and
   * under-counts the metrics-only services. Splitting a budget per service is
   * the workaround; scoping each to its own service gives each the source it
   * actually has.
   *
   * A metric-query failure is allowed to propagate for the same reason the
   * span aggregate passes timeoutOverflowMode 'throw': returning 0 on error
   * would silently suppress a real breach. evaluateAllBudgets isolates the
   * failure to the one budget.
   */
  @CaptureSpan()
  public static async resolveSpend(data: {
    budget: LlmCostBudget;
    dayStart: Date;
    now: Date;
  }): Promise<LlmResolvedSpend> {
    const spanSpend: number = await this.getSpanSpendInUSD(data);

    if (spanSpend > 0) {
      return { spendInUSD: spanSpend, source: "spans" };
    }

    const metricSpend: number = await LlmMetricSpend.getCostInUSD(
      this.buildMetricScope(data),
    );

    if (metricSpend > 0) {
      return { spendInUSD: metricSpend, source: "metrics" };
    }

    return { spendInUSD: 0, source: "none" };
  }

  /**
   * Sum the day's llmCost for the budget's scope from ClickHouse.
   */
  @CaptureSpan()
  private static async getSpanSpendInUSD(data: {
    budget: LlmCostBudget;
    dayStart: Date;
    now: Date;
  }): Promise<number> {
    const aggregateBy: AggregateBy<Span> = {
      query: this.buildSpanQuery(data),
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "llmCost",
      aggregationTimestampColumnName: "startTime",
      startTimestamp: data.dayStart,
      endTimestamp: data.now,
      // One total over the whole window — no time bucketing.
      aggregationInterval: AggregationInterval.Total,
      /*
       * The sum feeds monitors: fail loud on a query timeout — the default
       * 'break' overflow mode returns silently-partial sums, which would
       * understate spend and suppress a real budget breach downstream.
       */
      timeoutOverflowMode: "throw",
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    };

    const result: AggregatedResult = await SpanService.aggregateBy(aggregateBy);

    return (result.data || []).reduce(
      (acc: number, row: AggregatedModel): number => {
        return acc + Number(row.value || 0);
      },
      0,
    );
  }

  /**
   * Publish the budget's spend and percent-used gauge points, and register
   * the metric names so they appear in the dashboard's metric picker and the
   * Metrics-monitor builder.
   */
  @CaptureSpan()
  private static async writeBudgetMetrics(data: {
    budget: LlmCostBudget;
    spendInUSD: number;
    percentUsed: number;
    now: Date;
  }): Promise<void> {
    const rows: Array<JSONObject> = this.buildBudgetMetricRows(data);

    await MetricService.insertJsonRows(rows);

    const spendType: MetricType = new MetricType();
    spendType.name = LLM_BUDGET_SPEND_METRIC_NAME;
    spendType.description =
      "LLM spend accrued so far in the current UTC day for an LLM cost budget, in USD. One point per budget every 15 minutes; filter by the oneuptime.llm.budget.id attribute.";
    spendType.unit = "USD";

    const percentType: MetricType = new MetricType();
    percentType.name = LLM_BUDGET_PERCENT_METRIC_NAME;
    percentType.description =
      "LLM spend as a percent of an LLM cost budget's daily limit. One point per budget every 15 minutes — alert with a Metrics monitor (e.g. value >= 80) using a rolling window of 30 minutes, filtered by oneuptime.llm.budget.id.";
    percentType.unit = "%";

    /*
     * Registration is what makes the names show up in the metric picker —
     * fire-and-forget, a registration failure must not fail the sweep.
     */
    TelemetryUtil.indexMetricNameServiceNameMap({
      metricNameServiceNameMap: {
        [LLM_BUDGET_SPEND_METRIC_NAME]: spendType,
        [LLM_BUDGET_PERCENT_METRIC_NAME]: percentType,
      },
      projectId: data.budget.projectId!,
    }).catch((err: Error) => {
      logger.error(err);
    });
  }
}
