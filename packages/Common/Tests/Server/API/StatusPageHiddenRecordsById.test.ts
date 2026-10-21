import File from "../../../Models/DatabaseModels/File";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import StatusPageAnnouncementService from "../../../Server/Services/StatusPageAnnouncementService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import FileOwnership from "../../../Server/Utils/File/FileOwnership";
import Response from "../../../Server/Utils/Response";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import { makeProgressStates } from "../TestingUtils/ScheduledMaintenanceProgressWorld";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { FindOperator } from "typeorm";

// Avoid the unrelated PasswordHash TS5.9 Buffer/BinaryLike compile failure.
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

/*
 * A record a status page does not show is not shown by its id either: a
 * scheduled maintenance event hidden from status pages, and an announcement
 * scheduled for later, are not answered when asked for by id - on the event
 * and announcement pages, the public status page MCP tools that read them,
 * or the routes that serve their attachments. The lists keep showing what
 * they showed; by id there is still no history window, so a link to an older
 * event or announcement keeps working.
 *
 * The services are stand-ins that keep only the rows a query's conditions
 * on these columns let through, as the database would.
 */

const EVENTS_ROUTE: string =
  "/status-page/scheduled-maintenance-events/:statusPageIdOrDomain";
const EVENT_DETAIL_ROUTE: string = `${EVENTS_ROUTE}/:scheduledMaintenanceId`;
const ANNOUNCEMENTS_ROUTE: string =
  "/status-page/announcements/:statusPageIdOrDomain";
const ANNOUNCEMENT_DETAIL_ROUTE: string = `${ANNOUNCEMENTS_ROUTE}/:announcementId`;
const EVENT_NOTE_ATTACHMENT_ROUTE: string =
  "/status-page/scheduled-maintenance-public-note/attachment/:statusPageId/:scheduledMaintenanceId/:noteId/:fileId";
const ANNOUNCEMENT_ATTACHMENT_ROUTE: string =
  "/status-page/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId";

const PROJECT_ID: ObjectID = new ObjectID(
  "80000000-0000-4000-8000-000000000001",
);

type Query = Record<string, unknown>;

interface Fixtures {
  statusPageId: string;
  shownEvent: ScheduledMaintenance;
  hiddenEvent: ScheduledMaintenance;
  pastAnnouncement: StatusPageAnnouncement;
  laterAnnouncement: StatusPageAnnouncement;
  eventQueries: Array<Query>;
  announcementQueries: Array<Query>;
}

// The dates a time condition (QueryHelper) is bound to, in order.
function boundDates(condition: unknown): Array<Date> {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  return Object.values(
    (operator.objectLiteralParameters as Record<string, unknown>) || {},
  ) as Array<Date>;
}

// A time condition's SQL (QueryHelper): "up to" one date, or between two.
const UP_TO_SQL: RegExp = /^\(x <= :\w+\)$/;
const BETWEEN_SQL: RegExp = /^\(x >= :\w+ and x <= :\w+\)$/;

// Whether a row's date passes a time condition: "up to" one date, or between two.
function passesTimeCondition(date: Date, condition: unknown): boolean {
  if (condition === undefined) {
    return true;
  }

  const sql: string = (condition as FindOperator<unknown>).getSql!("x");
  const dates: Array<Date> = boundDates(condition);

  if (UP_TO_SQL.test(sql)) {
    return date.getTime() <= dates[0]!.getTime();
  }

  if (BETWEEN_SQL.test(sql)) {
    return (
      date.getTime() >= dates[0]!.getTime() &&
      date.getTime() <= dates[1]!.getTime()
    );
  }

  throw new Error(`No stand-in for the time condition ${sql}`);
}

function idMatches(row: { _id?: string }, condition: unknown): boolean {
  return condition === undefined || String(condition) === row._id;
}

