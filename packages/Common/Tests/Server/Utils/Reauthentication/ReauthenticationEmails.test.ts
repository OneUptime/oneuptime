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
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import MailService from "../../../../Server/Services/MailService";
import UserService from "../../../../Server/Services/UserService";
import UserTwoFactorBackupCodeService from "../../../../Server/Services/UserTwoFactorBackupCodeService";
import logger from "../../../../Server/Utils/Logger";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import Reauthentication from "../../../../Server/Utils/Reauthentication/Reauthentication";
import ReauthenticationSignedOutEmail, {
  SIGNED_OUT_EMAILS_PER_DAY,
} from "../../../../Server/Utils/Reauthentication/SignedOutEmail";
import TwoFactorBackupCodeNotification, {
  BackupCodeUse,
} from "../../../../Server/Utils/TwoFactorBackupCodeNotification";
import User from "../../../../Models/DatabaseModels/User";
import { REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT } from "../../../../Types/Accounts/Reauthentication";
import Hostname from "../../../../Types/API/Hostname";
import Protocol from "../../../../Types/API/Protocol";
import Email from "../../../../Types/Email";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import HashedString from "../../../../Types/HashedString";
import ObjectID from "../../../../Types/ObjectID";
import RequestOrigin from "../../../../Types/RequestOrigin";
import Timezone from "../../../../Types/Timezone";
import {
  PASSWORD_ACCOUNT,
  REAUTH_SESSION_ID,
  REAUTH_USER_ID,
  RIGHT_BACKUP_CODE,
  RIGHT_PASSWORD,
  StandInAccount,
  StandInAccountSpies,
  StandInValkey,
  TWO_FACTOR_ACCOUNT,
  standInAccount,
} from "../../TestingUtils/ReauthenticationStandIns";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";

/*
 * THE TWO EMAILS CONFIRM IT'S YOU SENDS THE ACCOUNT'S OWNER.
 *
 *   - #10219: a backup code spent on Confirm It's You emails the owner, as
 *     one spent at sign-in always has (TwoFactorBackupCodeNotification
 *     .sendCodeUsedEmail, which the sign-in route sends through too), saying
 *     what it was used for and how many are left;
 *   - #10218: a session signed out for getting Confirm It's You wrong too
 *     often emails the owner (Reauthentication/SignedOutEmail): when, from
 *     where, that the account is not locked, what to do.
 *
 * Both go to the address on the account, read there, in the language and
 * time zone on the account - English, German, Persian and Arabic here - and
 * never in the way of what sent them. And neither floods: one backup code
 * email per code spent (a code works once, a wrong one sends nothing), one
 * sign-out email per session signed out and at most
 * SIGNED_OUT_EMAILS_PER_DAY a day for an account.
 *
 * The confirmations run for real (Server/Utils/Reauthentication) against
 * Valkey in memory and an account at the services' edges
 * (TestingUtils/ReauthenticationStandIns); the mail service is the edge.
 */

interface SentMail {
  toEmail: Email;
  subject: string;
  isSubjectLiteral: boolean;
  templateType: EmailTemplateType;
  vars: Record<string, string>;
  language?: string | undefined;
}

let valkey: StandInValkey;
let account: StandInAccount;
let spies: StandInAccountSpies;
let sendMail: SpyInstance<typeof MailService.sendMail>;
let owner: { language?: string; timezone?: Timezone; hasPassword: boolean };

const ORIGIN: RequestOrigin = {
  ipAddress: "203.0.113.7",
  location: "Lyon, France",
  device: "Firefox 132 on Windows",
};

function sent(): Array<SentMail> {
  return sendMail.mock.calls.map((call: Array<unknown>): SentMail => {
    return call[0] as SentMail;
  });
}

// The background work a confirmation or a sign-out started, to its end.
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 20; turn++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

