/*
 * Today's telemetry ingestion budgets, which the Security Events layout reads
 * (GET /telemetry-ingestion-budget/project) for the banner it shows while
 * the Security Events budget is past its warning or used up. The project
 * sets no budget, the default, so this answers what the server answers then
 * (TelemetryIngestionBudgetStatusReader): every signal without a budget,
 * nothing counted against one, no ingestion key with budgets of its own -
 * and the banner stays away.
 */
import {
  TELEMETRY_INGESTION_BUDGET_DEFAULT_RESET_TIME,
  TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE,
  TELEMETRY_INGESTION_BUDGET_DEFAULT_WARNING_PERCENT,
  TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetState,
  getTelemetryIngestionBudgetDay,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";

export function isIngestionBudgetRead(method, path) {
  return (
    method === "GET" && path.endsWith(TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE)
  );
}

// The answer, for the budget day the fixture's pinned clock is in.
export function ingestionBudgetStatus(now) {
  const day = getTelemetryIngestionBudgetDay({ now });

  return {
    dayStartsAt: day.startsAt.toISOString(),
    resetsAt: day.resetsAt.toISOString(),
    resetTime: TELEMETRY_INGESTION_BUDGET_DEFAULT_RESET_TIME,
    timezone: TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE,
    warningPercent: TELEMETRY_INGESTION_BUDGET_DEFAULT_WARNING_PERCENT,
    countersAvailable: true,
    project: {
      scope: TelemetryIngestionBudgetScope.Project,
      signals: TELEMETRY_INGESTION_BUDGET_SIGNALS.map((signal) => {
        return {
          signal,
          dailyBudgetBytes: null,
          dailyBudgetSource: null,
          rateLimitBytesPerSecond: null,
          rateLimitSource: null,
          usedBytes: 0,
          droppedBytes: 0,
          droppedRequests: 0,
          throttledRequests: 0,
          percentUsed: null,
          state: TelemetryIngestionBudgetState.NoBudget,
          warningCrossedAt: null,
          exhaustedAt: null,
        };
      }),
    },
    ingestionKeys: [],
  };
}
