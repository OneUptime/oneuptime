import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { visibleText } from "Common/Tests/Helpers/HtmlText";
import {
  EmailAddressChangedBy,
  getEmailAddressChangerVariables,
} from "Common/Types/Accounts/EmailAddressChangedEmail";
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
 * THE EMAILS TO A NEW ADDRESS, IN THE READER'S LANGUAGE, AND WHO MADE THE
 * CHANGE (#10157).
 *
 *   - ConfirmEmailChange.hbs: the link that confirms a person's own new
 *     address;
 *   - EmailChangeAddressTaken.hbs: word that another account has it;
 *   - EmailChanged.hbs: the link to an address written straight away, which
 *     said "You have changed your email" whoever had - now it says who did,
 *     by role, as the email to the address the account left says it (#9907):
 *     a server admin, the organization's identity provider, the person
 *     themselves (a master admin's own change), or nobody named - and when.
 *
 * Every word of theirs is OneUptime's, in the language the email is sent in
 * (Utils/EmailLanguage.ts), the help line at their foot included
 * (Partials/SupportBlock.hbs): rendered here in English word for word as
 * before, and in every language the server writes, Persian and Arabic laid
 * out from the right, with no English sentence left.
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

const VERIFY_URL: string =
  "https://oneuptime.test/accounts/verify-email/0b9f9d5e-8a5c-4b9a-9d42-6b1e2c3d4e5f";
const SIGN_IN_LINK: string = "https://oneuptime.test/accounts/login";

const REQUEST_VARS: Record<string, string> = {
  homeURL: "https://oneuptime.test/",
  requestedAt: "19 Nov 2026, 11:30 (Europe/Berlin)",
  requestIpAddress: "203.0.113.7",
  requestLocation: "Berlin, Germany",
  requestDevice: "Firefox on Linux",
};

const SELF_HOSTED: Record<string, string> = { isSelfHosted: "true" };
const CLOUD: Record<string, string> = {};

function source(type: EmailTemplateType): string {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, type), {
    encoding: "utf8",
  });
}

function render(
  type: EmailTemplateType,
  vars: Record<string, unknown>,
  root: Record<string, unknown> = SELF_HOSTED,
): string {
  return Handlebars.compile(source(type))({
    year: "2026",
    ...vars,
    ...root,
  });
}

function confirm(root?: Record<string, unknown>): string {
  return render(
    EmailTemplateType.ConfirmEmailChange,
    { tokenVerifyUrl: VERIFY_URL, expiresInHours: "24", ...REQUEST_VARS },
    root,
  );
}

function taken(root?: Record<string, unknown>): string {
  return render(
    EmailTemplateType.EmailChangeAddressTaken,
    { signInLink: SIGN_IN_LINK, ...REQUEST_VARS },
    root,
  );
}

function changed(
  changedBy: EmailAddressChangedBy,
  root?: Record<string, unknown>,
): string {
  return render(
    EmailTemplateType.EmailChanged,
    {
      tokenVerifyUrl: VERIFY_URL,
      homeUrl: "https://oneuptime.test/",
      changedAt: "Nov 20, 2026, 9:15 AM (Europe/Berlin)",
      ...getEmailAddressChangerVariables(changedBy),
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

describe("EmailChanged.hbs says who made the change, by role, and when", () => {
  test.each([
    [
      EmailAddressChangedBy.ServerAdmin,
      "A server admin made this the email address of your OneUptime account.",
    ],
    [
      EmailAddressChangedBy.IdentityProvider,
      "Your organization's identity provider made this the email address of your OneUptime account.",
    ],
    [
      EmailAddressChangedBy.AccountOwner,
      "You made this the email address of your OneUptime account.",
    ],
    [
      EmailAddressChangedBy.OneUptime,
      "This is now the email address of your OneUptime account.",
    ],
  ])("changed by %s", (changedBy: EmailAddressChangedBy, sentence: string) => {
    const text: string = visibleText(changed(changedBy));

    expect(text).toContain("Verify Your New Email Address");
    expect(text).toContain(sentence);
    expect(text).toContain("Nov 20, 2026, 9:15 AM (Europe/Berlin)");
    expect(text).toContain("Verify Email");
    // No longer says the reader made a change somebody else made.
    expect(text).not.toContain("You have changed your email");
    expect(text).not.toContain("Please verify your email");
  });

  test("only one changer is said", () => {
    const text: string = visibleText(
      changed(EmailAddressChangedBy.ServerAdmin),
    );

    expect(text).not.toContain("identity provider");
    expect(text).not.toContain("You made this");
    expect(text).not.toContain("This is now the email address");
  });

  test("an identity provider's change says whom to ask: the organization's admin", () => {
    expect(
      visibleText(changed(EmailAddressChangedBy.IdentityProvider)),
    ).toContain(
      "If you did not expect this, contact your organization's admin.",
    );
    expect(
      visibleText(changed(EmailAddressChangedBy.ServerAdmin)),
    ).not.toContain("contact your organization's admin");
  });

  test("the installation's own name, escaped like any value", () => {
    const html: string = changed(EmailAddressChangedBy.ServerAdmin, {
      ...SELF_HOSTED,
      isBrandRenamed: "true",
      brandProductName: "Acme <Watch>",
    });

    expect(visibleText(html)).toContain(
      "A server admin made this the email address of your Acme <Watch> account.",
    );
    expect(html).not.toContain("<Watch>");
  });

  test("one button: the link that verifies the new address", () => {
    const html: string = changed(EmailAddressChangedBy.ServerAdmin);

    expect(html.split(VERIFY_URL).length - 1).toBeGreaterThanOrEqual(2);
  });

  test("without a time, the card is left out", () => {
    const text: string = visibleText(
      render(EmailTemplateType.EmailChanged, {
        tokenVerifyUrl: VERIFY_URL,
        ...getEmailAddressChangerVariables(EmailAddressChangedBy.ServerAdmin),
      }),
    );

    expect(text).not.toContain("Changed at:");
  });
});

describe("in English, word for word as before", () => {
  test("ConfirmEmailChange keeps its words", () => {
    const text: string = visibleText(confirm());

    expect(text).toContain("Confirm Your New Email Address");
    expect(text).toContain(
      "Someone asked to make this the email address of their OneUptime account. If that was you, confirm it with the button below.",
    );
    expect(text).toContain("Confirm Email Address");
    expect(text).toContain("This link works for 24 hours, and only once.");
    expect(text).toContain(
      "Didn't ask for this? You can safely ignore this email. Nothing changes unless the link above is opened.",
    );
    expect(text).toContain("Need help? Ask your server's admin.");
  });

  test("EmailChangeAddressTaken keeps its words", () => {
    const text: string = visibleText(taken());

    expect(text).toContain("This Address Already Has an Account");
    expect(text).toContain(
      "This address already has an account, so it cannot be used for a second one, and nothing was changed.",
    );
    expect(text).toContain("Sign In");
  });

  test("a link that works for one hour says so in the singular", () => {
    expect(
      visibleText(
        render(EmailTemplateType.ConfirmEmailChange, {
          tokenVerifyUrl: VERIFY_URL,
          expiresInHours: "1",
        }),
      ),
    ).toContain("This link works for 1 hour, and only once.");
  });

  test("on OneUptime Cloud, the help line names OneUptime's support", () => {
    const html: string = confirm(CLOUD);

    expect(html).toContain('Need help? <a href="mailto:support@oneuptime.com"');
    expect(visibleText(html)).toContain("Contact support");
  });
});

describe("in every language the server writes", () => {
  const ENGLISH_SENTENCES: ReadonlyArray<string> = [
    "Confirm Your New Email Address",
    "Someone asked",
    "Confirm Email Address",
    "Or copy and paste",
    "Details of the request",
    "Requested at:",
    "This link works for",
    "Didn't ask for this?",
    "This Address Already Has an Account",
    "already has an account",
    "If you asked for this",
    "Verify Your New Email Address",
    "made this the email address",
    "This is now the email address",
    "Verify it with the button below",
    "Changed at:",
    "You can also copy and paste",
    "If you did not expect this",
    "Need help?",
    "Contact support",
    "server's admin",
  ];

  test.each([...LANGUAGES])(
    "%s: no English sentence is left in any of the three, on either kind of server",
    (language: string) => {
      for (const server of [SELF_HOSTED, CLOUD]) {
        const root: Record<string, unknown> = {
          ...server,
          ...getEmailLanguageVariables(language),
        };
        const emails: Array<[string, string]> = [
          ["ConfirmEmailChange", visibleText(confirm(root))],
          ["EmailChangeAddressTaken", visibleText(taken(root))],
          ...Object.values(EmailAddressChangedBy).map(
            (changedBy: EmailAddressChangedBy): [string, string] => {
              return [
                `EmailChanged (${changedBy})`,
                visibleText(changed(changedBy, root)),
              ];
            },
          ),
        ];

        for (const [email, text] of emails) {
          for (const english of ENGLISH_SENTENCES) {
            expect({
              language,
              email,
              english,
              isLeft: text.includes(english),
            }).toEqual({
              language,
              email,
              english,
              isLeft: false,
            });
          }

          // The request's rows are values: they stay as they are.
          if (!email.startsWith("EmailChanged")) {
            expect(text).toContain("203.0.113.7");
          }
        }
      }
    },
  );

  test.each(["fa", "ar"])(
    "%s: laid out from the right, the address and the link as they are",
    (language: string) => {
      const root: Record<string, unknown> = {
        ...SELF_HOSTED,
        ...getEmailLanguageVariables(language),
      };

      for (const html of [
        confirm(root),
        taken(root),
        changed(EmailAddressChangedBy.ServerAdmin, root),
      ]) {
        expect(html).toContain('dir="rtl"');
      }

      expect(confirm(root)).toContain(VERIFY_URL);
      expect(visibleText(confirm(root))).toContain("Firefox on Linux");
    },
  );

  test("German: the help line at the foot is German too, on both kinds of server", () => {
    const selfHosted: string = visibleText(
      confirm({ ...SELF_HOSTED, ...getEmailLanguageVariables("de") }),
    );
    const cloud: string = confirm({
      ...CLOUD,
      ...getEmailLanguageVariables("de"),
    });

    expect(selfHosted).not.toContain("Need help?");
    expect(cloud).toContain('<a href="mailto:support@oneuptime.com"');
    expect(visibleText(cloud)).not.toContain("Contact support");
  });

  test("the inviter's name stays the inviter's own words in every language, escaped", () => {
    const html: string = render(
      EmailTemplateType.ConfirmEmailChange,
      { tokenVerifyUrl: VERIFY_URL, expiresInHours: "24" },
      {
        ...SELF_HOSTED,
        ...getEmailLanguageVariables("de"),
        inviterName: '<a href="https://evil.example">Ada</a>',
      },
    );

    expect(html).not.toContain('<a href="https://evil.example">');
  });
});
