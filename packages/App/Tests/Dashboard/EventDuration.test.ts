import fs from "fs";
import path from "path";
import {
  EventStanding,
  EventTimelineDate,
  getEventEndDateForCurrentState,
  getEventDurationText,
  getEventStanding,
  getLatestTimelineDateByEventId,
  getResolvedAtByEventId,
} from "../../FeatureSet/Dashboard/src/Utils/EventDuration";

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readSource(...relativeParts: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8")
    .replace(/\s+/g, " ");
}

describe("getEventDurationText", () => {
  const startDate: Date = new Date("2026-08-01T00:00:00.000Z");
  const MINUTE: number = 60;
  const HOUR: number = 60 * MINUTE;
  const DAY: number = 24 * HOUR;

  function durationOf(seconds: number): string {
    return getEventDurationText(
      startDate,
      new Date(startDate.getTime() + seconds * 1000),
    );
  }

  /*
   * The overview stat bars and the event tables all read this, so the wording
   * is pinned deliberately: singular units for one, and no "0 minutes" tail.
   */
  test.each([
    [0, "less than a minute"],
    [1, "less than a minute"],
    [59, "less than a minute"],
    [MINUTE, "1 minute"],
    [2 * MINUTE, "2 minutes"],
    [45 * MINUTE, "45 minutes"],
    [59 * MINUTE, "59 minutes"],
    [HOUR, "1 hour"],
    [HOUR + MINUTE, "1 hour, 1 minute"],
    [HOUR + 5 * MINUTE, "1 hour, 5 minutes"],
    [HOUR + 30 * MINUTE, "1 hour, 30 minutes"],
    [2 * HOUR, "2 hours"],
    [2 * HOUR + 5 * MINUTE, "2 hours, 5 minutes"],
    [23 * HOUR + 59 * MINUTE, "23 hours, 59 minutes"],
    [DAY, "1 day"],
    [DAY + MINUTE, "1 day, 1 minute"],
    [DAY + HOUR, "1 day, 1 hour"],
    [DAY + HOUR + 2 * MINUTE, "1 day, 1 hour, 2 minutes"],
    [2 * DAY + 3 * HOUR, "2 days, 3 hours"],
    [2 * DAY + 3 * HOUR + 4 * MINUTE, "2 days, 3 hours, 4 minutes"],
    [3 * DAY + 2 * HOUR, "3 days, 2 hours"],
    [45 * DAY, "45 days"],
  ])("formats a %i-second duration as %s", (seconds: number, text: string) => {
    expect(durationOf(seconds)).toBe(text);
  });

  it("never spells a zero unit or a plural for one", () => {
    const samples: Array<number> = [
      MINUTE,
      HOUR,
      DAY,
      HOUR + MINUTE,
      DAY + HOUR + MINUTE,
      DAY + MINUTE,
      7 * DAY + 11 * HOUR,
    ];

    for (const seconds of samples) {
      const text: string = durationOf(seconds);

      expect(text).not.toMatch(/\b0 (day|hour|minute)/);
      expect(text).not.toMatch(/\b1 (days|hours|minutes)\b/);
      expect(text).not.toMatch(/,\s*$/);
      expect(text).not.toMatch(/^,/);
    }
  });

  it("handles countdown dates in the same human-readable form", () => {
    const earlierDate: Date = new Date(startDate.getTime() - 90 * 60 * 1000);

    expect(getEventDurationText(startDate, earlierDate)).toBe(
      "1 hour, 30 minutes",
    );
  });

  it("does not round a partial minute up", () => {
    expect(durationOf(119)).toBe("1 minute");
    expect(durationOf(HOUR - 1)).toBe("59 minutes");
    expect(durationOf(DAY - 1)).toBe("23 hours, 59 minutes");
  });

  it("does not depend on the order of the two dates", () => {
    const endDate: Date = new Date(
      startDate.getTime() + (2 * DAY + 3 * HOUR) * 1000,
    );

    expect(getEventDurationText(endDate, startDate)).toBe(
      getEventDurationText(startDate, endDate),
    );
  });
});

