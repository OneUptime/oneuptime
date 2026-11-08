import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import OnBehalfOfProps from "Common/Server/Utils/AuditLog/OnBehalfOfProps";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Project from "Common/Models/DatabaseModels/Project";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import User from "Common/Models/DatabaseModels/User";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "Common/Types/Email";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A RUNBOOK RUN'S ENTRIES, AS THE RECORDER WRITES THEM (issue #6283).
 *
 * What people do to a run - approve, complete or skip a step, start it,
 * cancel it - is recorded by the person, and a run's steps are recorded as
 * what happened to them: never as the list, which would copy every step's
 * output into the audit log. What OneUptime does while it runs the run is a
 * system event, read the same way. The routes' side - what reaches the
 * recorder, and when - is pinned in App's RunbookRunAuditLog.test.ts.
 */

const findProjectMock: jest.Mock = jest.fn();
const findUserMock: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findProjectMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findUserMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const RUNBOOK_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUN_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const SECRET: string = "sk-live-0123456789";

// As the request's props are for a member in the dashboard.
const PERSON: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
};

let project: Project;
let inserted: Array<AuditLog>;
let recorder: AuditLogRecorder;

function makeProject(storeSystemEvents: boolean): Project {
  const item: Project = new Project();
  item._id = PROJECT_ID.toString();
  item.enableAuditLogs = true;
  item.auditLogsRetentionInDays = 30;
  item.storeSystemEventsInAuditLogs = storeSystemEvents;
  return item;
}

function steps(statuses: {
  restart: string;
  verify?: string;
  approvedAt?: string;
}): JSONArray {
  return [
    {
      step: {
        id: "check",
        title: "Check the dashboards",
        type: "Manual",
        config: {},
      },
      status: "Completed",
      output: `printed ${SECRET}`,
      notes: `looked fine, key ${SECRET}`,
    },
    {
      step: {
        id: "restart",
        title: "Restart the API",
        type: "Bash",
        requireApprovalBeforeRunning: true,
        config: { script: `restart --token ${SECRET}`, agentId: "a" },
      },
      status: statuses.restart,
      ...(statuses.approvedAt ? { approvedAt: statuses.approvedAt } : {}),
    },
    {
      step: { id: "verify", title: "Verify the API", type: "Bash", config: {} },
      status: statuses.verify || "Pending",
    },
  ];
}

function runBefore(status: RunbookExecutionStatus, stepList: JSONArray) {
  const run: RunbookExecution = new RunbookExecution(RUN_ID);
  run.projectId = PROJECT_ID;
  run.runbookId = RUNBOOK_ID;
  run.runbookNameSnapshot = "Restart the API";
  run.status = status;
  run.stepExecutions = stepList;
  return run;
}

function changesOf(entry: AuditLog): Array<JSONObject> {
  return (entry.changes || []) as Array<JSONObject>;
}

function changeOf(entry: AuditLog, field: string): JSONObject | undefined {
  return changesOf(entry).find((change: JSONObject): boolean => {
    return change["field"] === field;
  });
}

function onlyEntry(): AuditLog {
  expect(inserted).toHaveLength(1);
  return inserted[0]!;
}

