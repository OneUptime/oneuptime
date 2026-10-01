import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the Dashboard locales say about single sign-on and the Enterprise
 * license.
 *
 * The Dashboard, and the Enterprise screens it bundles from ee/Dashboard,
 * look each string up by its English text (Alert, Card, Button, FieldLabel
 * and the rest), so an entry is what decides whether a string is translated.
 *
 * Single sign-on is part of every edition and never depends on a license, so
 * no screen offers the "disable a provider while the license is lapsed"
 * action any more, or says that sign-in through a provider is off. Its
 * strings are gone from all 17 locales, and nothing the Dashboard renders
 * uses them. "Disable" stays: the calendar feed cards render it.
 *
 * The SCIM screens still have license copy: the banner above their
 * configuration (ee/Dashboard/Identity/License/EnterpriseLicenseBanner.tsx)
 * and the notice under it (ee/Dashboard/Identity/TightenOnly/
 * ReadOnlyActionsNotice.tsx). Every locale has all of it, so a lapsed SCIM
 * screen is in one language. No core code renders these strings - the
 * Enterprise Edition does, and ee/ is not in every checkout - so a clean-up
 * of keys "nothing uses" must not take them away.
 * ee/Tests/UI/Identity/EnterpriseLicenseBannerLocales.test.tsx ties them to
 * the components' own constants and renders them in every language.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const COMMON_UI: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
);

// Present in an Enterprise checkout only (the core CI jobs delete ee/).
const EE_DASHBOARD: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "ee",
  "Dashboard",
);

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

// The retired provider notice and the "Disable" action's confirmation.
const RETIRED_PROVIDER_STRINGS: Array<string> = [
  "You can still disable a provider.",
  "Without a valid Enterprise license this configuration is read-only and sign-in through these providers is off, but disabling a provider is always allowed, because it can only tighten security. Sign-in resumes through every enabled provider as soon as a license is activated, so if an identity provider is compromised, use Disable now to keep it off. Turning a provider back on needs a valid license.",
  "Disable Provider",
  "Nobody will be able to sign in with this provider until it is turned back on, and turning it back on needs a valid Enterprise license.",
];

// What the SCIM screens show about the license, in the order they show it.
const SCIM_LICENSE_COPY: Array<string> = [
  // The banner: read-only, trial or grace period, and a license without SCIM.
  "Enterprise license required: SCIM is off, and this configuration is read-only.",
  "Without a valid Enterprise license, your identity provider's SCIM requests are refused, so it cannot provision or deprovision users until the license is back. Nothing configured here is deleted: activate or renew the Enterprise license in the Admin Dashboard and everything resumes as configured.",
  "No valid Enterprise license: SCIM stops when the trial or grace period ends.",
  "Everything here works during the 14-day trial of an installation with no license, or the 30-day grace period after a license expires, and you can still change this configuration. When it ends, your identity provider's SCIM requests are refused and this configuration becomes read-only, until an Enterprise license is activated in the Admin Dashboard.",
  "Your Enterprise license does not include SCIM: SCIM is off, and this configuration is read-only.",
  "The installed license leaves SCIM provisioning out, so your identity provider's SCIM requests are refused and it cannot provision or deprovision users. Nothing configured here is deleted: activate a license that includes SCIM in the Admin Dashboard and everything resumes as configured.",
  // The notice under it.
  "You can still reset a SCIM bearer token.",
  "Without a valid Enterprise license this configuration is read-only and SCIM requests are refused, but resetting a bearer token is always allowed, because it can only tighten security. SCIM requests are accepted again as soon as a license is activated, so if a token has leaked, use Reset Bearer Token now to replace it, then give the new token to your identity provider.",
];

const GRACE_DESCRIPTION: string = SCIM_LICENSE_COPY[3] as string;

// The error the SCIM screens' Reset Bearer Token action can show.
const BEARER_TOKEN_ERROR: string =
  "This browser cannot generate a secure bearer token. Please use a current browser and try again.";

// The retired banner copy from while single sign-on stopped with the license.
const RETIRED_SSO_BANNER_COPY: Array<string> = [
  "Enterprise license required: single sign-on and SCIM are off, and this configuration is read-only.",
  "No valid Enterprise license: single sign-on and SCIM stop when the trial or grace period ends.",
  "Your Enterprise license does not include single sign-on: single sign-on is off, and this configuration is read-only.",
];

// What a sentence may end with, per script.
const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

// The day counts, in Latin or Persian digits.
const TRIAL_DAYS: RegExp = /14|۱۴/;
const GRACE_DAYS: RegExp = /30|۳۰/;

const SOURCE_FILE: RegExp = /\.tsx?$/;

// "SSO" as a word, in any language's text.
const SSO_WORD: RegExp = /\bSSO\b/;

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
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

// Whitespace squashed, so JSX text wrapped over lines is found too.
function squashed(text: string): string {
  return text.replace(/\s+/g, " ");
}

function isSentence(text: string): boolean {
  return SENTENCE_ENDINGS.some((ending: string) => {
    return text.endsWith(ending);
  });
}