describe("getLatestTimelineDateByEventId", () => {
  const firstDate: Date = new Date("2026-08-01T01:00:00.000Z");
  const secondDate: Date = new Date("2026-08-01T02:00:00.000Z");
  const thirdDate: Date = new Date("2026-08-01T03:00:00.000Z");

  it("returns an empty lookup for no timelines", () => {
    expect(getLatestTimelineDateByEventId([])).toEqual({});
  });

  it("maps a single event to its state-change date", () => {
    expect(
      getLatestTimelineDateByEventId([
        { eventId: "incident-1", startsAt: firstDate },
      ]),
    ).toEqual({ "incident-1": firstDate });
  });

  it("retains independent dates for different events", () => {
    expect(
      getLatestTimelineDateByEventId([
        { eventId: "incident-1", startsAt: firstDate },
        { eventId: "incident-2", startsAt: secondDate },
      ]),
    ).toEqual({
      "incident-1": firstDate,
      "incident-2": secondDate,
    });
  });

  it("uses the latest date when timelines are ascending", () => {
    expect(
      getLatestTimelineDateByEventId([
        { eventId: "alert-1", startsAt: firstDate },
        { eventId: "alert-1", startsAt: thirdDate },
      ])["alert-1"],
    ).toBe(thirdDate);
  });

  it("uses the latest date when timelines are descending", () => {
    expect(
      getLatestTimelineDateByEventId([
        { eventId: "alert-1", startsAt: thirdDate },
        { eventId: "alert-1", startsAt: firstDate },
      ])["alert-1"],
    ).toBe(thirdDate);
  });

  it("uses the latest date when timelines are unsorted", () => {
    expect(
      getLatestTimelineDateByEventId([
        { eventId: "alert-1", startsAt: secondDate },
        { eventId: "alert-1", startsAt: thirdDate },
        { eventId: "alert-1", startsAt: firstDate },
      ])["alert-1"],
    ).toBe(thirdDate);
  });

  it("ignores a timeline without a date", () => {
    const timelines: Array<EventTimelineDate> = [
      { eventId: "incident-1" },
      { eventId: "incident-1", startsAt: secondDate },
    ];

    expect(getLatestTimelineDateByEventId(timelines)).toEqual({
      "incident-1": secondDate,
    });
  });

  it("ignores a timeline without an event id", () => {
    expect(
      getLatestTimelineDateByEventId([{ eventId: "", startsAt: thirdDate }]),
    ).toEqual({});
  });

  it("does not let an older invalid entry erase a valid completion date", () => {
    expect(
      getLatestTimelineDateByEventId([
        { eventId: "incident-1", startsAt: thirdDate },
        { eventId: "incident-1" },
        { eventId: "incident-1", startsAt: firstDate },
      ])["incident-1"],
    ).toBe(thirdDate);
  });
});

/*
 * The states that count as resolved are the project's to say: its resolved
 * state and any state placed after it (Common/Utils/ResolvedState). Here
 * "resolved" and "closed", which comes after it without the flag.
 */
const RESOLVED_STATE_IDS: Array<string> = ["resolved", "closed"];

describe("getEventEndDateForCurrentState", () => {
  const openDate: Date = new Date("2026-08-01T01:00:00.000Z");
  const resolvedDate: Date = new Date("2026-08-01T02:00:00.000Z");
  const reopenedDate: Date = new Date("2026-08-01T03:00:00.000Z");
  const closedDate: Date = new Date("2026-08-01T04:00:00.000Z");

  it("returns the latest date when the current state is resolved", () => {
    expect(
      getEventEndDateForCurrentState(
        [
          { stateId: "open", startsAt: openDate },
          { stateId: "resolved", startsAt: resolvedDate },
        ],
        RESOLVED_STATE_IDS,
      ),
    ).toBe(resolvedDate);
  });

  it("keeps a reopened event live", () => {
    expect(
      getEventEndDateForCurrentState(
        [
          { stateId: "open", startsAt: openDate },
          { stateId: "resolved", startsAt: resolvedDate },
          { stateId: "open", startsAt: reopenedDate },
        ],
        RESOLVED_STATE_IDS,
      ),
    ).toBeUndefined();
  });

  it("finds the current state when timelines are unsorted", () => {
    expect(
      getEventEndDateForCurrentState(
        [
          { stateId: "resolved", startsAt: resolvedDate },
          { stateId: "open", startsAt: openDate },
        ],
        RESOLVED_STATE_IDS,
      ),
    ).toBe(resolvedDate);
  });

  it("ignores timelines without dates", () => {
    expect(
      getEventEndDateForCurrentState(
        [{ stateId: "open", startsAt: openDate }, { stateId: "resolved" }],
        RESOLVED_STATE_IDS,
      ),
    ).toBeUndefined();
  });

  it("returns no end date without a resolved state", () => {
    expect(
      getEventEndDateForCurrentState(
        [{ stateId: "resolved", startsAt: resolvedDate }],
        [],
      ),
    ).toBeUndefined();
  });

  it("moving on from Resolved into a state after it keeps the moment it was resolved", () => {
    expect(
      getEventEndDateForCurrentState(
        [
          { stateId: "open", startsAt: openDate },
          { stateId: "resolved", startsAt: resolvedDate },
          { stateId: "closed", startsAt: closedDate },
        ],
        RESOLVED_STATE_IDS,
      ),
    ).toBe(resolvedDate);
  });

  it("an event moved straight into a state after Resolved ended then", () => {
    expect(
      getEventEndDateForCurrentState(
        [
          { stateId: "open", startsAt: openDate },
          { stateId: "closed", startsAt: closedDate },
        ],
        RESOLVED_STATE_IDS,
      ),
    ).toBe(closedDate);
  });

  it("an event resolved, reopened and resolved again ended at its latest resolve", () => {
    const resolvedAgainDate: Date = new Date("2026-08-01T05:00:00.000Z");

    expect(
      getEventEndDateForCurrentState(
        [
          { stateId: "open", startsAt: openDate },
          { stateId: "resolved", startsAt: resolvedDate },
          { stateId: "open", startsAt: reopenedDate },
          { stateId: "resolved", startsAt: resolvedAgainDate },
          {
            stateId: "closed",
            startsAt: new Date("2026-08-01T06:00:00.000Z"),
          },
        ],
        RESOLVED_STATE_IDS,
      ),
    ).toBe(resolvedAgainDate);
  });
});

