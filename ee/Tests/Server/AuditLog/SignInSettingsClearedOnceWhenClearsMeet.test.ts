import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import InMemoryLocks from "Common/Tests/Server/TestingUtils/InMemoryLocks";
import { readQueryValues } from "Common/Tests/Server/TestingUtils/SsoManagedProjects";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import UserSessionService from "Common/Server/Services/UserSessionService";
import UserTotpAuthService from "Common/Server/Services/UserTotpAuthService";
import UserTwoFactorBackupCodeService from "Common/Server/Services/UserTwoFactorBackupCodeService";
import UserWebAuthnService from "Common/Server/Services/UserWebAuthnService";
import LocalSignInClearing, {
  CLEAR_LOCK_NAMESPACE,
} from "Common/Server/Utils/LocalSignInClearing";
import logger from "Common/Server/Utils/Logger";
import ProjectSignInClearing from "Common/Server/Utils/ProjectSignInClearing";
import SignInSettingsClearedEmail, {
  SignInSettingsClearedEmailEvent,
} from "Common/Server/Utils/SignInSettingsClearedEmail";
import SsoRequiredSignIn from "Common/Server/Utils/SsoRequiredSignIn";
import TwoFactorWrongCodes from "Common/Server/Utils/TwoFactorWrongCodes";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Project from "Common/Models/DatabaseModels/Project";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import BadDataException from "Common/Types/Exception/BadDataException";
import HashedString from "Common/Types/HashedString";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import PositiveNumber from "Common/Types/PositiveNumber";
import {
  CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
  hasLocalSignInSettings,
  LocalSignInSettings,
  NO_LOCAL_SIGN_IN_SETTINGS,
} from "Common/Types/SSO/LocalSignInClearing";
import { SignInSettingsClearedBy } from "Common/Types/SSO/SignInSettingsClearedEmail";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

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

/*
 * TWO CLEARS OF ONE PERSON'S SIGN-IN SETTINGS AT THE SAME MOMENT RECORD THE
 * REMOVAL ONCE (#10776), END TO END.
 *
 * Every clear read what a person had and then cleared it, with nothing
 * between two clears of the same person: a server admin's of one person
 * (LocalSignInClearing.clearForPerson) or of everyone the server's SSO
 * requirement covers (clearForEveryoneCoveredBySsoRequirement), and a
 * Project Owner's of everyone they may clear (ProjectSignInClearing.
 * clearForProject) or of one member (clearMember). Two at once could both
 * read the settings before either cleared them, and both recorded the
 * whole removal: two entries in each of the person's projects' audit logs,
 * one of them untrue.
 *
 * Here every pair of the four - each in both orders, two clears of the same
 * kind included, as the same dialog sent twice is - runs at the same moment
 * against one world: a person in two projects, both managing sign-in with
 * SSO and owned by two owners, the person's settings in memory and removed
 * by the clears' own writes, the locks in memory as Valkey holds them
 * (InMemoryLocks), and the real audit log recorder writing to a store in
 * memory. Every read and write of the world yields a number of turns drawn
 * from the shared seeded generator, so the two clears interleave
 * differently on every seed - and the same way on every run of it.
 *
 * Whatever the interleaving: exactly one of the two says it removed
 * anything; each of the person's projects holds exactly one entry, by the
 * clear that removed it; the person is emailed once, by that clear's words;
 * and nothing is left. The other answers that it cleared nothing. A control
 * runs the same race unlocked - with Valkey out of reach a clear goes on
 * without its lock, as every clear did before - and sees the removal
 * recorded twice: the lock is what holds the rest.
 */

