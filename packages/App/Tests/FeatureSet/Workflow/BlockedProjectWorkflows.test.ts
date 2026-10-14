import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import Queue from "Common/Server/Infrastructure/Queue";
import ProjectService from "Common/Server/Services/ProjectService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import logger from "Common/Server/Utils/Logger";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import ProjectBlockedException from "Common/Types/Exception/ProjectBlockedException";
import ObjectID from "Common/Types/ObjectID";
import { WORKFLOW_ARCHIVED_BEFORE_RUN_MESSAGE } from "Common/Types/Workflow/WorkflowArchive";
import { WORKFLOW_PROJECT_BLOCKED_BEFORE_RUN_MESSAGE } from "Common/Types/Workflow/WorkflowProjectBlocked";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import RunWorkflow from "../../../FeatureSet/Workflow/Services/RunWorkflow";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A project a master admin blocked (Admin Dashboard > Projects) runs no
 * workflow until it is unblocked.
 *
 * QueueWorkflow.addWorkflowToQueue - where every run is asked for - refuses
 * a run asked for now with a 403 a webhook sender is told, and writes
 * nothing for it. Registering a schedule is let through, so the schedule
 * fires again after an unblock. The runner stops what got past the queue
 * before the block: a queued run is closed with a line saying why, a
 * schedule's firing is skipped (its schedule kept), and a run waking from a
 * Sleep step is cancelled.
 */

const WORKFLOW_ID: ObjectID = new ObjectID(
  "b8000000-0000-4000-8000-000000000001",
);
const WORKFLOW_LOG_ID: ObjectID = new ObjectID(
  "b8000000-0000-4000-8000-000000000002",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "b8000000-0000-4000-8000-0000000000b1",
);

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

function workflowRow(values: { isArchived?: boolean } = {}): Workflow {
  const workflow: Workflow = new Workflow();
  workflow._id = WORKFLOW_ID.toString();
  workflow.id = WORKFLOW_ID;
  workflow.projectId = PROJECT_ID;
  workflow.isEnabled = true;
  workflow.isArchived = Boolean(values.isArchived);
  workflow.graph = { nodes: [], edges: [] };
  return workflow;
}

/*
 * The surface of the isProjectBlocked spy this suite reads: the
 * @jest/globals and @types/jest spy types disagree in this repo.
 */
interface ProjectBlockedSpy {
  mock: { calls: Array<Array<unknown>> };
  mockResolvedValue: (value: boolean) => unknown;
}

let isProjectBlocked: ProjectBlockedSpy;

beforeEach(() => {
  isProjectBlocked = jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockResolvedValue(true) as unknown as ProjectBlockedSpy;
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("QueueWorkflow in a blocked project", () => {
  let createLog: RecordedSpy;
  let addJob: RecordedSpy;
  let currentPlan: RecordedSpy;

  beforeEach(() => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(workflowRow() as never);
    createLog = jest
      .spyOn(WorkflowLogService as never, "create")
      .mockResolvedValue(new WorkflowLog() as never) as unknown as RecordedSpy;
    addJob = jest
      .spyOn(Queue as never, "addJob")
      .mockResolvedValue({} as never) as unknown as RecordedSpy;
    currentPlan = jest
      .spyOn(ProjectService as never, "getCurrentPlan")
      .mockResolvedValue({
        plan: null,
        isSubscriptionUnpaid: false,
      } as never) as unknown as RecordedSpy;
  });

  test("refuses a run asked for now with a 403, and writes nothing for it", async () => {
    const run: Promise<void> = QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
    });

    await expect(run).rejects.toBeInstanceOf(ProjectBlockedException);
    await expect(run).rejects.toThrow(ExceptionMessages.ProjectBlocked);

    expect(String(isProjectBlocked.mock.calls[0]![0])).toBe(
      PROJECT_ID.toString(),
    );
    // A webhook hammered by a blocked project's sender grows no table.
    expect(createLog.mock.calls).toHaveLength(0);
    expect(currentPlan.mock.calls).toHaveLength(0);
    expect(addJob.mock.calls).toHaveLength(0);
  });

  test("refuses a person's test run too", async () => {
    await expect(
      QueueWorkflow.addWorkflowToQueue({
        workflowId: WORKFLOW_ID,
        returnValues: {},
        startedByUserId: new ObjectID("b8000000-0000-4000-8000-000000000009"),
      }),
    ).rejects.toBeInstanceOf(ProjectBlockedException);

    expect(addJob.mock.calls).toHaveLength(0);
  });

  test("lets a schedule be registered, so it fires again once unblocked", async () => {
    // The schedule's own reads: its variables, and the check after the job is added.
    jest
      .spyOn(QueueWorkflow as never, "resolveScheduleCron")
      .mockResolvedValue({ cron: "*/5 * * * *", error: null } as never);
    jest
      .spyOn(QueueWorkflow as never, "reconcileSchedule")
      .mockResolvedValue(undefined as never);

    await QueueWorkflow.addWorkflowToQueue(
      { workflowId: WORKFLOW_ID, returnValues: {} },
      "*/5 * * * *",
    );

    expect(isProjectBlocked.mock.calls).toHaveLength(0);
    expect(addJob.mock.calls).toHaveLength(1);
  });

  test("a project that is not blocked queues the run as before", async () => {
    isProjectBlocked.mockResolvedValue(false);

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
    });

    expect(createLog.mock.calls).toHaveLength(1);
    expect(addJob.mock.calls).toHaveLength(1);
  });
});

