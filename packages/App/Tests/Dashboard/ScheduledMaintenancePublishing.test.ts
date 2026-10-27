import {
  PUBLISHING_SUMMARIES,
  PUBLISH_AT_NOT_BEFORE_START_ERROR,
  PUBLISH_CHOICE,
  PUBLISH_CHOICE_KEY,
  PublishChoice,
  PublishingCopy,
  PublishingDetailCopy,
  PublishingNoticeCopy,
  SENT_WHEN_PUBLISHED_TEXT,
  SHOWS_FROM_TEXT,
  areSubscribersToldWhenPublished,
  getPublishAtError,
  getPublishAtInForm,
  getPublishingSummary,
  getWaitingPublishAt,
  isPublishingAtATime,
  isScheduledNotificationWaitingToPublish,
} from "../../FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenancePublishing";
import {
  EVENT_SUBSCRIBER_NOTIFICATIONS_DESCRIPTION,
  SUBSCRIBER_NOTIFICATIONS_SECTION_ID,
  SUBSCRIBER_NOTIFICATION_SUMMARIES,
  getEventSubscriberNotificationsSection,
  getSubscriberNotificationsSection,
} from "../../FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceForm";
import {
  getColumnChoiceInForm,
  getValuesForColumnChoice,
} from "../../FeatureSet/Dashboard/src/Utils/Form/ColumnChoice";
import { SCHEDULED_MAINTENANCE_WAITING_TO_PUBLISH_DESCRIPTION } from "../../FeatureSet/Dashboard/src/Components/StatusPageVisibility/StatusPageVisibilitySwitchCopy";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import OneUptimeDate from "Common/Types/Date";
import { PUBLISH_ON_STATUS_PAGE_AT_COLUMN } from "Common/Types/ScheduledMaintenance/ScheduledMaintenancePublication";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import Timezone from "Common/Types/Timezone";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Publishing a scheduled maintenance event at a chosen time (#5249), as the
 * dashboard asks it (Components/ScheduledMaintenance/
 * ScheduledMaintenancePublishing): the folded Publishing section's question
 * and the column its answer writes, the line it shows folded, in the
 * reader's timezone, when Publish At is refused, what the event's page says
 * while it waits - and that every word of it is translated. The forms and
 * the page are drawn for real in Common's Tests/App/Dashboard/
 * ScheduledMaintenancePublishingForms.test.tsx.
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

// The customer's example: created on 1 October, published on 24 November, done on 1 December.
const CREATED_ON: Date = new Date("2026-10-01T08:00:00.000Z");
const PUBLISH_AT: Date = new Date("2026-11-24T09:00:00.000Z");
const STARTS_AT: Date = new Date("2026-12-01T02:00:00.000Z");

afterEach(() => {
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("the Publishing question", () => {
  test("is one question with two plain answers, Right away first", () => {
    expect(PUBLISH_CHOICE.key).toBe(PUBLISH_CHOICE_KEY);
    expect(PUBLISH_CHOICE.title).toBe("Publish on Status Pages");
    expect(
      PUBLISH_CHOICE.options.map(
        (option: { value: PublishChoice; title: string }) => {
          return [option.value, option.title];
        },
      ),
    ).toEqual([
      [PublishChoice.RightAway, "Right away"],
      [PublishChoice.AtATime, "At a date and time"],
    ]);

    for (const option of PUBLISH_CHOICE.options) {
      // Each answer says what it means, in a sentence.
      expect(option.description).toMatch(/\.$/);
    }
  });

  test("stands for one column of the model, which the API can write too", () => {
    const model: ScheduledMaintenance = new ScheduledMaintenance();

    expect(model.hasColumn(PUBLISH_ON_STATUS_PAGE_AT_COLUMN)).toBe(true);
    // The form-only value is no column: it is never sent.
    expect(model.hasColumn(PUBLISH_CHOICE_KEY)).toBe(false);
  });

  test("reads Right away for an event with no publish time - a new one, or one published from the start", () => {
    for (const publishOnStatusPageAt of [undefined, null, ""]) {
      expect(
        getColumnChoiceInForm(PUBLISH_CHOICE, { publishOnStatusPageAt }),
      ).toBe(PublishChoice.RightAway);
    }
  });

  test("reads At a date and time for an event with one, an ISO string or a Date", () => {
    for (const publishOnStatusPageAt of [
      PUBLISH_AT,
      PUBLISH_AT.toISOString(),
    ]) {
      expect(
        getColumnChoiceInForm(PUBLISH_CHOICE, { publishOnStatusPageAt }),
      ).toBe(PublishChoice.AtATime);
    }
  });

  test("Right away clears the publish time; At a date and time keeps what the form holds", () => {
    const rightAway: Record<string, unknown> = getValuesForColumnChoice({
      config: PUBLISH_CHOICE,
      values: { title: "Database upgrade", publishOnStatusPageAt: PUBLISH_AT },
      choice: PublishChoice.RightAway,
    });

    expect(rightAway["publishOnStatusPageAt"]).toBeNull();
    expect(rightAway[PUBLISH_CHOICE_KEY]).toBe(PublishChoice.RightAway);
    expect(rightAway["title"]).toBe("Database upgrade");

    const atATime: Record<string, unknown> = getValuesForColumnChoice({
      config: PUBLISH_CHOICE,
      values: { publishOnStatusPageAt: PUBLISH_AT },
      choice: PublishChoice.AtATime,
    });

    expect(atATime["publishOnStatusPageAt"]).toBe(PUBLISH_AT);
    expect(atATime[PUBLISH_CHOICE_KEY]).toBe(PublishChoice.AtATime);
  });

  test("picked At a date and time with no time yet, the form asks for one: the answer stays picked", () => {
    const values: Record<string, unknown> = getValuesForColumnChoice({
      config: PUBLISH_CHOICE,
      values: { publishOnStatusPageAt: null },
      choice: PublishChoice.AtATime,
    });

    expect(isPublishingAtATime(values)).toBe(true);
    expect(getPublishAtInForm(values)).toBeNull();
  });

  test("switching back and forth loses nothing but what Right away clears", () => {
    let values: Record<string, unknown> = { publishOnStatusPageAt: null };

    values = getValuesForColumnChoice({
      config: PUBLISH_CHOICE,
      values,
      choice: PublishChoice.AtATime,
    });
    values = { ...values, publishOnStatusPageAt: PUBLISH_AT.toISOString() };

    expect(getPublishAtInForm(values)?.toISOString()).toBe(
      PUBLISH_AT.toISOString(),
    );

    values = getValuesForColumnChoice({
      config: PUBLISH_CHOICE,
      values,
      choice: PublishChoice.RightAway,
    });

    expect(isPublishingAtATime(values)).toBe(false);
    expect(getPublishAtInForm(values)).toBeNull();
    expect(values["publishOnStatusPageAt"]).toBeNull();
  });
});

describe("the folded Publishing line", () => {
  test("by default: shown as soon as it is saved", () => {
    expect(getPublishingSummary({}, CREATED_ON)).toBe(
      PUBLISHING_SUMMARIES.rightAway,
    );
    expect(PUBLISHING_SUMMARIES.rightAway).toBe(
      "Shown on its status pages as soon as it is saved.",
    );
  });

  test("with a time still to come: shown from then, in the reader's timezone", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    const summary: string = getPublishingSummary(
      { publishOnStatusPageAt: PUBLISH_AT },
      CREATED_ON,
    );

    expect(summary).toBe(
      `Shown on its status pages from ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(PUBLISH_AT)}.`,
    );
    expect(summary).toContain("09:00");
  });

  test("the same instant reads in another reader's timezone as their own clock says it", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    const inUtc: string = getPublishingSummary(
      { publishOnStatusPageAt: PUBLISH_AT },
      CREATED_ON,
    );

    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    const inIndia: string = getPublishingSummary(
      { publishOnStatusPageAt: PUBLISH_AT },
      CREATED_ON,
    );

    // 09:00 UTC is half past two in the afternoon in India.
    expect(inIndia).toContain("02:30 PM");
    expect(inIndia).toContain("IST");
    expect(inIndia).not.toContain("09:00");
    expect(inUtc).toContain("09:00 AM");
    expect(inIndia).not.toBe(inUtc);
  });

  test("with a time that has passed: shown since then", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    expect(
      getPublishingSummary({ publishOnStatusPageAt: PUBLISH_AT }, STARTS_AT),
    ).toBe(
      `Shown on its status pages since ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(PUBLISH_AT)}.`,
    );
  });

  test("exactly at its time it is shown, as the server decides", () => {
    expect(
      getPublishingSummary(
        { publishOnStatusPageAt: PUBLISH_AT },
        new Date(PUBLISH_AT),
      ),
    ).toMatch(/^Shown on its status pages since /);
  });

  test("At a date and time picked, no time yet: from the time still to be picked", () => {
    expect(
      getPublishingSummary(
        { [PUBLISH_CHOICE_KEY]: PublishChoice.AtATime },
        CREATED_ON,
      ),
    ).toBe(PUBLISHING_SUMMARIES.atTheTimePicked);
  });

  test("Right away picked over a stored time says right away", () => {
    expect(
      getPublishingSummary(
        {
          [PUBLISH_CHOICE_KEY]: PublishChoice.RightAway,
          publishOnStatusPageAt: PUBLISH_AT,
        },
        CREATED_ON,
      ),
    ).toBe(PUBLISHING_SUMMARIES.rightAway);
  });

  /*
   * On Create the question is the first of the folded Subscriber
   * Notifications - publishing is when their subscribers are told it is
   * scheduled - and the section's line starts with when the event shows.
   */
  test("is the first sentence of the event's Subscriber Notifications line, before who is told", () => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(CREATED_ON);
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    const section: FormFieldCollapsibleSection<ScheduledMaintenance> =
      getEventSubscriberNotificationsSection<ScheduledMaintenance>();

    expect(section.id).toBe(SUBSCRIBER_NOTIFICATIONS_SECTION_ID);
    expect(section.title).toBe("Subscriber Notifications");
    expect(section.description).toBe(EVENT_SUBSCRIBER_NOTIFICATIONS_DESCRIPTION);

    expect(
      section.getSummary!({} as FormValues<ScheduledMaintenance>),
    ).toEqual([
      PUBLISHING_SUMMARIES.rightAway,
      SUBSCRIBER_NOTIFICATION_SUMMARIES["scheduled,started,ended"],
    ]);

    expect(
      section.getSummary!({
        publishOnStatusPageAt: PUBLISH_AT,
        shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: false,
      } as FormValues<ScheduledMaintenance>),
    ).toEqual([
      `Shown on its status pages from ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(PUBLISH_AT)}.`,
      SUBSCRIBER_NOTIFICATION_SUMMARIES["scheduled,started"],
    ]);
  });

  test("a template's section, published nowhere, says nothing of publishing", () => {
    const section: FormFieldCollapsibleSection<ScheduledMaintenance> =
      getSubscriberNotificationsSection<ScheduledMaintenance>();

    expect(section.title).toBe("Subscriber Notifications");
    expect(
      section.getSummary!({} as FormValues<ScheduledMaintenance>),
    ).toEqual([SUBSCRIBER_NOTIFICATION_SUMMARIES["scheduled,started,ended"]]);
  });
});

