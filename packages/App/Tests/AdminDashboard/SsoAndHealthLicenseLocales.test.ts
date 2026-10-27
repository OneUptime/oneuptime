import {
  REQUIRE_SSO_COPY,
  SIGN_UP_WHILE_SSO_REQUIRED,
  SSO_PAGE_COPY,
} from "../../FeatureSet/AdminDashboard/src/Pages/Settings/SSO/SsoSettingsCopy";
import { toSentenceNoun } from "Common/UI/Components/Table/EmptyTableMessage";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the Admin Dashboard locales say about single sign-on and the
 * Enterprise license.
 *
 * The Admin Dashboard, and the Enterprise screens it bundles from
 * ee/AdminDashboard, look each string up by its English text (Card, Button,
 * the switch and its dialog, the form's and the details' FieldLabel, Alert),
 * so an entry is what decides whether a string is translated.
 *
 *   - Settings > Single Sign-On lists the server's SAML and OIDC providers,
 *     each with Test Sign-in in its row, and under them the instance-wide
 *     "Require SSO for Login" switch, in every edition. The switch asks
 *     before it turns on, and names the address master admins sign in at
 *     while SSO is required. Every string of the page, of the switch's card
 *     and of its dialog (SsoSettingsCopy) has an entry in all 17 locales,
 *     and the page hands the switch exactly these strings: a string added or
 *     reworded without an entry would stay English for everyone. (The switch
 *     was on Settings > Authentication, in a card called "Single Sign-On
 *     (SSO)"; its strings from there are gone.)
 *   - The Health screens' license notice (ee/AdminDashboard/Health/
 *     HealthLicenseRequired.tsx) has an entry in every locale. No core code
 *     renders it - the Enterprise Edition does, and ee/ is not in every
 *     checkout - so a clean-up of keys "nothing uses" must not take it away.
 *     ee/Tests/UI/Health/HealthLicenseRequiredLocales.test.tsx ties it to the
 *     component's constants and renders it in every language.
 *   - Single sign-on never depends on a license, so no screen offers the
 *     "disable a provider while the license is lapsed" action any more. Its
 *     strings are gone from all 17 locales, and nothing the Admin Dashboard
 *     renders uses them.
 */

const ADMIN_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "AdminDashboard",
  "src",
);

const LOCALES_DIR: string = path.join(ADMIN_SRC, "Locales");

const SSO_PAGE: string = path.join(
  ADMIN_SRC,
  "Pages",
  "Settings",
  "SSO",
  "Index.tsx",
);

const AUTHENTICATION_PAGE: string = path.join(
  ADMIN_SRC,
  "Pages",
  "Settings",
  "Authentication",
  "Index.tsx",
);

const COMMON_UI: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
);

// Present in an Enterprise checkout only (the core CI jobs delete ee/).
const EE_UI: Array<string> = [
  path.join(__dirname, "..", "..", "..", "..", "ee", "AdminDashboard"),
  path.join(__dirname, "..", "..", "..", "..", "ee", "Dashboard"),
];

const OTHER_LOCALES: Array<string> = [
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
];

const ALL_LOCALES: Array<string> = ["en", ...OTHER_LOCALES];

/*
 * The "Require SSO" card, in the order the page renders it: the card's
 * title (also the dialog's button) and line, the switch and its sentence
 * for each way it is set, the master admins' sentence and the name of
 * their address, then the dialog before SSO is required.
 */
const SSO_CARD_STRINGS: Array<string> = [
  "Require SSO",
  "Before you require SSO, sign in with a provider using Test Sign-in in its row.",
  "Require SSO for Login",
  "The sign-in page offers only SSO. Everyone except master admins must sign in with SSO to open any project.",
  "People can sign in with a password, a passkey or SSO.",
  "Master admins can always sign in with their password here, even while SSO is required. Keep this address.",
  "Master admin sign-in",
  "Require SSO for everyone?",
  "The sign-in page will offer only SSO. Everyone except master admins, including people signed in now, must sign in with SSO to open any project.",
];

/*
 * The rest of Settings > Single Sign-On, in the order the locales keep it:
 * the line at the top, the two tables' lines and nouns, the rows' Test
 * Sign-in, the Sign Up card's line on Settings > Authentication while SSO is
 * required, and what the tables build from their nouns - the Add button and
 * the line while a table is empty.
 */
