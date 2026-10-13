import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import PushDeviceCriticalAlertStatus from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/PushDeviceCriticalAlertStatus";
import PushDeviceCriticalAlertSteps from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/PushDeviceCriticalAlertSteps";
import {
  CRITICAL_ALERT_HOW_TO_HEAR_IT,
  CRITICAL_ALERT_ONCE_ON,
  CRITICAL_ALERT_STEPS,
  CriticalAlertDeviceState,
  MOBILE_APP_LABELS,
  PushDevicePlatform,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/PushDeviceCriticalAlerts";
import { getMobileAppServerUrl } from "../../../../App/FeatureSet/Dashboard/src/Utils/MobileAppServerUrl";

/*
 * The push devices card's critical alerts in every language the Dashboard
 * ships, read from the locale files themselves.
 *
 * The steps name the OneUptime On-Call app's own labels - Settings,
 * Notifications, Critical On-Call Alerts, Alarm sound - which the app draws
 * in English whatever the phone's language. So in every locale the sentence
 * around them is the locale's, and the labels themselves stay exactly as
 * the app shows them, in bold: a German reader looks for "Settings" in the
 * app, not "Einstellungen". A translation that lost or renamed a
 * placeholder would drop a label; this would see it.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

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

// The placeholders that draw one of the app's own labels.
const APP_LABEL_PLACEHOLDER: RegExp =
  /\{\{(app|settings|notifications|criticalAlerts)\}\}/g;

const APP_LABEL_OF: Record<string, string> = {
  app: MOBILE_APP_LABELS.appName,
  settings: MOBILE_APP_LABELS.settingsTab,
  notifications: MOBILE_APP_LABELS.notificationsSection,
  criticalAlerts: MOBILE_APP_LABELS.criticalAlertsSwitch,
};

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

// The locale's sentence, with the app's labels where the dialog puts them.
function expectedStep(language: string, template: string): string {
  const sentence: string = LOCALES[language]![template] || template;

  return sentence
    .split("{{app}}")
    .join(MOBILE_APP_LABELS.appName)
    .split("{{settings}}")
    .join(MOBILE_APP_LABELS.settingsTab)
    .split("{{notifications}}")
    .join(MOBILE_APP_LABELS.notificationsSection)
    .split("{{criticalAlerts}}")
    .join(MOBILE_APP_LABELS.criticalAlertsSwitch)
    .split("{{appStore}}")
    .join("App Store")
    .split("{{googlePlay}}")
    .join("Google Play")
    .split("{{serverUrl}}")
    .join(getMobileAppServerUrl())
    .split("{{alarmSoundPath}}")
    .join(
      [
        MOBILE_APP_LABELS.settingsTab,
        MOBILE_APP_LABELS.notificationsSection,
        MOBILE_APP_LABELS.alarmSoundRow,
      ].join(" > "),
    );
}

function stepsShown(): Array<string> {
  return Array.from(
    screen.getByTestId("critical-alert-steps-list").querySelectorAll("li > p"),
  ).map((step: Element): string => {
    return step.textContent || "";
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: LOCALES[language]! };
  }

  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "de",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
});

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

describe.each(LANGUAGES)("in %s", (language: string) => {
  test.each([
    PushDevicePlatform.IOS,
    PushDevicePlatform.Android,
    PushDevicePlatform.Browser,
  ])(
    "the %s steps are the locale's sentences, with the app's labels as the app draws them",
    async (platform: PushDevicePlatform) => {
      await inLanguage(language);

      render(
        <PushDeviceCriticalAlertSteps
          deviceName="Pixel 10"
          platform={platform}
          onClose={() => {}}
        />,
      );

      const templates: ReadonlyArray<string> = CRITICAL_ALERT_STEPS[platform];

      // Translated: not one step is still the English.
      for (const template of templates) {
        expect({
          template,
          translated: LOCALES[language]![template] !== template,
        }).toEqual({ template, translated: true });
      }

      expect(stepsShown()).toEqual(
        templates.map((template: string): string => {
          return expectedStep(language, template);
        }),
      );

      // The app's labels, in bold, as the app draws them - never translated.
      const list: HTMLElement = screen.getByTestId("critical-alert-steps-list");
      const bold: Array<string> = Array.from(
        list.querySelectorAll("strong"),
      ).map((label: Element): string => {
        return label.textContent || "";
      });

      const expectedLabels: Array<string> = templates
        .map((template: string): Array<string> => {
          return Array.from(template.matchAll(APP_LABEL_PLACEHOLDER)).map(
            (match: RegExpMatchArray): string => {
              return APP_LABEL_OF[match[1]!]!;
            },
          );
        })
        .flat();

      expect([...bold].sort()).toEqual([...expectedLabels].sort());

      // Nothing left unfilled.
      expect(list.textContent).not.toContain("{{");
    },
  );

  test("what to do once it is on reads in the locale, with the app's alarm path as the app draws it", async () => {
    await inLanguage(language);

    render(
      <PushDeviceCriticalAlertSteps
        deviceName="Pixel 10"
        platform={PushDevicePlatform.Android}
        onClose={() => {}}
      />,
    );

    const note: HTMLElement = screen.getByTestId(
      "critical-alert-steps-once-on",
    );
    const paragraphs: Array<string> = Array.from(
      note.querySelectorAll("p"),
    ).map((paragraph: Element): string => {
      return paragraph.textContent || "";
    });

    for (const english of [
      CRITICAL_ALERT_ONCE_ON,
      CRITICAL_ALERT_HOW_TO_HEAR_IT,
    ]) {
      expect({
        english,
        translated: LOCALES[language]![english] !== english,
      }).toEqual({ english, translated: true });
    }

    expect(paragraphs).toEqual([
      expectedStep(language, CRITICAL_ALERT_ONCE_ON),
      expectedStep(language, CRITICAL_ALERT_HOW_TO_HEAR_IT),
    ]);
    expect(
      Array.from(note.querySelectorAll("strong")).map(
        (label: Element): string => {
          return label.textContent || "";
        },
      ),
    ).toEqual([
      MOBILE_APP_LABELS.settingsTab,
      MOBILE_APP_LABELS.notificationsSection,
      MOBILE_APP_LABELS.alarmSoundRow,
    ]);
  });

  test("a browser's steps name the address the app connects to, unchanged by the locale", async () => {
    await inLanguage(language);

    render(
      <PushDeviceCriticalAlertSteps
        deviceName=""
        platform={PushDevicePlatform.Browser}
        onClose={() => {}}
      />,
    );

    const address: HTMLElement = screen.getByTestId(
      "critical-alert-steps-server-url",
    );

    expect(address.textContent).toBe(getMobileAppServerUrl());
    expect(
      screen
        .getByTestId("critical-alert-steps-list")
        .querySelectorAll("li")[1]!,
    ).toContainElement(address);
  });

  test("the statuses read in the locale", async () => {
    await inLanguage(language);

    render(
      <div>
        <PushDeviceCriticalAlertStatus
          state={CriticalAlertDeviceState.On}
          deviceName="Pixel 10"
        />
        <PushDeviceCriticalAlertStatus
          state={CriticalAlertDeviceState.Off}
          deviceName="iPhone 15 Pro"
          onShowSteps={() => {}}
        />
        <PushDeviceCriticalAlertStatus
          state={CriticalAlertDeviceState.NotAvailable}
          deviceName="Chrome on macOS"
        />
      </div>,
    );

    const [on, off, notAvailable] = screen.getAllByTestId(
      "critical-alert-status",
    );
    const locale: Record<string, string> = LOCALES[language]!;

    expect(within(on!).getByText(locale["On"]!)).toBeInTheDocument();
    expect(
      within(on!).getByText(
        locale["Rings through silent mode and Do Not Disturb"]!,
      ),
    ).toBeInTheDocument();
    expect(within(off!).getByText(locale["Off"]!)).toBeInTheDocument();
    expect(
      within(off!).getByTestId("critical-alert-steps-link"),
    ).toHaveTextContent(locale["How to turn on"]!);
    expect(
      within(off!).getByTestId("critical-alert-steps-link"),
    ).toHaveAccessibleName(
      locale["How to turn on critical alerts on {{deviceName}}"]!.split(
        "{{deviceName}}",
      ).join("iPhone 15 Pro"),
    );
    expect(
      within(notAvailable!).getByText(locale["Not available in browsers"]!),
    ).toBeInTheDocument();

    for (const english of [
      "Rings through silent mode and Do Not Disturb",
      "How to turn on",
      "Not available in browsers",
      "A browser can't ring through silent mode",
    ]) {
      expect({ english, translated: locale[english] !== english }).toEqual({
        english,
        translated: true,
      });
    }
  });
});
