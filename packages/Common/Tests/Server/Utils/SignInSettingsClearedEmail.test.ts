import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import SignInSettingsClearedEmail, {
  EMAIL_HAND_OFF_TIMEOUT_IN_MS,
  SignInSettingsClearedEmailEvent,
} from "../../../Server/Utils/SignInSettingsClearedEmail";
import SsoManagedSignIn from "../../../Server/Utils/SsoManagedSignIn";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import {
  LocalSignInSettings,
  NO_LOCAL_SIGN_IN_SETTINGS,
} from "../../../Types/SSO/LocalSignInClearing";
import { SignInSettingsClearedBy } from "../../../Types/SSO/SignInSettingsClearedEmail";
import { SignInManagement } from "../../../Types/SSO/SsoManagedSignIn";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * EMAILING THE PEOPLE WHOSE SIGN-IN SETTINGS WERE CLEARED (#9818, #9820).
 *
 * A clear cannot be undone, so its person is told - and only its person,
 * at the address on their account, in their language. And a clear never
 * waits for, or fails with, the mail service:
 *
 *   - one email per person whose clear removed something, none for a clear
 *     that removed nothing, and none for an account that is gone or has no
 *     address;
 *   - the address read off the account, never one a caller names;
 *   - the language and time zone on the account;
 *   - how they sign in now, read from the rule: SSO and its providers,
 *     Forgot password? when nothing manages their sign-in, both when the
 *     rule cannot be read;
 *   - each email bounded in time, sent one after another, a failure logged
 *     by the person's id - never their address - and never in the way of
 *     the next email, nor thrown at the clear.
 */

const ALICE_ID: ObjectID = new ObjectID("aa000000-0000-4000-8000-00000000000a");
const BOB_ID: ObjectID = new ObjectID("bb000000-0000-4000-8000-00000000000b");

const EVERYTHING: LocalSignInSettings = {
  hasPassword: true,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 1,
  passkeyAndSecurityKeyCount: 2,
  backupCodeCount: 10,
};

interface StoredAccount {
  email: string | null;
  language?: string | undefined;
  timezone?: Timezone | undefined;
}

let accounts: Map<string, StoredAccount>;
let management: Map<string, SignInManagement | Error>;

let findOneById: jest.SpyInstance;
let sendMail: jest.SpyInstance;
let loggerError: jest.SpyInstance;

const keyOf: (id: ObjectID) => string = (id: ObjectID): string => {
  return id.toString().toLowerCase();
};

const event: (
  userId: ObjectID,
  cleared?: LocalSignInSettings,
) => SignInSettingsClearedEmailEvent = (
  userId: ObjectID,
  cleared?: LocalSignInSettings,
): SignInSettingsClearedEmailEvent => {
  return {
    userId: userId,
    cleared: cleared || EVERYTHING,
    clearedBy: SignInSettingsClearedBy.ServerAdmin,
  };
};

const mailAt: (index: number) => EmailMessage = (
  index: number,
): EmailMessage => {
  return sendMail.mock.calls[index]![0] as EmailMessage;
};

const varsAt: (index: number) => Dictionary<string> = (
  index: number,
): Dictionary<string> => {
  return mailAt(index).vars as Dictionary<string>;
};

beforeEach(() => {
  accounts = new Map<string, StoredAccount>([
    [keyOf(ALICE_ID), { email: "alice@example.com" }],
    [keyOf(BOB_ID), { email: "bob@example.com" }],
  ]);

  management = new Map<string, SignInManagement | Error>([
    [
      keyOf(ALICE_ID),
      {
        isManagedBySso: true,
        ssoProviderNames: ["Okta"],
        localSignInProjectNames: [],
      },
    ],
    [
      keyOf(BOB_ID),
      {
        isManagedBySso: true,
        ssoProviderNames: ["Okta"],
        localSignInProjectNames: [],
      },
    ],
  ]);

  findOneById = getJestSpyOn(UserService, "findOneById").mockImplementation(
    async (data: { id: ObjectID }): Promise<User | null> => {
      const stored: StoredAccount | undefined = accounts.get(keyOf(data.id));

      if (!stored) {
        return null;
      }

      const user: User = new User();
      user._id = data.id.toString();

      if (stored.email) {
        user.email = new Email(stored.email);
      }

      if (stored.language) {
        user.language = stored.language;
      }

      if (stored.timezone) {
        user.timezone = stored.timezone;
      }

      return user;
    },
  );

  getJestSpyOn(SsoManagedSignIn, "getSignInManagement").mockImplementation(
    async (userId: ObjectID): Promise<SignInManagement> => {
      const answer: SignInManagement | Error | undefined = management.get(
        keyOf(userId),
      );

      if (answer instanceof Error) {
        throw answer;
      }

      return (
        answer || {
          isManagedBySso: false,
          ssoProviderNames: [],
          localSignInProjectNames: [],
        }
      );
    },
  );

  getJestSpyOn(DatabaseConfig, "getHost").mockResolvedValue(
    new Hostname("oneuptime.example.com"),
  );
  getJestSpyOn(DatabaseConfig, "getHttpProtocol").mockResolvedValue(
    Protocol.HTTPS,
  );

  sendMail = getJestSpyOn(MailService, "sendMail").mockResolvedValue(undefined);

  loggerError = getJestSpyOn(logger, "error").mockImplementation(
    (): void => {},
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who is emailed", () => {
  test("one email per person cleared, to the address on their account", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]);

    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(mailAt(0).toEmail.toString()).toBe("alice@example.com");
    expect(mailAt(1).toEmail.toString()).toBe("bob@example.com");
  });

  test("the address is read off the account, as OneUptime", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    const lookup: { id: ObjectID; props: Dictionary<unknown> } = findOneById
      .mock.calls[0]![0] as { id: ObjectID; props: Dictionary<unknown> };

    expect(lookup.id.toString()).toBe(ALICE_ID.toString());
    expect(lookup.props).toEqual({ isRoot: true });
  });

  test("a clear that removed nothing sends nothing, and reads nothing", async () => {
    await SignInSettingsClearedEmail.notify([
      event(ALICE_ID, NO_LOCAL_SIGN_IN_SETTINGS),
    ]);

    expect(findOneById).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("of a batch, only those whose clear removed something are emailed", async () => {
    await SignInSettingsClearedEmail.notify([
      event(ALICE_ID, NO_LOCAL_SIGN_IN_SETTINGS),
      event(BOB_ID),
    ]);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(mailAt(0).toEmail.toString()).toBe("bob@example.com");
  });

  test("an account that is gone, or has no address, is not emailed and stops nobody else", async () => {
    accounts.delete(keyOf(ALICE_ID));
    accounts.set(keyOf(BOB_ID), { email: null });

    const carol: ObjectID = new ObjectID(
      "cc000000-0000-4000-8000-00000000000c",
    );
    accounts.set(keyOf(carol), { email: "carol@example.com" });

    await SignInSettingsClearedEmail.notify([
      event(ALICE_ID),
      event(BOB_ID),
      event(carol),
    ]);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(mailAt(0).toEmail.toString()).toBe("carol@example.com");
  });

  test("nobody to email is nothing", async () => {
    await expect(SignInSettingsClearedEmail.notify([])).resolves.toBe(
      undefined,
    );
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("what the email is", () => {
  test("the cleared-settings template, its subject literal and naming the product", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    expect(mailAt(0).templateType).toBe(
      EmailTemplateType.SignInSettingsCleared,
    );
    expect(mailAt(0).isSubjectLiteral).toBe(true);
    expect(mailAt(0).subject).toBe(
      "Your OneUptime sign-in settings were cleared",
    );
  });

  test("in English for a person with no language, with no language on the email", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    expect(mailAt(0).language).toBeUndefined();
  });

  test("in the language on the person's account: its subject, and the email's own words", async () => {
    accounts.set(keyOf(ALICE_ID), {
      email: "alice@example.com",
      language: "de",
    });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    expect(mailAt(0).language).toBe("de");
    expect(mailAt(0).subject).toContain("OneUptime");
    expect(mailAt(0).subject).not.toBe(
      "Your OneUptime sign-in settings were cleared",
    );
  });

  test("says when, in the person's own time zone", async () => {
    accounts.set(keyOf(ALICE_ID), {
      email: "alice@example.com",
      timezone: Timezone.AsiaKolkata,
    });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]);

    const aliceAt: string = varsAt(0)["clearedAt"]!;
    const bobAt: string = varsAt(1)["clearedAt"]!;

    expect(aliceAt).toBeTruthy();
    expect(bobAt).toBeTruthy();
    // Bob has no time zone: UTC, as every account email without one.
    expect(bobAt).toContain("UTC");
    expect(aliceAt).not.toContain("UTC");
  });

  test("names exactly what that person had removed", async () => {
    await SignInSettingsClearedEmail.notify([
      event(ALICE_ID, {
        hasPassword: true,
        isTwoFactorAuthEnabled: false,
        authenticatorAppCount: 0,
        passkeyAndSecurityKeyCount: 2,
        backupCodeCount: 0,
      }),
    ]);

    expect(varsAt(0)["removedPassword"]).toBe("true");
    expect(varsAt(0)["removedPasskeyCount"]).toBe("2");
    expect(varsAt(0)["removedAuthenticatorAppCount"]).toBeUndefined();
    expect(varsAt(0)["removedBackupCodeCount"]).toBeUndefined();
    expect(varsAt(0)["turnedOffTwoFactorAuth"]).toBeUndefined();
  });

  test("a server admin's clear names no admin; a project owner's names the project, not the owner", async () => {
    await SignInSettingsClearedEmail.notify([
      event(ALICE_ID),
      {
        userId: BOB_ID,
        cleared: EVERYTHING,
        clearedBy: SignInSettingsClearedBy.ProjectOwner,
        projectName: "Acme Production",
      },
    ]);

    expect(varsAt(0)["clearedByServerAdmin"]).toBe("true");
    expect(varsAt(0)["projectName"]).toBeUndefined();
    expect(varsAt(1)["clearedByProjectOwner"]).toBe("true");
    expect(varsAt(1)["projectName"]).toBe("Acme Production");
  });

  test("each email is about its reader alone: nothing of the others cleared with them", async () => {
    await SignInSettingsClearedEmail.notify([
      event(ALICE_ID, { ...EVERYTHING, backupCodeCount: 3 }),
      event(BOB_ID, { ...EVERYTHING, backupCodeCount: 7 }),
    ]);

    const aliceMail: string = JSON.stringify(mailAt(0));
    const bobMail: string = JSON.stringify(mailAt(1));

    expect(aliceMail).not.toContain("bob");
    expect(aliceMail).not.toContain(BOB_ID.toString());
    expect(bobMail).not.toContain("alice");
    expect(bobMail).not.toContain(ALICE_ID.toString());
    expect(varsAt(0)["removedBackupCodeCount"]).toBe("3");
    expect(varsAt(1)["removedBackupCodeCount"]).toBe("7");
  });

  test("the buttons go to this server's sign-in pages", async () => {
    management.set(keyOf(BOB_ID), {
      isManagedBySso: false,
      ssoProviderNames: [],
      localSignInProjectNames: [],
    });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]);

    expect(varsAt(0)["ssoSignInUrl"]).toBe(
      "https://oneuptime.example.com/accounts/sso",
    );
    expect(varsAt(0)["signInUrl"]).toBe(
      "https://oneuptime.example.com/accounts/login",
    );
    expect(varsAt(1)["forgotPasswordUrl"]).toBe(
      "https://oneuptime.example.com/accounts/forgot-password",
    );
  });

  test("each email is bounded in time and filed under its person", async () => {
    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    const options: { userId?: ObjectID; timeoutInMs?: number } = sendMail.mock
      .calls[0]![1] as { userId?: ObjectID; timeoutInMs?: number };

    expect(options.timeoutInMs).toBe(EMAIL_HAND_OFF_TIMEOUT_IN_MS);
    expect(options.userId?.toString()).toBe(ALICE_ID.toString());
  });
});

