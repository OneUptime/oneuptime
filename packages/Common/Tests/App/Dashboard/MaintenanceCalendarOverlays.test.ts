/** @timezone UTC */

import { describe, expect, test } from "@jest/globals";
import {
  EXTERNAL_CALENDAR_FALLBACK_COLOR,
  HIDDEN_EXTERNAL_CALENDARS_STORAGE_KEY_PREFIX,
  MAINTENANCE_CALENDAR_OVERLAY_ID_OFFSET,
  MAINTENANCE_CALENDAR_OVERLAY_LIMIT,
  MaintenanceCalendarOverlayEvent,
  OverlayCalendar,
  getHiddenCalendarsStorageKey,
  getOverlayRangeQuery,
  getShownCalendarIds,
  isOverlayEvent,
  readHiddenCalendarIds,
  toOverlayCalendars,
  toOverlayEvents,
  toggleHiddenCalendar,
  writeHiddenCalendarIds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceCalendarOverlays";
import {
  PREVIOUS_VIEW_STORAGE_KEY,
  ScheduledMaintenanceView,
  takePreviousCalendarChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceView";
import ScheduledMaintenanceExternalCalendar from "../../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import ScheduledMaintenanceExternalCalendarEvent from "../../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendarEvent";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "../../../Types/BaseDatabase/Includes";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import Query from "../../../Types/BaseDatabase/Query";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import { ExternalCalendarReadError } from "../../../Types/ScheduledMaintenance/ExternalCalendar";

/*
 * The calendars from outside the project on the Maintenance Calendar,
 * without React (MaintenanceCalendarOverlays): which calendars a reader
 * hid, kept in their browser and safe without it; which events a period
 * asks for; and how each is drawn - an all-day event on its own dates in
 * every zone, a timed one in the reader's zone, striped in its calendar's
 * colour with a tooltip of its title, calendar and time.
 *
 * Also the one-time move of a reader who had left the old List | Calendar
 * switch on Calendar (ScheduledMaintenanceView).
 */

const PROJECT_ID: string = "64000000-0000-4000-8000-000000000001";
const HOLIDAYS_ID: string = "64000000-0000-4000-8000-000000000002";
const FREEZES_ID: string = "64000000-0000-4000-8000-000000000003";

// A Storage of its own, so a test never leans on the page's localStorage.
function memoryStorage(initial: Record<string, string> = {}): Storage & {
  values: Record<string, string>;
} {
  const values: Record<string, string> = { ...initial };

  return {
    values: values,
    length: 0,
    clear: (): void => {
      for (const key of Object.keys(values)) {
        delete values[key];
      }
    },
    key: (): null => {
      return null;
    },
    getItem: (key: string): string | null => {
      return key in values ? values[key]! : null;
    },
    setItem: (key: string, value: string): void => {
      values[key] = value;
    },
    removeItem: (key: string): void => {
      delete values[key];
    },
  };
}

// A storage that refuses every access, as a private window can.
const REFUSING_STORAGE: Storage = {
  length: 0,
  clear: (): void => {
    throw new Error("SecurityError");
  },
  key: (): null => {
    throw new Error("SecurityError");
  },
  getItem: (): string | null => {
    throw new Error("SecurityError");
  },
  setItem: (): void => {
    throw new Error("SecurityError");
  },
  removeItem: (): void => {
    throw new Error("SecurityError");
  },
};

const CALENDARS: Array<OverlayCalendar> = [
  {
    id: HOLIDAYS_ID,
    name: "Public holidays",
    color: "#0d9488",
    readError: null,
  },
  {
    id: FREEZES_ID,
    name: "Change freezes",
    color: "#d97706",
    readError: ExternalCalendarReadError.NotFound,
  },
];

function event(data: {
  calendarId: string;
  title?: string;
  startsAt: string;
  endsAt: string;
  isAllDay?: boolean;
}): ScheduledMaintenanceExternalCalendarEvent {
  const model: ScheduledMaintenanceExternalCalendarEvent =
    new ScheduledMaintenanceExternalCalendarEvent();
  model.scheduledMaintenanceExternalCalendarId = new ObjectID(data.calendarId);
  if (data.title !== undefined) {
    model.title = data.title;
  }
  model.startsAt = new Date(data.startsAt);
  model.endsAt = new Date(data.endsAt);
  model.isAllDay = data.isAllDay === true;
  return model;
}

function overlays(
  events: Array<ScheduledMaintenanceExternalCalendarEvent>,
  timezone: string = "UTC",
): Array<MaintenanceCalendarOverlayEvent> {
  return toOverlayEvents({
    events: events,
    calendars: CALENDARS,
    timezone: timezone,
    describeWindow: (startsAt: Date, endsAt: Date): string => {
      return `${startsAt.toISOString()} to ${endsAt.toISOString()}`;
    },
    describeDays: (firstDay: Date, lastDay: Date): string => {
      return `${firstDay.getDate()}-${lastDay.getDate()}, all day`;
    },
    untitled: "Busy",
  });
}

describe("which calendars a reader hid", () => {
  test("are kept per project in their browser", () => {
    const storage: Storage & { values: Record<string, string> } =
      memoryStorage();

    expect(readHiddenCalendarIds(PROJECT_ID, storage)).toEqual([]);

    writeHiddenCalendarIds(PROJECT_ID, [HOLIDAYS_ID, HOLIDAYS_ID], storage);

    expect(getHiddenCalendarsStorageKey(PROJECT_ID)).toBe(
      `${HIDDEN_EXTERNAL_CALENDARS_STORAGE_KEY_PREFIX}${PROJECT_ID}`,
    );
    expect(storage.values[getHiddenCalendarsStorageKey(PROJECT_ID)]).toBe(
      JSON.stringify([HOLIDAYS_ID]),
    );
    expect(readHiddenCalendarIds(PROJECT_ID, storage)).toEqual([HOLIDAYS_ID]);

    // Another project's are its own.
    expect(
      readHiddenCalendarIds("64000000-0000-4000-8000-000000000099", storage),
    ).toEqual([]);

    // Showing them all again forgets the key.
    writeHiddenCalendarIds(PROJECT_ID, [], storage);
    expect(storage.values).toEqual({});
  });

  test("anything stored that is not a list of ids reads as none hidden", () => {
    for (const stored of ["not json", "{}", '"x"', "[1, null, {}]", "null"]) {
      const storage: Storage = memoryStorage({
        [getHiddenCalendarsStorageKey(PROJECT_ID)]: stored,
      });

      expect({
        stored,
        read: readHiddenCalendarIds(PROJECT_ID, storage),
      }).toEqual({
        stored,
        read: [],
      });
    }

    const mixed: Storage = memoryStorage({
      [getHiddenCalendarsStorageKey(PROJECT_ID)]: JSON.stringify([
        HOLIDAYS_ID,
        42,
        "",
        "x".repeat(65),
      ]),
    });

    expect(readHiddenCalendarIds(PROJECT_ID, mixed)).toEqual([HOLIDAYS_ID]);
  });

  test("a browser that refuses its storage shows every calendar, and nothing throws", () => {
    expect(readHiddenCalendarIds(PROJECT_ID, REFUSING_STORAGE)).toEqual([]);
    expect(() => {
      writeHiddenCalendarIds(PROJECT_ID, [HOLIDAYS_ID], REFUSING_STORAGE);
    }).not.toThrow();
    expect(readHiddenCalendarIds(PROJECT_ID, null)).toEqual([]);
  });

  test("a toggle hides or shows one calendar, keeping the others as they were", () => {
    expect(toggleHiddenCalendar([], HOLIDAYS_ID, false)).toEqual([HOLIDAYS_ID]);
    expect(toggleHiddenCalendar([HOLIDAYS_ID], HOLIDAYS_ID, true)).toEqual([]);
    expect(toggleHiddenCalendar([HOLIDAYS_ID], FREEZES_ID, false)).toEqual([
      HOLIDAYS_ID,
      FREEZES_ID,
    ]);
    // Hiding twice never lists it twice.
    expect(toggleHiddenCalendar([HOLIDAYS_ID], HOLIDAYS_ID, false)).toEqual([
      HOLIDAYS_ID,
    ]);
  });

  test("the calendars shown are those not hidden", () => {
    expect(getShownCalendarIds(CALENDARS, [])).toEqual([
      HOLIDAYS_ID,
      FREEZES_ID,
    ]);
    expect(getShownCalendarIds(CALENDARS, [FREEZES_ID])).toEqual([HOLIDAYS_ID]);
    expect(getShownCalendarIds(CALENDARS, [HOLIDAYS_ID, FREEZES_ID])).toEqual(
      [],
    );
  });
});

describe("the calendars, as the page reads them", () => {
  test("by id, name and colour, with why their last read failed", () => {
    const row: ScheduledMaintenanceExternalCalendar =
      new ScheduledMaintenanceExternalCalendar();
    row._id = HOLIDAYS_ID;
    row.name = "Public holidays";
    row.color = new Color("#0d9488");

    const failing: ScheduledMaintenanceExternalCalendar =
      new ScheduledMaintenanceExternalCalendar();
    failing._id = FREEZES_ID;
    failing.name = "Change freezes";
    failing.lastReadError = "Timeout";

    const strange: ScheduledMaintenanceExternalCalendar =
      new ScheduledMaintenanceExternalCalendar();
    strange._id = "64000000-0000-4000-8000-000000000004";
    strange.lastReadError = "Something we never write";

    const noId: ScheduledMaintenanceExternalCalendar =
      new ScheduledMaintenanceExternalCalendar();

    expect(toOverlayCalendars([row, failing, strange, noId])).toEqual([
      {
        id: HOLIDAYS_ID,
        name: "Public holidays",
        color: "#0d9488",
        readError: null,
      },
      {
        id: FREEZES_ID,
        name: "Change freezes",
        color: EXTERNAL_CALENDAR_FALLBACK_COLOR,
        readError: ExternalCalendarReadError.Timeout,
      },
      {
        id: "64000000-0000-4000-8000-000000000004",
        name: "",
        color: EXTERNAL_CALENDAR_FALLBACK_COLOR,
        readError: null,
      },
    ]);
  });
});

describe("a period's events", () => {
  test("are those of the shown calendars touching the period, a day wider each side for the all-day ones", () => {
    const query: Query<ScheduledMaintenanceExternalCalendarEvent> =
      getOverlayRangeQuery({
        calendarIds: [HOLIDAYS_ID],
        instants: {
          startTime: new Date("2026-09-27T00:00:00.000Z"),
          endTime: new Date("2026-11-08T00:00:00.000Z"),
        },
      });

    const record: Record<string, unknown> = query as Record<string, unknown>;

    expect(record["scheduledMaintenanceExternalCalendarId"]).toBeInstanceOf(
      Includes,
    );
    expect(
      (record["scheduledMaintenanceExternalCalendarId"] as Includes).values,
    ).toEqual([HOLIDAYS_ID]);
    expect(record["startsAt"]).toBeInstanceOf(LessThanOrEqual);
    expect(
      (
        (record["startsAt"] as LessThanOrEqual<Date>).value as Date
      ).toISOString(),
    ).toBe("2026-11-09T00:00:00.000Z");
    expect(record["endsAt"]).toBeInstanceOf(GreaterThanOrEqual);
    expect(
      (
        (record["endsAt"] as GreaterThanOrEqual<Date>).value as Date
      ).toISOString(),
    ).toBe("2026-09-26T00:00:00.000Z");
    expect(MAINTENANCE_CALENDAR_OVERLAY_LIMIT).toBe(500);
  });
});

describe("how an event is drawn", () => {
  test("an all-day event falls on its own dates whatever the reader's zone, its last day included", () => {
    for (const timezone of [
      "UTC",
      "America/Los_Angeles",
      "Pacific/Kiritimati",
      "Asia/Kolkata",
    ]) {
      const [holiday]: Array<MaintenanceCalendarOverlayEvent> = overlays(
        [
          event({
            calendarId: HOLIDAYS_ID,
            title: "Autumn break",
            startsAt: "2026-10-26T00:00:00.000Z",
            endsAt: "2026-10-28T00:00:00.000Z",
            isAllDay: true,
          }),
        ],
        timezone,
      );

      expect({ timezone, start: holiday!.start, end: holiday!.end }).toEqual({
        timezone,
        start: new Date(2026, 9, 26),
        end: new Date(2026, 9, 28),
      });
      expect(holiday!.allDay).toBe(true);
      expect(holiday!.desc).toBe(
        "Autumn break\nPublic holidays · 26-27, all day",
      );
    }
  });

  test("an all-day event with no length lasts its one day", () => {
    const [holiday]: Array<MaintenanceCalendarOverlayEvent> = overlays([
      event({
        calendarId: HOLIDAYS_ID,
        title: "Founders' Day",
        startsAt: "2026-10-05T00:00:00.000Z",
        endsAt: "2026-10-05T00:00:00.000Z",
        isAllDay: true,
      }),
    ]);

    expect(holiday!.start).toEqual(new Date(2026, 9, 5));
    expect(holiday!.end).toEqual(new Date(2026, 9, 6));
    expect(holiday!.desc).toBe("Founders' Day\nPublic holidays · 5-5, all day");
  });

  test("a timed event is shown at its time in the reader's zone", () => {
    const [utc]: Array<MaintenanceCalendarOverlayEvent> = overlays([
      event({
        calendarId: FREEZES_ID,
        title: "Release window",
        startsAt: "2026-10-15T14:00:00.000Z",
        endsAt: "2026-10-15T16:00:00.000Z",
      }),
    ]);

    expect(utc!.start).toEqual(new Date(2026, 9, 15, 14, 0));
    expect(utc!.end).toEqual(new Date(2026, 9, 15, 16, 0));
    expect(utc!.allDay).toBe(false);

    const [newYork]: Array<MaintenanceCalendarOverlayEvent> = overlays(
      [
        event({
          calendarId: FREEZES_ID,
          title: "Release window",
          startsAt: "2026-10-15T14:00:00.000Z",
          endsAt: "2026-10-15T16:00:00.000Z",
        }),
      ],
      "America/New_York",
    );

    // 14:00 UTC is 10:00 in New York in October.
    expect(newYork!.start).toEqual(new Date(2026, 9, 15, 10, 0));
    expect(newYork!.end).toEqual(new Date(2026, 9, 15, 12, 0));
    expect(newYork!.desc).toBe(
      "Release window\nChange freezes · 2026-10-15T14:00:00.000Z to 2026-10-15T16:00:00.000Z",
    );
  });

  test("is an overlay in its calendar's colour, with an id clear of the project's own events", () => {
    const drawn: Array<MaintenanceCalendarOverlayEvent> = overlays([
      event({
        calendarId: HOLIDAYS_ID,
        title: "One",
        startsAt: "2026-10-05T00:00:00.000Z",
        endsAt: "2026-10-06T00:00:00.000Z",
        isAllDay: true,
      }),
      event({
        calendarId: FREEZES_ID,
        title: "Two",
        startsAt: "2026-10-06T09:00:00.000Z",
        endsAt: "2026-10-06T10:00:00.000Z",
      }),
    ]);

    expect(
      drawn.map((item: MaintenanceCalendarOverlayEvent) => {
        return [
          item.id,
          item.appearance,
          item.color,
          item.externalCalendarId,
          item.calendarName,
          isOverlayEvent(item),
        ];
      }),
    ).toEqual([
      [
        MAINTENANCE_CALENDAR_OVERLAY_ID_OFFSET,
        "overlay",
        "#0d9488",
        HOLIDAYS_ID,
        "Public holidays",
        true,
      ],
      [
        MAINTENANCE_CALENDAR_OVERLAY_ID_OFFSET + 1,
        "overlay",
        "#d97706",
        FREEZES_ID,
        "Change freezes",
        true,
      ],
    ]);

    expect(
      isOverlayEvent({
        id: 1,
        title: "Own",
        start: new Date(),
        end: new Date(),
      }),
    ).toBe(false);
  });

  test("an event with no title says Busy, in the reader's words", () => {
    const [busy]: Array<MaintenanceCalendarOverlayEvent> = overlays([
      event({
        calendarId: FREEZES_ID,
        title: "   ",
        startsAt: "2026-10-06T09:00:00.000Z",
        endsAt: "2026-10-06T10:00:00.000Z",
      }),
    ]);

    expect(busy!.title).toBe("Busy");
  });

  test("an event of a calendar not on the page, or with impossible times, is left out; one that ends before it starts lasts no time", () => {
    const drawn: Array<MaintenanceCalendarOverlayEvent> = overlays([
      event({
        calendarId: "64000000-0000-4000-8000-000000000099",
        title: "Another calendar's",
        startsAt: "2026-10-06T09:00:00.000Z",
        endsAt: "2026-10-06T10:00:00.000Z",
      }),
      event({
        calendarId: FREEZES_ID,
        title: "Bad date",
        startsAt: "not a date",
        endsAt: "2026-10-06T10:00:00.000Z",
      }),
      event({
        calendarId: FREEZES_ID,
        title: "Backwards",
        startsAt: "2026-10-06T10:00:00.000Z",
        endsAt: "2026-10-06T09:00:00.000Z",
      }),
    ]);

    expect(
      drawn.map((item: MaintenanceCalendarOverlayEvent) => {
        return [item.title, item.start.getTime() === item.end.getTime()];
      }),
    ).toEqual([["Backwards", true]]);
  });
});

describe("a reader who had left the old List | Calendar switch on Calendar", () => {
  test("is moved to the calendar once, and the old choice is forgotten either way", () => {
    const calendar: Storage & { values: Record<string, string> } =
      memoryStorage({
        [PREVIOUS_VIEW_STORAGE_KEY]: ScheduledMaintenanceView.Calendar,
      });

    expect(PREVIOUS_VIEW_STORAGE_KEY).toBe(
      "oneuptime.scheduled-maintenance-view",
    );
    expect(takePreviousCalendarChoice(calendar)).toBe(true);
    expect(calendar.values).toEqual({});
    expect(takePreviousCalendarChoice(calendar)).toBe(false);

    const list: Storage & { values: Record<string, string> } = memoryStorage({
      [PREVIOUS_VIEW_STORAGE_KEY]: ScheduledMaintenanceView.List,
    });

    expect(takePreviousCalendarChoice(list)).toBe(false);
    expect(list.values).toEqual({});
  });

  test("with no choice, no storage, or storage that refuses, nothing moves", () => {
    expect(takePreviousCalendarChoice(memoryStorage())).toBe(false);
    expect(takePreviousCalendarChoice(null)).toBe(false);
    expect(takePreviousCalendarChoice(REFUSING_STORAGE)).toBe(false);
  });
});