const english: Locale = readLocale("en");

describe("the retired 'disable a provider' strings", () => {
  test("no Dashboard locale has them", () => {
    for (const locale of ALL_LOCALES) {
      const entries: Locale = readLocale(locale);

      expect({
        locale,
        retired: RETIRED_PROVIDER_STRINGS.filter((key: string) => {
          return key in entries;
        }),
      }).toEqual({ locale, retired: [] });
    }
  });

  test("nothing the Dashboard renders uses them", () => {
    const sources: Array<string> = [
      ...sourceFilesUnder(DASHBOARD_SRC),
      ...sourceFilesUnder(COMMON_UI),
      ...sourceFilesUnder(EE_DASHBOARD),
    ];

    // The scan reads the Dashboard and Common UI, not an empty list.
    expect(sources.length).toBeGreaterThan(500);

    const uses: Array<string> = [];

    for (const file of sources) {
      const text: string = squashed(fs.readFileSync(file, "utf8"));

      for (const retired of RETIRED_PROVIDER_STRINGS) {
        if (text.includes(retired)) {
          uses.push(`${path.basename(file)}: ${retired}`);
        }
      }
    }

    expect(uses).toEqual([]);
  });

  test("'Disable' keeps its entry: the calendar feed cards render it", () => {
    for (const card of [
      "Components/OnCallPolicy/CalendarFeed/PersonalCalendarFeedCard.tsx",
      "Components/OnCallPolicy/CalendarFeed/SharedCalendarFeedCard.tsx",
    ]) {
      expect(fs.readFileSync(path.join(DASHBOARD_SRC, card), "utf8")).toContain(
        '"Disable"',
      );
    }

    expect(english["Disable"]).toBe("Disable");

    for (const locale of OTHER_LOCALES) {
      const value: unknown = readLocale(locale)["Disable"];

      expect({ locale, type: typeof value }).toEqual({
        locale,
        type: "string",
      });
      expect((value as string).trim()).not.toBe("");
    }
  });

  test("the banner copy from while single sign-on stopped with the license is in no locale", () => {
    for (const locale of ALL_LOCALES) {
      const entries: Locale = readLocale(locale);

      expect({
        locale,
        retired: RETIRED_SSO_BANNER_COPY.filter((key: string) => {
          return key in entries;
        }),
      }).toEqual({ locale, retired: [] });
    }
  });
});

describe("the SCIM screens' license copy", () => {
  test("names SCIM, and not single sign-on, in English", () => {
    for (const text of SCIM_LICENSE_COPY) {
      expect(text).toContain("SCIM");
      expect(text).not.toMatch(/\bSSO\b|single sign-on/i);
    }
  });

  test("en.json maps every string to itself", () => {
    const missing: Array<string> = SCIM_LICENSE_COPY.filter((key: string) => {
      return english[key] !== key;
    });

    expect(missing).toEqual([]);
  });

  test("every locale keeps it together, in the order the screen shows it", () => {
    for (const locale of ALL_LOCALES) {
      const keys: Array<string> = Object.keys(readLocale(locale));
      const first: number = keys.indexOf(SCIM_LICENSE_COPY[0] as string);

      expect({
        locale,
        block:
          first === -1
            ? []
            : keys.slice(first, first + SCIM_LICENSE_COPY.length),
      }).toEqual({ locale, block: SCIM_LICENSE_COPY });
    }
  });

  test("the Reset Bearer Token error keeps its entry in every locale", () => {
    expect(english[BEARER_TOKEN_ERROR]).toBe(BEARER_TOKEN_ERROR);

    for (const locale of OTHER_LOCALES) {
      const value: unknown = readLocale(locale)[BEARER_TOKEN_ERROR];

      expect({ locale, type: typeof value }).toEqual({
        locale,
        type: "string",
      });
      expect(value).not.toBe(BEARER_TOKEN_ERROR);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s translates every sentence of it",
    (locale: string) => {
      const entries: Locale = readLocale(locale);

      for (const key of SCIM_LICENSE_COPY) {
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
        expect(text).not.toContain("{{");
        // SCIM keeps its name in every language; single sign-on is not mentioned.
        expect({ key, namesScim: text.includes("SCIM") }).toEqual({
          key,
          namesScim: true,
        });
        expect({ key, namesSso: SSO_WORD.test(text) }).toEqual({
          key,
          namesSso: false,
        });
      }
    },
  );

  // The key is the rendered text, so it carries the two periods' lengths.
  test.each(OTHER_LOCALES)(
    "%s keeps the 14-day trial and the 30-day grace period",
    (locale: string) => {
      const text: string = String(readLocale(locale)[GRACE_DESCRIPTION]);

      expect(GRACE_DESCRIPTION).toMatch(TRIAL_DAYS);
      expect(GRACE_DESCRIPTION).toMatch(GRACE_DAYS);
      expect(text).toMatch(TRIAL_DAYS);
      expect(text).toMatch(GRACE_DAYS);
    },
  );
});
