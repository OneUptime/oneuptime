import {
  DocsHeading,
  TRANSLATED_LANGUAGES,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  escapeRegExp,
  strayMarkers,
  toLatinDigits,
} from "./DocsTranslationChecks";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { MAGIC_LINK_EXPIRY_MINUTES } from "Common/Types/Accounts/MagicLink";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the docs say about signing in with a link emailed to you, held to the
 * code that does it (Common/Types/Accounts/MagicLink, the Accounts app's
 * pages and the Admin Dashboard's switch):
 *
 *   - Your Account, under "Signing in securely", between adding a passkey and
 *     turning on two-factor authentication: the steps, each as its screen
 *     draws it; how long a link works, that a newer one replaces it and that
 *     another device can open it; that two-factor authentication still asks
 *     for its second step; and, for master admins, the switch and what
 *     requiring SSO does;
 *   - the Docker Compose guide's production checklist, after the sign-ups
 *     row, and the Hardening Guide's "Control who signs in", after "Require
 *     it": each names the switch and links to that section;
 *   - every translation carries all of it in the English places, with that
 *     language's labels. The Hardening Guide is English in every language, so
 *     its line is too, and only its link follows the language's heading.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const ACCOUNTS: string = "App/FeatureSet/Accounts/src";
const ADMIN_DASHBOARD: string = "App/FeatureSet/AdminDashboard/src";

const YOUR_ACCOUNT: string = "introduction/your-account";
const COMPOSE: string = "installation/docker-compose";
const HARDENING: string = "self-hosted/hardening";

const SECTION: string = "Sign in with an emailed link";
const SECTION_BEFORE: string = "Add a passkey";
const SECTION_AFTER: string = "Turn on two-factor authentication";

// What the Accounts app draws at each step, in the order a reader meets it.
const SIGN_IN_OPTION: string = "login.emailSignInLink";
const REQUEST_BUTTON: string = "magicLink.submitButton";
const SENT_TITLE: string = "magicLink.sentTitle";
const LINK_PAGE_BUTTON: string = "login.magicLink.submit";
const STEP_LABELS: ReadonlyArray<string> = [
  SIGN_IN_OPTION,
  REQUEST_BUTTON,
  SENT_TITLE,
  LINK_PAGE_BUTTON,
];

// What the Admin Dashboard draws: the switch, and the way to its page.
const SWITCH: string = "pages.settings.authentication.magicLinkSwitchTitle";
const TURNED_OFF: string =
  "pages.settings.authentication.magicLinkSwitchOffDescription";
const WHILE_SSO_REQUIRED: string =
  "pages.settings.authentication.magicLinkWhileSsoRequired";
const SIGN_UP_SWITCH: string =
  "pages.settings.authentication.signUpSwitchTitle";
const SETTINGS: string = "navbar.settings";
const AUTHENTICATION: string = "sideMenu.settingsAuthentication";

const REQUIRE_IT_BULLET: string = "- **Require it.**";

const STEP_LINE: RegExp = /^\d+\. /;
const TABLE_ROW: string = "| **";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

// A value of an app's locale, by a dotted path of nested keys.
function drawn(app: string, language: string, dotted: string): string {
  let value: unknown = JSON.parse(
    source(`${app}/Locales/${language}.json`),
  ) as unknown;

  for (const key of dotted.split(".")) {
    value = (value as Record<string, unknown>)[key];
  }

  return value as string;
}

function headingsOf(page: string, language: string): Array<DocsHeading> {
  return scanMarkdown(readPage(language, page)).headings;
}

function englishHeadingIndex(text: string): number {
  return headingsOf(YOUR_ACCOUNT, "en").findIndex(
    (heading: DocsHeading): boolean => {
      return heading.text === text;
    },
  );
}

const SECTION_INDEX: number = englishHeadingIndex(SECTION);

function sectionHeading(language: string): DocsHeading {
  return headingsOf(YOUR_ACCOUNT, language)[SECTION_INDEX] as DocsHeading;
}

// The section's own lines in a language's page, found by its place on the page.
function sectionOf(language: string): Array<string> {
  const headings: Array<DocsHeading> = headingsOf(YOUR_ACCOUNT, language);
  const start: DocsHeading = headings[SECTION_INDEX] as DocsHeading;
  const end: DocsHeading = headings[SECTION_INDEX + 1] as DocsHeading;

  return readPage(language, YOUR_ACCOUNT)
    .split("\n")
    .slice(start.line - 1, end.line - 1);
}

// Where the section's link goes, by the heading a language's page gives it.
function sectionLink(language: string): string {
  return `(/docs/introduction/your-account#${slugifyMarkdownHeading(
    sectionHeading(language).text,
  )})`;
}

/*
 * The Admin Dashboard's page, in one bold span or one a segment ("Settings >
 * Authentication", or Persian's "**Settings** > **Authentication**").
 */
function adminPathPattern(segments: Array<string>): RegExp {
  return new RegExp(
    `\\*\\*${segments
      .map((segment: string): string => {
        return escapeRegExp(segment);
      })
      .join("(?:\\*\\* > \\*\\*| > )")}\\*\\*`,
  );
}

function settingsPath(language: string): Array<string> {
  return [
    drawn(ADMIN_DASHBOARD, language, SETTINGS),
    drawn(ADMIN_DASHBOARD, language, AUTHENTICATION),
  ];
}

// The line that holds some text, and the line after it.
function lineAfter(lines: Array<string>, text: string): string {
  const index: number = lines.findIndex((line: string): boolean => {
    return line.includes(text);
  });

  expect({ text, found: index >= 0 }).toEqual({ text, found: true });

  return lines[index + 1] as string;
}

// The checklist's row after the row that turns sign-ups off.
function composeRow(language: string): string {
  const rows: Array<string> = readPage(language, COMPOSE)
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith(TABLE_ROW);
    });

  return lineAfter(
    rows,
    `**${drawn(ADMIN_DASHBOARD, language, SIGN_UP_SWITCH)}**`,
  );
}

