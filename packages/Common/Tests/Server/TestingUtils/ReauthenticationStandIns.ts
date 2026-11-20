import { jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserTwoFactorBackupCodeService from "../../../Server/Services/UserTwoFactorBackupCodeService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import IdentityRateLimit, {
  IdentityRateLimitOutcome,
} from "../../../Server/Middleware/IdentityRateLimit";
import TotpAuth from "../../../Server/Utils/TotpAuth";
import User from "../../../Models/DatabaseModels/User";
import UserSession from "../../../Models/DatabaseModels/UserSession";
import UserTotpAuth from "../../../Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "../../../Models/DatabaseModels/UserWebAuthn";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";

/*
 * STAND-INS FOR CONFIRM IT'S YOU (#10155, Server/Utils/Reauthentication):
 * an account at the services' edges and Valkey in memory, so a suite runs
 * the real check, the real confirmation and the real hooks without a
 * database.
 */

export const REAUTH_USER_ID: ObjectID = new ObjectID(
  "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
);
export const REAUTH_OTHER_USER_ID: ObjectID = new ObjectID(
  "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
);
export const REAUTH_SESSION_ID: ObjectID = new ObjectID(
  "cccccccc-3333-4333-8333-cccccccccccc",
);
export const REAUTH_OTHER_SESSION_ID: ObjectID = new ObjectID(
  "dddddddd-4444-4444-8444-dddddddddddd",
);

export const RIGHT_PASSWORD: string = "the right password, 2026";
export const RIGHT_CODE: string = "424242";
export const RIGHT_BACKUP_CODE: string = "GOODCODE42";
export const REAUTH_EMAIL: string = "river@example.com";

export const MINUTE_IN_MS: number = 60 * 1000;

// What an account has, for the stubs to answer with.
export interface StandInAccount {
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
  isMasterAdmin: boolean;
}

export const PASSWORD_ACCOUNT: StandInAccount = {
  hasPassword: true,
  isTwoFactorOn: false,
  authenticatorApps: 0,
  keys: [],
  unusedBackupCodes: 0,
  signedInMinutesAgo: 120,
  isSessionRevoked: false,
  sessionUserId: REAUTH_USER_ID,
  isMasterAdmin: false,
};

export const TWO_FACTOR_ACCOUNT: StandInAccount = {
  ...PASSWORD_ACCOUNT,
  isTwoFactorOn: true,
  authenticatorApps: 1,
  keys: [false],
  unusedBackupCodes: 8,
};

// Single sign-on, Google or Microsoft only: no password, no passkey.
export const SSO_ONLY_ACCOUNT: StandInAccount = {
  ...PASSWORD_ACCOUNT,
  hasPassword: false,
};

export const PASSKEY_ONLY_ACCOUNT: StandInAccount = {
  ...PASSWORD_ACCOUNT,
  hasPassword: false,
  keys: [true],
};

/*
 * Valkey, in memory: values with their expiry, the attempts script's count,
 * a challenge's GET-and-DEL, and a switch for an outage.
 */
export class StandInValkey {
  public values: Map<string, { value: string; expiresAt: number }> = new Map();
  public isDown: boolean = false;
  public setCalls: Array<Array<unknown>> = [];

