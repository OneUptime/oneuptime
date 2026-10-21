import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * PasswordHash carries a TS5.9 diagnostic that fails any suite whose require
 * graph reaches it, and the services below import DatabaseService, which
 * does.
 */
jest.mock("../../../../../Server/Utils/PasswordHash", () => {
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

import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ScheduledMaintenanceExternalCalendarEventService from "../../../../../Server/Services/ScheduledMaintenanceExternalCalendarEventService";
import ScheduledMaintenanceExternalCalendarService from "../../../../../Server/Services/ScheduledMaintenanceExternalCalendarService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import ExternalCalendarExpansion, {
  ExternalCalendarExpansionResult,
} from "../../../../../Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarExpansion";
import { RenderedMaintenanceCalendar } from "../../../../../Server/Utils/ScheduledMaintenance/MaintenanceCalendarFeedCache";
import TeamMaintenanceCalendar from "../../../../../Server/Utils/ScheduledMaintenance/TeamMaintenanceCalendar";
import Project from "../../../../../Models/DatabaseModels/Project";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceExternalCalendarEvent from "../../../../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendarEvent";
import ScheduledMaintenanceState from "../../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import URL from "../../../../../Types/API/URL";
import ObjectID from "../../../../../Types/ObjectID";
import fs from "fs";
import path from "path";

/*
 * Issue #5084: "Overlaid events should not be included in the project's own
 * .ics feeds, so that projects overlaying each other's feeds do not produce
 * duplicates." Two projects that each show the other's calendar link must
 * see every event once - not their own coming back through the other.
 *
 * Held two ways: the code that writes the project's own calendars - the
 * team's link and a status page's calendar - never reaches the external
 * calendars or their events; and the team's link, rendered for a project
 * that has external events, holds its own events alone, which an overlay of
 * it reads back one for one.
 */

const COMMON_DIR: string = path.join(__dirname, "..", "..", "..", "..", "..");

// Everything that builds or serves the project's own calendars.
const OWN_CALENDAR_SOURCES: Array<string> = [
  "Server/Utils/ScheduledMaintenance/TeamMaintenanceCalendar.ts",
  "Server/Utils/ScheduledMaintenance/MaintenanceCalendarFeedCache.ts",
  "Server/Utils/ScheduledMaintenance/MaintenanceCalendarFeedUrls.ts",
  "Server/Utils/StatusPage/StatusPageMaintenanceCalendarFeed.ts",
  "Server/API/ScheduledMaintenanceCalendarAPI.ts",
  "Types/ScheduledMaintenance/MaintenanceCalendar.ts",
  "Types/Calendar/ICalendar.ts",
];

const NOW: Date = new Date("2026-10-15T10:20:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "62000000-0000-4000-8000-000000000001",
);
const OWN_EVENT_ID: string = "62000000-0000-4000-8000-000000000002";

describe("the code of the project's own calendars", () => {
  test.each(OWN_CALENDAR_SOURCES)(
    "%s never reaches the calendars from outside the project",
    (relative: string) => {
      const source: string = fs.readFileSync(
        path.join(COMMON_DIR, relative),
        "utf8",
      );

      expect(source).not.toContain("ExternalCalendar");
    },
  );
});

describe("the team's calendar link of a project with external calendars", () => {
  beforeEach(() => {
    const project: Project = new Project();
    project.name = "Payments";

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.example.com/dashboard"),
      );

    const scheduled: ScheduledMaintenanceState =
      new ScheduledMaintenanceState();
    scheduled.id = new ObjectID("62000000-0000-4000-8000-000000000003");
    scheduled.name = "Scheduled";
    scheduled.order = 1;
    scheduled.isScheduledState = true;

    const own: ScheduledMaintenance = new ScheduledMaintenance();
    own.id = new ObjectID(OWN_EVENT_ID);
    own.title = "Database upgrade";
    own.description = "";
    own.startsAt = new Date("2026-10-20T22:00:00.000Z");
    own.endsAt = new Date("2026-10-21T01:00:00.000Z");
    own.currentScheduledMaintenanceState = scheduled;
    own.monitors = [];
    own.statusPages = [];
    own.labels = [];

    jest.spyOn(ScheduledMaintenanceService, "findBy").mockResolvedValue([own]);
    jest
      .spyOn(
        ScheduledMaintenanceStateService,
        "getAllScheduledMaintenanceStates",
      )
      .mockResolvedValue([scheduled]);
    jest
      .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("holds the project's own events alone, and never reads the external ones", async () => {
    const overlay: ScheduledMaintenanceExternalCalendarEvent =
      new ScheduledMaintenanceExternalCalendarEvent();
    overlay.title = "Christmas Day";
    overlay.startsAt = new Date("2026-12-25T00:00:00.000Z");
    overlay.endsAt = new Date("2026-12-26T00:00:00.000Z");
    overlay.isAllDay = true;

    const eventReads: SpyInstance<
      typeof ScheduledMaintenanceExternalCalendarEventService.findBy
    > = jest
      .spyOn(ScheduledMaintenanceExternalCalendarEventService, "findBy")
      .mockResolvedValue([overlay]);

    const calendarReads: SpyInstance<
      typeof ScheduledMaintenanceExternalCalendarService.findBy
    > = jest
      .spyOn(ScheduledMaintenanceExternalCalendarService, "findBy")
      .mockResolvedValue([]);

    const rendered: RenderedMaintenanceCalendar =
      await TeamMaintenanceCalendar.render({ projectId: PROJECT_ID, now: NOW });

    expect(eventReads).not.toHaveBeenCalled();
    expect(calendarReads).not.toHaveBeenCalled();
    expect(rendered.eventCount).toBe(1);
    expect(rendered.body).not.toContain("Christmas Day");

    // Another project overlaying this link sees this project's event once.
    const read: ExternalCalendarExpansionResult =
      await ExternalCalendarExpansion.expand(rendered.body, { now: NOW });

    expect(read.ok).toBe(true);
    expect(
      read.ok &&
        read.events.map((item: { title: string; startsAt: Date }) => {
          return [item.title, item.startsAt.toISOString()];
        }),
    ).toEqual([["Database upgrade", "2026-10-20T22:00:00.000Z"]]);
  });
});
