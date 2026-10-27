/**
 * @timezone UTC
 */
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import UptimeBarTooltipMaintenance from "../../../Types/Monitor/UptimeBarTooltipMaintenance";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import { ScheduledMaintenancePhaseOfState } from "../../../Utils/ScheduledMaintenanceStart";
import DayUptimeGraphUtil, {
  UptimeGraphDay,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
import UptimeMaintenanceUtil, {
  MAINTENANCE_WINDOW_SEPARATOR,
  MaintenanceSpan,
} from "../../../Utils/Uptime/UptimeMaintenanceUtil";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Which days of the uptime history a scheduled maintenance event belongs
 * to, and how its window reads (Common/Utils/Uptime/UptimeMaintenanceUtil).
 *
 * An event belongs to every day its planned window - Starts At to Ends At -
 * touches, in the zone the strip draws its days in; one in progress belongs
 * to every day up to now as well, however its window says otherwise. These
 * cases run in UTC (the docblock above), so a "day" here is a UTC day; the
 * zone cases are at the end, with strips drawn in other zones.
 */

const NOW: Date = new Date("2026-10-26T15:30:00.000Z");

const MONITOR_A: string = "a1000000-0000-4000-8000-000000000001";
const MONITOR_B: string = "a1000000-0000-4000-8000-000000000002";
const MONITOR_C: string = "a1000000-0000-4000-8000-000000000003";

function at(iso: string): Date {
  return new Date(iso);
}

function event(data: {
  id?: string;
  title?: string;
  startsAt: string;
  endsAt: string;
  phase?: ScheduledMaintenancePhaseOfState | null;
  monitorIds?: Array<string>;
}): UptimeBarTooltipMaintenance {
  return {
    id: data.id || "e1000000-0000-4000-8000-000000000001",
    title: data.title || "Database upgrade",
    startsAt: at(data.startsAt),
    endsAt: at(data.endsAt),
    currentState: { name: "Completed", color: new Color("#16a34a") },
    phase:
      data.phase === undefined
        ? ScheduledMaintenancePhaseOfState.Over
        : data.phase,
    monitorIds: (data.monitorIds || [MONITOR_A]).map((id: string) => {
      return new ObjectID(id);
    }),
  };
}

// One UTC day, as DayUptimeGraphUtil.getDays draws it.
function utcDay(date: string): { dayStart: Date; dayEnd: Date } {
  const dayStart: Date = at(`${date}T00:00:00.000Z`);

  return {
    dayStart: dayStart,
    dayEnd: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1),
  };
}

function isOn(item: UptimeBarTooltipMaintenance, date: string): boolean {
  return UptimeMaintenanceUtil.isOnDay({
    event: item,
    ...utcDay(date),
    now: NOW,
  });
}

function spanOf(item: UptimeBarTooltipMaintenance): MaintenanceSpan | null {
  return UptimeMaintenanceUtil.getSpan({ event: item, now: NOW });
}