describe("Publish At's own check", () => {
  test("a time before the event starts is fine", () => {
    expect(
      getPublishAtError({
        publishOnStatusPageAt: PUBLISH_AT,
        startsAt: STARTS_AT,
      }),
    ).toBeNull();
  });

  test("a time at or after the start is refused: tell customers ahead of the work", () => {
    for (const publishOnStatusPageAt of [
      STARTS_AT,
      new Date(STARTS_AT.getTime() + 60 * 60 * 1000),
    ]) {
      expect(
        getPublishAtError({ publishOnStatusPageAt, startsAt: STARTS_AT }),
      ).toBe(PUBLISH_AT_NOT_BEFORE_START_ERROR);
    }
  });

  test("compares instants: a start written in another zone, or as text, is the same moment", () => {
    expect(
      getPublishAtError({
        publishOnStatusPageAt: "2026-12-01T07:30:00+05:30",
        startsAt: STARTS_AT.toISOString(),
      }),
    ).toBe(PUBLISH_AT_NOT_BEFORE_START_ERROR);
    expect(
      getPublishAtError({
        publishOnStatusPageAt: "2026-12-01T07:29:00+05:30",
        startsAt: STARTS_AT.toISOString(),
      }),
    ).toBeNull();
  });

  test("nothing to check: Right away, no time yet, or no start", () => {
    expect(
      getPublishAtError({
        [PUBLISH_CHOICE_KEY]: PublishChoice.RightAway,
        publishOnStatusPageAt: STARTS_AT,
        startsAt: STARTS_AT,
      }),
    ).toBeNull();
    expect(
      getPublishAtError({
        [PUBLISH_CHOICE_KEY]: PublishChoice.AtATime,
        startsAt: STARTS_AT,
      }),
    ).toBeNull();
    expect(getPublishAtError({ publishOnStatusPageAt: STARTS_AT })).toBeNull();
  });
});

