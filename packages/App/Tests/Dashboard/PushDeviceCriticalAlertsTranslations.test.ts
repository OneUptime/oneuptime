import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The push devices card's critical alerts, read in every language the
 * Dashboard ships. Each string the redesign put on screen - the statuses,
 * the steps and their fixes, the dialogs' titles and descriptions, a sent
 * test's words, the empty card, the kind of each device - is a locale key,
 * is drawn by the card's source, and has a translation in all sixteen
 * locales that keeps its placeholders. So is what the card already showed
 * in English everywhere: the column's title, its header (i), and "This
 * browser". The sentences are rendered in each locale in
 * Common/Tests/App/Dashboard/PushDevicesCriticalAlertsInLocale.test.tsx.
 */

const DASHBOARD: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);
const LOCALES_DIR: string = path.join(DASHBOARD, "Locales");
const COMPONENTS_DIR: string = path.join(
  DASHBOARD,
  "Components",
  "NotificationMethods",
);

const SOURCES: Array<string> = [
  "Push.tsx",
  "PushDeviceCriticalAlertStatus.tsx",
  "PushDeviceCriticalAlertSteps.tsx",
  "PushDeviceCriticalAlerts.ts",
].map((name: string): string => {
  return fs.readFileSync(path.join(COMPONENTS_DIR, name), "utf8");
});

