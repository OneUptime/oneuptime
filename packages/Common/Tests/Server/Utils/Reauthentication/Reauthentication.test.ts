import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});

import Redis from "../../../../Server/Infrastructure/Redis";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
  IdentityRateLimitOutcome,
} from "../../../../Server/Middleware/IdentityRateLimit";
import UserService from "../../../../Server/Services/UserService";
import UserSessionService from "../../../../Server/Services/UserSessionService";
import UserTotpAuthService from "../../../../Server/Services/UserTotpAuthService";
import UserTwoFactorBackupCodeService from "../../../../Server/Services/UserTwoFactorBackupCodeService";
import UserWebAuthnService from "../../../../Server/Services/UserWebAuthnService";
import Reauthentication, {
  ReauthenticationSession,
} from "../../../../Server/Utils/Reauthentication/Reauthentication";
import TotpAuth from "../../../../Server/Utils/TotpAuth";
import TwoFactorWrongCodes from "../../../../Server/Utils/TwoFactorWrongCodes";
import User from "../../../../Models/DatabaseModels/User";
import UserSession from "../../../../Models/DatabaseModels/UserSession";
import UserTotpAuth from "../../../../Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "../../../../Models/DatabaseModels/UserWebAuthn";
import {
  REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT,
  REAUTHENTICATION_MESSAGES,
  REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
  REAUTHENTICATION_WINDOW_IN_MINUTES,
  ReauthenticationMethods,
  ReauthenticationStatus,
  ReauthenticationWebAuthnKind,
} from "../../../../Types/Accounts/Reauthentication";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../../Types/Email";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Exception from "../../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import ReauthenticationRequiredException from "../../../../Types/Exception/ReauthenticationRequiredException";
import ServiceUnavailableException from "../../../../Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "../../../../Types/Exception/TooManyRequestsException";
import { getErrorDetails } from "../../../../Types/Exception/BadDataExceptionWithDetails";
import HashedString from "../../../../Types/HashedString";
import ObjectID from "../../../../Types/ObjectID";
import { SessionEndCause } from "../../../../Types/UserSession/SessionEndCause";

/*
 * CONFIRM IT'S YOU (#10155): the rules, the confirmation and the check.
 *
 * Without a database or Valkey: the services are stubbed at their edges,
 * and Valkey is an in-memory stand-in that keeps what is set with its
 * expiry and counts as the Lua script does. Pinned here:
 *
 *   - what each kind of account confirms with (getMethods);
 *   - the check every change to how one signs in asks first
 *     (assertConfirmed): a root write is not asked; a session that has not
 *     confirmed, or confirmed too long ago, or for somebody else, is refused
 *     with the code a client acts on; an account that confirms by signing in
 *     is confirmed by a sign-in of the session's own, in the window;
 *   - a confirmation (confirm): what it checks, in which order, what it
 *     counts, and that too many wrong ones end the session they came from -
 *     never the account's sign-in;
 *   - failing closed while Valkey is unreachable.
 */

const USER_ID: ObjectID = new ObjectID("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
);
const SESSION_ID: ObjectID = new ObjectID(
  "cccccccc-3333-4333-8333-cccccccccccc",
);
const OTHER_SESSION_ID: ObjectID = new ObjectID(
  "dddddddd-4444-4444-8444-dddddddddddd",
);

const RIGHT_PASSWORD: string = "the right password, 2026";
const RIGHT_CODE: string = "424242";
const RIGHT_BACKUP_CODE: string = "GOODCODE42";
const MINUTE_IN_MS: number = 60 * 1000;

const SESSION: ReauthenticationSession = {
  userId: USER_ID,
  sessionId: SESSION_ID,
};

// What an account has, for the stubs to answer with.
interface Account {
  hasPassword: boolean;
  isTwoFactorOn: boolean;
  authenticatorApps: number;
  // One entry per key: true a passkey, false a second step only, null older.
  keys: Array<boolean | null>;
  unusedBackupCodes: number;
  // When the session signed in, minutes ago.
  signedInMinutesAgo: number;
  isSessionRevoked: boolean;
  sessionUserId: ObjectID;
}

const PASSWORD_ACCOUNT: Account = {
  hasPassword: true,
  isTwoFactorOn: false,
  authenticatorApps: 0,
  keys: [],
  unusedBackupCodes: 0,
  signedInMinutesAgo: 120,
  isSessionRevoked: false,
  sessionUserId: USER_ID,
};

const TWO_FACTOR_ACCOUNT: Account = {
  ...PASSWORD_ACCOUNT,
  isTwoFactorOn: true,
  authenticatorApps: 1,
  keys: [false],
  unusedBackupCodes: 8,
};

const SSO_ONLY_ACCOUNT: Account = {
  ...PASSWORD_ACCOUNT,
  hasPassword: false,
};

const PASSKEY_ONLY_ACCOUNT: Account = {
  ...PASSWORD_ACCOUNT,
  hasPassword: false,
  keys: [true],
};

/*
 * Valkey, in memory: values with their expiry, the attempts script's count,
 * and a switch for an outage.
 */
class StandInValkey {
  public values: Map<string, { value: string; expiresAt: number }> = new Map();
  public isDown: boolean = false;
  public setCalls: Array<Array<unknown>> = [];

