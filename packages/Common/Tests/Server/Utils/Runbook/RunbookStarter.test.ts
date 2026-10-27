import ProjectService from "../../../../Server/Services/ProjectService";
import RunbookExecutionService from "../../../../Server/Services/RunbookExecutionService";
import RunbookRuleEngineService from "../../../../Server/Services/RunbookRuleEngineService";
import RunbookService from "../../../../Server/Services/RunbookService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../../Server/Utils/Logger";
import RunbookStarter, {
  RUNBOOK_RUN_NOT_QUEUED_REASON,
  RunbookStartRefusal,
  RunbookStartResult,
  RunbookStarterClass,
} from "../../../../Server/Utils/Runbook/RunbookStarter";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import ObjectID from "../../../../Types/ObjectID";
import RunbookExecutionStatus from "../../../../Types/Runbook/RunbookExecutionStatus";
import { RunbookStepExecutionState } from "../../../../Types/Runbook/RunbookStepExecution";
import RunbookStepExecutionStatus from "../../../../Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import RunbookTriggerType, {
  RUNBOOK_TRIGGER_TYPES,
  UNATTENDED_RUNBOOK_TRIGGER_TYPES,
  isRunbookTriggerType,
} from "../../../../Types/Runbook/RunbookTriggerType";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../TestingUtils/InMemoryRepository";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE ONE WAY A RUN STARTS, against in-memory tables: what it refuses,
 * what it writes - the steps snapshotted, what started the run, who, for
 * which record, with which inputs - and that it queues the run, or fails
 * it with the reason when it cannot. The rule engine, auto-remediation and
 * OneUptime AI reach it through RunbookRuleEngineService.startRunbookFor.
 */

const PROJECT_ID: string = "1f6e8b6a-3c1e-4b1e-9b1e-0000000000a1";
const OTHER_PROJECT_ID: string = "1f6e8b6a-3c1e-4b1e-9b1e-0000000000a2";
const RUNBOOK_ID: string = "2a7f9c7b-4d2f-4c2f-8c2f-0000000000b1";
const USER_ID: string = "5d0c2f0e-7a5c-4f5c-9f5c-0000000000c1";
const INCIDENT_ID: string = "6e1d3a1f-8b6d-4a6d-8a6d-0000000000d1";

let runbooks: InMemoryTable;
let executions: InMemoryTable;
let enqueued: Array<string>;
let isBlocked: boolean;

function runbookRow(overrides: StoredRow = {}): StoredRow {
  return {
    _id: RUNBOOK_ID,
    projectId: PROJECT_ID,
    name: "Restart the web tier",
    slug: "restart-the-web-tier",
    isEnabled: true,
    steps: [
      {
        id: "second",
        order: 2,
        type: RunbookStepType.Bash,
        title: "Restart",
        config: { script: "systemctl restart web", agentId: "" },
      },
      {
        id: "first",
        order: 1,
        type: RunbookStepType.Manual,
        title: "Check the dashboards",
        config: {},
      },
    ],
    version: 1,
    ...overrides,
  };
}

