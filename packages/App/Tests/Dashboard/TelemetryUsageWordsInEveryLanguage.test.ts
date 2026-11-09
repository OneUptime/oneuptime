import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE USAGE PAGES SAY WHAT THEY SAY IN EVERY LANGUAGE (issue #5916).
 *
 * Project Settings > Telemetry & APM > Usage and the Admin Dashboard's
 * Telemetry Usage draw the same overview (Common/UI/Components/
 * TelemetryUsage), so its words are entries of both dashboards' locales:
 * translated in each of the sixteen languages, the two dashboards wording a
 * shared string alike, and each sentence keeping its {{placeholders}}.
 */

const FEATURE_SET: string = path.resolve(__dirname, "..", "..", "FeatureSet");
const DASHBOARD_LOCALES: string = path.join(
  FEATURE_SET,
  "Dashboard",
  "src",
  "Locales",
);
const ADMIN_LOCALES: string = path.join(
  FEATURE_SET,
  "AdminDashboard",
  "src",
  "Locales",
);
const SAME_AS_ENGLISH: Array<string> = JSON.parse(
  fs.readFileSync(
    path.join(FEATURE_SET, "Dashboard", "i18n", "SameAsEnglish.json"),
    "utf8",
  ),
) as Array<string>;

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
];

// Every string the usage overview and the Usage page added.
const OVERVIEW_STRINGS: ReadonlyArray<string> = [
  "Telemetry Usage",
  "How much telemetry this project sent each day, by signal. A day is counted once it has ended in UTC.",
  "Usage by Resource",
  "Which services and resources sent the telemetry, heaviest first, and how long each keeps it.",
  "Range",
  "Last {{count}} days",
  "No telemetry usage yet",
  "A day's telemetry is counted once the day has ended in UTC, by about 08:00 UTC the next day. Today's shows up tomorrow.",
  "No telemetry usage in this range",
  "The newest day with usage is {{day}}. Choose a longer range to see it.",
  "Spans, and the exceptions recorded with them.",
  "Profiles, and the samples recorded with them.",
  "Session replays: {{days}}",
  "How long the resource's telemetry is kept, as counted on the newest day of the range.",
  "{{size}} GB",
  "{{size}} MB",
  "{{size}} KB",
  "{{amount}} USD",
];

// The Usage page's own: the daily rows' card where billing is off.
const DASHBOARD_ONLY_STRINGS: ReadonlyArray<string> = [
  "How much telemetry each service sent each day, and how long it is kept.",
];

// What the overview names that the Dashboard had words for already.
const SHARED_EXISTING_STRINGS: ReadonlyArray<string> = [
  "Total",
  "Cost",
  "Retention",
  "Resource",
  "Resources",
  "Logs",
  "Metrics",
  "Traces",
  "Profiles",
  "Session Replays",
  "Security Events",
  "Unknown Service",
  "Service",
  "Host",
  "Kubernetes Cluster",
  "Database",
  "Day",
  "Data Ingested (in GB)",
];

const ADMIN_NESTED: ReadonlyArray<Array<string>> = [
  ["sideMenu", "telemetryUsage"],
  ["breadcrumbs", "telemetryUsage"],
  ["pages", "telemetryUsage", "title"],
  ["pages", "telemetryUsage", "cardTitle"],
  ["pages", "telemetryUsage", "cardDescription"],
  ["pages", "telemetryUsage", "emptyTitle"],
  ["pages", "telemetryUsage", "emptyDescription"],
  ["pages", "settings", "dataRetention", "usageCardTitle"],
  ["pages", "settings", "dataRetention", "usageCardDescription"],
  ["pages", "settings", "dataRetention", "usageEditButton"],
];

// The Admin Dashboard's own flat entries: its menu item and its form.
const ADMIN_ONLY_FLAT: ReadonlyArray<string> = [
  "How much telemetry each project sends, heaviest first.",
  "Telemetry Usage Retention (Days)",
  "How many days each project's daily telemetry usage is kept, from 30 to 1095. Leave empty for 120 days.",
  "Number of days to keep each project's daily telemetry usage. Usage older than this is deleted.",
];

type Locale = Record<string, unknown>;

const readLocale: (directory: string, code: string) => Locale = (
  directory: string,
  code: string,
): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(directory, `${code}.json`), "utf8"),
  ) as Locale;
};

const valueAt: (locale: Locale, keys: Array<string>) => unknown = (
  locale: Locale,
  keys: Array<string>,
): unknown => {
  let node: unknown = locale;

  for (const key of keys) {
    node = (node as Record<string, unknown> | undefined)?.[key];
  }

  return node;
};

const placeholdersOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return (text.match(/\{\{[a-zA-Z]+\}\}/g) || []).sort();
};

// Words a translation keeps as written: units, and what is same in every language.
const isKeptAsWritten: (english: string) => boolean = (
  english: string,
): boolean => {
  return SAME_AS_ENGLISH.includes(english);
};

describe("the Dashboard's locales", () => {
  const english: Locale = readLocale(DASHBOARD_LOCALES, "en");

  test("hold every string of the overview and the page in English", () => {
    for (const text of [
      ...OVERVIEW_STRINGS,
      ...DASHBOARD_ONLY_STRINGS,
      ...SHARED_EXISTING_STRINGS,
    ]) {
      expect({ text, english: english[text] }).toEqual({ text, english: text });
    }

    expect(english["Last {{count}} days_one"]).toBe("Last {{count}} day");
  });

  test.each(LANGUAGES)(
    "%s translates every one of them, keeping its placeholders",
    (code: string) => {
      const locale: Locale = readLocale(DASHBOARD_LOCALES, code);

      for (const text of [...OVERVIEW_STRINGS, ...DASHBOARD_ONLY_STRINGS]) {
        const value: unknown = locale[text];

        expect({ code, text, isText: typeof value === "string" }).toEqual({
          code,
          text,
          isText: true,
        });
        expect({
          code,
          text,
          translated: isKeptAsWritten(text) || value !== text,
        }).toEqual({ code, text, translated: true });
        expect({
          code,
          text,
          placeholders: placeholdersOf(value as string),
        }).toEqual({ code, text, placeholders: placeholdersOf(text) });
      }

      expect(typeof locale["Last {{count}} days_one"]).toBe("string");
      expect(
        placeholdersOf(locale["Last {{count}} days_one"] as string),
      ).toEqual(["{{count}}"]);
    },
  );
});

describe("the Admin Dashboard's locales", () => {
  const english: Locale = readLocale(ADMIN_LOCALES, "en");

  test("hold the Admin Dashboard's own words in English", () => {
    for (const keys of ADMIN_NESTED) {
      expect({ keys, english: typeof valueAt(english, keys) }).toEqual({
        keys,
        english: "string",
      });
    }

    for (const text of [...OVERVIEW_STRINGS, ...ADMIN_ONLY_FLAT]) {
      expect({ text, english: english[text] }).toEqual({ text, english: text });
    }

    expect(valueAt(english, ["sideMenu", "telemetryUsage"])).toBe(
      "Telemetry Usage",
    );
    expect(valueAt(english, ["pages", "telemetryUsage", "cardTitle"])).toBe(
      "Telemetry Usage by Project",
    );
  });

  test.each(LANGUAGES)(
    "%s translates them, and words the overview's shared strings as its Dashboard does",
    (code: string) => {
      const admin: Locale = readLocale(ADMIN_LOCALES, code);
      const dashboard: Locale = readLocale(DASHBOARD_LOCALES, code);

      for (const keys of ADMIN_NESTED) {
        const value: unknown = valueAt(admin, keys);
        const englishValue: unknown = valueAt(english, keys);

        expect({ code, keys, isText: typeof value === "string" }).toEqual({
          code,
          keys,
          isText: true,
        });
        expect({ code, keys, translated: value !== englishValue }).toEqual({
          code,
          keys,
          translated: true,
        });
      }

      for (const text of ADMIN_ONLY_FLAT) {
        expect({ code, text, translated: admin[text] !== text }).toEqual({
          code,
          text,
          translated: true,
        });
      }

      for (const text of [...OVERVIEW_STRINGS, ...SHARED_EXISTING_STRINGS]) {
        if (dashboard[text] === undefined || admin[text] === undefined) {
          continue;
        }

        expect({ code, text, admin: admin[text] }).toEqual({
          code,
          text,
          admin: dashboard[text],
        });
      }

      // The Admin form's numbers stay its bounds and its default.
      const numbers: Array<string> =
        (
          (admin[
            "How many days each project's daily telemetry usage is kept, from 30 to 1095. Leave empty for 120 days."
          ] as string) || ""
        )
          .replace(/[۰-۹]/g, (digit: string): string => {
            return String(digit.charCodeAt(0) - "۰".charCodeAt(0));
          })
          // 1.095 or 1 095: one number, written the language's way.
          .replace(/(\d)[.,\s\u00a0\u202f\u066c](?=\d{3}(?!\d))/g, "$1")
          .match(/\d+/g) || [];

      expect({ code, numbers: [...numbers].sort() }).toEqual({
        code,
        numbers: ["1095", "120", "30"],
      });
    },
  );
});
