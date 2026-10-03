import {
  MAINTENANCE_ENDS_BEFORE_IT_STARTS_ERROR,
  SUBSCRIBER_NOTIFICATIONS_SECTION_ID,
  SUBSCRIBER_NOTIFICATION_SUMMARIES,
  SUBSCRIBER_NOTIFIED_WHEN_ENDED_KEY,
  SUBSCRIBER_NOTIFIED_WHEN_SCHEDULED_KEY,
  SUBSCRIBER_NOTIFIED_WHEN_STARTED_KEY,
  SUBSCRIBER_REMINDERS_KEY,
  SUBSCRIBER_REMINDERS_SUMMARY,
  getDefaultMaintenanceEndsAt,
  getDefaultMaintenanceStartsAt,
  getMaintenanceEndsAtError,
  getSubscriberNotificationSummary,
  getSubscriberNotificationsSection,
  moveMaintenanceEndWithStart,
  readSubscriberNotificationSettings,
} from "../../FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceForm";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import OneUptimeDate from "Common/Types/Date";
import Timezone from "Common/Types/Timezone";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Scheduling maintenance in three short steps
 * (Components/ScheduledMaintenance/ScheduledMaintenanceForm): what the
 * folded Subscriber Notifications section says, the window a new event
 * starts with, how the end follows the start and when it is refused, and
 * that every word of it is translated. The forms themselves are drawn for
 * real in Common's Tests/App/Dashboard/ScheduledMaintenanceCreateForm.test.tsx
 * and ScheduledMaintenanceTemplateForm.test.tsx.
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

const readLocale: (locale: string) => Record<string, string> = (
  locale: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
};

type Settings = Partial<Record<string, unknown>>;

const withSwitches: (
  scheduled: boolean,
  started: boolean,
  ended: boolean,
  extra?: Settings,
) => Settings = (
  scheduled: boolean,
  started: boolean,
  ended: boolean,
  extra?: Settings,
): Settings => {
  return {
    [SUBSCRIBER_NOTIFIED_WHEN_SCHEDULED_KEY]: scheduled,
    [SUBSCRIBER_NOTIFIED_WHEN_STARTED_KEY]: started,
    [SUBSCRIBER_NOTIFIED_WHEN_ENDED_KEY]: ended,
    ...(extra || {}),
  };
};

