import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { visibleText } from "Common/Tests/Helpers/HtmlText";
import {
  EmailedSsoProject,
  getSsoSignInLinksEmailVariables,
  getSsoSignInLinksSubject,
  SsoSignInLinksEmailData,
} from "Common/Types/Accounts/SsoSignInLinks";
import { getServerTranslator } from "Common/Server/Utils/ServerTranslation";
import {
  getEmailLanguageVariables,
  registerEmailLanguageHelpers,
} from "../../FeatureSet/Notification/Utils/EmailLanguage";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real `concat` / `ifCond` helpers as an import
 * side effect, so this suite renders with the helpers the product ships.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

registerEmailLanguageHelpers(Handlebars);

/*
 * THE EMAIL OF AN ACCOUNT'S ORGANIZATIONS' SSO SIGN-IN LINKS
 * (SsoSignInLinks.hbs, #9987).
 *
 * Asked for on "Sign in with SSO" by whoever typed the address - who may not
 * have been its owner - so the email says exactly what it is, when and from
 * where it was asked for, and that it can be ignored. Rendered with the
 * variables the sender builds (getSsoSignInLinksEmailVariables) and the
 * production helpers and partials: a row and a button for each project,
 * each button to OneUptime's own page for the project; its name and its
 * providers' names are their admins' words, escaped wherever they are
 * drawn; in the account's own language.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const ACME_URL: string =
  "https://oneuptime.example.com/accounts/sso/11111111-1111-4111-8111-111111111111";
const GLOBEX_URL: string =
  "https://oneuptime.example.com/accounts/sso/22222222-2222-4222-8222-222222222222";

const PROJECTS: Array<EmailedSsoProject> = [
  { projectName: "Acme", signInUrl: ACME_URL },
  { projectName: "Globex", signInUrl: GLOBEX_URL },
];

const data: (
  overrides?: Partial<SsoSignInLinksEmailData>,
) => SsoSignInLinksEmailData = (
  overrides?: Partial<SsoSignInLinksEmailData>,
): SsoSignInLinksEmailData => {
  return {
    productName: "OneUptime",
    projects: PROJECTS,
    requestedAt: "Nov 19, 2026, 10:42 AM UTC",
    requestIpAddress: "203.0.113.7",
    requestLocation: "Lisbon, Portugal",
    requestDevice: "Firefox on macOS",
    ...overrides,
  };
};

function render(
  emailData: SsoSignInLinksEmailData,
  root: Record<string, unknown> = {},
): string {
  return Handlebars.compile(
    fs.readFileSync(
      Path.resolve(TEMPLATES_DIR, EmailTemplateType.SsoSignInLinks),
      { encoding: "utf8" },
    ),
  )({
    homeURL: "https://oneuptime.example.com",
    year: "2026",
    ...getSsoSignInLinksEmailVariables(emailData),
    ...root,
  });
}

// The links of the email's buttons, in order.
function buttonLinks(html: string): Array<string> {
  return Array.from(
    html.matchAll(/class="st-Button-link" href="([^"]+)"/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
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

describe("what the email says it is", () => {
  test("its title and its first line say exactly what it is and who asked", () => {
    const text: string = visibleText(render(data()));

    expect(text).toContain("Your SSO sign-in links");
    expect(text).toContain(
      "Someone asked for the single sign-on (SSO) sign-in links of the projects your OneUptime account is in. Each button below opens that project's SSO sign-in page.",
    );
  });

  test("it says it can be ignored, and that nothing changed", () => {
    expect(visibleText(render(data()))).toContain(
      "If you did not ask for these links, you can ignore this email. Nothing on your account has changed.",
    );
  });

  test("it says when, from where and on which device it was asked for", () => {
    const text: string = visibleText(render(data()));

    expect(text).toContain("Asked for at:");
    expect(text).toContain("Nov 19, 2026, 10:42 AM UTC");
    expect(text).toContain("IP address:");
    expect(text).toContain("203.0.113.7");
    expect(text).toContain("Approximate location:");
    expect(text).toContain("Lisbon, Portugal");
    expect(text).toContain("Device:");
    expect(text).toContain("Firefox on macOS");
  });

  test("a row it does not know is left out, never a label with nothing under it", () => {
    const text: string = visibleText(
      render(data({ requestLocation: "", requestIpAddress: "" })),
    );

    expect(text).not.toContain("Approximate location:");
    expect(text).not.toContain("IP address:");
    expect(text).toContain("Asked for at:");
  });
});

describe("the projects", () => {
  test("each project: a button that names it, to its own sign-in page", () => {
    const html: string = render(data());
    const text: string = visibleText(html);

    expect(text).toContain("Sign In to Acme");
    expect(text).toContain("Sign In to Globex");
    expect(buttonLinks(html)).toEqual([ACME_URL, GLOBEX_URL]);
  });

  test("no more than twenty projects, and none without a link", () => {
    const many: Array<EmailedSsoProject> = Array.from(
      { length: 25 },
      (_value: unknown, index: number): EmailedSsoProject => {
        return {
          projectName: `Project ${index}`,
          signInUrl:
            index === 0
              ? ""
              : `https://oneuptime.example.com/accounts/sso/project-${index}`,
        };
      },
    );

    const links: Array<string> = buttonLinks(render(data({ projects: many })));

    expect(links).toHaveLength(20);
    expect(links[0]).toBe(
      "https://oneuptime.example.com/accounts/sso/project-1",
    );
  });

  test("the email links to OneUptime's own pages and to no identity provider", () => {
    for (const link of buttonLinks(render(data()))) {
      expect(
        link.startsWith("https://oneuptime.example.com/accounts/sso/"),
      ).toBe(true);
    }
  });

  test("a project's name is escaped wherever it is drawn: its admins wrote it", () => {
    const html: string = render(
      data({
        projects: [
          {
            projectName:
              '<a href="https://evil.example">Acme</a><img src="https://evil.example/x.png">',
            signInUrl: ACME_URL,
          },
        ],
      }),
    );

    expect(html).not.toContain('<a href="https://evil.example">');
    expect(html).not.toContain('<img src="https://evil.example');
    expect(html).toContain("&lt;a href");
    expect(html).toContain("&lt;img src");
    expect(buttonLinks(html)).toEqual([ACME_URL]);
  });
});

describe("in the reader's language", () => {
  test("German: the email's own words are German, the names as written", () => {
    const text: string = visibleText(
      render(data(), getEmailLanguageVariables("de")),
    );

    expect(text).toContain("Ihre SSO-Anmeldelinks");
    expect(text).toContain("Bei Acme anmelden");
    expect(text).toContain("Angefordert am:");
    expect(text).not.toContain("Your SSO sign-in links");
    expect(text).not.toContain("you can ignore this email");
  });

  test("Persian: laid out from the right, and not in English", () => {
    const html: string = render(data(), getEmailLanguageVariables("fa"));

    expect(html).toContain('dir="rtl"');
    expect(visibleText(html)).toContain("پیوندهای ورود SSO شما");
    expect(visibleText(html)).not.toContain("Your SSO sign-in links");
  });

  test("every language the server writes in words the email, every sentence of it", () => {
    for (const language of [
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
    ]) {
      const text: string = visibleText(
        render(data(), getEmailLanguageVariables(language)),
      );

      for (const english of [
        "Your SSO sign-in links",
        "Someone asked for the single sign-on (SSO) sign-in links",
        "Bookmark a project's link",
        "you can ignore this email",
        "Sign In to Acme",
        "Asked for at:",
        "Approximate location:",
      ]) {
        expect({
          language,
          english,
          isEnglish: text.includes(english),
        }).toEqual({ language, english, isEnglish: false });
      }
    }
  });

  test("the subject names the product, in the reader's language", () => {
    expect(
      getSsoSignInLinksSubject(getServerTranslator("en"), "Acme Ops"),
    ).toBe("Your Acme Ops SSO sign-in links");
    expect(
      getSsoSignInLinksSubject(getServerTranslator("de"), "OneUptime"),
    ).toBe("Ihre OneUptime-SSO-Anmeldelinks");
  });
});
