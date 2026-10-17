import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../Server/Utils/Logger");

/*
 * PasswordHash carries a TS5.9 diagnostic that fails any suite whose require
 * graph reaches it, and the services below import DatabaseService, which
 * does.
 */
jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import DatabaseConfig from "../../../../Server/DatabaseConfig";
import ProjectService from "../../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import Response from "../../../../Server/Utils/Response";
import { RenderedMaintenanceCalendar } from "../../../../Server/Utils/ScheduledMaintenance/MaintenanceCalendarFeedCache";
import TeamMaintenanceCalendar, {
  TEAM_CALENDAR_FUTURE_DAYS,
  TEAM_CALENDAR_PAST_DAYS,
  TEAM_CALENDAR_REPLACED_REASON,
  TEAM_CALENDAR_TURNED_OFF_REASON,
  TeamCalendarEvents,
} from "../../../../Server/Utils/ScheduledMaintenance/TeamMaintenanceCalendar";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Project from "../../../../Models/DatabaseModels/Project";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";
import { MAINTENANCE_CALENDAR_MAX_EVENTS } from "../../../../Types/ScheduledMaintenance/MaintenanceCalendar";
import {
  ParsedEvent,
  checkICalendarConformance,
  readCalendarText,
  readEvents,
} from "../../../Types/Calendar/ICalendarConformance";

/*
 * The team's maintenance calendar: what it reads (every event of the project
 * whose window touches 90 days back to a year ahead, as root, in three
 * queries), how each event reads (its monitors, status pages and labels by
 * their own names, a link to its page in the Dashboard, its description as
 * plain text), which events were called off, and the empty calendar a link
 * turned off or replaced answers with.
 */

const NOW: Date = new Date("2026-10-15T10:20:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "74000000-0000-4000-8000-000000000001",
);

const STATE_IDS: Record<string, string> = {
  Scheduled: "74100000-0000-4000-8000-000000000001",
  Ongoing: "74100000-0000-4000-8000-000000000002",
  Ended: "74100000-0000-4000-8000-000000000003",
  Completed: "74100000-0000-4000-8000-000000000004",
};

function state(name: string): ScheduledMaintenanceState {
  const model: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  model.id = new ObjectID(STATE_IDS[name]!);
  model.name = name;
  model.order = Object.keys(STATE_IDS).indexOf(name) + 1;
  model.isScheduledState = name === "Scheduled";
  model.isOngoingState = name === "Ongoing";
  model.isEndedState = name === "Ended";
  model.isResolvedState = name === "Completed";
  return model;
}

const STATES: Array<ScheduledMaintenanceState> =
  Object.keys(STATE_IDS).map(state);

function named<T extends Monitor | StatusPage | Label>(
  type: { new (): T },
  name: string,
): T {
  const model: T = new type();
  model.name = name;
  return model;
}

function event(data: {
  id: string;
  title: string;
  state: string;
  startsAt: string;
  endsAt: string;
  description?: string;
}): ScheduledMaintenance {
  const model: ScheduledMaintenance = new ScheduledMaintenance();
  model.id = new ObjectID(data.id);
  model.title = data.title;
  model.description = data.description || "";
  model.startsAt = new Date(data.startsAt);
  model.endsAt = new Date(data.endsAt);
  model.createdAt = new Date("2026-10-01T09:00:00.000Z");
  model.updatedAt = new Date("2026-10-02T09:00:00.000Z");
  model.version = 2;
  model.currentScheduledMaintenanceState = state(data.state);
  model.monitors = [named(Monitor, "API"), named(Monitor, "Website")];
  model.statusPages = [named(StatusPage, "Public status")];
  model.labels = [named(Label, "Database")];
  return model;
}

function timelineRow(
  eventId: string,
  stateName: string,
  iso: string,
): ScheduledMaintenanceStateTimeline {
  const row: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();
  row.scheduledMaintenanceId = new ObjectID(eventId);
  row.scheduledMaintenanceStateId = new ObjectID(STATE_IDS[stateName]!);
  row.startsAt = new Date(iso);
  return row;
}