beforeEach(() => {
  valkey = new StandInValkey();
  account = PASSWORD_ACCOUNT;
  owner = { hasPassword: true };

  jest.mocked(Redis.getClient).mockImplementation((() => {
    return valkey.isDown ? null : valkey;
  }) as never);
  jest.mocked(Redis.isConnected).mockImplementation(() => {
    return !valkey.isDown;
  });

  spies = standInAccount(() => {
    return account;
  });

  // The emails this suite is about, sent as they are.
  spies.notifySignedOut.mockRestore();
  spies.notifyCodeUsed.mockRestore();

  /*
   * The owner's row, as the emails read it: their address, language, time
   * zone and whether they have a password. The check's own reads are the
   * stand-in's (it asks for the password's hash too).
   */
  const accountRow: (...args: Array<unknown>) => Promise<User> = jest
    .mocked(UserService.findOneById)
    .getMockImplementation() as never;

  jest.spyOn(UserService, "findOneById").mockImplementation((async (data: {
    select?: Record<string, unknown>;
  }) => {
    if (data.select && "language" in data.select) {
      const user: User = new User();
      user.id = REAUTH_USER_ID;
      user._id = REAUTH_USER_ID.toString();
      user.email = new Email("river@example.com");

      if (owner.language) {
        user.language = owner.language;
      }

      if (owner.timezone) {
        user.timezone = owner.timezone;
      }

      if (owner.hasPassword) {
        user.password = new HashedString("stored-hash", true);
      }

      return user;
    }

    return await accountRow(data);
  }) as never);

  sendMail = jest
    .spyOn(MailService, "sendMail")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "info").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a backup code spent on Confirm It's You (#10219)", () => {
  beforeEach(() => {
    account = TWO_FACTOR_ACCOUNT;
  });

  test("emails the owner once, saying what it was used for and how many are left", async () => {
    jest
      .spyOn(UserTwoFactorBackupCodeService, "countUnusedForUser")
      .mockResolvedValue(7);

    await Reauthentication.confirm({
      session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
      proof: { password: RIGHT_PASSWORD, backupCode: RIGHT_BACKUP_CODE },
      clientIp: "203.0.113.9",
      requestOrigin: ORIGIN,
    });

    await settle();

    expect(spies.consumeBackupCode).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(1);

    const mail: SentMail = sent()[0]!;

    expect(mail.toEmail.toString()).toBe("river@example.com");
    expect(mail.subject).toBe(
      "A backup code was used to confirm it's you in your OneUptime account",
    );
    expect(mail.isSubjectLiteral).toBe(true);
    expect(mail.templateType).toBe(EmailTemplateType.TwoFactorBackupCodeUsed);
    expect(mail.vars["usedToConfirmItsYou"]).toBe("true");
    expect(mail.vars["remainingCodeCount"]).toBe("7");
    expect(mail.vars["requestIpAddress"]).toBe("203.0.113.7");
    expect(mail.vars["requestLocation"]).toBe("Lyon, France");
    expect(mail.vars["requestDevice"]).toBe("Firefox 132 on Windows");
  });

  test("a wrong backup code spends nothing and sends nothing", async () => {
    await expect(
      Reauthentication.confirm({
        session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
        proof: { password: RIGHT_PASSWORD, backupCode: "NOT-A-CODE" },
        clientIp: "203.0.113.9",
      }),
    ).rejects.toThrow();

    await settle();

    expect(sent()).toHaveLength(0);
  });

  test("a wrong password never reaches the backup code, and sends nothing", async () => {
    await expect(
      Reauthentication.confirm({
        session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
        proof: { password: "a guess", backupCode: RIGHT_BACKUP_CODE },
        clientIp: "203.0.113.9",
      }),
    ).rejects.toThrow();

    await settle();

    expect(spies.consumeBackupCode).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(0);
  });

  test("a confirmation with an authenticator code sends no backup code email", async () => {
    await Reauthentication.confirm({
      session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
      proof: { password: RIGHT_PASSWORD, code: "424242" },
      clientIp: "203.0.113.9",
    });

    await settle();

    expect(sent()).toHaveLength(0);
  });

  test("a mail server that is down costs the email alone: the confirmation stands", async () => {
    sendMail.mockRejectedValue(new Error("SMTP is down") as never);

    await expect(
      Reauthentication.confirm({
        session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
        proof: { password: RIGHT_PASSWORD, backupCode: RIGHT_BACKUP_CODE },
        clientIp: "203.0.113.9",
      }),
    ).resolves.toEqual({ confirmedUntil: expect.any(Date) });

    await settle();

    expect(logger.error).toHaveBeenCalled();
  });
});

