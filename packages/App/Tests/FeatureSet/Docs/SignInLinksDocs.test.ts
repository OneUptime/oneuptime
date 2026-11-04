import {
  DocsHeading,
  DocsLink,
  TRANSLATED_LANGUAGES,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  escapeRegExp,
  inlineCode,
  strayMarkers,
  toLatinDigits,
} from "./DocsTranslationChecks";
import {
  flattened,
  otherChangesItems,
  sectionAtEnglishPlace,
} from "./UpgradingDocsNotes";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { MAGIC_LINK_EXPIRY_MINUTES } from "Common/Types/Accounts/MagicLink";
import { SSO_REQUIRED_SIGN_IN_MESSAGE } from "Common/Types/SSO/SignInMethods";
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
 *   - the upgrade guide's "Other changes in 14": a self-hosted server shows
 *     the sign-in page's option after the upgrade, and one with no working
 *     mail server offers it all the same. It names the switch and links to
 *     that section. Its neighbours in the list are not pinned: nothing it says
 *     depends on them, and the next note can go beside it. The paragraph above
 *     the list tells a server with no working mail server to read it;
 *   - Global SSO's Enforcing SSO bullets and its troubleshooting entry on the
 *     server's refusal while SSO is required, which list an emailed link among
 *     what the page leaves out and the server refuses. MagicLinkLogin (the
 *     server) and LoginMagicLink (the page a link opens) hold the refusal
 *     itself;
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
const GLOBAL_SSO: string = "identity/global-sso";

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
const ADMIN_DASHBOARD_BREADCRUMB: string = "breadcrumbs.adminDashboard";

const UPGRADE_NOTE_LEAD: string =
  "**The sign-in page offers an emailed sign-in link, even with no working mail server.**";

const UPGRADE_LIST_HEADING: string = "Other changes in 14";

const ENFORCING_SSO: string = "Enforcing SSO";
const OFFERS_ONLY_SSO: string = "- The sign-in page offers only SSO:";
const REFUSES: string = "- OneUptime refuses a password,";

/*
 * How each translation's Global SSO page names an emailed link: the words of
 * its own heading for the section, so a reader meets one name for it.
 */
const EMAILED_LINK: Record<string, string> = {
  da: "link sendt på e-mail",
  de: "per E-Mail gesendeten Link",
  es: "enlace enviado por correo",
  fa: "لینک ارسال‌شده به ایمیل",
  fr: "lien envoyé par e-mail",
  hi: "लिंक",
  it: "link inviato via e-mail",
  ja: "メールで届いたリンク",
  ko: "이메일로 받은 링크",
  nl: "gemailde link",
  no: "lenke på e-post",
  pt: "link enviado por e-mail",
  ru: "по ссылке из письма",
  sv: "länk via e-post",
  "zh-CN": "电子邮件链接",
  "zh-TW": "電子郵件連結",
};

/*
 * How each translation's upgrade guide names a mail server, in the note and in
 * the paragraph that sends its readers to the note.
 */
const MAIL_SERVER: Record<string, string> = {
  da: "mailserver",
  de: "Mailserver",
  es: "servidor de correo",
  fa: "سرور ایمیل",
  fr: "serveur de messagerie",
  hi: "मेल सर्वर",
  it: "server di posta",
  ja: "メールサーバー",
  ko: "메일 서버",
  nl: "mailserver",
  no: "e-postserver",
  pt: "servidor de e-mail",
  ru: "почтового сервера",
  sv: "e-postserver",
  "zh-CN": "邮件服务器",
  "zh-TW": "郵件伺服器",
};

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

const ENGLISH_NOTES: Array<string> = otherChangesItems("en");
const UPGRADE_NOTE_INDEX: number = ENGLISH_NOTES.findIndex(
  (note: string): boolean => {
    return flattened(note).startsWith(`- ${UPGRADE_NOTE_LEAD}`);
  },
);