  public async get(key: string): Promise<string | null> {
    this.assertUp();
    return this.read(key);
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

  public async eval(
    script: string,
    _keys: number,
    key: string,
    seconds?: string,
  ): Promise<unknown> {
    this.assertUp();

    // A challenge, spent as it is read (UserWebAuthnService.consumeChallenge).
    if (!script.includes("INCR")) {
      const value: string | null = this.read(key);
      this.values.delete(key);
      return value;
    }

    // One more attempt, the expiry from the first (COUNT_ATTEMPT_SCRIPT).
    const current: string | null = this.read(key);
    const count: number = current === null ? 1 : Number(current) + 1;
    const entry: { value: string; expiresAt: number } | undefined =
      this.values.get(key);

    this.values.set(key, {
      value: String(count),
      expiresAt:
        current === null || !entry
          ? Date.now() + Number(seconds) * 1000
          : entry.expiresAt,
    });

    return count;
  }

  private read(key: string): string | null {
    const entry: { value: string; expiresAt: number } | undefined =
      this.values.get(key);

    if (!entry || entry.expiresAt <= Date.now()) {
      return null;
    }

    return entry.value;
  }

  private assertUp(): void {
    if (this.isDown) {
      throw new Error("Connection is closed.");
    }
  }
}

export function confirmedKeyOf(sessionId: ObjectID): string {
  return `reauthentication:confirmed:${sessionId.toString().toLowerCase()}`;
}

export function attemptsKeyOf(sessionId: ObjectID): string {
  return `reauthentication:attempts:${sessionId.toString().toLowerCase()}`;
}

// The spies standInAccount sets, for a suite to ask of.
export interface StandInAccountSpies {
  revokeSession: SpyInstance<typeof UserSessionService.revokeLiveSessionOfUser>;
  verifyPassword: SpyInstance<typeof UserService.verifyHashedColumnValue>;
  consumeBackupCode: SpyInstance<
    typeof UserTwoFactorBackupCodeService.consumeCode
  >;
  verifyKey: SpyInstance<typeof UserWebAuthnService.verifyReauthentication>;
  rateLimit: SpyInstance<typeof IdentityRateLimit.consume>;
}

/*
 * The account `getAccount` describes, at every edge the check and the
 * confirmation read: its row, its apps and keys, its backup codes, its
 * session's row; the password, a code and a backup code checked against
 * RIGHT_PASSWORD, RIGHT_CODE and RIGHT_BACKUP_CODE; a key's answer
 * accepted; the rate limit allowing. Spies, so a suite can ask of them.
 */
export function standInAccount(
  getAccount: () => StandInAccount,
): StandInAccountSpies {
  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    const account: StandInAccount = getAccount();
    const user: User = new User();
    user.id = REAUTH_USER_ID;
    user._id = REAUTH_USER_ID.toString();
    user.email = new Email(REAUTH_EMAIL);
    user.enableTwoFactorAuth = account.isTwoFactorOn;
    user.isMasterAdmin = account.isMasterAdmin;

    if (account.hasPassword) {
      user.password = new HashedString("stored-hash", true);
      user.passwordSalt = "salt";
    }

    return user;
  }) as never);

  jest.spyOn(UserTotpAuthService, "findBy").mockImplementation((async () => {
    return Array.from({ length: getAccount().authenticatorApps }).map(
      (_value: unknown, index: number): UserTotpAuth => {
        const app: UserTotpAuth = new UserTotpAuth();
        app._id = `app-${index}`;
        app.twoFactorSecret = `secret-${index}`;
        return app;
      },
    );
  }) as never);

  jest.spyOn(UserWebAuthnService, "findBy").mockImplementation((async () => {
    return getAccount().keys.map(
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
      return getAccount().unusedBackupCodes;
    }) as never);

  /*
   * The account's session (REAUTH_SESSION_ID) signed in as the account
   * says; any other session of theirs, two hours ago.
   */
  jest
    .spyOn(UserSessionService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      const account: StandInAccount = getAccount();
      const isTheSession: boolean =
        data.id.toString().toLowerCase() ===
        REAUTH_SESSION_ID.toString().toLowerCase();
      const session: UserSession = new UserSession();
      session._id = data.id.toString();
      session.userId = account.sessionUserId;
      session.isRevoked = account.isSessionRevoked;
      session.createdAt = new Date(
        Date.now() -
          (isTheSession ? account.signedInMinutesAgo : 120) * MINUTE_IN_MS,
      );
      return session;
    }) as never);

  jest.spyOn(TotpAuth, "verifyToken").mockImplementation(((data: {
    token: string;
  }): boolean => {
    return data.token === RIGHT_CODE;
  }) as never);

  return {
    revokeSession: jest
      .spyOn(UserSessionService, "revokeLiveSessionOfUser")
      .mockResolvedValue(true as never),
    verifyPassword: jest
      .spyOn(UserService, "verifyHashedColumnValue")
      .mockImplementation((async (data: { plainValue: string }) => {
        return data.plainValue === RIGHT_PASSWORD;
      }) as never),
    consumeBackupCode: jest
      .spyOn(UserTwoFactorBackupCodeService, "consumeCode")
      .mockImplementation((async (data: { code: string }) => {
        return data.code === RIGHT_BACKUP_CODE;
      }) as never),
    verifyKey: jest
      .spyOn(UserWebAuthnService, "verifyReauthentication")
      .mockResolvedValue(undefined as never),
    rateLimit: jest
      .spyOn(IdentityRateLimit, "consume")
      .mockResolvedValue({ outcome: IdentityRateLimitOutcome.Allowed }),
  };
}
