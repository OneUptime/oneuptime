import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { visibleText } from "Common/Tests/Helpers/HtmlText";
import { withoutIsolateMarks } from "Common/Tests/Helpers/IsolateMarks";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import {
  getEmailLanguageVariables,
  registerEmailLanguageHelpers,
} from "../../FeatureSet/Notification/Utils/EmailLanguage";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real helpers (brandName, concat, ifCond) as an
 * import side effect, so this suite renders with what the product ships.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

registerEmailLanguageHelpers(Handlebars);

/*
 * THE TWO EMAILS CONFIRM IT'S YOU SENDS THE ACCOUNT'S OWNER, RENDERED.
 *
 *   - TwoFactorBackupCodeUsed.hbs: one of their backup codes was spent - to
 *     sign in, or to confirm it was them (#10219, usedToConfirmItsYou) -
 *     with when, how many are left and what to do about that, and from
 *     where;
 *   - ReauthenticationSignedOut.hbs: a session of their account was signed
 *     out after too many wrong attempts to confirm it was them (#10218),
 *     with when, from where, that the account is not locked, and what to
 *     do: reset the password (hasPassword), or tell their organization's
 *     admin.
 *
 * Every word of theirs is OneUptime's, in the language on the account
 * (Utils/EmailLanguage.ts): in English word for word, and in every language
 * the server writes - Persian and Arabic laid out from the right - with no
 * English sentence left; the values (the time, the count, the request's
 * rows, the links) as they are, escaped.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const LANGUAGES: ReadonlyArray<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
  "ar",
];

const TWO_FACTOR_URL: string =
  "https://oneuptime.test/dashboard/user-profile/two-factor-auth";
const FORGOT_PASSWORD_URL: string =
  "https://oneuptime.test/accounts/forgot-password";

const REQUEST_VARS: Record<string, string> = {
  requestedAt: "20 Nov 2026, 11:30 (Europe/Berlin)",
  requestIpAddress: "203.0.113.7",
  requestLocation: "Berlin, Germany",
  requestDevice: "Firefox on Linux",
};

const SELF_HOSTED: Record<string, string> = { isSelfHosted: "true" };
const CLOUD: Record<string, string> = {};

function render(
  type: EmailTemplateType,
  vars: Record<string, unknown>,
  root: Record<string, unknown> = SELF_HOSTED,
): string {
  return Handlebars.compile(
    fs.readFileSync(Path.resolve(TEMPLATES_DIR, type), { encoding: "utf8" }),
  )({
    year: "2026",
    homeUrl: "https://oneuptime.test/",
    homeURL: "https://oneuptime.test/",
    ...vars,
    ...root,
  });
}

function backupCodeUsed(
  vars: Record<string, unknown> = {},
  root?: Record<string, unknown>,
): string {
  return render(
    EmailTemplateType.TwoFactorBackupCodeUsed,
    {
      usedAt: "20 Nov 2026, 11:30 (Europe/Berlin)",
      remainingCodeCount: "7",
      usedToConfirmItsYou: "",
      isLastCode: "",
      isRunningLow: "",
      twoFactorAuthUrl: TWO_FACTOR_URL,
      ...REQUEST_VARS,
      ...vars,
    },
    root,
  );
}

function signedOut(
  vars: Record<string, unknown> = {},
  root?: Record<string, unknown>,
): string {
  return render(
    EmailTemplateType.ReauthenticationSignedOut,
    {
      signedOutAt: "20 Nov 2026, 11:30 (Europe/Berlin)",
      hasPassword: "true",
      forgotPasswordUrl: FORGOT_PASSWORD_URL,
      ...REQUEST_VARS,
      ...vars,
    },
    root,
  );
}

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    if (!filename.endsWith(".hbs")) {
      continue;
    }

    Handlebars.registerPartial(
      filename.slice(0, -".hbs".length),
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }
});

describe("TwoFactorBackupCodeUsed.hbs says what the code was used for (#10219)", () => {
  test("to sign in", () => {
    const text: string = visibleText(backupCodeUsed());

    expect(text).toContain(
      "A backup code was used to sign in to your account.",
    );
    expect(text).toContain(
      "Someone signed in to your OneUptime account with one of your two-factor authentication backup codes. Each backup code works once, so this one is now spent.",
    );
    expect(text).toContain(
      "If this was not you, change your password right away, then make a new set of backup codes: a new set replaces every code you have now.",
    );
    expect(text).not.toContain("to confirm it");
  });

  test("to confirm it was them, before a change Confirm It's You asked for", () => {
    const text: string = visibleText(
      backupCodeUsed({ usedToConfirmItsYou: "true" }),
    );

    expect(text).toContain("A backup code was used to confirm it's you.");
    expect(text).toContain(
      "One of your two-factor authentication backup codes was used to confirm it was you, in a session signed in to your OneUptime account. Each backup code works once, so this one is now spent.",
    );
    expect(text).toContain(
      "If this was not you, someone who can sign in to your account knows your password and has your backup codes.",
    );
    expect(text).not.toContain("to sign in to your account.");
  });

  test("when, how many are left and from where, in one card", () => {
    const text: string = visibleText(backupCodeUsed());

    expect(text).toContain(
      "Used at: 20 Nov 2026, 11:30 (Europe/Berlin) Backup codes remaining: 7 IP address: 203.0.113.7 Approximate location: Berlin, Germany Device: Firefox on Linux",
    );
  });

  test.each([
    [{}, "You can see how many backup codes you have left"],
    [{ isRunningLow: "true" }, "You are running low on backup codes."],
    [{ isLastCode: "true" }, "That was your last backup code."],
  ] as Array<[Record<string, string>, string]>)(
    "the advice that goes with what is left",
    (vars: Record<string, string>, advice: string) => {
      expect(visibleText(backupCodeUsed(vars))).toContain(advice);
    },
  );

  test("one button, to the installation's two-factor page", () => {
    const html: string = backupCodeUsed();

    expect(visibleText(html)).toContain("Manage Two-Factor Authentication");
    expect(html).toContain(TWO_FACTOR_URL);
  });

  test("the installation's own name, escaped like any value", () => {
    const html: string = backupCodeUsed(
      {},
      {
        ...SELF_HOSTED,
        isBrandRenamed: "true",
        brandProductName: "Acme <Watch>",
      },
    );

    expect(visibleText(html)).toContain("your Acme <Watch> account");
    expect(html).not.toContain("<Watch>");
  });
});

describe("ReauthenticationSignedOut.hbs (#10218)", () => {
  test("what happened, that the account is not locked, when and from where", () => {
    const text: string = visibleText(signedOut());

    expect(text).toContain("A session of your account was signed out");
    expect(text).toContain(
      "A session signed in to your OneUptime account was asked to confirm it was you, and got it wrong too many times, so it has been signed out.",
    );
    expect(text).toContain(
      "Your account is not locked: you can sign in as usual.",
    );
    expect(text).toContain(
      "Signed out at: 20 Nov 2026, 11:30 (Europe/Berlin) IP address: 203.0.113.7 Approximate location: Berlin, Germany Device: Firefox on Linux",
    );
    expect(text).toContain("If this was you, sign in again to carry on.");
  });

  test("an account with a password: reset it, which signs every device out", () => {
    const html: string = signedOut();
    const text: string = visibleText(html);

    expect(text).toContain(
      "Reset your password: a new password signs every device out of your account.",
    );
    expect(text).toContain("Reset your password");
    expect(html).toContain(FORGOT_PASSWORD_URL);
    expect(text).not.toContain("Tell your organization's admin");
  });

  test("an account that signs in with single sign-on: tell the organization's admin, no reset", () => {
    const html: string = signedOut({ hasPassword: "" });
    const text: string = visibleText(html);

    expect(text).toContain("Tell your organization's admin right away.");
    expect(html).not.toContain(FORGOT_PASSWORD_URL);
  });

  test("the request's rows are values, written as text", () => {
    const html: string = signedOut({ requestDevice: "<b>Chrome</b>" });

    expect(html).not.toContain("<b>Chrome</b>");
    expect(html).toContain("&lt;b&gt;Chrome&lt;/b&gt;");
  });

  test("the help line at its foot, on either kind of server", () => {
    expect(visibleText(signedOut({}, SELF_HOSTED))).toContain(
      "Need help? Ask your server's admin.",
    );
    expect(signedOut({}, CLOUD)).toContain(
      '<a href="mailto:support@oneuptime.com"',
    );
  });
});

describe("in every language the server writes", () => {
  const ENGLISH_SENTENCES: ReadonlyArray<string> = [
    "A backup code was used",
    "backup codes",
    "Each backup code works once",
    "Used at:",
    "Backup codes remaining:",
    "If this was not you",
    "Manage Two-Factor Authentication",
    "A session of your account",
    "was asked to confirm it was you",
    "Your account is not locked",
    "Signed out at:",
    "If this was you",
    "Reset your password",
    "Tell your organization's admin",
    "Need help?",
  ];

  test.each([...LANGUAGES])(
    "%s: no English sentence is left in either email, on either kind of server",
    (language: string) => {
      for (const server of [SELF_HOSTED, CLOUD]) {
        const root: Record<string, unknown> = {
          ...server,
          ...getEmailLanguageVariables(language),
        };
        const emails: Array<[string, string]> = [
          ["backup code to sign in", visibleText(backupCodeUsed({}, root))],
          [
            "backup code to confirm it's you",
            visibleText(
              backupCodeUsed(
                { usedToConfirmItsYou: "true", isLastCode: "true" },
                root,
              ),
            ),
          ],
          [
            "backup codes running low",
            visibleText(backupCodeUsed({ isRunningLow: "true" }, root)),
          ],
          ["signed out, with a password", visibleText(signedOut({}, root))],
          [
            "signed out, single sign-on",
            visibleText(signedOut({ hasPassword: "" }, root)),
          ],
        ];

        for (const [email, text] of emails) {
          for (const english of ENGLISH_SENTENCES) {
            expect({
              language,
              email,
              english,
              isLeft: text.includes(english),
            }).toEqual({ language, email, english, isLeft: false });
          }

          // The request's rows are values: they stay as they are.
          expect(text).toContain("203.0.113.7");
          expect(text).toContain("Firefox on Linux");
        }
      }
    },
  );

  test.each(["fa", "ar"])(
    "%s: laid out from the right, the values and the links as they are",
    (language: string) => {
      const root: Record<string, unknown> = {
        ...SELF_HOSTED,
        ...getEmailLanguageVariables(language),
      };

      for (const html of [
        backupCodeUsed({ usedToConfirmItsYou: "true" }, root),
        signedOut({}, root),
      ]) {
        expect(html).toContain('dir="rtl"');
      }

      expect(backupCodeUsed({}, root)).toContain(TWO_FACTOR_URL);
      expect(signedOut({}, root)).toContain(FORGOT_PASSWORD_URL);
      expect(visibleText(backupCodeUsed({}, root))).toContain("7");
    },
  );

  test("German reads as the account's emails do, with Sie", () => {
    const text: string = visibleText(
      signedOut({}, { ...SELF_HOSTED, ...getEmailLanguageVariables("de") }),
    );

    expect(text).toContain("Eine Sitzung Ihres Kontos wurde abgemeldet");
    expect(text).toContain(
      "Ihr Konto ist nicht gesperrt: Sie können sich wie gewohnt anmelden.",
    );
  });

  test("Persian and Arabic name the product inside their own sentence, set apart from it", () => {
    const persian: string = visibleText(
      signedOut({}, { ...SELF_HOSTED, ...getEmailLanguageVariables("fa") }),
    );
    const arabic: string = visibleText(
      signedOut({}, { ...SELF_HOSTED, ...getEmailLanguageVariables("ar") }),
    );

    expect(withoutIsolateMarks(persian)).toContain("حساب OneUptime شما");
    expect(withoutIsolateMarks(arabic)).toContain("حسابك على OneUptime");
    // A Latin name in a sentence read from the right is isolated, so it cannot move the words around it.
    expect(persian).toContain("\u2068OneUptime\u2069");
  });
});
