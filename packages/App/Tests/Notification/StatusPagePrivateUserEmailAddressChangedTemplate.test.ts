import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { visibleText } from "Common/Tests/Helpers/HtmlText";
import {
  getPrivateUserEmailAddressChangedEmailVariables,
  PrivateUserEmailAddressChangedBy,
  PrivateUserEmailAddressChangedEmailData,
} from "Common/Types/StatusPage/PrivateUserEmailAddressChangedEmail";
import {
  getEmailLanguageVariables,
  registerEmailLanguageHelpers,
} from "../../FeatureSet/Notification/Utils/EmailLanguage";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real helpers as an import side effect, so this
 * suite renders with what the product ships.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

registerEmailLanguageHelpers(Handlebars);

/*
 * THE EMAIL A STATUS PAGE PRIVATE USER'S OLD ADDRESS GETS WHEN THEIR ADDRESS
 * CHANGES (StatusPagePrivateUserEmailAddressChanged.hbs, #10156).
 *
 * Rendered with the variables the sender builds
 * (getPrivateUserEmailAddressChangedEmailVariables) and the production
 * helpers and partials, as the email to an account's old address is
 * (EmailAddressChangedTemplate.test.ts): that the address changed, to which
 * address (masked), when; who changed it, by role - the status page's team
 * or its identity provider - and whom to ask; the page's own logo and name,
 * escaped; no link that does anything; and in the page's language, Persian
 * and Arabic laid out from the right, with no English sentence left.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const STATUS_PAGE_URL: string = "https://status.acme.test/";
const LOGO_URL: string = "https://oneuptime.test/status-page-api/logo/acme";

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

function data(
  overrides: Partial<PrivateUserEmailAddressChangedEmailData> = {},
): PrivateUserEmailAddressChangedEmailData {
  return {
    changedBy: PrivateUserEmailAddressChangedBy.StatusPageTeam,
    statusPageName: "Acme Status",
    newEmail: "river@new-mailbox.example.com",
    changedAt: "Nov 20, 2026, 9:15 AM UTC",
    ...overrides,
  };
}

function render(
  emailData: PrivateUserEmailAddressChangedEmailData,
  root: Record<string, unknown> = {},
): string {
  return Handlebars.compile(
    fs.readFileSync(
      Path.resolve(
        TEMPLATES_DIR,
        EmailTemplateType.StatusPagePrivateUserEmailAddressChanged,
      ),
      { encoding: "utf8" },
    ),
  )({
    homeURL: STATUS_PAGE_URL,
    logoUrl: LOGO_URL,
    year: "2026",
    ...getPrivateUserEmailAddressChangedEmailVariables(emailData),
    ...root,
  });
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

describe("what changed, and when", () => {
  test("the title, that the address moved, and where sign-in emails go now", () => {
    const text: string = visibleText(render(data()));

    expect(text).toContain("Your email address was changed");
    expect(text).toContain(
      "Emails about signing in, such as password resets and sign-in links, now go to the new address.",
    );
    expect(text).toContain("Changed at:");
    expect(text).toContain("Nov 20, 2026, 9:15 AM UTC");
  });

  test("the new address masked, never whole", () => {
    const html: string = render(data());

    expect(visibleText(html)).toContain("New email address:");
    expect(visibleText(html)).toContain("r•••@n•••.com");
    expect(html).not.toContain("river@new-mailbox.example.com");
    expect(html).not.toContain("new-mailbox");
  });

  test("the status page's own logo, and no link that does anything", () => {
    const html: string = render(data());

    expect(html).toContain(LOGO_URL);
    expect(html).not.toMatch(/href="[^"]*(verify|reset|undo|token)[^"]*"/i);
  });
});

describe("who changed it, by role, and whom to ask", () => {
  test("the status page's team: ask that team", () => {
    const text: string = visibleText(render(data()));

    expect(text).toContain(
      "The team that runs Acme Status changed the email address you sign in to it with, from this address to a new one.",
    );
    expect(text).toContain(
      "If you did not expect this, contact the team that runs Acme Status.",
    );
    expect(text).not.toContain("identity provider");
  });

  test("the identity provider, through SCIM: ask the organization's admin", () => {
    const text: string = visibleText(
      render(
        data({ changedBy: PrivateUserEmailAddressChangedBy.IdentityProvider }),
      ),
    );

    expect(text).toContain(
      "Your organization's identity provider changed the email address you sign in to Acme Status with, from this address to a new one.",
    );
    expect(text).toContain(
      "If you did not expect this, contact your organization's admin.",
    );
    expect(text).not.toContain("The team that runs");
  });

  test("nobody named: said without a role", () => {
    const text: string = visibleText(
      render(data({ changedBy: PrivateUserEmailAddressChangedBy.OneUptime })),
    );

    expect(text).toContain(
      "The email address you sign in to Acme Status with was changed from this address to a new one.",
    );
    expect(text).toContain(
      "If you did not expect this, contact the team that runs Acme Status.",
    );
  });

  test("the page's name is its team's words: escaped wherever it goes", () => {
    const html: string = render(
      data({ statusPageName: '<a href="https://evil.example">Acme</a>' }),
    );

    expect(html).not.toContain('<a href="https://evil.example">');
    expect(visibleText(html)).toContain(
      'The team that runs <a href="https://evil.example">Acme</a> changed',
    );
  });
});

describe("in the page's language", () => {
  const ENGLISH_SENTENCES: ReadonlyArray<string> = [
    "Your email address was changed",
    "changed the email address you sign in",
    "was changed from this address to a new one",
    "from this address to a new one",
    "now go to the new address",
    "Changed at:",
    "New email address:",
    "If you did not expect this",
    "the team that runs",
  ];

  test.each([...LANGUAGES])(
    "%s: no English sentence is left, for every changer, and the values are as they are",
    (language: string) => {
      for (const changedBy of Object.values(PrivateUserEmailAddressChangedBy)) {
        const text: string = visibleText(
          render(data({ changedBy: changedBy }), {
            ...getEmailLanguageVariables(language),
          }),
        );

        for (const english of ENGLISH_SENTENCES) {
          expect({
            language,
            changedBy,
            english,
            isLeft: text.includes(english),
          }).toEqual({ language, changedBy, english, isLeft: false });
        }

        expect(text).toContain("Acme Status");
        expect(text).toContain("r•••@n•••.com");
        expect(text).toContain("Nov 20, 2026, 9:15 AM UTC");
      }
    },
  );

  test.each(["fa", "ar"])("%s: laid out from the right", (language: string) => {
    expect(
      render(data(), { ...getEmailLanguageVariables(language) }),
    ).toContain('dir="rtl"');
  });
});