const PERSON_ID: ObjectID = new ObjectID(
  "10776000-0000-4000-8000-0000000000b1",
);
const ADMIN_A_ID: ObjectID = new ObjectID(
  "10776000-0000-4000-8000-0000000000a1",
);
const ADMIN_B_ID: ObjectID = new ObjectID(
  "10776000-0000-4000-8000-0000000000a2",
);
const OWNER_A_ID: ObjectID = new ObjectID(
  "10776000-0000-4000-8000-0000000000c1",
);
const OWNER_B_ID: ObjectID = new ObjectID(
  "10776000-0000-4000-8000-0000000000c2",
);
const ACME_ID: ObjectID = new ObjectID("10776000-0000-4000-8000-0000000000d1");
const STAGING_ID: ObjectID = new ObjectID(
  "10776000-0000-4000-8000-0000000000d2",
);

const OWNERS: Array<ObjectID> = [OWNER_A_ID, OWNER_B_ID];
const PROJECTS: Array<ObjectID> = [ACME_ID, STAGING_ID];

// What the person saved, and the clears remove.
const EVERYTHING: LocalSignInSettings = {
  hasPassword: true,
  hasPasswordResetLink: true,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 2,
  passkeyAndSecurityKeyCount: 1,
  backupCodeCount: 8,
};

const IN_A_DAY: Date = new Date(Date.now() + 24 * 60 * 60 * 1000);

// The seeds each pair races on, and the most turns one read or write yields.
const SEEDS: Array<number> = Array.from(
  { length: 24 },
  (_value: unknown, index: number): number => {
    return 10776 + index;
  },
);
const MOST_TURNS: number = 4;

interface StoredPerson {
  name: string;
  email: string;
  isMasterAdmin: boolean;
  settings: LocalSignInSettings;
}

interface WorldMembership {
  userId: ObjectID;
  projectId: ObjectID;
}

enum ClearKind {
  ServerAdminOnePerson = "a server admin's clear of the person",
  ServerAdminEveryone = "a server admin's clear of everyone the SSO requirement covers",
  OwnerEveryone = "an owner's clear of everyone they may clear",
  OwnerOneMember = "an owner's clear of the one member",
}

const KINDS: Array<ClearKind> = [
  ClearKind.ServerAdminOnePerson,
  ClearKind.ServerAdminEveryone,
  ClearKind.OwnerEveryone,
  ClearKind.OwnerOneMember,
];

interface Clear {
  kind: ClearKind;
  actorId: ObjectID;
  clearedBy: SignInSettingsClearedBy;
  // Runs it: whether its answer says it removed anything from the person.
  run: () => Promise<boolean>;
}

let people: Map<string, StoredPerson>;
let memberships: Array<WorldMembership>;
let inserted: Array<AuditLog>;
let emailed: Array<SignInSettingsClearedEmailEvent>;
let random: SeededRandom;
let locks: InMemoryLocks;

const keyOf: (id: ObjectID | string) => string = (
  id: ObjectID | string,
): string => {
  return id.toString().toLowerCase();
};

// One read or write of the world: a few turns, as many as the seed draws.
const step: () => Promise<void> = async (): Promise<void> => {
  const turns: number = random(MOST_TURNS + 1);

  for (let turn: number = 0; turn < turns; turn++) {
    await Promise.resolve();
  }
};

const personOf: (id: unknown) => StoredPerson | undefined = (
  id: unknown,
): StoredPerson | undefined => {
  return people.get(keyOf(String(id)));
};

const isOwner: (userId: ObjectID) => boolean = (userId: ObjectID): boolean => {
  return OWNERS.some((owner: ObjectID): boolean => {
    return keyOf(owner) === keyOf(userId);
  });
};

