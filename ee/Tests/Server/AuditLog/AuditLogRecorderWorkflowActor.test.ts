import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import WorkflowPrincipal from "Common/Server/Utils/Workflow/WorkflowPrincipal";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A WORKFLOW'S CHANGE NAMES THE WORKFLOW.
 *
 * A workflow step acts as a Project Admin of its project and as no person
 * (WorkflowPrincipal): its props carry UserType.Workflow, no userId, and the
 * workflow's id and name. The audit trail used to show a workflow's changes
 * as OneUptime's own (root, a "system event" a project could choose not to
 * keep). Now the entry's actor is "Workflow", it names which workflow and
 * what it was called, and it is kept like any other change made in the
 * project - not filtered out with the system events.
 *
 * Billing and the edition are pinned as in AuditLogRecorder.test.ts; nothing
 * here touches ClickHouse or Postgres.
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
const WORKFLOW_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

interface Harness {
  recorder: AuditLogRecorder;
  inserted: Array<AuditLog>;
}

let project: Project;
let harness: Harness;

function makeProject(storeSystemEventsInAuditLogs: boolean): Project {
  const item: Project = new Project();
  item._id = PROJECT_ID.toString();
  item.enableAuditLogs = true;
  item.auditLogsRetentionInDays = 30;
  item.storeSystemEventsInAuditLogs = storeSystemEventsInAuditLogs;
  return item;
}

function createHarness(): Harness {
  const inserted: Array<AuditLog> = [];

  const insert: jest.Mock = jest.fn(((createBy: { data: AuditLog }) => {
    inserted.push(createBy.data);
    return Promise.resolve(createBy.data);
  }) as never);

  const recorder: AuditLogRecorder = new AuditLogRecorder({
    store: { create: insert } as unknown as AuditLogStore,
  });

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(() => {
    return Promise.resolve(project);
  });
  findUserMock.mockReset();

  return { recorder, inserted };
}

function makeMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = PROJECT_ID;
  monitor.name = "Checkout API";
  return monitor;
}

// A step of the "Close stale incidents" workflow, as the runner builds it.
function stepProps(workflowName?: string): DatabaseCommonInteractionProps {
  return WorkflowPrincipal.getPropsWithoutPlan({
    projectId: PROJECT_ID,
    workflowId: WORKFLOW_ID,
    workflowName: workflowName,
  });
}

async function recordMonitorCreate(
  props: DatabaseCommonInteractionProps,
): Promise<void> {
  await harness.recorder.recordCreate({
    model: new Monitor(),
    createdItem: makeMonitor(),
    props,
  });
}

beforeEach(() => {
  // Self-hosted Enterprise Edition with a valid license: everything records.
  setTestBillingEnabled(false);
  project = makeProject(false);
  harness = createHarness();
  installFakeEnterpriseModule({ auditLogRecorder: harness.recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a workflow step's change", () => {
  test("is the workflow's: actor Workflow, its id and its name, and no person", async () => {
    await recordMonitorCreate(stepProps("Close stale incidents"));

    expect(harness.inserted).toHaveLength(1);
    const entry: AuditLog = harness.inserted[0]!;

    expect(entry.userType).toBe(UserType.Workflow);
    expect(entry.workflowId?.toString()).toBe(WORKFLOW_ID.toString());
    expect(entry.workflowName).toBe("Close stale incidents");

    expect(entry.userId).toBeUndefined();
    expect(entry.userName).toBeUndefined();
    expect(entry.userEmail).toBeUndefined();
    expect(findUserMock).not.toHaveBeenCalled();

    // Not an API key's change, nor a connected client's.
    expect(entry.apiKeyId).toBeUndefined();
    expect(entry.apiKeyName).toBeUndefined();
    expect(entry.mcpOAuthGrantId).toBeUndefined();
  });

  test("is kept even where OneUptime's own system events are not", async () => {
    // storeSystemEventsInAuditLogs is off for this project.
    await recordMonitorCreate(stepProps("Close stale incidents"));

    expect(harness.inserted).toHaveLength(1);
  });

  test("of a workflow with no name still names the workflow by its id", async () => {
    await recordMonitorCreate(stepProps());

    const entry: AuditLog = harness.inserted[0]!;

    expect(entry.workflowId?.toString()).toBe(WORKFLOW_ID.toString());
    expect(entry.workflowName).toBeUndefined();
  });
});

describe("everyone else's changes name no workflow", () => {
  test.each([
    [
      "a member at the dashboard",
      {
        userId: new ObjectID("22222222-2222-4222-8222-222222222222"),
        userType: UserType.User,
        tenantId: PROJECT_ID,
      },
    ],
    [
      "a project API key",
      {
        userType: UserType.API,
        tenantId: PROJECT_ID,
        apiKeyId: new ObjectID("44444444-4444-4444-8444-444444444444"),
        apiKeyName: "CI deploy key",
      },
    ],
  ])("%s", async (_label: string, props: DatabaseCommonInteractionProps) => {
    findUserMock.mockImplementation(() => {
      return Promise.resolve(null);
    });

    await recordMonitorCreate(props);

    const entry: AuditLog = harness.inserted[0]!;

    expect(entry.workflowId).toBeUndefined();
    expect(entry.workflowName).toBeUndefined();
  });
});
