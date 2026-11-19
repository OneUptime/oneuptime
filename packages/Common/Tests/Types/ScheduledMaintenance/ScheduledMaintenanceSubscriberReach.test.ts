/** @timezone Asia/Kolkata */
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import PositiveNumber from "../../../Types/PositiveNumber";
import ScheduledMaintenanceSubscriberReach, {
  MaintenanceMomentOwnReason,
  MaintenanceReminderReach,
  MaintenanceStatusPagesReason,
  MaintenanceSubscriberMoment,
  ScheduledMaintenanceSubscriberSettings,
} from "../../../Types/ScheduledMaintenance/ScheduledMaintenanceSubscriberReach";
import { PublicNoteNothingSentReason } from "../../../Types/StatusPage/PublicNoteReach";
import { describe, expect, test } from "@jest/globals";

/*
 * What a maintenance event tells the subscribers of its status pages, and
 * when (#9920): the rule the notification jobs' checks are written down in,
 * which Schedule Maintenance Event's Subscriber Notifications line says.
 * Each moment notifies someone exactly when no reason stands in its way:
 *
 *   - when it is scheduled: its switch; held back until it is published and
 *     sent then, so a publish time still to come is no reason; hidden; the
 *     status pages;
 *   - when it starts, and when it ends: its switch; hidden, or not published
 *     yet, at that moment; the status pages;
 *   - each reminder: its time had passed when the event was saved; hidden,
 *     or not published yet, when it is due; the status pages.
 *
 * Run in India (UTC+05:30): every time here is an instant, so the zone of
 * the machine reading it changes nothing.
 */

const NOW: Date = new Date("2026-11-19T09:00:00.000Z");
const PUBLISH_AT: Date = new Date("2026-11-25T09:00:00.000Z");
const STARTS_AT: Date = new Date("2026-12-01T02:00:00.000Z");
const ENDS_AT: Date = new Date("2026-12-01T04:00:00.000Z");

const NO_STATUS_PAGES: MaintenanceStatusPagesReason =
  PublicNoteNothingSentReason.NoStatusPages;
const NOTIFICATIONS_OFF: MaintenanceStatusPagesReason =
  PublicNoteNothingSentReason.NotificationsOff;

function reminder(intervalType: EventInterval, count: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(count);
  return recurring;
}

function settings(
  overrides: Partial<ScheduledMaintenanceSubscriberSettings> = {},
): ScheduledMaintenanceSubscriberSettings {
  return {
    isVisibleOnStatusPage: true,
    publishOnStatusPageAt: null,
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    notifiesWhenScheduled: true,
    notifiesWhenStarted: true,
    notifiesWhenEnded: true,
    reminders: [],
    ...overrides,
  };
}

/*
 * The status pages' answer a case is given: a page that notifies unless a
 * case says otherwise - "not known" (undefined) included, which a default
 * parameter would read as not given.
 */
interface Pages {
  pages?: MaintenanceStatusPagesReason;
}

function pagesOf(options: Pages): MaintenanceStatusPagesReason {
  return "pages" in options ? options.pages : null;
}

function momentReason(
  moment: MaintenanceSubscriberMoment,
  event: ScheduledMaintenanceSubscriberSettings,
  options: Pages = {},
): ReturnType<typeof ScheduledMaintenanceSubscriberReach.getMomentReason> {
  return ScheduledMaintenanceSubscriberReach.getMomentReason({
    moment: moment,
    settings: event,
    statusPagesReason: pagesOf(options),
  });
}

const MOMENTS: Array<MaintenanceSubscriberMoment> = [
  MaintenanceSubscriberMoment.Scheduled,
  MaintenanceSubscriberMoment.Started,
  MaintenanceSubscriberMoment.Ended,
];

describe("why the event tells nobody at any moment", () => {
  test("hidden from its status pages comes first, whatever the pages", () => {
    for (const pages of [null, undefined, NO_STATUS_PAGES, NOTIFICATIONS_OFF]) {
      expect(
        ScheduledMaintenanceSubscriberReach.getEventReason({
          settings: settings({ isVisibleOnStatusPage: false }),
          statusPagesReason: pages,
        }),
      ).toBe(PublicNoteNothingSentReason.HiddenFromStatusPages);
    }
  });

  test("a switch never set is off, as the jobs read it", () => {
    expect(
      ScheduledMaintenanceSubscriberReach.getEventReason({
        settings: settings({ isVisibleOnStatusPage: undefined }),
        statusPagesReason: null,
      }),
    ).toBe(PublicNoteNothingSentReason.HiddenFromStatusPages);
  });

  test("shown: the status pages' answer, not known while it is not", () => {
    expect(
      ScheduledMaintenanceSubscriberReach.getEventReason({
        settings: settings(),
        statusPagesReason: null,
      }),
    ).toBeNull();
    expect(
      ScheduledMaintenanceSubscriberReach.getEventReason({
        settings: settings(),
        statusPagesReason: NOTIFICATIONS_OFF,
      }),
    ).toBe(NOTIFICATIONS_OFF);
    expect(
      ScheduledMaintenanceSubscriberReach.getEventReason({
        settings: settings(),
        statusPagesReason: undefined,
      }),
    ).toBeUndefined();
  });
});

