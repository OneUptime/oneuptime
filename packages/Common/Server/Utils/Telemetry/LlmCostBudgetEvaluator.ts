import LlmCostBudget from "../../../Models/DatabaseModels/LlmCostBudget";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  LlmUsageDimension,
  LlmUsageResponse,
  LlmUsageSource,
} from "../../../Types/Telemetry/LlmUsageApi";
import LlmCostBudgetService from "../../Services/LlmCostBudgetService";
import MetricService from "../../Services/MetricService";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import LlmUsageReader, { LlmUsageReadQuery } from "./LlmUsageReader";
import LlmBudgetSpendSource from "../../../Types/LlmObservability/LlmBudgetSpendSource";
import LlmProviderSpend from "../LlmObservability/LlmProviderSpend";
import TelemetryUtil from "./Telemetry";

/*
 * Evaluates LLM cost budgets against the day's LLM spend.
 *
 * Spend is what the Usage tab counts for the same scope (LlmUsageReader):
 * the AI calls (GenAI spans), each model call once, and the usage metrics
 * (GenAI metrics) - each service counted from the signal it sends, its AI
 * calls where they report a cost and its usage metrics where they do not.
 * So a coding tool that sends only metrics counts toward a budget beside
 * the apps that send calls, and an app that sends both counts once; see
 * resolveSpend.
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
 * Which signal a budget's spend figure came from: the AI calls ("spans"),
 * the usage metrics ("metrics"), or some services' calls and other
 * services' metrics ("both"). "none" means every source it counts was
 * empty — a genuinely idle scope, not a failure. "providers" is what the
 * connected AI provider accounts report, for a budget that counts them
 * (LlmCostBudget.spendSource).
 */
export type LlmSpendSource =
  | "spans"
  | "metrics"
  | "both"
  | "providers"
  | "none";

const SPEND_SOURCES: Record<LlmUsageSource, LlmSpendSource> = {
  [LlmUsageSource.Calls]: "spans",
  [LlmUsageSource.Metrics]: "metrics",
  [LlmUsageSource.Both]: "both",
  [LlmUsageSource.None]: "none",
};

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
   * The usage read for a budget: the UTC day so far, totals only, narrowed
   * by the budget's optional service / provider / model scoping - on the AI
   * calls and on the usage metrics alike (LlmUsageReader). A provider is
   * matched under every spelling it is stored or sent as.
   */
  public static buildUsageQuery(data: {
    budget: LlmCostBudget;
    dayStart: Date;
    now: Date;
  }): LlmUsageReadQuery {
    return {
      projectId: data.budget.projectId!,
      startTime: data.dayStart,
      endTime: data.now,
      dimension: LlmUsageDimension.None,
      serviceId: data.budget.serviceId || undefined,
      llmSystem: data.budget.llmSystem || undefined,
      llmModel: data.budget.llmModel || undefined,
    };
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
        spendSource: true,
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
   * The day's spend for a budget, and which telemetry signal it came from.
   *
   * Each service in the budget's scope is counted from the signal it sends
   * (LlmUsageUtil): its AI calls when they report a cost, else its usage
   * metrics. Never both for one service: instrumentations that emit both
   * signals (OpenLLMetry is the common case) would be counted twice, and for
   * a budget that gates alerting an inflated figure is worse than a missing
   * one — it fires on spend that never happened. And never only one for the
   * whole scope: a coding tool that sends only metrics (Claude Code, Codex,
   * Cursor's export) counts beside the apps that send calls, where it once
   * vanished as soon as any app sent a call with a cost.
   *
   * Each model call counts once: an agent run's or a wrapper span's repeat
   * of its calls' cost is left out (LlmCountedCallsSql).
   *
   * A failed read propagates (both reads 'throw' on a timeout): returning 0
   * on error would silently suppress a real breach. evaluateAllBudgets
   * isolates the failure to the one budget.
   */
  @CaptureSpan()
  public static async resolveSpend(data: {
    budget: LlmCostBudget;
    dayStart: Date;
    now: Date;
  }): Promise<LlmResolvedSpend> {
    /*
     * A budget on the provider accounts counts their bill and nothing else:
     * the bill already holds every call the spans and metrics would count.
     * The service scope does not apply (a bill names no service); the
     * provider and model scopes do.
     */
    if (data.budget.spendSource === LlmBudgetSpendSource.Providers) {
      const providerSpend: number = await LlmProviderSpend.getCostInUSD({
        projectId: data.budget.projectId!,
        startTime: data.dayStart,
        endTime: data.now,
        provider: data.budget.llmSystem,
        model: data.budget.llmModel,
      });

      return providerSpend > 0
        ? { spendInUSD: providerSpend, source: "providers" }
        : { spendInUSD: 0, source: "none" };
    }

    const usage: LlmUsageResponse = await LlmUsageReader.read(
      this.buildUsageQuery(data),
    );
    const spendInUSD: number = Number.isFinite(usage.totals.costUsd)
      ? Math.max(0, usage.totals.costUsd)
      : 0;

    if (spendInUSD <= 0) {
      return { spendInUSD: 0, source: "none" };
    }

    return {
      spendInUSD: spendInUSD,
      source: SPEND_SOURCES[usage.totals.costSource] || "none",
    };
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
