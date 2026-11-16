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
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import {
  SignInFailureAuditEvent,
  SignInFailureReason,
} from "Common/Types/AuditLog/AuditLogSignInFailure";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * FAILED SIGN-INS IN THE AUDIT LOG (issue #6788), as the Enterprise recorder
 * files them: each failed attempt on an existing account in every project
 * its person is a member of that records audit logs - as a sign-in is,
 * whether or not the project stores system events - about the attempt,
 * with the account as its actor.
 *
 * Nothing outside the person's projects is ever written to, so a stranger's
 * attempts tell nobody else anything about the account. Every failure here
 * is silent - recordSignInFailures swallows its errors - so each rule is
 * pinned against the entries that reach the insert.
 */

const findProjectMock: jest.Mock = jest.fn();
const findUserMock: jest.Mock = jest.fn();
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

const USER_ID: ObjectID = new ObjectID("41414141-4141-4141-8141-414141414141");
const ATTEMPT_ID: ObjectID = new ObjectID(
  "42424242-4242-4242-8242-424242424242",
);
const PROJECT_A: ObjectID = new ObjectID(
  "43434343-4343-4343-8343-434343434343",
);
const PROJECT_B: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const STRANGERS_PROJECT: ObjectID = new ObjectID(
  "45454545-4545-4545-8545-454545454545",
);

interface ProjectSettings {
  enableAuditLogs?: boolean;
  storeSystemEventsInAuditLogs?: boolean;
  planName?: PlanType;
  retentionInDays?: number;
}

let projects: Map<string, ProjectSettings>;
let memberships: Map<string, Array<ObjectID>>;
let users: Map<string, User>;
let inserted: Array<AuditLog>;
let createMany: jest.Mock;
let create: jest.Mock;
let recorder: AuditLogRecorder;

const makeProject: (id: ObjectID, settings: ProjectSettings) => Project = (
  id: ObjectID,
  settings: ProjectSettings,
): Project => {
  const project: Project = new Project();
  project._id = id.toString();
  project.enableAuditLogs = settings.enableAuditLogs ?? true;
  project.storeSystemEventsInAuditLogs =
    settings.storeSystemEventsInAuditLogs ?? false;
  project.auditLogsRetentionInDays = settings.retentionInDays ?? 30;
  if (settings.planName) {
    project.planName = settings.planName;
  }
  return project;
};

const failedSignIn: (
  overrides?: Partial<SignInFailureAuditEvent>,
) => SignInFailureAuditEvent = (
  overrides?: Partial<SignInFailureAuditEvent>,
): SignInFailureAuditEvent => {
  return {
    userId: USER_ID,
    attemptId: ATTEMPT_ID,
    reason: SignInFailureReason.WrongPassword,
    signIn: { method: SignInMethod.Password },
    device: "Firefox 132 on Windows",
    ipAddress: "198.51.100.23",
    location: "Lisbon, Portugal",
    failedAttempts: 1,
    ...(overrides || {}),
  };
};

const userIdsInLookup: (call: Array<unknown>) => Array<string> = (
  call: Array<unknown>,
): Array<string> => {
  const query: JSONObject = (call[0] as { query: JSONObject }).query;
  const operator: { objectLiteralParameters?: Record<string, unknown> } = query[
    "userId"
  ] as unknown as {
    objectLiteralParameters?: Record<string, unknown>;
  };

  return Object.values(operator.objectLiteralParameters || {})
    .flat()
    .map((id: unknown): string => {
      return String(id);
    });
};

const entriesIn: (projectId: ObjectID) => Array<AuditLog> = (
  projectId: ObjectID,
): Array<AuditLog> => {
  return inserted.filter((entry: AuditLog): boolean => {
    return entry.projectId?.toString() === projectId.toString();
  });
};

const changesOf: (entry: AuditLog) => Array<JSONObject> = (
  entry: AuditLog,
): Array<JSONObject> => {
  return (entry.changes || []) as Array<JSONObject>;
};

beforeEach(() => {
  // Self-hosted Enterprise Edition with a license that covers audit logs.
  setTestBillingEnabled(false);

  projects = new Map<string, ProjectSettings>([
    [PROJECT_A.toString(), { enableAuditLogs: true }],
    [PROJECT_B.toString(), { enableAuditLogs: true, retentionInDays: 90 }],
    [STRANGERS_PROJECT.toString(), { enableAuditLogs: true }],
  ]);
  memberships = new Map<string, Array<ObjectID>>([
    [USER_ID.toString(), [PROJECT_A, PROJECT_B, PROJECT_A]],
  ]);
  users = new Map<string, User>();
  const person: User = new User();
  person._id = USER_ID.toString();
  person.name = new Name("Grace Hopper");
  person.email = new Email("grace@acme.test");
  users.set(USER_ID.toString(), person);
  inserted = [];

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(((findOneById: { id: ObjectID }) => {
    const settings: ProjectSettings | undefined = projects.get(
      findOneById.id.toString(),
    );
    return Promise.resolve(
      settings ? makeProject(findOneById.id, settings) : null,
    );
  }) as never);

  findUserMock.mockReset();
  findUserMock.mockImplementation(((findOneById: { id: ObjectID }) => {
    return Promise.resolve(users.get(findOneById.id.toString()) || null);
  }) as never);

  findMembersMock.mockReset();
  findMembersMock.mockImplementation(((findBy: {
    query: JSONObject;
    skip: number;
  }) => {
    if (findBy.skip > 0) {
      return Promise.resolve([]);
    }

    const rows: Array<TeamMember> = [];

    for (const userId of userIdsInLookup([findBy])) {
      for (const projectId of memberships.get(userId) || []) {
        const member: TeamMember = new TeamMember();
        member._id = ObjectID.generate().toString();
        member.userId = new ObjectID(userId);
        member.projectId = projectId;
        rows.push(member);
      }
    }

    return Promise.resolve(rows);
  }) as never);

  createMany = jest.fn(((createBy: { items: Array<AuditLog> }) => {
    inserted.push(...createBy.items);
    return Promise.resolve(createBy.items);
  }) as never);
  create = jest.fn(((createBy: { data: AuditLog }) => {
    inserted.push(createBy.data);
    return Promise.resolve(createBy.data);
  }) as never);

  recorder = new AuditLogRecorder({
    store: { create, createMany } as unknown as AuditLogStore,
  });

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("where a failed sign-in is filed", () => {
  test("in every project the account's person is a member of, once each", async () => {
    await recorder.recordSignInFailures([failedSignIn()]);

    expect(inserted).toHaveLength(2);
    expect(entriesIn(PROJECT_A)).toHaveLength(1);
    expect(entriesIn(PROJECT_B)).toHaveLength(1);
  });

  test("nowhere else: a project the person is no member of hears nothing of the account", async () => {
    await recorder.recordSignInFailures([failedSignIn()]);

    expect(entriesIn(STRANGERS_PROJECT)).toHaveLength(0);
  });

  test("only where the person accepted the invitation, read as OneUptime", async () => {
    await recorder.recordSignInFailures([failedSignIn()]);

    const findBy: { query: JSONObject; props: JSONObject } = findMembersMock
      .mock.calls[0]![0] as { query: JSONObject; props: JSONObject };

    expect(findBy.query["hasAcceptedInvitation"]).toBe(true);
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("not in a project with audit logging off", async () => {
    projects.set(PROJECT_B.toString(), { enableAuditLogs: false });

    await recorder.recordSignInFailures([failedSignIn()]);

    expect(entriesIn(PROJECT_A)).toHaveLength(1);
    expect(entriesIn(PROJECT_B)).toHaveLength(0);
  });

  test("whether or not the project stores system events", async () => {
    projects.set(PROJECT_A.toString(), {
      enableAuditLogs: true,
      storeSystemEventsInAuditLogs: false,
    });

    await recorder.recordSignInFailures([failedSignIn()]);

    expect(entriesIn(PROJECT_A)).toHaveLength(1);
  });

  test("nowhere, and nobody looked up, for an account in no project", async () => {
    memberships.clear();

    await recorder.recordSignInFailures([failedSignIn()]);

    expect(inserted).toHaveLength(0);
    expect(findUserMock).not.toHaveBeenCalled();
  });

  test("nowhere while the license does not cover audit logs", async () => {
    installFakeEnterpriseModule({
      auditLogRecorder: recorder,
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    await recorder.recordSignInFailures([failedSignIn()]);

    expect(inserted).toHaveLength(0);
  });

  test("on OneUptime Cloud, in Enterprise plan projects only", async () => {
    setTestBillingEnabled(true);
    projects.set(PROJECT_A.toString(), {
      enableAuditLogs: true,
      planName: PlanType.Enterprise,
    });
    projects.set(PROJECT_B.toString(), {
      enableAuditLogs: true,
      planName: PlanType.Scale,
    });

    await recorder.recordSignInFailures([failedSignIn()]);

    expect(entriesIn(PROJECT_A)).toHaveLength(1);
    expect(entriesIn(PROJECT_B)).toHaveLength(0);
  });
});

describe("what a failed sign-in's entry says", () => {
  test("it is about the attempt, named by its device, rolling up to the account", async () => {
    await recorder.recordSignInFailures([failedSignIn()]);

    for (const entry of inserted) {
      expect(entry.action).toBe(AuditLogAction.SignInFailed);
      expect(entry.resourceType).toBe("Sign-In Attempt");
      // Every project's entry is about the same attempt.
      expect(entry.resourceId?.toString()).toBe(ATTEMPT_ID.toString());
      expect(entry.resourceName).toBe("Firefox 132 on Windows");
      expect(entry.rootResourceType).toBe("User");
      expect(entry.rootResourceId?.toString()).toBe(USER_ID.toString());
    }
  });

  test("an attempt from a device nobody can name is named so", async () => {
    await recorder.recordSignInFailures([failedSignIn({ device: undefined })]);

    expect(entriesIn(PROJECT_A)[0]!.resourceName).toBe("Unknown device");
  });

  test("its actor is the account the attempt was made on", async () => {
    await recorder.recordSignInFailures([failedSignIn()]);

    const entry: AuditLog = entriesIn(PROJECT_A)[0]!;

    expect(entry.userId?.toString()).toBe(USER_ID.toString());
    expect(entry.userName).toBe("Grace Hopper");
    expect(entry.userEmail).toBe("grace@acme.test");
    expect(entry.userType).toBe(UserType.User);
  });

  test("its fields say why it failed, how it tried and from where", async () => {
    await recorder.recordSignInFailures([failedSignIn()]);

    expect(changesOf(entriesIn(PROJECT_A)[0]!)).toEqual([
      { field: "reason", newValue: "Wrong password" },
      { field: "signInMethod", newValue: "Password" },
      { field: "device", newValue: "Firefox 132 on Windows" },
      { field: "ipAddress", newValue: "198.51.100.23" },
      { field: "location", newValue: "Lisbon, Portugal" },
    ]);
  });

  test("an entry standing for the attempts counted before it says how many, and when the first was", async () => {
    const firstFailedAt: Date = new Date("2026-11-16T08:12:44.000Z");

    await recorder.recordSignInFailures([
      failedSignIn({
        reason: SignInFailureReason.WrongAuthenticatorCode,
        failedAttempts: 37,
        firstFailedAt,
      }),
    ]);

    expect(changesOf(entriesIn(PROJECT_A)[0]!)).toEqual([
      { field: "reason", newValue: "Wrong authenticator code" },
      { field: "failedAttempts", newValue: "37" },
      { field: "signInMethod", newValue: "Password" },
      { field: "device", newValue: "Firefox 132 on Windows" },
      { field: "ipAddress", newValue: "198.51.100.23" },
      { field: "location", newValue: "Lisbon, Portugal" },
      { field: "firstFailedAt", newValue: firstFailedAt.toISOString() },
    ]);
  });

  test("a count that is no whole number of several stands for the attempt alone", async () => {
    for (const failedAttempts of [1, 0, -3, 2.5, Number.NaN]) {
      inserted = [];

      await recorder.recordSignInFailures([
        failedSignIn({
          failedAttempts,
          firstFailedAt: new Date("2026-11-16T08:12:44.000Z"),
        }),
      ]);

      const fields: Array<unknown> = changesOf(entriesIn(PROJECT_A)[0]!).map(
        (change: JSONObject): unknown => {
          return change["field"];
        },
      );

      expect(fields).not.toContain("failedAttempts");
      expect(fields).not.toContain("firstFailedAt");
    }
  });

  test("a project's own SSO provider is named in that project only", async () => {
    await recorder.recordSignInFailures([
      failedSignIn({
        reason: SignInFailureReason.SingleSignOnRefused,
        signIn: {
          method: SignInMethod.Saml,
          ssoProviderName: "Acme Okta",
          ssoProjectId: PROJECT_A,
        },
      }),
    ]);

    expect(changesOf(entriesIn(PROJECT_A)[0]!)).toContainEqual({
      field: "ssoProvider",
      newValue: "Acme Okta",
    });
    expect(JSON.stringify(entriesIn(PROJECT_B)[0]!.changes)).not.toContain(
      "Acme Okta",
    );
    // Both say it was single sign-on, and that it was refused.
    expect(changesOf(entriesIn(PROJECT_B)[0]!)).toContainEqual({
      field: "signInMethod",
      newValue: "SAML single sign-on",
    });
  });

  test("the server's own provider is named everywhere", async () => {
    await recorder.recordSignInFailures([
      failedSignIn({
        reason: SignInFailureReason.AccountBlocked,
        signIn: {
          method: SignInMethod.OpenIdConnect,
          ssoProviderName: "Company Entra ID",
        },
      }),
    ]);

    for (const entry of inserted) {
      expect(changesOf(entry)).toContainEqual({
        field: "ssoProvider",
        newValue: "Company Entra ID",
      });
      expect(changesOf(entry)).toContainEqual({
        field: "reason",
        newValue: "Account blocked by a server admin",
      });
    }
  });

  test("each project keeps it for its own retention", async () => {
    const now: Date = new Date("2026-11-16T12:00:00.000Z");
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);

    await recorder.recordSignInFailures([failedSignIn()]);

    const days: (entry: AuditLog) => number = (entry: AuditLog): number => {
      return Math.round(
        (entry.retentionDate!.getTime() - now.getTime()) /
          (24 * 60 * 60 * 1000),
      );
    };

    expect(days(entriesIn(PROJECT_A)[0]!)).toBe(30);
    expect(days(entriesIn(PROJECT_B)[0]!)).toBe(90);
  });

  test("written in one batch, as OneUptime", async () => {
    await recorder.recordSignInFailures([
      failedSignIn(),
      failedSignIn({ attemptId: ObjectID.generate() }),
    ]);

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(inserted).toHaveLength(4);
    expect(
      (createMany.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
    // The person is looked up once for both attempts.
    expect(findUserMock).toHaveBeenCalledTimes(1);
  });
});

describe("what is not recorded, and what never fails", () => {
  test("an event without an account, an attempt or a reason this release names is left out", async () => {
    await recorder.recordSignInFailures([
      failedSignIn({ userId: undefined as unknown as ObjectID }),
      failedSignIn({ attemptId: undefined as unknown as ObjectID }),
      failedSignIn({ reason: "Wrong password" as SignInFailureReason }),
      undefined as unknown as SignInFailureAuditEvent,
    ]);

    expect(inserted).toHaveLength(0);
    expect(findMembersMock).not.toHaveBeenCalled();
  });

  test("a lookup that fails records nothing, and says so, without throwing", async () => {
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });
    findMembersMock.mockRejectedValue(new Error("Postgres is down") as never);

    await expect(
      recorder.recordSignInFailures([failedSignIn()]),
    ).resolves.toBeUndefined();
    expect(inserted).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      "AuditLog: failed to record failed sign-ins",
    );
  });

  test("an insert that fails never throws", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    createMany.mockRejectedValue(new Error("ClickHouse is down") as never);

    await expect(
      recorder.recordSignInFailures([failedSignIn()]),
    ).resolves.toBeUndefined();
  });
});

describe("core's delegate reaches this recorder", () => {
  test("a failed sign-in handed to core's AuditLogService is filed here", async () => {
    await CoreAuditLogService.recordSignInFailures([failedSignIn()]);

    expect(inserted).toHaveLength(2);
  });
});