describe("each moment, in the order its job checks", () => {
  test("every moment tells someone: switched on, shown, a page that notifies", () => {
    for (const moment of MOMENTS) {
      expect(momentReason(moment, settings())).toBeNull();
    }
  });

  test("its own switch off: SwitchedOff, before anything else", () => {
    const off: Record<MaintenanceSubscriberMoment, string> = {
      [MaintenanceSubscriberMoment.Scheduled]: "notifiesWhenScheduled",
      [MaintenanceSubscriberMoment.Started]: "notifiesWhenStarted",
      [MaintenanceSubscriberMoment.Ended]: "notifiesWhenEnded",
    };

    for (const moment of MOMENTS) {
      const event: ScheduledMaintenanceSubscriberSettings = settings({
        isVisibleOnStatusPage: false,
        [off[moment]]: false,
      });

      expect(momentReason(moment, event, { pages: NO_STATUS_PAGES })).toBe(
        MaintenanceMomentOwnReason.SwitchedOff,
      );

      // The other moments keep their own switches.
      for (const other of MOMENTS.filter(
        (each: MaintenanceSubscriberMoment): boolean => {
          return each !== moment;
        },
      )) {
        expect(
          momentReason(other, settings({ [off[moment]]: false })),
        ).toBeNull();
      }
    }
  });

  test("hidden from its status pages: nobody is told at any moment", () => {
    for (const moment of MOMENTS) {
      expect(
        momentReason(moment, settings({ isVisibleOnStatusPage: false })),
      ).toBe(PublicNoteNothingSentReason.HiddenFromStatusPages);
    }
  });

  test("the status pages' reason for every moment, and not known while it is not", () => {
    for (const moment of MOMENTS) {
      expect(momentReason(moment, settings(), { pages: NO_STATUS_PAGES })).toBe(
        NO_STATUS_PAGES,
      );
      expect(
        momentReason(moment, settings(), { pages: NOTIFICATIONS_OFF }),
      ).toBe(NOTIFICATIONS_OFF);
      expect(
        momentReason(moment, settings(), { pages: undefined }),
      ).toBeUndefined();
    }
  });

  test("published later, before it starts: told it is scheduled at that time, and of the start and the end", () => {
    const event: ScheduledMaintenanceSubscriberSettings = settings({
      publishOnStatusPageAt: PUBLISH_AT,
    });

    for (const moment of MOMENTS) {
      expect(momentReason(moment, event)).toBeNull();
    }
  });

  test("published at the very start: the start finds it published", () => {
    expect(
      momentReason(
        MaintenanceSubscriberMoment.Started,
        settings({ publishOnStatusPageAt: STARTS_AT }),
      ),
    ).toBeNull();
  });

  test("published after it starts: the start tells nobody, the end and the scheduled notification still do", () => {
    const event: ScheduledMaintenanceSubscriberSettings = settings({
      publishOnStatusPageAt: new Date("2026-12-01T03:00:00.000Z"),
    });

    expect(momentReason(MaintenanceSubscriberMoment.Started, event)).toBe(
      PublicNoteNothingSentReason.NotPublishedYet,
    );
    expect(momentReason(MaintenanceSubscriberMoment.Ended, event)).toBeNull();
    expect(
      momentReason(MaintenanceSubscriberMoment.Scheduled, event),
    ).toBeNull();
  });

  test("published after it ends: neither the start nor the end tells anyone", () => {
    const event: ScheduledMaintenanceSubscriberSettings = settings({
      publishOnStatusPageAt: new Date("2026-12-02T00:00:00.000Z"),
    });

    expect(momentReason(MaintenanceSubscriberMoment.Started, event)).toBe(
      PublicNoteNothingSentReason.NotPublishedYet,
    );
    expect(momentReason(MaintenanceSubscriberMoment.Ended, event)).toBe(
      PublicNoteNothingSentReason.NotPublishedYet,
    );
  });

  test("a publish time that is there but is no time is never reached: nothing is ever sent", () => {
    const event: ScheduledMaintenanceSubscriberSettings = settings({
      publishOnStatusPageAt: "not a time",
    });

    for (const moment of MOMENTS) {
      expect(momentReason(moment, event)).toBe(
        PublicNoteNothingSentReason.NotPublishedYet,
      );
    }
  });

  test("the switch is read before the publish time", () => {
    expect(
      momentReason(
        MaintenanceSubscriberMoment.Started,
        settings({
          notifiesWhenStarted: false,
          publishOnStatusPageAt: new Date("2026-12-02T00:00:00.000Z"),
        }),
      ),
    ).toBe(MaintenanceMomentOwnReason.SwitchedOff);
  });

  test("the moments that tell someone, in order", () => {
    expect(
      ScheduledMaintenanceSubscriberReach.getMomentsThatNotify({
        settings: settings({ notifiesWhenStarted: false }),
        statusPagesReason: null,
      }),
    ).toEqual([
      MaintenanceSubscriberMoment.Scheduled,
      MaintenanceSubscriberMoment.Ended,
    ]);
    expect(
      ScheduledMaintenanceSubscriberReach.getMomentsThatNotify({
        settings: settings(),
        statusPagesReason: undefined,
      }),
    ).toEqual([]);
    expect(
      ScheduledMaintenanceSubscriberReach.getMomentsThatNotify({
        settings: settings(),
        statusPagesReason: NOTIFICATIONS_OFF,
      }),
    ).toEqual([]);
  });
});