  public async get(key: string): Promise<string | null> {
    this.assertUp();
    const entry: { value: string; expiresAt: number } | undefined =
      this.values.get(key);

    if (!entry || entry.expiresAt <= Date.now()) {
      return null;
    }

    return entry.value;
  }

  public async set(
    key: string,
    value: string,
    mode: string,
    seconds: number,
  ): Promise<string> {
    this.assertUp();
    this.setCalls.push([key, value, mode, seconds]);
    this.values.set(key, {
      value: value,
      expiresAt: Date.now() + seconds * 1000,
    });
    return "OK";
  }

  public async del(key: string): Promise<number> {
    this.assertUp();
    return this.values.delete(key) ? 1 : 0;
  }

  // COUNT_ATTEMPT_SCRIPT: one more, the expiry from the first.
  public async eval(
    _script: string,
    _keys: number,
    key: string,
    seconds: string,
  ): Promise<number> {
    this.assertUp();
    const entry: { value: string; expiresAt: number } | undefined =
      this.values.get(key);
    const count: number =
      entry && entry.expiresAt > Date.now() ? Number(entry.value) + 1 : 1;

    this.values.set(key, {
      value: String(count),
      expiresAt:
        count === 1 || !entry
          ? Date.now() + Number(seconds) * 1000
          : entry.expiresAt,
    });

    return count;
  }

  private assertUp(): void {
    if (this.isDown) {
      throw new Error("Connection is closed.");
    }
  }
}

let valkey: StandInValkey;
let account: Account;
let revokeSession: SpyInstance<
  typeof UserSessionService.revokeLiveSessionOfUser
>;
let verifyPassword: SpyInstance<typeof UserService.verifyHashedColumnValue>;
let consumeBackupCode: SpyInstance<
  typeof UserTwoFactorBackupCodeService.consumeCode
>;
let verifyKey: SpyInstance<typeof UserWebAuthnService.verifyReauthentication>;
let rateLimit: SpyInstance<typeof IdentityRateLimit.consume>;
let wrongCodesOfSignIn: Array<SpyInstance<() => Promise<unknown>>>;

function useAccount(next: Account): void {
  account = next;
}

function confirmedKey(sessionId: ObjectID = SESSION_ID): string {
  return `reauthentication:confirmed:${sessionId.toString().toLowerCase()}`;
}

function attemptsKey(sessionId: ObjectID = SESSION_ID): string {
  return `reauthentication:attempts:${sessionId.toString().toLowerCase()}`;
}

// A confirmation kept `minutesAgo` minutes ago, as confirm() keeps one.
function keepConfirmation(
  minutesAgo: number,
  userId: ObjectID = USER_ID,
  sessionId: ObjectID = SESSION_ID,
): void {
  valkey.values.set(confirmedKey(sessionId), {
    value: JSON.stringify({
      userId: userId.toString().toLowerCase(),
      confirmedAt: Date.now() - minutesAgo * MINUTE_IN_MS,
    }),
    expiresAt:
      Date.now() +
      (REAUTHENTICATION_WINDOW_IN_MINUTES - minutesAgo) * MINUTE_IN_MS,
  });
}

function signedInProps(
  overrides: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return { userId: USER_ID, sessionId: SESSION_ID, ...overrides };
}

async function refusalOf(work: Promise<unknown>): Promise<Exception> {
  try {
    await work;
  } catch (err) {
    return err as Exception;
  }

  throw new Error("Expected a refusal, and the work went through.");
}

