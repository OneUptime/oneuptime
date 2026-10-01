import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import Queue from "Common/Server/Infrastructure/Queue";
import ProjectService from "Common/Server/Services/ProjectService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import {
  WORKFLOW_ARCHIVED_BEFORE_RUN_MESSAGE,
  WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE,
  WORKFLOW_ARCHIVED_WHILE_WAITING_MESSAGE,
} from "Common/Types/Workflow/WorkflowArchive";
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
 * An archived workflow never runs, from any trigger.
 *
 * QueueWorkflow.addWorkflowToQueue is where every run is asked for - the Run
 * button, "Run this step", a webhook call, a model event, an incoming email,
 * another workflow's Run Workflow step, a schedule being registered - so it
 * refuses an archived workflow before it writes a log, checks the plan or
 * touches BullMQ. The runner then catches what was already queued when the
 * workflow was archived: a queued run is closed with a line saying why, a
 * scheduled firing is dropped and its schedule removed, and a run sleeping in
 * a Sleep step is cancelled when it wakes.
 */

const WORKFLOW_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000001",
);
const WORKFLOW_LOG_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000002",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000003",
);

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

function workflowRow(values: {
  isEnabled: boolean;
  isArchived?: boolean;
}): Workflow {
  const workflow: Workflow = new Workflow();
  workflow._id = WORKFLOW_ID.toString();
  workflow.id = WORKFLOW_ID;
  workflow.projectId = PROJECT_ID;
  workflow.isEnabled = values.isEnabled;

  if (values.isArchived !== undefined) {
    workflow.isArchived = values.isArchived;
  }

  workflow.graph = { nodes: [], edges: [] };
  return workflow;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("QueueWorkflow refuses to start a run of an archived workflow", () => {
  let findOneById: RecordedSpy;
  let createLog: RecordedSpy;
  let addJob: RecordedSpy;
  let currentPlan: RecordedSpy;

  function prepare(row: Workflow | null): void {
    findOneById = jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(row as never) as unknown as RecordedSpy;
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
  }

  test("an archived workflow is refused, with the reason a person can act on", async () => {
    prepare(workflowRow({ isEnabled: true, isArchived: true }));

    await expect(
      QueueWorkflow.addWorkflowToQueue({
        workflowId: WORKFLOW_ID,
        returnValues: {},
      }),
    ).rejects.toThrow(
      new BadDataException(WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE),
    );

    // Refused before anything else: no run log, no plan check, no job.
    expect(createLog.mock.calls).toHaveLength(0);
    expect(currentPlan.mock.calls).toHaveLength(0);
    expect(addJob.mock.calls).toHaveLength(0);
  });

  test("the lookup reads the archive flag", async () => {
    prepare(workflowRow({ isEnabled: true, isArchived: true }));

    await expect(
      QueueWorkflow.addWorkflowToQueue({
        workflowId: WORKFLOW_ID,
        returnValues: {},
      }),
    ).rejects.toThrow();

    const select: Record<string, unknown> = (
      findOneById.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["isArchived"]).toBe(true);
    expect(select["isEnabled"]).toBe(true);
  });

  test("archived is the reason given even when the workflow is also off", async () => {
    prepare(workflowRow({ isEnabled: false, isArchived: true }));

    await expect(
      QueueWorkflow.addWorkflowToQueue({
        workflowId: WORKFLOW_ID,
        returnValues: {},
      }),
    ).rejects.toThrow(WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE);
  });

  test("a scheduled registration is refused too, so no repeating job is created", async () => {
    prepare(workflowRow({ isEnabled: true, isArchived: true }));

    await expect(
      QueueWorkflow.addWorkflowToQueue(
        { workflowId: WORKFLOW_ID, returnValues: {} },
        "*/5 * * * *",
      ),
    ).rejects.toThrow(WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE);

    expect(addJob.mock.calls).toHaveLength(0);
  });

  test("a live workflow that is off still gets the old answer", async () => {
    prepare(workflowRow({ isEnabled: false, isArchived: false }));

    await expect(
      QueueWorkflow.addWorkflowToQueue({
        workflowId: WORKFLOW_ID,
        returnValues: {},
      }),
    ).rejects.toThrow("This workflow is not enabled");
  });

  test("an unarchived, enabled workflow is queued again", async () => {
    prepare(workflowRow({ isEnabled: true, isArchived: false }));

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
    });

    expect(createLog.mock.calls).toHaveLength(1);
    expect(addJob.mock.calls).toHaveLength(1);
  });

  test("the message says how to run it again", () => {
    expect(WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE).toMatch(/archived/);
    expect(WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE).toMatch(/Unarchive it/);
  });
});

