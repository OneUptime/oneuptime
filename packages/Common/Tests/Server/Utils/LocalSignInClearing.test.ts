jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

import DatabaseConfig from "../../../Server/DatabaseConfig";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Queue, { QueueName } from "../../../Server/Infrastructure/Queue";
import AuditLogService from "../../../Server/Services/AuditLogService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import MailService from "../../../Server/Services/MailService";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserTwoFactorBackupCodeService from "../../../Server/Services/UserTwoFactorBackupCodeService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import LocalSignInClearing, {
  CLEAR_BATCH_SIZE,
  isPasswordResetLinkWorking,
  MAX_CLEAR_BATCHES,
} from "../../../Server/Utils/LocalSignInClearing";
import logger from "../../../Server/Utils/Logger";
import SignInSettingsClearedEmail, {
  EMAIL_ENQUEUE_TIMEOUT_IN_MS,
  SIGN_IN_SETTINGS_CLEARED_EMAIL_JOB,
  SignInSettingsClearedEmailEvent,
} from "../../../Server/Utils/SignInSettingsClearedEmail";
import SsoManagedSignIn from "../../../Server/Utils/SsoManagedSignIn";
import TwoFactorWrongCodes from "../../../Server/Utils/TwoFactorWrongCodes";
import User from "../../../Models/DatabaseModels/User";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Email from "../../../Types/Email";
import {
  getSignInSettingsClearedChanges,
  SignInSettingsClearedAuditEvent,
  SignInSettingsClearedField,
} from "../../../Types/AuditLog/AuditLogSignInSettingsCleared";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
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
  hasLocalSignInSettings,
  LocalSignInSettings,
  NO_LOCAL_SIGN_IN_SETTINGS,
} from "../../../Types/SSO/LocalSignInClearing";
import { SignInSettingsClearedBy } from "../../../Types/SSO/SignInSettingsClearedEmail";
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
 *   - one email per person cleared, handed over once they are cleared and
 *     recorded, and never waited for (#9818): the emails themselves are
 *     SignInSettingsClearedEmail's, pinned in its own suite;
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
  /*
   * When the reset link the settings say they have runs out: in a day,
   * unless a test says otherwise (an expired link, or a link with none).
   */
  resetPasswordExpires?: Date | null | undefined;
}

let people: Map<string, StoredPerson>;

const EVERYTHING: LocalSignInSettings = {
  hasPassword: true,
  hasPasswordResetLink: true,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 2,
  passkeyAndSecurityKeyCount: 1,
  backupCodeCount: 8,
};

// A day from now and a day ago: a reset link that works, and one that ran out.
const IN_A_DAY: Date = new Date(Date.now() + 24 * 60 * 60 * 1000);
const A_DAY_AGO: Date = new Date(Date.now() - 24 * 60 * 60 * 1000);

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
  data: {
    isMasterAdmin?: boolean;
    settings?: LocalSignInSettings;
    resetPasswordExpires?: Date | null | undefined;
  },
) => void = (
  id: ObjectID,
  data: {
    isMasterAdmin?: boolean;
    settings?: LocalSignInSettings;
    resetPasswordExpires?: Date | null | undefined;
  },
): void => {
  people.set(keyOf(id), {
    isMasterAdmin: data.isMasterAdmin === true,
    settings: data.settings || EVERYTHING,
    resetPasswordExpires:
      "resetPasswordExpires" in data ? data.resetPasswordExpires : IN_A_DAY,
  });
};

/*
 * A stand-in for the query that finds the people the requirement covers who
 * have settings: it records the SQL it is handed, and answers each read of
 * a batch from a queue, a count from `count`.
 */
interface FakeQuery {
  where: jest.Mock;
  andWhere: jest.Mock;
  select: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
  getRawOne: jest.Mock;
  getRawMany: jest.Mock;
}

let whereSql: Array<string>;
// Each andWhere: its SQL and its parameters.
let andWheres: Array<{ sql: string; parameters: Record<string, unknown> }>;
let batches: Array<Array<string>>;
let count: number;
let limits: Array<number>;

