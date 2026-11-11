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
import { SessionAuditEvent } from "Common/Types/AuditLog/AuditLogSessionEvent";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { SessionEndCause } from "Common/Types/UserSession/SessionEndCause";
import {
  SecondFactor,
  SignInMethod,
} from "Common/Types/UserSession/SessionSignIn";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PEOPLE'S SESSIONS IN THE AUDIT LOG (issue #6762), as the Enterprise
 * recorder files them: each session event in every project its person is a
 * member of that records audit logs, as theirs, whether or not the project
 * stores system events.
 *
 * Every failure here is silent - recordSessionEvents swallows its errors,
 * and a sign-in missing from the audit log looks exactly like nobody signed
 * in - so each rule is pinned against the entries that reach the insert.
 *
 * No ClickHouse or Postgres: the insert, the projects, the people and their
 * memberships are stubbed, as module stubs rather than spies - the real
 * modules pull in most of the service graph.
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

const USER_ID: ObjectID = new ObjectID("31313131-3131-4131-8131-313131313131");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "32323232-3232-4232-8232-323232323232",
);
const SESSION_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333334",
);
const OTHER_SESSION_ID: ObjectID = new ObjectID(
  "34343434-3434-4434-8434-343434343434",
);
const PROJECT_A: ObjectID = new ObjectID(
  "35353535-3535-4535-8535-353535353535",
);
const PROJECT_B: ObjectID = new ObjectID(
  "36363636-3636-4636-8636-363636363636",
);
const PROJECT_C: ObjectID = new ObjectID(
  "37373737-3737-4737-8737-373737373737",
);

interface ProjectSettings {
  enableAuditLogs?: boolean;
  storeSystemEventsInAuditLogs?: boolean;
  planName?: PlanType;
  retentionInDays?: number;
}

let projects: Map<string, ProjectSettings>;
// Each person's memberships: one row per team, so a project may repeat.
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

const makeUser: (id: ObjectID, name: string, email: string) => User = (
  id: ObjectID,
  name: string,
  email: string,
): User => {
  const user: User = new User();
  user._id = id.toString();
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
};

const signInEvent: (
  overrides?: Partial<SessionAuditEvent>,
) => SessionAuditEvent = (
  overrides?: Partial<SessionAuditEvent>,
): SessionAuditEvent => {
  return {
    action: AuditLogAction.SignIn,
    userId: USER_ID,
    sessionId: SESSION_ID,
    signIn: {
      method: SignInMethod.Password,
      secondFactor: SecondFactor.SecurityKey,
    },
    device: "Firefox 132 on Windows",
    ipAddress: "198.51.100.23",
    ...(overrides || {}),
  };
};

