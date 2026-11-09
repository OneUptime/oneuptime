import ProductType from "../../../../Types/MeteredPlan/ProductType";
import {
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  TelemetryIngestionBudgetLimitSource,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetScopeStatus,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetSignalStatus,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";

/*
 * Statuses as the ingestion budget status API answers them (issue #5917),
 * for the UI tests of the budget card and the explorers' banner. Not a test
 * file itself (jest only collects *.test.ts).
 */

export const GB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB;

export const KEY_ID: string = "22222222-2222-4222-8222-222222222222";
export const OTHER_KEY_ID: string = "33333333-3333-4333-8333-333333333333";

// A signal with nothing in force and nothing counted.
export function unbudgeted(
  signal: TelemetryIngestionBudgetSignal,
): TelemetryIngestionBudgetSignalStatus {
  return {
    signal: signal,
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
}

export function budgeted(
  signal: TelemetryIngestionBudgetSignal,
  data: Partial<TelemetryIngestionBudgetSignalStatus>,
): TelemetryIngestionBudgetSignalStatus {
  return {
    ...unbudgeted(signal),
    dailyBudgetBytes: 10 * GB,
    dailyBudgetSource: TelemetryIngestionBudgetLimitSource.Instance,
    state: TelemetryIngestionBudgetState.Ok,
    percentUsed: 0,
    ...data,
  };
}

// Every signal of a scope, the given ones as given and the rest unbudgeted.
export function scope(
  signals: Array<TelemetryIngestionBudgetSignalStatus>,
  key?: { id: string; name: string },
): TelemetryIngestionBudgetScopeStatus {
  return {
    scope: key
      ? TelemetryIngestionBudgetScope.IngestionKey
      : TelemetryIngestionBudgetScope.Project,
    ingestionKeyId: key?.id,
    ingestionKeyName: key?.name,
    signals: TELEMETRY_INGESTION_BUDGET_SIGNALS.map(
      (signal: TelemetryIngestionBudgetSignal) => {
        return (
          signals.find((each: TelemetryIngestionBudgetSignalStatus) => {
            return each.signal === signal;
          }) || unbudgeted(signal)
        );
      },
    ),
  };
}

export function status(data: {
  project?: Array<TelemetryIngestionBudgetSignalStatus>;
  ingestionKeys?: Array<TelemetryIngestionBudgetScopeStatus>;
  countersAvailable?: boolean;
  timezone?: string;
}): TelemetryIngestionBudgetStatus {
  return {
    dayStartsAt: "2026-11-09T00:00:00.000Z",
    resetsAt: "2026-11-10T00:00:00.000Z",
    resetTime: "00:00",
    timezone: data.timezone || "UTC",
    warningPercent: 80,
    countersAvailable: data.countersAvailable ?? true,
    project: scope(data.project || []),
    ingestionKeys: data.ingestionKeys || [],
  };
}

export const LOGS: TelemetryIngestionBudgetSignal = ProductType.Logs;
export const TRACES: TelemetryIngestionBudgetSignal = ProductType.Traces;
