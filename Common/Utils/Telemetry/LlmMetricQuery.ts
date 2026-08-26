import Metric from "../../Models/AnalyticsModels/Metric";
import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../Types/BaseDatabase/InBetween";
import Includes from "../../Types/BaseDatabase/Includes";
import Query from "../../Types/BaseDatabase/Query";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  LlmRequestModelAttributeKeys,
  LlmSystemAttributeKeys,
} from "../../Types/Telemetry/LlmConventions";
import {
  LlmCostMetricNames,
  LlmTokenDirection,
  LlmTokenTypeAttributeKeys,
  LlmTokenUsageMetricNames,
  getLlmTokenDirection,
} from "../../Types/Telemetry/LlmMetricConventions";

/*
 * Pure query construction and result folding for metric-sourced LLM token and
 * cost totals. Isomorphic on purpose: the budget evaluator runs these on the
 * server with root props, and the AI / LLM overview runs the same queries in
 * the browser under the signed-in user's permissions. Keeping the shapes here
 * means the two cannot drift into disagreeing about what "LLM cost" means.
 *
 * The server wrapper (Common/Server/Utils/Telemetry/LlmMetricSpend.ts) adds
 * the AggregateBy envelope and executes them.
 *
 * Scoping caveat, deliberate: provider/model narrowing matches the PRIMARY
 * semantic-convention attribute key only (gen_ai.system, gen_ai.request.model).
 * The span extractor accepts several fallback spellings per field, but a
 * ClickHouse map filter can only test one key at a time, and issuing one query
 * per candidate key and summing would double-count any datapoint carrying two
 * of them. Matching the semconv key alone can only ever UNDER-count a scoped
 * query, never over-count it. Unscoped project-wide queries — the common case,
 * and the one a metrics-only emitter usually needs — apply no attribute filter
 * and see every datapoint.
 */

export interface LlmMetricScope {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  // Telemetry service to narrow to, matching Span.primaryEntityId scoping.
  serviceId?: ObjectID | undefined;
  // gen_ai.system value, e.g. "openai".
  llmSystem?: string | undefined;
  // gen_ai.request.model value.
  llmModel?: string | undefined;
}

export interface LlmMetricTokenTotals {
  inputTokens: number;
  outputTokens: number;
}

/*
 * Both convention lists are ordered preferred-first, so element zero is the
 * semantic-convention key.
 */
export const METRIC_SYSTEM_ATTRIBUTE_KEY: string = LlmSystemAttributeKeys[0]!;
export const METRIC_MODEL_ATTRIBUTE_KEY: string =
  LlmRequestModelAttributeKeys[0]!;

export default class LlmMetricQuery {
  /**
   * Shared filter for both the cost and token queries: the project, the
   * window, the candidate metric names, and the caller's optional scoping.
   *
   * The `time` predicate has to live in the query itself. AggregateBy's
   * startTimestamp/endTimestamp only choose the bucket grid — without this the
   * aggregate scans the metric's whole retention (the same trap the span query
   * documents).
   */
  public static buildBaseQuery(data: {
    scope: LlmMetricScope;
    metricNames: Array<string>;
  }): Query<Metric> {
    const query: Record<string, unknown> = {
      projectId: data.scope.projectId,
      name: new Includes(data.metricNames),
      time: new InBetween(data.scope.startTime, data.scope.endTime),
    };

    if (data.scope.serviceId) {
      query["primaryEntityId"] = data.scope.serviceId;
    }

    const attributes: Record<string, string> = {};

    if (data.scope.llmSystem) {
      attributes[METRIC_SYSTEM_ATTRIBUTE_KEY] = data.scope.llmSystem;
    }

    if (data.scope.llmModel) {
      attributes[METRIC_MODEL_ATTRIBUTE_KEY] = data.scope.llmModel;
    }

    if (Object.keys(attributes).length > 0) {
      query["attributes"] = attributes;
    }

    return query as Query<Metric>;
  }

  public static buildCostQuery(scope: LlmMetricScope): Query<Metric> {
    return this.buildBaseQuery({
      scope: scope,
      metricNames: LlmCostMetricNames,
    });
  }

  public static buildTokenQuery(scope: LlmMetricScope): Query<Metric> {
    return this.buildBaseQuery({
      scope: scope,
      metricNames: LlmTokenUsageMetricNames,
    });
  }

  /**
   * Sum an aggregate result's buckets. Non-numeric, missing, NaN and infinite
   * values contribute nothing rather than poisoning the total — these figures
   * feed monitors, and one bad row must not turn a budget's spend into NaN.
   */
  public static sumAggregatedRows(
    rows: Array<AggregatedModel> | undefined | null,
  ): number {
    if (!rows || !Array.isArray(rows)) {
      return 0;
    }

    return rows.reduce((acc: number, row: AggregatedModel): number => {
      const value: number = Number(row?.value ?? 0);

      if (!isFinite(value)) {
        return acc;
      }

      return acc + value;
    }, 0);
  }

  /**
   * Fold grouped token rows into input/output totals.
   *
   * A row is counted once, against the first recognized token-type attribute
   * it carries (the keys are ordered preferred-first). Rows whose token type
   * is absent, unrecognized, or one of the kinds we deliberately exclude
   * (cache_read / cache_creation) are dropped rather than guessed at.
   */
  public static reduceTokenRows(
    rows: Array<AggregatedModel> | undefined | null,
  ): LlmMetricTokenTotals {
    const totals: LlmMetricTokenTotals = {
      inputTokens: 0,
      outputTokens: 0,
    };

    if (!rows || !Array.isArray(rows)) {
      return totals;
    }

    for (const row of rows) {
      if (!row) {
        continue;
      }

      const attributes: JSONObject =
        (row["attributes"] as JSONObject | undefined) || {};

      let direction: LlmTokenDirection | null = null;

      for (const key of LlmTokenTypeAttributeKeys) {
        const candidate: LlmTokenDirection | null = getLlmTokenDirection(
          attributes[key] as string | undefined,
        );

        if (candidate) {
          direction = candidate;
          break;
        }
      }

      if (!direction) {
        continue;
      }

      const value: number = Number(row.value ?? 0);

      if (!isFinite(value)) {
        continue;
      }

      if (direction === "input") {
        totals.inputTokens += value;
      } else {
        totals.outputTokens += value;
      }
    }

    return totals;
  }
}
