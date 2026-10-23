import MaintenanceCalendar, {
  MAINTENANCE_CALENDAR_CALLED_OFF_LINE,
  MAINTENANCE_CALENDAR_FALLBACK_DURATION_MS,
  MAINTENANCE_CALENDAR_FALLBACK_TITLE,
  MAINTENANCE_CALENDAR_MAX_DESCRIPTION_LENGTH,
  MAINTENANCE_CALENDAR_MAX_LISTED_NAMES,
  MAINTENANCE_CALENDAR_MAX_SUMMARY_LENGTH,
  MAINTENANCE_CALENDAR_REFRESH_CAVEAT,
  MAINTENANCE_CALENDAR_TRUNCATED_NOTE,
  MaintenanceCalendarAudience,
  MaintenanceCalendarEventInput,
  MaintenanceCalendarInput,
} from "../../../Types/ScheduledMaintenance/MaintenanceCalendar";
import {
  ICalendarEvent,
  ICalendarEventStatus,
  ICalendarTransparency,
} from "../../../Types/Calendar/ICalendar";
import {
  ParsedEvent,
  checkICalendarConformance,
  readCalendarText,
  readEvents,
} from "../Calendar/ICalendarConformance";
import { describe, expect, test } from "@jest/globals";

/*
 * How a scheduled maintenance event reads in a calendar app: the exact bytes
 * of one event, what changes when it is edited or called off, the long and
 * awkward texts a strict client must still read, and the order and the
 * determinism a feed's ETag depends on.
 */

const EVENT_ID: string = "6c1f8e2a-4b3d-4e5f-8a9b-0c1d2e3f4a5b";
const OTHER_EVENT_ID: string = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

const at: (iso: string) => Date = (iso: string): Date => {
  return new Date(iso);
};

function baseEvent(
  overrides?: Partial<MaintenanceCalendarEventInput>,
): MaintenanceCalendarEventInput {
  return {
    id: EVENT_ID,
    title: "Database upgrade",
    description: "We move the primary database to new hardware.",
    startsAt: at("2026-10-20T22:00:00Z"),
    endsAt: at("2026-10-21T01:00:00Z"),
    stateName: "Scheduled",
    createdAt: at("2026-10-10T09:00:00Z"),
    updatedAt: at("2026-10-12T09:30:00Z"),
    version: 3,
    affects: ["API", "Website"],
    statusPages: ["Public status"],
    url: "https://oneuptime.example.com/dashboard/p/scheduled-maintenance-events/6c1f8e2a-4b3d-4e5f-8a9b-0c1d2e3f4a5b",
    ...overrides,
  };
}

function teamCalendar(
  events: Array<MaintenanceCalendarEventInput>,
  overrides?: Partial<MaintenanceCalendarInput>,
): MaintenanceCalendarInput {
  return {
    audience: MaintenanceCalendarAudience.Team,
    name: "Acme Production",
    productId: MaintenanceCalendar.getProductId("OneUptime"),
    events: events,
    ...overrides,
  };
}

const CRLF: string = "\r\n";