function writtenRuns(): Array<StoredRow> {
  return executions.rows;
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  runbooks = useInMemoryTable(RunbookService, [runbookRow()]);
  executions = useInMemoryTable(RunbookExecutionService, []);
  enqueued = [];
  isBlocked = false;

  RunbookStarter.registerEnqueuer(
    async (data: { runbookExecutionId: ObjectID }): Promise<void> => {
      enqueued.push(data.runbookExecutionId.toString());
    },
  );

  getJestSpyOn(ProjectService, "isProjectBlocked").mockImplementation(
    async (): Promise<boolean> => {
      return isBlocked;
    },
  );
  getJestSpyOn(
    ProjectScopedReferenceValidator,
    "validateReferencesBelongToProject",
  ).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function start(
  overrides: Partial<Parameters<typeof RunbookStarter.start>[0]> = {},
): Promise<RunbookStartResult> {
  return await RunbookStarter.start({
    projectId: new ObjectID(PROJECT_ID),
    runbookId: new ObjectID(RUNBOOK_ID),
    trigger: RunbookTriggerType.Manual,
    ...overrides,
  });
}

describe("what starts a run", () => {
  test("names seven triggers, the two that need nobody there among them", () => {
    expect(RUNBOOK_TRIGGER_TYPES).toEqual([
      "Manual",
      "Rule",
      "AutoRemediation",
      "AI",
      "Schedule",
      "Webhook",
      // A security playbook's Run a runbook step: a rule the project set up, like Rule.
      "SecurityPlaybook",
    ]);
    expect(UNATTENDED_RUNBOOK_TRIGGER_TYPES).toEqual(["Schedule", "Webhook"]);
    expect(isRunbookTriggerType("Webhook")).toBe(true);
    expect(isRunbookTriggerType("webhook")).toBe(false);
    expect(isRunbookTriggerType(undefined)).toBe(false);
  });
});

describe("a run that starts", () => {
  test("snapshots a runbook still saved the old way with every approval before the step it held back, and leaves the runbook as it is", async () => {
    const saved: Array<Record<string, unknown>> = [
      {
        id: "notify",
        order: 3,
        type: RunbookStepType.HttpRequest,
        title: "Post the all-clear",
        config: { method: "POST", url: "https://hooks.example.com/x" },
        requireApproval: true,
      },
      {
        id: "check",
        order: 1,
        type: RunbookStepType.Bash,
        title: "Check the replica",
        config: { script: "pg_isready", agentId: "" },
        requireApproval: true,
      },
      {
        id: "promote",
        order: 2,
        type: RunbookStepType.Kubernetes,
        title: "Promote the replica",
        config: { script: "kubectl get pods", agentId: "" },
      },
    ];
    runbooks.rows[0]!["steps"] = saved;
    const before: string = JSON.stringify(runbooks.rows[0]);

    const result: RunbookStartResult = await start();

    expect(result.isStarted).toBe(true);

    const steps: Array<RunbookStepExecutionState> = writtenRuns()[0]![
      "stepExecutions"
    ] as Array<RunbookStepExecutionState>;

    expect(
      steps.map((state: RunbookStepExecutionState) => {
        return [
          state.step.id,
          state.step.type,
          state.step.requireApprovalBeforeRunning === true,
          state.status,
        ];
      }),
    ).toEqual([
      [
        "check",
        RunbookStepType.Bash,
        false,
        RunbookStepExecutionStatus.Pending,
      ],
      [
        "promote",
        RunbookStepType.Kubernetes,
        true,
        RunbookStepExecutionStatus.Pending,
      ],
      [
        "notify",
        RunbookStepType.HttpRequest,
        false,
        RunbookStepExecutionStatus.Pending,
      ],
      [
        "notify-approval",
        RunbookStepType.Manual,
        false,
        RunbookStepExecutionStatus.Pending,
      ],
    ]);
    // No run started now carries the old flag.
    expect(JSON.stringify(steps)).not.toContain('"requireApproval"');
    // Starting a run reads the runbook; it writes nothing to it.
    expect(JSON.stringify(runbooks.rows[0])).toBe(before);
  });

  test("a step's own approval before it is kept in the snapshot as it is", () => {
    const steps: Array<RunbookStepExecutionState> =
      RunbookStarterClass.getStepExecutions([
        {
          id: "a",
          order: 0,
          type: RunbookStepType.Bash,
          title: "A",
          config: {},
          requireApprovalBeforeRunning: true,
        },
      ]);

    expect(steps).toEqual([
      {
        step: {
          id: "a",
          order: 0,
          type: RunbookStepType.Bash,
          title: "A",
          config: {},
          requireApprovalBeforeRunning: true,
        },
        status: RunbookStepExecutionStatus.Pending,
      },
    ]);
  });

  test("snapshots the steps in order, each waiting to run, and queues the run", async () => {
    const result: RunbookStartResult = await start();

    expect(result.isStarted).toBe(true);

    const runs: Array<StoredRow> = writtenRuns();

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runbookNameSnapshot: "Restart the web tier",
      status: RunbookExecutionStatus.Scheduled,
      triggerType: RunbookTriggerType.Manual,
    });
    expect(String(runs[0]!["runbookId"])).toBe(RUNBOOK_ID);
    expect(String(runs[0]!["projectId"])).toBe(PROJECT_ID);
    expect(
      (runs[0]!["stepExecutions"] as Array<RunbookStepExecutionState>).map(
        (state: RunbookStepExecutionState) => {
          return [state.step.id, state.status];
        },
      ),
    ).toEqual([
      ["first", RunbookStepExecutionStatus.Pending],
      ["second", RunbookStepExecutionStatus.Pending],
    ]);
    expect(enqueued).toEqual([String(runs[0]!["_id"])]);
  });

  test("records who started it, what it is for, more about the trigger, and its inputs", async () => {
    await start({
      trigger: RunbookTriggerType.Webhook,
      triggeredByUserId: new ObjectID(USER_ID),
      linkage: { incidentId: new ObjectID(INCIDENT_ID) },
      triggerDetails: { callerIp: "203.0.113.7" },
      inputs: { host: "web-1", replicas: 3 },
    });

    const run: StoredRow = writtenRuns()[0]!;

    expect(run["triggerType"]).toBe(RunbookTriggerType.Webhook);
    expect(String(run["triggeredByUserId"])).toBe(USER_ID);
    expect(String(run["incidentId"])).toBe(INCIDENT_ID);
    expect(run["triggerDetails"]).toEqual({ callerIp: "203.0.113.7" });
    expect(run["inputs"]).toEqual({ host: "web-1", replicas: 3 });
  });

  test("writes no inputs and no details when there are none", async () => {
    await start({ inputs: {}, triggerDetails: {} });

    const run: StoredRow = writtenRuns()[0]!;

    expect(run["inputs"]).toBeUndefined();
    expect(run["triggerDetails"]).toBeUndefined();
    expect(run["triggeredByUserId"]).toBeUndefined();
  });

  test("uses a runbook the caller already read, without reading it again", async () => {
    const find: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      RunbookService,
      "findOneById",
    );
    const runbook: Runbook = new Runbook();
    Object.assign(runbook, runbookRow());

    await start({ runbook });

    expect(find).not.toHaveBeenCalled();
    expect(writtenRuns()).toHaveLength(1);
  });
});

