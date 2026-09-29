import IncidentCreatedRenotify from "Common/Types/StatusPage/IncidentCreatedRenotify";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Publishing a hidden incident offers "Notify subscribers that this incident
 * was created", and the overview badge names the hidden-from-status-pages
 * skip. Those strings live in Common (IncidentCreatedRenotify) so the server,
 * the worker and the dashboard agree on them, and reach the screen through
 * components that look them up in the Dashboard locale files by their English
 * text (FormField for the checkbox title and description, the notification
 * badge for its label). A string with no entry silently stays English, so
 * this pins:
 *
 *   - the dashboard renders them through the shared constants, so rewording
 *     one here cannot leave the page showing an untranslated copy;
 *   - en.json maps each to itself, and all sixteen other locales carry a real
 *     translation.
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
  IncidentCreatedRenotify.formFieldTitle,
  IncidentCreatedRenotify.formFieldDescription,
  IncidentCreatedRenotify.untoldStatusPagesFormFieldDescription,
  IncidentCreatedRenotify.hiddenFromStatusPagesLabel,
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

describe("IncidentCreatedRenotify strings in the dashboard", () => {
  test("the checkbox takes its title and description from the shared constants", () => {
    const source: string = readSource(
      "Components",
      "Incident",
      "IncidentCreatedRenotifyFormField.ts",
    );

    expect(source).toContain("title: IncidentCreatedRenotify.formFieldTitle,");
    // The page's description for the case, else the skipped one.
    expect(source).toContain(
      "description: data.description || IncidentCreatedRenotify.formFieldDescription,",
    );
  });

  test("the Settings tab offers the checkbox from that helper", () => {
    const source: string = readSource(
      "Pages",
      "Incidents",
      "View",
      "Settings.tsx",
    );

    expect(source).toContain("getIncidentCreatedRenotifyFormField(");
    expect(source).toContain("IncidentCreatedRenotify.canRenotifyOnPublish(");
    expect(source).toContain("IncidentCreatedRenotify.isTickedByDefault(");
    // The skipped and the untold-pages cases each explain themselves.
    expect(source).toContain(
      "IncidentCreatedRenotify.getFormFieldDescription(",
    );
    expect(source).toContain("description: renotifyDescription,");
  });

  test("the overview badge takes its label from the shared constant", () => {
    const source: string = readSource(
      "Pages",
      "Incidents",
      "View",
      "Index.tsx",
    );

    expect(source).toContain(
      "IncidentCreatedRenotify.isHiddenFromStatusPagesSkip(",
    );
    expect(source).toContain(
      "IncidentCreatedRenotify.hiddenFromStatusPagesLabel",
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