// The user ids a membership lookup asked for, read back out of QueryHelper.any.
const userIdsInLookup: (call: Array<unknown>) => Array<string> = (
  call: Array<unknown>,
): Array<string> => {
  const query: JSONObject = (call[0] as { query: JSONObject }).query;
  const operator: { objectLiteralParameters?: Record<string, unknown> } =
    query["userId"] as unknown as {
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
  ]);
  memberships = new Map<string, Array<ObjectID>>([
    [USER_ID.toString(), [PROJECT_A, PROJECT_B, PROJECT_A]],
  ]);
  users = new Map<string, User>([
    [USER_ID.toString(), makeUser(USER_ID, "Grace Hopper", "grace@acme.test")],
    [
      OTHER_USER_ID.toString(),
      makeUser(OTHER_USER_ID, "Alan Turing", "alan@acme.test"),
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

    const asked: Array<string> = userIdsInLookup([findBy]);
    const rows: Array<TeamMember> = [];

    for (const userId of asked) {
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

describe("where a session event is filed", () => {
  test("in every project the person is a member of, once each", async () => {
    await recorder.recordSessionEvents([signInEvent()]);

    expect(inserted).toHaveLength(2);
    expect(entriesIn(PROJECT_A)).toHaveLength(1);
    expect(entriesIn(PROJECT_B)).toHaveLength(1);
  });

  test("only where the person accepted the invitation, read as OneUptime", async () => {
    await recorder.recordSessionEvents([signInEvent()]);

    expect(findMembersMock).toHaveBeenCalledTimes(1);

    const findBy: {
      query: JSONObject;
      select: JSONObject;
      props: JSONObject;
    } = findMembersMock.mock.calls[0]![0] as {
      query: JSONObject;
      select: JSONObject;
      props: JSONObject;
    };

    expect(findBy.query["hasAcceptedInvitation"]).toBe(true);
    expect(userIdsInLookup(findMembersMock.mock.calls[0]!)).toEqual([
      USER_ID.toString(),
    ]);
    expect(findBy.select).toEqual({
      _id: true,
      userId: true,
      projectId: true,
    });
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("not in a project with audit logging off", async () => {
    projects.set(PROJECT_B.toString(), { enableAuditLogs: false });

    await recorder.recordSessionEvents([signInEvent()]);

    expect(entriesIn(PROJECT_A)).toHaveLength(1);
    expect(entriesIn(PROJECT_B)).toHaveLength(0);
  });

  test("not in a project that is gone", async () => {
    memberships.set(USER_ID.toString(), [PROJECT_A, PROJECT_C]);

    await recorder.recordSessionEvents([signInEvent()]);

    expect(inserted.map((entry: AuditLog): string => {
      return entry.projectId!.toString();
    })).toEqual([PROJECT_A.toString()]);
  });

  /*
   * A session is its person's, whoever or whatever ended it: a timeout is
   * OneUptime's doing, but it is recorded as any change a person makes is,
   * system events or not.
   */
  test("whether or not the project stores system events", async () => {
    projects.set(PROJECT_A.toString(), {
      enableAuditLogs: true,
      storeSystemEventsInAuditLogs: false,
    });

    await recorder.recordSessionEvents([
      signInEvent({
        action: AuditLogAction.SessionTimeout,
        endCause: SessionEndCause.Expired,
      }),
    ]);

    expect(entriesIn(PROJECT_A)).toHaveLength(1);
  });

  test("nowhere, and nobody looked up, for a person in no project", async () => {
    memberships.clear();

    await recorder.recordSessionEvents([signInEvent()]);

    expect(inserted).toHaveLength(0);
    expect(findUserMock).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  test("nowhere while the license does not cover audit logs", async () => {
    installFakeEnterpriseModule({
      auditLogRecorder: recorder,
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    await recorder.recordSessionEvents([signInEvent()]);

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

    await recorder.recordSessionEvents([signInEvent()]);

    expect(entriesIn(PROJECT_A)).toHaveLength(1);
    expect(entriesIn(PROJECT_B)).toHaveLength(0);
  });
});

describe("what a session entry says", () => {
  test("it is about the session, named by its device, rolling up to its person", async () => {
    await recorder.recordSessionEvents([signInEvent()]);

    const entry: AuditLog = entriesIn(PROJECT_A)[0]!;

    expect(entry.action).toBe(AuditLogAction.SignIn);
    expect(entry.resourceType).toBe("User Session");
    expect(entry.resourceId?.toString()).toBe(SESSION_ID.toString());
    expect(entry.resourceName).toBe("Firefox 132 on Windows");
    expect(entry.rootResourceType).toBe("User");
    expect(entry.rootResourceId?.toString()).toBe(USER_ID.toString());
  });

  test("its actor is the person whose session it is", async () => {
    await recorder.recordSessionEvents([
      signInEvent({
        action: AuditLogAction.SessionTimeout,
        endCause: SessionEndCause.IdleTimeout,
      }),
    ]);

    const entry: AuditLog = entriesIn(PROJECT_A)[0]!;

    expect(entry.userId?.toString()).toBe(USER_ID.toString());
    expect(entry.userName).toBe("Grace Hopper");
    expect(entry.userEmail).toBe("grace@acme.test");
    expect(entry.userType).toBe(UserType.User);
    expect(entry.apiKeyId).toBeUndefined();
    expect(entry.workflowId).toBeUndefined();
  });

  test("its fields say how and from where", async () => {
    await recorder.recordSessionEvents([signInEvent()]);

    expect(changesOf(entriesIn(PROJECT_A)[0]!)).toEqual([
      { field: "signInMethod", newValue: "Password" },
      { field: "secondFactor", newValue: "Security key" },
      { field: "device", newValue: "Firefox 132 on Windows" },
      { field: "ipAddress", newValue: "198.51.100.23" },
    ]);
  });

  test("each project keeps it for its own retention", async () => {
    const now: Date = new Date("2026-11-11T12:00:00.000Z");
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);

    await recorder.recordSessionEvents([signInEvent()]);

    const days: (entry: AuditLog) => number = (entry: AuditLog): number => {
      return Math.round(
        (entry.retentionDate!.getTime() - now.getTime()) /
          (24 * 60 * 60 * 1000),
      );
    };

    expect(days(entriesIn(PROJECT_A)[0]!)).toBe(30);
    expect(days(entriesIn(PROJECT_B)[0]!)).toBe(90);
  });

  test("a project's own SSO provider is named in that project only", async () => {
    await recorder.recordSessionEvents([
      signInEvent({
        signIn: {
          method: SignInMethod.OpenIdConnect,
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
  });

  test("a person who is gone is still recorded, without a name", async () => {
    users.clear();

    await recorder.recordSessionEvents([signInEvent()]);

    const entry: AuditLog = entriesIn(PROJECT_A)[0]!;

    expect(entry.userId?.toString()).toBe(USER_ID.toString());
    expect(entry.userName).toBeUndefined();
    expect(entry.userEmail).toBeUndefined();
  });
});

describe("many events at once, as a revocation or a sweep hands them over", () => {
  test("are written in one batch, with each person looked up once", async () => {
    memberships.set(OTHER_USER_ID.toString(), [PROJECT_B]);

    await recorder.recordSessionEvents([
      signInEvent({
        action: AuditLogAction.SessionRevoked,
        endCause: SessionEndCause.PasswordChanged,
      }),
      signInEvent({
        action: AuditLogAction.SessionRevoked,
        endCause: SessionEndCause.PasswordChanged,
        sessionId: OTHER_SESSION_ID,
      }),
      signInEvent({
        action: AuditLogAction.SessionTimeout,
        endCause: SessionEndCause.LengthReached,
        userId: OTHER_USER_ID,
      }),
    ]);

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(5);
    // One membership lookup for both people.
    expect(findMembersMock).toHaveBeenCalledTimes(1);
    expect(userIdsInLookup(findMembersMock.mock.calls[0]!).sort()).toEqual(
      [USER_ID.toString(), OTHER_USER_ID.toString()].sort(),
    );
    // As OneUptime: nobody else writes the audit log.
    expect(
      (createMany.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
  });

  test("a project's settings are read once for all of them", async () => {
    await recorder.recordSessionEvents([
      signInEvent(),
      signInEvent({ sessionId: OTHER_SESSION_ID }),
    ]);

    const projectReads: Array<string> = findProjectMock.mock.calls.map(
      (call: Array<unknown>): string => {
        return (call[0] as { id: ObjectID }).id.toString();
      },
    );

    expect(projectReads.sort()).toEqual(
      [PROJECT_A.toString(), PROJECT_B.toString()].sort(),
    );
  });

  test("hundreds of people are looked up fifty at a time", async () => {
    const people: Array<ObjectID> = [];

    for (let index: number = 0; index < 120; index++) {
      people.push(ObjectID.generate());
    }

    await recorder.recordSessionEvents(
      people.map((userId: ObjectID): SessionAuditEvent => {
        return signInEvent({ userId, sessionId: ObjectID.generate() });
      }),
    );

    expect(
      findMembersMock.mock.calls.map((call: Array<unknown>): number => {
        return userIdsInLookup(call).length;
      }),
    ).toEqual([50, 50, 20]);
  });

  test("a store without createMany is written one entry at a time", async () => {
    const plainStore: AuditLogRecorder = new AuditLogRecorder({
      store: { create } as unknown as AuditLogStore,
    });

    await plainStore.recordSessionEvents([signInEvent()]);

    expect(create).toHaveBeenCalledTimes(2);
    expect(inserted).toHaveLength(2);
  });

  test("a thousand entries at most go into one insert", async () => {
    const manyProjects: Array<ObjectID> = [];

    for (let index: number = 0; index < 1200; index++) {
      const projectId: ObjectID = ObjectID.generate();
      manyProjects.push(projectId);
      projects.set(projectId.toString(), { enableAuditLogs: true });
    }

    memberships.set(USER_ID.toString(), manyProjects);

    await recorder.recordSessionEvents([signInEvent()]);

    expect(
      createMany.mock.calls.map((call: Array<unknown>): number => {
        return (call[0] as { items: Array<AuditLog> }).items.length;
      }),
    ).toEqual([1000, 200]);
  });
});

describe("what is not recorded, and what never fails", () => {
  test("an event without a person, a session or a session action is left out", async () => {
    await recorder.recordSessionEvents([
      signInEvent({ sessionId: undefined as unknown as ObjectID }),
      signInEvent({ userId: undefined as unknown as ObjectID }),
      signInEvent({ action: AuditLogAction.Create as never }),
      undefined as unknown as SessionAuditEvent,
    ]);

    expect(inserted).toHaveLength(0);
    expect(findMembersMock).not.toHaveBeenCalled();
  });

  test("no events, no work", async () => {
    await recorder.recordSessionEvents([]);

    expect(findMembersMock).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  test("a membership lookup that fails records nothing, and says so, without throwing", async () => {
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });
    findMembersMock.mockRejectedValue(new Error("Postgres is down") as never);

    await expect(
      recorder.recordSessionEvents([signInEvent()]),
    ).resolves.toBeUndefined();
    expect(inserted).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("AuditLog: failed to record session events");
  });

  test("an insert that fails never throws", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    createMany.mockRejectedValue(new Error("ClickHouse is down") as never);

    await expect(
      recorder.recordSessionEvents([signInEvent()]),
    ).resolves.toBeUndefined();
  });
});

describe("core's delegate reaches this recorder", () => {
  test("a session event handed to core's AuditLogService is filed here", async () => {
    await CoreAuditLogService.recordSessionEvents([signInEvent()]);

    expect(inserted).toHaveLength(2);
  });
});
