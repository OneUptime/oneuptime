import IncidentPostmortemPublication from "Common/Types/StatusPage/IncidentPostmortemPublication";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A postmortem published while its incident is hidden is sent when the
 * incident is made visible on status pages. Two places say so: the
 * Postmortem page labels its notification "Not sent yet: incident hidden
 * from status pages" instead of "Notifications skipped.", and the incident's
 * Visible on Status Page switch says turning it on sends the postmortem.
 *
 * Those strings live in Common (IncidentPostmortemPublication), next to the
 * rule that decides when they apply, and reach the screen through components
 * that look them up in the Dashboard locale files by their English text (the
 * notification badge for its label, FormField for the description). A string
 * with no entry silently stays English, and the extractor does not read
 * Common/Types, so this pins:
 *
 *   - the pages draw them from the shared constants, so rewording one there
 *     cannot leave the page showing an untranslated copy;
 *   - en.json maps each to itself, and all sixteen other locales carry a
 *     real translation.
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

const STRINGS: Array<string> = [
  IncidentPostmortemPublication.hiddenIncidentLabel,
  IncidentPostmortemPublication.sendsOnShowDescription,
];

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function readSource(...relativePath: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath), "utf8")
    .replace(/\s+/g, " ");
}

describe("the words for a postmortem that waits for its incident, in the dashboard", () => {
  test("the Postmortem page labels the notification from the shared constant, by the rule", () => {
    const source: string = readSource(
      "Pages",
      "Incidents",
      "View",
      "Postmortem.tsx",
    );

    expect(source).toMatch(
      /const isWaitingForIncident: boolean = IncidentPostmortemPublication\.isWaitingForIncidentToShow\( ?item,? ?\);/,
    );
    expect(source).toMatch(
      /statusText=\{ ?isWaitingForIncident \? IncidentPostmortemPublication\.hiddenIncidentLabel : undefined ?\}/,
    );
    // Drawn as waiting - a clock - rather than as a skip for good.
    expect(source).toContain("isWaiting={isWaitingForIncident}");
  });

  test("the Settings tab's switch takes its description from the shared constant, by the rule", () => {
    const source: string = readSource(
      "Pages",
      "Incidents",
      "View",
      "Settings.tsx",
    );

    // Not for a private incident: switching it on alone sends nothing.
    expect(source).toMatch(
      /IncidentPostmortemPublication\.isSentBySwitchingVisibilityOn\( ?loadedIncident,? ?\)/,
    );
    expect(source).toContain(
      "description: IncidentPostmortemPublication.sendsOnShowDescription,",
    );
  });

  test("the badge translates a caller's label", () => {
    const source: string = readSource(
      "Components",
      "StatusPageSubscribers",
      "SubscriberNotificationStatus.tsx",
    );

    expect(source).toContain("translateString(statusText)");
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
      expect(value).not.toBe(text);
      expect(value as string).not.toMatch(/{{|}}/);
    });
  });
});