describe("how the email says to sign in now", () => {
  test("while SSO manages their sign-in: with SSO, naming its providers", async () => {
    management.set(keyOf(ALICE_ID), {
      isManagedBySso: true,
      ssoProviderNames: ["Okta", "Azure AD"],
      localSignInProjectNames: [],
    });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    expect(varsAt(0)["signsInWithSso"]).toBe("true");
    expect(varsAt(0)["ssoProviderNames"]).toBe("Okta · Azure AD");
    expect(varsAt(0)["setsNewPassword"]).toBeUndefined();
  });

  test("while nothing manages it - a master admin, a server that does not require SSO: a new password", async () => {
    management.set(keyOf(ALICE_ID), {
      isManagedBySso: false,
      ssoProviderNames: ["Okta"],
      localSignInProjectNames: ["Side Project"],
    });

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    expect(varsAt(0)["setsNewPassword"]).toBe("true");
    expect(varsAt(0)["signsInWithSso"]).toBeUndefined();
    // Nothing about their other projects reaches the email.
    expect(JSON.stringify(mailAt(0))).not.toContain("Side Project");
  });

  test("when the rule cannot be read: the email still goes, naming both ways", async () => {
    management.set(keyOf(ALICE_ID), new Error("database unavailable"));

    await SignInSettingsClearedEmail.notify([event(ALICE_ID)]);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(varsAt(0)["signInWayUnknown"]).toBe("true");
  });
});

