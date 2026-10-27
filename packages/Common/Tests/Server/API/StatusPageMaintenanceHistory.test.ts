import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import StatusPageHistoryChartBarColorRuleService from "../../../Server/Services/StatusPageHistoryChartBarColorRuleService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UptimeBarTooltipMaintenance from "../../../Types/Monitor/UptimeBarTooltipMaintenance";
import { ScheduledMaintenancePhaseOfState } from "../../../Utils/ScheduledMaintenanceStart";
import UptimeMaintenanceUtil from "../../../Utils/Uptime/UptimeMaintenanceUtil";
import {
  PROGRESS_PROJECT_ID,
  ProgressStateKey,
  eventMatchesStateQuery,
  idsOfCondition,
  makeEventInState,
  makeProgressStates,
  mockProgressStateReads,
  progressStateId,
} from "../TestingUtils/ScheduledMaintenanceProgressWorld";
import { mockRouter } from "./Helpers";
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
 * The scheduled maintenance a status page's uptime history shows (#5236):
 * StatusPageAPI.getTimelineScheduledMaintenanceEvents, shipped by the
 * overview as timelineScheduledMaintenanceEvents.
 *
 *   - Only events the page shows: through StatusPageVisibilityQuery
 *     (Visible on Status Page on, and published: no Publish on Status Page
 *     At, or one that has come - #5249) - the one filter every read of a
 *     page's maintenance goes through - and on this page. An event reaches a page by naming it, never through
 *     its monitors, so the read asks by the page alone.
 *   - Of those, only events that hold one of the page's monitors: an event
 *     is drawn on the resources of the monitors it holds.
 *   - Only events that have started - in progress or over. One still to
 *     come is no part of any day's history.
 *   - Only events whose planned window touches the history's window.
 *   - None at all on a page that does not show scheduled maintenance.
 *   - Each event names only the page's own monitors.
 *
 * The database is a stand-in that keeps the rows each query lets through,
 * as Postgres would.
 */

const DAY_MS: number = 24 * 60 * 60 * 1000;

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000001",
);
const OTHER_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000002",
);

const PAGE_MONITOR: string = "5e100000-0000-4000-8000-000000000001";
const GROUP_MONITOR: string = "5e100000-0000-4000-8000-000000000002";
const OTHER_MONITOR: string = "5e100000-0000-4000-8000-000000000009";

// The history's window: the ninety days before a pinned now.
const NOW: Date = new Date("2026-10-26T15:30:00.000Z");
const WINDOW_START: Date = new Date(NOW.getTime() - 90 * DAY_MS);

// A time condition's SQL (QueryHelper), with `x` for the column.
const AT_MOST_SQL: RegExp = /^\(x <= :\w+\)$/;
const AT_MOST_OR_NONE_SQL: RegExp = /^\(x <= :\w+ or x IS NULL\)$/;
const AT_LEAST_SQL: RegExp = /^\(x >= :\w+\)$/;
const BETWEEN_SQL: RegExp = /^\(x >= :\w+ and x <= :\w+\)$/;

function datesOf(condition: unknown): Array<Date> {
  return Object.values(
    ((condition as FindOperator<unknown>).objectLiteralParameters as Record<
      string,
      unknown
    >) || {},
  ) as Array<Date>;
}

function sqlOf(condition: unknown): string {
  return (condition as FindOperator<unknown>).getSql!("x");
}

// Whether a date passes a time condition, as Postgres would decide it.
function passesTime(
  value: Date | null | undefined,
  condition: unknown,
): boolean {
  if (condition === undefined) {
    return true;
  }

  const sql: string = sqlOf(condition);
  const dates: Array<Date> = datesOf(condition);

  // `x IS NULL` lets a row with no date through.
  if (AT_MOST_OR_NONE_SQL.test(sql)) {
    return !value || value.getTime() <= dates[0]!.getTime();
  }

  if (!value) {
    return false;
  }

  const time: number = value.getTime();

  if (AT_MOST_SQL.test(sql)) {
    return time <= dates[0]!.getTime();
  }

  if (AT_LEAST_SQL.test(sql)) {
    return time >= dates[0]!.getTime();
  }

  if (BETWEEN_SQL.test(sql)) {
    return time >= dates[0]!.getTime() && time <= dates[1]!.getTime();
  }

  throw new Error(`No stand-in for the time condition ${sql}`);
}

