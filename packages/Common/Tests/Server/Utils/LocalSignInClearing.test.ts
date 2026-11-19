jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

import AuditLogService from "../../../Server/Services/AuditLogService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserTwoFactorBackupCodeService from "../../../Server/Services/UserTwoFactorBackupCodeService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import LocalSignInClearing, {
  CLEAR_BATCH_SIZE,
  MAX_CLEAR_BATCHES,
} from "../../../Server/Utils/LocalSignInClearing";
import logger from "../../../Server/Utils/Logger";
import TwoFactorWrongCodes from "../../../Server/Utils/TwoFactorWrongCodes";
import User from "../../../Models/DatabaseModels/User";
import { SignInSettingsClearedAuditEvent } from "../../../Types/AuditLog/AuditLogSignInSettingsCleared";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  CLEAR_MASTER_ADMIN_SIGN_IN_NOT_CONFIRMED_MESSAGE,
  CLEAR_OWN_SIGN_IN_MESSAGE,
  CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
  ClearLocalSignInAnswer,
  LocalSignInSettings,
  NO_LOCAL_SIGN_IN_SETTINGS,
} from "../../../Types/SSO/LocalSignInClearing";
import { getJestSpyOn } from "../../Spy";
import { readQueryValues } from "../TestingUtils/SsoManagedProjects";
// The global jest: its mocks are the jest.Mock the fake query is typed with.
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * CLEARING THE SIGN-IN SETTINGS PEOPLE SAVED IN ONEUPTIME (issue #9762).
 *
 * LocalSignInClearing is what a master admin's Clear Sign-In Settings - for
 * one person, or for everyone the server's SSO requirement covers - does.
 * It cannot be undone, so each property it promises is pinned here, with
 * only the storage behind each write stood in:
 *
 *   - for one person: never the master admin's own account (asked before
 *     anything is read); another master admin's only when the request says
 *     so for that person; an account that does not exist is not found;
 *   - what goes: the password with its salt, reset link and sign-in link,
 *     and two-factor authentication, in one root write; every authenticator
 *     app, passkey, security key and backup code of exactly that person;
 *     the wrong codes counted against them; their sessions not signed in
 *     with SSO;
 *   - one audit-log entry per person cleared, by the master admin who
 *     cleared it, naming what was removed;
 *   - for everyone: refused while the server does not require SSO, or when
 *     the rule cannot be read; never a master admin - the query, the
 *     re-read of each batch and the write all leave them out, so somebody
 *     made one in the middle of a clear keeps their password and is not
 *     recorded as cleared; batch after batch, never the same people twice,
 *     never more than MAX_CLEAR_BATCHES batches.
 */

const ADMIN_ID: ObjectID = new ObjectID("aa000000-0000-4000-8000-000000000001");
const PERSON_ID: ObjectID = new ObjectID(
  "bb000000-0000-4000-8000-000000000001",
);

// What each person has, by id, as the reads below answer it.
interface StoredPerson {
  isMasterAdmin: boolean;
  settings: LocalSignInSettings;
}

let people: Map<string, StoredPerson>;

const EVERYTHING: LocalSignInSettings = {
  hasPassword: true,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 2,
  passkeyAndSecurityKeyCount: 1,
  backupCodeCount: 8,
};

const keyOf: (id: unknown) => string = (id: unknown): string => {
  return String(id).toLowerCase();
};

const person: (id: ObjectID | string) => StoredPerson | undefined = (
  id: ObjectID | string,
): StoredPerson | undefined => {
  return people.get(keyOf(id));
};

const store: (
  id: ObjectID,
  data: { isMasterAdmin?: boolean; settings?: LocalSignInSettings },
) => void = (
  id: ObjectID,
  data: { isMasterAdmin?: boolean; settings?: LocalSignInSettings },
): void => {
  people.set(keyOf(id), {
    isMasterAdmin: data.isMasterAdmin === true,
    settings: data.settings || EVERYTHING,
  });
};

/*
 * A stand-in for the query that finds the people the requirement covers who
 * have settings: it records the SQL it is handed, and answers each read of
 * a batch from a queue, a count from `count`.
 */
