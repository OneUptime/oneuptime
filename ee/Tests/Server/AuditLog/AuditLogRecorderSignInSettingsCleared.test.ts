import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
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
import { AUDIT_LOG_REDACTED_VALUE } from "Common/Types/AuditLog/AuditLogRedaction";
import {
  getSignInSettingsClearedChanges,
  SignInSettingsClearedAuditEvent,
} from "Common/Types/AuditLog/AuditLogSignInSettingsCleared";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import {
  LocalSignInSettings,
  NO_LOCAL_SIGN_IN_SETTINGS,
} from "Common/Types/SSO/LocalSignInClearing";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A MASTER ADMIN CLEARING SOMEONE'S SIGN-IN SETTINGS, IN THE AUDIT LOG
 * (issue #9762), as the Enterprise recorder files it: one entry in every
 * project the person is a member of that records audit logs - as their
 * sessions are, whether or not the project stores system events - an
 * Update of the person, by the master admin who cleared it, naming what was
 * removed and never a value of it.
 *
 * Nothing outside the person's projects is ever written to. Every failure
 * here is silent - recordSignInSettingsCleared swallows its errors - so each
 * rule is pinned against the entries that reach the insert.
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

const PERSON_ID: ObjectID = new ObjectID(
  "51515151-5151-4151-8151-515151515151",
);
const OTHER_PERSON_ID: ObjectID = new ObjectID(
  "52525252-5252-4252-8252-525252525252",
);
const ADMIN_ID: ObjectID = new ObjectID("53535353-5353-4353-8353-535353535353");
const PROJECT_A: ObjectID = new ObjectID(
  "54545454-5454-4454-8454-545454545454",
);
const PROJECT_B: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const STRANGERS_PROJECT: ObjectID = new ObjectID(
  "56565656-5656-4656-8656-565656565656",
);

const EVERYTHING: LocalSignInSettings = {
  hasPassword: true,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 1,
  passkeyAndSecurityKeyCount: 2,
  backupCodeCount: 9,
};

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

const makeUser: (id: ObjectID, name: string | null, email: string) => User = (
  id: ObjectID,
  name: string | null,
  email: string,
): User => {
  const user: User = new User();
  user._id = id.toString();
  if (name) {
    user.name = new Name(name);
  }
  user.email = new Email(email);
  return user;
};

const cleared: (
  overrides?: Partial<SignInSettingsClearedAuditEvent>,
) => SignInSettingsClearedAuditEvent = (
  overrides?: Partial<SignInSettingsClearedAuditEvent>,
): SignInSettingsClearedAuditEvent => {
  return {
    userId: PERSON_ID,
    clearedByUserId: ADMIN_ID,
    cleared: EVERYTHING,
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

beforeEach(() => {
  // Self-hosted Enterprise Edition with a license that covers audit logs.
  setTestBillingEnabled(false);

  projects = new Map<string, ProjectSettings>([
    [PROJECT_A.toString(), { enableAuditLogs: true }],
    [PROJECT_B.toString(), { enableAuditLogs: true, retentionInDays: 90 }],
    [STRANGERS_PROJECT.toString(), { enableAuditLogs: true }],
  ]);
  memberships = new Map<string, Array<ObjectID>>([
    [PERSON_ID.toString(), [PROJECT_A, PROJECT_B, PROJECT_A]],
    [OTHER_PERSON_ID.toString(), [PROJECT_B]],
  ]);
  users = new Map<string, User>([
    [
      PERSON_ID.toString(),
      makeUser(PERSON_ID, "Grace Hopper", "grace@acme.test"),
    ],
    [
      OTHER_PERSON_ID.toString(),
      makeUser(OTHER_PERSON_ID, null, "ada@acme.test"),
    ],
    [
      ADMIN_ID.toString(),
      makeUser(ADMIN_ID, "Server Admin", "admin@acme.test"),
    ],
  ]);
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

describe("where a clear of someone's sign-in settings is filed", () => {
  test("in every project the person is a member of, once each", async () => {
    await recorder.recordSignInSettingsCleared([cleared()]);

    expect(inserted).toHaveLength(2);
    expect(entriesIn(PROJECT_A)).toHaveLength(1);
    expect(entriesIn(PROJECT_B)).toHaveLength(1);
  });

  test("nowhere else: a project the person is no member of hears nothing", async () => {
    await recorder.recordSignInSettingsCleared([cleared()]);

    expect(entriesIn(STRANGERS_PROJECT)).toHaveLength(0);
  });

  test("only where the person accepted the invitation, read as OneUptime", async () => {
    await recorder.recordSignInSettingsCleared([cleared()]);

    const findBy: { query: JSONObject; props: JSONObject } = findMembersMock
      .mock.calls[0]![0] as { query: JSONObject; props: JSONObject };

    expect(findBy.query["hasAcceptedInvitation"]).toBe(true);
    expect(findBy.props).toEqual({ isRoot: true });
    expect(userIdsInLookup([findBy])).toEqual([PERSON_ID.toString()]);
  });

  test("not in a project with audit logging off", async () => {
    projects.set(PROJECT_B.toString(), { enableAuditLogs: false });

    await recorder.recordSignInSettingsCleared([cleared()]);

    expect(entriesIn(PROJECT_A)).toHaveLength(1);
    expect(entriesIn(PROJECT_B)).toHaveLength(0);
  });

  test("whether or not the project stores system events: a master admin did it by hand", async () => {
    projects.set(PROJECT_A.toString(), {
      enableAuditLogs: true,
      storeSystemEventsInAuditLogs: false,
    });

    await recorder.recordSignInSettingsCleared([cleared()]);

    expect(entriesIn(PROJECT_A)).toHaveLength(1);
  });

  test("nowhere for a person in no project", async () => {
    memberships.clear();

    await recorder.recordSignInSettingsCleared([cleared()]);

    expect(inserted).toHaveLength(0);
  });

  test("nowhere while the license does not cover audit logs", async () => {
    installFakeEnterpriseModule({
      auditLogRecorder: recorder,
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    await recorder.recordSignInSettingsCleared([cleared()]);

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

    await recorder.recordSignInSettingsCleared([cleared()]);

    expect(entriesIn(PROJECT_A)).toHaveLength(1);
    expect(entriesIn(PROJECT_B)).toHaveLength(0);
  });

  test("several people at once, each in their own projects, in one batch of writes", async () => {
    await recorder.recordSignInSettingsCleared([
      cleared(),
      cleared({ userId: OTHER_PERSON_ID }),
    ]);

    expect(entriesIn(PROJECT_A)).toHaveLength(1);
    expect(entriesIn(PROJECT_B)).toHaveLength(2);
    expect(
      entriesIn(PROJECT_B)
        .map((entry: AuditLog): string => {
          return entry.resourceId!.toString();
        })
        .sort(),
    ).toEqual([PERSON_ID.toString(), OTHER_PERSON_ID.toString()].sort());
  });
});

describe("what a clear's entry says", () => {
  test("it is an Update of the person, named by their name, rolling up to them", async () => {
    await recorder.recordSignInSettingsCleared([cleared()]);

    for (const entry of inserted) {
      expect(entry.action).toBe(AuditLogAction.Update);
      expect(entry.resourceType).toBe("User");
      expect(entry.resourceId?.toString()).toBe(PERSON_ID.toString());
      expect(entry.resourceName).toBe("Grace Hopper");
      expect(entry.rootResourceType).toBe("User");
      expect(entry.rootResourceId?.toString()).toBe(PERSON_ID.toString());
    }
  });

  test("a person with no name is named by their email", async () => {
    await recorder.recordSignInSettingsCleared([
      cleared({ userId: OTHER_PERSON_ID }),
    ]);

    expect(entriesIn(PROJECT_B)[0]!.resourceName).toBe("ada@acme.test");
  });

  test("its actor is the master admin who cleared it, so filtering by their email finds it", async () => {
    await recorder.recordSignInSettingsCleared([cleared()]);

    const entry: AuditLog = entriesIn(PROJECT_A)[0]!;

    expect(entry.userId?.toString()).toBe(ADMIN_ID.toString());
    expect(entry.userName).toBe("Server Admin");
    expect(entry.userEmail).toBe("admin@acme.test");
    expect(entry.userType).toBe(UserType.User);
  });

  test("each master admin is looked up once, however many people they cleared", async () => {
    await recorder.recordSignInSettingsCleared([
      cleared(),
      cleared({ userId: OTHER_PERSON_ID }),
    ]);

    const adminLookups: Array<unknown> = findUserMock.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return (
          (call[0] as { id: ObjectID }).id.toString() === ADMIN_ID.toString()
        );
      },
    );

    expect(adminLookups).toHaveLength(1);
  });

  test("its fields are what was removed, never a value of it", async () => {
    await recorder.recordSignInSettingsCleared([cleared()]);

    const changes: Array<JSONObject> = entriesIn(PROJECT_A)[0]!
      .changes as Array<JSONObject>;

    expect(changes).toEqual(getSignInSettingsClearedChanges(EVERYTHING));
    expect(changes[0]).toEqual({
      field: "password",
      oldValue: AUDIT_LOG_REDACTED_VALUE,
      newValue: null,
    });
  });

  test("only what there was: someone with only a password has one field", async () => {
    await recorder.recordSignInSettingsCleared([
      cleared({
        cleared: { ...NO_LOCAL_SIGN_IN_SETTINGS, hasPassword: true },
      }),
    ]);

    expect(entriesIn(PROJECT_A)[0]!.changes).toEqual([
      { field: "password", oldValue: AUDIT_LOG_REDACTED_VALUE, newValue: null },
    ]);
  });

  test("it is kept for the project's audit log retention", async () => {
    await recorder.recordSignInSettingsCleared([cleared()]);

    const kept: Date | undefined = entriesIn(PROJECT_B)[0]!.retentionDate;
    const shortKept: Date | undefined = entriesIn(PROJECT_A)[0]!.retentionDate;

    expect(kept).toBeInstanceOf(Date);
    expect(shortKept).toBeInstanceOf(Date);
    // Project B keeps its entries 90 days, project A 30.
    expect(kept!.getTime()).toBeGreaterThan(shortKept!.getTime());
  });
});

describe("what makes no entry", () => {
  test("a clear that removed nothing", async () => {
    await recorder.recordSignInSettingsCleared([
      cleared({ cleared: NO_LOCAL_SIGN_IN_SETTINGS }),
    ]);

    expect(inserted).toHaveLength(0);
    expect(findMembersMock).not.toHaveBeenCalled();
  });

  test("none at all", async () => {
    await recorder.recordSignInSettingsCleared([]);

    expect(inserted).toHaveLength(0);
    expect(findMembersMock).not.toHaveBeenCalled();
  });

  test("an event with nobody in it", async () => {
    await recorder.recordSignInSettingsCleared([
      cleared({ userId: undefined as unknown as ObjectID }),
      cleared({ clearedByUserId: undefined as unknown as ObjectID }),
    ]);

    expect(inserted).toHaveLength(0);
  });

  test("a failure anywhere never throws: the settings are gone whatever the log says", async () => {
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });
    findMembersMock.mockImplementation((() => {
      return Promise.reject(new Error("pool exhausted"));
    }) as never);

    await expect(
      recorder.recordSignInSettingsCleared([cleared()]),
    ).resolves.toBeUndefined();
    expect(inserted).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      "AuditLog: failed to record cleared sign-in settings",
    );
  });
});
