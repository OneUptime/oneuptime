import DatabaseConfig from "../../../Server/DatabaseConfig";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import MailService from "../../../Server/Services/MailService";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import logger from "../../../Server/Utils/Logger";
import User from "../../../Models/DatabaseModels/User";
import Hostname from "../../../Types/API/Hostname";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Protocol from "../../../Types/API/Protocol";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import UserAuthenticationStatus from "../../../Types/UserAuthenticationStatus";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * UserService.getAuthenticationStatus / setPassword / sendPasswordResetLink --
 * the three methods behind Admin Dashboard > Users > (a user) > Authentication.
 *
 * These are the only place in the product where one human changes another
 * human's credentials, so every invariant they carry is a security property
 * rather than a nicety, and each one of them can break WITHOUT the page looking
 * any different:
 *
 *  - the status page reads `enableTwoFactorAuth`. `User` also has a
 *    `twoFactorAuthEnabled` column left over from the initial migration that
 *    nothing writes. Reading the wrong one renders "Two-factor auth: disabled"
 *    for a user who has it very much enabled -- the page still renders, the
 *    operator is just told the opposite of the truth.
 *  - setPassword hands the write path an UNHASHED HashedString on purpose.
 *    "Helpfully" pre-hashing it would store a digest that does not agree with
 *    the per-user salt the write path mints, and nothing fails until the user
 *    tries to log in.
 *  - sendPasswordResetLink stores only a SHA-256 of the token. Storing the
 *    token itself would still produce a working link, so no test that merely
 *    follows the link would notice; the difference only shows up in what a
 *    leaked database row is worth.
 *
 * Everything below stubs at this service's own boundary -- `findOneBy` and
 * `updateOneById` on the UserService singleton, plus MailService and
 * DatabaseConfig -- so the assertions are about what these three methods ASK
 * for, which is exactly where the bugs above would live. No database is
 * involved.
 * ---------------------------------------------------------------------------
 */

// The values the mocked DatabaseConfig reports, so the expected link is exact.
const TEST_HOSTNAME: string = "oneuptime.example.com";
const EXPECTED_ORIGIN: string = `http://${TEST_HOSTNAME}`;

type BuildUserFunction = (data: {
  id: ObjectID;
  email?: string | undefined;
  password?: HashedString | undefined;
  isEmailVerified?: boolean | undefined;
  enableTwoFactorAuth?: boolean | undefined;
  twoFactorAuthEnabled?: boolean | undefined;
  resetPasswordToken?: string | undefined;
  resetPasswordExpires?: Date | undefined;
}) => User;

const buildUser: BuildUserFunction = (data: {
  id: ObjectID;
  email?: string | undefined;
  password?: HashedString | undefined;
  isEmailVerified?: boolean | undefined;
  enableTwoFactorAuth?: boolean | undefined;
  twoFactorAuthEnabled?: boolean | undefined;
  resetPasswordToken?: string | undefined;
  resetPasswordExpires?: Date | undefined;
}): User => {
  const user: User = new User();
  user.id = data.id;

  if (data.email !== undefined) {
    user.email = new Email(data.email);
  }

  /*
   * Assigned only when supplied, so an omitted field leaves the column
   * genuinely absent -- the same shape a `select` that did not ask for it
   * produces -- rather than explicitly undefined.
   */
  if (data.password !== undefined) {
    user.password = data.password;
  }

  if (data.isEmailVerified !== undefined) {
    user.isEmailVerified = data.isEmailVerified;
  }

  if (data.enableTwoFactorAuth !== undefined) {
    user.enableTwoFactorAuth = data.enableTwoFactorAuth;
  }

  if (data.twoFactorAuthEnabled !== undefined) {
    user.twoFactorAuthEnabled = data.twoFactorAuthEnabled;
  }

  if (data.resetPasswordToken !== undefined) {
    user.resetPasswordToken = data.resetPasswordToken;
  }

  if (data.resetPasswordExpires !== undefined) {
    user.resetPasswordExpires = data.resetPasswordExpires;
  }

  return user;
};