const SSO_PAGE_STRINGS: Array<string> = [
  "Single sign-on for this server",
  "These providers sign people in to every project on this server they belong to. Attach projects to a provider to add newcomers to their teams.",
  "Sign in through a SAML app, such as Okta, Microsoft Entra ID or OneLogin.",
  "Sign in through an OpenID Connect app, such as Google Workspace, Auth0 or Keycloak.",
  "SAML Provider",
  "SAML Providers",
  "OIDC Provider",
  "OIDC Providers",
  "Test Sign-in",
  "While SSO is required, people get their account by signing in with SSO or by an invitation, not by signing up.",
  "Add SAML Provider",
  "Add OIDC Provider",
  "No SAML providers yet.",
  "No OIDC providers yet.",
];

// The tables' titles: the protocols' names, the same in every language.
const PROTOCOL_NAMES: Array<string> = ["SAML", "OpenID Connect (OIDC)"];

// Names a translation keeps as they are, and how it may write them.
const KEPT_NAMES: Array<{ name: string; pattern: RegExp }> = [
  { name: "SSO", pattern: /SSO/ },
  { name: "SAML", pattern: /SAML/ },
  { name: "OIDC", pattern: /OIDC/ },
  // German joins it to the noun after it ("OpenID-Connect-App").
  { name: "OpenID Connect", pattern: /OpenID[ -]Connect/ },
  { name: "Okta", pattern: /Okta/ },
  { name: "Microsoft Entra ID", pattern: /Microsoft Entra ID/ },
  { name: "OneLogin", pattern: /OneLogin/ },
  { name: "Google Workspace", pattern: /Google Workspace/ },
  { name: "Auth0", pattern: /Auth0/ },
  { name: "Keycloak", pattern: /Keycloak/ },
];

/*
 * What the card said before: its Edit button and the sentence under the
 * saved value (before it was a switch), then the card on Settings >
 * Authentication - its title, its line, the switch's sentence and the
 * dialog's. Gone from every locale and the pages.
 */
const RETIRED_SSO_CARD_STRINGS: Array<string> = [
  "Edit SSO Settings",
  "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt.",
  "Single Sign-On (SSO)",
  "Control whether users must sign in with SSO across this server.",
  "Everyone except master admins must sign in with SSO to open any project on this server.",
  "Anyone who signs in with a password is locked out until they use SSO, so check that an SSO provider works for everyone first.",
];

// The Health screens' license notice: its title, then its description.
const HEALTH_LICENSE_NOTICE: Array<string> = [
  "Enterprise license required.",
  "The live OneUptime Health dashboards and the query console need an Enterprise license that includes instance health, and this installation's license is missing, expired or does not include it. Activate or renew the license from the Enterprise Edition badge at the top of the Admin Dashboard. While the license is missing or expired, SCIM provisioning and audit logging are off too; they come back with these screens as soon as a license is activated. ClickHouse capacity, the instance log, Global Probes, Migrations and the Support Bundle keep working without it; find them in the menu on the left.",
];

// The notice from while single sign-on stopped with the license.
const RETIRED_HEALTH_DESCRIPTION: string = (
  HEALTH_LICENSE_NOTICE[1] as string
).replace(
  "SCIM provisioning and audit logging are off too",
  "single sign-on, SCIM provisioning and audit logging are off too",
);

// The retired provider notice, the "Disable" action and the "Disable this provider" card.
const RETIRED_PROVIDER_STRINGS: Array<string> = [
  "You can still disable a provider.",
  "Without a valid Enterprise license this configuration is read-only and sign-in through these providers is off, but disabling a provider is always allowed, because it can only tighten security. Sign-in resumes through every enabled provider as soon as a license is activated, so if an identity provider is compromised, use Disable now to keep it off. Turning a provider back on needs a valid license.",
  "Disable Provider",
  "Nobody will be able to sign in with this provider until it is turned back on, and turning it back on needs a valid Enterprise license.",
  "Disable Project Attachment",
  "This provider will no longer provision users into this project, or give access to it when the provider is restricted to attached projects. Turning the attachment back on needs a valid Enterprise license.",
  "Disable this provider",
  "Sign-in through this provider is off while the Enterprise license is missing or expired, and resumes as soon as a license is activated. Disable the provider to keep it off. Its configuration stays as it is, and it can be turned back on once the Enterprise license is valid again.",
];

/*
 * The Admin Dashboard had no "Disable" string before that action added one,
 * and has none now. (The Dashboard's own "Disable" entry stays.)
 */
const RETIRED_KEYS: Array<string> = [...RETIRED_PROVIDER_STRINGS, "Disable"];

// What a sentence may end with, per script.
const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