describe("MaintenanceCalendar.render: one event, byte for byte", () => {
  test("the team's calendar with one event is exactly this", () => {
    const body: string = MaintenanceCalendar.render(
      teamCalendar([baseEvent()]),
    );

    const expected: string =
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//OneUptime//Scheduled Maintenance//EN",
        "CALSCALE:GREGORIAN",
        "NAME:Acme Production · Maintenance",
        "X-WR-CALNAME:Acme Production · Maintenance",
        "X-WR-CALDESC:Every scheduled maintenance event in Acme Production. Calendar",
        "  apps refresh subscribed calendars on their own schedule (Google Calendar ",
        " every 12 to 24 hours)\\, so a change can take a while to appear.",
        "X-WR-TIMEZONE:UTC",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
        "LAST-MODIFIED:20261012T093000Z",
        "BEGIN:VEVENT",
        "UID:scheduled-maintenance-6c1f8e2a-4b3d-4e5f-8a9b-0c1d2e3f4a5b@oneuptime",
        "DTSTAMP:20261012T093000Z",
        "LAST-MODIFIED:20261012T093000Z",
        "SEQUENCE:2",
        "DTSTART:20261020T220000Z",
        "DTEND:20261021T010000Z",
        "SUMMARY:Database upgrade",
        "DESCRIPTION:We move the primary database to new hardware.\\n\\nStatus: Schedu",
        " led\\nAffects: API\\, Website\\nStatus pages: Public status\\nDetails: https:/",
        " /oneuptime.example.com/dashboard/p/scheduled-maintenance-events/6c1f8e2a-4",
        " b3d-4e5f-8a9b-0c1d2e3f4a5b",
        "URL:https://oneuptime.example.com/dashboard/p/scheduled-maintenance-events/",
        " 6c1f8e2a-4b3d-4e5f-8a9b-0c1d2e3f4a5b",
        "STATUS:CONFIRMED",
        "TRANSP:TRANSPARENT",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join(CRLF) + CRLF;

    expect(body).toBe(expected);
  });

  test("the body is one a strict calendar client reads without complaint", () => {
    const body: string = MaintenanceCalendar.render(
      teamCalendar([baseEvent()]),
    );

    expect(checkICalendarConformance(body).problems).toEqual([]);
  });

  test("a client reads back the window, the title and the text as written", () => {
    const events: Array<ParsedEvent> = readEvents(
      MaintenanceCalendar.render(teamCalendar([baseEvent()])),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.uid).toBe(`scheduled-maintenance-${EVENT_ID}@oneuptime`);
    expect(events[0]!.start.toISOString()).toBe("2026-10-20T22:00:00.000Z");
    expect(events[0]!.end.toISOString()).toBe("2026-10-21T01:00:00.000Z");
    expect(events[0]!.summary).toBe("Database upgrade");
    expect(events[0]!.description).toBe(
      [
        "We move the primary database to new hardware.",
        "",
        "Status: Scheduled",
        "Affects: API, Website",
        "Status pages: Public status",
        `Details: https://oneuptime.example.com/dashboard/p/scheduled-maintenance-events/${EVENT_ID}`,
      ].join("\n"),
    );
    expect(events[0]!.sequence).toBe(2);
  });
});

describe("MaintenanceCalendar: an event that is edited", () => {
  test("keeps its UID, and carries a higher SEQUENCE and a later LAST-MODIFIED", () => {
    const before: ParsedEvent = readEvents(
      MaintenanceCalendar.render(teamCalendar([baseEvent()])),
    )[0]!;

    const after: ParsedEvent = readEvents(
      MaintenanceCalendar.render(
        teamCalendar([
          baseEvent({
            title: "Database upgrade (moved)",
            startsAt: at("2026-10-22T22:00:00Z"),
            endsAt: at("2026-10-23T01:00:00Z"),
            updatedAt: at("2026-10-13T08:00:00Z"),
            version: 5,
          }),
        ]),
      ),
    )[0]!;

    expect(after.uid).toBe(before.uid);
    expect(after.sequence).toBeGreaterThan(before.sequence!);
    expect(after.dtStamp.getTime()).toBeGreaterThan(before.dtStamp.getTime());
    expect(after.start.toISOString()).toBe("2026-10-22T22:00:00.000Z");
    expect(after.summary).toBe("Database upgrade (moved)");
  });

  test("an unchanged event renders to the same bytes every time", () => {
    const first: string = MaintenanceCalendar.render(
      teamCalendar([baseEvent()]),
    );
    const second: string = MaintenanceCalendar.render(
      teamCalendar([baseEvent()]),
    );

    expect(second).toBe(first);
  });

  test("SEQUENCE counts writes since the event was created", () => {
    expect(MaintenanceCalendar.getSequence(1)).toBe(0);
    expect(MaintenanceCalendar.getSequence(2)).toBe(1);
    expect(MaintenanceCalendar.getSequence(10)).toBe(9);
    expect(MaintenanceCalendar.getSequence(0)).toBe(0);
    expect(MaintenanceCalendar.getSequence(undefined)).toBe(0);
    expect(MaintenanceCalendar.getSequence(null)).toBe(0);
    expect(MaintenanceCalendar.getSequence(Number.NaN)).toBe(0);
    expect(MaintenanceCalendar.getSequence(3.7)).toBe(2);
  });

  test("DTSTAMP falls back to when it was created, then to its start", () => {
    const created: ICalendarEvent = MaintenanceCalendar.toEvent(
      baseEvent({ updatedAt: null }),
      MaintenanceCalendarAudience.Team,
    );

    expect(created.dtStamp.toISOString()).toBe("2026-10-10T09:00:00.000Z");

    const neither: ICalendarEvent = MaintenanceCalendar.toEvent(
      baseEvent({ updatedAt: null, createdAt: null }),
      MaintenanceCalendarAudience.Team,
    );

    expect(neither.dtStamp.toISOString()).toBe("2026-10-20T22:00:00.000Z");
  });
});