interface FakeQuery {
  where: jest.Mock;
  select: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
  getRawOne: jest.Mock;
  getRawMany: jest.Mock;
}

let whereSql: Array<string>;
let batches: Array<Array<string>>;
let count: number;
let limits: Array<number>;

const fakeQuery: () => FakeQuery = (): FakeQuery => {
  const query: FakeQuery = {} as FakeQuery;

  query.where = jest.fn((sql: string): FakeQuery => {
    whereSql.push(sql);
    return query;
  });
  query.select = jest.fn((): FakeQuery => {
    return query;
  });
  query.orderBy = jest.fn((): FakeQuery => {
    return query;
  });
  query.limit = jest.fn((limit: number): FakeQuery => {
    limits.push(limit);
    return query;
  });
  query.getRawOne = jest.fn(async (): Promise<{ peopleCount: string }> => {
    return { peopleCount: String(count) };
  });
  query.getRawMany = jest.fn(async (): Promise<Array<{ userId: string }>> => {
    return (batches.shift() || []).map((userId: string): { userId: string } => {
      return { userId: userId };
    });
  });

  return query;
};

let findOneById: jest.SpyInstance;
let findBy: jest.SpyInstance;
let updateBy: jest.SpyInstance;
let deleteApps: jest.SpyInstance;
let deleteKeys: jest.SpyInstance;
let deleteCodes: jest.SpyInstance;
let forgetWrongCodes: jest.SpyInstance;
let endSessions: jest.SpyInstance;
let recordCleared: jest.SpyInstance;
let getRequireSsoForLogin: jest.SpyInstance;
let getQueryBuilder: jest.SpyInstance;

beforeEach(() => {
  people = new Map<string, StoredPerson>();
  whereSql = [];
  batches = [];
  count = 0;
  limits = [];

  store(PERSON_ID, {});
  store(ADMIN_ID, { isMasterAdmin: true });

  findOneById = getJestSpyOn(UserService, "findOneById").mockImplementation(
    async (data: { id: ObjectID }): Promise<User | null> => {
      const stored: StoredPerson | undefined = person(data.id);

      if (!stored) {
        return null;
      }

      const user: User = new User();
      user._id = data.id.toString();
      user.isMasterAdmin = stored.isMasterAdmin;
      user.enableTwoFactorAuth = stored.settings.isTwoFactorAuthEnabled;

      if (stored.settings.hasPassword) {
        user.password = new HashedString("stored-hash", true);
      }

      return user;
    },
  );

  // The re-read of a batch: those of them who are not master admins.
  findBy = getJestSpyOn(UserService, "findBy").mockImplementation(
    async (data: { query: Record<string, unknown> }): Promise<Array<User>> => {
      return readQueryValues(data.query["_id"])
        .filter((id: string): boolean => {
          const stored: StoredPerson | undefined = person(id);
          return Boolean(stored) && !stored!.isMasterAdmin;
        })
        .map((id: string): User => {
          const user: User = new User();
          user._id = id;
          return user;
        });
    },
  );

  getJestSpyOn(UserTotpAuthService, "countBy").mockImplementation(
    async (data: { query: { userId: ObjectID } }): Promise<PositiveNumber> => {
      return new PositiveNumber(
        person(data.query.userId)?.settings.authenticatorAppCount || 0,
      );
    },
  );
  getJestSpyOn(UserWebAuthnService, "countBy").mockImplementation(
    async (data: { query: { userId: ObjectID } }): Promise<PositiveNumber> => {
      return new PositiveNumber(
        person(data.query.userId)?.settings.passkeyAndSecurityKeyCount || 0,
      );
    },
  );
  getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "countUnusedForUser",
  ).mockImplementation(async (data: { userId: ObjectID }): Promise<number> => {
    return person(data.userId)?.settings.backupCodeCount || 0;
  });

  updateBy = getJestSpyOn(UserService, "updateBy").mockResolvedValue(1);
  deleteApps = getJestSpyOn(UserTotpAuthService, "deleteBy").mockResolvedValue(
    1,
  );
  deleteKeys = getJestSpyOn(UserWebAuthnService, "deleteBy").mockResolvedValue(
    1,
  );
  deleteCodes = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "deleteBy",
  ).mockResolvedValue(1);
  forgetWrongCodes = getJestSpyOn(
    TwoFactorWrongCodes,
    "forget",
  ).mockResolvedValue(undefined);
  endSessions = getJestSpyOn(
    UserSessionService,
    "endSessionsOfPeopleSignedInWithoutSso",
  ).mockResolvedValue(2);
  recordCleared = getJestSpyOn(
    AuditLogService,
    "recordSignInSettingsCleared",
  ).mockResolvedValue(undefined);
  getRequireSsoForLogin = getJestSpyOn(
    GlobalConfigService,
    "getRequireSsoForLogin",
  ).mockResolvedValue(true);
  getQueryBuilder = getJestSpyOn(
    UserService,
    "getQueryBuilder",
  ).mockImplementation((): FakeQuery => {
    return fakeQuery();
  });

  getJestSpyOn(logger, "info").mockImplementation((): void => {});
  getJestSpyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The ids a write or delete names in its query, lower-cased.