// What a question may end with, per script.
const QUESTION_ENDINGS: Array<string> = ["?", "？", "؟"];

const SOURCE_FILE: RegExp = /\.tsx?$/;

// "SSO" as a word, in any language's text.
const SSO_WORD: RegExp = /\bSSO\b/;

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

// A nested entry ("sideMenu.settingsSso"), or undefined.
function nestedEntry(entries: Locale, dottedKey: string): unknown {
  let value: unknown = entries;

  for (const part of dottedKey.split(".")) {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    value = (value as Record<string, unknown>)[part];
  }

  return value;
}

// Comments removed (they may quote copy), whitespace squashed.
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

// Source files under a directory, locale files and tests left out.
function sourceFilesUnder(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!["node_modules", "Locales", "Tests"].includes(entry.name)) {
        files.push(...sourceFilesUnder(fullPath));
      }

      continue;
    }

    if (SOURCE_FILE.test(entry.name) && !entry.name.includes(".test.")) {
      files.push(fullPath);
    }
  }

  return files;
}

function isSentence(text: string): boolean {
  return SENTENCE_ENDINGS.some((ending: string) => {
    return text.endsWith(ending);
  });
}

function isQuestion(text: string): boolean {
  return QUESTION_ENDINGS.some((ending: string) => {
    return text.endsWith(ending);
  });
}

// A locale's keys from `first` on, as many as `expected` has.
function blockFrom(
  keys: Array<string>,
  first: string,
  length: number,
): Array<string> {
  const start: number = keys.indexOf(first);

  return start === -1 ? [] : keys.slice(start, start + length);
}

/*
 * One locale's entry for each key: a translation, not empty, not a
 * template, that keeps the names the English keeps, and is a sentence or a
 * question when the English is. Sentences are translated everywhere.
 */
function expectTranslated(locale: string, keys: Array<string>): void {
  const entries: Locale = readLocale(locale);

  for (const key of keys) {
    const value: unknown = entries[key];

    expect({ key, type: typeof value }).toEqual({ key, type: "string" });

    const text: string = value as string;

    expect(text.trim()).not.toBe("");
    expect(text).not.toContain("{{");

    for (const kept of KEPT_NAMES) {
      if (key.includes(kept.name)) {
        expect({
          key,
          keeps: kept.name,
          kept: kept.pattern.test(text),
        }).toEqual({ key, keeps: kept.name, kept: true });
      }
    }

    if (isSentence(key)) {
      expect({ key, translated: text !== key }).toEqual({
        key,
        translated: true,
      });
      expect({ key, sentence: isSentence(text) }).toEqual({
        key,
        sentence: true,
      });
    }

    if (isQuestion(key)) {
      expect({ key, question: isQuestion(text) }).toEqual({
        key,
        question: true,
      });
    }
  }
}

const english: Locale = readLocale("en");
const pageCode: string = codeOf(fs.readFileSync(SSO_PAGE, "utf8"));
const authenticationCode: string = codeOf(
  fs.readFileSync(AUTHENTICATION_PAGE, "utf8"),
);

// The card's copy, in the order the page renders it.
const COPY_IN_ORDER: Array<string> = [
  REQUIRE_SSO_COPY.cardTitle,
  REQUIRE_SSO_COPY.cardDescription,
  REQUIRE_SSO_COPY.switchTitle,
  REQUIRE_SSO_COPY.switchOnDescription,
  REQUIRE_SSO_COPY.switchOffDescription,
  REQUIRE_SSO_COPY.masterAdminSentence,
  REQUIRE_SSO_COPY.masterAdminAddressLabel,
  REQUIRE_SSO_COPY.confirmTitle,
  REQUIRE_SSO_COPY.confirmDescription,
];

