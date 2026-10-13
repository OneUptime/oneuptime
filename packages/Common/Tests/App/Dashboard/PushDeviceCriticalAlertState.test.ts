import { describe, expect, test } from "@jest/globals";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import {
  CRITICAL_ALERT_HOW_TO_HEAR_IT,
  CRITICAL_ALERT_ONCE_ON,
  CRITICAL_ALERT_STEPS,
  CRITICAL_ALERT_TROUBLESHOOTING,
  CriticalAlertDeviceState,
  MOBILE_APP_LABELS,
  PUSH_DEVICE_PLATFORM_LABELS,
  PushDevicePlatform,
  getCriticalAlertDeviceState,
  getPushDevicePlatform,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/PushDeviceCriticalAlerts";

/*
 * What the push devices card decides about a device's critical alerts
 * (Components/NotificationMethods/PushDeviceCriticalAlerts): what kind of
 * device it is, which state its Critical Alerts column shows, and the
 * sentences its steps are built from. The card itself is rendered in
 * PushDevicesCriticalAlerts.test.tsx; the steps are held to the mobile app's
 * source in App/Tests/Dashboard/PushDeviceCriticalAlertsMatchMobileApp.
 */

// The placeholders the steps dialog draws (PushDeviceCriticalAlertSteps).
const DIALOG_SLOTS: Array<string> = [
  "app",
  "settings",
  "notifications",
  "criticalAlerts",
  "alarmSoundPath",
  "appStore",
  "googlePlay",
];

const PLACEHOLDER: RegExp = /\{\{\s*([^{}]+?)\s*\}\}/g;

function placeholdersOf(template: string): Array<string> {
  return Array.from(template.matchAll(PLACEHOLDER)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

const ALL_SENTENCES: Array<string> = [
  ...Object.values(CRITICAL_ALERT_STEPS).flat(),
  ...Object.values(CRITICAL_ALERT_TROUBLESHOOTING).flat(),
  CRITICAL_ALERT_ONCE_ON,
  CRITICAL_ALERT_HOW_TO_HEAR_IT,
];

describe("what kind of device it is", () => {
  test("an iPhone or iPad, an Android phone, or a browser", () => {
    expect(getPushDevicePlatform(PushDeviceType.iOS)).toBe(
      PushDevicePlatform.IOS,
    );
    expect(getPushDevicePlatform(PushDeviceType.Android)).toBe(
      PushDevicePlatform.Android,
    );
    expect(getPushDevicePlatform(PushDeviceType.Web)).toBe(
      PushDevicePlatform.Browser,
    );
  });

  test("a row read without its type is taken for a browser, never for a phone", () => {
    expect(getPushDevicePlatform(undefined)).toBe(PushDevicePlatform.Browser);
    expect(getPushDevicePlatform(null)).toBe(PushDevicePlatform.Browser);
    expect(getPushDevicePlatform("")).toBe(PushDevicePlatform.Browser);
    // Not case-folded into a phone either: the server stores the exact value.
    expect(getPushDevicePlatform("IOS")).toBe(PushDevicePlatform.Browser);
    expect(getPushDevicePlatform("windows-phone")).toBe(
      PushDevicePlatform.Browser,
    );
  });

  test("every kind has the words the card draws under a device's name", () => {
    expect(PUSH_DEVICE_PLATFORM_LABELS).toEqual({
      [PushDevicePlatform.IOS]: "iPhone or iPad",
      [PushDevicePlatform.Android]: "Android phone",
      [PushDevicePlatform.Browser]: "Web browser",
    });
  });
});

describe("the state the Critical Alerts column shows", () => {
  const TYPES: Array<unknown> = [
    PushDeviceType.iOS,
    PushDeviceType.Android,
    PushDeviceType.Web,
    undefined,
  ];
  const VERIFIED: Array<boolean | undefined> = [true, false, undefined];
  const ENABLED: Array<boolean | undefined> = [true, false, undefined];

  test("every combination of type, receiving and switch", () => {
    const rows: Array<string> = [];

    for (const deviceType of TYPES) {
      for (const isVerified of VERIFIED) {
        for (const isCriticalAlertEnabled of ENABLED) {
          rows.push(
            [
              String(deviceType),
              String(isVerified),
              String(isCriticalAlertEnabled),
              getCriticalAlertDeviceState({
                deviceType,
                isVerified,
                isCriticalAlertEnabled,
              }),
            ].join(" "),
          );
        }
      }
    }

    expect(rows).toEqual([
      // An iPhone: nothing reaches a dead one; otherwise its switch.
      "ios true true on",
      "ios true false off",
      "ios true undefined off",
      "ios false true not-receiving",
      "ios false false not-receiving",
      "ios false undefined not-receiving",
      "ios undefined true on",
      "ios undefined false off",
      "ios undefined undefined off",
      // An Android phone: the same.
      "android true true on",
      "android true false off",
      "android true undefined off",
      "android false true not-receiving",
      "android false false not-receiving",
      "android false undefined not-receiving",
      "android undefined true on",
      "android undefined false off",
      "android undefined undefined off",
      // A browser can never have them, receiving or not, whatever is stored.
      "web true true not-available",
      "web true false not-available",
      "web true undefined not-available",
      "web false true not-available",
      "web false false not-available",
      "web false undefined not-available",
      "web undefined true not-available",
      "web undefined false not-available",
      "web undefined undefined not-available",
      // A row read without its type: a browser, as above.
      "undefined true true not-available",
      "undefined true false not-available",
      "undefined true undefined not-available",
      "undefined false true not-available",
      "undefined false false not-available",
      "undefined false undefined not-available",
      "undefined undefined true not-available",
      "undefined undefined false not-available",
      "undefined undefined undefined not-available",
    ]);
  });

  test("On is only ever a phone that receives notifications and turned them on", () => {
    expect(
      getCriticalAlertDeviceState({
        deviceType: PushDeviceType.Android,
        isVerified: true,
        isCriticalAlertEnabled: true,
      }),
    ).toBe(CriticalAlertDeviceState.On);
    expect(
      getCriticalAlertDeviceState({
        deviceType: PushDeviceType.Android,
        isVerified: false,
        isCriticalAlertEnabled: true,
      }),
    ).not.toBe(CriticalAlertDeviceState.On);
  });
});

describe("the sentences the steps are built from", () => {
  test("each platform has its steps: iOS three, Android four, a browser three", () => {
    expect(CRITICAL_ALERT_STEPS[PushDevicePlatform.IOS]).toHaveLength(3);
    expect(CRITICAL_ALERT_STEPS[PushDevicePlatform.Android]).toHaveLength(4);
    expect(CRITICAL_ALERT_STEPS[PushDevicePlatform.Browser]).toHaveLength(3);
  });

  test("Android's last step turns the switch on again, iOS's allows the prompt", () => {
    expect(
      CRITICAL_ALERT_STEPS[PushDevicePlatform.Android][3],
    ).toBe("Go back to the app and turn on {{criticalAlerts}} again.");
    expect(CRITICAL_ALERT_STEPS[PushDevicePlatform.IOS][2]).toBe(
      "When iOS asks whether {{app}} may send critical alerts, tap Allow.",
    );
  });

  test("a browser's steps link both stores", () => {
    expect(placeholdersOf(CRITICAL_ALERT_STEPS[PushDevicePlatform.Browser][0]!))
      .toEqual(["app", "appStore", "googlePlay"]);
  });

  test("a browser has nothing to troubleshoot: it never turns them on", () => {
    expect(CRITICAL_ALERT_TROUBLESHOOTING[PushDevicePlatform.Browser]).toEqual(
      [],
    );
    expect(CRITICAL_ALERT_TROUBLESHOOTING[PushDevicePlatform.IOS]).toHaveLength(
      2,
    );
    expect(
      CRITICAL_ALERT_TROUBLESHOOTING[PushDevicePlatform.Android],
    ).toHaveLength(1);
  });

  test("every sentence names only placeholders the dialog draws", () => {
    for (const sentence of ALL_SENTENCES) {
      for (const name of placeholdersOf(sentence)) {
        expect({ sentence, name, drawn: DIALOG_SLOTS.includes(name) }).toEqual({
          sentence,
          name,
          drawn: true,
        });
      }
    }
  });

  test("the app's labels are placeholders, never words a translation could change", () => {
    const labels: Array<string> = Object.values(MOBILE_APP_LABELS);

    for (const sentence of ALL_SENTENCES) {
      for (const label of labels) {
        // "Settings" and "Notifications" are also ordinary English words of
        // the OS's own screens, which a translation should translate.
        if (label === "Settings" || label === "Notifications") {
          continue;
        }

        expect({ sentence, label, written: sentence.includes(label) }).toEqual(
          { sentence, label, written: false },
        );
      }
    }
  });

  test("no step is said twice within a platform", () => {
    for (const steps of Object.values(CRITICAL_ALERT_STEPS)) {
      expect(new Set(steps).size).toBe(steps.length);
    }
  });

  test("the app's labels are the app's, as its screens draw them", () => {
    expect(MOBILE_APP_LABELS).toEqual({
      appName: "OneUptime On-Call",
      settingsTab: "Settings",
      notificationsSection: "Notifications",
      criticalAlertsSwitch: "Critical On-Call Alerts",
      alarmSoundRow: "Alarm sound",
    });
  });
});