describe("the event's page while it waits", () => {
  function waitingEvent(overrides?: Record<string, unknown>): Record<
    string,
    unknown
  > {
    return {
      isVisibleOnStatusPage: true,
      publishOnStatusPageAt: PUBLISH_AT,
      statusPages: [{ _id: "a" }],
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
      subscriberNotificationStatusOnEventScheduled:
        StatusPageSubscriberNotificationStatus.Pending,
      ...(overrides || {}),
    };
  }

  test("says it is not on its status pages yet, and from when", () => {
    expect(getWaitingPublishAt(waitingEvent(), CREATED_ON)?.toISOString()).toBe(
      PUBLISH_AT.toISOString(),
    );
  });

  test("says nothing once its time has come, while it is hidden, or with no status page to show it on", () => {
    expect(getWaitingPublishAt(waitingEvent(), PUBLISH_AT)).toBeNull();
    expect(
      getWaitingPublishAt(
        waitingEvent({ isVisibleOnStatusPage: false }),
        CREATED_ON,
      ),
    ).toBeNull();
    expect(
      getWaitingPublishAt(waitingEvent({ statusPages: [] }), CREATED_ON),
    ).toBeNull();
    expect(
      getWaitingPublishAt(
        waitingEvent({ publishOnStatusPageAt: null }),
        CREATED_ON,
      ),
    ).toBeNull();
    expect(getWaitingPublishAt(null, CREATED_ON)).toBeNull();
  });

  test("names the subscribers only when they are told it is scheduled", () => {
    expect(areSubscribersToldWhenPublished(waitingEvent())).toBe(true);
    // A switch never set is on, as on the model.
    expect(
      areSubscribersToldWhenPublished(
        waitingEvent({
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: undefined,
        }),
      ),
    ).toBe(true);
    expect(
      areSubscribersToldWhenPublished(
        waitingEvent({
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
        }),
      ),
    ).toBe(false);
    expect(
      areSubscribersToldWhenPublished(
        waitingEvent({
          subscriberNotificationStatusOnEventScheduled:
            StatusPageSubscriberNotificationStatus.Skipped,
        }),
      ),
    ).toBe(false);
    expect(areSubscribersToldWhenPublished(null)).toBe(false);
  });

  test("its subscriber notification, queued until then, is sent when it is published - not Sending Soon", () => {
    expect(
      isScheduledNotificationWaitingToPublish(waitingEvent(), CREATED_ON),
    ).toBe(true);
    expect(
      isScheduledNotificationWaitingToPublish(waitingEvent(), PUBLISH_AT),
    ).toBe(false);
    expect(
      isScheduledNotificationWaitingToPublish(
        waitingEvent({
          subscriberNotificationStatusOnEventScheduled:
            StatusPageSubscriberNotificationStatus.Success,
        }),
        CREATED_ON,
      ),
    ).toBe(false);
    expect(
      isScheduledNotificationWaitingToPublish(
        waitingEvent({ publishOnStatusPageAt: null }),
        CREATED_ON,
      ),
    ).toBe(false);
  });
});