// The world as each race starts it, and the seed it interleaves by.
const resetWorld: (seed: number) => void = (seed: number): void => {
  random = seededRandom(seed);

  people = new Map<string, StoredPerson>([
    [
      keyOf(PERSON_ID),
      {
        name: "Grace Hopper",
        email: "grace@acme.test",
        isMasterAdmin: false,
        settings: { ...EVERYTHING },
      },
    ],
    [
      keyOf(ADMIN_A_ID),
      {
        name: "Ada Admin",
        email: "ada@oneuptime.test",
        isMasterAdmin: true,
        settings: { ...NO_LOCAL_SIGN_IN_SETTINGS },
      },
    ],
    [
      keyOf(ADMIN_B_ID),
      {
        name: "Bea Admin",
        email: "bea@oneuptime.test",
        isMasterAdmin: true,
        settings: { ...NO_LOCAL_SIGN_IN_SETTINGS },
      },
    ],
    [
      keyOf(OWNER_A_ID),
      {
        name: "Olive Owner",
        email: "olive@acme.test",
        isMasterAdmin: false,
        settings: { ...NO_LOCAL_SIGN_IN_SETTINGS },
      },
    ],
    [
      keyOf(OWNER_B_ID),
      {
        name: "Otto Owner",
        email: "otto@acme.test",
        isMasterAdmin: false,
        settings: { ...NO_LOCAL_SIGN_IN_SETTINGS },
      },
    ],
  ]);

  memberships = [];

  for (const projectId of PROJECTS) {
    for (const userId of [PERSON_ID, ...OWNERS]) {
      memberships.push({ userId: userId, projectId: projectId });
    }
  }

  inserted = [];
  emailed = [];

  locks = new InMemoryLocks();
  locks.install();
};

const projectRow: (id: ObjectID) => Project | null = (
  id: ObjectID,
): Project | null => {
  if (
    !PROJECTS.some((projectId: ObjectID): boolean => {
      return keyOf(projectId) === keyOf(id);
    })
  ) {
    return null;
  }

  const row: Project = new Project();
  row._id = keyOf(id);
  row.name = keyOf(id) === keyOf(ACME_ID) ? "Acme" : "Acme Staging";
  row.requireSsoForLogin = true;
  row.manageSignInWithSso = true;
  row.enableAuditLogs = true;
  row.auditLogsRetentionInDays = 30;
  row.storeSystemEventsInAuditLogs = false;
  return row;
};

// The query of who has settings saved, as LocalSignInClearing builds it.
interface FakeQuery {
  where: () => FakeQuery;
  andWhere: (sql: string, parameters: Record<string, unknown>) => FakeQuery;
  select: () => FakeQuery;
  orderBy: () => FakeQuery;
  limit: (limit: number) => FakeQuery;
  getRawMany: () => Promise<Array<{ userId: string }>>;
}

const fakeQuery: () => FakeQuery = (): FakeQuery => {
  let asked: Array<string> | null = null;
  let most: number = Number.MAX_SAFE_INTEGER;

  const query: FakeQuery = {
    where: (): FakeQuery => {
      return query;
    },
    andWhere: (
      _sql: string,
      parameters: Record<string, unknown>,
    ): FakeQuery => {
      asked = ((parameters["userIds"] as Array<string>) || []).map(keyOf);
      return query;
    },
    select: (): FakeQuery => {
      return query;
    },
    orderBy: (): FakeQuery => {
      return query;
    },
    limit: (limit: number): FakeQuery => {
      most = limit;
      return query;
    },
    getRawMany: async (): Promise<Array<{ userId: string }>> => {
      await step();

      return Array.from(people.entries())
        .filter(([userId, stored]: [string, StoredPerson]): boolean => {
          return (
            !stored.isMasterAdmin &&
            hasLocalSignInSettings(stored.settings) &&
            (asked === null || asked.includes(userId))
          );
        })
        .map(([userId]: [string, StoredPerson]): string => {
          return userId;
        })
        .sort()
        .slice(0, most)
        .map((userId: string): { userId: string } => {
          return { userId: userId };
        });
    },
  };

  return query;
};

// Removes `field` - or, for the account's own columns, those - from these people.
const removeFrom: (
  ids: Array<string>,
  change: Partial<LocalSignInSettings>,
) => number = (
  ids: Array<string>,
  change: Partial<LocalSignInSettings>,
): number => {
  let count: number = 0;

  for (const id of ids) {
    const stored: StoredPerson | undefined = personOf(id);

    if (stored) {
      stored.settings = { ...stored.settings, ...change };
      count++;
    }
  }

  return count;
};

