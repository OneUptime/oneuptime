import { REQUIRE_SSO_COPY } from "../../FeatureSet/AdminDashboard/src/Pages/Settings/Authentication/AuthenticationSwitchesCopy";
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
 *   - Settings > Authentication shows the instance-wide "Require SSO for
 *     Login" switch in every edition, like the page's other switches, and
 *     it asks before it turns on. Every string of its card and its dialog
 *     (AuthenticationSwitchesCopy's REQUIRE_SSO_COPY) has an entry in all 17
 *     locales, and the page hands the switch exactly these strings: a string
 *     added or reworded without an entry would stay English for everyone.
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
 * The "Single Sign-On (SSO)" card, in the order the page renders it: the
 * card, the switch and its sentence, then the dialog before SSO is
 * required.
 */
const SSO_CARD_STRINGS: Array<string> = [
  "Single Sign-On (SSO)",
  "Control whether users must sign in with SSO across this server.",
  "Require SSO for Login",
  "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt so they can always recover from a misconfigured SSO. A project's own SSO settings still apply on top of this.",
  "Require SSO for everyone?",
  "Everyone except master admins will have to sign in with SSO to open any project on this server. Anyone who signs in with a password is locked out of their projects until they sign in with SSO, so check that an SSO provider works for them first.",
  "Require SSO",
];

/*
 * What the card said before it was a switch: its Edit button, and the
 * sentence under the saved value. Gone with the dialog.
 */
const RETIRED_SSO_CARD_STRINGS: Array<string> = [
  "Edit SSO Settings",
  "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt.",
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

const SOURCE_FILE: RegExp = /\.tsx?$/;

// "SSO" as a word, in any language's text.
const SSO_WORD: RegExp = /\bSSO\b/;

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
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

// A locale's keys from `first` on, as many as `expected` has.
function blockFrom(
  keys: Array<string>,
  first: string,
  length: number,
): Array<string> {
  const start: number = keys.indexOf(first);

  return start === -1 ? [] : keys.slice(start, start + length);
}

const english: Locale = readLocale("en");
const pageCode: string = codeOf(fs.readFileSync(AUTHENTICATION_PAGE, "utf8"));

// The copy, in the order the page renders it.
const COPY_IN_ORDER: Array<string> = [
  REQUIRE_SSO_COPY.cardTitle,
  REQUIRE_SSO_COPY.cardDescription,
  REQUIRE_SSO_COPY.switchTitle,
  REQUIRE_SSO_COPY.note,
  REQUIRE_SSO_COPY.confirmTitle,
  REQUIRE_SSO_COPY.confirmDescription,
  REQUIRE_SSO_COPY.confirmButton,
];

describe("Settings > Authentication: the Single Sign-On (SSO) card", () => {
  test("its copy is exactly these strings", () => {
    expect(COPY_IN_ORDER).toEqual(SSO_CARD_STRINGS);
    expect(Object.values(REQUIRE_SSO_COPY).sort()).toEqual(
      [...SSO_CARD_STRINGS].sort(),
    );
  });

  test("the page hands each of them to the switch, and nothing else", () => {
    for (const wiring of [
      "cardTitle={REQUIRE_SSO_COPY.cardTitle}",
      "cardDescription={REQUIRE_SSO_COPY.cardDescription}",
      "title={REQUIRE_SSO_COPY.switchTitle}",
      "note={REQUIRE_SSO_COPY.note}",
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
      expect({ text, inPage: pageCode.includes(text) }).toEqual({
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

  test("the dialog says who is locked out, and who is not", () => {
    expect(REQUIRE_SSO_COPY.confirmDescription).toContain(
      "Everyone except master admins",
    );
    expect(REQUIRE_SSO_COPY.confirmDescription).toContain("locked out");
    expect(REQUIRE_SSO_COPY.note).toContain("Master admins are exempt");
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
    const entries: Locale = readLocale(locale);

    for (const key of SSO_CARD_STRINGS) {
      const value: unknown = entries[key];

      expect({ key, type: typeof value }).toEqual({ key, type: "string" });

      const text: string = value as string;

      expect(text.trim()).not.toBe("");
      expect(text).not.toContain("{{");
      // SSO keeps its name in every language.
      expect({ key, namesSso: text.includes("SSO") }).toEqual({
        key,
        namesSso: true,
      });

      /*
       * Sentences are translated everywhere. "Single Sign-On (SSO)" is the
       * same word in some languages, like the Dashboard's entry for it.
       */
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
    }

    // The labels and the dialog are not the English ones in any language.
    for (const label of [
      REQUIRE_SSO_COPY.switchTitle,
      REQUIRE_SSO_COPY.confirmTitle,
      REQUIRE_SSO_COPY.confirmButton,
    ]) {
      expect({ label, translated: entries[label] !== label }).toEqual({
        label,
        translated: true,
      });
    }
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

  test("the retired Edit button and saved-value sentence are gone from every locale and the page", () => {
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