describe("Settings > Single Sign-On: the Require SSO card", () => {
  test("its copy is exactly these strings", () => {
    expect(COPY_IN_ORDER).toEqual(SSO_CARD_STRINGS);
    // The dialog's button says what the card is called.
    expect(REQUIRE_SSO_COPY.confirmButton).toBe(REQUIRE_SSO_COPY.cardTitle);
    expect(Array.from(new Set(Object.values(REQUIRE_SSO_COPY))).sort()).toEqual(
      [...SSO_CARD_STRINGS].sort(),
    );
  });

  test("the page hands each of them to the switch, and nothing else", () => {
    for (const wiring of [
      "cardTitle={REQUIRE_SSO_COPY.cardTitle}",
      "cardDescription={REQUIRE_SSO_COPY.cardDescription}",
      "title={REQUIRE_SSO_COPY.switchTitle}",
      "return isOn ? REQUIRE_SSO_COPY.switchOnDescription : REQUIRE_SSO_COPY.switchOffDescription;",
      "translator.translateText(REQUIRE_SSO_COPY.masterAdminSentence)",
      "label: REQUIRE_SSO_COPY.masterAdminAddressLabel,",
      "getConfirmation={getRequireSsoConfirmation}",
      "title: REQUIRE_SSO_COPY.confirmTitle,",
      "description: REQUIRE_SSO_COPY.confirmDescription,",
      "submitButtonText: REQUIRE_SSO_COPY.confirmButton,",
    ]) {
      expect({ wiring, used: pageCode.includes(wiring) }).toEqual({
        wiring,
        used: true,
      });
    }

    // No English of its own on the page: every string comes from the copy.
    for (const text of SSO_CARD_STRINGS) {
      expect({ text, inPage: pageCode.includes(`"${text}"`) }).toEqual({
        text,
        inPage: false,
      });
    }
  });

  test("says nothing about an edition or a license", () => {
    for (const text of SSO_CARD_STRINGS) {
      expect(text).not.toMatch(
        /licen[cs]e|trial|grace|Enterprise|Community|not enforced|expired/i,
      );
    }
  });

  test("says what changes, who is exempt and where they sign in, and to test first", () => {
    expect(REQUIRE_SSO_COPY.switchOnDescription).toContain(
      "The sign-in page offers only SSO.",
    );
    expect(REQUIRE_SSO_COPY.switchOnDescription).toContain(
      "Everyone except master admins",
    );
    expect(REQUIRE_SSO_COPY.confirmDescription).toContain(
      "Everyone except master admins",
    );
    // Nobody's password session outlasts it (UserAuthorization reads it per request).
    expect(REQUIRE_SSO_COPY.confirmDescription).toContain(
      "including people signed in now",
    );
    // A dialog's description fits it (ShortDescriptionsGuard).
    expect(REQUIRE_SSO_COPY.confirmDescription.length).toBeLessThanOrEqual(150);
    expect(REQUIRE_SSO_COPY.masterAdminSentence).toContain(
      "Master admins can always sign in with their password here",
    );
    // The card's line names the rows' action as it reads.
    expect(REQUIRE_SSO_COPY.cardDescription).toContain(
      SSO_PAGE_COPY.testSignIn,
    );
  });

  test("en.json maps every string to itself", () => {
    const missing: Array<string> = SSO_CARD_STRINGS.filter((key: string) => {
      return english[key] !== key;
    });

    expect(missing).toEqual([]);
  });

  /*
   * A string reworded in the copy without an entry would stay English: the
   * check above sees it (its text has no entry).
   */
  test("the check sees a reworded string (negative control)", () => {
    const reworded: string = `${REQUIRE_SSO_COPY.confirmDescription} Really.`;

    expect(english[reworded]).toBeUndefined();
  });

  test.each(OTHER_LOCALES)("%s translates every string", (locale: string) => {
    expectTranslated(locale, SSO_CARD_STRINGS);

    const entries: Locale = readLocale(locale);

    // The labels and the dialog are not the English ones in any language.
    for (const label of [
      REQUIRE_SSO_COPY.cardTitle,
      REQUIRE_SSO_COPY.switchTitle,
      REQUIRE_SSO_COPY.masterAdminAddressLabel,
      REQUIRE_SSO_COPY.confirmTitle,
    ]) {
      expect({ label, translated: entries[label] !== label }).toEqual({
        label,
        translated: true,
      });
    }

    // The card's line names the rows' action as this language does.
    expect({
      locale,
      namesTestSignIn: String(
        entries[REQUIRE_SSO_COPY.cardDescription],
      ).includes(String(entries[SSO_PAGE_COPY.testSignIn])),
    }).toEqual({ locale, namesTestSignIn: true });
  });

  test("every locale keeps the card's entries together, in the order the page renders them", () => {
    for (const locale of ALL_LOCALES) {
      const keys: Array<string> = Object.keys(readLocale(locale));

      expect({
        locale,
        block: blockFrom(
          keys,
          SSO_CARD_STRINGS[0] as string,
          SSO_CARD_STRINGS.length,
        ),
      }).toEqual({ locale, block: SSO_CARD_STRINGS });
    }
  });

  test("the card's earlier strings are gone from every locale and the pages", () => {
    for (const locale of ALL_LOCALES) {
      const entries: Locale = readLocale(locale);

      expect({
        locale,
        retired: RETIRED_SSO_CARD_STRINGS.filter((key: string) => {
          return key in entries;
        }),
      }).toEqual({ locale, retired: [] });
    }

    for (const text of RETIRED_SSO_CARD_STRINGS) {
      expect(pageCode).not.toContain(text);
      expect(authenticationCode).not.toContain(text);
    }
  });
});