function mockServices(): Fixtures {
  const page: StatusPage = new StatusPage();
  page._id = ObjectID.generate().toString();
  page.projectId = PROJECT_ID;
  page.isPublicStatusPage = true;
  page.showScheduledMaintenanceEventsOnStatusPage = true;
  page.showAnnouncementsOnStatusPage = true;
  page.showScheduledEventHistoryInDays = 14;
  page.showAnnouncementHistoryInDays = 14;

  const event: (
    title: string,
    isVisibleOnStatusPage: boolean,
  ) => ScheduledMaintenance = (
    title: string,
    isVisibleOnStatusPage: boolean,
  ): ScheduledMaintenance => {
    const row: ScheduledMaintenance = new ScheduledMaintenance();
    row._id = ObjectID.generate().toString();
    row.title = title;
    row.isVisibleOnStatusPage = isVisibleOnStatusPage;
    row.startsAt = new Date();
    return row;
  };

  const announcement: (
    title: string,
    showAt: Date,
  ) => StatusPageAnnouncement = (
    title: string,
    showAt: Date,
  ): StatusPageAnnouncement => {
    const row: StatusPageAnnouncement = new StatusPageAnnouncement();
    row._id = ObjectID.generate().toString();
    row.title = title;
    row.showAnnouncementAt = showAt;
    return row;
  };

  const shownEvent: ScheduledMaintenance = event("Database upgrade", true);
  const hiddenEvent: ScheduledMaintenance = event("Internal rehearsal", false);
  const events: Array<ScheduledMaintenance> = [shownEvent, hiddenEvent];

  const pastAnnouncement: StatusPageAnnouncement = announcement(
    "New region",
    new Date(Date.now() - 60 * 60 * 1000),
  );
  const laterAnnouncement: StatusPageAnnouncement = announcement(
    "Price change",
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  );
  const announcements: Array<StatusPageAnnouncement> = [
    pastAnnouncement,
    laterAnnouncement,
  ];

  const eventQueries: Array<Query> = [];
  const announcementQueries: Array<Query> = [];

  const findEvents: (query: Query) => Array<ScheduledMaintenance> = (
    query: Query,
  ): Array<ScheduledMaintenance> => {
    eventQueries.push(query);

    return events.filter((row: ScheduledMaintenance): boolean => {
      return (
        idMatches(row, query["_id"]) &&
        (query["isVisibleOnStatusPage"] === undefined ||
          row.isVisibleOnStatusPage === query["isVisibleOnStatusPage"])
      );
    });
  };

  const findAnnouncements: (query: Query) => Array<StatusPageAnnouncement> = (
    query: Query,
  ): Array<StatusPageAnnouncement> => {
    announcementQueries.push(query);

    return announcements.filter((row: StatusPageAnnouncement): boolean => {
      return (
        idMatches(row, query["_id"]) &&
        passesTimeCondition(
          row.showAnnouncementAt!,
          query["showAnnouncementAt"],
        )
      );
    });
  };

  jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(page as never);
  jest.spyOn(StatusPageService, "findOneBy").mockResolvedValue(page as never);
  jest
    .spyOn(StatusPageService, "getStatusPageResources")
    .mockResolvedValue([] as never);
  jest
    .spyOn(StatusPageResourceService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(MonitorGroupService, "getMonitorIdsInMonitorGroups")
    .mockResolvedValue({} as never);

  jest
    .spyOn(ScheduledMaintenanceService, "findBy")
    .mockImplementation((async (args: { query: Query }) => {
      return findEvents(args.query);
    }) as never);
  jest
    .spyOn(ScheduledMaintenanceService, "findOneBy")
    .mockImplementation((async (args: { query: Query }) => {
      return findEvents(args.query)[0] || null;
    }) as never);
  jest
    .spyOn(ScheduledMaintenancePublicNoteService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(ScheduledMaintenancePublicNoteService, "findOneBy")
    .mockImplementation((async () => {
      const note: { attachments: Array<File> } = { attachments: [] };
      return note;
    }) as never);
  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
    .mockResolvedValue([] as never);
  /*
   * The project's states, as every project has them: the list reads the
   * events to come and the events in progress by the states they are in.
   */
  jest
    .spyOn(ScheduledMaintenanceStateService, "findBy")
    .mockResolvedValue(makeProgressStates() as never);

  jest
    .spyOn(StatusPageAnnouncementService, "findBy")
    .mockImplementation((async (args: { query: Query }) => {
      return findAnnouncements(args.query);
    }) as never);
  jest
    .spyOn(StatusPageAnnouncementService, "findOneBy")
    .mockImplementation((async (args: { query: Query }) => {
      const found: StatusPageAnnouncement | undefined = findAnnouncements(
        args.query,
      )[0];

      if (found) {
        found.attachments = [];
      }

      return found || null;
    }) as never);

  // The attachment asked for is one of the record's own files.
  const attachment: File = new File();
  attachment._id = ObjectID.generate().toString();
  jest
    .spyOn(FileOwnership, "findProjectAttachment")
    .mockResolvedValue(attachment as never);

  return {
    statusPageId: page._id,
    shownEvent,
    hiddenEvent,
    pastAnnouncement,
    laterAnnouncement,
    eventQueries,
    announcementQueries,
  };
}

async function invoke(data: {
  route: string;
  method?: "post" | "get";
  params: Record<string, string>;
}): Promise<{ next: NextFunction; sent: JSONObject | undefined }> {
  const req: ExpressRequest = {
    params: data.params,
    body: {},
    query: {},
    cookies: {},
    headers: {},
    socket: {},
    ips: [],
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();

  await mockRouter
    .match(data.method || "post", data.route)
    .handlerFunction(req, res, next);

  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return {
    next,
    sent: calls[0] ? (calls[0][2] as JSONObject) : undefined,
  };
}

function titlesOf(list: unknown): Array<string> {
  return ((list as JSONArray) || []).map((item: unknown): string => {
    return String((item as JSONObject)["title"]);
  });
}

describe("a status page answers by id only what it shows", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("scheduled maintenance events", () => {
    it("an event shown on status pages is answered by its id", async () => {
      const fixtures: Fixtures = mockServices();

      const { sent, next } = await invoke({
        route: EVENT_DETAIL_ROUTE,
        params: {
          statusPageIdOrDomain: fixtures.statusPageId,
          scheduledMaintenanceId: fixtures.shownEvent._id!,
        },
      });

      expect(next).not.toHaveBeenCalled();
      expect(titlesOf(sent!["scheduledMaintenanceEvents"])).toEqual([
        "Database upgrade",
      ]);
    });

    it("an event hidden from status pages is not, whoever asks for it by id", async () => {
      const fixtures: Fixtures = mockServices();

      const { sent } = await invoke({
        route: EVENT_DETAIL_ROUTE,
        params: {
          statusPageIdOrDomain: fixtures.statusPageId,
          scheduledMaintenanceId: fixtures.hiddenEvent._id!,
        },
      });

      expect(titlesOf(sent!["scheduledMaintenanceEvents"])).toEqual([]);
      expect(sent!["scheduledMaintenanceEventsPublicNotes"]).toEqual([]);
    });

    it("the read by id asks for visible events only, with no history window", async () => {
      const fixtures: Fixtures = mockServices();

      await invoke({
        route: EVENT_DETAIL_ROUTE,
        params: {
          statusPageIdOrDomain: fixtures.statusPageId,
          scheduledMaintenanceId: fixtures.hiddenEvent._id!,
        },
      });

      expect(fixtures.eventQueries).toHaveLength(1);
      expect(fixtures.eventQueries[0]!["isVisibleOnStatusPage"]).toBe(true);
      expect(fixtures.eventQueries[0]!["_id"]).toBe(fixtures.hiddenEvent._id);
      expect(fixtures.eventQueries[0]!["startsAt"]).toBeUndefined();
    });

    it("the list asks for visible events only, in each of its reads", async () => {
      const fixtures: Fixtures = mockServices();

      const { sent } = await invoke({
        route: EVENTS_ROUTE,
        params: { statusPageIdOrDomain: fixtures.statusPageId },
      });

      expect(fixtures.eventQueries.length).toBeGreaterThanOrEqual(2);

      for (const query of fixtures.eventQueries) {
        expect(query["isVisibleOnStatusPage"]).toBe(true);
      }

      expect(titlesOf(sent!["scheduledMaintenanceEvents"])).not.toContain(
        "Internal rehearsal",
      );
    });

    it("a hidden event's note attachments are not served", async () => {
      const fixtures: Fixtures = mockServices();

      const { next } = await invoke({
        route: EVENT_NOTE_ATTACHMENT_ROUTE,
        method: "get",
        params: {
          statusPageId: fixtures.statusPageId,
          scheduledMaintenanceId: fixtures.hiddenEvent._id!,
          noteId: ObjectID.generate().toString(),
          fileId: ObjectID.generate().toString(),
        },
      });

      expect((next as unknown as jest.Mock).mock.calls[0]?.[0]).toBeInstanceOf(
        NotFoundException,
      );
      expect(Response.sendFileResponse).not.toHaveBeenCalled();
    });

    it("a shown event's note attachments are", async () => {
      const fixtures: Fixtures = mockServices();

      const { next } = await invoke({
        route: EVENT_NOTE_ATTACHMENT_ROUTE,
        method: "get",
        params: {
          statusPageId: fixtures.statusPageId,
          scheduledMaintenanceId: fixtures.shownEvent._id!,
          noteId: ObjectID.generate().toString(),
          fileId: ObjectID.generate().toString(),
        },
      });

      expect(next).not.toHaveBeenCalled();
      expect(Response.sendFileResponse).toHaveBeenCalledTimes(1);
    });
  });

  describe("announcements", () => {
    it("an announcement shown already is answered by its id", async () => {
      const fixtures: Fixtures = mockServices();

      const { sent } = await invoke({
        route: ANNOUNCEMENT_DETAIL_ROUTE,
        params: {
          statusPageIdOrDomain: fixtures.statusPageId,
          announcementId: fixtures.pastAnnouncement._id!,
        },
      });

      expect(titlesOf(sent!["announcements"])).toEqual(["New region"]);
    });

    it("one scheduled for later is not, until its time comes", async () => {
      const fixtures: Fixtures = mockServices();

      const { sent } = await invoke({
        route: ANNOUNCEMENT_DETAIL_ROUTE,
        params: {
          statusPageIdOrDomain: fixtures.statusPageId,
          announcementId: fixtures.laterAnnouncement._id!,
        },
      });

      expect(titlesOf(sent!["announcements"])).toEqual([]);
    });

    it("the read by id asks for those shown up to now, with no history window", async () => {
      const fixtures: Fixtures = mockServices();
      const before: number = Date.now();

      await invoke({
        route: ANNOUNCEMENT_DETAIL_ROUTE,
        params: {
          statusPageIdOrDomain: fixtures.statusPageId,
          announcementId: fixtures.laterAnnouncement._id!,
        },
      });

      const condition: unknown =
        fixtures.announcementQueries[0]!["showAnnouncementAt"];

      expect((condition as FindOperator<unknown>).getSql!("x")).toMatch(
        /^\(x <= :\w+\)$/,
      );
      expect(boundDates(condition)[0]!.getTime()).toBeGreaterThanOrEqual(
        before,
      );
      expect(boundDates(condition)[0]!.getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
    });

    it("the list keeps its history window, up to now", async () => {
      const fixtures: Fixtures = mockServices();

      const { sent } = await invoke({
        route: ANNOUNCEMENTS_ROUTE,
        params: { statusPageIdOrDomain: fixtures.statusPageId },
      });

      const dates: Array<Date> = boundDates(
        fixtures.announcementQueries[0]!["showAnnouncementAt"],
      );

      expect(dates).toHaveLength(2);
      expect(Date.now() - dates[0]!.getTime()).toBeGreaterThanOrEqual(
        13 * 24 * 60 * 60 * 1000,
      );
      expect(titlesOf(sent!["announcements"])).toEqual(["New region"]);
    });

    it("one scheduled for later has no attachment to serve yet", async () => {
      const fixtures: Fixtures = mockServices();

      const { next } = await invoke({
        route: ANNOUNCEMENT_ATTACHMENT_ROUTE,
        method: "get",
        params: {
          statusPageId: fixtures.statusPageId,
          announcementId: fixtures.laterAnnouncement._id!,
          fileId: ObjectID.generate().toString(),
        },
      });

      expect((next as unknown as jest.Mock).mock.calls[0]?.[0]).toBeInstanceOf(
        NotFoundException,
      );
      expect(Response.sendFileResponse).not.toHaveBeenCalled();
    });

    it("one shown already serves its attachments", async () => {
      const fixtures: Fixtures = mockServices();

      const { next } = await invoke({
        route: ANNOUNCEMENT_ATTACHMENT_ROUTE,
        method: "get",
        params: {
          statusPageId: fixtures.statusPageId,
          announcementId: fixtures.pastAnnouncement._id!,
          fileId: ObjectID.generate().toString(),
        },
      });

      expect(next).not.toHaveBeenCalled();
      expect(Response.sendFileResponse).toHaveBeenCalledTimes(1);
    });
  });
});
