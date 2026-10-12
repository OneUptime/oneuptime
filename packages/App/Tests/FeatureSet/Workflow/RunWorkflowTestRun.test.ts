import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import WorkflowVariableService from "Common/Server/Services/WorkflowVariableService";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import { getWorkflowTestRunLogLine } from "Common/Types/Workflow/WorkflowEnabled";
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
 * A test run, as the runner runs it.
 *
 * "Why do I have to enable a workflow in order to test run it?" - a person
 * may now run a workflow from its Builder while it is turned off, as a test
 * run (QueueWorkflow). The runner:
 *
 *   - opens the run's log with the line that says it is a test run and who
 *     started it. The queued row says so too, but the runner's log replaces
 *     the row's when it is saved, so the runner says it again, first;
 *   - lets a test run that sleeps on a Sleep step carry on when it wakes,
 *     although the workflow is still off - or a workflow with a Sleep step
 *     could never be tested - while a run its trigger started is cancelled,
 *     as before: turning a workflow off is how a live one is paused.
 */

const WORKFLOW_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000001",
);
const WORKFLOW_LOG_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000002",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000003",
);

const TEST_RUN_LINE: string = getWorkflowTestRunLogLine({
  startedBy: "Ada Lovelace",
});

const CANCELLED_WHILE_OFF: string =
  "Workflow was disabled while it was waiting. Cancelling the run.";

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

function workflowRow(values: { isEnabled: boolean }): Workflow {
  const workflow: Workflow = new Workflow();
  workflow._id = WORKFLOW_ID.toString();
  workflow.id = WORKFLOW_ID;
  workflow.projectId = PROJECT_ID;
  workflow.isEnabled = values.isEnabled;
  workflow.isArchived = false;
  // Nothing to run: the run stops with a reason, after its first line.
  workflow.graph = { nodes: [], edges: [] };
  return workflow;
}

let updateLog: RecordedSpy;

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  updateLog = jest
    .spyOn(WorkflowLogService as never, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never) as unknown as RecordedSpy;

  jest
    .spyOn(WorkflowLogService as never, "create")
    .mockResolvedValue(new WorkflowLog() as never);

  jest
    .spyOn(WorkflowVariableService as never, "findBy")
    .mockResolvedValue([] as never);

  jest
    .spyOn(QueueWorkflow, "removeWorkflow")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

type LastLogUpdateFunction = () => Record<string, unknown>;

const lastLogUpdate: LastLogUpdateFunction = (): Record<string, unknown> => {
  const call: unknown = updateLog.mock.calls[updateLog.mock.calls.length - 1];

  return ((call as Array<unknown>)[0] as { data: Record<string, unknown> })
    .data;
};

type SavedLinesFunction = () => Array<string>;

// The last log the runner saved, a line each, without the time stamp.
const savedLines: SavedLinesFunction = (): Array<string> => {
  return String(lastLogUpdate()["logs"] || "")
    .split("\n")
    .map((line: string): string => {
      return line.replace(/^.+?: /, "");
    });
};

describe("a fresh test run", () => {
  test("opens its log with the line that says it is a test run, and who started it", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(workflowRow({ isEnabled: false }) as never);

    await new RunWorkflow().runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5_000,
      isTestRun: true,
      testRunStartedBy: "Ada Lovelace",
    });

    const lines: Array<string> = savedLines();

    expect(lines[0]).toBe(TEST_RUN_LINE);
    expect(lines[0]).toBe(
      "Test run, started by Ada Lovelace while this workflow is turned off.",
    );
    // It is said once, and the run then went on as any run does.
    expect(
      lines.filter((line: string): boolean => {
        return line.startsWith("Test run");
      }),
    ).toHaveLength(1);
    expect(lastLogUpdate()["workflowStatus"]).toBe(WorkflowStatus.Error);
  });

  test("runs while the workflow is off: the switch is not read as a reason to stop", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(workflowRow({ isEnabled: false }) as never);

    const runner: RunWorkflow = new RunWorkflow();
    const makeRunStack: RecordedSpy = jest
      .spyOn(runner, "makeRunStack")
      .mockRejectedValue(
        new Error("stop here") as never,
      ) as unknown as RecordedSpy;

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5_000,
      isTestRun: true,
    });

    expect(makeRunStack.mock.calls).toHaveLength(1);
    // It was marked Running, as any run is.
    expect(
      updateLog.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          (call[0] as { data: Record<string, unknown> }).data[
            "workflowStatus"
          ] === WorkflowStatus.Running
        );
      }),
    ).toBe(true);
  });

  test("names nobody when it does not know who started it", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(workflowRow({ isEnabled: false }) as never);

    await new RunWorkflow().runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5_000,
      isTestRun: true,
    });

    expect(savedLines()[0]).toBe(
      "Test run, started by hand while this workflow is turned off.",
    );
  });

  test("a run that is no test run says nothing of the kind", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(workflowRow({ isEnabled: true }) as never);

    await new RunWorkflow().runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5_000,
    });

    expect(
      savedLines().filter((line: string): boolean => {
        return line.startsWith("Test run");
      }),
    ).toEqual([]);
  });
});