// The upgrade note in a language: the note in the English note's place.
function upgradeNote(language: string): string {
  return flattened(otherChangesItems(language)[UPGRADE_NOTE_INDEX] || "");
}

// Where some Markdown links, written as sectionLink writes it.
function linksOf(markdown: string): Array<string> {
  return scanMarkdown(markdown).links.map((link: DocsLink): string => {
    return `(${link.target})`;
  });
}

/*
 * The upgrade guide names the Admin Dashboard as its breadcrumb draws it, as
 * it does on its other paths through the Admin Dashboard.
 */
function upgradeGuidePath(language: string): Array<string> {
  return [
    drawn(ADMIN_DASHBOARD, language, ADMIN_DASHBOARD_BREADCRUMB),
    ...settingsPath(language),
  ];
}

// The paragraph above the fold of the "Other changes in 14" list.
function upgradeListIntro(language: string): string {
  const section: string = sectionAtEnglishPlace(language, UPGRADE_LIST_HEADING);

  return flattened(section.slice(0, section.indexOf(":::details ")));
}

// The bullets of Global SSO's Enforcing SSO section in a language.
function enforcingBullets(language: string): Array<string> {
  const headings: Array<DocsHeading> = headingsOf(GLOBAL_SSO, language);
  const at: number = headingsOf(GLOBAL_SSO, "en").findIndex(
    (heading: DocsHeading): boolean => {
      return heading.text === ENFORCING_SSO;
    },
  );

  return readPage(language, GLOBAL_SSO)
    .split("\n")
    .slice(
      (headings[at] as DocsHeading).line - 1,
      (headings[at + 1] as DocsHeading).line - 1,
    )
    .filter((line: string): boolean => {
      return line.startsWith("- ");
    });
}

// A language's Enforcing SSO bullet in the place of the English one with this opening.
function enforcingBullet(language: string, englishOpening: string): string {
  const at: number = enforcingBullets("en").findIndex(
    (bullet: string): boolean => {
      return bullet.startsWith(englishOpening);
    },
  );

  return enforcingBullets(language)[at] as string;
}