describe("UserService -- master-admin authentication management", () => {
  let userId: ObjectID;
  let findOneBySpy: any;
  let updateOneByIdSpy: any;
  let sendMailSpy: any;
  let revokeSessionsSpy: any;

  beforeEach(() => {
    jest.restoreAllMocks();

    userId = ObjectID.generate();

    findOneBySpy = getJestSpyOn(UserService, "findOneBy").mockImplementation(
      async (): Promise<User | null> => {
        return null;
      },
    );

    updateOneByIdSpy = getJestSpyOn(
      UserService,
      "updateOneById",
    ).mockImplementation(async (): Promise<void> => {
      return undefined;
    });

    sendMailSpy = getJestSpyOn(MailService, "sendMail").mockImplementation(
      async (): Promise<any> => {
        return {};
      },
    );

    /*
     * Revocation belongs to the update hook, not to setPassword. It is stubbed
     * here purely so the "was it called?" assertion cannot accidentally reach a
     * real session table.
     */
    revokeSessionsSpy = getJestSpyOn(
      UserSessionService,
      "revokeAllSessionsByUserId",
    ).mockImplementation(async (): Promise<void> => {
      return undefined;
    });

    getJestSpyOn(DatabaseConfig, "getHost").mockImplementation(
      async (): Promise<Hostname> => {
        return new Hostname(TEST_HOSTNAME);
      },
    );

    getJestSpyOn(DatabaseConfig, "getHttpProtocol").mockImplementation(
      async (): Promise<Protocol> => {
        return Protocol.HTTP;
      },
    );

    getJestSpyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

    /*
     * The deliberate-failure cases below hand a rejection to the CaptureSpan
     * decorator, which records it. That is correct behaviour, and it is also a
     * stack trace on stderr for a test that passed -- silenced so a genuine
     * error in this suite's output is still worth reading.
     */
    getJestSpyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type ResolveUserFunction = (user: User | null) => void;

  // Makes the next (and every subsequent) findOneBy return this row.
  const resolveUser: ResolveUserFunction = (user: User | null): void => {
    findOneBySpy.mockImplementation(async (): Promise<User | null> => {
      return user;
    });
  };

  describe("getAuthenticationStatus", () => {
    test("throws NotFoundException when there is no such user", async () => {
      /*
       * Returning a status object full of `false` for a user id that does not
       * exist would render an ordinary-looking page describing nobody -- an
       * operator acting on a mistyped id has to be told, not shown defaults.
       */
      resolveUser(null);

      await expect(UserService.getAuthenticationStatus(userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    test("hasPassword is true when the password column is set", async () => {
      /*
       * The column carries a scrypt digest read out of the row, so the flag has
       * to be derived from presence, not from any particular shape of value.
       */
      resolveUser(
        buildUser({
          id: userId,
          password: new HashedString("a-stored-scrypt-digest", true),
        }),
      );

      const status: UserAuthenticationStatus =
        await UserService.getAuthenticationStatus(userId);

      expect(status.hasPassword).toBe(true);
    });

    test("hasPassword is false for an SSO-only user with no password", async () => {
      /*
       * This is the fact the Authentication page exists to show: a user with no
       * password cannot be helped by "send them a reset link", they need one
       * set. Reporting true here would send the operator down the wrong path.
       */
      resolveUser(buildUser({ id: userId }));

      const status: UserAuthenticationStatus =
        await UserService.getAuthenticationStatus(userId);

      expect(status.hasPassword).toBe(false);
    });

    test("isEmailVerified mirrors the column", async () => {
      resolveUser(buildUser({ id: userId, isEmailVerified: true }));

      const verified: UserAuthenticationStatus =
        await UserService.getAuthenticationStatus(userId);
      expect(verified.isEmailVerified).toBe(true);

      resolveUser(buildUser({ id: userId, isEmailVerified: false }));

      const unverified: UserAuthenticationStatus =
        await UserService.getAuthenticationStatus(userId);
      expect(unverified.isEmailVerified).toBe(false);
    });

    test("reads enableTwoFactorAuth, not the vestigial twoFactorAuthEnabled column", async () => {
      /*
       * THE SUBTLE ONE. `User` declares BOTH `enableTwoFactorAuth` and
       * `twoFactorAuthEnabled`. Only `enableTwoFactorAuth` is the one login
       * consults and the one the rest of the product writes;
       * `twoFactorAuthEnabled` is a leftover that nothing maintains.
       *
       * This row is the disagreeing case: 2FA is genuinely ON, and the dead
       * column says off. Reading the dead column would compile, would render,
       * and would tell an operator "two-factor auth is disabled" about a user
       * who cannot get in without their authenticator -- which is exactly the
       * moment the operator is deciding whether to reset it.
       */
      resolveUser(
        buildUser({
          id: userId,
          enableTwoFactorAuth: true,
          twoFactorAuthEnabled: false,
        }),
      );

      const status: UserAuthenticationStatus =
        await UserService.getAuthenticationStatus(userId);

      expect(status.isTwoFactorAuthEnabled).toBe(true);
    });

    test("does not report 2FA on just because the vestigial column is set", async () => {
      /*
       * The mirror of the case above, so the test cannot pass by hard-coding
       * true: the dead column says on, the live one says off, and the answer
       * has to follow the live one.
       */
      resolveUser(
        buildUser({
          id: userId,
          enableTwoFactorAuth: false,
          twoFactorAuthEnabled: true,
        }),
      );

      const status: UserAuthenticationStatus =
        await UserService.getAuthenticationStatus(userId);

      expect(status.isTwoFactorAuthEnabled).toBe(false);
    });

    test("hasPendingPasswordResetLink is false when no token has ever been minted", async () => {
      resolveUser(buildUser({ id: userId }));

      const status: UserAuthenticationStatus =
        await UserService.getAuthenticationStatus(userId);

      expect(status.hasPendingPasswordResetLink).toBe(false);
    });

    test("hasPendingPasswordResetLink is false once the token has expired", async () => {
      /*
       * Nothing clears `resetPasswordToken` when it lapses -- the column keeps
       * the last token until something overwrites it. Treating "column is set"
       * as "link is pending" would therefore report a live link for every user
       * who ever requested one, and /reset-password would refuse it.
       */
      resolveUser(
        buildUser({
          id: userId,
          resetPasswordToken: "a-hashed-token",
          resetPasswordExpires: OneUptimeDate.getSomeHoursAgo(1),
        }),
      );

      const status: UserAuthenticationStatus =
        await UserService.getAuthenticationStatus(userId);

      expect(status.hasPendingPasswordResetLink).toBe(false);
    });

    test("hasPendingPasswordResetLink is false for a token with no expiry at all", async () => {
      /*
       * A token with a null expiry is not an eternal link -- /reset-password
       * requires an unexpired expiry to redeem it, so a row in this shape has
       * nothing redeemable on it.
       */
      resolveUser(
        buildUser({
          id: userId,
          resetPasswordToken: "a-hashed-token",
        }),
      );

      const status: UserAuthenticationStatus =
        await UserService.getAuthenticationStatus(userId);

      expect(status.hasPendingPasswordResetLink).toBe(false);
    });

    test("hasPendingPasswordResetLink is true for an unexpired token", async () => {
      resolveUser(
        buildUser({
          id: userId,
          resetPasswordToken: "a-hashed-token",
          resetPasswordExpires: OneUptimeDate.getSomeHoursAfter(1),
        }),
      );

      const status: UserAuthenticationStatus =
        await UserService.getAuthenticationStatus(userId);

      expect(status.hasPendingPasswordResetLink).toBe(true);
    });

    test("returns only the four booleans -- never the password digest itself", async () => {
      /*
       * The whole reason this is a DTO rather than a selected row: the caller
       * is a master admin, whose props bypass column read permissions, so
       * handing the model back would put every user's password digest (and the
       * hash of their outstanding reset token) into a browser's network tab.
       *
       * Asserting the exact key set rather than "password is undefined" is
       * deliberate -- a future field added to the row would otherwise ride
       * along unnoticed.
       */
      const digest: string = "a-stored-scrypt-digest";

      resolveUser(
        buildUser({
          id: userId,
          password: new HashedString(digest, true),
          resetPasswordToken: "a-hashed-token",
          resetPasswordExpires: OneUptimeDate.getSomeHoursAfter(1),
        }),
      );

      const status: UserAuthenticationStatus =
        await UserService.getAuthenticationStatus(userId);

      expect(Object.keys(status).sort()).toEqual([
        "hasPassword",
        "hasPendingPasswordResetLink",
        "isEmailVerified",
        "isTwoFactorAuthEnabled",
      ]);

      const serialized: string = JSON.stringify(status);
      expect(serialized).not.toContain(digest);
      expect(serialized).not.toContain("a-hashed-token");

      for (const value of Object.values(status)) {
        expect(typeof value).toBe("boolean");
      }
    });

    test("selects exactly the columns the four booleans are derived from", async () => {
      /*
       * Pinned literally because both halves matter. Dropping a column here
       * turns its boolean permanently false rather than raising anything --
       * losing `enableTwoFactorAuth` would silently report 2FA off for
       * everyone. Adding one widens what a root read pulls out of the row for
       * no reason.
       */
      resolveUser(buildUser({ id: userId }));

      await UserService.getAuthenticationStatus(userId);

      const call: any = findOneBySpy.mock.calls[0][0];

      expect(call.select).toEqual({
        _id: true,
        password: true,
        isEmailVerified: true,
        enableTwoFactorAuth: true,
        resetPasswordToken: true,
        resetPasswordExpires: true,
      });

      expect(call.query).toEqual({ _id: userId });
      expect(call.props).toEqual({ isRoot: true });
    });
  });

  describe("setPassword", () => {
    const VALID_PASSWORD: string = "a-perfectly-fine-password";

    type ExpectRejectedBeforeAnyQueryFunction = (
      password: string,
    ) => Promise<void>;

    /*
     * Validating FIRST is the point of the ordering, not an accident of it.
     * Every OneUptime password form enforces the length rule in the browser;
     * an admin API is precisely the caller that is not a browser. A guard
     * placed after the read would still reject the value, but only after the
     * request had already spent a query -- and, more importantly, the shape
     * "read the row, then decide" is the one that invites a later edit to slip
     * an update in between.
     */
    const expectRejectedBeforeAnyQuery: ExpectRejectedBeforeAnyQueryFunction =
      async (password: string): Promise<void> => {
        // A row is available on purpose: nothing may go looking for it.
        resolveUser(buildUser({ id: userId, email: "user@example.com" }));

        await expect(
          UserService.setPassword({ userId: userId, password: password }),
        ).rejects.toThrow(BadDataException);

        expect(findOneBySpy).not.toHaveBeenCalled();
        expect(updateOneByIdSpy).not.toHaveBeenCalled();
      };

    test("rejects a password shorter than the minimum, before touching the database", async () => {
      await expectRejectedBeforeAnyQuery("short");
    });

    test("rejects a password that is only whitespace, before touching the database", async () => {
      /*
       * Long enough to pass the length rule, and still not a password. It is
       * rejected rather than trimmed on purpose -- trimming would store
       * something other than what was typed.
       */
      await expectRejectedBeforeAnyQuery("       ");
    });

    test("rejects an empty password, before touching the database", async () => {
      await expectRejectedBeforeAnyQuery("");
    });

    test("accepts a password of exactly the minimum length", async () => {
      /*
       * Guards the boundary from the off-by-one direction: a `<=` here would
       * start rejecting passwords that every existing OneUptime form accepts.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      await UserService.setPassword({ userId: userId, password: "abcdef" });

      expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
    });

    test("throws NotFoundException for a user that does not exist, and updates nothing", async () => {
      resolveUser(null);

      await expect(
        UserService.setPassword({
          userId: userId,
          password: VALID_PASSWORD,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(updateOneByIdSpy).not.toHaveBeenCalled();
    });

    test("hands the write path the PLAINTEXT wrapped in an unhashed HashedString", async () => {
      /*
       * THE CENTRAL ASSERTION OF THIS FILE.
       *
       * `sanitizeCreateOrUpdate` is what mints a fresh per-user salt and runs
       * scrypt, and it only does that for a HashedString whose isValueHashed()
       * is false. Passing a bare string, or "helpfully" pre-hashing here,
       * strands the row: the stored digest and the row's salt stop agreeing
       * with each other.
       *
       * Nothing about that failure is visible at the time. The update commits,
       * the admin page says the password was set, the operator tells the user
       * their new password -- and the account is locked out at the next login
       * attempt, with no error anywhere pointing back at this line.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      await UserService.setPassword({
        userId: userId,
        password: VALID_PASSWORD,
      });

      const call: any = updateOneByIdSpy.mock.calls[0][0];
      const password: any = call.data.password;

      expect(password).toBeInstanceOf(HashedString);
      expect(password.isValueHashed()).toBe(false);
      expect(password.toString()).toBe(VALID_PASSWORD);
    });

    test("clears any outstanding reset link in the SAME update", async () => {
      /*
       * A link mailed five minutes before the admin intervened must not still
       * be redeemable afterwards -- whoever holds it could set the password
       * again, undoing the intervention. Doing it as a second statement would
       * leave a window where the new password is live and the old link still
       * works; doing it in the same update means there is no such window.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      await UserService.setPassword({
        userId: userId,
        password: VALID_PASSWORD,
      });

      expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);

      const data: any = updateOneByIdSpy.mock.calls[0][0].data;

      // Present as keys, or the column is left untouched rather than cleared.
      expect(Object.keys(data)).toContain("resetPasswordToken");
      expect(Object.keys(data)).toContain("resetPasswordExpires");

      expect(data.resetPasswordToken).toBeFalsy();
      expect(data.resetPasswordExpires).toBeFalsy();
    });

    test("updates the row that was found, as root, WITHOUT ignoring hooks", async () => {
      /*
       * `ignoreHooks: true` would make this update look identical and behave
       * completely differently: `onUpdateSuccess` is what revokes every session
       * the user has open and mails them "Password Changed.". Skipping it would
       * leave an attacker's stolen session alive across the very password
       * change meant to kill it, and tell the user nothing.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      await UserService.setPassword({
        userId: userId,
        password: VALID_PASSWORD,
      });

      const call: any = updateOneByIdSpy.mock.calls[0][0];

      expect(call.id.toString()).toBe(userId.toString());
      expect(call.props.isRoot).toBe(true);
      expect(call.props.ignoreHooks).toBeFalsy();
    });

    test("does not revoke sessions or send mail itself", async () => {
      /*
       * The hook already does both. Doing them here as well would not be
       * harmlessly redundant -- the user would receive two identical
       * "Password Changed." emails from one admin action, which reads as a
       * second, unexplained change to their account.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      await UserService.setPassword({
        userId: userId,
        password: VALID_PASSWORD,
      });

      expect(revokeSessionsSpy).not.toHaveBeenCalled();
      expect(sendMailSpy).not.toHaveBeenCalled();
    });
  });

  describe("sendPasswordResetLink", () => {
    type SentLinkFunction = () => string;

    // The URL the operator's click actually put in the user's inbox.
    const sentLink: SentLinkFunction = (): string => {
      const mail: any = sendMailSpy.mock.calls[0][0];
      return mail.vars.tokenVerifyUrl as string;
    };

    type StoredTokenFunction = () => string;

    // What the row now holds in resetPasswordToken.
    const storedToken: StoredTokenFunction = (): string => {
      return updateOneByIdSpy.mock.calls[0][0].data
        .resetPasswordToken as string;
    };

    test("throws NotFoundException for a user that does not exist, and sends no mail", async () => {
      resolveUser(null);

      await expect(
        UserService.sendPasswordResetLink({ userId: userId }),
      ).rejects.toThrow(NotFoundException);

      expect(updateOneByIdSpy).not.toHaveBeenCalled();
      expect(sendMailSpy).not.toHaveBeenCalled();
    });

    test("stores a hash of the token and mails the token itself", async () => {
      /*
       * The property that makes a leaked database row worthless. What is
       * written to `resetPasswordToken` must NOT be the string in the email --
       * if it were, anyone with read access to the User table (a backup, a
       * replica, a support query) could mint themselves a working reset link
       * for any account without touching the mail system at all.
       *
       * Both halves are asserted, because either alone is satisfiable by a
       * bug: "they differ" alone passes if the stored value is unrelated
       * garbage that /reset-password could never match, and "it hashes to the
       * stored value" is only meaningful once we know they are not the same
       * string to begin with.
       *
       * The hash is unsalted on purpose -- /reset-password looks the row up BY
       * this digest, which a per-row salt would make impossible.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      await UserService.sendPasswordResetLink({ userId: userId });

      const stored: string = storedToken();
      const tokenInEmail: string = sentLink().split("/reset-password/")[1]!;

      expect(tokenInEmail).toBeTruthy();
      expect(stored).toBeTruthy();
      expect(stored).not.toBe(tokenInEmail);

      expect(await HashedString.hashValue(tokenInEmail, EncryptionSecret)).toBe(
        stored,
      );
    });

    test("mints a different token on every send", async () => {
      /*
       * A token derived from anything stable about the user -- their id, their
       * email -- would make yesterday's expired link valid again the moment a
       * new one is issued.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      await UserService.sendPasswordResetLink({ userId: userId });
      await UserService.sendPasswordResetLink({ userId: userId });

      const first: string = updateOneByIdSpy.mock.calls[0][0].data
        .resetPasswordToken as string;
      const second: string = updateOneByIdSpy.mock.calls[1][0].data
        .resetPasswordToken as string;

      expect(first).not.toBe(second);
    });

    test("the link points at the ordinary /accounts/reset-password page", async () => {
      /*
       * There is deliberately no admin-specific redemption route: the link an
       * operator sends is redeemed by exactly the page the public
       * /forgot-password flow uses. A different path here would mean a second
       * code path capable of setting passwords, which is the thing this feature
       * was careful not to create.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      await UserService.sendPasswordResetLink({ userId: userId });

      const link: string = sentLink();
      const token: string = link.split("/reset-password/")[1]!;

      expect(link).toBe(`${EXPECTED_ORIGIN}/accounts/reset-password/${token}`);
    });

    test("expires the link roughly 24 hours out", async () => {
      /*
       * In the future, or the link is dead on arrival and the operator is told
       * it was sent. Bounded above, or a mis-set expiry turns one admin action
       * into a password-reset link that stays redeemable for months.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      const before: Date = OneUptimeDate.getCurrentDate();

      await UserService.sendPasswordResetLink({ userId: userId });

      const expires: Date = updateOneByIdSpy.mock.calls[0][0].data
        .resetPasswordExpires as Date;

      expect(expires).toBeInstanceOf(Date);
      expect(OneUptimeDate.hasExpired(expires)).toBe(false);

      const hoursOut: number = OneUptimeDate.getHoursBetweenTwoDates(
        before,
        expires,
      );

      expect(hoursOut).toBeGreaterThanOrEqual(23);
      expect(hoursOut).toBeLessThanOrEqual(25);
    });

    test("writes the token as root against the requested user", async () => {
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      await UserService.sendPasswordResetLink({ userId: userId });

      const call: any = updateOneByIdSpy.mock.calls[0][0];

      expect(call.id.toString()).toBe(userId.toString());
      expect(call.props.isRoot).toBe(true);
    });

    test("sends the ForgotPassword template to the user's own address", async () => {
      /*
       * The template is what renders the link into something clickable; a
       * template type that does not reference `tokenVerifyUrl` would mail a
       * cheerful message with no link in it, and this method would still
       * report success.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      await UserService.sendPasswordResetLink({ userId: userId });

      const mail: any = sendMailSpy.mock.calls[0][0];

      expect(mail.templateType).toBe(EmailTemplateType.ForgotPassword);
      expect(mail.toEmail.toString()).toBe("user@example.com");

      // Routeless URLs render with a trailing slash; the template links it as-is.
      expect(mail.vars.homeURL).toBe(`${EXPECTED_ORIGIN}/`);
    });

    test("returns the address the link went to", async () => {
      /*
       * The operator pressed a button on a page identified by user id, not by
       * email. Returning the address is what lets the UI say WHERE the link
       * went, so a link sent to a stale address is noticed immediately rather
       * than becoming "the user says they never got it".
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      const email: Email = await UserService.sendPasswordResetLink({
        userId: userId,
      });

      expect(email.toString()).toBe("user@example.com");
    });

    test("a mail failure propagates instead of being reported as sent", async () => {
      /*
       * Most MailService calls in UserService are deliberately not awaited --
       * a signup should not fail because SMTP is down. This one is the
       * exception, and the exception is the whole point: a human is standing in
       * front of the page waiting to tell someone "check your email".
       * Swallowing the error here leaves them waiting for a link that was never
       * sent.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      sendMailSpy.mockImplementation(async (): Promise<never> => {
        throw new Error("SMTP server is unreachable");
      });

      await expect(
        UserService.sendPasswordResetLink({ userId: userId }),
      ).rejects.toThrow("SMTP server is unreachable");
    });

    test("treats a REJECTED mail send as a failure, not a delivery", async () => {
      /*
       * The catch-shaped failure: the notification service was unreachable, so
       * the HTTP client threw. This is the rarer of the two, and it is the only
       * one a bare try/catch would have caught -- see the sibling test below
       * for the one that matters more.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      sendMailSpy.mockImplementation(async (): Promise<never> => {
        throw new Error("connect ECONNREFUSED");
      });

      await expect(
        UserService.sendPasswordResetLink({ userId: userId }),
      ).rejects.toThrow("connect ECONNREFUSED");
    });

    test("treats a RESOLVED HTTPErrorResponse as a failure, not a delivery", async () => {
      /*
       * THE ONE THAT ACTUALLY BITES. MailService.sendMail is an HTTP call, and
       * this codebase's API client only REJECTS when no response came back at
       * all. A response that says no -- 400 "Global SMTP Config not found" on
       * a fresh self-hosted instance, an SMTP auth failure, a rejected
       * recipient -- comes back as a RESOLVED HTTPErrorResponse. And because
       * HTTPErrorResponse extends HTTPResponse, it satisfies sendMail's
       * declared return type, so nothing about it looks wrong to the compiler
       * either.
       *
       * Without an explicit instanceof check, the awaited call returns
       * normally, the rollback never runs, and the operator is told the link
       * was sent while a live 24 hour token sits on a row nobody was emailed
       * about. That is the exact state this method exists to avoid, reached by
       * the most ordinary failure there is.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      sendMailSpy.mockImplementation(async (): Promise<any> => {
        return new HTTPErrorResponse(
          400,
          { message: "Global SMTP Config not found" },
          {},
        );
      });

      await expect(
        UserService.sendPasswordResetLink({ userId: userId }),
      ).rejects.toThrow("Global SMTP Config not found");

      // ...and the token it had already armed is taken back off the row.
      expect(updateOneByIdSpy).toHaveBeenCalledTimes(2);
      expect(
        updateOneByIdSpy.mock.calls[1]![0].data.resetPasswordToken,
      ).toBeFalsy();
      expect(
        updateOneByIdSpy.mock.calls[1]![0].data.resetPasswordExpires,
      ).toBeFalsy();
    });

    test("takes the token back off the row when the mail could not be sent", async () => {
      /*
       * The token is written BEFORE the send, because the link in the email has
       * to be redeemable the moment it lands. That ordering means a failed send
       * would otherwise strand a live 24 hour token on a row nobody was ever
       * told about -- and getAuthenticationStatus would then report "reset link
       * pending" on the same screen as the error saying it could not be sent.
       *
       * So the send is unwound: the second update clears both columns, and the
       * page and the operator end up telling the same story.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      sendMailSpy.mockImplementation(async (): Promise<never> => {
        throw new Error("SMTP server is unreachable");
      });

      await expect(
        UserService.sendPasswordResetLink({ userId: userId }),
      ).rejects.toThrow("SMTP server is unreachable");

      expect(updateOneByIdSpy).toHaveBeenCalledTimes(2);

      const clearingUpdate: any = updateOneByIdSpy.mock.calls[1]![0];

      expect(clearingUpdate.id.toString()).toBe(userId.toString());
      expect(clearingUpdate.data.resetPasswordToken).toBeFalsy();
      expect(clearingUpdate.data.resetPasswordExpires).toBeFalsy();
      expect(clearingUpdate.props.isRoot).toBe(true);

      /*
       * The columns are cleared, not merely overwritten with something else:
       * a non-null token here would still read as a pending link.
       */
      expect("resetPasswordToken" in clearingUpdate.data).toBe(true);
      expect("resetPasswordExpires" in clearingUpdate.data).toBe(true);
    });

    test("still reports the mail failure even if the token cannot be cleared", async () => {
      /*
       * The cleanup is best-effort and must never replace the error worth
       * reporting. If it could, an SMTP outage plus a database blip would
       * surface to the operator as a database error about a write they never
       * asked for -- and the orphaned token expires by itself regardless.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      sendMailSpy.mockImplementation(async (): Promise<never> => {
        throw new Error("SMTP server is unreachable");
      });

      updateOneByIdSpy.mockImplementation(
        async (update: any): Promise<void> => {
          if (update.data.resetPasswordToken === null) {
            throw new Error("Database is unavailable");
          }

          return undefined;
        },
      );

      await expect(
        UserService.sendPasswordResetLink({ userId: userId }),
      ).rejects.toThrow("SMTP server is unreachable");
    });

    test("does not touch the token again when the mail was sent", async () => {
      /*
       * The mirror of the unwind: on the happy path there is exactly ONE write,
       * the one that armed the link. A second update here would clear the token
       * the user is about to click.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      await UserService.sendPasswordResetLink({ userId: userId });

      expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
      expect(
        updateOneByIdSpy.mock.calls[0]![0].data.resetPasswordToken,
      ).toBeTruthy();
    });

    test("does not resolve before the mail send settles", async () => {
      /*
       * The failure above can only propagate if the send is awaited. This pins
       * the awaiting directly, so a refactor to fire-and-forget is caught even
       * if it happens to keep rejections visible some other way.
       */
      resolveUser(buildUser({ id: userId, email: "user@example.com" }));

      let mailCompleted: boolean = false;

      sendMailSpy.mockImplementation(async (): Promise<any> => {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 10);
        });
        mailCompleted = true;
        return {};
      });

      await UserService.sendPasswordResetLink({ userId: userId });

      expect(mailCompleted).toBe(true);
    });
  });
});
