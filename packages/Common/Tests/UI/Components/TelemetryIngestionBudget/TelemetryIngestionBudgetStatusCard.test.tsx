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
  TelemetryIngestionBudgetLimitSource,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";
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
 * Today's ingestion budgets (issue #5917), as Project Settings > Telemetry &
 * APM > Usage, an ingestion key's page and the Admin Dashboard's project
 * page draw them: a row for each signal with a budget or a rate, what was
 * counted and refused today, where each limit was set, and its state.
 */

type FetchStatus = jest.Mock<() => Promise<TelemetryIngestionBudgetStatus>>;

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