const fakeQuery: () => FakeQuery = (): FakeQuery => {
  const query: FakeQuery = {} as FakeQuery;

  query.where = jest.fn((sql: string): FakeQuery => {
    whereSql.push(sql);
    return query;
  });
  query.andWhere = jest.fn(
    (sql: string, parameters: Record<string, unknown>): FakeQuery => {
      andWheres.push({ sql: sql, parameters: parameters });
      return query;
    },
  );
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
let notifyCleared: jest.SpyInstance;
let getRequireSsoForLogin: jest.SpyInstance;
let getQueryBuilder: jest.SpyInstance;

beforeEach(() => {
  people = new Map<string, StoredPerson>();
  whereSql = [];
  andWheres = [];
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

      // A reset link's token, kept as its hash, and when it runs out.
      if (stored.settings.hasPasswordResetLink) {
        user.resetPasswordToken = "stored-reset-token-hash";
        user.resetPasswordExpires = stored.resetPasswordExpires as Date;
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
  notifyCleared = getJestSpyOn(
    SignInSettingsClearedEmail,
    "notify",
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
  expect(notifyCleared).not.toHaveBeenCalled();
};

/*
 * Under fake timers: lets the work run, a promise step at a time, until it
 * has set `count` timers - the queue's time limits a clear waits on - and
 * fails if it never does, rather than hang.
 */
const untilTimersAreSet: (count: number) => Promise<void> = async (
  count: number,
): Promise<void> => {
  for (let step: number = 0; step < 100000; step++) {
    if (jest.getTimerCount() >= count) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error(`The work never set ${count} timer(s).`);
};

// The people each email batch was handed, by call, lower-cased.
const emailedIds: () => Array<Array<string>> = (): Array<Array<string>> => {
  return notifyCleared.mock.calls.map((call: Array<unknown>): Array<string> => {
    return (call[0] as Array<SignInSettingsClearedEmailEvent>).map(
      (event: SignInSettingsClearedEmailEvent): string => {
        return keyOf(event.userId);
      },
    );
  });
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
      resetPasswordToken: true,
      resetPasswordExpires: true,
      enableTwoFactorAuth: true,
    });
    expect(call["props"]).toEqual({ isRoot: true });
  });

  /*
   * #9992: the count of people with settings saved counts a reset link
   * that still works, and the clear removes it - but what a clear reported
   * had no field for it, so somebody whose only saved setting it was was
   * cleared with no email and no audit entry.
   */
  test("a password reset link that still works is read, as the count reads it (#9992)", async () => {
    store(PERSON_ID, {
      settings: { ...NO_LOCAL_SIGN_IN_SETTINGS, hasPasswordResetLink: true },
    });

    await expect(LocalSignInClearing.readSettings(PERSON_ID)).resolves.toEqual(
      { ...NO_LOCAL_SIGN_IN_SETTINGS, hasPasswordResetLink: true },
    );
  });

  test.each([
    ["a link that ran out", A_DAY_AGO],
    ["a link with no expiry", null],
  ])(
    "%s signs nobody in, is not counted, and is not reported",
    async (_label: string, expires: Date | null) => {
      store(PERSON_ID, {
        settings: { ...NO_LOCAL_SIGN_IN_SETTINGS, hasPasswordResetLink: true },
        resetPasswordExpires: expires,
      });

      await expect(
        LocalSignInClearing.readSettings(PERSON_ID),
      ).resolves.toEqual(NO_LOCAL_SIGN_IN_SETTINGS);
    },
  );
});