function hardeningBullet(language: string): string {
  return lineAfter(
    readPage(language, HARDENING).split("\n"),
    REQUIRE_IT_BULLET,
  );
}

function stepsOf(section: Array<string>): Array<string> {
  return section.filter((line: string): boolean => {
    return STEP_LINE.test(line);
  });
}

describe("the screens the docs name", () => {
  it("draw each step from the key the docs read it from", () => {
    const signIn: string = source(`${ACCOUNTS}/Pages/Login.tsx`);
    const request: string = source(`${ACCOUNTS}/Pages/MagicLink.tsx`);

    expect(signIn).toContain(`t("${SIGN_IN_OPTION}")`);
    expect(request).toContain(`t("${REQUEST_BUTTON}")`);
    expect(request).toContain(`t("${SENT_TITLE}")`);
    expect(signIn).toContain(`t("${LINK_PAGE_BUTTON}")`);
  });

  it("put the switch on Settings > Authentication", () => {
    expect(
      source(`${ADMIN_DASHBOARD}/Pages/Settings/Authentication/Index.tsx`),
    ).toContain(`t("${SWITCH}")`);
    expect(settingsPath("en")).toEqual(["Settings", "Authentication"]);
  });

  it("say what the docs say about turning links off and requiring SSO", () => {
    expect(drawn(ADMIN_DASHBOARD, "en", TURNED_OFF)).toContain(
      "Links already sent stop working.",
    );
    expect(drawn(ADMIN_DASHBOARD, "en", WHILE_SSO_REQUIRED)).toContain(
      "the sign-in page offers only SSO",
    );
    expect(source("Common/Server/Utils/SsoSignInMethods.ts")).toContain(
      "isMagicLinkLoginEnabled: isSsoRequired",
    );
  });
});

describe("Your Account, in English", () => {
  const section: Array<string> = sectionOf("en");
  const text: string = section.join("\n");

  it("sits between adding a passkey and turning on two-factor authentication", () => {
    expect(SECTION_INDEX).toBe(englishHeadingIndex(SECTION_BEFORE) + 1);
    expect(englishHeadingIndex(SECTION_AFTER)).toBe(SECTION_INDEX + 1);
    expect(sectionHeading("en").level).toBe(3);
  });

  it("walks through the steps with each screen's own words", () => {
    expect(stepsOf(section)).toEqual([
      `1. On the sign-in page, choose **${drawn(ACCOUNTS, "en", SIGN_IN_OPTION)}**.`,
      `2. Enter your email address and click **${drawn(ACCOUNTS, "en", REQUEST_BUTTON)}**. The page then shows **${drawn(ACCOUNTS, "en", SENT_TITLE)}**.`,
      `3. Open the link in the email and click **${drawn(ACCOUNTS, "en", LINK_PAGE_BUTTON)}**.`,
    ]);
  });

  it("says a link works once, for as long as the code lets it, and that a newer one replaces it", () => {
    expect(text).toContain(
      `The link works once, for ${MAGIC_LINK_EXPIRY_MINUTES} minutes, and a newer link replaces it.`,
    );
  });

  it("says another device can open it, and that the second step still applies", () => {
    expect(text).toContain("You can open it on another device");
    expect(text).toContain(
      "If you use two-factor authentication, OneUptime still asks for your second step.",
    );
  });

  it("tells master admins where the switch is, and what turning it off and requiring SSO do", () => {
    expect(text).toContain(
      `**${drawn(ADMIN_DASHBOARD, "en", SWITCH)}**, on **Admin Dashboard > Settings > Authentication**.`,
    );
    expect(text).toContain("Links already sent then stop working.");
    expect(text).toContain(
      "While the server requires SSO, the sign-in page offers SSO only.",
    );
  });

  it("no longer says the second step follows only a password", () => {
    const page: string = readPage("en", YOUR_ACCOUNT);

    for (const sentence of [
      "Ask for a second step after your password or an emailed link:",
      "Two-factor authentication applies when you sign in with your password or an emailed link.",
      "From your next sign-in with a password or an emailed link, OneUptime asks for your second step.",
    ]) {
      expect({ sentence, onPage: page.includes(sentence) }).toEqual({
        sentence,
        onPage: true,
      });
    }

    expect(page).not.toContain("applies when you sign in with your password.");
  });
});