describe("each reminder before the event", () => {
  function reminders(
    event: ScheduledMaintenanceSubscriberSettings,
    options: Pages & { now?: Date } = {},
  ): Array<MaintenanceReminderReach> {
    return ScheduledMaintenanceSubscriberReach.getReminders({
      settings: event,
      statusPagesReason: pagesOf(options),
      now: options.now || NOW,
    });
  }

  test("is due its interval before the event starts, as its job schedules it", () => {
    expect(
      ScheduledMaintenanceSubscriberReach.getRemindAt(
        STARTS_AT,
        reminder(EventInterval.Day, 1),
      ),
    ).toEqual(new Date("2026-11-30T02:00:00.000Z"));
    expect(
      ScheduledMaintenanceSubscriberReach.getRemindAt(
        STARTS_AT,
        reminder(EventInterval.Hour, 3),
      ),
    ).toEqual(new Date("2026-11-30T23:00:00.000Z"));
    // As the form holds it: JSON.
    expect(
      ScheduledMaintenanceSubscriberReach.getRemindAt(
        STARTS_AT,
        reminder(EventInterval.Week, 1).toJSON(),
      ),
    ).toEqual(new Date("2026-11-24T02:00:00.000Z"));
  });

  test("one that cannot be read has no time", () => {
    expect(
      ScheduledMaintenanceSubscriberReach.getRemindAt(STARTS_AT, {
        _type: "Something",
      }),
    ).toBeNull();
  });

  test("still to come, shown, a page that notifies: someone is reminded", () => {
    expect(
      reminders(settings({ reminders: [reminder(EventInterval.Day, 1)] })),
    ).toEqual([
      {
        remindAt: new Date("2026-11-30T02:00:00.000Z"),
        nothingSentReason: null,
      },
    ]);
  });

  test("its time passed when the event is saved: AlreadyDue, whatever else", () => {
    // 30 days before the start is before now.
    expect(
      reminders(
        settings({
          isVisibleOnStatusPage: false,
          reminders: [reminder(EventInterval.Day, 30)],
        }),
        { pages: NO_STATUS_PAGES },
      )[0]!.nothingSentReason,
    ).toBe(MaintenanceMomentOwnReason.AlreadyDue);
    // Due exactly now: not in the future, never scheduled.
    expect(
      reminders(settings({ reminders: [reminder(EventInterval.Day, 1)] }), {
        now: new Date("2026-11-30T02:00:00.000Z"),
      })[0]!.nothingSentReason,
    ).toBe(MaintenanceMomentOwnReason.AlreadyDue);
  });

  test("due before the event is published: NotPublishedYet; after it: sent", () => {
    const event: ScheduledMaintenanceSubscriberSettings = settings({
      publishOnStatusPageAt: PUBLISH_AT,
      reminders: [
        reminder(EventInterval.Week, 1),
        reminder(EventInterval.Day, 1),
      ],
    });

    expect(
      reminders(event).map((each: MaintenanceReminderReach): unknown => {
        return each.nothingSentReason;
      }),
    ).toEqual([PublicNoteNothingSentReason.NotPublishedYet, null]);
  });

  test("hidden from its status pages, or the pages' reason", () => {
    expect(
      reminders(
        settings({
          isVisibleOnStatusPage: false,
          reminders: [reminder(EventInterval.Day, 1)],
        }),
      )[0]!.nothingSentReason,
    ).toBe(PublicNoteNothingSentReason.HiddenFromStatusPages);

    for (const pages of [NO_STATUS_PAGES, NOTIFICATIONS_OFF, undefined]) {
      expect(
        reminders(settings({ reminders: [reminder(EventInterval.Day, 1)] }), {
          pages: pages,
        })[0]!.nothingSentReason,
      ).toBe(pages);
    }
  });

  test("the switches do not touch the reminders", () => {
    expect(
      reminders(
        settings({
          notifiesWhenScheduled: false,
          notifiesWhenStarted: false,
          notifiesWhenEnded: false,
          reminders: [reminder(EventInterval.Day, 1)],
        }),
      )[0]!.nothingSentReason,
    ).toBeNull();
  });

  test("with the event's start not known (a template), each counts by the pages alone", () => {
    expect(
      reminders(
        settings({
          startsAt: null,
          endsAt: null,
          reminders: [reminder(EventInterval.Day, 30)],
        }),
      ),
    ).toEqual([{ remindAt: null, nothingSentReason: null }]);
  });
});