describe("a run that does not start", () => {
  test("no such runbook: refused as not found, nothing written", async () => {
    const result: RunbookStartResult = await start({
      runbookId: ObjectID.generate(),
    });

    expect(result).toEqual({
      isStarted: false,
      refusal: RunbookStartRefusal.NotFound,
    });
    expect(writtenRuns()).toHaveLength(0);
    expect(enqueued).toEqual([]);
  });

  test("another project's runbook: refused as not found, nothing written", async () => {
    const result: RunbookStartResult = await start({
      projectId: new ObjectID(OTHER_PROJECT_ID),
    });

    expect(result.isStarted).toBe(false);
    expect((result as { refusal: RunbookStartRefusal }).refusal).toBe(
      RunbookStartRefusal.NotFound,
    );
    expect(writtenRuns()).toHaveLength(0);
  });

  test("a runbook handed in that is not the one asked for: refused", async () => {
    const runbook: Runbook = new Runbook();
    Object.assign(runbook, runbookRow({ _id: ObjectID.generate().toString() }));

    const result: RunbookStartResult = await start({ runbook });

    expect((result as { refusal: RunbookStartRefusal }).refusal).toBe(
      RunbookStartRefusal.NotFound,
    );
  });

  test("a runbook turned off: refused, whatever started it", async () => {
    runbooks.get(RUNBOOK_ID)!["isEnabled"] = false;

    for (const trigger of RUNBOOK_TRIGGER_TYPES) {
      const result: RunbookStartResult = await start({ trigger });

      expect((result as { refusal: RunbookStartRefusal }).refusal).toBe(
        RunbookStartRefusal.TurnedOff,
      );
    }

    expect(writtenRuns()).toHaveLength(0);
  });

  test("a runbook without steps: refused", async () => {
    runbooks.get(RUNBOOK_ID)!["steps"] = [];

    const result: RunbookStartResult = await start();

    expect((result as { refusal: RunbookStartRefusal }).refusal).toBe(
      RunbookStartRefusal.NoSteps,
    );
    expect(writtenRuns()).toHaveLength(0);
  });

  test("a blocked project: a schedule and a webhook start nothing, a person still may", async () => {
    isBlocked = true;

    for (const trigger of UNATTENDED_RUNBOOK_TRIGGER_TYPES) {
      const result: RunbookStartResult = await start({ trigger });

      expect((result as { refusal: RunbookStartRefusal }).refusal).toBe(
        RunbookStartRefusal.ProjectBlocked,
      );
    }

    expect(writtenRuns()).toHaveLength(0);

    // A person's run is refused before it gets here (CommonAPI).
    expect(
      (await start({ trigger: RunbookTriggerType.Manual })).isStarted,
    ).toBe(true);
  });

  test("a run that cannot be queued is failed with the reason, never left Scheduled", async () => {
    RunbookStarter.registerEnqueuer(async (): Promise<void> => {
      throw new Error("The queue is down.");
    });

    const result: RunbookStartResult = await start();

    expect(result.isStarted).toBe(false);
    expect((result as { refusal: RunbookStartRefusal }).refusal).toBe(
      RunbookStartRefusal.NotQueued,
    );

    const run: StoredRow = writtenRuns()[0]!;

    expect(run["status"]).toBe(RunbookExecutionStatus.Failed);
    expect(run["failureReason"]).toBe(RUNBOOK_RUN_NOT_QUEUED_REASON);
    expect(run["completedAt"]).toBeInstanceOf(Date);
    expect((result as { execution?: RunbookExecution }).execution?.status).toBe(
      RunbookExecutionStatus.Failed,
    );
  });

  test("a process with no queue registered fails the run the same way", async () => {
    const starter: RunbookStarterClass = new RunbookStarterClass();

    expect(starter.hasEnqueuer()).toBe(false);

    const result: RunbookStartResult = await starter.start({
      projectId: new ObjectID(PROJECT_ID),
      runbookId: new ObjectID(RUNBOOK_ID),
      trigger: RunbookTriggerType.Schedule,
    });

    expect((result as { refusal: RunbookStartRefusal }).refusal).toBe(
      RunbookStartRefusal.NotQueued,
    );
    expect(writtenRuns()[0]!["status"]).toBe(RunbookExecutionStatus.Failed);
  });
});