// The ids a condition on a many-to-many relation names.
function relationIds(condition: unknown): Array<string> | null {
  if (condition === undefined || condition === null) {
    return null;
  }

  const values: Array<unknown> = Array.isArray(condition)
    ? condition
    : [condition];

  return values.map((value: unknown): string => {
    return String(value).toLowerCase();
  });
}

function holdsAny(
  related: Array<{ _id?: string | undefined }> | undefined,
  condition: unknown,
): boolean {
  const wanted: Array<string> | null = relationIds(condition);

  if (!wanted) {
    return true;
  }

  return (related || []).some((item: { _id?: string | undefined }) => {
    return wanted.includes(String(item._id).toLowerCase());
  });
}

function monitor(id: string): Monitor {
  const model: Monitor = new Monitor();
  model._id = id;
  return model;
}

function page(id: ObjectID): StatusPage {
  const model: StatusPage = new StatusPage();
  model._id = id.toString();
  return model;
}

function maintenance(data: {
  key: ProgressStateKey;
  title: string;
  startsAt: Date;
  endsAt: Date;
  monitorIds?: Array<string> | undefined;
  statusPageIds?: Array<ObjectID> | undefined;
  isVisibleOnStatusPage?: boolean | undefined;
  publishOnStatusPageAt?: Date | undefined;
}): ScheduledMaintenance {
  const event: ScheduledMaintenance = makeEventInState(data.key, {
    title: data.title,
  });
  event.startsAt = data.startsAt;
  event.endsAt = data.endsAt;
  event.isVisibleOnStatusPage = data.isVisibleOnStatusPage ?? true;

  if (data.publishOnStatusPageAt) {
    event.publishOnStatusPageAt = data.publishOnStatusPageAt;
  }
  event.description = `Everything about ${data.title}`;
  event.monitors = (data.monitorIds || [PAGE_MONITOR]).map(monitor);
  event.statusPages = (data.statusPageIds || [STATUS_PAGE_ID]).map(page);
  return event;
}