const UPCOMING_ID: string = "74200000-0000-4000-8000-000000000001";
const RAN_ID: string = "74200000-0000-4000-8000-000000000002";
const CALLED_OFF_ID: string = "74200000-0000-4000-8000-000000000003";

/*
 * A QueryHelper comparison (a TypeORM Raw operator) as the SQL it writes for
 * a column and the values it binds.
 */
function operator(value: unknown): { sql: string; values: Array<unknown> } {
  const raw: {
    getSql: (alias: string) => string;
    objectLiteralParameters: Record<string, unknown>;
  } = value as {
    getSql: (alias: string) => string;
    objectLiteralParameters: Record<string, unknown>;
  };

  return {
    sql: raw.getSql("col"),
    values: Object.values(raw.objectLiteralParameters),
  };
}

let eventsFindBy: SpyInstance<typeof ScheduledMaintenanceService.findBy>;
let timelineFindBy: SpyInstance<
  typeof ScheduledMaintenanceStateTimelineService.findBy
>;
let statesSpy: SpyInstance<
  typeof ScheduledMaintenanceStateService.getAllScheduledMaintenanceStates
>;

function readEventsReturn(rows: Array<ScheduledMaintenance>): void {
  eventsFindBy.mockResolvedValue(rows);
}

beforeEach(() => {
  const project: Project = new Project();
  project.name = "Acme Production";

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.example.com/dashboard"));

  eventsFindBy = jest
    .spyOn(ScheduledMaintenanceService, "findBy")
    .mockResolvedValue([]);
  statesSpy = jest
    .spyOn(ScheduledMaintenanceStateService, "getAllScheduledMaintenanceStates")
    .mockResolvedValue(STATES);
  timelineFindBy = jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
    .mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TeamMaintenanceCalendar.getWindow", () => {
  test("runs from 00:00 UTC ninety days back to the end of the day a year ahead", () => {
    const window: { from: Date; to: Date } =
      TeamMaintenanceCalendar.getWindow(NOW);

    expect(TEAM_CALENDAR_PAST_DAYS).toBe(90);
    expect(TEAM_CALENDAR_FUTURE_DAYS).toBe(365);
    expect(window.from.toISOString()).toBe("2026-07-17T00:00:00.000Z");
    expect(window.to.toISOString()).toBe("2027-10-16T00:00:00.000Z");
  });

  test("is the same for every fetch on one UTC day, and the day is the cache bucket", () => {
    const early: Date = new Date("2026-10-15T00:00:00.000Z");
    const late: Date = new Date("2026-10-15T23:59:59.999Z");

    expect(TeamMaintenanceCalendar.getWindow(early)).toEqual(
      TeamMaintenanceCalendar.getWindow(late),
    );
    expect(TeamMaintenanceCalendar.getDayBucket(early)).toBe("2026-10-15");
    expect(TeamMaintenanceCalendar.getDayBucket(late)).toBe("2026-10-15");
    expect(
      TeamMaintenanceCalendar.getDayBucket(
        new Date("2026-10-16T00:00:00.000Z"),
      ),
    ).toBe("2026-10-16");
  });
});

describe("TeamMaintenanceCalendar.getEventUrl", () => {
  test("is the event's page in the Dashboard, whatever the slashes", () => {
    for (const dashboardUrl of [
      "https://oneuptime.example.com/dashboard",
      "https://oneuptime.example.com/dashboard/",
      "https://oneuptime.example.com/dashboard//",
    ]) {
      expect(
        TeamMaintenanceCalendar.getEventUrl({
          dashboardUrl,
          projectId: PROJECT_ID,
          eventId: UPCOMING_ID,
        }),
      ).toBe(
        `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/scheduled-maintenance-events/${UPCOMING_ID}`,
      );
    }
  });
});