const standInTheWorld: () => void = (): void => {
  jest.spyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<User | null> => {
    await step();

    const stored: StoredPerson | undefined = personOf(data.id);

    if (!stored) {
      return null;
    }

    const user: User = new User();
    user._id = keyOf(data.id);
    user.name = new Name(stored.name);
    user.email = new Email(stored.email);
    user.isMasterAdmin = stored.isMasterAdmin;
    user.enableTwoFactorAuth = stored.settings.isTwoFactorAuthEnabled;

    if (stored.settings.hasPassword) {
      user.password = new HashedString("stored-hash", true);
    }

    if (stored.settings.hasPasswordResetLink) {
      user.resetPasswordToken = "stored-reset-token-hash";
      user.resetPasswordExpires = IN_A_DAY;
    }

    return user;
  }) as never);

  // The write's re-read of who is not a master admin.
  jest.spyOn(UserService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
  }): Promise<Array<User>> => {
    await step();

    return readQueryValues(data.query["_id"])
      .filter((id: string): boolean => {
        const stored: StoredPerson | undefined = personOf(id);

        return (
          Boolean(stored) &&
          (data.query["isMasterAdmin"] !== false || !stored!.isMasterAdmin)
        );
      })
      .map((id: string): User => {
        const user: User = new User();
        user._id = id;
        return user;
      });
  }) as never);

  jest.spyOn(UserService, "updateBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
  }): Promise<number> => {
    await step();

    return removeFrom(
      readQueryValues(data.query["_id"]).filter((id: string): boolean => {
        return (
          data.query["isMasterAdmin"] !== false || !personOf(id)?.isMasterAdmin
        );
      }),
      {
        hasPassword: false,
        hasPasswordResetLink: false,
        isTwoFactorAuthEnabled: false,
      },
    );
  }) as never);

  jest.spyOn(UserService, "getQueryBuilder").mockImplementation((() => {
    return fakeQuery();
  }) as never);

  jest.spyOn(UserTotpAuthService, "countBy").mockImplementation((async (data: {
    query: { userId: ObjectID };
  }): Promise<PositiveNumber> => {
    await step();
    return new PositiveNumber(
      personOf(data.query.userId)?.settings.authenticatorAppCount || 0,
    );
  }) as never);

  jest.spyOn(UserWebAuthnService, "countBy").mockImplementation((async (data: {
    query: { userId: ObjectID };
  }): Promise<PositiveNumber> => {
    await step();
    return new PositiveNumber(
      personOf(data.query.userId)?.settings.passkeyAndSecurityKeyCount || 0,
    );
  }) as never);

  jest
    .spyOn(UserTwoFactorBackupCodeService, "countUnusedForUser")
    .mockImplementation((async (data: {
      userId: ObjectID;
    }): Promise<number> => {
      await step();
      return personOf(data.userId)?.settings.backupCodeCount || 0;
    }) as never);

  for (const [service, change] of [
    [UserTotpAuthService, { authenticatorAppCount: 0 }],
    [UserWebAuthnService, { passkeyAndSecurityKeyCount: 0 }],
    [UserTwoFactorBackupCodeService, { backupCodeCount: 0 }],
  ] as Array<[{ deleteBy: unknown }, Partial<LocalSignInSettings>]>) {
    jest
      .spyOn(service as { deleteBy: () => Promise<number> }, "deleteBy")
      .mockImplementation((async (data: {
        query: Record<string, unknown>;
      }): Promise<number> => {
        await step();
        return removeFrom(readQueryValues(data.query["userId"]), change);
      }) as never);
  }

  jest.spyOn(TwoFactorWrongCodes, "forget").mockResolvedValue(undefined);

  jest
    .spyOn(UserSessionService, "endSessionsOfPeopleSignedInWithoutSso")
    .mockImplementation((async (userIds: Array<ObjectID>): Promise<number> => {
      await step();
      return userIds.length;
    }) as never);

  // By project (its accepted members), or by people (their memberships).
  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
    skip?: number;
  }): Promise<Array<TeamMember>> => {
    await step();

    if (Number(data.skip || 0) > 0) {
      return [];
    }

    return memberships
      .filter((membership: WorldMembership): boolean => {
        if (
          data.query["userId"] !== undefined &&
          !readQueryValues(data.query["userId"]).includes(
            keyOf(membership.userId),
          )
        ) {
          return false;
        }

        return (
          data.query["projectId"] === undefined ||
          keyOf(membership.projectId) ===
            keyOf(data.query["projectId"] as ObjectID)
        );
      })
      .map((membership: WorldMembership): TeamMember => {
        const row: TeamMember = new TeamMember();
        row._id = ObjectID.generate().toString();
        row.userId = membership.userId;
        row.projectId = membership.projectId;
        row.hasAcceptedInvitation = true;
        return row;
      });
  }) as never);

  // The rule reads both projects as managing sign-in; the recorder as recording audit logs.
  jest.spyOn(ProjectService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<Project | null> => {
    await step();
    return projectRow(data.id);
  }) as never);

  jest.spyOn(ProjectService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
  }): Promise<Array<Project>> => {
    await step();

    return readQueryValues(data.query["_id"])
      .map((id: string): Project | null => {
        return projectRow(new ObjectID(id));
      })
      .filter((row: Project | null): boolean => {
        return row !== null;
      }) as Array<Project>;
  }) as never);

  // Both owners own both projects.
  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockImplementation((async (
      userId: ObjectID,
    ): Promise<UserGlobalAccessPermission> => {
      return {
        _type: "UserGlobalAccessPermission",
        projectIds: isOwner(userId) ? PROJECTS : [],
        globalPermissions: [],
      };
    }) as never);

  jest
    .spyOn(AccessTokenService, "getUserTenantAccessPermissions")
    .mockImplementation((async (
      userId: ObjectID,
      projectIds: Array<ObjectID>,
    ): Promise<Map<string, UserTenantAccessPermission | null>> => {
      await step();

      return new Map<string, UserTenantAccessPermission | null>(
        projectIds.map(
          (
            projectId: ObjectID,
          ): [string, UserTenantAccessPermission | null] => {
            return [
              keyOf(projectId),
              isOwner(userId)
                ? {
                    _type: "UserTenantAccessPermission",
                    projectId: projectId,
                    permissions: [
                      {
                        _type: "UserPermission",
                        permission: Permission.ProjectOwner,
                        labelIds: [],
                      } as UserPermission,
                    ],
                  }
                : null,
            ];
          },
        ),
      );
    }) as never);

  jest.spyOn(SsoRequiredSignIn, "isSsoRequired").mockResolvedValue(true);

  jest.spyOn(SignInSettingsClearedEmail, "notify").mockImplementation((async (
    events: Array<SignInSettingsClearedEmailEvent>,
  ): Promise<void> => {
    emailed.push(...events);
  }) as never);

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation((() => {
      return undefined;
    }) as never);
  }
};

