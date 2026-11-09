import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import TelemetryIngestionBudgetBanner, {
  getTelemetryIngestionBudgetBannerNotice,
  TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID,
  TelemetryIngestionBudgetBannerNotice,
} from "../../../../UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetBanner";
import { AlertType } from "../../../../UI/Components/Alerts/Alert";
import Route from "../../../../Types/API/Route";
import OneUptimeDate from "../../../../Types/Date";
import {
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";
import { Translator } from "../../../../Types/Translator";
import { createTranslator } from "../../../../UI/Utils/TranslateTemplate";
import {
  budgeted,
  GB,
  KEY_ID,
  LOGS,
  OTHER_KEY_ID,
  scope,
  status,
  TRACES,
} from "./TelemetryIngestionBudgetFixtures";

/*
 * The line the explorers show above their data while a signal's ingestion
 * budget (issue #5917) is past its warning or used up - the moment someone
 * wonders why new data stopped arriving - and nothing otherwise, including
 * when the status cannot be read.
 */

const english: Translator = createTranslator(undefined, "en");

type FetchStatus = ReturnType<
  typeof jest.fn<() => Promise<TelemetryIngestionBudgetStatus>>
>;

const resetsAt: (data: TelemetryIngestionBudgetStatus) => string = (
  data: TelemetryIngestionBudgetStatus,
): string => {
  return OneUptimeDate.getDateAsFormattedStringInTimezone({
    date: data.resetsAt,
    timezone: data.timezone,
  });
};

const noticeFor: (
  data: TelemetryIngestionBudgetStatus,
  signal?: typeof LOGS,
) => TelemetryIngestionBudgetBannerNotice | null = (
  data: TelemetryIngestionBudgetStatus,
  signal: typeof LOGS = LOGS,
): TelemetryIngestionBudgetBannerNotice | null => {
  return getTelemetryIngestionBudgetBannerNotice({
    status: data,
    signal: signal,
    translator: english,
  });
};

afterEach(() => {
  cleanup();
});

describe("what the banner says", () => {
  test("a used-up budget: refused until the reset, in the danger colour", () => {
    const data: TelemetryIngestionBudgetStatus = status({
      project: [
        budgeted(LOGS, {
          usedBytes: 10 * GB,
          percentUsed: 100,
          state: TelemetryIngestionBudgetState.Exhausted,
        }),
      ],
    });

    expect(noticeFor(data)).toEqual({
      type: AlertType.DANGER,
      text: `Logs: today's ingestion budget of 10 GB is used up, so new data is refused until the budget resets at ${resetsAt(data)}.`,
    });
  });

  test("past the warning: how much is used, rounded down", () => {
    const data: TelemetryIngestionBudgetStatus = status({
      project: [
        budgeted(LOGS, {
          usedBytes: 8.79 * GB,
          percentUsed: 87.9,
          state: TelemetryIngestionBudgetState.Warning,
        }),
      ],
    });

    expect(noticeFor(data)).toEqual({
      type: AlertType.WARNING,
      text: `Logs: 87% of today's ingestion budget of 10 GB is used. Once it is used up, new data is refused until the budget resets at ${resetsAt(data)}.`,
    });
  });

  test("reads the reset in the budget's own time zone", () => {
    const data: TelemetryIngestionBudgetStatus = status({
      timezone: "Asia/Kolkata",
      project: [
        budgeted(LOGS, { state: TelemetryIngestionBudgetState.Exhausted }),
      ],
    });

    expect(noticeFor(data)?.text).toContain(
      OneUptimeDate.getDateAsFormattedStringInTimezone({
        date: data.resetsAt,
        timezone: "Asia/Kolkata",
      }),
    );
  });

  test("keys that used up their own budget, counted, when the project's is fine", () => {
    const usedUp: (id: string, name: string) => ReturnType<typeof scope> = (
      id: string,
      name: string,
    ): ReturnType<typeof scope> => {
      return scope(
        [budgeted(LOGS, { state: TelemetryIngestionBudgetState.Exhausted })],
        { id: id, name: name },
      );
    };

    const one: TelemetryIngestionBudgetStatus = status({
      project: [budgeted(LOGS, {})],
      ingestionKeys: [usedUp(KEY_ID, "Collector")],
    });
    expect(noticeFor(one)).toEqual({
      type: AlertType.WARNING,
      text: `Logs: 1 ingestion key has used up its own budget for today, so data sent with it is refused until ${resetsAt(one)}.`,
    });

    const two: TelemetryIngestionBudgetStatus = status({
      ingestionKeys: [
        usedUp(KEY_ID, "Collector"),
        usedUp(OTHER_KEY_ID, "Edge"),
      ],
    });
    expect(noticeFor(two)?.text).toBe(
      `Logs: 2 ingestion keys have used up their own budgets for today, so data sent with them is refused until ${resetsAt(two)}.`,
    );
  });

  test("the project's used-up budget is told before any key's", () => {
    const data: TelemetryIngestionBudgetStatus = status({
      project: [
        budgeted(LOGS, { state: TelemetryIngestionBudgetState.Exhausted }),
      ],
      ingestionKeys: [
        scope(
          [budgeted(LOGS, { state: TelemetryIngestionBudgetState.Exhausted })],
          { id: KEY_ID, name: "Collector" },
        ),
      ],
    });

    expect(noticeFor(data)?.type).toBe(AlertType.DANGER);
  });

  test("nothing for a budget within limits, another signal's trouble, or no budget at all", () => {
    expect(noticeFor(status({ project: [budgeted(LOGS, {})] }))).toBe(null);
    expect(
      noticeFor(
        status({
          project: [
            budgeted(TRACES, {
              state: TelemetryIngestionBudgetState.Exhausted,
            }),
          ],
        }),
      ),
    ).toBe(null);
    expect(noticeFor(status({}))).toBe(null);
    // Counters that could not be read are no reason to alarm anyone.
    expect(
      noticeFor(
        status({
          countersAvailable: false,
          project: [
            budgeted(LOGS, {
              usedBytes: null,
              percentUsed: null,
              state: TelemetryIngestionBudgetState.Unknown,
            }),
          ],
        }),
      ),
    ).toBe(null);
  });
});

describe("the banner", () => {
  test("draws the notice, with a link to the budgets", async () => {
    const fetchStatus: FetchStatus = jest.fn(
      async (): Promise<TelemetryIngestionBudgetStatus> => {
        return status({
          project: [
            budgeted(LOGS, { state: TelemetryIngestionBudgetState.Exhausted }),
          ],
        });
      },
    );

    render(
      <TelemetryIngestionBudgetBanner
        signal={LOGS}
        fetchStatus={fetchStatus}
        budgetsRoute={new Route("/dashboard/project/settings/usage-history")}
      />,
    );

    expect(
      await screen.findByTestId(TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID),
    ).toHaveTextContent("today's ingestion budget of 10 GB is used up");
    expect(
      screen.getByTestId("telemetry-ingestion-budget-banner-link"),
    ).toHaveTextContent("See budgets");
  });

  test("draws nothing when the status cannot be read", async () => {
    const fetchStatus: FetchStatus = jest.fn(
      async (): Promise<TelemetryIngestionBudgetStatus> => {
        throw new Error("You do not have permission to read usage.");
      },
    );

    const { container } = render(
      <TelemetryIngestionBudgetBanner
        signal={LOGS}
        fetchStatus={fetchStatus}
      />,
    );

    await waitFor(() => {
      expect(fetchStatus).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByTestId(TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID),
    ).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  test("draws nothing while every budget is within limits", async () => {
    const fetchStatus: FetchStatus = jest.fn(
      async (): Promise<TelemetryIngestionBudgetStatus> => {
        return status({ project: [budgeted(LOGS, {})] });
      },
    );

    render(
      <TelemetryIngestionBudgetBanner
        signal={LOGS}
        fetchStatus={fetchStatus}
      />,
    );

    await waitFor(() => {
      expect(fetchStatus).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByTestId(TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID),
    ).toBeNull();
  });
});