describe("MaintenanceCalendar: an event that was called off", () => {
  test("is STATUS:CANCELLED, and its description says so first", () => {
    const body: string = MaintenanceCalendar.render(
      teamCalendar([baseEvent({ isCalledOff: true, stateName: "Completed" })]),
    );

    expect(checkICalendarConformance(body).problems).toEqual([]);

    const event: ParsedEvent = readEvents(body)[0]!;

    expect(
      event.properties.find((property: { name: string }) => {
        return property.name === "STATUS";
      })?.value,
    ).toBe("CANCELLED");
    expect(
      event.description.startsWith(
        `${MAINTENANCE_CALENDAR_CALLED_OFF_LINE}\n\n`,
      ),
    ).toBe(true);
    expect(event.description).toContain("Status: Completed");
  });

  test("keeps its UID, so the calendar updates the event it holds", () => {
    const confirmed: ICalendarEvent = MaintenanceCalendar.toEvent(
      baseEvent(),
      MaintenanceCalendarAudience.Team,
    );
    const cancelled: ICalendarEvent = MaintenanceCalendar.toEvent(
      baseEvent({ isCalledOff: true }),
      MaintenanceCalendarAudience.Team,
    );

    expect(confirmed.status).toBe(ICalendarEventStatus.Confirmed);
    expect(cancelled.status).toBe(ICalendarEventStatus.Cancelled);
    expect(cancelled.uid).toBe(confirmed.uid);
  });
});

/*
 * The project's four seeded states, with a state of its own between Ongoing
 * and Ended ("Verifying") and one before Ongoing ("Confirmed"), as
 * ScheduledMaintenanceStartUtil reads them.
 */
const STATES: Array<Record<string, unknown>> = [
  {
    _id: "00000000-0000-4000-8000-0000000000a1",
    name: "Scheduled",
    order: 1,
    isScheduledState: true,
  },
  {
    _id: "00000000-0000-4000-8000-0000000000a2",
    name: "Confirmed",
    order: 2,
  },
  {
    _id: "00000000-0000-4000-8000-0000000000a3",
    name: "Ongoing",
    order: 3,
    isOngoingState: true,
  },
  {
    _id: "00000000-0000-4000-8000-0000000000a4",
    name: "Verifying",
    order: 4,
  },
  {
    _id: "00000000-0000-4000-8000-0000000000a5",
    name: "Ended",
    order: 5,
    isEndedState: true,
  },
  {
    _id: "00000000-0000-4000-8000-0000000000a6",
    name: "Completed",
    order: 6,
    isResolvedState: true,
  },
];

function stateNamed(name: string): Record<string, unknown> {
  return STATES.find((state: Record<string, unknown>) => {
    return state["name"] === name;
  })!;
}

function row(name: string, iso: string): { stateId: string; startsAt: Date } {
  return {
    stateId: stateNamed(name)["_id"] as string,
    startsAt: at(iso),
  };
}