describe("the Subscriber Notifications line", () => {
  test("names the event's three switches by the columns they write", () => {
    const model: ScheduledMaintenance = new ScheduledMaintenance();

    for (const key of [
      SUBSCRIBER_NOTIFIED_WHEN_SCHEDULED_KEY,
      SUBSCRIBER_NOTIFIED_WHEN_STARTED_KEY,
      SUBSCRIBER_NOTIFIED_WHEN_ENDED_KEY,
      SUBSCRIBER_REMINDERS_KEY,
    ]) {
      expect(`${key}: ${model.hasColumn(key)}`).toBe(`${key}: true`);
    }
  });

  test("says the default in one sentence: notified when it is scheduled, starts and ends", () => {
    expect(getSubscriberNotificationSummary({})).toEqual([
      "Subscribers of the event's status pages are notified when it is scheduled, when it starts and when it ends.",
    ]);
  });

  test("reads a switch nobody has set as on, as the column's default does", () => {
    expect(readSubscriberNotificationSettings(undefined)).toEqual({
      whenScheduled: true,
      whenStarted: true,
      whenEnded: true,
      hasReminders: false,
    });
    expect(
      readSubscriberNotificationSettings({
        [SUBSCRIBER_NOTIFIED_WHEN_STARTED_KEY]: null,
      }).whenStarted,
    ).toBe(true);
    expect(
      readSubscriberNotificationSettings({
        [SUBSCRIBER_NOTIFIED_WHEN_STARTED_KEY]: false,
      }).whenStarted,
    ).toBe(false);
  });

  test("has a whole sentence for every combination of the switches", () => {
    const cases: Array<[boolean, boolean, boolean, string]> = [
      [
        true,
        true,
        true,
        "Subscribers of the event's status pages are notified when it is scheduled, when it starts and when it ends.",
      ],
      [
        true,
        true,
        false,
        "Subscribers of the event's status pages are notified when it is scheduled and when it starts.",
      ],
      [
        true,
        false,
        true,
        "Subscribers of the event's status pages are notified when it is scheduled and when it ends.",
      ],
      [
        false,
        true,
        true,
        "Subscribers of the event's status pages are notified when it starts and when it ends.",
      ],
      [
        true,
        false,
        false,
        "Subscribers of the event's status pages are notified when it is scheduled.",
      ],
      [
        false,
        true,
        false,
        "Subscribers of the event's status pages are notified when it starts.",
      ],
      [
        false,
        false,
        true,
        "Subscribers of the event's status pages are notified when it ends.",
      ],
      [
        false,
        false,
        false,
        "Subscribers of the event's status pages are not notified when it is scheduled, starts or ends.",
      ],
    ];

    const seen: Set<string> = new Set();

    for (const [scheduled, started, ended, sentence] of cases) {
      expect(
        getSubscriberNotificationSummary(
          withSwitches(scheduled, started, ended),
        ),
      ).toEqual([sentence]);
      seen.add(sentence);
    }

    // One sentence each, and the table holds no others.
    expect(seen.size).toBe(8);
    expect(new Set(Object.values(SUBSCRIBER_NOTIFICATION_SUMMARIES))).toEqual(
      seen,
    );
  });

  test("adds a sentence about reminders when there are any, whatever the switches say", () => {
    const reminders: Settings = {
      [SUBSCRIBER_REMINDERS_KEY]: [{ intervalType: "Day", intervalCount: 1 }],
    };

    expect(
      getSubscriberNotificationSummary(
        withSwitches(true, true, true, reminders),
      ),
    ).toEqual([
      SUBSCRIBER_NOTIFICATION_SUMMARIES["scheduled,started,ended"],
      SUBSCRIBER_REMINDERS_SUMMARY,
    ]);
    // Quiet otherwise, the reminders still go out; the line says so.
    expect(
      getSubscriberNotificationSummary(
        withSwitches(false, false, false, reminders),
      ),
    ).toEqual([
      SUBSCRIBER_NOTIFICATION_SUMMARIES[""],
      SUBSCRIBER_REMINDERS_SUMMARY,
    ]);
    // An empty list is no reminder.
    expect(
      getSubscriberNotificationSummary({ [SUBSCRIBER_REMINDERS_KEY]: [] }),
    ).toHaveLength(1);
  });

  test("is the section's line, on a section that opens when something is set", () => {
    const section: FormFieldCollapsibleSection<ScheduledMaintenance> =
      getSubscriberNotificationsSection<ScheduledMaintenance>();

    expect(section.id).toBe(SUBSCRIBER_NOTIFICATIONS_SECTION_ID);
    expect(section.title).toBe("Subscriber Notifications");
    // Not an Advanced section: one set away from the default opens itself.
    expect(section.openWhenConfigured).toBeUndefined();
    expect(section.isConfigured).toBeUndefined();
    expect(
      section.getSummary!(
        withSwitches(true, false, true) as FormValues<ScheduledMaintenance>,
      ),
    ).toEqual([SUBSCRIBER_NOTIFICATION_SUMMARIES["scheduled,ended"]]);
  });
});

describe("a new event's window", () => {
  beforeEach(() => {
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-10-03T09:20:00.000Z"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    OneUptimeDate.setUserTimezone(null);
  });

  test("starts at the next full hour of the reader's clock, held as the date input holds it", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    expect(getDefaultMaintenanceStartsAt()).toBe("2026-10-03T10:00:00.000Z");

    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    // 14:50 in Kolkata: its next full hour, 15:00, is 09:30 UTC.
    expect(getDefaultMaintenanceStartsAt()).toBe("2026-10-03T09:30:00.000Z");
  });

  test("ends an hour after the start the form holds", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    expect(
      getDefaultMaintenanceEndsAt({ startsAt: "2026-10-03T10:00:00.000Z" }),
    ).toBe("2026-10-03T11:00:00.000Z");
    // A template's own start wins over the next full hour.
    expect(
      getDefaultMaintenanceEndsAt({ startsAt: "2026-12-24T22:00:00.000Z" }),
    ).toBe("2026-12-24T23:00:00.000Z");
    // No start yet: an hour after the next full hour.
    expect(getDefaultMaintenanceEndsAt({})).toBe("2026-10-03T11:00:00.000Z");
    expect(getDefaultMaintenanceEndsAt(undefined)).toBe(
      "2026-10-03T11:00:00.000Z",
    );
  });
});

