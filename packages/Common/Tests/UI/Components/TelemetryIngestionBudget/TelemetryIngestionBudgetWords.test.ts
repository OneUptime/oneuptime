import {
  TelemetryIngestionBudgetLimitSource,
  TelemetryIngestionBudgetState,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";
import { Translator } from "../../../../Types/Translator";
import {
  formatTelemetryIngestionBudgetBytes,
  formatTelemetryIngestionBudgetRate,
  getTelemetryIngestionBudgetBarPercent,
  hasTelemetryIngestionBudgets,
  isTelemetryIngestionBudgetSignalShown,
  TELEMETRY_INGESTION_BUDGET_BAR_COLORS,
  TELEMETRY_INGESTION_BUDGET_SOURCE_LABELS,
  TELEMETRY_INGESTION_BUDGET_STATE_COLORS,
  TELEMETRY_INGESTION_BUDGET_STATE_LABELS,
} from "../../../../UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetWords";
import { createTranslator } from "../../../../UI/Utils/TranslateTemplate";
import {
  budgeted,
  GB,
  KEY_ID,
  LOGS,
  scope,
  status,
  TRACES,
  unbudgeted,
} from "./TelemetryIngestionBudgetFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * What the ingestion budget pages call things (issue #5917): the states,
 * where a limit was set, sizes and rates, and which rows are worth drawing.
 */

const english: Translator = createTranslator(undefined, "en");

describe("the words", () => {
  test("every state has a label and a colour, and every source a label", () => {
    expect(TELEMETRY_INGESTION_BUDGET_STATE_LABELS).toEqual({
      [TelemetryIngestionBudgetState.NoBudget]: "No daily budget",
      [TelemetryIngestionBudgetState.Ok]: "Within budget",
      [TelemetryIngestionBudgetState.Warning]: "Past warning",
      [TelemetryIngestionBudgetState.Exhausted]: "Used up",
      [TelemetryIngestionBudgetState.Unknown]: "Unknown",
    });

    for (const state of Object.values(TelemetryIngestionBudgetState)) {
      expect(TELEMETRY_INGESTION_BUDGET_STATE_COLORS[state]).toBeTruthy();
      expect(TELEMETRY_INGESTION_BUDGET_BAR_COLORS[state]).toMatch(/^bg-/);
    }

    expect(TELEMETRY_INGESTION_BUDGET_SOURCE_LABELS).toEqual({
      [TelemetryIngestionBudgetLimitSource.Instance]: "Instance default",
      [TelemetryIngestionBudgetLimitSource.Project]: "Set for this project",
      [TelemetryIngestionBudgetLimitSource.IngestionKey]: "This key's own",
    });
  });

  test("a used-up budget is red and a warning amber, never the same as fine", () => {
    expect(
      TELEMETRY_INGESTION_BUDGET_BAR_COLORS[
        TelemetryIngestionBudgetState.Exhausted
      ],
    ).toBe("bg-red-500");
    expect(
      TELEMETRY_INGESTION_BUDGET_BAR_COLORS[
        TelemetryIngestionBudgetState.Warning
      ],
    ).toBe("bg-amber-500");
    expect(
      TELEMETRY_INGESTION_BUDGET_STATE_COLORS[TelemetryIngestionBudgetState.Ok],
    ).not.toEqual(
      TELEMETRY_INGESTION_BUDGET_STATE_COLORS[
        TelemetryIngestionBudgetState.Exhausted
      ],
    );
  });
});

describe("sizes and rates", () => {
  test.each([
    [10 * GB, "10 GB"],
    [1.5 * GB, "1.5 GB"],
    [350 * 1024 * 1024, "350 MB"],
    [0, "0 GB"],
  ])("%p bytes is %p", (bytes: number, text: string) => {
    expect(formatTelemetryIngestionBudgetBytes(bytes, english)).toBe(text);
  });

  test.each([
    [5 * 1024 * 1024, "5 MB per second"],
    [2 * GB, "2 GB per second"],
  ])("%p bytes a second is %p", (bytesPerSecond: number, text: string) => {
    expect(formatTelemetryIngestionBudgetRate(bytesPerSecond, english)).toBe(
      text,
    );
  });
});

describe("what is drawn", () => {
  test("a signal is shown with a budget or a rate in force, or anything refused today", () => {
    expect(isTelemetryIngestionBudgetSignalShown(unbudgeted(LOGS))).toBe(false);
    expect(isTelemetryIngestionBudgetSignalShown(budgeted(LOGS, {}))).toBe(
      true,
    );
    expect(
      isTelemetryIngestionBudgetSignalShown({
        ...unbudgeted(LOGS),
        rateLimitBytesPerSecond: 1024,
      }),
    ).toBe(true);
    expect(
      isTelemetryIngestionBudgetSignalShown({
        ...unbudgeted(LOGS),
        throttledRequests: 3,
      }),
    ).toBe(true);
    expect(
      isTelemetryIngestionBudgetSignalShown({
        ...unbudgeted(LOGS),
        droppedRequests: 1,
      }),
    ).toBe(true);
    // A figure that could not be read is not a reason to draw a row.
    expect(
      isTelemetryIngestionBudgetSignalShown({
        ...unbudgeted(LOGS),
        droppedRequests: null,
        throttledRequests: null,
      }),
    ).toBe(false);
  });

  test("a status has budgets when the project or any key has one", () => {
    expect(hasTelemetryIngestionBudgets(status({}))).toBe(false);
    expect(
      hasTelemetryIngestionBudgets(status({ project: [budgeted(TRACES, {})] })),
    ).toBe(true);
    expect(
      hasTelemetryIngestionBudgets(
        status({
          ingestionKeys: [
            scope([budgeted(LOGS, {})], { id: KEY_ID, name: "Collector" }),
          ],
        }),
      ),
    ).toBe(true);
  });

  test.each([
    [null, 0],
    [0, 0],
    [42.5, 42.5],
    [100, 100],
    [180, 100],
    [-3, 0],
  ])(
    "a bar for %p%% used is drawn %p%% wide",
    (percent: number | null, width: number) => {
      expect(
        getTelemetryIngestionBudgetBarPercent(
          budgeted(LOGS, { percentUsed: percent }),
        ),
      ).toBe(width);
    },
  );
});
