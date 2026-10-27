import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import RunbookRunElapsed, {
  RUNBOOK_RUN_ELAPSED_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookRunElapsed";
import ExecutionView from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import RunbookExecutionStatus from "../../../Types/Runbook/RunbookExecutionStatus";
import { RunbookStepExecutionState } from "../../../Types/Runbook/RunbookStepExecution";
import RunbookStepExecutionStatus from "../../../Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * HOW LONG A RUN HAS BEEN GOING - its page's Elapsed tile
 * (Components/Runbook/RunbookRunElapsed).
 *
 * The tile said "Running..." for as long as a run had no end, a run waiting
 * for someone to approve a step included - where nothing runs. It now counts
 * up from the run's start, once a second, worded as every live duration in
 * the product is. A run that ended without an end time, or has not started,
 * shows a dash.
 */

const RUNBOOK_ID: string = "77777777-0000-4000-8000-0000000000d4";
const EXECUTION_ID: string = "88888888-0000-4000-8000-0000000000d4";

const WAIT: { timeout: number } = { timeout: 20000 };

const NOW: Date = new Date("2026-10-27T10:00:00.000Z");

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the elapsed time", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  test("counts from the run's start, worded as the product's live durations", () => {
    render(
      <RunbookRunElapsed
        startedAt={new Date(NOW.getTime() - (12 * 60 + 4) * 1000)}
        isFinished={false}
      />,
    );

    const elapsed: HTMLElement = screen.getByTestId(
      RUNBOOK_RUN_ELAPSED_TEST_ID,
    );

    expect(elapsed).toHaveTextContent("12 mins 4 secs");
    expect(elapsed.tagName).toBe("TIME");
    expect(elapsed).toHaveAttribute("dateTime", "PT724S");
  });

  test("keeps counting while the run waits, once a second", () => {
    render(
      <RunbookRunElapsed
        startedAt={new Date(NOW.getTime() - 59 * 1000)}
        isFinished={false}
      />,
    );

    expect(screen.getByTestId(RUNBOOK_RUN_ELAPSED_TEST_ID)).toHaveTextContent(
      "59 secs",
    );

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByTestId(RUNBOOK_RUN_ELAPSED_TEST_ID)).toHaveTextContent(
      "1 min 1 sec",
    );
  });

  test("is a timer a screen reader reads when it gets there, not every second", () => {
    render(
      <RunbookRunElapsed
        startedAt={new Date(NOW.getTime() - 5000)}
        isFinished={false}
      />,
    );

    const elapsed: HTMLElement = screen.getByRole("timer");

    expect(elapsed).toHaveAttribute("aria-live", "off");
    expect(elapsed).toHaveClass("tabular-nums");
  });

  test("a start sent as text counts the same", () => {
    render(
      <RunbookRunElapsed
        startedAt={new Date(NOW.getTime() - 90 * 1000).toISOString()}
        isFinished={false}
      />,
    );

    expect(screen.getByTestId(RUNBOOK_RUN_ELAPSED_TEST_ID)).toHaveTextContent(
      "1 min 30 secs",
    );
  });

  test("a run that has not started yet shows a dash", () => {
    render(<RunbookRunElapsed startedAt={undefined} isFinished={false} />);

    expect(screen.getByTestId(RUNBOOK_RUN_ELAPSED_TEST_ID)).toHaveTextContent(
      "—",
    );
    expect(screen.queryByRole("timer")).toBeNull();
  });

  test("a run that ended without an end time shows a dash, not a clock that never stops", () => {
    render(
      <RunbookRunElapsed
        startedAt={new Date(NOW.getTime() - 60 * 1000)}
        isFinished={true}
      />,
    );

    expect(screen.getByTestId(RUNBOOK_RUN_ELAPSED_TEST_ID)).toHaveTextContent(
      "—",
    );
    expect(screen.queryByRole("timer")).toBeNull();

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(screen.getByTestId(RUNBOOK_RUN_ELAPSED_TEST_ID)).toHaveTextContent(
      "—",
    );
  });

  test("a start a little ahead of this browser's clock reads as just started", () => {
    render(
      <RunbookRunElapsed
        startedAt={new Date(NOW.getTime() + 3000)}
        isFinished={false}
      />,
    );

    expect(screen.getByTestId(RUNBOOK_RUN_ELAPSED_TEST_ID)).toHaveTextContent(
      "0 secs",
    );
  });
});

describe("on a run's page", () => {
  let status: RunbookExecutionStatus =
    RunbookExecutionStatus.WaitingForManualStep;
  let completedAt: Date | undefined = undefined;

  const steps: () => Array<RunbookStepExecutionState> =
    (): Array<RunbookStepExecutionState> => {
      return [
        {
          step: {
            id: "promote",
            order: 0,
            type: RunbookStepType.Kubernetes,
            title: "Promote the replica",
            config: {} as never,
            requireApprovalBeforeRunning: true,
          },
          status: RunbookStepExecutionStatus.WaitingForUser,
        },
      ];
    };

  beforeEach(() => {
    goTo(
      `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/executions/${EXECUTION_ID}`,
    );
    status = RunbookExecutionStatus.WaitingForManualStep;
    completedAt = undefined;

    jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
      return Object.assign(new RunbookExecution(), {
        _id: EXECUTION_ID,
        runbookId: RUNBOOK_ID,
        runbookNameSnapshot: "Database failover",
        status,
        stepExecutions: steps(),
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        ...(completedAt ? { completedAt } : {}),
      });
    }) as never);

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (): Promise<
      ListResult<never>
    > => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    }) as never);
  });

  const renderPage: () => void = (): void => {
    render(
      <MemoryRouter
        initialEntries={[
          `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/executions/${EXECUTION_ID}`,
        ]}
      >
        <ExecutionView
          pageRoute={undefined as never}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  };

  test("a run waiting for an approval says how long it has been going, never Running...", async () => {
    renderPage();

    const elapsed: HTMLElement = await screen.findByTestId(
      RUNBOOK_RUN_ELAPSED_TEST_ID,
      {},
      WAIT,
    );

    expect(elapsed).toHaveTextContent(/^10 mins/);
    expect(screen.getByText("Elapsed")).toBeInTheDocument();
    expect(screen.queryByText("Running...")).toBeNull();
  });

  test("a finished run says when it completed, as before", async () => {
    status = RunbookExecutionStatus.Completed;
    completedAt = new Date("2026-10-20T09:05:00.000Z");

    renderPage();

    // The tile's label, beside the status pill that says the same word.
    await waitFor(() => {
      expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(2);
    }, WAIT);
    expect(screen.queryByText("Elapsed")).toBeNull();
    expect(screen.queryByTestId(RUNBOOK_RUN_ELAPSED_TEST_ID)).toBeNull();
  });

  test("a cancelled run with no end time shows a dash", async () => {
    status = RunbookExecutionStatus.Cancelled;

    renderPage();

    const elapsed: HTMLElement = await screen.findByTestId(
      RUNBOOK_RUN_ELAPSED_TEST_ID,
      {},
      WAIT,
    );

    expect(elapsed).toHaveTextContent("—");
  });
});
