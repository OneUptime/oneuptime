import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { ON_HIGHEST_PLAN } from "Common/Tests/Server/TestingUtils/RequestPlan";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import ProbeService from "Common/Server/Services/ProbeService";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * RUN AGAIN, IN THE AUDIT LOG (OneUptime issue #10334).
 *
 * A discovery scan run again on demand is a change a person asked for, made
 * by OneUptime as root - and the columns it writes are OneUptime's own
 * bookkeeping, which the audit defaults leave out of every entry. So
 * NetworkDeviceDiscoveryScanService.runAgain records its own entry, naming
 * runRequestedAt and the status. Here the real runAgain runs against one
 * scan row in memory, and the real recorder writes into a store in memory:
 * the entry is an Update of the scan, by the person who pressed Run Again,
 * saying when they asked and that the scan went back in the queue. A run
 * that is refused records nothing.
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
  "10334000-0000-4000-8000-0000000000e1",
);
const SIMON: ObjectID = new ObjectID("10334000-0000-4000-8000-0000000000e2");
const SCAN_ID: ObjectID = new ObjectID("10334000-0000-4000-8000-0000000000e3");
const PROBE_ID: ObjectID = new ObjectID("10334000-0000-4000-8000-0000000000e4");

const PRESSED_AT: Date = new Date("2026-11-22T10:00:00.000Z");

// Simon, a project member, pressing Run Again.
const SIMON_PRESSING: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: SIMON,
  userType: UserType.User,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    },
  },
  ...ON_HIGHEST_PLAN,
} as unknown as DatabaseCommonInteractionProps;

type Row = Record<string, unknown>;

let scanRow: Row;
let probeConnection: ProbeConnectionStatus;
let inserted: Array<AuditLog>;
let recorder: AuditLogRecorder;

function changesOf(entry: AuditLog): Array<JSONObject> {
  return (entry.changes || []) as Array<JSONObject>;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(PRESSED_AT);
  setTestBillingEnabled(false);

  scanRow = {
    _id: SCAN_ID.toString(),
    projectId: PROJECT_ID,
    name: "All Tablets Discovery",
    cidr: "10.16-49.0-255.45-47",
    probeId: PROBE_ID,
    status: "Completed",
    runRequestedAt: null,
  };
  probeConnection = ProbeConnectionStatus.Connected;
  inserted = [];

  recorder = new AuditLogRecorder({
    store: {
      create: jest.fn(((createBy: { data: AuditLog }) => {
        inserted.push(createBy.data);
        return Promise.resolve(createBy.data);
      }) as never),
    } as unknown as AuditLogStore,
  });

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(() => {
    const project: Project = new Project();
    project._id = PROJECT_ID.toString();
    project.enableAuditLogs = true;
    project.auditLogsRetentionInDays = 30;
    project.storeSystemEventsInAuditLogs = false;
    return Promise.resolve(project);
  });

  findUserMock.mockReset();
  findUserMock.mockImplementation(((findOneById: { id: ObjectID }) => {
    if (findOneById.id.toString() !== SIMON.toString()) {
      return Promise.resolve(null);
    }

    const user: User = new User();
    user._id = SIMON.toString();
    user.name = new Name("Simon Larsen");
    user.email = new Email("simon@example.com");
    return Promise.resolve(user);
  }) as never);

  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: Row;
      select: Row;
    }): Promise<NetworkDeviceDiscoveryScan | null> => {
      if (
        String(findBy.query["_id"]) !== String(scanRow["_id"]) ||
        String(findBy.query["projectId"]) !== String(scanRow["projectId"])
      ) {
        return null;
      }

      const model: NetworkDeviceDiscoveryScan =
        new NetworkDeviceDiscoveryScan();

      for (const column of Object.keys(findBy.select)) {
        (model as unknown as Row)[column] = scanRow[column];
      }

      return model;
    }) as never);

  jest
    .spyOn(
      NetworkDeviceDiscoveryScanService,
      "compareAndSetColumnsByIdWithoutHooks",
    )
    .mockImplementation((async (input: {
      data: Row;
      expectedData: Row;
    }): Promise<boolean> => {
      if (input.expectedData["status"] !== scanRow["status"]) {
        return false;
      }

      Object.assign(scanRow, input.data);
      return true;
    }) as never);

  jest.spyOn(ProbeService, "findOneById").mockImplementation((async () => {
    const probe: Probe = new Probe(PROBE_ID);
    probe.name = "Office Probe";
    probe.projectId = PROJECT_ID;
    probe.connectionStatus = probeConnection;
    return probe;
  }) as never);

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function pressRunAgain(): Promise<void> {
  await NetworkDeviceDiscoveryScanService.runAgain({
    scanId: SCAN_ID,
    projectId: PROJECT_ID,
    props: SIMON_PRESSING,
  });
}

describe("a discovery scan run again, as the audit log records it", () => {
  test("is one Update of the scan, named by its name, by the person who pressed Run Again", async () => {
    await pressRunAgain();

    expect(inserted).toHaveLength(1);

    const entry: AuditLog = inserted[0]!;

    expect(entry.action).toBe(AuditLogAction.Update);
    expect(entry.resourceType).toBe("Network Device Discovery Scan");
    expect(entry.resourceId?.toString()).toBe(SCAN_ID.toString());
    expect(entry.resourceName).toBe("All Tablets Discovery");
    expect(entry.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(entry.userId?.toString()).toBe(SIMON.toString());
    expect(entry.userName).toBe("Simon Larsen");
    expect(entry.userType).toBe(UserType.User);
  });

  test("says when the run was asked for, and that the scan went back in the queue", async () => {
    await pressRunAgain();

    expect(changesOf(inserted[0]!)).toEqual([
      {
        field: "status",
        oldValue: "Completed",
        newValue: "Pending",
      },
      {
        field: "runRequestedAt",
        oldValue: null,
        newValue: PRESSED_AT.toISOString(),
      },
    ]);
  });

  test("is kept though the project does not store OneUptime's own events: it is the person's", async () => {
    await pressRunAgain();

    expect(inserted).toHaveLength(1);
  });

  test("records nothing for a run that is refused", async () => {
    probeConnection = ProbeConnectionStatus.Disconnected;

    await expect(pressRunAgain()).rejects.toThrow(
      "is not connected to OneUptime",
    );

    expect(inserted).toEqual([]);
    expect(scanRow["status"]).toBe("Completed");
  });
});