function daysAgo(days: number, hour: number = 12): Date {
  const date: Date = new Date(NOW.getTime() - days * DAY_MS);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

function titlesOf(list: unknown): Array<string> {
  return ((list as JSONArray) || [])
    .map((item: unknown): string => {
      return String((item as JSONObject)["title"]);
    })
    .sort();
}

describe("a status page's uptime history shows its scheduled maintenance", () => {
  let api: StatusPageAPI;
  let statusPage: StatusPage;
  let events: Array<ScheduledMaintenance> = [];
  let eventQueries: Array<Record<string, unknown>> = [];
  let eventReads: Array<Record<string, unknown>> = [];
  let monitorsOnStatusPage: Array<ObjectID> = [];

  beforeAll(() => {
    mockRouter.routes.length = 0;
    api = new StatusPageAPI();
  });

  beforeEach(() => {
    events = [];
    eventQueries = [];
    eventReads = [];
    monitorsOnStatusPage = [
      new ObjectID(PAGE_MONITOR),
      new ObjectID(GROUP_MONITOR),
    ];

    statusPage = new StatusPage();
    statusPage._id = STATUS_PAGE_ID.toString();
    statusPage.projectId = PROGRESS_PROJECT_ID;
    statusPage.showScheduledMaintenanceEventsOnStatusPage = true;
    statusPage.showScheduledEventHistoryInDays = 14;

    mockProgressStateReads();

    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockResolvedValue(statusPage as never);

    jest
      .spyOn(api, "getStatusPageResourcesAndTimelines")
      .mockImplementation((async () => {
        return {
          statusPageResources: [],
          monitorStatuses: [],
          monitorStatusTimelines: [],
          uptimeDailyAggregate: {
            monitors: [],
            isComplete: true,
            completeFrom: null,
            timezone: "UTC",
          },
          monitorGroupCurrentStatuses: {},
          statusPageGroups: [],
          statusPage: statusPage,
          monitorsOnStatusPage: monitorsOnStatusPage,
          monitorsInGroup: {},
          startDateForMonitorTimeline: WINDOW_START,
          endDateForMonitorTimeline: NOW,
        };
      }) as never);

    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockImplementation((async (args: {
        query: Record<string, unknown>;
        select?: Record<string, unknown>;
        sort?: Record<string, unknown>;
        limit?: number;
      }) => {
        eventQueries.push(args.query);
        eventReads.push(args as unknown as Record<string, unknown>);

        return events
          .filter((event: ScheduledMaintenance): boolean => {
            return (
              eventMatchesStateQuery(event, args.query) &&
              (args.query["isVisibleOnStatusPage"] === undefined ||
                event.isVisibleOnStatusPage ===
                  args.query["isVisibleOnStatusPage"]) &&
              holdsAny(
                event.statusPages as Array<{ _id?: string }>,
                args.query["statusPages"],
              ) &&
              holdsAny(
                event.monitors as Array<{ _id?: string }>,
                args.query["monitors"],
              ) &&
              passesTime(event.startsAt, args.query["startsAt"]) &&
              passesTime(event.endsAt, args.query["endsAt"]) &&
              passesTime(
                event.publishOnStatusPageAt,
                args.query["publishOnStatusPageAt"],
              )
            );
          })
          .map((event: ScheduledMaintenance): ScheduledMaintenance => {
            // A fresh copy per read, as the database hands back.
            const copy: ScheduledMaintenance = Object.assign(
              new ScheduledMaintenance(),
              event,
            );
            copy.monitors = [...(event.monitors || [])];
            return copy;
          });
      }) as never);

    jest
      .spyOn(ScheduledMaintenancePublicNoteService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(StatusPageHistoryChartBarColorRuleService, "findBy")
      .mockResolvedValue([] as never);
    // Asked for whenever the page has monitors; this page shows no incidents.
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStates")
      .mockResolvedValue([] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The history's own read: the one with a window on Ends At.
  function historyQuery(): Record<string, unknown> | undefined {
    return eventQueries.find((query: Record<string, unknown>): boolean => {
      return query["endsAt"] !== undefined;
    });
  }

  function historyRead(): Record<string, unknown> | undefined {
    return eventReads.find((read: Record<string, unknown>): boolean => {
      return (read["query"] as Record<string, unknown>)["endsAt"] !== undefined;
    });
  }

  describe("which events", () => {
    it("ships the events of the window, over and in progress, in the overview", async () => {
      events = [
        maintenance({
          key: "completed",
          title: "PHP security patches",
          startsAt: daysAgo(5, 16),
          endsAt: daysAgo(4, 14),
        }),
        maintenance({
          key: "ongoing",
          title: "Database upgrade",
          startsAt: daysAgo(0, 14),
          endsAt: daysAgo(-1, 2),
        }),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      expect(titlesOf(payload["timelineScheduledMaintenanceEvents"])).toEqual([
        "Database upgrade",
        "PHP security patches",
      ]);
    });

    it.each([
      "ongoing",
      "verifying",
      "ended",
      "reviewing",
      "completed",
      "archived",
    ] as Array<ProgressStateKey>)(
      "ships an event that has started: %s",
      async (key: ProgressStateKey) => {
        events = [
          maintenance({
            key: key,
            title: `In ${key}`,
            startsAt: daysAgo(3),
            endsAt: daysAgo(3, 14),
          }),
        ];

        const payload: JSONObject =
          await api.buildOverviewResponse(STATUS_PAGE_ID);

        expect(titlesOf(payload["timelineScheduledMaintenanceEvents"])).toEqual(
          [`In ${key}`],
        );
      },
    );

    it.each(["scheduled", "confirmed"] as Array<ProgressStateKey>)(
      "leaves out an event still waiting to start: %s",
      async (key: ProgressStateKey) => {
        events = [
          maintenance({
            key: key,
            title: `In ${key}`,
            // Its time has come; the clock has not started it yet.
            startsAt: daysAgo(0, 10),
            endsAt: daysAgo(0, 18),
          }),
        ];

        const payload: JSONObject =
          await api.buildOverviewResponse(STATUS_PAGE_ID);

        expect(payload["timelineScheduledMaintenanceEvents"]).toEqual([]);
      },
    );

    it("leaves out an event hidden from status pages", async () => {
      events = [
        maintenance({
          key: "completed",
          title: "Hidden",
          startsAt: daysAgo(3),
          endsAt: daysAgo(3, 14),
          isVisibleOnStatusPage: false,
        }),
        maintenance({
          key: "completed",
          title: "Shown",
          startsAt: daysAgo(3),
          endsAt: daysAgo(3, 14),
        }),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      expect(titlesOf(payload["timelineScheduledMaintenanceEvents"])).toEqual([
        "Shown",
      ]);
    });

    /*
     * Kept to the team until its publish time (#5249): no day of the page's
     * history holds it, even once it has started - and from its publish
     * time on, the history holds it as any other event. The publish time is
     * read against the real clock, so these are set far from it.
     */
    it("leaves out an event that has started but is not published on status pages yet", async () => {
      events = [
        maintenance({
          key: "ongoing",
          title: "Published next week",
          startsAt: daysAgo(0, 10),
          endsAt: daysAgo(-1, 2),
          publishOnStatusPageAt: new Date(Date.now() + 7 * DAY_MS),
        }),
        maintenance({
          key: "completed",
          title: "Shown",
          startsAt: daysAgo(3),
          endsAt: daysAgo(3, 14),
        }),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      expect(titlesOf(payload["timelineScheduledMaintenanceEvents"])).toEqual([
        "Shown",
      ]);
    });

    it("holds an event whose publish time has come", async () => {
      events = [
        maintenance({
          key: "completed",
          title: "Published an hour ago",
          startsAt: daysAgo(3),
          endsAt: daysAgo(3, 14),
          publishOnStatusPageAt: new Date(Date.now() - 60 * 60 * 1000),
        }),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      expect(titlesOf(payload["timelineScheduledMaintenanceEvents"])).toEqual([
        "Published an hour ago",
      ]);
    });

    it("the history's read asks for events published up to now", async () => {
      events = [];

      const before: number = Date.now();

      await api.buildOverviewResponse(STATUS_PAGE_ID);

      const condition: unknown = historyQuery()!["publishOnStatusPageAt"];

      expect(AT_MOST_OR_NONE_SQL.test(sqlOf(condition))).toBe(true);
      expect(datesOf(condition)[0]!.getTime()).toBeGreaterThanOrEqual(before);
      expect(datesOf(condition)[0]!.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("leaves out an event shown only on another status page", async () => {
      events = [
        maintenance({
          key: "completed",
          title: "Another page's",
          startsAt: daysAgo(3),
          endsAt: daysAgo(3, 14),
          statusPageIds: [OTHER_STATUS_PAGE_ID],
        }),
        maintenance({
          key: "completed",
          title: "Both pages'",
          startsAt: daysAgo(3),
          endsAt: daysAgo(3, 14),
          statusPageIds: [OTHER_STATUS_PAGE_ID, STATUS_PAGE_ID],
        }),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      expect(titlesOf(payload["timelineScheduledMaintenanceEvents"])).toEqual([
        "Both pages'",
      ]);
    });

    it("leaves out an event that holds none of the page's monitors", async () => {
      events = [
        maintenance({
          key: "completed",
          title: "Someone else's monitors",
          startsAt: daysAgo(3),
          endsAt: daysAgo(3, 14),
          monitorIds: [OTHER_MONITOR],
        }),
        maintenance({
          key: "completed",
          title: "A monitor in one of the page's groups",
          startsAt: daysAgo(3),
          endsAt: daysAgo(3, 14),
          monitorIds: [GROUP_MONITOR],
        }),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      /*
       * Both name the page, so the read hands both back: the one on someone
       * else's monitors is on none of the page's resources, so no day of
       * the history holds it.
       */
      expect(titlesOf(payload["timelineScheduledMaintenanceEvents"])).toEqual([
        "A monitor in one of the page's groups",
      ]);
    });

    it("leaves out an event that holds no monitor at all", async () => {
      events = [
        maintenance({
          key: "completed",
          title: "Office move",
          startsAt: daysAgo(3),
          endsAt: daysAgo(3, 14),
          monitorIds: [],
        }),
        maintenance({
          key: "completed",
          title: "Database upgrade",
          startsAt: daysAgo(3),
          endsAt: daysAgo(3, 14),
        }),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      /*
       * An event with no monitors is on the page's Scheduled Maintenance
       * list, but on no resource: no uptime strip draws it.
       */
      expect(titlesOf(payload["timelineScheduledMaintenanceEvents"])).toEqual([
        "Database upgrade",
      ]);
    });

    it("keeps the events whose window touches the history's, and only those", async () => {
      events = [
        maintenance({
          key: "completed",
          title: "Over before the window",
          startsAt: new Date(WINDOW_START.getTime() - 3 * DAY_MS),
          endsAt: new Date(WINDOW_START.getTime() - 2 * DAY_MS),
        }),
        maintenance({
          key: "completed",
          title: "Ran into the window",
          startsAt: new Date(WINDOW_START.getTime() - 2 * DAY_MS),
          endsAt: new Date(WINDOW_START.getTime() + 60 * 60 * 1000),
        }),
        maintenance({
          key: "ongoing",
          title: "Runs past now",
          startsAt: new Date(NOW.getTime() - 60 * 60 * 1000),
          endsAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
        }),
        maintenance({
          key: "ongoing",
          title: "Started early, planned for later",
          startsAt: new Date(NOW.getTime() + 60 * 60 * 1000),
          endsAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
        }),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      /*
       * An event started early by hand, whose window is still ahead, is on
       * the page as in progress (the overview's own list) but has no day of
       * the history yet that its window touches.
       */
      expect(titlesOf(payload["timelineScheduledMaintenanceEvents"])).toEqual([
        "Ran into the window",
        "Runs past now",
      ]);
    });
  });

  describe("the read", () => {
    it("goes through the one rule of what a page shows, by this page and never by its monitors", async () => {
      await api.buildOverviewResponse(STATUS_PAGE_ID);

      const query: Record<string, unknown> | undefined = historyQuery();

      expect(query).toBeDefined();
      expect(query!["isVisibleOnStatusPage"]).toBe(true);
      expect(relationIds(query!["statusPages"])).toEqual([
        STATUS_PAGE_ID.toString(),
      ]);
      /*
       * An event reaches a page by naming it, as everywhere else on the
       * page (StatusPageDocsFacts holds every such read to that). Which of
       * its monitors are the page's is sorted out after the read.
       */
      expect(query!["monitors"]).toBeUndefined();
      expect(String(query!["projectId"])).toBe(PROGRESS_PROJECT_ID.toString());
    });

    it("asks for the states an event has started in, by id", async () => {
      await api.buildOverviewResponse(STATUS_PAGE_ID);

      expect(
        idsOfCondition(
          historyQuery()!["currentScheduledMaintenanceStateId"],
        )!.sort(),
      ).toEqual(
        (
          [
            "ongoing",
            "verifying",
            "ended",
            "reviewing",
            "completed",
            "archived",
          ] as Array<ProgressStateKey>
        )
          .map((key: ProgressStateKey): string => {
            return progressStateId(key).toString().toLowerCase();
          })
          .sort(),
      );
      expect(
        historyQuery()!["currentScheduledMaintenanceState"],
      ).toBeUndefined();
    });

    it("asks for the history's own window: started by its end, ending after its start", async () => {
      await api.buildOverviewResponse(STATUS_PAGE_ID);

      const query: Record<string, unknown> = historyQuery()!;

      expect(sqlOf(query["startsAt"])).toMatch(AT_MOST_SQL);
      expect(datesOf(query["startsAt"])[0]!.toISOString()).toBe(
        NOW.toISOString(),
      );
      expect(sqlOf(query["endsAt"])).toMatch(AT_LEAST_SQL);
      expect(datesOf(query["endsAt"])[0]!.toISOString()).toBe(
        WINDOW_START.toISOString(),
      );
    });

    it("reads only what the history shows - no description - newest first, to the project's limit", async () => {
      await api.buildOverviewResponse(STATUS_PAGE_ID);

      const read: Record<string, unknown> = historyRead()!;
      const select: Record<string, unknown> = read["select"] as Record<
        string,
        unknown
      >;

      expect(Object.keys(select).sort()).toEqual(
        [
          "_id",
          "currentScheduledMaintenanceState",
          "endsAt",
          "monitors",
          "startsAt",
          "title",
        ].sort(),
      );
      expect(read["sort"]).toEqual({ startsAt: SortOrder.Descending });
      expect(read["limit"]).toBe(LIMIT_PER_PROJECT);
    });

    it("is not made on a page that does not show scheduled maintenance", async () => {
      statusPage.showScheduledMaintenanceEventsOnStatusPage = false;
      events = [
        maintenance({
          key: "completed",
          title: "Not shown here",
          startsAt: daysAgo(3),
          endsAt: daysAgo(3, 14),
        }),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      expect(historyQuery()).toBeUndefined();
      expect(payload["timelineScheduledMaintenanceEvents"]).toEqual([]);
    });

    it("is not made on a page with no monitors", async () => {
      monitorsOnStatusPage = [];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      expect(historyQuery()).toBeUndefined();
      expect(payload["timelineScheduledMaintenanceEvents"]).toEqual([]);
    });

    it("is not made when the project has no state an event has started in", async () => {
      const result: Array<ScheduledMaintenance> =
        await api.getTimelineScheduledMaintenanceEvents({
          statusPage: statusPage,
          statusPageId: STATUS_PAGE_ID,
          monitorsOnStatusPage: monitorsOnStatusPage,
          scheduledMaintenanceStates: makeProgressStates().filter(
            (state: ScheduledMaintenanceState): boolean => {
              return Boolean(state.isScheduledState);
            },
          ),
          startDate: WINDOW_START,
          endDate: NOW,
        });

      expect(result).toEqual([]);
      expect(historyQuery()).toBeUndefined();
    });
  });

  describe("what each event says", () => {
    it("names only the page's own monitors", async () => {
      events = [
        maintenance({
          key: "completed",
          title: "Across teams",
          startsAt: daysAgo(3),
          endsAt: daysAgo(3, 14),
          monitorIds: [PAGE_MONITOR, OTHER_MONITOR, GROUP_MONITOR],
        }),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      const shipped: Array<ScheduledMaintenance> = BaseModel.fromJSONArray(
        payload["timelineScheduledMaintenanceEvents"] as JSONArray,
        ScheduledMaintenance,
      );

      expect(
        (shipped[0]?.monitors || [])
          .map((item: Monitor): string => {
            return String(item._id);
          })
          .sort(),
      ).toEqual([PAGE_MONITOR, GROUP_MONITOR].sort());
    });

    it("reads back in the browser as the history's events, placed in their lives", async () => {
      events = [
        maintenance({
          key: "verifying",
          title: "Network cutover",
          startsAt: daysAgo(1, 22),
          endsAt: daysAgo(0, 2),
        }),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      const items: Array<UptimeBarTooltipMaintenance> =
        UptimeMaintenanceUtil.fromScheduledMaintenances({
          events: BaseModel.fromJSONArray(
            payload["timelineScheduledMaintenanceEvents"] as JSONArray,
            ScheduledMaintenance,
          ),
          states: BaseModel.fromJSONArray(
            payload["scheduledMaintenanceStates"] as JSONArray,
            ScheduledMaintenanceState,
          ),
        });

      expect(items).toHaveLength(1);
      expect(items[0]!.title).toBe("Network cutover");
      expect(items[0]!.startsAt.toISOString()).toBe(
        daysAgo(1, 22).toISOString(),
      );
      expect(items[0]!.endsAt.toISOString()).toBe(daysAgo(0, 2).toISOString());
      expect(items[0]!.currentState?.name).toBe("Verifying");
      // A state of the project's own between Ongoing and Ended: in progress.
      expect(items[0]!.phase).toBe(ScheduledMaintenancePhaseOfState.InProgress);
      expect(
        items[0]!.monitorIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([PAGE_MONITOR]);
    });
  });
});