describe("the backup code email, for either use", () => {
  test.each([
    [
      BackupCodeUse.SignIn,
      "A backup code was used to sign in to your OneUptime account",
      "",
    ],
    [
      BackupCodeUse.ConfirmItsYou,
      "A backup code was used to confirm it's you in your OneUptime account",
      "true",
    ],
  ] as Array<[BackupCodeUse, string, string]>)(
    "%s: its subject and what it says it was for",
    async (usedFor: BackupCodeUse, subject: string, isConfirm: string) => {
      await TwoFactorBackupCodeNotification.sendCodeUsedEmail({
        userId: REAUTH_USER_ID,
        remainingCodeCount: 7,
        usedFor: usedFor,
      });

      expect(sent()[0]!.subject).toBe(subject);
      expect(sent()[0]!.vars["usedToConfirmItsYou"]).toBe(isConfirm);
    },
  );

  test.each([
    [7, "", ""],
    [3, "", "true"],
    [1, "", "true"],
    [0, "true", ""],
  ] as Array<[number, string, string]>)(
    "%s left: last code %s, running low %s",
    async (left: number, isLastCode: string, isRunningLow: string) => {
      await TwoFactorBackupCodeNotification.sendCodeUsedEmail({
        userId: REAUTH_USER_ID,
        remainingCodeCount: left,
        usedFor: BackupCodeUse.SignIn,
      });

      expect(sent()[0]!.vars["remainingCodeCount"]).toBe(String(left));
      expect(sent()[0]!.vars["isLastCode"]).toBe(isLastCode);
      expect(sent()[0]!.vars["isRunningLow"]).toBe(isRunningLow);
    },
  );

  test("links to the installation's own two-factor page", async () => {
    await TwoFactorBackupCodeNotification.sendCodeUsedEmail({
      userId: REAUTH_USER_ID,
      remainingCodeCount: 7,
      usedFor: BackupCodeUse.SignIn,
    });

    const twoFactor: URL = new URL(sent()[0]!.vars["twoFactorAuthUrl"]!);

    expect(twoFactor.origin).toBe("https://oneuptime.example.com");
    expect(twoFactor.pathname).toBe("/dashboard/user-profile/two-factor-auth");
  });

  test("the subject names the product the way the installation goes by", async () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Status");

    await TwoFactorBackupCodeNotification.sendCodeUsedEmail({
      userId: REAUTH_USER_ID,
      remainingCodeCount: 7,
      usedFor: BackupCodeUse.ConfirmItsYou,
    });

    expect(sent()[0]!.subject).toBe(
      "A backup code was used to confirm it's you in your Acme Status account",
    );
  });

  test.each([
    [
      "de",
      "Mit einem Backup-Code Ihres OneUptime-Kontos wurde bestätigt, dass Sie es sind",
    ],
    ["fa", "در حساب OneUptime شما با یک کد پشتیبان تأیید شد که خودتان هستید"],
    ["ar", "استُخدم رمز احتياطي لتأكيد هويتك في حسابك على OneUptime"],
  ])(
    "in the account's language: %s",
    async (language: string, subject: string) => {
      owner = { ...owner, language: language };

      await TwoFactorBackupCodeNotification.sendCodeUsedEmail({
        userId: REAUTH_USER_ID,
        remainingCodeCount: 7,
        usedFor: BackupCodeUse.ConfirmItsYou,
      });

      expect(sent()[0]!.language).toBe(language);
      expect(sent()[0]!.subject).toContain(subject.split("OneUptime")[0]!);
      expect(sent()[0]!.subject).toContain("OneUptime");
    },
  );

  test("an account in English names no language: it reads as it always has", async () => {
    await TwoFactorBackupCodeNotification.sendCodeUsedEmail({
      userId: REAUTH_USER_ID,
      remainingCodeCount: 7,
      usedFor: BackupCodeUse.SignIn,
    });

    expect(sent()[0]!.language).toBeUndefined();
  });

  test("the time is in the owner's own time zone", async () => {
    owner = { ...owner, timezone: Timezone.AsiaKolkata };

    await TwoFactorBackupCodeNotification.sendCodeUsedEmail({
      userId: REAUTH_USER_ID,
      remainingCodeCount: 7,
      usedFor: BackupCodeUse.SignIn,
      origin: ORIGIN,
    });

    expect(sent()[0]!.vars["usedAt"]).toContain("IST");
    expect(sent()[0]!.vars["requestedAt"]).toContain("IST");
  });

  test("the codes themselves are never in it", async () => {
    await TwoFactorBackupCodeNotification.sendCodeUsedEmail({
      userId: REAUTH_USER_ID,
      remainingCodeCount: 7,
      usedFor: BackupCodeUse.ConfirmItsYou,
    });

    expect(JSON.stringify(sent()[0])).not.toContain(RIGHT_BACKUP_CODE);
  });

  test("an account with no address is sent nothing, and nothing throws", async () => {
    jest.spyOn(UserService, "findOneById").mockResolvedValue(null as never);

    await expect(
      TwoFactorBackupCodeNotification.sendCodeUsedEmail({
        userId: REAUTH_USER_ID,
        remainingCodeCount: 7,
        usedFor: BackupCodeUse.SignIn,
      }),
    ).resolves.toBe(false);

    expect(sent()).toHaveLength(0);
  });
});