describe("MaintenanceCalendar.isCalledOff", () => {
  test("an event closed before it ever started was called off", () => {
    expect(
      MaintenanceCalendar.isCalledOff({
        states: STATES,
        state: stateNamed("Completed"),
        timeline: [
          row("Scheduled", "2026-10-10T09:00:00Z"),
          row("Completed", "2026-10-11T09:00:00Z"),
        ],
      }),
    ).toBe(true);

    expect(
      MaintenanceCalendar.isCalledOff({
        states: STATES,
        state: stateNamed("Ended"),
        timeline: [
          row("Scheduled", "2026-10-10T09:00:00Z"),
          row("Confirmed", "2026-10-10T10:00:00Z"),
          row("Ended", "2026-10-11T09:00:00Z"),
        ],
      }),
    ).toBe(true);
  });

  test("an event that ran, however briefly, was not", () => {
    expect(
      MaintenanceCalendar.isCalledOff({
        states: STATES,
        state: stateNamed("Completed"),
        timeline: [
          row("Scheduled", "2026-10-10T09:00:00Z"),
          row("Ongoing", "2026-10-20T22:00:00Z"),
          row("Ended", "2026-10-20T22:01:00Z"),
          row("Completed", "2026-10-21T09:00:00Z"),
        ],
      }),
    ).toBe(false);

    // Straight into a state of the project's own that is in progress.
    expect(
      MaintenanceCalendar.isCalledOff({
        states: STATES,
        state: stateNamed("Ended"),
        timeline: [
          row("Scheduled", "2026-10-10T09:00:00Z"),
          row("Verifying", "2026-10-20T22:00:00Z"),
          row("Ended", "2026-10-21T01:00:00Z"),
        ],
      }),
    ).toBe(false);
  });

  test("an event that is still to come or in progress is never called off", () => {
    for (const name of ["Scheduled", "Confirmed", "Ongoing", "Verifying"]) {
      expect(
        MaintenanceCalendar.isCalledOff({
          states: STATES,
          state: stateNamed(name),
          timeline: [row("Scheduled", "2026-10-10T09:00:00Z")],
        }),
      ).toBe(false);
    }
  });

  test("an event read without its state is not called off", () => {
    expect(
      MaintenanceCalendar.isCalledOff({
        states: STATES,
        state: null,
        timeline: [],
      }),
    ).toBe(false);
  });

  test("rows in any order are read oldest first", () => {
    expect(
      MaintenanceCalendar.isCalledOff({
        states: STATES,
        state: stateNamed("Completed"),
        timeline: [
          row("Completed", "2026-10-21T09:00:00Z"),
          row("Ongoing", "2026-10-20T22:00:00Z"),
          row("Scheduled", "2026-10-10T09:00:00Z"),
        ],
      }),
    ).toBe(false);
  });
});