// One clear of a kind, by an actor of its own.
const clearOf: (kind: ClearKind, actorId: ObjectID) => Clear = (
  kind: ClearKind,
  actorId: ObjectID,
): Clear => {
  switch (kind) {
    case ClearKind.ServerAdminOnePerson:
      return {
        kind,
        actorId,
        clearedBy: SignInSettingsClearedBy.ServerAdmin,
        run: async (): Promise<boolean> => {
          return hasLocalSignInSettings(
            (
              await LocalSignInClearing.clearForPerson({
                userId: PERSON_ID,
                clearedByUserId: actorId,
                isMasterAdminConfirmed: false,
              })
            ).cleared,
          );
        },
      };
    case ClearKind.ServerAdminEveryone:
      return {
        kind,
        actorId,
        clearedBy: SignInSettingsClearedBy.ServerAdmin,
        run: async (): Promise<boolean> => {
          return (
            (await LocalSignInClearing.clearForEveryoneCoveredBySsoRequirement({
              clearedByUserId: actorId,
            })) > 0
          );
        },
      };
    case ClearKind.OwnerEveryone:
      return {
        kind,
        actorId,
        clearedBy: SignInSettingsClearedBy.ProjectOwner,
        run: async (): Promise<boolean> => {
          return (
            (await ProjectSignInClearing.clearForProject({
              projectId: ACME_ID,
              ownerUserId: actorId,
            })) > 0
          );
        },
      };
    case ClearKind.OwnerOneMember:
      return {
        kind,
        actorId,
        clearedBy: SignInSettingsClearedBy.ProjectOwner,
        run: async (): Promise<boolean> => {
          try {
            return (
              (await ProjectSignInClearing.clearMember({
                projectId: ACME_ID,
                ownerUserId: actorId,
                userId: PERSON_ID,
              })) === 1
            );
          } catch (err) {
            /*
             * The rule read after the other clear's write: nothing saved,
             * so nobody to clear - its own way of saying nothing was.
             */
            if (
              err instanceof BadDataException &&
              err.message === CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE
            ) {
              return false;
            }

            throw err;
          }
        },
      };
  }
};