describe("the words", () => {
  const SENTENCES: Array<string> = [
    EVENT_SUBSCRIBER_NOTIFICATIONS_DESCRIPTION,
    PublishingCopy.question,
    PublishingCopy.rightAway,
    PublishingCopy.rightAwayDescription,
    PublishingCopy.atATime,
    PublishingCopy.atATimeDescription,
    PublishingCopy.publishAtTitle,
    PublishingCopy.publishAtPlaceholder,
    PUBLISHING_SUMMARIES.rightAway,
    PUBLISHING_SUMMARIES.from,
    PUBLISHING_SUMMARIES.since,
    PUBLISHING_SUMMARIES.atTheTimePicked,
    PUBLISH_AT_NOT_BEFORE_START_ERROR,
    PublishingNoticeCopy.title,
    PublishingNoticeCopy.showsFrom,
    PublishingNoticeCopy.showsFromAndTold,
    PublishingNoticeCopy.publishNow,
    PublishingNoticeCopy.confirmTitle,
    PublishingNoticeCopy.confirmDescription,
    PublishingNoticeCopy.confirmDescriptionAndTold,
    PublishingNoticeCopy.noPermission,
    PublishingDetailCopy.title,
    SHOWS_FROM_TEXT,
    SENT_WHEN_PUBLISHED_TEXT,
    SCHEDULED_MAINTENANCE_WAITING_TO_PUBLISH_DESCRIPTION,
  ];

  test("are Dashboard locale keys", () => {
    const english: Record<string, string> = readLocale("en");

    for (const sentence of SENTENCES) {
      expect({ sentence, isKey: english[sentence] === sentence }).toEqual({
        sentence,
        isKey: true,
      });
    }
  });

  test("are translated in every other locale, each time placeholder kept", () => {
    for (const locale of OTHER_LOCALES) {
      const translations: Record<string, string> = readLocale(locale);

      for (const sentence of SENTENCES) {
        const translation: string | undefined = translations[sentence];

        expect({
          locale,
          sentence,
          isTranslated: Boolean(translation) && translation !== sentence,
          keepsTime:
            (translation || "").includes("{{time}}") ===
            sentence.includes("{{time}}"),
        }).toEqual({
          locale,
          sentence,
          isTranslated: true,
          keepsTime: true,
        });
      }
    }
  });

  test("the details row and the question are one label, and Right away the dashboard's own", () => {
    expect(PublishingDetailCopy.title).toBe(PublishingCopy.question);
    expect(PublishingDetailCopy.rightAway).toBe(PublishingCopy.rightAway);
  });
});