beforeEach(() => {
  valkey = new StandInValkey();
  account = PASSWORD_ACCOUNT;

  jest.mocked(Redis.getClient).mockImplementation((() => {
    return valkey.isDown ? null : valkey;
  }) as never);
  jest.mocked(Redis.isConnected).mockImplementation(() => {
    return !valkey.isDown;
  });

  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    const user: User = new User();
    user.id = USER_ID;
    user._id = USER_ID.toString();
    user.email = new Email("river@example.com");
    user.enableTwoFactorAuth = account.isTwoFactorOn;

    if (account.hasPassword) {
      user.password = new HashedString("stored-hash", true);
      user.passwordSalt = "salt";
    }

    return user;
  }) as never);

  jest.spyOn(UserTotpAuthService, "findBy").mockImplementation((async () => {
    return Array.from({ length: account.authenticatorApps }).map(
      (_value: unknown, index: number): UserTotpAuth => {
        const app: UserTotpAuth = new UserTotpAuth();
        app._id = `app-${index}`;
        app.twoFactorSecret = `secret-${index}`;
        return app;
      },
    );
  }) as never);

  jest.spyOn(UserWebAuthnService, "findBy").mockImplementation((async () => {
    return account.keys.map(
      (isPasskey: boolean | null, index: number): UserWebAuthn => {
        const key: UserWebAuthn = new UserWebAuthn();
        key._id = `key-${index}`;
        (key as unknown as { isPasskey: boolean | null }).isPasskey = isPasskey;
        return key;
      },
    );
  }) as never);

  jest
    .spyOn(UserTwoFactorBackupCodeService, "countUnusedForUser")
    .mockImplementation((async () => {
      return account.unusedBackupCodes;
    }) as never);

  jest
    .spyOn(UserSessionService, "findOneById")
    .mockImplementation((async () => {
      const session: UserSession = new UserSession();
      session._id = SESSION_ID.toString();
      session.userId = account.sessionUserId;
      session.isRevoked = account.isSessionRevoked;
      session.createdAt = new Date(
        Date.now() - account.signedInMinutesAgo * MINUTE_IN_MS,
      );
      return session;
    }) as never);

  revokeSession = jest
    .spyOn(UserSessionService, "revokeLiveSessionOfUser")
    .mockResolvedValue(true as never);

  verifyPassword = jest
    .spyOn(UserService, "verifyHashedColumnValue")
    .mockImplementation((async (data: { plainValue: string }) => {
      return data.plainValue === RIGHT_PASSWORD;
    }) as never);

  jest.spyOn(TotpAuth, "verifyToken").mockImplementation(((data: {
    token: string;
  }): boolean => {
    return data.token === RIGHT_CODE;
  }) as never);

  consumeBackupCode = jest
    .spyOn(UserTwoFactorBackupCodeService, "consumeCode")
    .mockImplementation((async (data: { code: string }) => {
      return data.code === RIGHT_BACKUP_CODE;
    }) as never);

  verifyKey = jest
    .spyOn(UserWebAuthnService, "verifyReauthentication")
    .mockResolvedValue(undefined as never);

  rateLimit = jest
    .spyOn(IdentityRateLimit, "consume")
    .mockResolvedValue({ outcome: IdentityRateLimitOutcome.Allowed });

  // The sign-in's own count of wrong codes, which nothing here may move.
  wrongCodesOfSignIn = [
    jest.spyOn(TwoFactorWrongCodes, "startCheck") as never,
    jest.spyOn(TwoFactorWrongCodes, "forget") as never,
  ];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what each account confirms with", () => {
  test("a password, with no second step while two-factor authentication is off", async () => {
    useAccount(PASSWORD_ACCOUNT);

    expect(await Reauthentication.getMethods(USER_ID)).toEqual({
      password: true,
      secondStep: null,
      passkey: false,
      signInAgain: false,
    } as ReauthenticationMethods);
  });

  test("a password and its second step while two-factor authentication is on: the app, the key and unused backup codes", async () => {
    useAccount(TWO_FACTOR_ACCOUNT);

    expect(await Reauthentication.getMethods(USER_ID)).toEqual({
      password: true,
      secondStep: {
        authenticatorApp: true,
        securityKey: true,
        backupCode: true,
      },
      passkey: false,
      signInAgain: false,
    } as ReauthenticationMethods);
  });

  test("backup codes all spent are no second step", async () => {
    useAccount({ ...TWO_FACTOR_ACCOUNT, unusedBackupCodes: 0 });

    expect(
      (await Reauthentication.getMethods(USER_ID)).secondStep?.backupCode,
    ).toBe(false);
  });

  test("two-factor authentication on with nothing set up asks for no second step, as its sign-in walks it through setting one up", async () => {
    useAccount({
      ...PASSWORD_ACCOUNT,
      isTwoFactorOn: true,
      unusedBackupCodes: 4,
    });

    expect((await Reauthentication.getMethods(USER_ID)).secondStep).toBe(null);
  });

  test("a passkey, or a key from before purposes were kept, is a passkey; a key set up as a second step only is not", async () => {
    useAccount({ ...PASSWORD_ACCOUNT, keys: [false] });
    expect((await Reauthentication.getMethods(USER_ID)).passkey).toBe(false);

    useAccount({ ...PASSWORD_ACCOUNT, keys: [null] });
    expect((await Reauthentication.getMethods(USER_ID)).passkey).toBe(true);

    useAccount({ ...PASSWORD_ACCOUNT, keys: [false, true] });
    expect((await Reauthentication.getMethods(USER_ID)).passkey).toBe(true);
  });

  test("no password but a passkey: the passkey, never a new sign-in", async () => {
    useAccount(PASSKEY_ONLY_ACCOUNT);

    expect(await Reauthentication.getMethods(USER_ID)).toEqual({
      password: false,
      secondStep: null,
      passkey: true,
      signInAgain: false,
    } as ReauthenticationMethods);
  });

  test("neither a password nor a passkey - single sign-on, Google, Microsoft: a new sign-in", async () => {
    useAccount(SSO_ONLY_ACCOUNT);

    expect(await Reauthentication.getMethods(USER_ID)).toEqual({
      password: false,
      secondStep: null,
      passkey: false,
      signInAgain: true,
    } as ReauthenticationMethods);
  });

  test("an account without a password asks for no second step, whatever it has set up", async () => {
    useAccount({
      ...SSO_ONLY_ACCOUNT,
      isTwoFactorOn: true,
      authenticatorApps: 1,
      unusedBackupCodes: 3,
    });

    expect(await Reauthentication.getMethods(USER_ID)).toEqual({
      password: false,
      secondStep: null,
      passkey: false,
      signInAgain: true,
    } as ReauthenticationMethods);
  });
});