const isServerAdminKind: (kind: ClearKind) => boolean = (
  kind: ClearKind,
): boolean => {
  return (
    kind === ClearKind.ServerAdminOnePerson ||
    kind === ClearKind.ServerAdminEveryone
  );
};

// Two clears with two actors of their own: two server admins, two owners, or one of each.
const pairOf: (first: ClearKind, second: ClearKind) => [Clear, Clear] = (
  first: ClearKind,
  second: ClearKind,
): [Clear, Clear] => {
  return [
    clearOf(first, isServerAdminKind(first) ? ADMIN_A_ID : OWNER_A_ID),
    clearOf(second, isServerAdminKind(second) ? ADMIN_B_ID : OWNER_B_ID),
  ];
};

// The person's entries in the audit log: where, and by whom.
const entriesOfPerson: () => Array<{
  projectId: string;
  actorId: string;
}> = (): Array<{ projectId: string; actorId: string }> => {
  return inserted
    .filter((entry: AuditLog): boolean => {
      return keyOf(String(entry.resourceId)) === keyOf(PERSON_ID);
    })
    .map((entry: AuditLog): { projectId: string; actorId: string } => {
      return {
        projectId: keyOf(String(entry.projectId)),
        actorId: keyOf(String(entry.userId)),
      };
    })
    .sort(
      (
        a: { projectId: string; actorId: string },
        b: { projectId: string; actorId: string },
      ): number => {
        return a.projectId.localeCompare(b.projectId);
      },
    );
};

// Runs the two at the same moment: whether each says it removed anything.
const race: (pair: [Clear, Clear]) => Promise<[boolean, boolean]> = async (
  pair: [Clear, Clear],
): Promise<[boolean, boolean]> => {
  const [first, second]: Array<boolean> = await Promise.all([
    pair[0].run(),
    pair[1].run(),
  ]);

  return [first === true, second === true];
};

const PAIRS: Array<[ClearKind, ClearKind]> = KINDS.flatMap(
  (first: ClearKind): Array<[ClearKind, ClearKind]> => {
    return KINDS.map((second: ClearKind): [ClearKind, ClearKind] => {
      return [first, second];
    });
  },
);

