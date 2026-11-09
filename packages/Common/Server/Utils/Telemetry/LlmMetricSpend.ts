import {
  LlmMetricUsageDimension,
  LlmMetricUsageResponse,
} from "../../../Types/Telemetry/LlmMetricUsageApi";
import {
  LlmMetricScope,
  LlmMetricTokenTotals,
} from "../../../Utils/Telemetry/LlmMetricQuery";
import CaptureSpan from "./CaptureSpan";
import LlmMetricUsageReader, {
  LlmMetricUsageReadQuery,
} from "./LlmMetricUsageReader";

/*
 * Metric-sourced LLM token and cost totals.
 *
 * The LLM feature reads spans first — a GenAI span carries model, tokens and
 * cost on one row, which is the richest source and the only one that can back
 * the per-call views. This module is the SECOND source, for the emitters that
 * publish GenAI metrics but no GenAI spans:
 *
 *   - The coding assistants (Claude Code, Codex, Gemini CLI, Cursor).
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
 * The figures come from LlmMetricUsageReader, which counts a counter the way
 * it counts: a delta series' points added up, a cumulative series by what it
 * grew in the window. Adding a cumulative counter's points up - each one the
 * running total since its process started - counted a long-running session's
 * spend once per export, and fired budgets on spend that never happened.
 * The Usage tab reads the same reader, so the two cannot disagree.
 */

export { LlmMetricScope, LlmMetricTokenTotals };

export default class LlmMetricSpend {
  // The reader's query for a scope: totals only, the scope's filters applied.
  public static toReadQuery(scope: LlmMetricScope): LlmMetricUsageReadQuery {
    return {
      projectId: scope.projectId,
      startTime: scope.startTime,
      endTime: scope.endTime,
      dimension: LlmMetricUsageDimension.None,
      serviceId: scope.serviceId,
      llmSystem: scope.llmSystem,
      llmModel: scope.llmModel,
      llmUser: scope.llmUserEmail || scope.llmUserId,
      llmTeam: scope.llmTeam,
    };
  }

  /**
   * Metric-sourced spend in USD for the scope, or 0 when nothing matched.
   * USD and Codex's millionths of a USD are scaled apart before they are
   * added (LlmMetricUsageUtil). A read that fails throws: returning 0 would
   * silently suppress a real budget breach.
   */
  @CaptureSpan()
  public static async getCostInUSD(scope: LlmMetricScope): Promise<number> {
    const usage: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
      LlmMetricSpend.toReadQuery(scope),
    );

    return usage.totals.costUsd;
  }

  /** Metric-sourced input/output token totals for the scope. */
  @CaptureSpan()
  public static async getTokenTotals(
    scope: LlmMetricScope,
  ): Promise<LlmMetricTokenTotals> {
    const usage: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
      LlmMetricSpend.toReadQuery(scope),
    );

    return {
      inputTokens: usage.totals.inputTokens,
      outputTokens: usage.totals.outputTokens,
    };
  }
}