describe("isPasswordResetLinkWorking: a reset link, as the count's SQL reads it (#9992)", () => {
  const now: Date = new Date("2026-11-22T10:00:00.000Z");

  test.each([
    ["a token and an expiry still to come", "hash", "2026-11-22T10:00:01.000Z", true],
    ["no token", null, "2026-11-23T10:00:00.000Z", false],
    ["a token never stored", undefined, "2026-11-23T10:00:00.000Z", false],
    ["no expiry", "hash", null, false],
    ["an expiry this very moment", "hash", "2026-11-22T10:00:00.000Z", false],
    ["an expiry past", "hash", "2026-11-21T10:00:00.000Z", false],
    ["an expiry that is no date", "hash", "not a date", false],
  ])(
    "%s",
    (
      _label: string,
      token: string | null | undefined,
      expires: string | null,
      isWorking: boolean,
    ) => {
      expect(
        isPasswordResetLinkWorking({
          resetPasswordToken: token,
          resetPasswordExpires: expires === null ? null : new Date(expires),
          now: now,
        }),
      ).toBe(isWorking);
    },
  );

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

  describe("the email (#9818)", () => {
    test("the person is emailed what was removed, as cleared by a server admin, and nobody else", async () => {
      await clear();

      expect(notifyCleared).toHaveBeenCalledTimes(1);
      const events: Array<SignInSettingsClearedEmailEvent> = notifyCleared.mock
        .calls[0]![0] as Array<SignInSettingsClearedEmailEvent>;
      expect(events).toHaveLength(1);
      expect(keyOf(events[0]!.userId)).toBe(keyOf(PERSON_ID));
      expect(events[0]!.cleared).toEqual(EVERYTHING);
      expect(events[0]!.clearedBy).toBe(SignInSettingsClearedBy.ServerAdmin);
      // Never the master admin who cleared it.
      expect(JSON.stringify(events)).not.toContain(ADMIN_ID.toString());
    });

    test("is handed over only once the settings are cleared and recorded", async () => {
      const order: Array<string> = [];

      endSessions.mockImplementation(async (): Promise<number> => {
        order.push("sessions");
        return 2;
      });
      recordCleared.mockImplementation(async (): Promise<void> => {
        order.push("audit");
      });
      notifyCleared.mockImplementation(async (): Promise<void> => {
        order.push("email");
      });

      await clear();

      expect(order).toEqual(["sessions", "audit", "email"]);
    });

    test("the clear waits for its email to be queued, never for it to be sent (#9991)", async () => {
      // The real sender: it queues a job, and a worker sends it.
      notifyCleared.mockRestore();
      const addJob: jest.SpyInstance = getJestSpyOn(
        Queue,
        "addJob",
      ).mockResolvedValue({} as never);
      const sendMail: jest.SpyInstance = getJestSpyOn(MailService, "sendMail");

      await expect(clear()).resolves.toEqual({
        cleared: EVERYTHING,
        sessionsEnded: 2,
      });

      expect(addJob).toHaveBeenCalledTimes(1);
      expect(addJob.mock.calls[0]![0]).toBe(QueueName.Worker);
      expect(addJob.mock.calls[0]![2]).toBe(SIGN_IN_SETTINGS_CLEARED_EMAIL_JOB);
      expect(sendMail).not.toHaveBeenCalled();
    });

    test("a queue that does not answer holds the clear up EMAIL_ENQUEUE_TIMEOUT_IN_MS at most, and never fails it", async () => {
      notifyCleared.mockRestore();
      // Redis gone: the job is never added, and never refused either.
      getJestSpyOn(Queue, "addJob").mockReturnValue(
        new Promise<never>((): void => {}),
      );

      jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });

      try {
        const clearing: Promise<ClearLocalSignInAnswer> = clear();
        let isDone: boolean = false;
        void clearing.then((): void => {
          isDone = true;
        });

        // Until the clear is waiting on the queue, with its time limit set.
        await untilTimersAreSet(1);

        jest.advanceTimersByTime(EMAIL_ENQUEUE_TIMEOUT_IN_MS - 1);
        await Promise.resolve();
        expect(isDone).toBe(false);

        jest.advanceTimersByTime(1);

        await expect(clearing).resolves.toEqual({
          cleared: EVERYTHING,
          sessionsEnded: 2,
        });
      } finally {
        jest.useRealTimers();
      }

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("not all queued"),
      );
    });

    test("a queue that refuses the email never fails the clear", async () => {
      notifyCleared.mockRestore();
      getJestSpyOn(Queue, "addJob").mockRejectedValue(
        new Error("Redis connection lost"),
      );

      await expect(clear()).resolves.toEqual({
        cleared: EVERYTHING,
        sessionsEnded: 2,
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(PERSON_ID.toString()),
      );
    });

    /*
     * #9992, end to end on this side: somebody whose only saved setting
     * was a reset link that still worked - counted by the Require SSO card,
     * and cleared - was told nothing, and the audit log said nothing.
     */
    test("a clear that removes only a password reset link records it, and emails the person (#9992)", async () => {
      store(PERSON_ID, {
        settings: { ...NO_LOCAL_SIGN_IN_SETTINGS, hasPasswordResetLink: true },
      });

      notifyCleared.mockRestore();
      const addJob: jest.SpyInstance = getJestSpyOn(
        Queue,
        "addJob",
      ).mockResolvedValue({} as never);

      await expect(clear()).resolves.toEqual({
        cleared: { ...NO_LOCAL_SIGN_IN_SETTINGS, hasPasswordResetLink: true },
        sessionsEnded: 2,
      });

      // The audit log: an entry with a field for the link (the recorder writes one).
      const audited: Array<SignInSettingsClearedAuditEvent> = recordCleared.mock
        .calls[0]![0] as Array<SignInSettingsClearedAuditEvent>;
      expect(audited).toHaveLength(1);
      expect(
        getSignInSettingsClearedChanges(audited[0]!.cleared).map(
          (change: unknown): unknown => {
            return (change as Record<string, unknown>)["field"];
          },
        ),
      ).toEqual([SignInSettingsClearedField.PasswordResetLink]);

      // The email: queued for that person, saying the link is what went.
      expect(addJob).toHaveBeenCalledTimes(1);
      const data: Record<string, unknown> = addJob.mock.calls[0]![3] as Record<
        string,
        unknown
      >;
      expect(keyOf(data["userId"])).toBe(keyOf(PERSON_ID));
      expect(data["cleared"]).toEqual({
        ...NO_LOCAL_SIGN_IN_SETTINGS,
        hasPasswordResetLink: true,
      });
    });

    test("someone with nothing saved is handed over as such, and the sender sends nothing for them", async () => {
      store(PERSON_ID, { settings: NO_LOCAL_SIGN_IN_SETTINGS });

      await clear();

      const events: Array<SignInSettingsClearedEmailEvent> = notifyCleared.mock
        .calls[0]![0] as Array<SignInSettingsClearedEmailEvent>;
      expect(events[0]!.cleared).toEqual(NO_LOCAL_SIGN_IN_SETTINGS);
    });

    test("another master admin, confirmed and cleared, is emailed too", async () => {
      const otherAdmin: ObjectID = ObjectID.generate();
      store(otherAdmin, { isMasterAdmin: true });

      await clear({ userId: otherAdmin, isMasterAdminConfirmed: true });

      expect(emailedIds()).toEqual([[keyOf(otherAdmin)]]);
    });

    test("a refused clear emails nobody: their own account, an unconfirmed master admin, an account that does not exist", async () => {
      const otherAdmin: ObjectID = ObjectID.generate();
      store(otherAdmin, { isMasterAdmin: true });

      await expect(
        clear({ userId: ADMIN_ID, clearedByUserId: ADMIN_ID }),
      ).rejects.toThrow();
      await expect(clear({ userId: otherAdmin })).rejects.toThrow();
      await expect(clear({ userId: ObjectID.generate() })).rejects.toThrow();

      expect(notifyCleared).not.toHaveBeenCalled();
    });

    test("a clear that fails emails nobody", async () => {
      updateBy.mockRejectedValue(new Error("connection refused"));

      await expect(clear()).rejects.toThrow("connection refused");
      expect(notifyCleared).not.toHaveBeenCalled();
    });

    test("a failed send does not fail the clear: the real sender, with the mail service down", async () => {
      // The real sender this time, its own reads stood in.
      notifyCleared.mockRestore();
      const notifySpy: jest.SpyInstance = getJestSpyOn(
        SignInSettingsClearedEmail,
        "notify",
      );
      const addJob: jest.SpyInstance = getJestSpyOn(
        Queue,
        "addJob",
      ).mockResolvedValue({} as never);

      const readPerson: (data: { id: ObjectID }) => Promise<User | null> =
        findOneById.getMockImplementation() as (data: {
          id: ObjectID;
        }) => Promise<User | null>;

      findOneById.mockImplementation(
        async (data: { id: ObjectID }): Promise<User | null> => {
          const user: User | null = await readPerson(data);

          if (user) {
            user.email = new Email("person@example.com");
          }

          return user;
        },
      );

      getJestSpyOn(SsoManagedSignIn, "getSignInManagement").mockResolvedValue({
        isManagedBySso: true,
        ssoProviderNames: ["Okta"],
        localSignInProjectNames: [],
      });
      getJestSpyOn(DatabaseConfig, "getHost").mockResolvedValue(
        new Hostname("oneuptime.example.com"),
      );
      getJestSpyOn(DatabaseConfig, "getHttpProtocol").mockResolvedValue(
        Protocol.HTTPS,
      );

      const sendMail: jest.SpyInstance = getJestSpyOn(
        MailService,
        "sendMail",
      ).mockRejectedValue(new Error("mail service down"));

      getJestSpyOn(GlobalCache, "getString").mockResolvedValue(null);

      await expect(clear()).resolves.toEqual({
        cleared: EVERYTHING,
        sessionsEnded: 2,
      });

      // The email's own promise: it never rejects, and nothing was sent yet.
      await expect(notifySpy.mock.results[0]!.value).resolves.toBe(undefined);
      expect(sendMail).not.toHaveBeenCalled();

      // The worker runs the job the clear queued: the send fails, the job says so.
      await expect(
        SignInSettingsClearedEmail.runJob(addJob.mock.calls[0]![3], {
          attempt: 1,
          maxAttempts: 6,
        }),
      ).rejects.toThrow(PERSON_ID.toString());

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(
        (sendMail.mock.calls[0]![0] as { toEmail: Email }).toEmail.toString(),
      ).toBe("person@example.com");
      expect(logger.error).toHaveBeenCalled();
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

  /*
   * #9992: the count counted a working reset link that what a clear
   * reports had no field for, so the clear reported nothing removed for
   * somebody it counted. Each thing the count counts is a field of what a
   * clear reports, and each field is a thing the count counts: one added to
   * either side alone fails here.
   */
  test("the count and what a clear reports agree: a clause for each field, a field for each clause (#9992)", async () => {
    const clauseOfField: Record<keyof LocalSignInSettings, string> = {
      hasPassword: '"person"."password" IS NOT NULL',
      hasPasswordResetLink:
        '"person"."resetPasswordToken" IS NOT NULL AND "person"."resetPasswordExpires" > NOW()',
      isTwoFactorAuthEnabled: '"person"."enableTwoFactorAuth" = true',
      authenticatorAppCount: 'FROM "UserTotpAuth"',
      passkeyAndSecurityKeyCount: 'FROM "UserWebAuthn"',
      backupCodeCount: 'FROM "UserTwoFactorBackupCode"',
    };

    expect(Object.keys(NO_LOCAL_SIGN_IN_SETTINGS).sort()).toEqual(
      Object.keys(clauseOfField).sort(),
    );

    await LocalSignInClearing.countPeopleCoveredBySsoRequirement();

    const sql: string = whereSql[0]!.replace(/\s+/g, " ");

    for (const clause of Object.values(clauseOfField)) {
      expect(sql).toContain(clause);
    }

    // And nothing else counts somebody: one clause a field, OR'd together.
    const counted: string = sql.slice(sql.indexOf("AND ("));
    expect((counted.match(/ OR /g) || []).length + 1).toBe(
      Object.keys(clauseOfField).length,
    );

    // Each field alone is something a clear reports, and so something it tells.
    for (const field of Object.keys(clauseOfField) as Array<
      keyof LocalSignInSettings
    >) {
      const alone: LocalSignInSettings = {
        ...NO_LOCAL_SIGN_IN_SETTINGS,
        [field]:
          typeof NO_LOCAL_SIGN_IN_SETTINGS[field] === "boolean" ? true : 1,
      };

      expect(hasLocalSignInSettings(alone)).toBe(true);
      expect(getSignInSettingsClearedChanges(alone)).toHaveLength(1);
    }
  });
});

describe("LocalSignInClearing.findPeopleWithSettings: which of these people have anything saved (#9820)", () => {
  test("asks the clear of everyone's own query, narrowed to exactly these people", async () => {
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();
    batches = [[first.toString()]];

    await expect(
      LocalSignInClearing.findPeopleWithSettings([first, second]),
    ).resolves.toEqual([first]);

    // Never a master admin, never a deleted account, every kind of setting.
    expect(whereSql[0]).toContain('"person"."isMasterAdmin" = false');
    expect(whereSql[0]).toContain('"person"."deletedAt" IS NULL');
    expect(whereSql[0]).toContain('"person"."password" IS NOT NULL');
    expect(whereSql[0]).toContain('"UserWebAuthn"');

    expect(andWheres).toHaveLength(1);
    expect(andWheres[0]!.sql).toBe('"person"."_id" IN (:...userIds)');
    expect(andWheres[0]!.parameters["userIds"]).toEqual([
      first.toString(),
      second.toString(),
    ]);
  });

  test("answers each person once, and nothing that is not an id", async () => {
    const first: ObjectID = ObjectID.generate();
    batches = [[first.toString(), first.toString().toUpperCase(), "not-an-id"]];

    const found: Array<ObjectID> =
      await LocalSignInClearing.findPeopleWithSettings([first]);

    expect(found.map(keyOf)).toEqual([keyOf(first)]);
  });

  test("reads the people a batch at a time, LIMIT_MAX each", async () => {
    const many: Array<ObjectID> = Array.from(
      { length: LIMIT_MAX + 1 },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );
    batches = [[], []];

    await LocalSignInClearing.findPeopleWithSettings(many);

    expect(andWheres).toHaveLength(2);
    expect((andWheres[0]!.parameters["userIds"] as Array<string>).length).toBe(
      LIMIT_MAX,
    );
    expect((andWheres[1]!.parameters["userIds"] as Array<string>).length).toBe(
      1,
    );
  });

  test("nobody asked about is nobody, with nothing read", async () => {
    await expect(
      LocalSignInClearing.findPeopleWithSettings([]),
    ).resolves.toEqual([]);
    expect(getQueryBuilder).not.toHaveBeenCalled();
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

  describe("the emails (#9818)", () => {
    test("each person cleared is emailed what they had, as cleared by a server admin", async () => {
      const first: ObjectID = someone();
      const second: ObjectID = someone();
      store(second, {
        settings: { ...NO_LOCAL_SIGN_IN_SETTINGS, hasPassword: true },
      });
      batches = [[first.toString(), second.toString()]];

      await clearEveryone();

      expect(notifyCleared).toHaveBeenCalledTimes(1);
      const events: Array<SignInSettingsClearedEmailEvent> = notifyCleared.mock
        .calls[0]![0] as Array<SignInSettingsClearedEmailEvent>;
      const byPerson: Map<string, SignInSettingsClearedEmailEvent> = new Map(
        events.map(
          (
            event: SignInSettingsClearedEmailEvent,
          ): [string, SignInSettingsClearedEmailEvent] => {
            return [keyOf(event.userId), event];
          },
        ),
      );

      expect(byPerson.get(keyOf(first))!.cleared).toEqual(EVERYTHING);
      expect(byPerson.get(keyOf(second))!.cleared).toEqual({
        ...NO_LOCAL_SIGN_IN_SETTINGS,
        hasPassword: true,
      });
      for (const event of events) {
        expect(event.clearedBy).toBe(SignInSettingsClearedBy.ServerAdmin);
      }
      expect(JSON.stringify(events)).not.toContain(ADMIN_ID.toString());
    });

    test("a batch's emails are handed over once it is cleared and recorded, batch by batch", async () => {
      const full: Array<string> = Array.from(
        { length: CLEAR_BATCH_SIZE },
        (): string => {
          return someone().toString();
        },
      );
      const last: Array<string> = [someone().toString()];
      batches = [full, last];

      const order: Array<string> = [];
      updateBy.mockImplementation(async (): Promise<number> => {
        order.push("clear");
        return 1;
      });
      recordCleared.mockImplementation(async (): Promise<void> => {
        order.push("audit");
      });
      notifyCleared.mockImplementation(async (): Promise<void> => {
        order.push("email");
      });

      await clearEveryone();

      expect(order).toEqual([
        "clear",
        "audit",
        "email",
        "clear",
        "audit",
        "email",
      ]);
      expect(emailedIds()[0]).toHaveLength(CLEAR_BATCH_SIZE);
      expect(emailedIds()[1]).toEqual([keyOf(new ObjectID(last[0]!))]);
    });

    test("a master admin left out of the clear is never emailed", async () => {
      const plain: ObjectID = someone();
      const promoted: ObjectID = someone();
      batches = [[plain.toString(), promoted.toString()]];
      store(promoted, { isMasterAdmin: true });

      await clearEveryone();

      expect(emailedIds()).toEqual([[keyOf(plain)]]);
    });

    test("a batch of only master admins emails nobody", async () => {
      const promoted: ObjectID = someone();
      store(promoted, { isMasterAdmin: true });
      batches = [[promoted.toString()]];

      await clearEveryone();

      expect(emailedIds().flat()).toEqual([]);
    });

    test("the clear of everyone never waits for an email to be sent: each batch's are queued while the next is cleared (#9991)", async () => {
      notifyCleared.mockRestore();
      const addJob: jest.SpyInstance = getJestSpyOn(
        Queue,
        "addJob",
      ).mockResolvedValue({} as never);
      const sendMail: jest.SpyInstance = getJestSpyOn(MailService, "sendMail");

      const full: Array<string> = Array.from(
        { length: CLEAR_BATCH_SIZE },
        (): string => {
          return someone().toString();
        },
      );
      batches = [full, [someone().toString()]];

      await expect(clearEveryone()).resolves.toBe(CLEAR_BATCH_SIZE + 1);

      // A job for each person, and not one email sent by the clear itself.
      expect(addJob).toHaveBeenCalledTimes(CLEAR_BATCH_SIZE + 1);
      expect(sendMail).not.toHaveBeenCalled();
    });

    test("a queue that does not answer holds the clear of everyone up EMAIL_ENQUEUE_TIMEOUT_IN_MS once, not once a batch", async () => {
      notifyCleared.mockRestore();
      getJestSpyOn(Queue, "addJob").mockReturnValue(
        new Promise<never>((): void => {}),
      );

      const full: Array<string> = Array.from(
        { length: CLEAR_BATCH_SIZE },
        (): string => {
          return someone().toString();
        },
      );
      batches = [full, [someone().toString()]];

      jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });

      try {
        const clearing: Promise<number> = clearEveryone();

        // Both batches cleared, each waiting on the queue with its time limit.
        await untilTimersAreSet(2);

        // One time limit's worth: every batch's wait ends in it.
        jest.advanceTimersByTime(EMAIL_ENQUEUE_TIMEOUT_IN_MS);

        await expect(clearing).resolves.toBe(CLEAR_BATCH_SIZE + 1);
      } finally {
        jest.useRealTimers();
      }
    });

    test("refused, it emails nobody", async () => {
      getRequireSsoForLogin.mockResolvedValue(false);

      await expect(clearEveryone()).rejects.toThrow();
      expect(notifyCleared).not.toHaveBeenCalled();
    });

    test("nobody cleared, nobody emailed", async () => {
      batches = [[]];

      await clearEveryone();

      expect(notifyCleared).not.toHaveBeenCalled();
    });
  });
});
