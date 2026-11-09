import {
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB,
  TelemetryIngestionBudgetLimitSource,
  TelemetryIngestionBudgetScopeStatus,
  TelemetryIngestionBudgetSignalStatus,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import { Translator } from "../../../Types/Translator";
import Color from "../../../Types/Color";
import { Gray500, Green, Red, Yellow } from "../../../Types/BrandColors";
import { translationKey } from "../../Utils/TranslateTemplate";
import { formatTelemetryUsageSize } from "../TelemetryUsage/TelemetryUsageWords";

/*
 * What the ingestion budget pages call things, in English, each looked up
 * where it is drawn (Project Settings > Telemetry & APM > Usage, an ingestion
 * key's page, the explorers' banner, and the Admin Dashboard's project page).
 * React-free, so a plain test reads it.
 */

export const TELEMETRY_INGESTION_BUDGET_STATE_LABELS: Record<
  TelemetryIngestionBudgetState,
  string
> = {
  [TelemetryIngestionBudgetState.NoBudget]: translationKey("No daily budget"),
  [TelemetryIngestionBudgetState.Ok]: translationKey("Within budget"),
  [TelemetryIngestionBudgetState.Warning]: translationKey("Past warning"),
  [TelemetryIngestionBudgetState.Exhausted]: translationKey("Used up"),
  [TelemetryIngestionBudgetState.Unknown]: translationKey("Unknown"),
};

export const TELEMETRY_INGESTION_BUDGET_STATE_COLORS: Record<
  TelemetryIngestionBudgetState,
  Color
> = {
  [TelemetryIngestionBudgetState.NoBudget]: Gray500,
  [TelemetryIngestionBudgetState.Ok]: Green,
  [TelemetryIngestionBudgetState.Warning]: Yellow,
  [TelemetryIngestionBudgetState.Exhausted]: Red,
  [TelemetryIngestionBudgetState.Unknown]: Gray500,
};

// Where a limit in force was set, under its value.
export const TELEMETRY_INGESTION_BUDGET_SOURCE_LABELS: Record<
  TelemetryIngestionBudgetLimitSource,
  string
> = {
  [TelemetryIngestionBudgetLimitSource.Instance]:
    translationKey("Instance default"),
  [TelemetryIngestionBudgetLimitSource.Project]: translationKey(
    "Set for this project",
  ),
  [TelemetryIngestionBudgetLimitSource.IngestionKey]:
    translationKey("This key's own"),
};

const RATE_TEMPLATE: string = translationKey("{{size}} per second");

// A day's bytes as the usage pages write sizes: "8.2 GB", "350 MB".
export const formatTelemetryIngestionBudgetBytes: (
  bytes: number,
  translator: Translator,
) => string = (bytes: number, translator: Translator): string => {
  return formatTelemetryUsageSize(
    bytes / TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
    translator,
  );
};

// A rate: "5 MB per second".
export const formatTelemetryIngestionBudgetRate: (
  bytesPerSecond: number,
  translator: Translator,
) => string = (bytesPerSecond: number, translator: Translator): string => {
  const megabytes: number =
    bytesPerSecond / TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB;

  return translator.translateTemplate(RATE_TEMPLATE, {
    size: formatTelemetryUsageSize(megabytes / 1024, translator),
  });
};

/*
 * A signal row worth drawing: one with a budget or a rate in force, or
 * anything counted or refused today.
 */
export const isTelemetryIngestionBudgetSignalShown: (
  signal: TelemetryIngestionBudgetSignalStatus,
) => boolean = (signal: TelemetryIngestionBudgetSignalStatus): boolean => {
  return (
    signal.dailyBudgetBytes !== null ||
    signal.rateLimitBytesPerSecond !== null ||
    (signal.droppedRequests ?? 0) > 0 ||
    (signal.throttledRequests ?? 0) > 0
  );
};

// Whether a status has anything in force to show at all.
export const hasTelemetryIngestionBudgets: (
  status: TelemetryIngestionBudgetStatus,
) => boolean = (status: TelemetryIngestionBudgetStatus): boolean => {
  return (
    status.project.signals.some(isTelemetryIngestionBudgetSignalShown) ||
    status.ingestionKeys.some((key: TelemetryIngestionBudgetScopeStatus) => {
      return key.signals.some(isTelemetryIngestionBudgetSignalShown);
    })
  );
};

// The bar under a day's usage: its share of the budget, capped for drawing.
export const getTelemetryIngestionBudgetBarPercent: (
  signal: TelemetryIngestionBudgetSignalStatus,
) => number = (signal: TelemetryIngestionBudgetSignalStatus): number => {
  if (signal.percentUsed === null) {
    return 0;
  }

  return Math.min(100, Math.max(0, signal.percentUsed));
};

export const TELEMETRY_INGESTION_BUDGET_BAR_COLORS: Record<
  TelemetryIngestionBudgetState,
  string
> = {
  [TelemetryIngestionBudgetState.NoBudget]: "bg-gray-300",
  [TelemetryIngestionBudgetState.Ok]: "bg-emerald-500",
  [TelemetryIngestionBudgetState.Warning]: "bg-amber-500",
  [TelemetryIngestionBudgetState.Exhausted]: "bg-red-500",
  [TelemetryIngestionBudgetState.Unknown]: "bg-gray-300",
};