describe("Settings > Single Sign-On: the page's other strings", () => {
  test("are the page's copy, the Sign Up card's line and what the tables build from their nouns", () => {
    const pageCopy: Array<string> = Object.values(SSO_PAGE_COPY).filter(
      (text: string) => {
        return !PROTOCOL_NAMES.includes(text);
      },
    );

    expect(
      [
        ...pageCopy,
        SIGN_UP_WHILE_SSO_REQUIRED,
        `Add ${SSO_PAGE_COPY.samlProvider}`,
        `Add ${SSO_PAGE_COPY.oidcProvider}`,
        `No ${toSentenceNoun(SSO_PAGE_COPY.samlProviders)} yet.`,
        `No ${toSentenceNoun(SSO_PAGE_COPY.oidcProviders)} yet.`,
      ].sort(),
    ).toEqual([...SSO_PAGE_STRINGS].sort());

    // Each table is titled with its protocol's name.
    expect([SSO_PAGE_COPY.samlCardTitle, SSO_PAGE_COPY.oidcCardTitle]).toEqual(
      PROTOCOL_NAMES,
    );
  });

  test("the pages hand them over, with no English of their own", () => {
    for (const wiring of [
      "title={SSO_PAGE_COPY.bannerTitle}",
      "description={SSO_PAGE_COPY.bannerDescription}",
      "singularName={SSO_PAGE_COPY.samlProvider}",
      "pluralName={SSO_PAGE_COPY.samlProviders}",
      "singularName={SSO_PAGE_COPY.oidcProvider}",
      "pluralName={SSO_PAGE_COPY.oidcProviders}",
      "title: SSO_PAGE_COPY.samlCardTitle,",
      "description: SSO_PAGE_COPY.samlCardDescription,",
      "title: SSO_PAGE_COPY.oidcCardTitle,",
      "description: SSO_PAGE_COPY.oidcCardDescription,",
      "title: SSO_PAGE_COPY.testSignIn,",
      'createVerb="Add"',
    ]) {
      expect({ wiring, used: pageCode.includes(wiring) }).toEqual({
        wiring,
        used: true,
      });
    }

    expect(authenticationCode).toContain(
      "translator.translateText(SIGN_UP_WHILE_SSO_REQUIRED)",
    );

    for (const text of SSO_PAGE_STRINGS) {
      expect({ text, inPage: pageCode.includes(`"${text}"`) }).toEqual({
        text,
        inPage: false,
      });
      expect({
        text,
        inAuthentication: authenticationCode.includes(`"${text}"`),
      }).toEqual({ text, inAuthentication: false });
    }
  });

  test("say nothing about an edition or a license", () => {
    for (const text of [...SSO_PAGE_STRINGS, ...PROTOCOL_NAMES]) {
      expect(text).not.toMatch(
        /licen[cs]e|trial|grace|Enterprise|Community|expired/i,
      );
    }
  });

  test("en.json maps every string to itself", () => {
    const missing: Array<string> = SSO_PAGE_STRINGS.filter((key: string) => {
      return english[key] !== key;
    });

    expect(missing).toEqual([]);
  });

  test.each(OTHER_LOCALES)("%s translates every string", (locale: string) => {
    expectTranslated(locale, SSO_PAGE_STRINGS);

    const entries: Locale = readLocale(locale);

    // The buttons and the rows' action are not the English ones.
    for (const label of [
      SSO_PAGE_COPY.bannerTitle,
      SSO_PAGE_COPY.testSignIn,
      "Add SAML Provider",
      "Add OIDC Provider",
    ]) {
      expect({ label, translated: entries[label] !== label }).toEqual({
        label,
        translated: true,
      });
    }
  });

  test("every locale keeps the page's entries together, right before the card's", () => {
    for (const locale of ALL_LOCALES) {
      const keys: Array<string> = Object.keys(readLocale(locale));

      expect({
        locale,
        block: blockFrom(
          keys,
          SSO_PAGE_STRINGS[0] as string,
          SSO_PAGE_STRINGS.length + 1,
        ),
      }).toEqual({
        locale,
        block: [...SSO_PAGE_STRINGS, SSO_CARD_STRINGS[0]],
      });
    }
  });

  test("the side menu and the breadcrumb name the page in every locale", () => {
    expect(nestedEntry(english, "sideMenu.settingsSso")).toBe("Single Sign-On");
    expect(nestedEntry(english, "breadcrumbs.singleSignOn")).toBe(
      "Single Sign-On",
    );

    for (const locale of OTHER_LOCALES) {
      const entries: Locale = readLocale(locale);

      for (const key of ["sideMenu.settingsSso", "breadcrumbs.singleSignOn"]) {
        const value: unknown = nestedEntry(entries, key);

        expect({ locale, key, type: typeof value }).toEqual({
          locale,
          key,
          type: "string",
        });
        expect(String(value).trim()).not.toBe("");
      }

      // The page reads the same in the menu and in the breadcrumb.
      expect(nestedEntry(entries, "sideMenu.settingsSso")).toBe(
        nestedEntry(entries, "breadcrumbs.singleSignOn"),
      );
    }
  });
});

