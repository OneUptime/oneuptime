import {
  STATE_SETTINGS_COPY,
  StateSettingsSharedCopy,
  getStateSettingsStrings,
} from "../../FeatureSet/Dashboard/src/Components/StateSettings/StateSettingsCopy";
import { StateListType } from "Common/Utils/StateOrder";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The state, severity and monitor status settings pages' text - each card's
 * sentence about what its order means, the "Counts as" column, the Built-in
 * tag and its tooltips, the locked Delete's reason and the form's
 * placeholders - reaches the screen by looking its English text up in the
 * Dashboard locale files. A string with no entry silently stays English, so
 * every one is pinned in all seventeen, with the same {{placeholders}}, and
 * the strings the old pages used are gone from them.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
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

/*
 * Entries other pages already had - the column titles, the built-in state
 * names a label reuses, the card titles - some of them the same word in
 * some languages.
 */
const SHARED_WITH_OTHER_FEATURES: Array<string> = [
  "Name",
  "Description",
  "Color",
  "Acknowledged",
  "Resolved",
  "Scheduled",
  "Ongoing",
  "Completed",
  "Investigating",
  "Incident States",
  "Alert States",
  "Scheduled Maintenance States",
  "Monitor Statuses",
  "Incident Severities",
  "Alert Severities",
];

const STRINGS: Array<string> = getStateSettingsStrings();

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

function placeholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

describe("the state settings strings", () => {
  test("cover every page, the shared copy and the per-page copy", () => {
    expect(STRINGS.length).toBeGreaterThan(40);

    for (const value of Object.values(StateSettingsSharedCopy)) {
      expect(STRINGS).toContain(value);
    }

    for (const type of Object.values(StateListType)) {
      expect(STRINGS).toContain(STATE_SETTINGS_COPY[type].title);
      expect(STRINGS).toContain(STATE_SETTINGS_COPY[type].description);
    }
  });

  test("never say the order is a number to type", () => {
    for (const text of STRINGS) {
      expect(text).not.toMatch(/\border number\b/i);
      expect(text).not.toMatch(/\bpriority\b/i);
    }
  });

  test.each(STRINGS)("en.json maps %j to itself", (text: string) => {
    expect(readLocale("en")[text]).toBe(text);
  });

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    test.each(STRINGS)("translates %j", (text: string) => {
      const value: unknown = translations[text];

      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(0);
      expect(placeholders(value as string)).toEqual(placeholders(text));

      if (!SHARED_WITH_OTHER_FEATURES.includes(text)) {
        expect(value).not.toBe(text);
      }
    });
  });
});

describe("the old pages' strings", () => {
  const RETIRED: Array<string> = [
    "Alerts and incidents will be categorised according to their severity level using the following classifications: ",
    "Alerts and alerts will be categorised according to their severity level using the following classifications: ",
    "Incidents have multiple states like - created, acknowledged and resolved. You can more states help you manage incidents here.",
    "Alerts have multiple states like - created, acknowledged and resolved. You can more states help you manage alerts here.",
    "Scheduled Maintenance events have multiple states like - scheduled, ongoing and completed. You can more states help you manage Scheduled Maintenance events here.",
    "Define different status types (eg: Operational, Degraded, Down) here.",
    "This incident state happens when the incident is investigated",
    "Monitor Status Color",
  ];

  test.each(["en", ...OTHER_LOCALES])("are gone from %s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    for (const text of RETIRED) {
      expect(translations[text]).toBeUndefined();
    }
  });
});