const idsIn: (
  spy: jest.SpyInstance,
  callIndex: number,
  key: string,
) => Array<string> = (
  spy: jest.SpyInstance,
  callIndex: number,
  key: string,
): Array<string> => {
  return readQueryValues(
    (spy.mock.calls[callIndex]![0] as { query: Record<string, unknown> }).query[
      key
    ],
  );
};

const nothingCleared: () => void = (): void => {
  expect(updateBy).not.toHaveBeenCalled();
  expect(deleteApps).not.toHaveBeenCalled();
  expect(deleteKeys).not.toHaveBeenCalled();
  expect(deleteCodes).not.toHaveBeenCalled();
  expect(endSessions).not.toHaveBeenCalled();
  expect(recordCleared).not.toHaveBeenCalled();
};

describe("LocalSignInClearing.readSettings: what one person has saved", () => {
  test("reads the password and the switch from the account, as OneUptime, and counts the rest", async () => {
    await expect(LocalSignInClearing.readSettings(PERSON_ID)).resolves.toEqual(
      EVERYTHING,
    );

    const call: Record<string, unknown> = findOneById.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(call["select"]).toEqual({
      _id: true,
      password: true,
      enableTwoFactorAuth: true,
    });
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("counts every authenticator app, set up or not: each holds a secret", async () => {
    await LocalSignInClearing.readSettings(PERSON_ID);

    const query: Record<string, unknown> = (
      (UserTotpAuthService.countBy as unknown as jest.Mock).mock
        .calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;
    expect(Object.keys(query)).toEqual(["userId"]);
  });

  test("an account with nothing saved has nothing", async () => {
    store(PERSON_ID, { settings: NO_LOCAL_SIGN_IN_SETTINGS });

    await expect(LocalSignInClearing.readSettings(PERSON_ID)).resolves.toEqual(
      NO_LOCAL_SIGN_IN_SETTINGS,
    );
  });

  test("an account that does not exist is not found", async () => {
    await expect(
      LocalSignInClearing.readSettings(ObjectID.generate()),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("LocalSignInClearing.clearForPerson", () => {
  const clear: (data?: {
    userId?: ObjectID;
    clearedByUserId?: ObjectID;
    isMasterAdminConfirmed?: boolean;
  }) => Promise<ClearLocalSignInAnswer> = async (
    data: {
      userId?: ObjectID;
      clearedByUserId?: ObjectID;
      isMasterAdminConfirmed?: boolean;
    } = {},
  ): Promise<ClearLocalSignInAnswer> => {
    return await LocalSignInClearing.clearForPerson({
      userId: data.userId || PERSON_ID,
      clearedByUserId: data.clearedByUserId || ADMIN_ID,
      isMasterAdminConfirmed: data.isMasterAdminConfirmed === true,
    });
  };

  test("clears everything the person had, and says what and how many sessions ended", async () => {
    await expect(clear()).resolves.toEqual({
      cleared: EVERYTHING,
      sessionsEnded: 2,
    });
  });

  test("the password, its salt, its links and the switch go in one root write, of that person only", async () => {
    await clear();

    expect(updateBy).toHaveBeenCalledTimes(1);
    const call: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      props: Record<string, unknown>;
      limit: number;
    } = updateBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      props: Record<string, unknown>;
      limit: number;
    };

    expect(idsIn(updateBy, 0, "_id")).toEqual([keyOf(PERSON_ID)]);
    // Not a master admin: the write leaves master admins out too.
    expect(call.query["isMasterAdmin"]).toBe(false);
    expect(call.data).toEqual({
      password: null,
      passwordSalt: null,
      resetPasswordToken: null,
      resetPasswordExpires: null,
      magicLinkToken: null,
      magicLinkExpires: null,
      enableTwoFactorAuth: false,
    });
    expect(call.props).toEqual({ isRoot: true });
    expect(call.limit).toBe(1);
  });

  test("every authenticator app, passkey, security key and backup code of exactly that person goes", async () => {
    await clear();

    for (const spy of [deleteApps, deleteKeys, deleteCodes]) {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(idsIn(spy, 0, "userId")).toEqual([keyOf(PERSON_ID)]);
      const call: { query: Record<string, unknown>; props: unknown } = spy.mock
        .calls[0]![0] as { query: Record<string, unknown>; props: unknown };
      // Nothing narrows it: set up or not, passkey or key, spent or not.
      expect(Object.keys(call.query)).toEqual(["userId"]);
      expect(call.props).toEqual({ isRoot: true });
    }
  });

  test("the wrong codes counted against the second steps that are gone are forgotten", async () => {
    await clear();

    expect(forgetWrongCodes).toHaveBeenCalledTimes(1);
    expect(String(forgetWrongCodes.mock.calls[0]![0])).toBe(
      PERSON_ID.toString(),
    );
  });

  test("their sessions not signed in with SSO end, theirs alone", async () => {
    await clear();

    expect(endSessions).toHaveBeenCalledTimes(1);
    const userIds: Array<ObjectID> = endSessions.mock
      .calls[0]![0] as Array<ObjectID>;
    expect(
      userIds.map((id: ObjectID): string => {
        return keyOf(id);
      }),
    ).toEqual([keyOf(PERSON_ID)]);
  });

  test("records exactly one audit entry, by the master admin who cleared it, naming what was removed", async () => {
    await clear();

    expect(recordCleared).toHaveBeenCalledTimes(1);
    const events: Array<SignInSettingsClearedAuditEvent> = recordCleared.mock
      .calls[0]![0] as Array<SignInSettingsClearedAuditEvent>;
    expect(events).toHaveLength(1);
    expect(events[0]!.userId.toString()).toBe(PERSON_ID.toString());
    expect(events[0]!.clearedByUserId.toString()).toBe(ADMIN_ID.toString());
    expect(events[0]!.cleared).toEqual(EVERYTHING);
  });

  test("what was there is read before anything is cleared", async () => {
    const order: Array<string> = [];

    (UserTotpAuthService.countBy as unknown as jest.Mock).mockImplementation(
      async (): Promise<PositiveNumber> => {
        order.push("read");
        return new PositiveNumber(1);
      },
    );
    updateBy.mockImplementation(async (): Promise<number> => {
      order.push("write");
      return 1;
    });

    await clear();

    expect(order).toEqual(["read", "write"]);
  });

  test("never the master admin's own account: refused before anything is read, and nothing is cleared", async () => {
    await expect(
      clear({ userId: ADMIN_ID, clearedByUserId: ADMIN_ID }),
    ).rejects.toThrow(new BadDataException(CLEAR_OWN_SIGN_IN_MESSAGE));

    expect(findOneById).not.toHaveBeenCalled();
    nothingCleared();
  });

  test("never their own account, however its id is spelled: an id in capitals is the same account", async () => {
    // The path accepts an id in any case, and Postgres compares ids so.
    const spelledInCapitals: ObjectID = new ObjectID(
      ADMIN_ID.toString().toUpperCase(),
    );

    await expect(
      clear({
        userId: spelledInCapitals,
        clearedByUserId: ADMIN_ID,
        isMasterAdminConfirmed: true,
      }),
    ).rejects.toThrow(CLEAR_OWN_SIGN_IN_MESSAGE);
    nothingCleared();
  });

  test("never their own account, even when the request confirms a master admin's", async () => {
    await expect(
      clear({
        userId: ADMIN_ID,
        clearedByUserId: ADMIN_ID,
        isMasterAdminConfirmed: true,
      }),
    ).rejects.toThrow(CLEAR_OWN_SIGN_IN_MESSAGE);
    nothingCleared();
  });

  test("another master admin's is refused unless the request says so for that person, and nothing is cleared", async () => {
    const otherAdmin: ObjectID = ObjectID.generate();
    store(otherAdmin, { isMasterAdmin: true });

    await expect(clear({ userId: otherAdmin })).rejects.toThrow(
      new BadDataException(CLEAR_MASTER_ADMIN_SIGN_IN_NOT_CONFIRMED_MESSAGE),
    );
    nothingCleared();
  });

  test("another master admin's is cleared when the request confirms it, the write not leaving them out", async () => {
    const otherAdmin: ObjectID = ObjectID.generate();
    store(otherAdmin, { isMasterAdmin: true });

    await expect(
      clear({ userId: otherAdmin, isMasterAdminConfirmed: true }),
    ).resolves.toEqual({ cleared: EVERYTHING, sessionsEnded: 2 });

    const call: { query: Record<string, unknown> } = updateBy.mock
      .calls[0]![0] as { query: Record<string, unknown> };
    expect(call.query).not.toHaveProperty("isMasterAdmin");
    expect(idsIn(updateBy, 0, "_id")).toEqual([keyOf(otherAdmin)]);
    // They are not read again as "not a master admin" and dropped.
    expect(findBy).not.toHaveBeenCalled();
    expect(recordCleared).toHaveBeenCalledTimes(1);
  });

  test("confirming a master admin changes nothing for someone who is not one", async () => {
    await clear({ isMasterAdminConfirmed: true });

    const call: { query: Record<string, unknown> } = updateBy.mock
      .calls[0]![0] as { query: Record<string, unknown> };
    // Read again: a master admin made one meanwhile would be left out.
    expect(call.query["isMasterAdmin"]).toBe(false);
  });

  test("an account that does not exist is not found, and nothing is cleared", async () => {
    await expect(clear({ userId: ObjectID.generate() })).rejects.toThrow(
      NotFoundException,
    );
    nothingCleared();
  });

  test("someone with nothing saved is cleared all the same, and the entry says nothing was there", async () => {
    store(PERSON_ID, { settings: NO_LOCAL_SIGN_IN_SETTINGS });

    await expect(clear()).resolves.toEqual({
      cleared: NO_LOCAL_SIGN_IN_SETTINGS,
      sessionsEnded: 2,
    });
    const events: Array<SignInSettingsClearedAuditEvent> = recordCleared.mock
      .calls[0]![0] as Array<SignInSettingsClearedAuditEvent>;
    expect(events[0]!.cleared).toEqual(NO_LOCAL_SIGN_IN_SETTINGS);
  });

  test("a write that fails is told, never answered as cleared", async () => {
    updateBy.mockRejectedValue(new Error("connection refused"));

    await expect(clear()).rejects.toThrow("connection refused");
    expect(recordCleared).not.toHaveBeenCalled();
  });

  test("whether the server requires SSO does not matter for one person", async () => {
    getRequireSsoForLogin.mockResolvedValue(false);

    await expect(clear()).resolves.toEqual({
      cleared: EVERYTHING,
      sessionsEnded: 2,
    });
  });
});

describe("LocalSignInClearing.countPeopleCoveredBySsoRequirement", () => {
  test("counts the people the query finds", async () => {
    count = 41;

    await expect(
      LocalSignInClearing.countPeopleCoveredBySsoRequirement(),
    ).resolves.toBe(41);
  });

  test("an empty answer is nobody", async () => {
    count = 0;

    await expect(
      LocalSignInClearing.countPeopleCoveredBySsoRequirement(),
    ).resolves.toBe(0);
  });

  test("the query leaves out master admins and deleted people, and covers every kind of setting", async () => {
    await LocalSignInClearing.countPeopleCoveredBySsoRequirement();

    expect(getQueryBuilder).toHaveBeenCalledWith("person");
    expect(whereSql).toHaveLength(1);
    const sql: string = whereSql[0]!.replace(/\s+/g, " ");

    expect(sql).toContain('"person"."isMasterAdmin" = false');
    expect(sql).toContain('"person"."deletedAt" IS NULL');
    expect(sql).toContain('"person"."password" IS NOT NULL');
    expect(sql).toContain('"person"."enableTwoFactorAuth" = true');
    // A reset link that still works sets a password: it counts.
    expect(sql).toContain(
      '"person"."resetPasswordToken" IS NOT NULL AND "person"."resetPasswordExpires" > NOW()',
    );
    expect(sql).toContain('FROM "UserTotpAuth"');
    expect(sql).toContain('FROM "UserWebAuthn"');
    expect(sql).toContain('FROM "UserTwoFactorBackupCode"');
    // A spent backup code signs nobody in.
    expect(sql).toContain('"code"."usedAt" IS NULL');
  });
});

describe("LocalSignInClearing.clearForEveryoneCoveredBySsoRequirement", () => {
  const clearEveryone: () => Promise<number> = async (): Promise<number> => {
    return await LocalSignInClearing.clearForEveryoneCoveredBySsoRequirement({
      clearedByUserId: ADMIN_ID,
    });
  };

  const someone: () => ObjectID = (): ObjectID => {
    const id: ObjectID = ObjectID.generate();
    store(id, {});
    return id;
  };

  test("is refused while the server does not require SSO, and nothing is read or cleared", async () => {
    getRequireSsoForLogin.mockResolvedValue(false);

    await expect(clearEveryone()).rejects.toThrow(
      new BadDataException(
        CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
      ),
    );
    expect(getQueryBuilder).not.toHaveBeenCalled();
    nothingCleared();
  });

  test("is refused when the rule cannot be read: never 'not required', and nothing is cleared", async () => {
    getRequireSsoForLogin.mockRejectedValue(new Error("connection refused"));

    await expect(clearEveryone()).rejects.toThrow("connection refused");
    expect(getQueryBuilder).not.toHaveBeenCalled();
    nothingCleared();
  });

  test("nobody with anything saved clears nobody", async () => {
    batches = [[]];

    await expect(clearEveryone()).resolves.toBe(0);
    nothingCleared();
  });

  test("clears each person the query finds, and records one entry each by the master admin", async () => {
    const first: ObjectID = someone();
    const second: ObjectID = someone();
    batches = [[first.toString(), second.toString()]];

    await expect(clearEveryone()).resolves.toBe(2);

    expect(idsIn(updateBy, 0, "_id").sort()).toEqual(
      [keyOf(first), keyOf(second)].sort(),
    );
    expect(
      (updateBy.mock.calls[0]![0] as { query: Record<string, unknown> }).query[
        "isMasterAdmin"
      ],
    ).toBe(false);

    for (const spy of [deleteApps, deleteKeys, deleteCodes]) {
      expect(idsIn(spy, 0, "userId").sort()).toEqual(
        [keyOf(first), keyOf(second)].sort(),
      );
    }

    expect(recordCleared).toHaveBeenCalledTimes(1);
    const events: Array<SignInSettingsClearedAuditEvent> = recordCleared.mock
      .calls[0]![0] as Array<SignInSettingsClearedAuditEvent>;
    expect(
      events
        .map((event: SignInSettingsClearedAuditEvent): string => {
          return keyOf(event.userId);
        })
        .sort(),
    ).toEqual([keyOf(first), keyOf(second)].sort());

    for (const event of events) {
      expect(event.clearedByUserId.toString()).toBe(ADMIN_ID.toString());
      expect(event.cleared).toEqual(EVERYTHING);
    }
  });

  test("reads the people in batches of CLEAR_BATCH_SIZE, the query leaving master admins out", async () => {
    batches = [[someone().toString()]];

    await clearEveryone();

    expect(limits).toEqual([CLEAR_BATCH_SIZE]);
    expect(whereSql[0]).toContain('"person"."isMasterAdmin" = false');
  });

  test("works through full batches until one comes back short", async () => {
    const full: Array<string> = Array.from(
      { length: CLEAR_BATCH_SIZE },
      (): string => {
        return someone().toString();
      },
    );
    const last: Array<string> = [someone().toString()];
    batches = [full, last];

    await expect(clearEveryone()).resolves.toBe(CLEAR_BATCH_SIZE + 1);
    expect(updateBy).toHaveBeenCalledTimes(2);
    expect(recordCleared).toHaveBeenCalledTimes(2);
  });

  test("a master admin made one in the middle of a clear is never cleared, nor recorded as cleared", async () => {
    const plain: ObjectID = someone();
    const promoted: ObjectID = someone();
    batches = [[plain.toString(), promoted.toString()]];

    // Made a master admin after the batch was read, before it is cleared.
    store(promoted, { isMasterAdmin: true });

    await expect(clearEveryone()).resolves.toBe(1);

    expect(idsIn(updateBy, 0, "_id")).toEqual([keyOf(plain)]);
    for (const spy of [deleteApps, deleteKeys, deleteCodes]) {
      expect(idsIn(spy, 0, "userId")).toEqual([keyOf(plain)]);
    }
    const events: Array<SignInSettingsClearedAuditEvent> = recordCleared.mock
      .calls[0]![0] as Array<SignInSettingsClearedAuditEvent>;
    expect(
      events.map((event: SignInSettingsClearedAuditEvent): string => {
        return keyOf(event.userId);
      }),
    ).toEqual([keyOf(plain)]);
  });

  test("a batch of only master admins clears nothing and records nothing", async () => {
    const promoted: ObjectID = someone();
    store(promoted, { isMasterAdmin: true });
    batches = [[promoted.toString()]];

    await expect(clearEveryone()).resolves.toBe(0);
    expect(updateBy).not.toHaveBeenCalled();
    expect(recordCleared).toHaveBeenCalledWith([]);
  });

  test("never clears the same people twice, even when something keeps putting their settings back", async () => {
    const stubborn: Array<string> = Array.from(
      { length: CLEAR_BATCH_SIZE },
      (): string => {
        return someone().toString();
      },
    );
    // The query keeps finding the very same people.
    batches = [stubborn, stubborn, stubborn];

    await expect(clearEveryone()).resolves.toBe(CLEAR_BATCH_SIZE);
    expect(updateBy).toHaveBeenCalledTimes(1);
  });

  test("stops after MAX_CLEAR_BATCHES batches", async () => {
    const query: FakeQuery = fakeQuery();
    let next: number = 0;

    query.getRawMany = jest.fn(async (): Promise<Array<{ userId: string }>> => {
      // A full batch of new people, every time.
      return Array.from(
        { length: CLEAR_BATCH_SIZE },
        (): {
          userId: string;
        } => {
          next++;
          return {
            userId: `cc000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
          };
        },
      );
    });
    getQueryBuilder.mockReturnValue(query);
    // Every one of them is cleared: nobody is a master admin.
    findBy.mockImplementation(
      async (data: {
        query: Record<string, unknown>;
      }): Promise<Array<User>> => {
        return readQueryValues(data.query["_id"]).map((id: string): User => {
          const user: User = new User();
          user._id = id;
          return user;
        });
      },
    );
    getJestSpyOn(LocalSignInClearing, "readSettings").mockResolvedValue(
      EVERYTHING,
    );

    await expect(clearEveryone()).resolves.toBe(
      MAX_CLEAR_BATCHES * CLEAR_BATCH_SIZE,
    );
    expect(query.getRawMany).toHaveBeenCalledTimes(MAX_CLEAR_BATCHES);
  }, 120000);

  test("says in the server's log who cleared how many", async () => {
    batches = [[someone().toString()]];

    await clearEveryone();

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(ADMIN_ID.toString()),
    );
  });
});