// The Global SSO entry a sign-in refused while SSO is required opens, by its title.
function ssoEntry(language: string): string {
  const lines: Array<string> = readPage(language, GLOBAL_SSO).split("\n");
  const title: number = lines.indexOf(
    `:::details "${SSO_REQUIRED_SIGN_IN_MESSAGE}"`,
  );

  expect({ language, found: title >= 0 }).toEqual({ language, found: true });

  return lines[title + 1] as string;
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

  it("offer the option on an upgraded server, whatever its mail server does", () => {
    // The upgrade leaves the switch on, for a server that was already running.
    expect(
      source(
        "Common/Server/Infrastructure/Postgres/SchemaMigrations/1808992650000-AddMagicLinkLogin.ts",
      ),
    ).toContain('"disableMagicLinkLogin" boolean DEFAULT false');

    // The offer reads the SSO requirement and the switch, and nothing about mail.
    expect(
      flattened(source("Common/Server/Utils/SsoSignInMethods.ts")),
    ).toContain(
      "isMagicLinkLoginEnabled: isSsoRequired ? false : !(await GlobalConfigService.getMagicLinkLoginTurnedOff())",
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

describe("the upgrade note, in English", () => {
  const note: string = upgradeNote("en");

  it("is a note of the 14 changes, once", () => {
    expect(UPGRADE_NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_NOTES.filter((item: string): boolean => {
        return flattened(item).includes(UPGRADE_NOTE_LEAD);
      }),
    ).toHaveLength(1);
  });

  it("says a self-hosted server gets the sign-in page's option, by that page's words", () => {
    expect(note).toContain(
      `After the upgrade, a self-hosted server's sign-in page shows **${drawn(ACCOUNTS, "en", SIGN_IN_OPTION)}**, so people can sign in with an emailed link instead of their password.`,
    );
  });

  it("says a server with no working mail server offers it all the same", () => {
    expect(note).toContain(
      "A server with no working mail server still offers it, and the email never arrives.",
    );
  });

  it("names the switch and the way to it, links to the section, and carries no code", () => {
    expect(note).toContain(
      `turn off **${drawn(ADMIN_DASHBOARD, "en", SWITCH)}** on **Admin Dashboard > Settings > Authentication**.`,
    );
    expect(upgradeGuidePath("en")).toEqual([
      "Admin Dashboard",
      "Settings",
      "Authentication",
    ]);
    expect(linksOf(note)).toEqual([sectionLink("en")]);
    expect(inlineCode(note)).toEqual([]);
  });

  it("is what the paragraph above the list sends a server with no working mail server to read", () => {
    expect(upgradeListIntro("en")).toContain(
      "or the Slack and Microsoft Teams apps, or if your server has no working mail server.",
    );
  });
});

describe("the Global SSO page on the refusal, in English", () => {
  it("Enforcing SSO lists an emailed link among what the page leaves out", () => {
    expect(enforcingBullet("en", OFFERS_ONLY_SSO)).toContain(
      "and no password, passkey, emailed link, Google or Microsoft sign-in, or sign-up.",
    );
  });

  it("Enforcing SSO lists an emailed link among what the server refuses, with the server's message", () => {
    expect(enforcingBullet("en", REFUSES)).toContain(
      `OneUptime refuses a password, a passkey, an emailed link, a Google or Microsoft sign-in and a sign-up with "${SSO_REQUIRED_SIGN_IN_MESSAGE}"`,
    );
  });

  it("the troubleshooting entry lists an emailed link among the sign-ins it explains", () => {
    expect(ssoEntry("en")).toContain(
      "this was a sign-in with a password, a passkey, an emailed link, Google or Microsoft, or a sign-up.",
    );
  });
});

describe.each(TRANSLATED_LANGUAGES)("in %s", (language: string) => {
  const section: Array<string> = sectionOf(language);
  const text: string = section.join("\n");
  const note: string = upgradeNote(language);

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

  it("the upgrade note is in the English note's place, under a lead of its own", () => {
    expect(note.startsWith("- **")).toBe(true);
    expect(note).not.toContain(UPGRADE_NOTE_LEAD);
  });

  it("the upgrade note names the sign-in page's option, not the request page's button", () => {
    const option: string = drawn(ACCOUNTS, language, SIGN_IN_OPTION);
    const button: string = drawn(ACCOUNTS, language, REQUEST_BUTTON);

    expect(note).toContain(`**${option}**`);
    expect(note.includes(`**${button}**`)).toBe(button === option);
  });

  it("the upgrade note names the switch and the way to it as this language's Admin Dashboard draws them", () => {
    expect(note).toContain(`**${drawn(ADMIN_DASHBOARD, language, SWITCH)}**`);
    expect(note).toMatch(adminPathPattern(upgradeGuidePath(language)));
  });

  it("the upgrade note links to this language's section, carries no code, and draws every bold span", async () => {
    expect(linksOf(note)).toEqual([sectionLink(language)]);
    expect(inlineCode(note)).toEqual([]);
    // strayMarkers reads a page, and leaves out its first line: the title.
    expect(await strayMarkers(`# Title\n${note}`, language)).toEqual([]);
  });

  it("the paragraph above the list names a mail server as the upgrade note does", () => {
    const words: string = MAIL_SERVER[language] as string;

    expect(upgradeListIntro(language)).toContain(words);
    expect(note).toContain(words);
  });

  it("the Global SSO page lists an emailed link in the words of this language's section, wherever it lists what is refused", () => {
    const words: string = EMAILED_LINK[language] as string;

    expect(sectionHeading(language).text).toContain(words);

    for (const place of [
      enforcingBullet(language, OFFERS_ONLY_SSO),
      enforcingBullet(language, REFUSES),
      ssoEntry(language),
    ]) {
      expect({ words, place, listed: place.includes(words) }).toEqual({
        words,
        place,
        listed: true,
      });
    }
  });
});