describe("a session signed out for getting Confirm It's You wrong too often (#10218)", () => {
  async function getItWrong(times: number): Promise<void> {
    for (let attempt: number = 0; attempt < times; attempt++) {
      await Reauthentication.confirm({
        session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
        proof: { password: `guess ${attempt}` },
        clientIp: "203.0.113.9",
        requestOrigin: ORIGIN,
      }).catch((): void => {
        return;
      });
    }

    await settle();
  }

  test("emails the owner exactly once, with when and from where", async () => {
    await getItWrong(REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT);

    expect(spies.revokeSession).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(1);

    const mail: SentMail = sent()[0]!;

    expect(mail.toEmail.toString()).toBe("river@example.com");
    expect(mail.subject).toBe(
      "A session of your OneUptime account was signed out",
    );
    expect(mail.templateType).toBe(EmailTemplateType.ReauthenticationSignedOut);
    expect(mail.vars["signedOutAt"]).toBeTruthy();
    expect(mail.vars["requestIpAddress"]).toBe("203.0.113.7");
    expect(mail.vars["requestLocation"]).toBe("Lyon, France");
    expect(mail.vars["requestDevice"]).toBe("Firefox 132 on Windows");
    expect(mail.vars["hasPassword"]).toBe("true");
    expect(new URL(mail.vars["forgotPasswordUrl"]!).pathname).toBe(
      "/accounts/forgot-password",
    );
  });

  test("no email for wrong attempts below the limit", async () => {
    await getItWrong(REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT - 1);

    expect(spies.revokeSession).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(0);
  });

  test("an attempt after the session already ended sends nothing more", async () => {
    await getItWrong(REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT);

    // The session is gone: a later attempt of its ends nothing live.
    spies.revokeSession.mockResolvedValue(false as never);

    await getItWrong(2);

    expect(sent()).toHaveLength(1);
  });

  test(`at most ${SIGNED_OUT_EMAILS_PER_DAY} a day for the account, however many sessions are signed out`, async () => {
    for (
      let session: number = 0;
      session < SIGNED_OUT_EMAILS_PER_DAY + 3;
      session++
    ) {
      await ReauthenticationSignedOutEmail.notify({
        userId: REAUTH_USER_ID,
        origin: ORIGIN,
      });
    }

    expect(sent()).toHaveLength(SIGNED_OUT_EMAILS_PER_DAY);
  });

  test("another account's sign-outs count for that account alone", async () => {
    for (
      let session: number = 0;
      session < SIGNED_OUT_EMAILS_PER_DAY;
      session++
    ) {
      await ReauthenticationSignedOutEmail.notify({ userId: REAUTH_USER_ID });
    }

    expect(
      await ReauthenticationSignedOutEmail.isWithinDailyLimit({
        userId: ObjectID.generate(),
      }),
    ).toBe(true);
  });

  test("a count that cannot be read lets the email through", async () => {
    valkey.isDown = true;

    await ReauthenticationSignedOutEmail.notify({ userId: REAUTH_USER_ID });

    expect(sent()).toHaveLength(1);
  });

  test("an account that signs in with single sign-on is told to tell its admin, not to reset a password", async () => {
    owner = { hasPassword: false };

    await ReauthenticationSignedOutEmail.notify({ userId: REAUTH_USER_ID });

    expect(sent()[0]!.vars["hasPassword"]).toBe("");
  });

  test.each([
    ["de", "Eine Sitzung Ihres OneUptime-Kontos wurde abgemeldet"],
    ["fa", "یکی از نشست‌های حساب OneUptime شما خارج شد"],
    ["ar", "سُجّل الخروج من إحدى جلسات حسابك على OneUptime"],
  ])(
    "in the account's language: %s",
    async (language: string, subject: string) => {
      owner = { ...owner, language: language };

      await ReauthenticationSignedOutEmail.notify({ userId: REAUTH_USER_ID });

      expect(sent()[0]!.language).toBe(language);
      // The product's name, set apart from a sentence read from the right.
      expect(withoutIsolateMarks(sent()[0]!.subject)).toBe(subject);
    },
  );

  test("a mail server that is down costs the email alone: the session is still signed out", async () => {
    sendMail.mockRejectedValue(new Error("SMTP is down") as never);

    await getItWrong(REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT);

    expect(spies.revokeSession).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });
});
