import fs from "fs";
import path from "path";
import {
  EventTimelineDate,
  getEventEndDateForCurrentState,
  getEventDurationText,
  getLatestTimelineDateByEventId,
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

  test.each([
    [0, "less than a minute"],
    [59, "less than a minute"],
    [60, "1 minutes"],
    [59 * 60, "59 minutes"],
    [60 * 60, "1 hours, 0 minutes"],
    [61 * 60, "1 hours, 1 minutes"],
    [24 * 60 * 60, "1 days, 0 minutes"],
    [25 * 60 * 60 + 2 * 60, "1 days, 1 hours, 2 minutes"],
  ])("formats a %i-second duration as %s", (seconds: number, text: string) => {
    const endDate: Date = new Date(startDate.getTime() + seconds * 1000);

    expect(getEventDurationText(startDate, endDate)).toBe(text);
  });

  it("handles countdown dates in the same human-readable form", () => {
    const earlierDate: Date = new Date(startDate.getTime() - 90 * 60 * 1000);

    expect(getEventDurationText(startDate, earlierDate)).toBe(
      "1 hours, 30 minutes",
    );
  });

  it("does not round a partial minute up", () => {
    const endDate: Date = new Date(startDate.getTime() + 119 * 1000);

    expect(getEventDurationText(startDate, endDate)).toBe("1 minutes");
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

describe("getEventEndDateForCurrentState", () => {
  const openDate: Date = new Date("2026-08-01T01:00:00.000Z");
  const resolvedDate: Date = new Date("2026-08-01T02:00:00.000Z");
  const reopenedDate: Date = new Date("2026-08-01T03:00:00.000Z");

  it("returns the latest date when the current state is resolved", () => {
    expect(
      getEventEndDateForCurrentState(
        [
          { stateId: "open", startsAt: openDate },
          { stateId: "resolved", startsAt: resolvedDate },
        ],
        "resolved",
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
        "resolved",
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
        "resolved",
      ),
    ).toBe(resolvedDate);
  });

  it("ignores timelines without dates", () => {
    expect(
      getEventEndDateForCurrentState(
        [{ stateId: "open", startsAt: openDate }, { stateId: "resolved" }],
        "resolved",
      ),
    ).toBeUndefined();
  });

  it("returns no end date without a resolved state", () => {
    expect(
      getEventEndDateForCurrentState(
        [{ stateId: "resolved", startsAt: resolvedDate }],
        undefined,
      ),
    ).toBeUndefined();
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

  it("shows incident duration and requests resolved-state metadata", () => {
    expect(incidentTable).toContain('title: "Duration"');
    expect(incidentTable).toContain("isResolvedState: true");
    expect(incidentTable).toContain(
      "useEventTimelineEndDates<IncidentStateTimeline>",
    );
  });

  it("shows alert duration and requests resolved-state metadata", () => {
    expect(alertTable).toContain('title: "Duration"');
    expect(alertTable).toContain("isResolvedState: true");
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

  it("uses the declared incident time on the detail page", () => {
    expect(incidentView).toContain("declaredAt: true");
    expect(incidentView).toContain("eventStartsAt={durationStartDate}");
    expect(incidentView).toContain("getEventEndDateForCurrentState");
    expect(incidentView).toContain('label="Duration"');
  });

  it("uses the alert creation time on the detail page", () => {
    expect(alertView).toContain("createdAt: true");
    expect(alertView).toContain("eventStartsAt={durationStartDate}");
    expect(alertView).toContain("getEventEndDateForCurrentState");
    expect(alertView).toContain('label="Duration"');
  });

  it("labels the scheduled maintenance view statistic as duration", () => {
    expect(maintenanceView).toContain('label="Duration"');
    expect(maintenanceView).toContain("startDate={eventStartsAt}");
    expect(maintenanceView).toContain("endDate={eventEndsAt}");
  });
});