const LANGUAGES: Array<string> = [
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

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const ENGLISH: Record<string, unknown> = readLocale("en");

const CARD_STRINGS: Array<string> = [
  // The Critical Alerts column.
  "Critical Alerts",
  "On-call pages to this device override silent mode and Do Not Disturb, except from on-call rules set to Standard. Set in the OneUptime On-Call mobile app, which updates it here each time it's opened.",
  "Rings through silent mode and Do Not Disturb",
  "How to turn on",
  "How to turn on critical alerts on {{deviceName}}",
  "Not available in browsers",
  "A browser can't ring through silent mode",
  "Get them on your phone",
  "How to get critical alerts on your phone",
  "Nothing reaches this device until it is registered again.",
  // The Device column.
  "This browser",
  "iPhone or iPad",
  "Android phone",
  "Web browser",
  // The card and its empty state.
  "Phones signed in to the OneUptime On-Call app, and browsers you register here, get push notifications for this project.",
  "No devices yet",
  "Get the mobile app",
  // The steps.
  "Turn on critical alerts",
  "Critical alerts make on-call pages ring this phone even on silent or in Do Not Disturb. They are turned on in the app, on the phone itself.",
  "Get push notifications on your phone with the OneUptime On-Call app. Its critical alerts ring even on silent.",
  "Open {{app}} on this iPhone or iPad and tap {{settings}}.",
  "Open {{app}} on this phone and tap {{settings}}.",
  "Under {{notifications}}, turn on {{criticalAlerts}}.",
  "When iOS asks whether {{app}} may send critical alerts, tap Allow.",
  "Android opens Do Not Disturb access. Allow it for {{app}}.",
  "Go back to the app and turn on {{criticalAlerts}} again.",
  "Install {{app}} on your phone from the {{appStore}} or {{googlePlay}}.",
  "Open it, connect to {{serverUrl}} and sign in. Allow notifications, and your phone shows up in this list.",
  "In the app, tap {{settings}} and, under {{notifications}}, turn on {{criticalAlerts}}. Allow what the phone asks for, then check the switch is on.",
  "Once it's on, choose the alarm sound for on-call pages under {{alarmSoundPath}}.",
  "To hear it, silence the phone and send it a Test Notification from this list.",
  "If it doesn't turn on",
  "Tapped Don't Allow, or iOS didn't ask? Turn on Critical Alerts in iOS Settings > Notifications > {{app}}, then turn on {{criticalAlerts}} in the app again.",
  "No Critical Alerts switch there? Update {{app}} from the App Store: versions before 1.5.0 cannot receive critical alerts.",
  "The app still asks for Do Not Disturb access? Allow {{app}} in the phone's Settings > Notifications > Do Not Disturb access, then turn on {{criticalAlerts}} again.",
  // A sent test (its button to the steps is "How to turn on", above).
  "Test Notification Sent",
  "Sent to {{deviceName}} as a critical alert: it rings even when the phone is on silent or in Do Not Disturb, as an on-call page would.",
  "Didn't ring through? Open {{app}} on the phone, tap {{settings}} and check that {{criticalAlerts}} is on.",
  "Sent to {{deviceName}}. Critical alerts are off on that phone, so it stays quiet on silent or in Do Not Disturb. Turn them on to have on-call pages ring through.",
  "Sent to {{deviceName}}. If it doesn't appear, check that this site may show notifications in that browser, and that Do Not Disturb or Focus is off on the computer.",
];

const PLACEHOLDER: RegExp = /\{\{\s*([^{}]+?)\s*\}\}/g;

function placeholdersOf(text: string): Array<string> {
  return Array.from(text.matchAll(PLACEHOLDER))
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .sort();
}

describe("the push devices card's critical alerts, in every language", () => {
  test("every string is a key of en.json, for itself", () => {
    for (const text of CARD_STRINGS) {
      expect({ text, english: ENGLISH[text] }).toEqual({ text, english: text });
    }
  });

  test("every string is one the card's source draws", () => {
    for (const text of CARD_STRINGS) {
      expect({
        text,
        drawn: SOURCES.some((source: string): boolean => {
          return source.includes(JSON.stringify(text));
        }),
      }).toEqual({ text, drawn: true });
    }
  });

  test.each(LANGUAGES)(
    "%s translates every one, and keeps its placeholders",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      for (const text of CARD_STRINGS) {
        const translation: unknown = locale[text];

        expect({
          text,
          isText: typeof translation === "string" && translation.trim() !== "",
          translated: translation !== text,
        }).toEqual({ text, isText: true, translated: true });

        expect({
          text,
          placeholders: placeholdersOf(translation as string),
        }).toEqual({ text, placeholders: placeholdersOf(text) });
      }
    },
  );

  /*
   * Sentences the card stopped drawing: a browser's sign-in step, which
   * did not say which OneUptime to connect the app to, a note that said
   * again what the steps' description had just said, the column's (i) from
   * before it said that the app keeps the column up to date, and from
   * before it left browsers to their own cell, an ordinary test's words
   * from before they said why it went ordinary, and the iPhone fixes from
   * before a phone that iOS does not ask again was sent to iOS Settings.
   */
  test("the sentences the steps no longer draw are gone from every locale", () => {
    const retired: Array<string> = [
      "Sign in with your OneUptime account and allow notifications. Your phone then shows up in this list.",
      "Once it's on, on-call pages ring through silent mode and Do Not Disturb. Choose the alarm they play in the app, under {{alarmSoundPath}}.",
      "On-call pages to this device override silent mode and Do Not Disturb, except from on-call rules set to Standard. Turned on from the OneUptime On-Call mobile app; browsers cannot override a device's ringer.",
      "On-call pages to this device override silent mode and Do Not Disturb, except from on-call rules set to Standard. Set in the OneUptime On-Call mobile app, which updates it here each time it's opened. Browsers can't override a device's ringer.",
      "Sent to {{deviceName}}. It follows the phone's sound settings, so a phone on silent or in Do Not Disturb stays quiet. Turn on critical alerts to have on-call pages ring through.",
      "Tapped Don't Allow? Turn on Critical Alerts in iOS Settings > Notifications > {{app}}, then turn on {{criticalAlerts}} in the app again.",
      "iOS didn't ask? Update {{app}} from the App Store: versions before 1.5.0 cannot receive critical alerts.",
    ];

    for (const language of ["en", ...LANGUAGES]) {
      const locale: Record<string, unknown> = readLocale(language);

      for (const text of retired) {
        expect({ language, text, kept: text in locale }).toEqual({
          language,
          text,
          kept: false,
        });
      }
    }

    for (const text of retired) {
      expect(
        SOURCES.some((source: string): boolean => {
          return source.includes(JSON.stringify(text));
        }),
      ).toBe(false);
    }
  });

  test("Registered At is no longer drawn by the card", () => {
    const card: string = SOURCES[0]!;

    expect(card).not.toContain('"Registered At"');
    expect(card).not.toContain("createdAt: true");
  });
});