describe("TeamMaintenanceCalendar.readEvents", () => {
  test("reads, as root, the project's events whose window touches the calendar's, earliest first, one more than it holds", async () => {
    await TeamMaintenanceCalendar.readEvents({
      projectId: PROJECT_ID,
      now: NOW,
    });

    expect(eventsFindBy).toHaveBeenCalledTimes(1);

    const args: Record<string, any> = eventsFindBy.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(args["query"]["projectId"]).toEqual(PROJECT_ID);
    expect(operator(args["query"]["startsAt"])).toEqual({
      sql: expect.stringContaining("col <= :"),
      values: [new Date("2027-10-16T00:00:00.000Z")],
    });
    expect(operator(args["query"]["endsAt"])).toEqual({
      sql: expect.stringContaining("col >= :"),
      values: [new Date("2026-07-17T00:00:00.000Z")],
    });
    expect(args["props"]).toEqual({ isRoot: true });
    expect(args["limit"]).toBe(MAINTENANCE_CALENDAR_MAX_EVENTS + 1);
    expect(args["sort"]).toEqual({ startsAt: "ASC" });
    expect(args["select"]["monitors"]).toEqual({ _id: true, name: true });
    expect(args["select"]["statusPages"]).toEqual({ _id: true, name: true });
    expect(args["select"]["labels"]).toEqual({ _id: true, name: true });
    expect(args["select"]["version"]).toBe(true);
    expect(args["select"]["updatedAt"]).toBe(true);
  });

  test("a project with no events reads no states and no timelines", async () => {
    const read: TeamCalendarEvents = await TeamMaintenanceCalendar.readEvents({
      projectId: PROJECT_ID,
      now: NOW,
    });

    expect(read).toEqual({ events: [], isTruncated: false });
    expect(statesSpy).not.toHaveBeenCalled();
    expect(timelineFindBy).not.toHaveBeenCalled();
  });

  test("each event as the team knows it: its monitors, status pages and labels by their names, its page, its text", async () => {
    readEventsReturn([
      event({
        id: UPCOMING_ID,
        title: "Database upgrade",
        state: "Scheduled",
        startsAt: "2026-10-20T22:00:00.000Z",
        endsAt: "2026-10-21T01:00:00.000Z",
        description:
          "We move to **Postgres 18**. See [the runbook](https://example.com/r).",
      }),
    ]);

    const read: TeamCalendarEvents = await TeamMaintenanceCalendar.readEvents({
      projectId: PROJECT_ID,
      now: NOW,
    });

    expect(read.isTruncated).toBe(false);
    expect(read.events).toHaveLength(1);

    const only: (typeof read.events)[number] = read.events[0]!;

    expect(only.id).toBe(UPCOMING_ID);
    expect(only.title).toBe("Database upgrade");
    expect(only.stateName).toBe("Scheduled");
    expect(only.affects).toEqual(["API", "Website"]);
    expect(only.statusPages).toEqual(["Public status"]);
    expect(only.labels).toEqual(["Database"]);
    expect(only.version).toBe(2);
    expect(only.isCalledOff).toBe(false);
    expect(only.url).toBe(
      `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/scheduled-maintenance-events/${UPCOMING_ID}`,
    );
    expect(only.description).toContain("Postgres 18");
    expect(only.description).toContain("the runbook");
    expect(only.description).not.toContain("**");
  });

  test("an event over without ever running was called off; one that ran was not; only events that are over have their timelines read", async () => {
    readEventsReturn([
      event({
        id: UPCOMING_ID,
        title: "Upcoming",
        state: "Scheduled",
        startsAt: "2026-10-20T22:00:00.000Z",
        endsAt: "2026-10-21T01:00:00.000Z",
      }),
      event({
        id: RAN_ID,
        title: "Ran",
        state: "Completed",
        startsAt: "2026-10-01T22:00:00.000Z",
        endsAt: "2026-10-02T01:00:00.000Z",
      }),
      event({
        id: CALLED_OFF_ID,
        title: "Called off",
        state: "Completed",
        startsAt: "2026-10-05T22:00:00.000Z",
        endsAt: "2026-10-06T01:00:00.000Z",
      }),
    ]);

    timelineFindBy.mockResolvedValue([
      timelineRow(RAN_ID, "Scheduled", "2026-09-30T09:00:00.000Z"),
      timelineRow(RAN_ID, "Ongoing", "2026-10-01T22:00:00.000Z"),
      timelineRow(RAN_ID, "Completed", "2026-10-02T01:00:00.000Z"),
      timelineRow(CALLED_OFF_ID, "Scheduled", "2026-09-30T09:00:00.000Z"),
      timelineRow(CALLED_OFF_ID, "Completed", "2026-10-03T09:00:00.000Z"),
    ]);

    const read: TeamCalendarEvents = await TeamMaintenanceCalendar.readEvents({
      projectId: PROJECT_ID,
      now: NOW,
    });

    const calledOff: Record<string, boolean> = {};

    for (const one of read.events) {
      calledOff[one.title || ""] = Boolean(one.isCalledOff);
    }

    expect(calledOff).toEqual({
      Upcoming: false,
      Ran: false,
      "Called off": true,
    });

    expect(timelineFindBy).toHaveBeenCalledTimes(1);

    const timelineArgs: Record<string, any> = timelineFindBy.mock
      .calls[0]![0] as Record<string, any>;
    const askedFor: string = JSON.stringify(
      timelineArgs["query"]["scheduledMaintenanceId"],
    );

    expect(askedFor).toContain(RAN_ID);
    expect(askedFor).toContain(CALLED_OFF_ID);
    expect(askedFor).not.toContain(UPCOMING_ID);
    expect(timelineArgs["props"]).toEqual({ isRoot: true });
  });

  test("holds at most MAINTENANCE_CALENDAR_MAX_EVENTS events, and says when it left some out", async () => {
    const rows: Array<ScheduledMaintenance> = [];

    for (
      let index: number = 0;
      index <= MAINTENANCE_CALENDAR_MAX_EVENTS;
      index++
    ) {
      rows.push(
        event({
          id: `74300000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
          title: `Window ${index}`,
          state: "Scheduled",
          startsAt: "2026-10-20T22:00:00.000Z",
          endsAt: "2026-10-21T01:00:00.000Z",
        }),
      );
    }

    readEventsReturn(rows);

    const read: TeamCalendarEvents = await TeamMaintenanceCalendar.readEvents({
      projectId: PROJECT_ID,
      now: NOW,
    });

    expect(read.events).toHaveLength(MAINTENANCE_CALENDAR_MAX_EVENTS);
    expect(read.isTruncated).toBe(true);
  });
});

describe("TeamMaintenanceCalendar.render / renderEmpty", () => {
  test("a valid calendar named after the project, with an ETag of its own bytes", async () => {
    readEventsReturn([
      event({
        id: UPCOMING_ID,
        title: "Database upgrade",
        state: "Scheduled",
        startsAt: "2026-10-20T22:00:00.000Z",
        endsAt: "2026-10-21T01:00:00.000Z",
      }),
    ]);

    const rendered: RenderedMaintenanceCalendar =
      await TeamMaintenanceCalendar.render({ projectId: PROJECT_ID, now: NOW });

    expect(checkICalendarConformance(rendered.body).problems).toEqual([]);
    expect(rendered.etag).toBe(Response.getCalendarETag(rendered.body));
    expect(rendered.eventCount).toBe(1);
    expect(rendered.lastModified).toEqual(NOW);
    expect(rendered.body).toContain(
      "X-WR-CALNAME:Acme Production · Maintenance",
    );

    const events: Array<ParsedEvent> = readEvents(rendered.body);

    expect(events).toHaveLength(1);
    expect(events[0]!.description).toContain("Status pages: Public status");
    expect(events[0]!.description).toContain("Affects: API, Website");
  });

  test.each([TEAM_CALENDAR_TURNED_OFF_REASON, TEAM_CALENDAR_REPLACED_REASON])(
    "a link that shows nothing on purpose answers an empty calendar saying why (%s)",
    async (reason: string) => {
      const rendered: RenderedMaintenanceCalendar =
        await TeamMaintenanceCalendar.renderEmpty({
          projectId: PROJECT_ID,
          reason,
          now: NOW,
        });

      expect(
        checkICalendarConformance(rendered.body, { allowNoComponents: true })
          .problems,
      ).toEqual([]);
      expect(rendered.body).not.toContain("BEGIN:VEVENT");
      expect(readCalendarText(rendered.body, "X-WR-CALDESC")).toContain(reason);
      expect(rendered.eventCount).toBe(0);
      expect(eventsFindBy).not.toHaveBeenCalled();
    },
  );
});
