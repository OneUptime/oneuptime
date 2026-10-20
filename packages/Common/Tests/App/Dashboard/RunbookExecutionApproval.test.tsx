import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import ExecutionView from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import User from "../../../Models/DatabaseModels/User";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import RunbookExecutionStatus from "../../../Types/Runbook/RunbookExecutionStatus";
import { RunbookStepExecutionState } from "../../../Types/Runbook/RunbookStepExecution";
import RunbookStepExecutionStatus from "../../../Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A RUN'S EXECUTION PAGE, WAITING FOR A PERSON - the real page, only the
 * model API stubbed.
 *
 * A step that asks for approval before it runs: the page names it ("Waiting
 * for approval to run ..."), its pill says "Waiting for approval", a line
 * says it runs once someone approves it, and "Approve and run" (with Skip)
 * moves the run on. A Manual step: "Waiting for you" and "Mark complete". A
 * step of a run started before approvals moved, which ran and waits:
 * "Approve & continue". Once a step was approved and ran, it says who
 * approved it.
 */

const RUNBOOK_ID: string = "77777777-0000-4000-8000-0000000000c3";
const EXECUTION_ID: string = "88888888-0000-4000-8000-0000000000c3";
const APPROVER_ID: string = "99999999-0000-4000-8000-0000000000c3";

const WAIT: { timeout: number } = { timeout: 20000 };

const PATH: string = `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/executions/${EXECUTION_ID}`;

let stepExecutions: Array<RunbookStepExecutionState> = [];
let status: RunbookExecutionStatus =
  RunbookExecutionStatus.WaitingForManualStep;
let posted: Array<string> = [];

function done(
  id: string,
  type: RunbookStepType,
  title: string,
): RunbookStepExecutionState {
  return {
    step: { id, order: 0, type, title, config: {} as never },
    status: RunbookStepExecutionStatus.Completed,
    startedAt: "2026-10-20T09:00:00.000Z",
    completedAt: "2026-10-20T09:00:05.000Z",
    output: "ok",
  };
}

function pending(
  id: string,
  type: RunbookStepType,
  title: string,
): RunbookStepExecutionState {
  return {
    step: { id, order: 0, type, title, config: {} as never },
    status: RunbookStepExecutionStatus.Pending,
  };
}

function waitingToRun(): Array<RunbookStepExecutionState> {
  return [
    done("diagnose", RunbookStepType.Bash, "Capture state"),
    {
      step: {
        id: "promote",
        order: 1,
        type: RunbookStepType.Kubernetes,
        title: "Promote the replica",
        config: {} as never,
        requireApprovalBeforeRunning: true,
      },
      status: RunbookStepExecutionStatus.WaitingForUser,
    },
    pending("notify", RunbookStepType.HttpRequest, "Post the all-clear"),
  ];
}

beforeEach(() => {
  goTo(PATH);

  stepExecutions = waitingToRun();
  status = RunbookExecutionStatus.WaitingForManualStep;
  posted = [];

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return Object.assign(new RunbookExecution(), {
      _id: EXECUTION_ID,
      runbookId: RUNBOOK_ID,
      runbookNameSnapshot: "Database failover",
      status,
      stepExecutions: JSON.parse(JSON.stringify(stepExecutions)),
      startedAt: new Date("2026-10-20T09:00:00.000Z"),
    });
  }) as never);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (): Promise<
    ListResult<never>
  > => {
    const approver: User = Object.assign(new User(), {
      _id: APPROVER_ID,
      name: new Name("Ada Lovelace"),
      email: new Email("ada@acme.example.com"),
    });

    return {
      data: [approver] as Array<never>,
      count: 1,
      skip: 0,
      limit: 10,
    };
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (args: {
    url: { toString: () => string };
  }) => {
    posted.push(args.url.toString());
    return new HTTPResponse(200, { status: "ok" }, {});
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderRun(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter initialEntries={[PATH]}>
        <Routes>
          <PageRoute
            path="/dashboard/:projectId/runbooks/:id/executions/:subModelId"
            element={
              <ExecutionView
                pageRoute={RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route}
                currentProject={null}
                hasPaymentMethod={true}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  });

  await screen.findByText("Database failover", {}, WAIT);
}

// The card of the step titled `title`.
function stepCard(title: string): HTMLElement {
  const heading: HTMLElement = screen.getByRole("heading", { name: title });

  return heading.closest("li") as HTMLElement;
}

describe("a run waiting for approval before a step", () => {
  test("names the step it waits to run, says why, and offers Approve and run and Skip on it", async () => {
    await renderRun();

    expect(
      screen.getByText('Waiting for approval to run "Promote the replica".'),
    ).toBeInTheDocument();

    const card: HTMLElement = stepCard("Promote the replica");

    expect(within(card).getByText("Waiting for approval")).toBeInTheDocument();
    expect(
      within(card).getByText("This step runs once someone approves it."),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Approve and run" }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Skip" }),
    ).toBeInTheDocument();

    // The old words are not used for it.
    expect(
      screen.queryByRole("button", { name: "Approve & continue" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark complete" })).toBeNull();
  });

  test("only the step it waits on can be approved; a later plain step can only be skipped", async () => {
    await renderRun();

    expect(
      screen.getAllByRole("button", { name: "Approve and run" }),
    ).toHaveLength(1);

    const later: HTMLElement = stepCard("Post the all-clear");

    expect(
      within(later).queryByRole("button", { name: "Approve and run" }),
    ).toBeNull();
    expect(
      within(later).getByRole("button", { name: "Skip" }),
    ).toBeInTheDocument();
    expect(
      within(later).queryByText("This step runs once someone approves it."),
    ).toBeNull();
  });

  test("Approve and run approves the step it waits on", async () => {
    await renderRun();

    fireEvent.click(
      within(stepCard("Promote the replica")).getByRole("button", {
        name: "Approve and run",
      }),
    );

    await waitFor(() => {
      expect(posted).toHaveLength(1);
    }, WAIT);

    expect(
      new URL(posted[0]!).pathname.endsWith(
        `/execution/${EXECUTION_ID}/step/promote/complete`,
      ),
    ).toBe(true);
  });

  test("Skip skips it, so it never runs", async () => {
    await renderRun();

    fireEvent.click(
      within(stepCard("Promote the replica")).getByRole("button", {
        name: "Skip",
      }),
    );

    await waitFor(() => {
      expect(posted).toHaveLength(1);
    }, WAIT);

    expect(
      new URL(posted[0]!).pathname.endsWith(
        `/execution/${EXECUTION_ID}/step/promote/skip`,
      ),
    ).toBe(true);
  });
});

describe("a run waiting on a Manual step", () => {
  test("names it, says to tick it off, and offers Mark complete", async () => {
    stepExecutions = [
      done("diagnose", RunbookStepType.Bash, "Capture state"),
      {
        step: {
          id: "check",
          order: 1,
          type: RunbookStepType.Manual,
          title: "Check the dashboards",
          config: {} as never,
        },
        status: RunbookStepExecutionStatus.WaitingForUser,
        startedAt: "2026-10-20T09:01:00.000Z",
      },
    ];

    await renderRun();

    expect(
      screen.getByText(
        'Waiting on "Check the dashboards". Tick it off below to continue.',
      ),
    ).toBeInTheDocument();

    const card: HTMLElement = stepCard("Check the dashboards");

    expect(within(card).getByText("Waiting for you")).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Mark complete" }),
    ).toBeInTheDocument();
    expect(
      within(card).queryByText("This step runs once someone approves it."),
    ).toBeNull();
  });
});

describe("a run started before approvals moved, waiting after a step that ran", () => {
  test("says it waits to continue after that step, and offers Approve & continue", async () => {
    stepExecutions = [
      {
        ...done("page", RunbookStepType.HttpRequest, "Page the team"),
        step: {
          id: "page",
          order: 0,
          type: RunbookStepType.HttpRequest,
          title: "Page the team",
          config: {} as never,
          requireApproval: true,
        },
        status: RunbookStepExecutionStatus.WaitingForUser,
      },
      pending("restart", RunbookStepType.Bash, "Restart the web tier"),
    ];

    await renderRun();

    expect(
      screen.getByText(
        'Waiting for approval to continue after "Page the team".',
      ),
    ).toBeInTheDocument();

    const card: HTMLElement = stepCard("Page the team");

    expect(within(card).getByText("Waiting for approval")).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Approve & continue" }),
    ).toBeInTheDocument();
    // It ran: its output is there to read before approving.
    expect(within(card).getByText("Show output / logs")).toBeInTheDocument();
  });
});

describe("a run whose approved step ran", () => {
  test("says who approved it", async () => {
    status = RunbookExecutionStatus.Completed;
    stepExecutions = [
      {
        ...done("promote", RunbookStepType.Kubernetes, "Promote the replica"),
        step: {
          id: "promote",
          order: 0,
          type: RunbookStepType.Kubernetes,
          title: "Promote the replica",
          config: {} as never,
          requireApprovalBeforeRunning: true,
        },
        approvedAt: "2026-10-20T08:59:00.000Z",
        approvedByUserId: APPROVER_ID,
      },
    ];

    await renderRun();

    const approvedBy: HTMLElement = await screen.findByTestId(
      "runbook-execution-step-0-approved-by",
      {},
      WAIT,
    );

    expect(approvedBy).toHaveTextContent("Approved by");
    await waitFor(() => {
      expect(approvedBy).toHaveTextContent("Ada Lovelace");
    }, WAIT);

    // Nothing is waiting: no button moves the run on.
    expect(
      screen.queryByRole("button", { name: "Approve and run" }),
    ).toBeNull();
  });
});