describe("never in the clear's way", () => {
  test("a mail service that throws is logged by the person's id, never their address, and the next person is still emailed", async () => {
    sendMail.mockRejectedValueOnce(new Error("mail service down"));

    await expect(
      SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]),
    ).resolves.toBe(undefined);

    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(mailAt(1).toEmail.toString()).toBe("bob@example.com");

    const logged: string = loggerError.mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .join("\n");

    expect(logged).toContain(ALICE_ID.toString());
    expect(logged).not.toContain("alice@example.com");
  });

  test("a mail service that refuses the email is logged too, and stops nobody", async () => {
    sendMail.mockResolvedValueOnce(
      new HTTPErrorResponse(503, { message: "busy" }, {}),
    );

    await SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]);

    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(
      loggerError.mock.calls.some((call: Array<unknown>): boolean => {
        return String(call[0]).includes(ALICE_ID.toString());
      }),
    ).toBe(true);
  });

  test("reading the account failing is logged and never thrown", async () => {
    findOneById.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      SignInSettingsClearedEmail.notify([event(ALICE_ID), event(BOB_ID)]),
    ).resolves.toBe(undefined);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(mailAt(0).toEmail.toString()).toBe("bob@example.com");
  });

  test("emails go one after another: the next waits for the one before", async () => {
    let releaseFirst: () => void = (): void => {};
    const firstSent: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        releaseFirst = resolve;
      },
    );

    sendMail.mockImplementationOnce(async (): Promise<void> => {
      await firstSent;
    });

    const sending: Promise<void> = SignInSettingsClearedEmail.notify([
      event(ALICE_ID),
      event(BOB_ID),
    ]);

    // Let everything that is not waiting on the first email run.
    for (let tick: number = 0; tick < 20; tick++) {
      await Promise.resolve();
    }

    expect(sendMail).toHaveBeenCalledTimes(1);

    releaseFirst();
    await sending;

    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  test("a second clear's emails wait behind the first's", async () => {
    let releaseFirst: () => void = (): void => {};
    const firstSent: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        releaseFirst = resolve;
      },
    );

    sendMail.mockImplementationOnce(async (): Promise<void> => {
      await firstSent;
    });

    const first: Promise<void> = SignInSettingsClearedEmail.notify([
      event(ALICE_ID),
    ]);
    const second: Promise<void> = SignInSettingsClearedEmail.notify([
      event(BOB_ID),
    ]);

    for (let tick: number = 0; tick < 20; tick++) {
      await Promise.resolve();
    }

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(mailAt(0).toEmail.toString()).toBe("alice@example.com");

    releaseFirst();
    await Promise.all([first, second]);

    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(mailAt(1).toEmail.toString()).toBe("bob@example.com");
  });
});