describe("MaintenanceCalendar: awkward text", () => {
  test("commas, semicolons, backslashes and line breaks are escaped and read back as written", () => {
    const description: string =
      "Step 1; drain traffic, then wait.\nStep 2: run C:\\tools\\migrate.\n\nRollback, if needed; see the runbook.";

    const body: string = MaintenanceCalendar.render(
      teamCalendar([
        baseEvent({
          title: "Upgrade; part 1, of 2 \\ final",
          description: description,
          affects: ["API, v2", "Web; EU"],
        }),
      ]),
    );

    expect(checkICalendarConformance(body).problems).toEqual([]);

    const unfolded: string = body.split(`${CRLF} `).join("");

    expect(unfolded).toContain("SUMMARY:Upgrade\\; part 1\\, of 2 \\\\ final");
    expect(unfolded).toContain(
      "DESCRIPTION:Step 1\\; drain traffic\\, then wait.\\nStep 2: run C:\\\\tools\\\\migrate.\\n\\nRollback\\, if needed\\; see the runbook.",
    );

    const event: ParsedEvent = readEvents(body)[0]!;

    expect(event.summary).toBe("Upgrade; part 1, of 2 \\ final");
    expect(event.description.startsWith(description)).toBe(true);
    expect(event.description).toContain("Affects: API, v2, Web; EU");
  });

  test("a long description is folded at 75 octets on character boundaries", () => {
    const paragraph: string =
      "Wartungsarbeiten an der Datenbank 🔧 — 数据库维护 — データベースの保守. ";

    const body: string = MaintenanceCalendar.render(
      teamCalendar([baseEvent({ description: paragraph.repeat(30) })]),
    );

    expect(checkICalendarConformance(body).problems).toEqual([]);

    for (const line of body.split(CRLF)) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }

    const event: ParsedEvent = readEvents(body)[0]!;

    expect(event.description).toContain("🔧 — 数据库维护 — データベースの保守");
  });

  test("an event's own text is cut at the limit, with an ellipsis", () => {
    const description: string = "x".repeat(
      MAINTENANCE_CALENDAR_MAX_DESCRIPTION_LENGTH + 500,
    );

    const text: string = MaintenanceCalendar.buildDescription(
      baseEvent({ description: description, affects: [], url: null }),
      MaintenanceCalendarAudience.Team,
    );

    const firstSection: string = text.split("\n\n")[0]!;

    expect(Array.from(firstSection)).toHaveLength(
      MAINTENANCE_CALENDAR_MAX_DESCRIPTION_LENGTH,
    );
    expect(firstSection.endsWith("…")).toBe(true);
    expect(text).toContain("Status: Scheduled");
  });

  test("a cut never splits a character in two", () => {
    const text: string = MaintenanceCalendar.cut("🔧".repeat(10), 5);

    expect(Array.from(text)).toEqual(["🔧", "🔧", "🔧", "🔧", "…"]);
  });

  test("a title on several lines reads as one, and a long one is cut", () => {
    expect(
      MaintenanceCalendar.buildSummary(
        baseEvent({ title: "  Database\n\tupgrade   tonight " }),
      ),
    ).toBe("Database upgrade tonight");

    const long: string = MaintenanceCalendar.buildSummary(
      baseEvent({ title: "a".repeat(500) }),
    );

    expect(Array.from(long)).toHaveLength(
      MAINTENANCE_CALENDAR_MAX_SUMMARY_LENGTH,
    );
    expect(long.endsWith("…")).toBe(true);
  });

  test("an event without a title is called a scheduled maintenance", () => {
    expect(MaintenanceCalendar.buildSummary(baseEvent({ title: "" }))).toBe(
      MAINTENANCE_CALENDAR_FALLBACK_TITLE,
    );
    expect(MaintenanceCalendar.buildSummary(baseEvent({ title: null }))).toBe(
      MAINTENANCE_CALENDAR_FALLBACK_TITLE,
    );
    expect(MaintenanceCalendar.buildSummary(baseEvent({ title: " \n " }))).toBe(
      MAINTENANCE_CALENDAR_FALLBACK_TITLE,
    );
  });

  test("blank lines are kept as paragraph breaks, runs of them as one", () => {
    expect(
      MaintenanceCalendar.cleanParagraphs(
        "One  \r\n\r\n\r\n\r\nTwo\n\n\nThree  ",
      ),
    ).toBe("One\n\nTwo\n\nThree");
  });
});

describe("MaintenanceCalendar.buildDescription: what each reader is told", () => {
  test("the team's calendar names the status pages; a status page's calendar never does", () => {
    const team: string = MaintenanceCalendar.buildDescription(
      baseEvent(),
      MaintenanceCalendarAudience.Team,
    );
    const page: string = MaintenanceCalendar.buildDescription(
      baseEvent(),
      MaintenanceCalendarAudience.StatusPage,
    );

    expect(team).toContain("Status pages: Public status");
    expect(page).not.toContain("Status pages:");
    expect(page).toContain("Affects: API, Website");
  });

  test("an event with nothing to say beyond its title has no empty lines", () => {
    expect(
      MaintenanceCalendar.buildDescription(
        baseEvent({
          description: "",
          stateName: "",
          affects: [],
          statusPages: [],
          url: "",
        }),
        MaintenanceCalendarAudience.Team,
      ),
    ).toBe("");
  });

  test("names are listed once each, and past the limit they are counted", () => {
    const names: Array<string> = [];

    for (let index: number = 1; index <= 25; index++) {
      names.push(`Monitor ${index}`);
    }

    const listed: string = MaintenanceCalendar.listNames([
      ...names,
      "Monitor 1",
      " ",
    ]);

    expect(listed.startsWith("Monitor 1, Monitor 2,")).toBe(true);
    expect(listed).toContain(
      `Monitor ${MAINTENANCE_CALENDAR_MAX_LISTED_NAMES}`,
    );
    expect(listed).not.toContain(
      `Monitor ${MAINTENANCE_CALENDAR_MAX_LISTED_NAMES + 1},`,
    );
    expect(listed.endsWith(" and 5 more")).toBe(true);
  });
});