describe("the Health screens' license notice", () => {
  test("names SCIM and audit logging, and not single sign-on, in English", () => {
    const description: string = HEALTH_LICENSE_NOTICE[1] as string;

    expect(description).toContain(
      "SCIM provisioning and audit logging are off too",
    );
    expect(description).not.toMatch(/\bSSO\b|single sign-on/i);
  });

  test("en.json maps it to itself", () => {
    for (const key of HEALTH_LICENSE_NOTICE) {
      expect(english[key]).toBe(key);
    }
  });

  test.each(OTHER_LOCALES)("%s translates it", (locale: string) => {
    const entries: Locale = readLocale(locale);

    for (const key of HEALTH_LICENSE_NOTICE) {
      const value: unknown = entries[key];

      expect({ key, type: typeof value }).toEqual({ key, type: "string" });

      const text: string = value as string;

      expect({ key, translated: text !== key }).toEqual({
        key,
        translated: true,
      });
      expect({ key, sentence: isSentence(text) }).toEqual({
        key,
        sentence: true,
      });
      expect({ key, namesSso: SSO_WORD.test(text) }).toEqual({
        key,
        namesSso: false,
      });
    }

    // SCIM keeps its name in every language.
    expect(entries[HEALTH_LICENSE_NOTICE[1] as string]).toContain("SCIM");
  });

  test("every locale keeps its title and description together", () => {
    for (const locale of ALL_LOCALES) {
      const keys: Array<string> = Object.keys(readLocale(locale));

      expect({
        locale,
        block: blockFrom(
          keys,
          HEALTH_LICENSE_NOTICE[0] as string,
          HEALTH_LICENSE_NOTICE.length,
        ),
      }).toEqual({ locale, block: HEALTH_LICENSE_NOTICE });
    }
  });

  test("the notice from while single sign-on stopped with the license is in no locale", () => {
    expect(RETIRED_HEALTH_DESCRIPTION).not.toBe(HEALTH_LICENSE_NOTICE[1]);

    for (const locale of ALL_LOCALES) {
      expect({
        locale,
        retired: RETIRED_HEALTH_DESCRIPTION in readLocale(locale),
      }).toEqual({ locale, retired: false });
    }
  });
});

describe("the retired 'disable a provider' strings", () => {
  test("no Admin Dashboard locale has them", () => {
    for (const locale of ALL_LOCALES) {
      const entries: Locale = readLocale(locale);

      expect({
        locale,
        retired: RETIRED_KEYS.filter((key: string) => {
          return key in entries;
        }),
      }).toEqual({ locale, retired: [] });
    }
  });

  test("nothing the Admin Dashboard renders uses them", () => {
    const sources: Array<string> = [
      ...sourceFilesUnder(ADMIN_SRC),
      ...sourceFilesUnder(COMMON_UI),
      ...EE_UI.flatMap((directory: string) => {
        return sourceFilesUnder(directory);
      }),
    ];

    // The scan reads the Admin Dashboard and Common UI, not an empty list.
    expect(sources.length).toBeGreaterThan(500);

    const uses: Array<string> = [];

    for (const file of sources) {
      const text: string = fs.readFileSync(file, "utf8").replace(/\s+/g, " ");

      for (const retired of RETIRED_PROVIDER_STRINGS) {
        if (text.includes(retired)) {
          uses.push(`${path.basename(file)}: ${retired}`);
        }
      }
    }

    expect(uses).toEqual([]);
  });
});