beforeEach(() => {
  setTestBillingEnabled(false);
  project = makeProject(false);
  inserted = [];

  const insert: jest.Mock = jest.fn(((createBy: { data: AuditLog }) => {
    inserted.push(createBy.data);
    return Promise.resolve(createBy.data);
  }) as never);

  recorder = new AuditLogRecorder({
    store: { create: insert } as unknown as AuditLogStore,
  });

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(() => {
    return Promise.resolve(project);
  });

  findUserMock.mockReset();
  findUserMock.mockImplementation(((findOneById: { id: ObjectID }) => {
    if (findOneById.id.toString() !== USER_ID.toString()) {
      return Promise.resolve(null);
    }

    const user: User = new User();
    user._id = USER_ID.toString();
    user.name = new Name("Ada Lovelace");
    user.email = new Email("ada@example.com");
    return Promise.resolve(user);
  }) as never);

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a step a person approved, completed or skipped", () => {
  test("is one Update entry by them, saying which step and what they did, on the runbook's page", async () => {
    await recorder.recordUpdate({
      model: new RunbookExecution(),
      before: runBefore(
        RunbookExecutionStatus.WaitingForManualStep,
        steps({ restart: "WaitingForUser" }),
      ),
      updatedFields: {
        stepExecutions: steps({
          restart: "Pending",
          approvedAt: "2026-11-08T10:00:00.000Z",
        }),
      },
      itemId: RUN_ID,
      props: PERSON,
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Update);
    expect(entry.resourceType).toBe("Runbook Execution");
    expect(entry.resourceId?.toString()).toBe(RUN_ID.toString());
    expect(entry.rootResourceType).toBe("Runbook");
    expect(entry.rootResourceId?.toString()).toBe(RUNBOOK_ID.toString());
    expect(entry.userId?.toString()).toBe(USER_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
    expect(entry.userType).toBe(UserType.User);
    expect(changesOf(entry)).toEqual([
      {
        field: "stepExecutions",
        oldValue: "3 steps: 1 done, 1 waiting for a person, 1 pending",
        newValue: "3 steps: 1 done, 2 pending",
        summary: ['Approved "Restart the API" (step 2)'],
      },
    ]);
  });

  test("carries no step's output, script, or note", async () => {
    await recorder.recordUpdate({
      model: new RunbookExecution(),
      before: runBefore(
        RunbookExecutionStatus.WaitingForManualStep,
        steps({ restart: "WaitingForUser" }),
      ),
      updatedFields: { stepExecutions: steps({ restart: "Skipped" }) },
      itemId: RUN_ID,
      props: PERSON,
    });

    expect(JSON.stringify(onlyEntry())).not.toContain("sk-live");
    expect(changeOf(onlyEntry(), "stepExecutions")?.["summary"]).toEqual([
      'Skipped "Restart the API" (step 2)',
    ]);
  });

  test("is recorded whether or not the project stores system events: it is a person's", async () => {
    project = makeProject(false);

    await recorder.recordUpdate({
      model: new RunbookExecution(),
      before: runBefore(
        RunbookExecutionStatus.WaitingForManualStep,
        steps({ restart: "WaitingForUser" }),
      ),
      updatedFields: { stepExecutions: steps({ restart: "Completed" }) },
      itemId: RUN_ID,
      props: PERSON,
    });

    expect(inserted).toHaveLength(1);
  });
});

describe("a run a person cancelled", () => {
  const cancelled: JSONObject = {
    status: RunbookExecutionStatus.Cancelled,
    completedAt: new Date("2026-11-08T10:05:00.000Z"),
    stepExecutions: steps({ restart: "Cancelled", verify: "Cancelled" }),
  } as unknown as JSONObject;

  test("is theirs, not System's, and says the run went to Cancelled and which steps it stopped", async () => {
    await recorder.recordUpdate({
      model: new RunbookExecution(),
      before: runBefore(
        RunbookExecutionStatus.Running,
        steps({ restart: "Running" }),
      ),
      updatedFields: cancelled,
      itemId: RUN_ID,
      props: OnBehalfOfProps.get(PERSON),
      includeColumns: ["status"],
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.userName).toBe("Ada Lovelace");
    expect(entry.userType).toBe(UserType.User);
    expect(changeOf(entry, "status")).toEqual({
      field: "status",
      oldValue: RunbookExecutionStatus.Running,
      newValue: RunbookExecutionStatus.Cancelled,
    });
    expect(changeOf(entry, "stepExecutions")?.["summary"]).toEqual([
      'Cancelled "Restart the API" (step 2)',
      'Cancelled "Verify the API" (step 3)',
    ]);
    expect(JSON.stringify(entry)).not.toContain("sk-live");
  });

  test("written as plain root - as it was - it was System's, and dropped unless the project stores system events", async () => {
    await recorder.recordUpdate({
      model: new RunbookExecution(),
      before: runBefore(
        RunbookExecutionStatus.Running,
        steps({ restart: "Running" }),
      ),
      updatedFields: cancelled,
      itemId: RUN_ID,
      props: { isRoot: true },
    });

    expect(inserted).toHaveLength(0);
  });
});

describe("what OneUptime does while it runs a run", () => {
  test("is a system event, kept only when the project stores them, and read the same way", async () => {
    const workerWrite: () => Promise<void> = async (): Promise<void> => {
      await recorder.recordUpdate({
        model: new RunbookExecution(),
        before: runBefore(
          RunbookExecutionStatus.Running,
          steps({ restart: "Running" }),
        ),
        updatedFields: {
          stepExecutions: [
            ...steps({ restart: "Failed" }).slice(0, 1),
            {
              ...(steps({ restart: "Failed" })[1] as JSONObject),
              output: `deploying with ${SECRET}`,
              errorMessage: `exit 1: bad token ${SECRET}`,
            },
            ...steps({ restart: "Failed" }).slice(2),
          ],
          status: RunbookExecutionStatus.Failed,
          failureReason: `Step "Restart the API" failed: bad token ${SECRET}`,
        },
        itemId: RUN_ID,
        props: { isRoot: true },
      });
    };

    await workerWrite();
    expect(inserted).toHaveLength(0);

    project = makeProject(true);
    recorder.invalidateProjectSettings(PROJECT_ID);
    await workerWrite();

    const entry: AuditLog = onlyEntry();

    expect(entry.userType).toBe("System");
    expect(changesOf(entry)).toEqual([
      {
        field: "stepExecutions",
        oldValue: "3 steps: 1 done, 1 running, 1 pending",
        newValue: "3 steps: 1 done, 1 failed, 1 pending",
        summary: ['"Restart the API" (step 2) went from running to failed'],
      },
    ]);
    // Neither what the step printed, nor its error, nor the run's reason.
    expect(JSON.stringify(entry)).not.toContain("sk-live");
  });
});

describe("a run a person started", () => {
  test("is a Create entry by them, its steps listed and none of what they hold", async () => {
    const created: RunbookExecution = runBefore(
      RunbookExecutionStatus.Scheduled,
      steps({ restart: "Pending" }),
    );
    created.triggeredByUserId = USER_ID;

    await recorder.recordCreate({
      model: new RunbookExecution(),
      createdItem: created,
      props: OnBehalfOfProps.get(PERSON),
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Create);
    expect(entry.userName).toBe("Ada Lovelace");
    expect(entry.rootResourceId?.toString()).toBe(RUNBOOK_ID.toString());
    expect(changeOf(entry, "stepExecutions")).toEqual({
      field: "stepExecutions",
      newValue: "3 steps: 1 done, 2 pending",
      summary: [
        '"Check the dashboards" (step 1): done',
        '"Restart the API" (step 2): pending',
        '"Verify the API" (step 3): pending',
      ],
    });
    expect(JSON.stringify(entry)).not.toContain("sk-live");
  });
});