describe("MaintenanceCalendar: the window", () => {
  test("an end that is not after the start becomes the form's default hour", () => {
    const start: Date = at("2026-10-20T22:00:00Z");

    for (const end of [start, at("2026-10-20T21:00:00Z"), null, undefined]) {
      expect(MaintenanceCalendar.getEnd(start, end).getTime()).toBe(
        start.getTime() + MAINTENANCE_CALENDAR_FALLBACK_DURATION_MS,
      );
    }

    expect(
      MaintenanceCalendar.getEnd(start, new Date(Number.NaN)).getTime(),
    ).toBe(start.getTime() + MAINTENANCE_CALENDAR_FALLBACK_DURATION_MS);
  });

  test("such an event still renders, and still conforms", () => {
    const body: string = MaintenanceCalendar.render(
      teamCalendar([baseEvent({ endsAt: at("2026-10-20T22:00:00Z") })]),
    );

    expect(checkICalendarConformance(body).problems).toEqual([]);
    expect(readEvents(body)[0]!.end.toISOString()).toBe(
      "2026-10-20T23:00:00.000Z",
    );
  });

  test("every event is transparent: a maintenance window makes nobody busy", () => {
    expect(
      MaintenanceCalendar.toEvent(baseEvent(), MaintenanceCalendarAudience.Team)
        .transparency,
    ).toBe(ICalendarTransparency.Transparent);
  });
});