describe("a run that wakes from a Sleep step while the workflow is off", () => {
  type SleepingRunFunction = (isTestRun: boolean | undefined) => WorkflowLog;

  const sleepingRun: SleepingRunFunction = (
    isTestRun: boolean | undefined,
  ): WorkflowLog => {
    const sleeping: WorkflowLog = new WorkflowLog();
    sleeping.logs = isTestRun
      ? `10:00:00: ${TEST_RUN_LINE}\n10:00:01: Sleeping for 5 minutes.`
      : "10:00:01: Sleeping for 5 minutes.";
    sleeping.resumeData = {
      pendingStack: [],
      executedComponents: [],
      componentReturnValues: {},
    };

    if (isTestRun !== undefined) {
      sleeping.isTestRun = isTestRun;
    }

    return sleeping;
  };

  type ResumeFunction = (sleeping: WorkflowLog) => Promise<{
    makeRunStack: RecordedSpy;
    findLog: RecordedSpy;
  }>;

  const resume: ResumeFunction = async (
    sleeping: WorkflowLog,
  ): Promise<{ makeRunStack: RecordedSpy; findLog: RecordedSpy }> => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(workflowRow({ isEnabled: false }) as never);

    const findLog: RecordedSpy = jest
      .spyOn(WorkflowLogService as never, "findOneById")
      .mockResolvedValue(sleeping as never) as unknown as RecordedSpy;

    const runner: RunWorkflow = new RunWorkflow();
    const makeRunStack: RecordedSpy = jest
      .spyOn(runner, "makeRunStack")
      .mockRejectedValue(
        new Error("stop here") as never,
      ) as unknown as RecordedSpy;

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5_000,
      isResume: true,
    });

    return { makeRunStack, findLog };
  };

  test("a test run carries on: it is not cancelled for the switch it was started under", async () => {
    const { makeRunStack } = await resume(sleepingRun(true));

    expect(makeRunStack.mock.calls).toHaveLength(1);

    for (const call of updateLog.mock.calls) {
      expect(
        String(
          (call[0] as { data: Record<string, unknown> }).data["logs"] || "",
        ),
      ).not.toContain(CANCELLED_WHILE_OFF);
    }
  });

  test("a test run keeps the log it had, and is not said to be one twice", async () => {
    await resume(sleepingRun(true));

    expect(
      savedLines().filter((line: string): boolean => {
        return line === TEST_RUN_LINE;
      }),
    ).toHaveLength(1);
    expect(savedLines()).toContain("Sleeping for 5 minutes.");
  });

  test("a run its trigger started is cancelled, as before", async () => {
    const { makeRunStack } = await resume(sleepingRun(false));

    expect(makeRunStack.mock.calls).toHaveLength(0);

    const data: Record<string, unknown> = lastLogUpdate();

    expect(data["workflowStatus"]).toBe(WorkflowStatus.Error);
    expect(String(data["logs"])).toContain(CANCELLED_WHILE_OFF);
    expect(data["resumeData"]).toBeNull();
    expect(data["resumeAt"]).toBeNull();
  });

  test("a run recorded before test runs existed (no flag) is cancelled, as before", async () => {
    const { makeRunStack } = await resume(sleepingRun(undefined));

    expect(makeRunStack.mock.calls).toHaveLength(0);
    expect(String(lastLogUpdate()["logs"])).toContain(CANCELLED_WHILE_OFF);
  });

  test("the runner reads whether the sleeping run is a test run", async () => {
    const { findLog } = await resume(sleepingRun(true));

    expect(
      (findLog.mock.calls[0]![0] as { select: Record<string, unknown> }).select[
        "isTestRun"
      ],
    ).toBe(true);
  });
});