beforeEach(() => {
  // Self-hosted Enterprise Edition, with a license that covers audit logs.
  setTestBillingEnabled(false);

  resetWorld(SEEDS[0]!);
  standInTheWorld();

  const store: AuditLogStore = {
    create: jest.fn((async (createBy: { data: AuditLog }) => {
      inserted.push(createBy.data);
      return createBy.data;
    }) as never),
    createMany: jest.fn((async (createBy: { items: Array<AuditLog> }) => {
      inserted.push(...createBy.items);
      return createBy.items;
    }) as never),
  } as unknown as AuditLogStore;

  installFakeEnterpriseModule({
    auditLogRecorder: new AuditLogRecorder({ store: store }),
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("two clears of one person at the same moment", () => {
  test("one clear alone records the removal once in each of the person's projects, by its actor: the world the races run in", async () => {
    const [clear]: [Clear, Clear] = pairOf(
      ClearKind.OwnerOneMember,
      ClearKind.OwnerOneMember,
    );

    await expect(clear.run()).resolves.toBe(true);

    expect(entriesOfPerson()).toEqual(
      [ACME_ID, STAGING_ID]
        .map((projectId: ObjectID): string => {
          return keyOf(projectId);
        })
        .sort()
        .map((projectId: string): { projectId: string; actorId: string } => {
          return { projectId: projectId, actorId: keyOf(OWNER_A_ID) };
        }),
    );
    expect(emailed).toHaveLength(1);
    expect(hasLocalSignInSettings(personOf(PERSON_ID)!.settings)).toBe(false);
  });

  test.each(PAIRS)(
    "%s and %s: exactly one entry per project, by whichever removed the settings, and the other cleared nothing",
    async (firstKind: ClearKind, secondKind: ClearKind) => {
      let waitedForTheOther: number = 0;
      const winners: Set<string> = new Set<string>();

      for (const seed of SEEDS) {
        resetWorld(seed);

        const pair: [Clear, Clear] = pairOf(firstKind, secondKind);
        const removed: [boolean, boolean] = await race(pair);

        // Exactly one of them says it removed anything.
        expect({ seed, removed: removed.filter(Boolean).length }).toEqual({
          seed,
          removed: 1,
        });

        const winner: Clear = removed[0] ? pair[0] : pair[1];
        winners.add(keyOf(winner.actorId));

        // One entry in each of the person's projects, both by the clear that removed it.
        expect({ seed, entries: entriesOfPerson() }).toEqual({
          seed,
          entries: PROJECTS.map((projectId: ObjectID): string => {
            return keyOf(projectId);
          })
            .sort()
            .map(
              (projectId: string): { projectId: string; actorId: string } => {
                return {
                  projectId: projectId,
                  actorId: keyOf(winner.actorId),
                };
              },
            ),
        });

        // Emailed once, in the words of who removed it.
        expect({
          seed,
          emailed: emailed.map(
            (event: SignInSettingsClearedEmailEvent): string => {
              return `${keyOf(event.userId)}:${event.clearedBy}`;
            },
          ),
        }).toEqual({
          seed,
          emailed: [`${keyOf(PERSON_ID)}:${winner.clearedBy}`],
        });

        // And nothing of theirs is left, nor any lock held.
        expect(hasLocalSignInSettings(personOf(PERSON_ID)!.settings)).toBe(
          false,
        );
        expect(locks.isHeld(keyOf(PERSON_ID), CLEAR_LOCK_NAMESPACE)).toBe(
          false,
        );

        if (locks.eventsOf("wait").length > 0) {
          waitedForTheOther++;
        }
      }

      /*
       * The races really met: on some seeds one clear reached the person
       * while the other held them, and waited - the case the lock is for.
       */
      expect(waitedForTheOther).toBeGreaterThan(0);
      expect(winners.size).toBeGreaterThan(0);
    },
  );

  test("the control: unlocked - Valkey out of reach, as every clear was before #10776 - the same race records the removal twice", async () => {
    let recordedTwice: number = 0;

    for (const seed of SEEDS) {
      resetWorld(seed);
      locks.unreachable = true;

      await race(
        pairOf(ClearKind.ServerAdminOnePerson, ClearKind.OwnerOneMember),
      );

      if (entriesOfPerson().length > PROJECTS.length) {
        recordedTwice++;
      }
    }

    expect(recordedTwice).toBeGreaterThan(0);
  });
});