describe("the runner stops a run of an archived workflow that was already queued", () => {
  let updateLog: RecordedSpy;
  let createLog: RecordedSpy;
  let removeWorkflow: RecordedSpy;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });

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

  test("a queued run is closed as an error that says it never ran, keeping what its log already said", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(
        workflowRow({ isEnabled: true, isArchived: true }) as never,
      );

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
      WORKFLOW_ARCHIVED_BEFORE_RUN_MESSAGE,
    );
    expect(data["completedAt"]).toBeInstanceOf(Date);

    // Not one step ran.
    expect(makeRunStack.mock.calls).toHaveLength(0);
    // It is not "Running" at any point.
    for (const call of updateLog.mock.calls) {
      expect(
        (call[0] as { data: Record<string, unknown> }).data["workflowStatus"],
      ).not.toBe(WorkflowStatus.Running);
    }
  });

  test("a scheduled firing writes no run and takes the schedule down", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(
        workflowRow({ isEnabled: true, isArchived: true }) as never,
      );

    const runner: RunWorkflow = new RunWorkflow();

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: null,
      timeout: 5_000,
    });

    expect(createLog.mock.calls).toHaveLength(0);
    expect(updateLog.mock.calls).toHaveLength(0);
    expect(removeWorkflow.mock.calls).toHaveLength(1);
    expect(String(removeWorkflow.mock.calls[0]![0])).toBe(
      WORKFLOW_ID.toString(),
    );
  });

  test("a schedule that cannot be taken down is logged, not thrown", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(
        workflowRow({ isEnabled: true, isArchived: true }) as never,
      );
    (
      removeWorkflow as unknown as { mockRejectedValue: (e: Error) => void }
    ).mockRejectedValue(new Error("queue down"));

    const runner: RunWorkflow = new RunWorkflow();

    await expect(
      runner.runWorkflow({
        arguments: {},
        workflowId: WORKFLOW_ID,
        workflowLogId: null,
        timeout: 5_000,
      }),
    ).resolves.toBeUndefined();
    expect(createLog.mock.calls).toHaveLength(0);
  });

  test("a run sleeping when the workflow was archived is cancelled when it wakes", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(
        workflowRow({ isEnabled: true, isArchived: true }) as never,
      );

    const sleeping: WorkflowLog = new WorkflowLog();
    sleeping.logs = "10:00:00: Sleeping for 5 minutes.";
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
    expect(String(data["logs"])).toContain("Sleeping for 5 minutes.");
    expect(String(data["logs"])).toContain(
      WORKFLOW_ARCHIVED_WHILE_WAITING_MESSAGE,
    );
    expect(data["resumeData"]).toBeNull();
    expect(data["resumeAt"]).toBeNull();
  });

  test("the runner reads the archive flag", async () => {
    const findOneById: RecordedSpy = jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(
        workflowRow({ isEnabled: true, isArchived: true }) as never,
      ) as unknown as RecordedSpy;

    await new RunWorkflow().runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: null,
      timeout: 5_000,
    });

    expect(
      (findOneById.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select["isArchived"],
    ).toBe(true);
  });

  test("a live workflow is not stopped: the runner goes on to build its steps", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(
        workflowRow({ isEnabled: true, isArchived: false }) as never,
      );

    const runner: RunWorkflow = new RunWorkflow();
    const makeRunStack: RecordedSpy = jest
      .spyOn(runner, "makeRunStack")
      .mockRejectedValue(
        new Error("stop here") as never,
      ) as unknown as RecordedSpy;

    await runner
      .runWorkflow({
        arguments: {},
        workflowId: WORKFLOW_ID,
        workflowLogId: WORKFLOW_LOG_ID,
        timeout: 5_000,
      })
      .catch(() => {
        // The run itself is not what this test is about.
      });

    expect(makeRunStack.mock.calls).toHaveLength(1);
    expect(removeWorkflow.mock.calls).toHaveLength(0);
  });
});