describe("the span an event stands for", () => {
  test("is its planned window when it is over", () => {
    const span: MaintenanceSpan | null = spanOf(
      event({
        startsAt: "2026-10-21T16:00:00.000Z",
        endsAt: "2026-10-22T02:00:00.000Z",
      }),
    );

    expect(span?.start.toISOString()).toBe("2026-10-21T16:00:00.000Z");
    expect(span?.end.toISOString()).toBe("2026-10-22T02:00:00.000Z");
  });

  test("runs on to now while the event is in progress past its planned end", () => {
    const span: MaintenanceSpan | null = spanOf(
      event({
        startsAt: "2026-10-24T22:00:00.000Z",
        endsAt: "2026-10-25T02:00:00.000Z",
        phase: ScheduledMaintenancePhaseOfState.InProgress,
      }),
    );

    expect(span?.start.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(span?.end.toISOString()).toBe(NOW.toISOString());
  });

  test("keeps a later planned end while the event is in progress", () => {
    const span: MaintenanceSpan | null = spanOf(
      event({
        startsAt: "2026-10-26T14:00:00.000Z",
        endsAt: "2026-10-27T02:00:00.000Z",
        phase: ScheduledMaintenancePhaseOfState.InProgress,
      }),
    );

    expect(span?.end.toISOString()).toBe("2026-10-27T02:00:00.000Z");
  });

  test("starts no later than now for an event started early by hand", () => {
    const span: MaintenanceSpan | null = spanOf(
      event({
        startsAt: "2026-10-26T18:00:00.000Z",
        endsAt: "2026-10-26T20:00:00.000Z",
        phase: ScheduledMaintenancePhaseOfState.InProgress,
      }),
    );

    expect(span?.start.toISOString()).toBe(NOW.toISOString());
    expect(span?.end.toISOString()).toBe("2026-10-26T20:00:00.000Z");
  });

  test.each([
    ["over", ScheduledMaintenancePhaseOfState.Over],
    ["not started", ScheduledMaintenancePhaseOfState.NotStarted],
    ["in a state nobody could place", null],
  ] as Array<[string, ScheduledMaintenancePhaseOfState | null]>)(
    "is never stretched to now for an event %s",
    (_label: string, phase: ScheduledMaintenancePhaseOfState | null) => {
      const span: MaintenanceSpan | null = spanOf(
        event({
          startsAt: "2026-10-20T10:00:00.000Z",
          endsAt: "2026-10-20T11:00:00.000Z",
          phase: phase,
        }),
      );

      expect(span?.end.toISOString()).toBe("2026-10-20T11:00:00.000Z");
    },
  );

  test("reads an end before the start as no length at all", () => {
    const span: MaintenanceSpan | null = spanOf(
      event({
        startsAt: "2026-10-20T10:00:00.000Z",
        endsAt: "2026-10-19T10:00:00.000Z",
      }),
    );

    expect(span?.start.toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(span?.end.toISOString()).toBe("2026-10-20T10:00:00.000Z");
  });

  test("is null for an event with no start to place it by", () => {
    const item: UptimeBarTooltipMaintenance = event({
      startsAt: "2026-10-20T10:00:00.000Z",
      endsAt: "2026-10-20T11:00:00.000Z",
    });

    item.startsAt = new Date("not a date");

    expect(spanOf(item)).toBeNull();
    expect(isOn(item, "2026-10-20")).toBe(false);
  });

  test("reads dates that arrived as text", () => {
    const item: UptimeBarTooltipMaintenance = event({
      startsAt: "2026-10-20T10:00:00.000Z",
      endsAt: "2026-10-20T11:00:00.000Z",
    });

    (item as unknown as Record<string, unknown>)["startsAt"] =
      "2026-10-20T10:00:00.000Z";
    (item as unknown as Record<string, unknown>)["endsAt"] =
      "2026-10-20T11:00:00.000Z";

    expect(spanOf(item)?.end.toISOString()).toBe("2026-10-20T11:00:00.000Z");
    expect(isOn(item, "2026-10-20")).toBe(true);
  });
});

describe("the days an event belongs to", () => {
  test("is the one day of a window inside it", () => {
    const item: UptimeBarTooltipMaintenance = event({
      startsAt: "2026-10-20T10:00:00.000Z",
      endsAt: "2026-10-20T12:00:00.000Z",
    });

    expect(isOn(item, "2026-10-19")).toBe(false);
    expect(isOn(item, "2026-10-20")).toBe(true);
    expect(isOn(item, "2026-10-21")).toBe(false);
  });

  test("is every day a window spanning days touches, first, middle and last", () => {
    // The issue's own event: 18:00 CEST on Oct 21 into Oct 23.
    const item: UptimeBarTooltipMaintenance = event({
      startsAt: "2026-10-21T16:00:00.000Z",
      endsAt: "2026-10-23T14:29:00.000Z",
    });

    expect(isOn(item, "2026-10-20")).toBe(false);
    expect(isOn(item, "2026-10-21")).toBe(true);
    expect(isOn(item, "2026-10-22")).toBe(true);
    expect(isOn(item, "2026-10-23")).toBe(true);
    expect(isOn(item, "2026-10-24")).toBe(false);
  });

  test("leaves out the day that starts at the very moment the window ends", () => {
    const item: UptimeBarTooltipMaintenance = event({
      startsAt: "2026-10-20T22:00:00.000Z",
      endsAt: "2026-10-21T00:00:00.000Z",
    });

    expect(isOn(item, "2026-10-20")).toBe(true);
    expect(isOn(item, "2026-10-21")).toBe(false);
  });

  test("takes in the day that starts at the very moment the window starts", () => {
    const item: UptimeBarTooltipMaintenance = event({
      startsAt: "2026-10-21T00:00:00.000Z",
      endsAt: "2026-10-21T01:00:00.000Z",
    });

    expect(isOn(item, "2026-10-20")).toBe(false);
    expect(isOn(item, "2026-10-21")).toBe(true);
  });

  test("puts a window of no length on the day it falls in, and only that day", () => {
    const atMidnight: UptimeBarTooltipMaintenance = event({
      startsAt: "2026-10-21T00:00:00.000Z",
      endsAt: "2026-10-21T00:00:00.000Z",
    });

    expect(isOn(atMidnight, "2026-10-20")).toBe(false);
    expect(isOn(atMidnight, "2026-10-21")).toBe(true);

    const lastMillisecond: UptimeBarTooltipMaintenance = event({
      startsAt: "2026-10-20T23:59:59.999Z",
      endsAt: "2026-10-20T23:59:59.999Z",
    });

    expect(isOn(lastMillisecond, "2026-10-20")).toBe(true);
    expect(isOn(lastMillisecond, "2026-10-21")).toBe(false);
  });

  test("runs an event in progress past its planned end on to today", () => {
    const item: UptimeBarTooltipMaintenance = event({
      startsAt: "2026-10-23T22:00:00.000Z",
      endsAt: "2026-10-24T02:00:00.000Z",
      phase: ScheduledMaintenancePhaseOfState.InProgress,
    });

    expect(isOn(item, "2026-10-23")).toBe(true);
    expect(isOn(item, "2026-10-24")).toBe(true);
    expect(isOn(item, "2026-10-25")).toBe(true);
    expect(isOn(item, "2026-10-26")).toBe(true);
  });

  test("puts an event over on its planned days only, however long ago it ended", () => {
    const item: UptimeBarTooltipMaintenance = event({
      startsAt: "2026-10-23T22:00:00.000Z",
      endsAt: "2026-10-24T02:00:00.000Z",
      phase: ScheduledMaintenancePhaseOfState.Over,
    });

    expect(isOn(item, "2026-10-25")).toBe(false);
    expect(isOn(item, "2026-10-26")).toBe(false);
  });

  test("puts an event started early by hand on today, not on its planned day", () => {
    const item: UptimeBarTooltipMaintenance = event({
      startsAt: "2026-10-27T01:00:00.000Z",
      endsAt: "2026-10-27T03:00:00.000Z",
      phase: ScheduledMaintenancePhaseOfState.InProgress,
    });

    expect(isOn(item, "2026-10-26")).toBe(true);
  });
});

describe("a day's events", () => {
  const day: { dayStart: Date; dayEnd: Date } = utcDay("2026-10-21");

  test("are the events that touch it, earliest first, then by title", () => {
    const late: UptimeBarTooltipMaintenance = event({
      id: "e1000000-0000-4000-8000-00000000000a",
      title: "Late window",
      startsAt: "2026-10-21T20:00:00.000Z",
      endsAt: "2026-10-21T21:00:00.000Z",
    });
    const early: UptimeBarTooltipMaintenance = event({
      id: "e1000000-0000-4000-8000-00000000000b",
      title: "Early window",
      startsAt: "2026-10-21T06:00:00.000Z",
      endsAt: "2026-10-21T07:00:00.000Z",
    });
    const sameStartB: UptimeBarTooltipMaintenance = event({
      id: "e1000000-0000-4000-8000-00000000000c",
      title: "B window",
      startsAt: "2026-10-21T12:00:00.000Z",
      endsAt: "2026-10-21T13:00:00.000Z",
    });
    const sameStartA: UptimeBarTooltipMaintenance = event({
      id: "e1000000-0000-4000-8000-00000000000d",
      title: "A window",
      startsAt: "2026-10-21T12:00:00.000Z",
      endsAt: "2026-10-21T14:00:00.000Z",
    });
    const otherDay: UptimeBarTooltipMaintenance = event({
      id: "e1000000-0000-4000-8000-00000000000e",
      title: "Another day",
      startsAt: "2026-10-22T06:00:00.000Z",
      endsAt: "2026-10-22T07:00:00.000Z",
    });

    expect(
      UptimeMaintenanceUtil.getEventsForDay({
        events: [late, otherDay, sameStartB, early, sameStartA],
        ...day,
        now: NOW,
      }).map((item: UptimeBarTooltipMaintenance): string => {
        return item.title;
      }),
    ).toEqual(["Early window", "A window", "B window", "Late window"]);
  });

  test("starts with an event that began the day before and runs into it", () => {
    expect(
      UptimeMaintenanceUtil.getEventsForDay({
        events: [
          event({
            title: "Overnight",
            startsAt: "2026-10-20T22:00:00.000Z",
            endsAt: "2026-10-21T03:00:00.000Z",
          }),
        ],
        ...day,
        now: NOW,
      }).map((item: UptimeBarTooltipMaintenance): string => {
        return item.title;
      }),
    ).toEqual(["Overnight"]);
  });

  test("are none for a day nothing touched", () => {
    expect(
      UptimeMaintenanceUtil.getEventsForDay({
        events: [],
        ...day,
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("leave the events given untouched", () => {
    const events: Array<UptimeBarTooltipMaintenance> = [
      event({
        id: "e1000000-0000-4000-8000-00000000000f",
        title: "Second",
        startsAt: "2026-10-21T12:00:00.000Z",
        endsAt: "2026-10-21T13:00:00.000Z",
      }),
      event({
        id: "e1000000-0000-4000-8000-000000000010",
        title: "First",
        startsAt: "2026-10-21T06:00:00.000Z",
        endsAt: "2026-10-21T07:00:00.000Z",
      }),
    ];

    UptimeMaintenanceUtil.getEventsForDay({ events, ...day, now: NOW });

    expect(
      events.map((item: UptimeBarTooltipMaintenance): string => {
        return item.title;
      }),
    ).toEqual(["Second", "First"]);
  });
});

describe("the events of a status page resource", () => {
  const onA: UptimeBarTooltipMaintenance = event({
    id: "e2000000-0000-4000-8000-000000000001",
    title: "On A",
    startsAt: "2026-10-21T06:00:00.000Z",
    endsAt: "2026-10-21T07:00:00.000Z",
    monitorIds: [MONITOR_A],
  });
  const onAAndB: UptimeBarTooltipMaintenance = event({
    id: "e2000000-0000-4000-8000-000000000002",
    title: "On A and B",
    startsAt: "2026-10-21T06:00:00.000Z",
    endsAt: "2026-10-21T07:00:00.000Z",
    monitorIds: [MONITOR_A, MONITOR_B],
  });
  const onC: UptimeBarTooltipMaintenance = event({
    id: "e2000000-0000-4000-8000-000000000003",
    title: "On C",
    startsAt: "2026-10-21T06:00:00.000Z",
    endsAt: "2026-10-21T07:00:00.000Z",
    monitorIds: [MONITOR_C],
  });
  const onNothing: UptimeBarTooltipMaintenance = event({
    id: "e2000000-0000-4000-8000-000000000004",
    title: "On nothing",
    startsAt: "2026-10-21T06:00:00.000Z",
    endsAt: "2026-10-21T07:00:00.000Z",
    monitorIds: [],
  });

  function titles(monitorIds: Array<ObjectID | string>): Array<string> {
    return UptimeMaintenanceUtil.getEventsForMonitors({
      events: [onA, onAAndB, onC, onNothing],
      monitorIds: monitorIds,
    }).map((item: UptimeBarTooltipMaintenance): string => {
      return item.title;
    });
  }

  test("a monitor's are the events that hold it", () => {
    expect(titles([MONITOR_B])).toEqual(["On A and B"]);
    expect(titles([MONITOR_A])).toEqual(["On A", "On A and B"]);
  });

  test("a monitor group's are the events that hold any monitor in it", () => {
    expect(titles([MONITOR_B, MONITOR_C])).toEqual(["On A and B", "On C"]);
  });

  test("ids match however they are written", () => {
    expect(titles([new ObjectID(MONITOR_C)])).toEqual(["On C"]);
    expect(titles([` ${MONITOR_C.toUpperCase()} `])).toEqual(["On C"]);
  });

  test("an event that holds none of the page's monitors is on no resource", () => {
    expect(titles([MONITOR_A, MONITOR_B, MONITOR_C])).not.toContain(
      "On nothing",
    );
  });

  test("a resource with no monitors has none", () => {
    expect(titles([])).toEqual([]);
    expect(titles([""])).toEqual([]);
  });
});

describe("the events in progress", () => {
  test("are those in progress, and only those", () => {
    const events: Array<UptimeBarTooltipMaintenance> = [
      event({
        title: "Running",
        startsAt: "2026-10-26T14:00:00.000Z",
        endsAt: "2026-10-26T18:00:00.000Z",
        phase: ScheduledMaintenancePhaseOfState.InProgress,
      }),
      event({
        title: "Done",
        startsAt: "2026-10-26T10:00:00.000Z",
        endsAt: "2026-10-26T11:00:00.000Z",
        phase: ScheduledMaintenancePhaseOfState.Over,
      }),
      event({
        title: "Unplaced",
        startsAt: "2026-10-26T10:00:00.000Z",
        endsAt: "2026-10-26T18:00:00.000Z",
        phase: null,
      }),
    ];

    expect(
      UptimeMaintenanceUtil.getEventsInProgress(events).map(
        (item: UptimeBarTooltipMaintenance): string => {
          return item.title;
        },
      ),
    ).toEqual(["Running"]);
  });
});

describe("how a window reads", () => {
  let prefers12Hour: boolean = false;

  beforeEach(() => {
    prefers12Hour = false;
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockImplementation((): boolean => {
        return prefers12Hour;
      });

    /*
     * The reader's own zone, as a signed-in reader sets it, so the window
     * reads on their clock whatever zone the browser runs in: Paris, as in
     * the issue (18:00 CEST is 16:00 UTC).
     */
    OneUptimeDate.setUserTimezone("Europe/Paris" as Timezone);
  });

  afterEach(() => {
    OneUptimeDate.setUserTimezone(null);
    setDateDisplayLanguage(null);
    jest.restoreAllMocks();
  });

  test("the reader's zone is the one they set, not the strip's", () => {
    expect(OneUptimeDate.getCurrentTimezone().toString()).toBe("Europe/Paris");
  });

  test("names the day once within a day, and the zone once at the end", () => {
    expect(
      UptimeMaintenanceUtil.formatWindow({
        startsAt: at("2026-10-21T16:00:00.000Z"),
        endsAt: at("2026-10-21T18:00:00.000Z"),
      }),
    ).toBe(`Oct 21, 18:00${MAINTENANCE_WINDOW_SEPARATOR}20:00 CEST`);
  });

  test("names both days across days", () => {
    expect(
      UptimeMaintenanceUtil.formatWindow({
        startsAt: at("2026-10-21T16:00:00.000Z"),
        endsAt: at("2026-10-22T00:00:00.000Z"),
      }),
    ).toBe(`Oct 21, 18:00${MAINTENANCE_WINDOW_SEPARATOR}Oct 22, 02:00 CEST`);
  });

  test("is on the reader's clock: a window within one UTC day can span two of theirs", () => {
    expect(
      UptimeMaintenanceUtil.formatWindow({
        startsAt: at("2026-10-21T21:00:00.000Z"),
        endsAt: at("2026-10-21T23:00:00.000Z"),
      }),
    ).toBe(`Oct 21, 23:00${MAINTENANCE_WINDOW_SEPARATOR}Oct 22, 01:00 CEST`);
  });

  test("names the zone at both ends when the clocks change inside the window", () => {
    // Paris goes back an hour at 03:00 CEST on Oct 25, 2026.
    expect(
      UptimeMaintenanceUtil.formatWindow({
        startsAt: at("2026-10-25T00:30:00.000Z"),
        endsAt: at("2026-10-25T02:30:00.000Z"),
      }),
    ).toBe(
      `Oct 25, 02:30 CEST${MAINTENANCE_WINDOW_SEPARATOR}03:30 CET`,
    );
  });

  test("follows the reader's 12-hour clock", () => {
    prefers12Hour = true;

    expect(
      UptimeMaintenanceUtil.formatWindow({
        startsAt: at("2026-10-21T16:00:00.000Z"),
        endsAt: at("2026-10-21T18:30:00.000Z"),
      }),
    ).toBe(`Oct 21, 6:00 PM${MAINTENANCE_WINDOW_SEPARATOR}8:30 PM CEST`);
  });

  test("reads an end before the start as the start", () => {
    expect(
      UptimeMaintenanceUtil.formatWindow({
        startsAt: at("2026-10-21T16:00:00.000Z"),
        endsAt: at("2026-10-21T15:00:00.000Z"),
      }),
    ).toBe(`Oct 21, 18:00${MAINTENANCE_WINDOW_SEPARATOR}18:00 CEST`);
  });

  test("is empty for a window with no start", () => {
    expect(
      UptimeMaintenanceUtil.formatWindow({
        startsAt: new Date("not a date"),
        endsAt: at("2026-10-21T17:00:00.000Z"),
      }),
    ).toBe("");
  });

  test("is written in the reader's language, both ends", () => {
    setDateDisplayLanguage("de");

    const text: string = UptimeMaintenanceUtil.formatWindow({
      startsAt: at("2026-10-21T16:00:00.000Z"),
      endsAt: at("2026-10-22T00:00:00.000Z"),
    });

    const [start, end] = text.split(MAINTENANCE_WINDOW_SEPARATOR) as [
      string,
      string,
    ];

    expect(start).toContain("Okt");
    expect(start).toContain("21");
    expect(start).toContain("18:00");
    expect(end).toContain("Okt");
    expect(end).toContain("22");
    expect(end).toContain("02:00");
    expect(end.endsWith(" CEST")).toBe(true);
    expect(text).not.toContain("Oct");
  });

  test("writes the end's time of day in the reader's language too", () => {
    setDateDisplayLanguage("ko");
    prefers12Hour = true;

    const text: string = UptimeMaintenanceUtil.formatWindow({
      startsAt: at("2026-10-21T16:00:00.000Z"),
      endsAt: at("2026-10-21T18:00:00.000Z"),
    });

    const end: string = text.split(MAINTENANCE_WINDOW_SEPARATOR)[1] || "";

    // Korean marks the afternoon in Hangul, not with a Latin "PM".
    expect(text).not.toContain("PM");
    expect(end).toContain("08:00");
    expect(end.endsWith(" CEST")).toBe(true);
  });

  test("keeps English dates English", () => {
    expect(
      UptimeMaintenanceUtil.formatWindow({
        startsAt: at("2026-10-21T16:00:00.000Z"),
        endsAt: at("2026-10-21T18:00:00.000Z"),
      }),
    ).toContain("Oct 21");
  });
});

describe("an event from the event as the page and the Dashboard read it", () => {
  // A project that added "Verifying" after Ongoing and "Reviewing" after Ended.
  function state(data: {
    id: string;
    name: string;
    order: number;
    flag?: string | undefined;
    color?: string | undefined;
  }): ScheduledMaintenanceState {
    const model: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    model._id = data.id;
    model.name = data.name;
    model.order = data.order;
    model.isScheduledState = data.flag === "scheduled";
    model.isOngoingState = data.flag === "ongoing";
    model.isEndedState = data.flag === "ended";
    model.isResolvedState = data.flag === "completed";

    if (data.color) {
      model.color = new Color(data.color);
    }

    return model;
  }

  const SCHEDULED: ScheduledMaintenanceState = state({
    id: "5c000000-0000-4000-8000-000000000001",
    name: "Scheduled",
    order: 1,
    flag: "scheduled",
    color: "#000000",
  });
  const ONGOING: ScheduledMaintenanceState = state({
    id: "5c000000-0000-4000-8000-000000000002",
    name: "Ongoing",
    order: 2,
    flag: "ongoing",
    color: "#eab308",
  });
  const VERIFYING: ScheduledMaintenanceState = state({
    id: "5c000000-0000-4000-8000-000000000003",
    name: "Verifying",
    order: 3,
  });
  const ENDED: ScheduledMaintenanceState = state({
    id: "5c000000-0000-4000-8000-000000000004",
    name: "Ended",
    order: 4,
    flag: "ended",
  });
  const REVIEWING: ScheduledMaintenanceState = state({
    id: "5c000000-0000-4000-8000-000000000005",
    name: "Reviewing",
    order: 5,
    color: "#7c3aed",
  });
  const COMPLETED: ScheduledMaintenanceState = state({
    id: "5c000000-0000-4000-8000-000000000006",
    name: "Completed",
    order: 6,
    flag: "completed",
    color: "#16a34a",
  });

  const STATES: Array<ScheduledMaintenanceState> = [
    SCHEDULED,
    ONGOING,
    VERIFYING,
    ENDED,
    REVIEWING,
    COMPLETED,
  ];

  function maintenance(data: {
    id?: string | undefined;
    title?: string | undefined;
    startsAt?: Date | undefined;
    endsAt?: Date | undefined;
    state?: ScheduledMaintenanceState | undefined;
    monitorIds?: Array<string> | undefined;
  }): ScheduledMaintenance {
    const model: ScheduledMaintenance = new ScheduledMaintenance();

    if (data.id !== "") {
      model._id = data.id || "e3000000-0000-4000-8000-000000000001";
    }

    model.title = data.title ?? "Patch the API servers";

    if (data.startsAt !== undefined) {
      model.startsAt = data.startsAt;
    }

    if (data.endsAt !== undefined) {
      model.endsAt = data.endsAt;
    }

    if (data.state) {
      model.currentScheduledMaintenanceState = data.state;
    }

    model.monitors = (data.monitorIds || []).map((id: string): Monitor => {
      const monitor: Monitor = new Monitor();
      monitor._id = id;
      return monitor;
    });

    return model;
  }

  test("carries its id, title, window, state and monitors", () => {
    const item: UptimeBarTooltipMaintenance | null =
      UptimeMaintenanceUtil.fromScheduledMaintenance({
        event: maintenance({
          startsAt: at("2026-10-21T16:00:00.000Z"),
          endsAt: at("2026-10-22T02:00:00.000Z"),
          state: COMPLETED,
          monitorIds: [MONITOR_A, MONITOR_B],
        }),
        states: STATES,
      });

    expect(item).not.toBeNull();
    expect(item!.id).toBe("e3000000-0000-4000-8000-000000000001");
    expect(item!.title).toBe("Patch the API servers");
    expect(item!.startsAt.toISOString()).toBe("2026-10-21T16:00:00.000Z");
    expect(item!.endsAt.toISOString()).toBe("2026-10-22T02:00:00.000Z");
    expect(item!.currentState?.name).toBe("Completed");
    expect(item!.currentState?.color.toString()).toBe("#16a34a");
    expect(item!.phase).toBe(ScheduledMaintenancePhaseOfState.Over);
    expect(
      item!.monitorIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([MONITOR_A, MONITOR_B]);
  });

  test.each([
    ["Ongoing", ONGOING, ScheduledMaintenancePhaseOfState.InProgress],
    // A state of the project's own between Ongoing and Ended is in progress.
    ["Verifying", VERIFYING, ScheduledMaintenancePhaseOfState.InProgress],
    ["Ended", ENDED, ScheduledMaintenancePhaseOfState.Over],
    // ... and one after Ended is over.
    ["Reviewing", REVIEWING, ScheduledMaintenancePhaseOfState.Over],
    ["Completed", COMPLETED, ScheduledMaintenancePhaseOfState.Over],
    ["Scheduled", SCHEDULED, ScheduledMaintenancePhaseOfState.NotStarted],
  ] as Array<
    [string, ScheduledMaintenanceState, ScheduledMaintenancePhaseOfState]
  >)(
    "places an event in %s by the project's states",
    (
      _name: string,
      currentState: ScheduledMaintenanceState,
      phase: ScheduledMaintenancePhaseOfState,
    ) => {
      expect(
        UptimeMaintenanceUtil.fromScheduledMaintenance({
          event: maintenance({
            startsAt: at("2026-10-21T16:00:00.000Z"),
            endsAt: at("2026-10-22T02:00:00.000Z"),
            state: currentState,
          }),
          states: STATES,
        })?.phase,
      ).toBe(phase);
    },
  );

  test("names the state in the reader's language when asked to", () => {
    const item: UptimeBarTooltipMaintenance | null =
      UptimeMaintenanceUtil.fromScheduledMaintenance({
        event: maintenance({
          startsAt: at("2026-10-21T16:00:00.000Z"),
          endsAt: at("2026-10-22T02:00:00.000Z"),
          state: COMPLETED,
        }),
        states: STATES,
        translateStateName: (name: string): string => {
          return name === "Completed" ? "Abgeschlossen" : name;
        },
      });

    expect(item?.currentState?.name).toBe("Abgeschlossen");
  });

  test("keeps the stored name when the translation has none", () => {
    const item: UptimeBarTooltipMaintenance | null =
      UptimeMaintenanceUtil.fromScheduledMaintenance({
        event: maintenance({
          startsAt: at("2026-10-21T16:00:00.000Z"),
          endsAt: at("2026-10-22T02:00:00.000Z"),
          state: REVIEWING,
        }),
        states: STATES,
        translateStateName: (): string => {
          return "";
        },
      });

    expect(item?.currentState?.name).toBe("Reviewing");
    expect(item?.currentState?.color.toString()).toBe("#7c3aed");
  });

  test("draws a state with no colour in a neutral grey", () => {
    expect(
      UptimeMaintenanceUtil.fromScheduledMaintenance({
        event: maintenance({
          startsAt: at("2026-10-21T16:00:00.000Z"),
          endsAt: at("2026-10-22T02:00:00.000Z"),
          state: VERIFYING,
        }),
        states: STATES,
      })?.currentState?.color.toString(),
    ).toBe("#6b7280");
  });

  test("has no state and no phase when its state was not read", () => {
    const item: UptimeBarTooltipMaintenance | null =
      UptimeMaintenanceUtil.fromScheduledMaintenance({
        event: maintenance({
          startsAt: at("2026-10-21T16:00:00.000Z"),
          endsAt: at("2026-10-22T02:00:00.000Z"),
        }),
        states: STATES,
      });

    expect(item?.currentState).toBeUndefined();
    expect(item?.phase).toBeNull();
  });

  test("ends where it starts when it has no end", () => {
    expect(
      UptimeMaintenanceUtil.fromScheduledMaintenance({
        event: maintenance({
          startsAt: at("2026-10-21T16:00:00.000Z"),
          state: COMPLETED,
        }),
        states: STATES,
      })?.endsAt.toISOString(),
    ).toBe("2026-10-21T16:00:00.000Z");
  });

  test("is nothing without an id or a start", () => {
    expect(
      UptimeMaintenanceUtil.fromScheduledMaintenance({
        event: maintenance({
          id: "",
          startsAt: at("2026-10-21T16:00:00.000Z"),
          endsAt: at("2026-10-22T02:00:00.000Z"),
        }),
        states: STATES,
      }),
    ).toBeNull();

    expect(
      UptimeMaintenanceUtil.fromScheduledMaintenance({
        event: maintenance({ endsAt: at("2026-10-22T02:00:00.000Z") }),
        states: STATES,
      }),
    ).toBeNull();
  });

  test("the many leave out what does not convert, keeping the order", () => {
    expect(
      UptimeMaintenanceUtil.fromScheduledMaintenances({
        events: [
          maintenance({
            id: "e3000000-0000-4000-8000-00000000000a",
            title: "First",
            startsAt: at("2026-10-21T16:00:00.000Z"),
            endsAt: at("2026-10-21T17:00:00.000Z"),
          }),
          maintenance({ id: "", title: "No id" }),
          maintenance({
            id: "e3000000-0000-4000-8000-00000000000b",
            title: "Second",
            startsAt: at("2026-10-20T16:00:00.000Z"),
            endsAt: at("2026-10-20T17:00:00.000Z"),
          }),
        ],
        states: STATES,
      }).map((item: UptimeBarTooltipMaintenance): string => {
        return item.title;
      }),
    ).toEqual(["First", "Second"]);
  });
});

/*
 * The days are the STRIP's days: the zone it draws them in, which is not the
 * reader's. A status page draws UTC days for everyone (one cached payload),
 * the Dashboard the reader's own.
 */
describe("the days of strips drawn in other zones", () => {
  function barsTouched(data: {
    item: UptimeBarTooltipMaintenance;
    timezone: string;
    from: string;
    to: string;
  }): Array<string> {
    const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
      startDate: at(data.from),
      endDate: at(data.to),
      timezone: data.timezone,
    });

    return days
      .filter((day: UptimeGraphDay): boolean => {
        return UptimeMaintenanceUtil.isOnDay({
          event: data.item,
          dayStart: day.startOfDay,
          dayEnd: day.endOfDay,
          now: NOW,
        });
      })
      .map((day: UptimeGraphDay): string => {
        return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
          date: day.date,
          format: "YYYY-MM-DD",
          timezone: data.timezone,
        });
      });
  }

  // 23:30 to 00:30 UTC: two UTC days, one New York evening.
  const aroundUtcMidnight: UptimeBarTooltipMaintenance = event({
    startsAt: "2026-10-20T23:30:00.000Z",
    endsAt: "2026-10-21T00:30:00.000Z",
  });

  test("an hour across UTC midnight is on two bars of a UTC strip", () => {
    expect(
      barsTouched({
        item: aroundUtcMidnight,
        timezone: "UTC",
        from: "2026-10-18T12:00:00.000Z",
        to: "2026-10-24T12:00:00.000Z",
      }),
    ).toEqual(["2026-10-20", "2026-10-21"]);
  });

  test("and on one bar of a New York strip, the evening it fell in", () => {
    expect(
      barsTouched({
        item: aroundUtcMidnight,
        timezone: "America/New_York",
        from: "2026-10-18T12:00:00.000Z",
        to: "2026-10-24T12:00:00.000Z",
      }),
    ).toEqual(["2026-10-20"]);
  });

  test("and on one bar of a Tokyo strip, the morning it fell in", () => {
    expect(
      barsTouched({
        item: aroundUtcMidnight,
        timezone: "Asia/Tokyo",
        from: "2026-10-18T12:00:00.000Z",
        to: "2026-10-24T12:00:00.000Z",
      }),
    ).toEqual(["2026-10-21"]);
  });

  test("a window over the night London's clocks go back is on the 25-hour day it spans", () => {
    // 00:30 BST to 01:30 GMT on Oct 25, 2026 - the repeated hour and beyond.
    const overTheChange: UptimeBarTooltipMaintenance = event({
      startsAt: "2026-10-24T23:30:00.000Z",
      endsAt: "2026-10-25T01:30:00.000Z",
    });

    expect(
      barsTouched({
        item: overTheChange,
        timezone: "Europe/London",
        from: "2026-10-22T12:00:00.000Z",
        to: "2026-10-26T12:00:00.000Z",
      }),
    ).toEqual(["2026-10-25"]);
  });

  test("an event in progress is on today's bar of every strip", () => {
    const running: UptimeBarTooltipMaintenance = event({
      startsAt: "2026-10-23T10:00:00.000Z",
      endsAt: "2026-10-23T12:00:00.000Z",
      phase: ScheduledMaintenancePhaseOfState.InProgress,
    });

    for (const timezone of ["UTC", "America/New_York", "Asia/Tokyo"]) {
      const bars: Array<string> = barsTouched({
        item: running,
        timezone: timezone,
        from: "2026-10-20T12:00:00.000Z",
        to: NOW.toISOString(),
      });

      expect(bars[bars.length - 1]).toBe(
        OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
          date: NOW,
          format: "YYYY-MM-DD",
          timezone: timezone,
        }),
      );
    }
  });
});