describe("the rule engine's start path", () => {
  test("starts through the one start path, recording the trigger its caller names", async () => {
    const execution: RunbookExecution | null =
      await RunbookRuleEngineService.startRunbookFor({
        projectId: new ObjectID(PROJECT_ID),
        runbookId: new ObjectID(RUNBOOK_ID),
        linkage: { incidentId: new ObjectID(INCIDENT_ID) },
        trigger: RunbookTriggerType.AutoRemediation,
        triggeredByUserId: new ObjectID(USER_ID),
      });

    expect(execution).not.toBeNull();

    const run: StoredRow = writtenRuns()[0]!;

    expect(run["triggerType"]).toBe(RunbookTriggerType.AutoRemediation);
    expect(String(run["triggeredByUserId"])).toBe(USER_ID);
    expect(String(run["incidentId"])).toBe(INCIDENT_ID);
    expect(enqueued).toHaveLength(1);
  });

  test("answers null for a runbook it may not start, as it always did", async () => {
    runbooks.get(RUNBOOK_ID)!["isEnabled"] = false;

    expect(
      await RunbookRuleEngineService.startRunbookFor({
        projectId: new ObjectID(PROJECT_ID),
        runbookId: new ObjectID(RUNBOOK_ID),
        linkage: {},
        trigger: RunbookTriggerType.Rule,
      }),
    ).toBeNull();
  });

  test("hands back the failed run when it could not be queued", async () => {
    RunbookStarter.registerEnqueuer(async (): Promise<void> => {
      throw new Error("The queue is down.");
    });

    const execution: RunbookExecution | null =
      await RunbookRuleEngineService.startRunbookFor({
        projectId: new ObjectID(PROJECT_ID),
        runbookId: new ObjectID(RUNBOOK_ID),
        linkage: {},
        trigger: RunbookTriggerType.Rule,
      });

    expect(execution?.status).toBe(RunbookExecutionStatus.Failed);
    expect(execution?.failureReason).toBe(RUNBOOK_RUN_NOT_QUEUED_REASON);
  });

  test("hands its queue to the start path when the Runbook feature set registers it", async () => {
    const queued: Array<string> = [];

    RunbookRuleEngineService.registerExecutionEnqueuer(
      async (data: { runbookExecutionId: ObjectID }): Promise<void> => {
        queued.push(data.runbookExecutionId.toString());
      },
    );

    await start();

    expect(queued).toHaveLength(1);
    expect(enqueued).toHaveLength(0);
  });
});