/*
 * Where an incident or an alert stands now, by its latest dated state - what
 * the AI card's conversation suggests follows it. Acknowledged means a state
 * that counts as acknowledged short of resolved (the page hands
 * AcknowledgedStateUtil.getAcknowledgedUnresolvedStateIds).
 */
describe("getEventStanding", () => {
  const ACKNOWLEDGED_STATE_IDS: Array<string> = ["acknowledged", "mitigated"];
  const createdDate: Date = new Date("2026-08-01T01:00:00.000Z");
  const acknowledgedDate: Date = new Date("2026-08-01T02:00:00.000Z");
  const resolvedDate: Date = new Date("2026-08-01T03:00:00.000Z");
  const reopenedDate: Date = new Date("2026-08-01T04:00:00.000Z");

  function standingOf(
    timelines: Array<{ stateId?: string; startsAt?: Date }>,
  ): EventStanding | undefined {
    return getEventStanding({
      timelines,
      acknowledgedStateIds: ACKNOWLEDGED_STATE_IDS,
      resolvedStateIds: RESOLVED_STATE_IDS,
    });
  }

  it("is open in its first state, acknowledged once it counts as acknowledged, resolved once it counts as resolved", () => {
    expect(standingOf([{ stateId: "created", startsAt: createdDate }])).toBe(
      EventStanding.Open,
    );
    expect(
      standingOf([
        { stateId: "created", startsAt: createdDate },
        { stateId: "acknowledged", startsAt: acknowledgedDate },
      ]),
    ).toBe(EventStanding.Acknowledged);
    // A state of the project's own between acknowledged and resolved.
    expect(
      standingOf([
        { stateId: "created", startsAt: createdDate },
        { stateId: "mitigated", startsAt: acknowledgedDate },
      ]),
    ).toBe(EventStanding.Acknowledged);
    expect(
      standingOf([
        { stateId: "created", startsAt: createdDate },
        { stateId: "acknowledged", startsAt: acknowledgedDate },
        { stateId: "resolved", startsAt: resolvedDate },
      ]),
    ).toBe(EventStanding.Resolved);
    // A state after Resolved counts as resolved too.
    expect(
      standingOf([
        { stateId: "resolved", startsAt: resolvedDate },
        { stateId: "closed", startsAt: reopenedDate },
      ]),
    ).toBe(EventStanding.Resolved);
  });

  it("a reopened event is open again, whatever it went through", () => {
    expect(
      standingOf([
        { stateId: "created", startsAt: createdDate },
        { stateId: "acknowledged", startsAt: acknowledgedDate },
        { stateId: "resolved", startsAt: resolvedDate },
        { stateId: "created", startsAt: reopenedDate },
      ]),
    ).toBe(EventStanding.Open);
  });

  it("reads the latest state by date, not by list order; a later entry wins a tie", () => {
    expect(
      standingOf([
        { stateId: "resolved", startsAt: resolvedDate },
        { stateId: "created", startsAt: createdDate },
      ]),
    ).toBe(EventStanding.Resolved);
    expect(
      standingOf([
        { stateId: "acknowledged", startsAt: resolvedDate },
        { stateId: "resolved", startsAt: resolvedDate },
      ]),
    ).toBe(EventStanding.Resolved);
    expect(
      standingOf([
        { stateId: "resolved", startsAt: resolvedDate },
        { stateId: "acknowledged", startsAt: resolvedDate },
      ]),
    ).toBe(EventStanding.Acknowledged);
  });

  it("nothing to tell by - no dated state, or a latest one with no state - is no standing", () => {
    expect(standingOf([])).toBeUndefined();
    expect(standingOf([{ stateId: "resolved" }])).toBeUndefined();
    expect(standingOf([{ startsAt: resolvedDate }])).toBeUndefined();
    // Undated entries are left out; the dated one decides.
    expect(
      standingOf([
        { stateId: "created", startsAt: createdDate },
        { stateId: "resolved" },
      ]),
    ).toBe(EventStanding.Open);
  });

  it("a project whose states could not be told apart: everything is open", () => {
    expect(
      getEventStanding({
        timelines: [{ stateId: "resolved", startsAt: resolvedDate }],
        acknowledgedStateIds: [],
        resolvedStateIds: [],
      }),
    ).toBe(EventStanding.Open);
  });
});

