import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import TelemetryIngestionBudgetStatusCard, {
  TELEMETRY_INGESTION_BUDGET_STATUS_TEST_ID,
} from "../../../../UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetStatusCard";
import {
  readTelemetryIngestionBudgetStatus,
  TelemetryIngestionBudgetLimitSource,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";
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
 * Today's ingestion budgets (issue #5917), as Project Settings > Telemetry &
 * APM > Usage, an ingestion key's page and the Admin Dashboard's project
 * page draw them: a row for each signal with a budget or a rate, what was
 * counted and refused today, where each limit was set, and its state.
 */

type FetchStatus = ReturnType<
  typeof jest.fn<() => Promise<TelemetryIngestionBudgetStatus>>
>;

const answering: (data: TelemetryIngestionBudgetStatus) => FetchStatus = (
  data: TelemetryIngestionBudgetStatus,
): FetchStatus => {
  return jest.fn(async (): Promise<TelemetryIngestionBudgetStatus> => {
    return data;
  });
};

const BUSY_DAY: TelemetryIngestionBudgetStatus = status({
  project: [
    budgeted(LOGS, {
      usedBytes: 10 * GB,
      percentUsed: 100,
      droppedBytes: 2 * GB,
      droppedRequests: 40,
      state: TelemetryIngestionBudgetState.Exhausted,
      dailyBudgetSource: TelemetryIngestionBudgetLimitSource.Project,
    }),
    budgeted(TRACES, {
      usedBytes: 8.5 * GB,
      percentUsed: 85,
      rateLimitBytesPerSecond: 5 * 1024 * 1024,
      rateLimitSource: TelemetryIngestionBudgetLimitSource.Instance,
      throttledRequests: 1,
      state: TelemetryIngestionBudgetState.Warning,
    }),
  ],
  ingestionKeys: [
    scope(
      [
        budgeted(LOGS, {
          dailyBudgetBytes: GB,
          dailyBudgetSource: TelemetryIngestionBudgetLimitSource.IngestionKey,
          usedBytes: 0.25 * GB,
          percentUsed: 25,
        }),
      ],
      { id: KEY_ID, name: "Edge collector" },
    ),
    // A key with no budget of its own is not listed.
    scope([], { id: OTHER_KEY_ID, name: "Unbudgeted key" }),
  ],
});

afterEach(() => {
  cleanup();
});

describe("the project's budgets", () => {
  test("a row for each budgeted signal, with today's use, the limit, its source and state", async () => {
    render(
      <TelemetryIngestionBudgetStatusCard fetchStatus={answering(BUSY_DAY)} />,
    );

    const logs: HTMLElement = await screen.findByTestId(
      `telemetry-ingestion-budget-row-project-${LOGS}`,
    );
    expect(logs).toHaveTextContent("Logs");
    expect(logs).toHaveTextContent("10 GB(100%)");
    expect(logs).toHaveTextContent("Set for this project");
    expect(logs).toHaveTextContent("2 GB");
    expect(logs).toHaveTextContent("Used up");

    const traces: HTMLElement = screen.getByTestId(
      `telemetry-ingestion-budget-row-project-${TRACES}`,
    );
    expect(traces).toHaveTextContent("Instance default");
    expect(traces).toHaveTextContent("5 MB per second");
    expect(traces).toHaveTextContent("1 request");
    expect(traces).toHaveTextContent("Past warning");

    // Signals with nothing in force have no row.
    const projectTable: HTMLElement = screen.getByTestId(
      "telemetry-ingestion-budget-project-table",
    );
    expect(within(projectTable).getAllByRole("row")).toHaveLength(3);
  });

  test("the keys with budgets of their own, in a card of their own", async () => {
    render(
      <TelemetryIngestionBudgetStatusCard fetchStatus={answering(BUSY_DAY)} />,
    );

    const keyTable: HTMLElement = await screen.findByTestId(
      "telemetry-ingestion-budget-key-table",
    );
    expect(keyTable).toHaveTextContent("Edge collector");
    expect(keyTable).toHaveTextContent("This key's own");
    expect(keyTable).not.toHaveTextContent("Unbudgeted key");
    expect(screen.getByText("Ingestion Key Budgets")).toBeInTheDocument();
  });

  test("says when today's counts cannot be read, rather than show zeros", async () => {
    render(
      <TelemetryIngestionBudgetStatusCard
        fetchStatus={answering(
          status({
            countersAvailable: false,
            project: [
              budgeted(LOGS, {
                usedBytes: null,
                percentUsed: null,
                droppedBytes: null,
                state: TelemetryIngestionBudgetState.Unknown,
              }),
            ],
          }),
        )}
      />,
    );

    expect(
      await screen.findByTestId(
        "telemetry-ingestion-budget-counters-unavailable",
      ),
    ).toHaveTextContent(
      "Budgets are not enforced while they cannot be counted.",
    );
    expect(
      screen.getByTestId(`telemetry-ingestion-budget-row-project-${LOGS}`),
    ).toHaveTextContent("Unknown");
  });

  test("an empty state when no budget is set, or nothing at all where asked to stay quiet", async () => {
    render(
      <TelemetryIngestionBudgetStatusCard
        fetchStatus={answering(status({}))}
      />,
    );
    expect(
      await screen.findByTestId("telemetry-ingestion-budget-empty"),
    ).toHaveTextContent("No ingestion budgets");
    cleanup();

    const quiet: FetchStatus = answering(status({}));
    render(
      <TelemetryIngestionBudgetStatusCard
        fetchStatus={quiet}
        hideWhenUnbudgeted={true}
      />,
    );
    await waitFor(() => {
      expect(quiet).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByTestId(TELEMETRY_INGESTION_BUDGET_STATUS_TEST_ID),
    ).toBeNull();
  });

  test("an error that can be retried", async () => {
    const fetchStatus: FetchStatus = jest.fn(
      async (): Promise<TelemetryIngestionBudgetStatus> => {
        throw new Error("Network error");
      },
    );
    fetchStatus.mockImplementationOnce(
      async (): Promise<TelemetryIngestionBudgetStatus> => {
        throw new Error("Network error");
      },
    );
    fetchStatus.mockImplementationOnce(
      async (): Promise<TelemetryIngestionBudgetStatus> => {
        return BUSY_DAY;
      },
    );

    render(<TelemetryIngestionBudgetStatusCard fetchStatus={fetchStatus} />);

    expect(await screen.findByText("Network error")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(
      await screen.findByTestId(
        `telemetry-ingestion-budget-row-project-${LOGS}`,
      ),
    ).toBeInTheDocument();
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });
});

describe("one key's page", () => {
  test("only that key's budgets, under its own title", async () => {
    render(
      <TelemetryIngestionBudgetStatusCard
        fetchStatus={answering(BUSY_DAY)}
        ingestionKeyId={KEY_ID}
      />,
    );

    expect(
      await screen.findByTestId(
        `telemetry-ingestion-budget-row-${KEY_ID}-${LOGS}`,
      ),
    ).toHaveTextContent("1 GB");
    expect(screen.getByText("Today's Budget Usage")).toBeInTheDocument();
    expect(
      screen.queryByTestId(`telemetry-ingestion-budget-row-project-${LOGS}`),
    ).toBeNull();
    expect(
      screen.queryByTestId("telemetry-ingestion-budget-key-table"),
    ).toBeNull();
  });

  test("a key without budgets of its own draws nothing where asked to stay quiet", async () => {
    const fetchStatus: FetchStatus = answering(BUSY_DAY);

    render(
      <TelemetryIngestionBudgetStatusCard
        fetchStatus={fetchStatus}
        ingestionKeyId={OTHER_KEY_ID}
        hideWhenUnbudgeted={true}
      />,
    );

    await waitFor(() => {
      expect(fetchStatus).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByTestId(TELEMETRY_INGESTION_BUDGET_STATUS_TEST_ID),
    ).toBeNull();
  });
});

/*
 * Issue #6486: the explorers' banner threw on an answer that was not a
 * status, and so would this card, on Project Settings > Telemetry & APM >
 * Usage, an ingestion key's page and the Admin Dashboard's project page,
 * which read the same answer. Such an answer is said as a read that failed
 * is, with Refresh, and the page under the card stays whole.
 */
describe("an answer that is not a status", () => {
  const PAGE_TEST_ID: string = "page-under-the-card";
  /*
   * The card's own "Something went wrong. Please try again." explains
   * nothing, so since #6836 it is said as a failure the server could not
   * explain, with Try again.
   */
  const UNREADABLE: string =
    "The server ran into a problem it could not explain. Try again in a moment.";

  type ConsoleErrorSpy = ReturnType<typeof jest.spyOn>;

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

  const answeringAnything: (answer: unknown) => FetchStatus = (
    answer: unknown,
  ): FetchStatus => {
    return jest.fn(async (): Promise<TelemetryIngestionBudgetStatus> => {
      return answer as TelemetryIngestionBudgetStatus;
    });
  };

  const drawOverPage: (
    fetchStatus: FetchStatus,
    props?: { ingestionKeyId?: string; hideWhenUnbudgeted?: boolean },
  ) => void = (
    fetchStatus: FetchStatus,
    props?: { ingestionKeyId?: string; hideWhenUnbudgeted?: boolean },
  ): void => {
    render(
      <div>
        <TelemetryIngestionBudgetStatusCard
          fetchStatus={fetchStatus}
          ingestionKeyId={props?.ingestionKeyId}
          hideWhenUnbudgeted={props?.hideWhenUnbudgeted}
        />
        <p data-testid={PAGE_TEST_ID}>Usage history</p>
      </div>,
    );
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("{}: said as a failed read is, and Refresh reads it again", async () => {
    const consoleErrors: ConsoleErrorSpy = spyOnConsoleErrors();
    const fetchStatus: FetchStatus = answeringAnything({});
    fetchStatus.mockImplementationOnce(
      async (): Promise<TelemetryIngestionBudgetStatus> => {
        return {} as TelemetryIngestionBudgetStatus;
      },
    );
    fetchStatus.mockImplementationOnce(
      async (): Promise<TelemetryIngestionBudgetStatus> => {
        return BUSY_DAY;
      },
    );

    drawOverPage(fetchStatus);

    expect(await screen.findByText(UNREADABLE)).toBeInTheDocument();
    expect(
      screen.queryByText("Something went wrong. Please try again."),
    ).toBeNull();
    expect(screen.getByTestId(PAGE_TEST_ID)).toHaveTextContent("Usage history");
    // No sentence about a reset it could not read.
    expect(
      screen.getByTestId(TELEMETRY_INGESTION_BUDGET_STATUS_TEST_ID),
    ).not.toHaveTextContent("resets at");

    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(
      await screen.findByTestId(
        `telemetry-ingestion-budget-row-project-${LOGS}`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(UNREADABLE)).toBeNull();
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(errorsLogged(consoleErrors)).toEqual([]);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", []],
    ["text", "ok"],
    ["an error the server wrote", { message: "Not modelled" }],
    ["a project with no signals", { project: {}, ingestionKeys: [] }],
    [
      "a project whose signals are not a list",
      { ...BUSY_DAY, project: { scope: "project", signals: "logs" } },
    ],
    ["no reset time to tell", { ...BUSY_DAY, resetsAt: "" }],
  ])(
    "%s: said as a failed read is, and the page whole",
    async (_name: string, answer: unknown) => {
      const consoleErrors: ConsoleErrorSpy = spyOnConsoleErrors();

      drawOverPage(answeringAnything(answer));

      expect(await screen.findByText(UNREADABLE)).toBeInTheDocument();
      expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
      expect(screen.getByTestId(PAGE_TEST_ID)).toBeInTheDocument();
      expect(errorsLogged(consoleErrors)).toEqual([]);
    },
  );

  test("a key's page that stays quiet without budgets says so too, as for a read that failed", async () => {
    const consoleErrors: ConsoleErrorSpy = spyOnConsoleErrors();

    drawOverPage(answeringAnything({}), {
      ingestionKeyId: KEY_ID,
      hideWhenUnbudgeted: true,
    });

    expect(await screen.findByText(UNREADABLE)).toBeInTheDocument();
    expect(screen.getByTestId(PAGE_TEST_ID)).toBeInTheDocument();
    expect(errorsLogged(consoleErrors)).toEqual([]);
  });

  test("an answer with parts it cannot read draws the rows it can", async () => {
    const consoleErrors: ConsoleErrorSpy = spyOnConsoleErrors();
    const sent: TelemetryIngestionBudgetStatus = JSON.parse(
      JSON.stringify(BUSY_DAY),
    ) as TelemetryIngestionBudgetStatus;

    drawOverPage(
      answeringAnything({
        ...sent,
        project: {
          ...sent.project,
          signals: [null, { signal: "Spans" }, ...sent.project.signals],
        },
        ingestionKeys: ["Edge collector", {}, ...sent.ingestionKeys],
      }),
    );

    expect(
      await screen.findByTestId(
        `telemetry-ingestion-budget-row-project-${LOGS}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`telemetry-ingestion-budget-row-project-${TRACES}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`telemetry-ingestion-budget-row-${KEY_ID}-${LOGS}`),
    ).toHaveTextContent("1 GB");
    expect(screen.queryByText(UNREADABLE)).toBeNull();
    expect(errorsLogged(consoleErrors)).toEqual([]);
  });

  /*
   * Each row is keyed by its key's id (the project's by "project") and its
   * signal: a key with no id, or a second entry for a signal or a key,
   * would be a second row under the same key, which React draws over the
   * first and complains about. The server never sends one; the card reads
   * the first of each and leaves a key with no id out.
   */
  test("a key with no id, or a signal or key sent twice, is drawn once and never over another row", async () => {
    const consoleErrors: ConsoleErrorSpy = spyOnConsoleErrors();
    const sent: TelemetryIngestionBudgetStatus = JSON.parse(
      JSON.stringify(BUSY_DAY),
    ) as TelemetryIngestionBudgetStatus;
    const edge: Record<string, unknown> = {
      ...sent.ingestionKeys[0],
    };

    drawOverPage(
      answeringAnything({
        ...sent,
        project: {
          ...sent.project,
          signals: [
            ...sent.project.signals,
            { ...sent.project.signals[0], usedBytes: 0, percentUsed: 0 },
          ],
        },
        ingestionKeys: [
          { ...edge, ingestionKeyId: undefined, ingestionKeyName: "No id" },
          edge,
          { ...edge, ingestionKeyName: "Edge collector, again" },
        ],
      }),
    );

    expect(
      await screen.findAllByTestId(
        `telemetry-ingestion-budget-row-project-${LOGS}`,
      ),
    ).toHaveLength(1);
    // The first Logs entry is the one drawn: used up, not the copy at 0.
    expect(
      screen.getByTestId(`telemetry-ingestion-budget-row-project-${LOGS}`),
    ).toHaveTextContent("Used up");
    expect(
      screen.getAllByTestId(`telemetry-ingestion-budget-row-${KEY_ID}-${LOGS}`),
    ).toHaveLength(1);
    expect(
      screen.getByTestId(`telemetry-ingestion-budget-row-${KEY_ID}-${LOGS}`),
    ).toHaveTextContent("Edge collector");
    expect(screen.queryByText("No id")).toBeNull();
    expect(screen.queryByText("Edge collector, again")).toBeNull();
    expect(errorsLogged(consoleErrors)).toEqual([]);
  });

  test("answers drawn at random: the page under the card is never taken down", async () => {
    const consoleErrors: ConsoleErrorSpy = spyOnConsoleErrors();
    const answers: Array<unknown> = hostileAnswers({
      from: JSON.parse(JSON.stringify(BUSY_DAY)) as unknown,
      seed: 6486,
      count: 600,
    });
    // As many that are no status as that still are one, drawn the same way.
    const unreadable: Array<unknown> = answers
      .filter((answer: unknown): boolean => {
        return readTelemetryIngestionBudgetStatus(answer) === null;
      })
      .slice(0, 12);
    const readable: Array<unknown> = answers
      .filter((answer: unknown): boolean => {
        return readTelemetryIngestionBudgetStatus(answer) !== null;
      })
      .slice(0, 12);

    expect([unreadable.length, readable.length]).toEqual([12, 12]);

    for (const answer of [...unreadable, ...readable]) {
      drawOverPage(answeringAnything(answer));

      await waitFor(() => {
        expect(screen.queryByTestId("component-loader")).toBeNull();
      });

      expect(screen.getByTestId(PAGE_TEST_ID)).toBeInTheDocument();
      // The failed read's words exactly when the answer is no status.
      expect(Boolean(screen.queryByText(UNREADABLE))).toBe(
        unreadable.includes(answer),
      );

      cleanup();
    }

    expect(errorsLogged(consoleErrors)).toEqual([]);
  });
});
