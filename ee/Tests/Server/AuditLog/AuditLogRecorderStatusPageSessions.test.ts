import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import CoreAuditLogService from "Common/Server/Services/AuditLogService";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import logger from "Common/Server/Utils/Logger";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Project from "Common/Models/DatabaseModels/Project";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import { StatusPageSessionAuditEvent } from "Common/Types/AuditLog/AuditLogStatusPageSession";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A PRIVATE STATUS PAGE'S READERS' SESSIONS IN THE AUDIT LOG (issue #6790),
 * as the Enterprise recorder files them: in the status page's project
 * alone, when it records audit logs, about the reader's session, rolling up
 * to the status page - so the status page's own Audit Logs page lists them
 * - with the reader, who is no OneUptime user, as its actor.
 */

const findProjectMock: jest.Mock = jest.fn();
const findMembersMock: jest.Mock = jest.fn();

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

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return findMembersMock(...args);
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

const SESSION_ID: ObjectID = new ObjectID(
  "51515151-5151-4151-8151-515151515151",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "52525252-5252-4252-8252-525252525252",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "53535353-5353-4353-8353-535353535353",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "54545454-5454-4454-8454-545454545454",
);

interface ProjectSettings {
  enableAuditLogs?: boolean;
  storeSystemEventsInAuditLogs?: boolean;
  planName?: PlanType;
}

let projects: Map<string, ProjectSettings>;
let inserted: Array<AuditLog>;
let createMany: jest.Mock;
let recorder: AuditLogRecorder;

const readerEvent: (
  overrides?: Partial<StatusPageSessionAuditEvent>,
) => StatusPageSessionAuditEvent = (
  overrides?: Partial<StatusPageSessionAuditEvent>,
): StatusPageSessionAuditEvent => {
  return {
    action: AuditLogAction.SignIn,
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    statusPageId: STATUS_PAGE_ID,
    readerEmail: "customer@example.com",
    signIn: { method: SignInMethod.Password },
    device: "Safari 18 on iOS",
    ipAddress: "203.0.113.7",
    ...(overrides || {}),
  };
};

const changesOf: (entry: AuditLog) => Array<JSONObject> = (
  entry: AuditLog,
): Array<JSONObject> => {
  return (entry.changes || []) as Array<JSONObject>;
};

beforeEach(() => {
  setTestBillingEnabled(false);

  projects = new Map<string, ProjectSettings>([
    [PROJECT_ID.toString(), { enableAuditLogs: true }],
    [OTHER_PROJECT_ID.toString(), { enableAuditLogs: true }],
  ]);
  inserted = [];

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(((findOneById: { id: ObjectID }) => {
    const settings: ProjectSettings | undefined = projects.get(
      findOneById.id.toString(),
    );

    if (!settings) {
      return Promise.resolve(null);
    }

    const project: Project = new Project();
    project._id = findOneById.id.toString();
    project.enableAuditLogs = settings.enableAuditLogs ?? true;
    project.storeSystemEventsInAuditLogs =
      settings.storeSystemEventsInAuditLogs ?? false;
    project.auditLogsRetentionInDays = 30;
    if (settings.planName) {
      project.planName = settings.planName;
    }
    return Promise.resolve(project);
  }) as never);

  findMembersMock.mockReset();

  createMany = jest.fn(((createBy: { items: Array<AuditLog> }) => {
    inserted.push(...createBy.items);
    return Promise.resolve(createBy.items);
  }) as never);

  recorder = new AuditLogRecorder({
    store: {
      create: jest.fn(),
      createMany,
    } as unknown as AuditLogStore,
  });

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("where a reader's session event is filed", () => {
  test("in the status page's project, and nowhere else", async () => {
    await recorder.recordStatusPageSessionEvents([readerEvent()]);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
    // A reader is no member: nobody's memberships are read.
    expect(findMembersMock).not.toHaveBeenCalled();
  });

  test("not while the project's audit logging is off", async () => {
    projects.set(PROJECT_ID.toString(), { enableAuditLogs: false });

    await recorder.recordStatusPageSessionEvents([readerEvent()]);

    expect(inserted).toHaveLength(0);
  });

  test("whether or not the project stores system events", async () => {
    projects.set(PROJECT_ID.toString(), {
      enableAuditLogs: true,
      storeSystemEventsInAuditLogs: false,
    });

    await recorder.recordStatusPageSessionEvents([
      readerEvent({
        action: AuditLogAction.SessionRevoked,
        endReason: "Password changed",
      }),
    ]);

    expect(inserted).toHaveLength(1);
  });

  test("not while the license does not cover audit logs", async () => {
    installFakeEnterpriseModule({
      auditLogRecorder: recorder,
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    await recorder.recordStatusPageSessionEvents([readerEvent()]);

    expect(inserted).toHaveLength(0);
  });

  test("on OneUptime Cloud, for a project on the Enterprise plan only", async () => {
    setTestBillingEnabled(true);
    projects.set(PROJECT_ID.toString(), {
      enableAuditLogs: true,
      planName: PlanType.Scale,
    });

    await recorder.recordStatusPageSessionEvents([readerEvent()]);

    expect(inserted).toHaveLength(0);

    projects.set(PROJECT_ID.toString(), {
      enableAuditLogs: true,
      planName: PlanType.Enterprise,
    });
    recorder.invalidateProjectSettings(PROJECT_ID);

    await recorder.recordStatusPageSessionEvents([readerEvent()]);

    expect(inserted).toHaveLength(1);
  });

  test("a project that is gone records nothing", async () => {
    await recorder.recordStatusPageSessionEvents([
      readerEvent({ projectId: ObjectID.generate() }),
    ]);

    expect(inserted).toHaveLength(0);
  });
});

describe("what a reader's session entry says", () => {
  test("it is about the session, named by its device, rolling up to the status page", async () => {
    await recorder.recordStatusPageSessionEvents([readerEvent()]);

    const entry: AuditLog = inserted[0]!;

    expect(entry.action).toBe(AuditLogAction.SignIn);
    expect(entry.resourceType).toBe("Status Page Private User Session");
    expect(entry.resourceId?.toString()).toBe(SESSION_ID.toString());
    expect(entry.resourceName).toBe("Safari 18 on iOS");
    expect(entry.rootResourceType).toBe("Status Page");
    expect(entry.rootResourceId?.toString()).toBe(STATUS_PAGE_ID.toString());
  });

  test("its actor is the reader, by their address, with no user id: they are no OneUptime user", async () => {
    await recorder.recordStatusPageSessionEvents([readerEvent()]);

    const entry: AuditLog = inserted[0]!;

    expect(entry.userEmail).toBe("customer@example.com");
    expect(entry.userId).toBeUndefined();
    expect(entry.userName).toBeUndefined();
    expect(entry.userType).toBe("StatusPagePrivateUser");
  });

  test("a reader whose address is unknown is still recorded", async () => {
    await recorder.recordStatusPageSessionEvents([
      readerEvent({ readerEmail: "   " }),
    ]);

    expect(inserted[0]!.userEmail).toBeUndefined();
    expect(inserted[0]!.userType).toBe("StatusPagePrivateUser");
  });

  test("a sign-in says how and from where, the status page's provider named", async () => {
    await recorder.recordStatusPageSessionEvents([
      readerEvent({
        signIn: { method: SignInMethod.Saml, ssoProviderName: "Customer IdP" },
        location: "Berlin, Germany",
        endReason: "ignored on a sign-in",
        signedInAt: new Date("2026-11-16T08:00:00.000Z"),
      }),
    ]);

    expect(changesOf(inserted[0]!)).toEqual([
      { field: "signInMethod", newValue: "SAML single sign-on" },
      { field: "ssoProvider", newValue: "Customer IdP" },
      { field: "device", newValue: "Safari 18 on iOS" },
      { field: "ipAddress", newValue: "203.0.113.7" },
      { field: "location", newValue: "Berlin, Germany" },
    ]);
  });

  test("an end says why, and when it signed in and was last used", async () => {
    await recorder.recordStatusPageSessionEvents([
      readerEvent({
        action: AuditLogAction.SignOut,
        endReason: "Signed out",
        signedInAt: new Date("2026-11-16T08:00:00.000Z"),
        lastActiveAt: new Date("2026-11-16T08:45:00.000Z"),
      }),
    ]);

    expect(inserted[0]!.action).toBe(AuditLogAction.SignOut);
    expect(changesOf(inserted[0]!)).toEqual([
      { field: "reason", newValue: "Signed out" },
      { field: "signInMethod", newValue: "Password" },
      { field: "device", newValue: "Safari 18 on iOS" },
      { field: "ipAddress", newValue: "203.0.113.7" },
      { field: "signedInAt", newValue: "2026-11-16T08:00:00.000Z" },
      { field: "lastActiveAt", newValue: "2026-11-16T08:45:00.000Z" },
    ]);
  });

  test("several at once are written in one batch, each in its own project, as OneUptime", async () => {
    await recorder.recordStatusPageSessionEvents([
      readerEvent(),
      readerEvent({
        sessionId: ObjectID.generate(),
        projectId: OTHER_PROJECT_ID,
      }),
    ]);

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(
      inserted.map((entry: AuditLog): string => {
        return entry.projectId!.toString();
      }),
    ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()]);
    expect(
      (createMany.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
  });
});

describe("what is not recorded, and what never fails", () => {
  test("an event without a session, a project, a status page or a session action is left out", async () => {
    await recorder.recordStatusPageSessionEvents([
      readerEvent({ sessionId: undefined as unknown as ObjectID }),
      readerEvent({ projectId: undefined as unknown as ObjectID }),
      readerEvent({ statusPageId: undefined as unknown as ObjectID }),
      readerEvent({ action: AuditLogAction.Create as never }),
      // A failed sign-in is a member's, never a reader's session.
      readerEvent({ action: AuditLogAction.SignInFailed as never }),
      undefined as unknown as StatusPageSessionAuditEvent,
    ]);

    expect(inserted).toHaveLength(0);
  });

  test("an insert that fails never throws, and says so", async () => {
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });
    createMany.mockRejectedValue(new Error("ClickHouse is down") as never);

    await expect(
      recorder.recordStatusPageSessionEvents([readerEvent()]),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "AuditLog: failed to record status page session events",
    );
  });
});

describe("core's delegate reaches this recorder", () => {
  test("a reader's session event handed to core's AuditLogService is filed here", async () => {
    await CoreAuditLogService.recordStatusPageSessionEvents([readerEvent()]);

    expect(inserted).toHaveLength(1);
  });
});