describe("MaintenanceCalendar.buildDocument: the calendar", () => {
  test("events are ordered by start, then by UID, whatever order they come in", () => {
    const later: MaintenanceCalendarEventInput = baseEvent({
      id: OTHER_EVENT_ID,
      startsAt: at("2026-11-01T10:00:00Z"),
      endsAt: at("2026-11-01T11:00:00Z"),
    });
    const sameStart: MaintenanceCalendarEventInput = baseEvent({
      id: "ffffffff-0000-4000-8000-000000000000",
    });

    const one: string = MaintenanceCalendar.render(
      teamCalendar([later, sameStart, baseEvent()]),
    );
    const other: string = MaintenanceCalendar.render(
      teamCalendar([baseEvent(), later, sameStart]),
    );

    expect(other).toBe(one);
    expect(
      readEvents(one).map((event: ParsedEvent) => {
        return event.uid;
      }),
    ).toEqual([
      MaintenanceCalendar.getUid(EVENT_ID),
      MaintenanceCalendar.getUid("ffffffff-0000-4000-8000-000000000000"),
      MaintenanceCalendar.getUid(OTHER_EVENT_ID),
    ]);
  });

  test("the calendar's LAST-MODIFIED is the latest write of any event", () => {
    const document: ReturnType<typeof MaintenanceCalendar.buildDocument> =
      MaintenanceCalendar.buildDocument(
        teamCalendar([
          baseEvent(),
          baseEvent({
            id: OTHER_EVENT_ID,
            updatedAt: at("2026-10-15T00:00:00Z"),
          }),
        ]),
      );

    expect(document.calendar.lastModified?.toISOString()).toBe(
      "2026-10-15T00:00:00.000Z",
    );
  });

  test("an empty calendar has no LAST-MODIFIED and still conforms", () => {
    const body: string = MaintenanceCalendar.render(teamCalendar([]));

    expect(
      checkICalendarConformance(body, { allowNoComponents: true }).problems,
    ).toEqual([]);
    expect(body).not.toContain("BEGIN:VEVENT");
    expect(body).not.toContain("LAST-MODIFIED");
  });

  test("a calendar empty on purpose says why, and holds no event whatever it was given", () => {
    const body: string = MaintenanceCalendar.render(
      teamCalendar([baseEvent()], {
        emptyReason: "This calendar link is turned off.",
      }),
    );

    expect(body).not.toContain("BEGIN:VEVENT");
    expect(readCalendarText(body, "X-WR-CALDESC")).toBe(
      `Every scheduled maintenance event in Acme Production. ${MAINTENANCE_CALENDAR_REFRESH_CAVEAT} This calendar link is turned off.`,
    );
  });

  test("a calendar cut short says so", () => {
    const body: string = MaintenanceCalendar.render(
      teamCalendar([baseEvent()], { isTruncated: true }),
    );

    expect(readCalendarText(body, "X-WR-CALDESC")).toContain(
      MAINTENANCE_CALENDAR_TRUNCATED_NOTE,
    );
  });

  test("events without an id or a real start are left out", () => {
    const body: string = MaintenanceCalendar.render(
      teamCalendar([
        baseEvent({ id: "" }),
        baseEvent({ id: OTHER_EVENT_ID, startsAt: new Date(Number.NaN) }),
        baseEvent(),
      ]),
    );

    expect(readEvents(body)).toHaveLength(1);
  });

  test("a status page's calendar is named for the page and describes it", () => {
    const body: string = MaintenanceCalendar.render({
      audience: MaintenanceCalendarAudience.StatusPage,
      name: "Acme Status",
      productId: MaintenanceCalendar.getProductId("OneUptime"),
      events: [baseEvent()],
    });

    expect(readCalendarText(body, "X-WR-CALNAME")).toBe(
      "Acme Status · Maintenance",
    );
    expect(readCalendarText(body, "X-WR-CALDESC")).toBe(
      `Scheduled maintenance on Acme Status. ${MAINTENANCE_CALENDAR_REFRESH_CAVEAT}`,
    );
  });

  test("a calendar without a name still has one", () => {
    expect(MaintenanceCalendar.getCalendarName("")).toBe(
      "Scheduled maintenance",
    );
    expect(MaintenanceCalendar.getCalendarName(null)).toBe(
      "Scheduled maintenance",
    );
    expect(
      MaintenanceCalendar.getCalendarDescription({
        audience: MaintenanceCalendarAudience.StatusPage,
        name: " ",
      }).startsWith("Scheduled maintenance on this status page."),
    ).toBe(true);
  });

  /*
   * In natural order, as labels are listed everywhere (Utils/LabelOrder,
   * OneUptime issue #5183): numbered labels first, by their numbers.
   */
  test("labels become CATEGORIES in natural order", () => {
    const event: ICalendarEvent = MaintenanceCalendar.toEvent(
      baseEvent({
        labels: ["Database", "10. Owner", "2. Team", "1. Region"],
      }),
      MaintenanceCalendarAudience.Team,
    );

    expect(event.categories).toEqual([
      "1. Region",
      "2. Team",
      "10. Owner",
      "Database",
    ]);
  });

  test("labels become CATEGORIES, each once", () => {
    const event: ICalendarEvent = MaintenanceCalendar.toEvent(
      baseEvent({ labels: ["Database", "EU, West", "Database", ""] }),
      MaintenanceCalendarAudience.Team,
    );

    expect(event.categories).toEqual(["Database", "EU, West"]);

    const body: string = MaintenanceCalendar.render(
      teamCalendar([baseEvent({ labels: ["Database", "EU, West"] })]),
    );

    expect(checkICalendarConformance(body).problems).toEqual([]);
    expect(body).toContain("CATEGORIES:Database,EU\\, West");
  });

  test("an event without a link has no URL", () => {
    const event: ICalendarEvent = MaintenanceCalendar.toEvent(
      baseEvent({ url: "" }),
      MaintenanceCalendarAudience.StatusPage,
    );

    expect(event.url).toBeUndefined();
  });
});

describe("MaintenanceCalendar identity", () => {
  test("the UID is the event's id, lower case, in its own namespace", () => {
    expect(
      MaintenanceCalendar.getUid(" 6C1F8E2A-4B3D-4E5F-8A9B-0C1D2E3F4A5B "),
    ).toBe(`scheduled-maintenance-${EVENT_ID}@oneuptime`);
  });

  test("PRODID names the product, without a field separator in it", () => {
    expect(MaintenanceCalendar.getProductId("OneUptime")).toBe(
      "-//OneUptime//Scheduled Maintenance//EN",
    );
    expect(MaintenanceCalendar.getProductId("Acme // Ops")).toBe(
      "-//Acme / Ops//Scheduled Maintenance//EN",
    );
    expect(MaintenanceCalendar.getProductId("")).toBe(
      "-//OneUptime//Scheduled Maintenance//EN",
    );
  });
});
