import {
  SUBSCRIBER_NOTIFICATION_SUMMARIES,
  SUBSCRIBER_REMINDERS_KEY,
  SUBSCRIBER_REMINDERS_SUMMARY,
} from "../../FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceForm";
import {
  MAINTENANCE_NOTIFICATIONS_DEPEND_ON_PAGES,
  MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED,
  MAINTENANCE_PAGES_PICKED_DO_NOT_NOTIFY,
  MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED,
  MaintenanceReachRecord,
  REMINDERS_ALREADY_DUE_NOT_SENT,
  getEventSubscriberNotificationsSummary,
  getMaintenanceNotifyOptionsReason,
  getMaintenanceReachQuestion,
  getMaintenanceRemindersReason,
  getTemplateSubscriberNotificationsSummary,
  readMaintenanceSubscriberSettings,
} from "../../FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceReach";
import {
  PUBLISHING_SUMMARIES,
  REMINDERS_NOT_SENT_BEFORE_PUBLISHING_TEXT,
} from "../../FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenancePublishing";
import MaintenanceStatusPagesCopy from "../../FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceStatusPagesCopy";
import {
  STATUS_PAGE_VISIBILITY_KIND_COPY,
  StatusPageVisibilityKind,
} from "../../FeatureSet/Dashboard/src/Components/StatusPageVisibility/StatusPageVisibilitySwitchCopy";
import OneUptimeDate from "Common/Types/Date";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import { JSONObject } from "Common/Types/JSON";
import PositiveNumber from "Common/Types/PositiveNumber";
import { PickedStatusPagesReachResult } from "Common/Types/StatusPage/PickedStatusPagesReach";
import { PublicNoteNothingSentReason } from "Common/Types/StatusPage/PublicNoteReach";
import Timezone from "Common/Types/Timezone";
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
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";

/*
 * What Schedule Maintenance Event, and a maintenance template, say about
 * the subscribers (#9920; Components/ScheduledMaintenance
 * /ScheduledMaintenanceReach): the folded Subscriber Notifications line and
 * its review, the note under the three boxes and the note under the
 * reminders, for the status pages picked (the server's answer) and the
 * event's own settings - case by case. That each case is what the jobs do
 * is App/Tests/Workers/Jobs/ScheduledMaintenance
 * /SubscriberNotificationsAsTheFormSays's; the forms are drawn for real in
 * Common's ScheduledMaintenanceCreateForm and ScheduledMaintenanceTemplateForm.
 */

const NOW: Date = new Date("2026-11-01T00:00:00.000Z");
const PUBLISH_AT: Date = new Date("2026-11-09T00:00:00.000Z");
const STARTS_AT: Date = new Date("2026-11-11T00:00:00.000Z");
const ENDS_AT: Date = new Date("2026-11-11T02:00:00.000Z");

const SITE_1: string = "b0000000-0000-4000-8000-000000000001";
const SITE_2: string = "b0000000-0000-4000-8000-000000000002";
const TEMPLATE_ID: string = "e0000000-0000-4000-8000-000000000001";

const NOTIFIES: PickedStatusPagesReachResult = { nothingSentReason: null };
const NOTIFICATIONS_OFF: PickedStatusPagesReachResult = {
  nothingSentReason: PublicNoteNothingSentReason.NotificationsOff,
};
const NO_STATUS_PAGES: PickedStatusPagesReachResult = {
  nothingSentReason: PublicNoteNothingSentReason.NoStatusPages,
};

const HIDDEN: string =
  STATUS_PAGE_VISIBILITY_KIND_COPY[
    StatusPageVisibilityKind.ScheduledMaintenance
  ].switchOffDescription;

const ALL_MOMENTS: string =
  SUBSCRIBER_NOTIFICATION_SUMMARIES["scheduled,started,ended"]!;

const NO_MOMENT: string = SUBSCRIBER_NOTIFICATION_SUMMARIES[""]!;

function reminder(intervalType: EventInterval, count: number): JSONObject {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(count);
  return recurring.toJSON();
}

// What the Create form holds: a page picked, the default window and switches.
function event(overrides: JSONObject = {}): JSONObject {
  return {
    statusPages: [SITE_1],
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    ...overrides,
  };
}

const ALL_OFF: JSONObject = {
  shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: false,
  shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: false,
};

