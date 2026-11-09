import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import {
  readTelemetryIngestionBudgetStoredSettings,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  telemetryIngestionBudgetGBToBytes,
  telemetryIngestionBudgetMBToBytes,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetStoredSettings,
  TelemetryIngestionBudgetValueKind,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import {
  formatTelemetryIngestionBudgetBytes,
  formatTelemetryIngestionBudgetRate,
} from "Common/UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetWords";
import { getTelemetryUsageSignalTitle } from "Common/UI/Components/TelemetryUsage/TelemetryUsageWords";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * An ingestion key's own budgets, or its rates, as one line each on its
 * page: "Logs: 10 GB", or that it has none of its own and the project's
 * apply - which is what an empty set of fields means.
 */

export interface ComponentProps {
  item: TelemetryIngestionKey;
  kind: TelemetryIngestionBudgetValueKind;
}

interface SummaryEntry {
  signal: TelemetryIngestionBudgetSignal;
  text: string;
}

const IngestionKeyBudgetSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const stored: TelemetryIngestionBudgetStoredSettings =
    readTelemetryIngestionBudgetStoredSettings(props.item);
  const isDaily: boolean =
    props.kind === TelemetryIngestionBudgetValueKind.DailyBudget;

  const entries: Array<SummaryEntry> = [];

  for (const signal of TELEMETRY_INGESTION_BUDGET_SIGNALS) {
    const value: number | null = isDaily
      ? stored[signal].dailyBudgetInGB
      : stored[signal].rateLimitInMBPerSecond;

    if (value === null || value <= 0) {
      continue;
    }

    entries.push({
      signal: signal,
      text: isDaily
        ? formatTelemetryIngestionBudgetBytes(
            telemetryIngestionBudgetGBToBytes(value),
            translator,
          )
        : formatTelemetryIngestionBudgetRate(
            telemetryIngestionBudgetMBToBytes(value),
            translator,
          ),
    });
  }

  if (entries.length === 0) {
    return (
      <span className="text-sm text-gray-500">
        {isDaily
          ? translator.translateText(
              "None of its own: the project's budgets apply.",
            )
          : translator.translateText(
              "None of its own: the project's rate limits apply.",
            )}
      </span>
    );
  }

  return (
    <ul className="space-y-0.5 text-sm text-gray-900">
      {entries.map((entry: SummaryEntry): ReactElement => {
        return (
          <li key={entry.signal} className="tabular-nums">
            {translator.translateTemplate("{{signal}}: {{amount}}", {
              signal: getTelemetryUsageSignalTitle(entry.signal, translator),
              amount: entry.text,
            })}
          </li>
        );
      })}
    </ul>
  );
};

export default IngestionKeyBudgetSummary;