describe("the admin pages, in English", () => {
  const switchLabel: string = drawn(ADMIN_DASHBOARD, "en", SWITCH);

  it("the production checklist names the switch and links to the section", () => {
    const row: string = composeRow("en");

    expect(row.startsWith("| **Sign-in links** |")).toBe(true);
    expect(row).toContain(
      `**${switchLabel}** under **Settings > Authentication** in the Admin Dashboard`,
    );
    expect(row).toContain(sectionLink("en"));
  });

  it("the Hardening Guide names the switch and links to the section", () => {
    const bullet: string = hardeningBullet("en");

    expect(bullet.startsWith("- **Sign-in links.**")).toBe(true);
    expect(bullet).toContain(
      `**${switchLabel}** in **Admin Dashboard > Settings > Authentication**`,
    );
    expect(bullet).toContain(sectionLink("en"));
  });
});

describe.each(TRANSLATED_LANGUAGES)("in %s", (language: string) => {
  const section: Array<string> = sectionOf(language);
  const text: string = section.join("\n");

  it("Your Account has the section in the English place, in its own words", () => {
    const english: Array<string> = sectionOf("en");

    expect(sectionHeading(language).level).toBe(3);
    expect(sectionHeading(language).text).not.toBe(SECTION);
    expect(stepsOf(section)).toHaveLength(stepsOf(english).length);
    expect(section).toHaveLength(english.length);
    expect(text).toContain("> [!NOTE]");

    for (const line of english) {
      // Only the page's markers read the same in a translation.
      if (
        line &&
        line !== ":::steps" &&
        line !== ":::" &&
        line !== "> [!NOTE]"
      ) {
        expect({ line, kept: section.includes(line) }).toEqual({
          line,
          kept: false,
        });
      }
    }
  });

  it("names each step's label as this language's screens draw it, in order", () => {
    let from: number = 0;

    for (const key of STEP_LABELS) {
      const label: string = `**${drawn(ACCOUNTS, language, key)}**`;
      const at: number = text.indexOf(label, from);

      expect({ key, label, found: at >= 0 }).toEqual({
        key,
        label,
        found: true,
      });

      from = at + label.length;
    }
  });

  it("draws every bold span it opens, with no asterisks left on the page", async () => {
    expect(await strayMarkers(text, language)).toEqual([]);
  });

  it("states how long a link works", () => {
    expect(toLatinDigits(text)).toContain(String(MAGIC_LINK_EXPIRY_MINUTES));
  });

  it("names the switch and its page as this language's Admin Dashboard draws them", () => {
    expect(text).toContain(`**${drawn(ADMIN_DASHBOARD, language, SWITCH)}**`);
    expect(text).toMatch(
      adminPathPattern(["Admin Dashboard", ...settingsPath(language)]),
    );
  });

  it("the production checklist has the row, with the switch, and a link to this language's section", () => {
    const row: string = composeRow(language);

    expect(row).toContain(`**${drawn(ADMIN_DASHBOARD, language, SWITCH)}**`);
    expect(row).toMatch(adminPathPattern(settingsPath(language)));
    expect(row).toContain(sectionLink(language));
    expect(row).not.toContain("**Sign-in links**");
  });

  it("the Hardening Guide has the English line, with a link to this language's section", () => {
    const english: string = hardeningBullet("en");

    expect(hardeningBullet(language)).toBe(
      english.replace(sectionLink("en"), sectionLink(language)),
    );
  });
});
