import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
  readTelemetryIngestionBudgetStatus,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";
import { Translator } from "../../../../Types/Translator";
import { createTranslator } from "../../../../UI/Utils/TranslateTemplate";
import {
  budgeted,
  GB,
  hostileAnswers,
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

/*
 * Issue #6486: an answer that is not a status - the {} the offline test
 * doubles answered every read they did not model with - was read as one,
 * and the banner threw while it drew ("Cannot read properties of undefined
 * (reading 'signals')"), which took down the whole explorer under it. Each
 * test draws the banner above an explorer, as each explorer's layout does,
 * and holds the explorer to still being there once the answer has landed.
 */
describe("an answer that is not a status", () => {
  const EXPLORER_TEST_ID: string = "explorer-under-the-banner";

  type ConsoleErrorSpy = ReturnType<typeof jest.spyOn>;

  // The banner over an explorer, once the answer has landed and been drawn.
  const drawOverExplorer: (answer: unknown) => Promise<void> = async (
    answer: unknown,
  ): Promise<void> => {
    const fetchStatus: FetchStatus = jest.fn(
      async (): Promise<TelemetryIngestionBudgetStatus> => {
        return answer as TelemetryIngestionBudgetStatus;
      },
    );

    render(
      <div>
        <TelemetryIngestionBudgetBanner
          signal={LOGS}
          fetchStatus={fetchStatus}
          budgetsRoute={new Route("/dashboard/project/settings/usage-history")}
        />
        <p data-testid={EXPLORER_TEST_ID}>Log lines</p>
      </div>,
    );

    await waitFor(() => {
      expect(fetchStatus).toHaveBeenCalledTimes(1);
    });
    // Let the answer land, and the banner draw what it makes of it.
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });
  };

  const spyOnConsoleErrors: () => ConsoleErrorSpy = (): ConsoleErrorSpy => {
    return jest.spyOn(console, "error").mockImplementation(() => {
      // Recorded, not printed: each test fails on any (errorsLogged).
    });
  };

  /*
   * What was logged as an error - React logs the error a component threw
   * while it drew - but for React's own notice, once per run, that the
   * act() the testing library calls is deprecated.
   */
  const errorsLogged: (spy: ConsoleErrorSpy) => Array<string> = (
    spy: ConsoleErrorSpy,
  ): Array<string> => {
    return spy.mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .filter((text: string): boolean => {
        return !text.includes("ReactDOMTestUtils.act");
      });
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("{}: nothing drawn, nothing thrown, and the explorer under it whole", async () => {
    const consoleErrors: ConsoleErrorSpy = spyOnConsoleErrors();

    await drawOverExplorer({});

    expect(screen.getByTestId(EXPLORER_TEST_ID)).toHaveTextContent("Log lines");
    expect(
      screen.queryByTestId(TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID),
    ).toBeNull();
    expect(errorsLogged(consoleErrors)).toEqual([]);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", []],
    ["text", "ok"],
    ["a proxy's page", "<!doctype html><title>Bad gateway</title>"],
    ["an error the server wrote", { message: "Not modelled" }],
    ["a project with no signals", { project: {}, ingestionKeys: [] }],
    [
      "a project whose signals are not a list",
      { ...status({}), project: { scope: "project", signals: null } },
    ],
    [
      "a used-up budget with no reset time to tell",
      {
        ...status({
          project: [
            budgeted(LOGS, { state: TelemetryIngestionBudgetState.Exhausted }),
          ],
        }),
        resetsAt: undefined,
      },
    ],
  ])(
    "%s: nothing drawn, and the explorer whole",
    async (_name: string, answer: unknown) => {
      const consoleErrors: ConsoleErrorSpy = spyOnConsoleErrors();

      await drawOverExplorer(answer);

      expect(screen.getByTestId(EXPLORER_TEST_ID)).toBeInTheDocument();
      expect(
        screen.queryByTestId(TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID),
      ).toBeNull();
      expect(errorsLogged(consoleErrors)).toEqual([]);
    },
  );

  test("a used-up budget in an answer with parts it cannot read is still told", async () => {
    const consoleErrors: ConsoleErrorSpy = spyOnConsoleErrors();
    const sent: TelemetryIngestionBudgetStatus = status({
      project: [
        budgeted(LOGS, { state: TelemetryIngestionBudgetState.Exhausted }),
      ],
    });

    await drawOverExplorer({
      ...sent,
      // A time zone it does not know: the reset is written in UTC.
      timezone: "Mars/Olympus_Mons",
      // No list of keys, and a signal entry that is not one.
      ingestionKeys: undefined,
      project: { ...sent.project, signals: [null, ...sent.project.signals] },
    });

    expect(
      screen.getByTestId(TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID),
    ).toHaveTextContent(
      `Logs: today's ingestion budget of 10 GB is used up, so new data is refused until the budget resets at ${resetsAt({ ...sent, timezone: "UTC" })}.`,
    );
    expect(screen.getByTestId(EXPLORER_TEST_ID)).toBeInTheDocument();
    expect(errorsLogged(consoleErrors)).toEqual([]);
  });

  test("keys that are not keys are left out of the count", async () => {
    const consoleErrors: ConsoleErrorSpy = spyOnConsoleErrors();
    const usedUp: ReturnType<typeof scope> = scope(
      [budgeted(LOGS, { state: TelemetryIngestionBudgetState.Exhausted })],
      { id: KEY_ID, name: "Collector" },
    );

    await drawOverExplorer({
      ...status({ project: [budgeted(LOGS, {})] }),
      ingestionKeys: [null, "Edge", { signals: "logs" }, usedUp],
    });

    expect(
      screen.getByTestId(TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID),
    ).toHaveTextContent(
      "Logs: 1 ingestion key has used up its own budget for today",
    );
    expect(errorsLogged(consoleErrors)).toEqual([]);
  });

  test("whatever the answer, what the banner says of it never throws", () => {
    const busy: TelemetryIngestionBudgetStatus = status({
      project: [
        budgeted(LOGS, {
          usedBytes: 10 * GB,
          percentUsed: 100,
          state: TelemetryIngestionBudgetState.Exhausted,
        }),
        budgeted(TRACES, {
          usedBytes: 8.5 * GB,
          percentUsed: 85,
          state: TelemetryIngestionBudgetState.Warning,
        }),
      ],
      ingestionKeys: [
        scope(
          [budgeted(LOGS, { state: TelemetryIngestionBudgetState.Exhausted })],
          { id: KEY_ID, name: "Collector" },
        ),
      ],
    });
    let told: number = 0;

    for (const answer of hostileAnswers({
      from: JSON.parse(JSON.stringify(busy)) as unknown,
      seed: 6486,
      count: 600,
    })) {
      const read: TelemetryIngestionBudgetStatus | null =
        readTelemetryIngestionBudgetStatus(answer);

      if (!read) {
        continue;
      }

      for (const signal of TELEMETRY_INGESTION_BUDGET_SIGNALS) {
        const notice: TelemetryIngestionBudgetBannerNotice | null =
          getTelemetryIngestionBudgetBannerNotice({
            status: read,
            signal: signal,
            translator: english,
          });

        if (notice) {
          told++;
          expect(notice.text).not.toContain("undefined");
          expect(notice.text).not.toContain("NaN");
        }
      }
    }

    // Most answers still tell the used-up and the past-warning budget.
    expect(told).toBeGreaterThan(300);
  });

  test("answers drawn at random: the explorer under it is never taken down", async () => {
    const consoleErrors: ConsoleErrorSpy = spyOnConsoleErrors();
    const sent: TelemetryIngestionBudgetStatus = status({
      project: [
        budgeted(LOGS, { state: TelemetryIngestionBudgetState.Exhausted }),
      ],
    });

    for (const answer of hostileAnswers({
      from: JSON.parse(JSON.stringify(sent)) as unknown,
      seed: 4866,
      count: 25,
    })) {
      await drawOverExplorer(answer);

      expect(screen.getByTestId(EXPLORER_TEST_ID)).toBeInTheDocument();
      cleanup();
    }

    expect(errorsLogged(consoleErrors)).toEqual([]);
  });
});