describe("getResolvedAtByEventId", () => {
  it("gives each event resolved now the moment it was resolved this time, and none to an open one", () => {
    const timelines: Array<EventTimelineDate> = [
      {
        eventId: "a",
        stateId: "open",
        startsAt: new Date("2026-08-01T01:00:00.000Z"),
      },
      {
        eventId: "a",
        stateId: "resolved",
        startsAt: new Date("2026-08-01T02:00:00.000Z"),
      },
      {
        eventId: "a",
        stateId: "closed",
        startsAt: new Date("2026-08-01T03:00:00.000Z"),
      },
      {
        eventId: "b",
        stateId: "open",
        startsAt: new Date("2026-08-01T01:00:00.000Z"),
      },
      { eventId: "", stateId: "resolved", startsAt: new Date() },
    ];

    expect(getResolvedAtByEventId(timelines, RESOLVED_STATE_IDS)).toEqual({
      a: new Date("2026-08-01T02:00:00.000Z"),
    });
  });
});

describe("duration display wiring", () => {
  const incidentTable: string = readSource(
    "Components",
    "Incident",
    "IncidentsTable.tsx",
  );
  const alertTable: string = readSource(
    "Components",
    "Alert",
    "AlertsTable.tsx",
  );
  const maintenanceTable: string = readSource(
    "Components",
    "ScheduledMaintenance",
    "ScheduledMaintenanceTable.tsx",
  );
  const incidentView: string = readSource(
    "Pages",
    "Incidents",
    "View",
    "Index.tsx",
  );
  const alertView: string = readSource("Pages", "Alerts", "View", "Index.tsx");
  const maintenanceView: string = readSource(
    "Pages",
    "ScheduledMaintenanceEvents",
    "View",
    "Index.tsx",
  );

  it("shows incident duration and reads the project's states to know which are resolved", () => {
    expect(incidentTable).toContain('title: "Duration"');
    expect(incidentTable).toContain("ResolvedStateUtil.getResolvedStateIds");
    expect(incidentTable).toContain(
      "useEventTimelineEndDates<IncidentStateTimeline>",
    );
  });

  it("shows alert duration and reads the project's states to know which are resolved", () => {
    expect(alertTable).toContain('title: "Duration"');
    expect(alertTable).toContain("ResolvedStateUtil.getResolvedStateIds");
    expect(alertTable).toContain(
      "useEventTimelineEndDates<AlertStateTimeline>",
    );
  });

  it("uses one batched timeline lookup instead of a request per row", () => {
    const durationHook: string = readSource(
      "Components",
      "EventView",
      "useEventTimelineEndDates.ts",
    );

    expect(durationHook).toContain("new Includes(eventIds)");
    expect(durationHook).toContain("ModelAPI.getList<TTimeline>");
    expect(durationHook).not.toContain("ModelAPI.getItem");
  });

  it("shows the scheduled maintenance window duration in the table", () => {
    expect(maintenanceTable).toContain('title: "Duration"');
    expect(maintenanceTable).toContain("startDate={item.startsAt}");
    expect(maintenanceTable).toContain("endDate={item.endsAt}");
  });

  /*
   * How long an incident or alert has lasted is said once: by the header,
   * beside its state ("Lasted 11 minutes"). The stat bar opens with when it
   * began instead of a Duration tile that said it again.
   */
  it("uses the declared incident time on the detail page, in the header alone", () => {
    expect(incidentView).toContain("declaredAt: true");
    expect(incidentView).toContain("eventStartsAt={durationStartDate}");
    expect(incidentView).toContain("getEventEndDateForCurrentState");
    expect(incidentView).not.toContain('label="Duration"');
  });

  it("uses the alert creation time on the detail page, in the header alone", () => {
    expect(alertView).toContain("createdAt: true");
    expect(alertView).toContain("eventStartsAt={durationStartDate}");
    expect(alertView).toContain("getEventEndDateForCurrentState");
    expect(alertView).not.toContain('label="Duration"');
  });

  it("labels the scheduled maintenance view statistic as duration", () => {
    expect(maintenanceView).toContain('label="Duration"');
    expect(maintenanceView).toContain("startDate={eventStartsAt}");
    expect(maintenanceView).toContain("endDate={eventEndsAt}");
  });
});