describe("the runner, for a run that got past the queue before the block", () => {
  let updateLog: RecordedSpy;
  let createLog: RecordedSpy;
  let removeWorkflow: RecordedSpy;

  beforeEach(() => {
    updateLog = jest
      .spyOn(WorkflowLogService as never, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never) as unknown as RecordedSpy;
    createLog = jest
      .spyOn(WorkflowLogService as never, "create")
      .mockResolvedValue(new WorkflowLog() as never) as unknown as RecordedSpy;
    removeWorkflow = jest
      .spyOn(QueueWorkflow, "removeWorkflow")
      .mockResolvedValue(undefined) as unknown as RecordedSpy;
  });

  function lastLogUpdate(): Record<string, unknown> {
    const call: unknown = updateLog.mock.calls[updateLog.mock.calls.length - 1];
    return ((call as Array<unknown>)[0] as { data: Record<string, unknown> })
      .data;
  }

  test("a queued run is closed as an error that says why, keeping its log", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(workflowRow() as never);
    const existing: WorkflowLog = new WorkflowLog();
    existing.logs = "10:00:00: Workflow scheduled.";
    jest
      .spyOn(WorkflowLogService as never, "findOneById")
      .mockResolvedValue(existing as never);

    const runner: RunWorkflow = new RunWorkflow();
    const makeRunStack: RecordedSpy = jest.spyOn(
      runner,
      "makeRunStack",
    ) as unknown as RecordedSpy;

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5_000,
    });

    const data: Record<string, unknown> = lastLogUpdate();

    expect(data["workflowStatus"]).toBe(WorkflowStatus.Error);
    expect(String(data["logs"])).toContain("10:00:00: Workflow scheduled.");
    expect(String(data["logs"])).toContain(
      WORKFLOW_PROJECT_BLOCKED_BEFORE_RUN_MESSAGE,
    );
    expect(data["completedAt"]).toBeInstanceOf(Date);
    // Not woken again if it was asleep in a Sleep step.
    expect(data["resumeData"]).toBeNull();
    expect(data["resumeAt"]).toBeNull();
    expect(makeRunStack.mock.calls).toHaveLength(0);
  });

  test("a run waking from a Sleep step is cancelled", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(workflowRow() as never);
    const sleeping: WorkflowLog = new WorkflowLog();
    sleeping.logs = "10:00:00: Sleeping for 1 hour.";
    sleeping.resumeData = {
      pendingStack: [],
      executedComponents: [],
      componentReturnValues: {},
    };
    jest
      .spyOn(WorkflowLogService as never, "findOneById")
      .mockResolvedValue(sleeping as never);

    const runner: RunWorkflow = new RunWorkflow();

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5_000,
      isResume: true,
    });

    const data: Record<string, unknown> = lastLogUpdate();

    expect(data["workflowStatus"]).toBe(WorkflowStatus.Error);
    expect(String(data["logs"])).toContain(
      WORKFLOW_PROJECT_BLOCKED_BEFORE_RUN_MESSAGE,
    );
  });

  test("a schedule's firing writes nothing and keeps the schedule", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(workflowRow() as never);

    const runner: RunWorkflow = new RunWorkflow();

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: null,
      timeout: 5_000,
    });

    expect(createLog.mock.calls).toHaveLength(0);
    expect(updateLog.mock.calls).toHaveLength(0);
    expect(removeWorkflow.mock.calls).toHaveLength(0);
  });

  test("an archived workflow keeps its own answer, asked first", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(workflowRow({ isArchived: true }) as never);
    jest
      .spyOn(WorkflowLogService as never, "findOneById")
      .mockResolvedValue(new WorkflowLog() as never);

    const runner: RunWorkflow = new RunWorkflow();

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5_000,
    });

    expect(String(lastLogUpdate()["logs"])).toContain(
      WORKFLOW_ARCHIVED_BEFORE_RUN_MESSAGE,
    );
    expect(isProjectBlocked.mock.calls).toHaveLength(0);
  });
});
