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
  LlmMetricTeamAttributeKeys,
  LlmMetricUserAttributeKeys,
  LlmMicroUsdCostMetricNames,
  LlmTokenDirection,
  LlmTokenTypeAttributeKeys,
  LlmTokenUsageMetricNames,
  MICRO_USD_TO_USD,
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
  /*
   * Employee / team narrowing, for "what did this person spend" and
   * per-cost-centre rollups.
   *
   * Same one-key-only caveat as llmSystem/llmModel above, and for the same
   * reason: several spellings are recognized, a ClickHouse map filter can
   * test one key at a time, and issuing one query per candidate key and
   * summing would double-count any datapoint carrying two of them. So each
   * filter matches the PRIMARY key of its list only (user.email, team.id),
   * which can under-count a scoped query but can never over-count it —
   * exactly the direction a chargeback figure should err in.
   */
  llmUserId?: string | undefined;
  llmUserEmail?: string | undefined;
  llmTeam?: string | undefined;
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

/*
 * The identity keys, likewise element zero of their lists. On the metric side
 * that is "user.email" — the spelling the coding-agent CLIs emit natively and
 * the one a manager can read without a lookup table.
 */
export const METRIC_USER_ATTRIBUTE_KEY: string = LlmMetricUserAttributeKeys[0]!;
export const METRIC_TEAM_ATTRIBUTE_KEY: string = LlmMetricTeamAttributeKeys[0]!;

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

    /*
     * llmUserId and llmUserEmail both narrow on METRIC_USER_ATTRIBUTE_KEY —
     * the metric stream has ONE identity key ("user.email"), unlike the span
     * side where the id and the email are separate columns. Email is the
     * preferred spelling, so it wins if a caller somehow supplies both rather
     * than the two silently overwriting each other in map order.
     */
    if (data.scope.llmUserEmail) {
      attributes[METRIC_USER_ATTRIBUTE_KEY] = data.scope.llmUserEmail;
    } else if (data.scope.llmUserId) {
      attributes[METRIC_USER_ATTRIBUTE_KEY] = data.scope.llmUserId;
    }

    if (data.scope.llmTeam) {
      attributes[METRIC_TEAM_ATTRIBUTE_KEY] = data.scope.llmTeam;
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

  /**
   * The micro-USD cost query — Codex-style emitters that report spend in
   * MILLIONTHS of a dollar.
   *
   * Separate from buildCostQuery on purpose. A single query over both name
   * lists would sum two different units into one number, and a $3 Codex turn
   * would reach a cost budget as $3,000,000. The unit cannot be recovered
   * after the sum, so it has to be applied per-list, before the addition —
   * which is what combineCostTotals below is for.
   */
  public static buildMicroUsdCostQuery(scope: LlmMetricScope): Query<Metric> {
    return this.buildBaseQuery({
      scope: scope,
      metricNames: LlmMicroUsdCostMetricNames,
    });
  }

  public static buildTokenQuery(scope: LlmMetricScope): Query<Metric> {
    return this.buildBaseQuery({
      scope: scope,
      metricNames: LlmTokenUsageMetricNames,
    });
  }

  /**
   * Combine a USD total with a micro-USD total into one USD figure.
   *
   * The ONLY place MICRO_USD_TO_USD is applied. Keeping the scale factor in a
   * single pure function is the whole point: a million-fold unit error is
   * invisible in a diff and catastrophic in a cost budget, so it lives
   * somewhere a test can pin it exactly once.
   *
   * Non-finite inputs contribute 0 rather than poisoning the result, matching
   * sumAggregatedRows: these figures gate alerting, and a NaN spend compares
   * false against every threshold and would silently disable the monitor.
   */
  public static combineCostTotals(data: {
    usd: number;
    microUsd: number;
  }): number {
    const usd: number = isFinite(data.usd) ? data.usd : 0;
    const microUsd: number = isFinite(data.microUsd) ? data.microUsd : 0;

    return usd + microUsd * MICRO_USD_TO_USD;
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