describe("the check every change to how one signs in asks first", () => {
  test("a root write - the server's own - is not asked, and reads nothing", async () => {
    await Reauthentication.assertConfirmed({ isRoot: true });

    expect(UserService.findOneById).not.toHaveBeenCalled();
  });

  test.each([
    ["an API key or a workflow: no person, no session", {}],
    [
      "an MCP client or the master API key: a person, no session",
      { userId: USER_ID },
    ],
  ] as Array<[string, DatabaseCommonInteractionProps]>)(
    "%s is refused, and told why",
    async (_name: string, props: DatabaseCommonInteractionProps) => {
      const refusal: Exception = await refusalOf(
        Reauthentication.assertConfirmed(props),
      );

      expect(refusal).toBeInstanceOf(BadDataException);
      expect(refusal).not.toBeInstanceOf(ReauthenticationRequiredException);
      expect(refusal.message).toBe(REAUTHENTICATION_MESSAGES.notFromASession);
    },
  );

  test("a session that has not confirmed is refused with the code a client acts on, and nothing else", async () => {
    const refusal: Exception = await refusalOf(
      Reauthentication.assertConfirmed(signedInProps()),
    );

    expect(refusal).toBeInstanceOf(ReauthenticationRequiredException);
    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.code).toBe(400);
    expect(refusal.message).toBe(REAUTHENTICATION_MESSAGES.required);
    expect(getErrorDetails(refusal)).toEqual({
      refusalCode: REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
    });
    expect(
      ReauthenticationRequiredException.isRefusal({
        message: refusal.message,
        ...getErrorDetails(refusal),
      }),
    ).toBe(true);
  });

  test("a confirmation of this session, in the window, lets the change through", async () => {
    keepConfirmation(REAUTHENTICATION_WINDOW_IN_MINUTES - 1);

    await expect(
      Reauthentication.assertConfirmed(signedInProps()),
    ).resolves.toBeUndefined();
  });

  test("a confirmation older than the window is stale, and refused", async () => {
    // Kept past its own expiry by a store that did not drop it.
    valkey.values.set(confirmedKey(), {
      value: JSON.stringify({
        userId: USER_ID.toString(),
        confirmedAt:
          Date.now() - (REAUTHENTICATION_WINDOW_IN_MINUTES + 1) * MINUTE_IN_MS,
      }),
      expiresAt: Date.now() + MINUTE_IN_MS,
    });

    expect(
      await refusalOf(Reauthentication.assertConfirmed(signedInProps())),
    ).toBeInstanceOf(ReauthenticationRequiredException);
  });

  test("a confirmation of another session confirms nothing for this one", async () => {
    keepConfirmation(1, USER_ID, OTHER_SESSION_ID);

    expect(
      await refusalOf(Reauthentication.assertConfirmed(signedInProps())),
    ).toBeInstanceOf(ReauthenticationRequiredException);
  });

  test("a confirmation kept for somebody else is no confirmation of this person's", async () => {
    keepConfirmation(1, OTHER_USER_ID);

    expect(
      await refusalOf(Reauthentication.assertConfirmed(signedInProps())),
    ).toBeInstanceOf(ReauthenticationRequiredException);
  });

  test("a confirmation that is not one (garbage in the store) confirms nothing", async () => {
    valkey.values.set(confirmedKey(), {
      value: "not json",
      expiresAt: Date.now() + MINUTE_IN_MS,
    });

    expect(
      await refusalOf(Reauthentication.assertConfirmed(signedInProps())),
    ).toBeInstanceOf(ReauthenticationRequiredException);
  });

  test("an account with a password is never confirmed by its sign-in, however recent", async () => {
    useAccount({ ...PASSWORD_ACCOUNT, signedInMinutesAgo: 0 });

    expect(
      await refusalOf(Reauthentication.assertConfirmed(signedInProps())),
    ).toBeInstanceOf(ReauthenticationRequiredException);
  });

  test("an account that confirms by signing in: a sign-in of this session in the window lets the change through", async () => {
    useAccount({ ...SSO_ONLY_ACCOUNT, signedInMinutesAgo: 3 });

    await expect(
      Reauthentication.assertConfirmed(signedInProps()),
    ).resolves.toBeUndefined();
  });

  test.each([
    ["older than the window", { signedInMinutesAgo: 11 }],
    ["revoked", { signedInMinutesAgo: 1, isSessionRevoked: true }],
    [
      "somebody else's",
      { signedInMinutesAgo: 1, sessionUserId: OTHER_USER_ID },
    ],
  ] as Array<[string, Partial<Account>]>)(
    "an account that confirms by signing in: a sign-in %s is refused",
    async (_name: string, session: Partial<Account>) => {
      useAccount({ ...SSO_ONLY_ACCOUNT, ...session });

      expect(
        await refusalOf(Reauthentication.assertConfirmed(signedInProps())),
      ).toBeInstanceOf(ReauthenticationRequiredException);
    },
  );

  test("with Valkey unreachable, a password account is refused with what to do - never let through", async () => {
    valkey.isDown = true;

    const refusal: Exception = await refusalOf(
      Reauthentication.assertConfirmed(signedInProps()),
    );

    expect(refusal).toBeInstanceOf(ServiceUnavailableException);
    expect(refusal.message).toBe(REAUTHENTICATION_MESSAGES.unavailable);
  });

  test("with Valkey unreachable, an account that confirms by signing in is answered from its session's row", async () => {
    valkey.isDown = true;
    useAccount({ ...SSO_ONLY_ACCOUNT, signedInMinutesAgo: 2 });

    await expect(
      Reauthentication.assertConfirmed(signedInProps()),
    ).resolves.toBeUndefined();

    useAccount({ ...SSO_ONLY_ACCOUNT, signedInMinutesAgo: 20 });

    expect(
      await refusalOf(Reauthentication.assertConfirmed(signedInProps())),
    ).toBeInstanceOf(ReauthenticationRequiredException);
  });
});