describe("the end of the window", () => {
  test("must come after the start", () => {
    expect(
      getMaintenanceEndsAtError({
        startsAt: "2026-10-03T10:00:00.000Z",
        endsAt: "2026-10-03T09:59:00.000Z",
      }),
    ).toBe(MAINTENANCE_ENDS_BEFORE_IT_STARTS_ERROR);
    expect(
      getMaintenanceEndsAtError({
        startsAt: "2026-10-03T10:00:00.000Z",
        endsAt: "2026-10-03T10:00:00.000Z",
      }),
    ).toBe("Ends At must be after Starts At.");
    expect(
      getMaintenanceEndsAtError({
        startsAt: "2026-10-03T10:00:00.000Z",
        endsAt: "2026-10-03T10:01:00.000Z",
      }),
    ).toBe(null);
  });

  test("leaves a missing time to the field's own required check", () => {
    expect(
      getMaintenanceEndsAtError({ endsAt: "2026-10-03T09:00:00.000Z" }),
    ).toBe(null);
    expect(getMaintenanceEndsAtError({})).toBe(null);
    expect(getMaintenanceEndsAtError(null)).toBe(null);
  });

  test("moves with the start, once the form has written the start", async () => {
    const written: Array<Record<string, unknown>> = [];

    moveMaintenanceEndWithStart<ScheduledMaintenance>(
      "2026-10-04T10:00:00.000Z",
      // A form holds its dates as the ISO strings the date input writes.
      {
        title: "Database upgrade",
        startsAt: "2026-10-03T10:00:00.000Z",
        endsAt: "2026-10-03T11:30:00.000Z",
      } as unknown as FormValues<ScheduledMaintenance>,
      (values: FormValues<ScheduledMaintenance>): void => {
        written.push(values as Record<string, unknown>);
      },
    );

    // Not now: FormField writes the start right after this returns.
    expect(written).toEqual([]);
    await Promise.resolve();

    expect(written).toEqual([
      {
        title: "Database upgrade",
        startsAt: "2026-10-04T10:00:00.000Z",
        endsAt: "2026-10-04T11:30:00.000Z",
      },
    ]);
  });

  test("stays where it is when the start did not move or is not a time", async () => {
    const written: Array<unknown> = [];
    const write: (values: FormValues<ScheduledMaintenance>) => void = (
      values: FormValues<ScheduledMaintenance>,
    ): void => {
      written.push(values);
    };
    const current: FormValues<ScheduledMaintenance> = {
      startsAt: "2026-10-03T10:00:00.000Z",
      endsAt: "2026-10-03T11:00:00.000Z",
    } as unknown as FormValues<ScheduledMaintenance>;

    moveMaintenanceEndWithStart<ScheduledMaintenance>(
      "2026-10-03T10:00:00.000Z",
      current,
      write,
    );
    moveMaintenanceEndWithStart<ScheduledMaintenance>("", current, write);
    moveMaintenanceEndWithStart<ScheduledMaintenance>(
      "2026-10-04T10:00:00.000Z",
      {} as FormValues<ScheduledMaintenance>,
      write,
    );
    await Promise.resolve();

    expect(written).toEqual([]);
  });
});

describe("its words", () => {
  // Every string these forms added, and the template question whose typo was fixed.
  const NEW_STRINGS: Array<string> = [
    ...Object.values(SUBSCRIBER_NOTIFICATION_SUMMARIES),
    SUBSCRIBER_REMINDERS_SUMMARY,
    MAINTENANCE_ENDS_BEFORE_IT_STARTS_ERROR,
    "Notify & more",
    "When the event is scheduled",
    "When the event starts",
    "When the event ends",
    "Reminders before the event",
    "Remind subscribers before the event starts, for example 1 day before.",
    "When the subscribers of the event's status pages hear about it.",
    "Subscriber Notifications",
    "How often should this event recur?",
  ];

  test("are in en.json", () => {
    const english: Record<string, string> = readLocale("en");

    for (const text of NEW_STRINGS) {
      expect(`${text}: ${english[text]}`).toBe(`${text}: ${text}`);
    }
  });

  test("are translated in every other locale", () => {
    for (const locale of OTHER_LOCALES) {
      const translations: Record<string, string> = readLocale(locale);

      for (const text of NEW_STRINGS) {
        const translation: string | undefined = translations[text];

        expect(`${locale} ${text}: ${Boolean(translation)}`).toBe(
          `${locale} ${text}: true`,
        );
        expect(`${locale} ${text}: ${translation !== text}`).toBe(
          `${locale} ${text}: true`,
        );
      }
    }
  });

  test("keep the old template question's translations for the fixed one", () => {
    for (const locale of OTHER_LOCALES) {
      const translations: Record<string, string> = readLocale(locale);

      expect(translations["How often should this event recur?"]).toBe(
        translations["How often would you this event to recur?"],
      );
    }
  });
});