function line(
  values: JSONObject,
  reach: PickedStatusPagesReachResult | null,
): Array<string> {
  return getEventSubscriberNotificationsSummary(values, reach, NOW);
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  OneUptimeDate.setUserTimezone(Timezone.UTC);
});

afterEach(() => {
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("Schedule Maintenance Event's line", () => {
  test("a page that shows maintenance events and notifies: when it shows, then every moment", () => {
    expect(line(event(), NOTIFIES)).toEqual([
      PUBLISHING_SUMMARIES.rightAway,
      ALL_MOMENTS,
    ]);
  });

  test("no page picked: it appears on none, and nobody is told - nothing to ask", () => {
    for (const reach of [null, NOTIFIES]) {
      expect(line(event({ statusPages: [] }), reach)).toEqual([
        MaintenanceStatusPagesCopy.notShownWarning,
        MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED,
      ]);
    }
  });

  test("none of the pages picked shows maintenance events: that, in place of when, and nobody is told", () => {
    expect(line(event(), NO_STATUS_PAGES)).toEqual([
      MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED,
      MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED,
    ]);
  });

  test("the pages picked send nothing: when it shows, then that they send nothing", () => {
    expect(line(event(), NOTIFICATIONS_OFF)).toEqual([
      PUBLISHING_SUMMARIES.rightAway,
      MAINTENANCE_PAGES_PICKED_DO_NOT_NOTIFY,
    ]);
  });

  test("not known yet, or not answered: when it shows, and no promise either way", () => {
    expect(line(event(), null)).toEqual([
      PUBLISHING_SUMMARIES.rightAway,
      MAINTENANCE_NOTIFICATIONS_DEPEND_ON_PAGES,
    ]);
  });

  test("hidden from its status pages: that, and nobody is told, whatever the pages", () => {
    for (const reach of [null, NOTIFIES, NOTIFICATIONS_OFF, NO_STATUS_PAGES]) {
      expect(line(event({ isVisibleOnStatusPage: false }), reach)).toEqual([
        HIDDEN,
      ]);
    }
  });

  test("nothing asked of the subscribers: that they are not told at any moment, whatever the pages", () => {
    for (const reach of [null, NOTIFIES, NOTIFICATIONS_OFF]) {
      expect(line(event(ALL_OFF), reach)).toEqual([
        PUBLISHING_SUMMARIES.rightAway,
        NO_MOMENT,
      ]);
    }
  });

  test("only the moments that tell someone: the switches left on", () => {
    expect(
      line(
        event({
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: false,
        }),
        NOTIFIES,
      ),
    ).toEqual([
      PUBLISHING_SUMMARIES.rightAway,
      SUBSCRIBER_NOTIFICATION_SUMMARIES["scheduled,ended"],
    ]);
  });

  test("only the moments that tell someone: one published after it starts tells nobody that it started", () => {
    const publishAt: Date = new Date("2026-11-11T01:00:00.000Z");

    expect(line(event({ publishOnStatusPageAt: publishAt }), NOTIFIES)).toEqual(
      [
        `Shown on its status pages from ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(publishAt)}.`,
        SUBSCRIBER_NOTIFICATION_SUMMARIES["scheduled,ended"],
      ],
    );
  });

  test("published later, before it starts: from that time, and every moment", () => {
    expect(
      line(event({ publishOnStatusPageAt: PUBLISH_AT }), NOTIFIES),
    ).toEqual([
      `Shown on its status pages from ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(PUBLISH_AT)}.`,
      ALL_MOMENTS,
    ]);
  });

  test("reminders all sent: that they get reminders", () => {
    expect(
      line(
        event({ [SUBSCRIBER_REMINDERS_KEY]: [reminder(EventInterval.Day, 1)] }),
        NOTIFIES,
      ),
    ).toEqual([
      PUBLISHING_SUMMARIES.rightAway,
      ALL_MOMENTS,
      SUBSCRIBER_REMINDERS_SUMMARY,
    ]);
  });

  test("a reminder due before it is published: that it is not sent, after the ones that are", () => {
    expect(
      line(
        event({
          publishOnStatusPageAt: PUBLISH_AT,
          [SUBSCRIBER_REMINDERS_KEY]: [
            reminder(EventInterval.Hour, 1),
            reminder(EventInterval.Day, 3),
          ],
        }),
        NOTIFIES,
      ),
    ).toEqual([
      `Shown on its status pages from ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(PUBLISH_AT)}.`,
      ALL_MOMENTS,
      SUBSCRIBER_REMINDERS_SUMMARY,
      REMINDERS_NOT_SENT_BEFORE_PUBLISHING_TEXT,
    ]);
  });

  test("a reminder whose time has passed: that it is not sent; every one of them gone by, no promise of reminders", () => {
    expect(
      line(
        event({
          [SUBSCRIBER_REMINDERS_KEY]: [
            reminder(EventInterval.Day, 1),
            reminder(EventInterval.Day, 30),
          ],
        }),
        NOTIFIES,
      ),
    ).toEqual([
      PUBLISHING_SUMMARIES.rightAway,
      ALL_MOMENTS,
      SUBSCRIBER_REMINDERS_SUMMARY,
      REMINDERS_ALREADY_DUE_NOT_SENT,
    ]);

    expect(
      line(
        event({
          [SUBSCRIBER_REMINDERS_KEY]: [reminder(EventInterval.Day, 30)],
        }),
        NOTIFIES,
      ),
    ).toEqual([
      PUBLISHING_SUMMARIES.rightAway,
      ALL_MOMENTS,
      REMINDERS_ALREADY_DUE_NOT_SENT,
    ]);
  });

  test("reminders and every moment switched off: no moment, and the reminders", () => {
    expect(
      line(
        event({
          ...ALL_OFF,
          [SUBSCRIBER_REMINDERS_KEY]: [reminder(EventInterval.Day, 1)],
        }),
        NOTIFIES,
      ),
    ).toEqual([
      PUBLISHING_SUMMARIES.rightAway,
      NO_MOMENT,
      SUBSCRIBER_REMINDERS_SUMMARY,
    ]);
  });

  test("a reminder it cannot read reminds nobody", () => {
    expect(
      line(
        event({ [SUBSCRIBER_REMINDERS_KEY]: [{ _type: "Something" }] }),
        NOTIFIES,
      ),
    ).toEqual([PUBLISHING_SUMMARIES.rightAway, ALL_MOMENTS]);
  });
});

describe("a maintenance template's line", () => {
  function template(overrides: JSONObject = {}): JSONObject {
    return { statusPages: [SITE_1], ...overrides };
  }

  test("a page that notifies: every moment its switches leave on, and its reminders - none gone by, nothing published later", () => {
    expect(
      getTemplateSubscriberNotificationsSummary(
        template({
          [SUBSCRIBER_REMINDERS_KEY]: [reminder(EventInterval.Day, 30)],
        }),
        NOTIFIES,
      ),
    ).toEqual([ALL_MOMENTS, SUBSCRIBER_REMINDERS_SUMMARY]);
  });

  test("no page picked: events made from it appear on none, and nobody is told", () => {
    expect(
      getTemplateSubscriberNotificationsSummary(
        template({ statusPages: [] }),
        null,
      ),
    ).toEqual([
      MaintenanceStatusPagesCopy.templateNotShownWarning,
      MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED,
    ]);
  });

  test("the pages picked hide maintenance events, send nothing, or are not known yet", () => {
    expect(
      getTemplateSubscriberNotificationsSummary(template(), NO_STATUS_PAGES),
    ).toEqual([
      MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED,
      MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED,
    ]);
    expect(
      getTemplateSubscriberNotificationsSummary(template(), NOTIFICATIONS_OFF),
    ).toEqual([MAINTENANCE_PAGES_PICKED_DO_NOT_NOTIFY]);
    expect(getTemplateSubscriberNotificationsSummary(template(), null)).toEqual(
      [MAINTENANCE_NOTIFICATIONS_DEPEND_ON_PAGES],
    );
  });

  test("a template is published nowhere and hidden nowhere: what its values say of either counts for nothing", () => {
    expect(
      getTemplateSubscriberNotificationsSummary(
        template({
          isVisibleOnStatusPage: false,
          publishOnStatusPageAt: "2027-01-01T00:00:00.000Z",
        }),
        NOTIFIES,
      ),
    ).toEqual([ALL_MOMENTS]);
  });
});

describe("the note under the three boxes", () => {
  function reason(
    values: JSONObject,
    reach: PickedStatusPagesReachResult | null,
    record: MaintenanceReachRecord = MaintenanceReachRecord.Event,
  ): string | null {
    return getMaintenanceNotifyOptionsReason({
      values: values,
      record: record,
      reach: reach,
    });
  }

  test("why nobody would be told, for each reason", () => {
    expect(reason(event({ isVisibleOnStatusPage: false }), NOTIFIES)).toBe(
      HIDDEN,
    );
    expect(reason(event({ statusPages: [] }), null)).toBe(
      MaintenanceStatusPagesCopy.notShownWarning,
    );
    expect(
      reason({ statusPages: [] }, null, MaintenanceReachRecord.Template),
    ).toBe(MaintenanceStatusPagesCopy.templateNotShownWarning);
    expect(reason(event(), NO_STATUS_PAGES)).toBe(
      MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED,
    );
    expect(reason(event(), NOTIFICATIONS_OFF)).toBe(
      MAINTENANCE_PAGES_PICKED_DO_NOT_NOTIFY,
    );
  });

  test("nothing while a page notifies, or while that is not known", () => {
    expect(reason(event(), NOTIFIES)).toBeNull();
    expect(reason(event(), null)).toBeNull();
  });

  test("nothing while nothing is asked of the subscribers: the boxes say it all", () => {
    expect(reason(event(ALL_OFF), NOTIFICATIONS_OFF)).toBeNull();
    expect(
      reason(
        event({
          ...ALL_OFF,
          [SUBSCRIBER_REMINDERS_KEY]: [reminder(EventInterval.Day, 1)],
        }),
        NOTIFICATIONS_OFF,
      ),
    ).toBe(MAINTENANCE_PAGES_PICKED_DO_NOT_NOTIFY);
  });
});

describe("the note under the reminders", () => {
  function reason(
    values: JSONObject,
    reach: PickedStatusPagesReachResult | null,
  ): Array<string> {
    return getMaintenanceRemindersReason({
      values: values,
      reach: reach,
      now: NOW,
    });
  }

  const SOME_NOT_SENT: JSONObject = {
    publishOnStatusPageAt: PUBLISH_AT,
    [SUBSCRIBER_REMINDERS_KEY]: [
      reminder(EventInterval.Day, 3),
      reminder(EventInterval.Day, 30),
      reminder(EventInterval.Hour, 1),
    ],
  };

  test("which are not sent: due before it is published, and whose time has passed", () => {
    expect(reason(event(SOME_NOT_SENT), NOTIFIES)).toEqual([
      REMINDERS_NOT_SENT_BEFORE_PUBLISHING_TEXT,
      REMINDERS_ALREADY_DUE_NOT_SENT,
    ]);
  });

  test("said while the pages' answer is not known: true whatever they say", () => {
    expect(reason(event(SOME_NOT_SENT), null)).toEqual([
      REMINDERS_NOT_SENT_BEFORE_PUBLISHING_TEXT,
      REMINDERS_ALREADY_DUE_NOT_SENT,
    ]);
  });

  test("nothing while nobody is told anyway: the note above says why", () => {
    for (const reach of [NOTIFICATIONS_OFF, NO_STATUS_PAGES]) {
      expect(reason(event(SOME_NOT_SENT), reach)).toEqual([]);
    }

    expect(
      reason(
        event({ ...SOME_NOT_SENT, isVisibleOnStatusPage: false }),
        NOTIFIES,
      ),
    ).toEqual([]);
    expect(reason(event({ ...SOME_NOT_SENT, statusPages: [] }), null)).toEqual(
      [],
    );
  });

  test("nothing with no reminder, or every one sent", () => {
    expect(reason(event(), NOTIFIES)).toEqual([]);
    expect(
      reason(
        event({ [SUBSCRIBER_REMINDERS_KEY]: [reminder(EventInterval.Day, 1)] }),
        NOTIFIES,
      ),
    ).toEqual([]);
  });
});

describe("what the server is asked, and what the form holds", () => {
  test("the pages picked, each once, and the record an Edit edits", () => {
    expect(
      getMaintenanceReachQuestion({
        values: { statusPages: [SITE_1, SITE_2, SITE_1] },
        record: MaintenanceReachRecord.Event,
      }),
    ).toEqual({
      record: MaintenanceReachRecord.Event,
      statusPageIds: [SITE_1, SITE_2],
      recordId: null,
    });
    expect(
      getMaintenanceReachQuestion({
        values: { _id: TEMPLATE_ID, statusPages: [{ _id: SITE_2 }] },
        record: MaintenanceReachRecord.Template,
      }),
    ).toEqual({
      record: MaintenanceReachRecord.Template,
      statusPageIds: [SITE_2],
      recordId: TEMPLATE_ID,
    });
  });

  test("nothing while no page is picked: there is nothing to ask", () => {
    for (const statusPages of [undefined, null, [], ""]) {
      expect(
        getMaintenanceReachQuestion({
          values: { statusPages: statusPages },
          record: MaintenanceReachRecord.Event,
        }),
      ).toBeNull();
    }
  });

  test("an event's settings: Visible on Status Page on unless held off, a publish time only for At a date and time", () => {
    expect(
      readMaintenanceSubscriberSettings({}, MaintenanceReachRecord.Event),
    ).toMatchObject({
      isVisibleOnStatusPage: true,
      publishOnStatusPageAt: null,
      notifiesWhenScheduled: true,
      notifiesWhenStarted: true,
      notifiesWhenEnded: true,
      reminders: [],
    });
    expect(
      readMaintenanceSubscriberSettings(
        { isVisibleOnStatusPage: false, publishOnStatusPageAt: PUBLISH_AT },
        MaintenanceReachRecord.Event,
      ),
    ).toMatchObject({
      isVisibleOnStatusPage: false,
      publishOnStatusPageAt: PUBLISH_AT,
    });
    // Right away picked: whatever time the form still holds is cleared.
    expect(
      readMaintenanceSubscriberSettings(
        {
          publishOnStatusPagesChoice: "right-away",
          publishOnStatusPageAt: PUBLISH_AT,
        },
        MaintenanceReachRecord.Event,
      ).publishOnStatusPageAt,
    ).toBeNull();
  });

  test("a template's: no times of its own, shown wherever its pages show it", () => {
    expect(
      readMaintenanceSubscriberSettings(
        {
          startsAt: STARTS_AT,
          isVisibleOnStatusPage: false,
          [SUBSCRIBER_REMINDERS_KEY]: [reminder(EventInterval.Day, 1)],
        },
        MaintenanceReachRecord.Template,
      ),
    ).toMatchObject({
      isVisibleOnStatusPage: true,
      publishOnStatusPageAt: null,
      startsAt: null,
      endsAt: null,
    });
  });
});

describe("every sentence of it is translated", () => {
  const LOCALES_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Locales",
  );

  const readLocale: (locale: string) => Record<string, string> = (
    locale: string,
  ): Record<string, string> => {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
    ) as Record<string, string>;
  };

  const SENTENCES: Array<string> = [
    MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED,
    MAINTENANCE_PAGES_PICKED_DO_NOT_NOTIFY,
    MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED,
    MAINTENANCE_NOTIFICATIONS_DEPEND_ON_PAGES,
    REMINDERS_ALREADY_DUE_NOT_SENT,
    REMINDERS_NOT_SENT_BEFORE_PUBLISHING_TEXT,
    HIDDEN,
    MaintenanceStatusPagesCopy.notShownWarning,
    MaintenanceStatusPagesCopy.templateNotShownWarning,
    ...Object.values(SUBSCRIBER_NOTIFICATION_SUMMARIES),
    SUBSCRIBER_REMINDERS_SUMMARY,
  ];

  test("in English, each a key of its own", () => {
    const english: Record<string, string> = readLocale("en");

    for (const sentence of SENTENCES) {
      expect(`${sentence}: ${english[sentence]}`).toBe(
        `${sentence}: ${sentence}`,
      );
    }
  });

  for (const locale of DASHBOARD_LANGUAGES) {
    test(`in ${locale}, worded`, () => {
      const translations: Record<string, string> = readLocale(locale);

      for (const sentence of SENTENCES) {
        const translation: string | undefined = translations[sentence];

        expect(`${locale} ${sentence}: ${Boolean(translation)}`).toBe(
          `${locale} ${sentence}: true`,
        );
        expect(`${locale} ${sentence}: ${translation !== sentence}`).toBe(
          `${locale} ${sentence}: true`,
        );
      }
    });
  }
});