describe("where the session stands, for the prompt", () => {
  test("not confirmed: what the account confirms with, and the window", async () => {
    useAccount(TWO_FACTOR_ACCOUNT);

    const status: ReauthenticationStatus =
      await Reauthentication.getStatus(SESSION);

    expect(status.isConfirmed).toBe(false);
    expect(status.confirmedUntil).toBeNull();
    expect(status.windowInMinutes).toBe(REAUTHENTICATION_WINDOW_IN_MINUTES);
    expect(status.methods.secondStep?.authenticatorApp).toBe(true);
  });

  test("confirmed: until the window after the confirmation", async () => {
    keepConfirmation(4);

    const status: ReauthenticationStatus =
      await Reauthentication.getStatus(SESSION);

    expect(status.isConfirmed).toBe(true);
    expect(
      Math.abs(
        status.confirmedUntil!.getTime() -
          (Date.now() +
            (REAUTHENTICATION_WINDOW_IN_MINUTES - 4) * MINUTE_IN_MS),
      ),
    ).toBeLessThan(1000);
  });
});

describe("a confirmation with the password", () => {
  test("the right password confirms the session for the window, and is kept for it alone", async () => {
    const answer: { confirmedUntil: Date } = await Reauthentication.confirm({
      session: SESSION,
      proof: { password: RIGHT_PASSWORD },
      clientIp: "203.0.113.9",
    });

    expect(
      Math.abs(
        answer.confirmedUntil.getTime() -
          (Date.now() + REAUTHENTICATION_WINDOW_IN_MINUTES * MINUTE_IN_MS),
      ),
    ).toBeLessThan(1000);

    const kept: Array<unknown> | undefined = valkey.setCalls.find(
      (call: Array<unknown>): boolean => {
        return call[0] === confirmedKey();
      },
    );

    expect(kept?.[2]).toBe("EX");
    expect(kept?.[3]).toBe(REAUTHENTICATION_WINDOW_IN_MINUTES * 60);
    expect(JSON.parse(String(kept?.[1]))).toEqual({
      userId: USER_ID.toString().toLowerCase(),
      confirmedAt: expect.any(Number),
    });

    // And now the check lets this session's change through.
    await expect(
      Reauthentication.assertConfirmed(signedInProps()),
    ).resolves.toBeUndefined();

    // Never another session's.
    expect(
      await refusalOf(
        Reauthentication.assertConfirmed(
          signedInProps({ sessionId: OTHER_SESSION_ID }),
        ),
      ),
    ).toBeInstanceOf(ReauthenticationRequiredException);
  });

  test("the password is checked as a sign-in checks it: against the account's own salted hash", async () => {
    await Reauthentication.confirm({
      session: SESSION,
      proof: { password: RIGHT_PASSWORD },
      clientIp: "203.0.113.9",
    });

    expect(verifyPassword).toHaveBeenCalledTimes(1);

    const checked: { columnName: string; plainValue: string; item: User } =
      verifyPassword.mock.calls[0]![0] as never;

    expect(checked.columnName).toBe("password");
    expect(checked.plainValue).toBe(RIGHT_PASSWORD);
    expect(checked.item.passwordSalt).toBe("salt");
  });

  test("a wrong password is said, counted, and confirms nothing", async () => {
    const refusal: Exception = await refusalOf(
      Reauthentication.confirm({
        session: SESSION,
        proof: { password: "a wrong one" },
        clientIp: "203.0.113.9",
      }),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(REAUTHENTICATION_MESSAGES.wrongPassword);
    expect(valkey.values.get(attemptsKey())?.value).toBe("1");
    expect(
      await refusalOf(Reauthentication.assertConfirmed(signedInProps())),
    ).toBeInstanceOf(ReauthenticationRequiredException);
  });

  test("no password is told so, and is not counted", async () => {
    const refusal: Exception = await refusalOf(
      Reauthentication.confirm({
        session: SESSION,
        proof: {},
        clientIp: "203.0.113.9",
      }),
    );

    expect(refusal.message).toBe(REAUTHENTICATION_MESSAGES.passwordRequired);
    expect(valkey.values.get(attemptsKey())).toBeUndefined();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  test("a confirmation forgets the session's wrong attempts", async () => {
    await refusalOf(
      Reauthentication.confirm({
        session: SESSION,
        proof: { password: "wrong" },
        clientIp: "203.0.113.9",
      }),
    );

    await Reauthentication.confirm({
      session: SESSION,
      proof: { password: RIGHT_PASSWORD },
      clientIp: "203.0.113.9",
    });

    expect(valkey.values.get(attemptsKey())).toBeUndefined();
  });

  test(`${REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT} wrong attempts end the session they came from, and sign the browser out`, async () => {
    for (
      let i: number = 1;
      i < REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT;
      i++
    ) {
      const refusal: Exception = await refusalOf(
        Reauthentication.confirm({
          session: SESSION,
          proof: { password: `wrong ${i}` },
          clientIp: "203.0.113.9",
        }),
      );

      expect(refusal.message).toBe(REAUTHENTICATION_MESSAGES.wrongPassword);
      expect(revokeSession).not.toHaveBeenCalled();
    }

    const last: Exception = await refusalOf(
      Reauthentication.confirm({
        session: SESSION,
        proof: { password: "wrong again" },
        clientIp: "203.0.113.9",
        requestOrigin: { ipAddress: "203.0.113.9" },
      }),
    );

    expect(last).toBeInstanceOf(NotAuthenticatedException);
    expect(last.code).toBe(401);
    expect(last.message).toBe(REAUTHENTICATION_MESSAGES.signedOut);
    expect(revokeSession).toHaveBeenCalledTimes(1);
    expect(revokeSession).toHaveBeenCalledWith(
      { userId: USER_ID, sessionId: SESSION_ID },
      {
        cause: SessionEndCause.ReauthenticationFailed,
        requestOrigin: { ipAddress: "203.0.113.9" },
      },
    );
  });

  test("the owner is never locked out: nothing about the account's sign-in moves, and another session confirms as before", async () => {
    for (
      let i: number = 0;
      i < REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT;
      i++
    ) {
      await refusalOf(
        Reauthentication.confirm({
          session: SESSION,
          proof: { password: `wrong ${i}` },
          clientIp: "203.0.113.9",
        }),
      );
    }

    // Only the session that failed ended - never every session of the account.
    expect(revokeSession).toHaveBeenCalledWith(
      { userId: USER_ID, sessionId: SESSION_ID },
      expect.anything(),
    );

    for (const spy of wrongCodesOfSignIn) {
      expect(spy).not.toHaveBeenCalled();
    }

    // The owner, in a session of their own, confirms with the password at once.
    await expect(
      Reauthentication.confirm({
        session: { userId: USER_ID, sessionId: OTHER_SESSION_ID },
        proof: { password: RIGHT_PASSWORD },
        clientIp: "198.51.100.4",
      }),
    ).resolves.toEqual({ confirmedUntil: expect.any(Date) });
  });

  test("attempts sent at the same moment are attempts in a row: past the allowance nothing more is checked", async () => {
    const attempts: Array<Promise<unknown>> = Array.from({
      length: REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT + 3,
    }).map((_value: unknown, index: number): Promise<unknown> => {
      return refusalOf(
        Reauthentication.confirm({
          session: SESSION,
          proof: { password: `guess ${index}` },
          clientIp: "203.0.113.9",
        }),
      );
    });

    await Promise.all(attempts);

    expect(verifyPassword.mock.calls.length).toBeLessThanOrEqual(
      REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT,
    );
    expect(revokeSession).toHaveBeenCalled();
  });

  test("an account without a password is told how it confirms instead", async () => {
    useAccount(SSO_ONLY_ACCOUNT);

    expect(
      (
        await refusalOf(
          Reauthentication.confirm({
            session: SESSION,
            proof: { password: "anything" },
            clientIp: "203.0.113.9",
          }),
        )
      ).message,
    ).toBe(REAUTHENTICATION_MESSAGES.signInAgain);

    useAccount(PASSKEY_ONLY_ACCOUNT);

    expect(
      (
        await refusalOf(
          Reauthentication.confirm({
            session: SESSION,
            proof: { password: "anything" },
            clientIp: "203.0.113.9",
          }),
        )
      ).message,
    ).toBe(REAUTHENTICATION_MESSAGES.noPassword);

    expect(verifyPassword).not.toHaveBeenCalled();
    expect(valkey.values.get(attemptsKey())).toBeUndefined();
  });
});

describe("a confirmation while two-factor authentication is on", () => {
  beforeEach(() => {
    useAccount(TWO_FACTOR_ACCOUNT);
  });

  test("the password alone is not enough: the second step is asked for, before the password is checked", async () => {
    const refusal: Exception = await refusalOf(
      Reauthentication.confirm({
        session: SESSION,
        proof: { password: RIGHT_PASSWORD },
        clientIp: "203.0.113.9",
      }),
    );

    expect(refusal.message).toBe(REAUTHENTICATION_MESSAGES.secondStepRequired);
    // No oracle: the answer is the same for a wrong password.
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(valkey.values.get(attemptsKey())).toBeUndefined();
  });

  test("the password and a code from the authenticator app confirm", async () => {
    await expect(
      Reauthentication.confirm({
        session: SESSION,
        proof: { password: RIGHT_PASSWORD, code: RIGHT_CODE },
        clientIp: "203.0.113.9",
      }),
    ).resolves.toEqual({ confirmedUntil: expect.any(Date) });
  });

  test("a wrong code is said, and counted", async () => {
    const refusal: Exception = await refusalOf(
      Reauthentication.confirm({
        session: SESSION,
        proof: { password: RIGHT_PASSWORD, code: "000000" },
        clientIp: "203.0.113.9",
      }),
    );

    expect(refusal.message).toBe(REAUTHENTICATION_MESSAGES.wrongCode);
    expect(valkey.values.get(attemptsKey())?.value).toBe("1");
  });

  test("a right code with a wrong password is a wrong password", async () => {
    expect(
      (
        await refusalOf(
          Reauthentication.confirm({
            session: SESSION,
            proof: { password: "wrong", code: RIGHT_CODE },
            clientIp: "203.0.113.9",
          }),
        )
      ).message,
    ).toBe(REAUTHENTICATION_MESSAGES.wrongPassword);
  });

  test("a backup code confirms with the password, and is spent only once the password is right", async () => {
    await refusalOf(
      Reauthentication.confirm({
        session: SESSION,
        proof: { password: "wrong", backupCode: RIGHT_BACKUP_CODE },
        clientIp: "203.0.113.9",
      }),
    );

    expect(consumeBackupCode).not.toHaveBeenCalled();

    await expect(
      Reauthentication.confirm({
        session: SESSION,
        proof: { password: RIGHT_PASSWORD, backupCode: RIGHT_BACKUP_CODE },
        clientIp: "203.0.113.9",
      }),
    ).resolves.toEqual({ confirmedUntil: expect.any(Date) });

    expect(consumeBackupCode).toHaveBeenCalledWith({
      userId: USER_ID,
      code: RIGHT_BACKUP_CODE,
    });
  });

  test("a wrong or used backup code is said", async () => {
    expect(
      (
        await refusalOf(
          Reauthentication.confirm({
            session: SESSION,
            proof: { password: RIGHT_PASSWORD, backupCode: "USEDCODE00" },
            clientIp: "203.0.113.9",
          }),
        )
      ).message,
    ).toBe(REAUTHENTICATION_MESSAGES.wrongBackupCode);
  });

  test("the security key confirms with the password: its answer is checked for this session, as a second step", async () => {
    const credential: Record<string, unknown> = { id: "key-credential" };

    await expect(
      Reauthentication.confirm({
        session: SESSION,
        proof: { password: RIGHT_PASSWORD, securityKeyCredential: credential },
        clientIp: "203.0.113.9",
      }),
    ).resolves.toEqual({ confirmedUntil: expect.any(Date) });

    expect(verifyKey).toHaveBeenCalledWith({
      userId: USER_ID,
      sessionId: SESSION_ID,
      kind: ReauthenticationWebAuthnKind.SecurityKey,
      credential: credential,
    });
  });

  test("a key that is not accepted is said, and counted", async () => {
    verifyKey.mockRejectedValue(
      new BadDataException(REAUTHENTICATION_MESSAGES.securityKeyNotAccepted),
    );

    const refusal: Exception = await refusalOf(
      Reauthentication.confirm({
        session: SESSION,
        proof: {
          password: RIGHT_PASSWORD,
          securityKeyCredential: { id: "key-credential" },
        },
        clientIp: "203.0.113.9",
      }),
    );

    expect(refusal.message).toBe(
      REAUTHENTICATION_MESSAGES.securityKeyNotAccepted,
    );
    expect(valkey.values.get(attemptsKey())?.value).toBe("1");
  });

  test("a key the account does not have is refused before anything is checked", async () => {
    useAccount({ ...TWO_FACTOR_ACCOUNT, keys: [] });

    expect(
      (
        await refusalOf(
          Reauthentication.confirm({
            session: SESSION,
            proof: {
              password: RIGHT_PASSWORD,
              securityKeyCredential: { id: "key-credential" },
            },
            clientIp: "203.0.113.9",
          }),
        )
      ).message,
    ).toBe(REAUTHENTICATION_MESSAGES.noSecurityKey);
    expect(verifyKey).not.toHaveBeenCalled();
  });

  test("the sign-in's own count of wrong codes is never touched, so nobody makes the owner wait at sign-in", async () => {
    for (let i: number = 0; i < 3; i++) {
      await refusalOf(
        Reauthentication.confirm({
          session: SESSION,
          proof: { password: RIGHT_PASSWORD, code: "000000" },
          clientIp: "203.0.113.9",
        }),
      );
    }

    for (const spy of wrongCodesOfSignIn) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("a confirmation with a passkey", () => {
  test("a passkey on its own confirms, checked for this session with the device's check of its person", async () => {
    useAccount({ ...TWO_FACTOR_ACCOUNT, keys: [true] });
    const credential: Record<string, unknown> = { id: "passkey-credential" };

    await expect(
      Reauthentication.confirm({
        session: SESSION,
        proof: { passkeyCredential: credential },
        clientIp: "203.0.113.9",
      }),
    ).resolves.toEqual({ confirmedUntil: expect.any(Date) });

    expect(verifyKey).toHaveBeenCalledWith({
      userId: USER_ID,
      sessionId: SESSION_ID,
      kind: ReauthenticationWebAuthnKind.Passkey,
      credential: credential,
    });
    // A passkey stands in for the password and the second step, as at sign-in.
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  test("an account with no passkey is told to confirm with its password", async () => {
    useAccount(PASSWORD_ACCOUNT);

    expect(
      (
        await refusalOf(
          Reauthentication.confirm({
            session: SESSION,
            proof: { passkeyCredential: { id: "passkey-credential" } },
            clientIp: "203.0.113.9",
          }),
        )
      ).message,
    ).toBe(REAUTHENTICATION_MESSAGES.noPasskey);
    expect(verifyKey).not.toHaveBeenCalled();
  });

  test("a passkey that is not accepted is said, and counted", async () => {
    useAccount(PASSKEY_ONLY_ACCOUNT);
    verifyKey.mockRejectedValue(
      new BadDataException(REAUTHENTICATION_MESSAGES.passkeyNotAccepted),
    );

    const refusal: Exception = await refusalOf(
      Reauthentication.confirm({
        session: SESSION,
        proof: { passkeyCredential: { id: "passkey-credential" } },
        clientIp: "203.0.113.9",
      }),
    );

    expect(refusal.message).toBe(REAUTHENTICATION_MESSAGES.passkeyNotAccepted);
    expect(valkey.values.get(attemptsKey())?.value).toBe("1");
  });
});

describe("rate limits", () => {
  test("every confirmation is counted for the person and the client, on a bucket of its own", async () => {
    await Reauthentication.confirm({
      session: SESSION,
      proof: { password: RIGHT_PASSWORD },
      clientIp: "203.0.113.9",
    });

    expect(rateLimit).toHaveBeenCalledWith({
      accountKey: USER_ID.toString().toLowerCase(),
      clientIp: "203.0.113.9",
      bucket: IdentityRateLimitBucket.Reauthentication,
    });
  });

  test("over the limit: refused before anything is read or checked", async () => {
    rateLimit.mockResolvedValue({
      outcome: IdentityRateLimitOutcome.RateLimited,
    });

    const refusal: Exception = await refusalOf(
      Reauthentication.confirm({
        session: SESSION,
        proof: { password: RIGHT_PASSWORD },
        clientIp: "203.0.113.9",
      }),
    );

    expect(refusal).toBeInstanceOf(TooManyRequestsException);
    expect(refusal.message).toBe(REAUTHENTICATION_MESSAGES.tooManyAttempts);
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(valkey.values.get(attemptsKey())).toBeUndefined();
  });

  test("the counter unreachable: refused, never let through unlimited", async () => {
    rateLimit.mockResolvedValue({
      outcome: IdentityRateLimitOutcome.CounterUnavailable,
    });

    const refusal: Exception = await refusalOf(
      Reauthentication.confirm({
        session: SESSION,
        proof: { password: RIGHT_PASSWORD },
        clientIp: "203.0.113.9",
      }),
    );

    expect(refusal).toBeInstanceOf(ServiceUnavailableException);
    expect(refusal.message).toBe(REAUTHENTICATION_MESSAGES.unavailable);
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  test("Valkey unreachable while counting: refused, the password never checked", async () => {
    valkey.isDown = true;

    const refusal: Exception = await refusalOf(
      Reauthentication.confirm({
        session: SESSION,
        proof: { password: RIGHT_PASSWORD },
        clientIp: "203.0.113.9",
      }),
    );

    expect(refusal).toBeInstanceOf(ServiceUnavailableException);
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  test("a key's options are counted too", async () => {
    useAccount(PASSKEY_ONLY_ACCOUNT);
    jest
      .spyOn(UserWebAuthnService, "generateReauthenticationOptions")
      .mockResolvedValue({ options: { challenge: "c" } } as never);

    await Reauthentication.getWebAuthnOptions({
      session: SESSION,
      kind: ReauthenticationWebAuthnKind.Passkey,
      clientIp: "203.0.113.9",
    });

    expect(rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: IdentityRateLimitBucket.Reauthentication,
      }),
    );
  });
});

describe("a key's options", () => {
  test("for a passkey the account has: made for this session", async () => {
    useAccount(PASSKEY_ONLY_ACCOUNT);
    const generate: SpyInstance<
      typeof UserWebAuthnService.generateReauthenticationOptions
    > = jest
      .spyOn(UserWebAuthnService, "generateReauthenticationOptions")
      .mockResolvedValue({ options: { challenge: "c" } } as never);

    expect(
      await Reauthentication.getWebAuthnOptions({
        session: SESSION,
        kind: ReauthenticationWebAuthnKind.Passkey,
        clientIp: "203.0.113.9",
      }),
    ).toEqual({ options: { challenge: "c" } });

    expect(generate).toHaveBeenCalledWith({
      userId: USER_ID,
      sessionId: SESSION_ID,
      kind: ReauthenticationWebAuthnKind.Passkey,
    });
  });

  test.each([
    [
      "a passkey, for an account with none",
      PASSWORD_ACCOUNT,
      ReauthenticationWebAuthnKind.Passkey,
      REAUTHENTICATION_MESSAGES.noPasskey,
    ],
    [
      "a security key, for an account whose two-factor authentication is off",
      { ...PASSWORD_ACCOUNT, keys: [false] },
      ReauthenticationWebAuthnKind.SecurityKey,
      REAUTHENTICATION_MESSAGES.noSecurityKey,
    ],
  ] as Array<[string, Account, ReauthenticationWebAuthnKind, string]>)(
    "%s are refused",
    async (
      _name: string,
      next: Account,
      kind: ReauthenticationWebAuthnKind,
      message: string,
    ) => {
      useAccount(next);
      const generate: SpyInstance<
        typeof UserWebAuthnService.generateReauthenticationOptions
      > = jest.spyOn(UserWebAuthnService, "generateReauthenticationOptions");

      expect(
        (
          await refusalOf(
            Reauthentication.getWebAuthnOptions({
              session: SESSION,
              kind: kind,
              clientIp: "203.0.113.9",
            }),
          )
        ).message,
      ).toBe(message);
      expect(generate).not.toHaveBeenCalled();
    },
  );

  test("a kind that is not one is refused", async () => {
    expect(
      await refusalOf(
        Reauthentication.getWebAuthnOptions({
          session: SESSION,
          kind: "Fingerprint" as ReauthenticationWebAuthnKind,
          clientIp: "203.0.113.9",
        }),
      ),
    ).toBeInstanceOf(BadDataException);
  });
});
