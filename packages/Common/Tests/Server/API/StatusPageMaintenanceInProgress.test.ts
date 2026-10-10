import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import StatusPageHistoryChartBarColorRuleService from "../../../Server/Services/StatusPageHistoryChartBarColorRuleService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import { ExpressRequest } from "../../../Server/Utils/Express";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  PROGRESS_PROJECT_ID,
  ProgressStateKey,
  eventMatchesStateQuery,
  idsOfCondition,
  makeEventInState,
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
 * A status page shows a scheduled maintenance event as ongoing while it is
 * IN PROGRESS - in its project's ongoing state, or in a state of the
 * project's own placed between Ongoing and Ended ("Verifying") - and as over
 * once it is past that (Common/Utils/ScheduledMaintenanceStart).
 *
 * The overview used to ask for the ongoing flag alone, so an event moved on
 * to "Verifying" vanished from it mid-window: it was neither ongoing nor
 * scheduled there. The events list kept only events that started within its
 * history window, so a long event in progress fell off it - and off the RSS
 * feed built from it - while the overview still showed it.
 *
 * An event still to come is listed as such while it waits for its start -
 * in the scheduled state, or in a state of the project's own placed after
 * Scheduled and before Ongoing ("Confirmed") - by the same rule
 * (isWaitingToStart). Both lists asked for the scheduled flag alone, so an
 * event moved on to "Confirmed" dropped off the page, and off its RSS and
 * Atom feeds, until it started.
 *
 * The database is a stand-in that keeps the rows each query lets through: an
 * event's state (by id or flag), whether it is shown on status pages, and
 * when it starts, as Postgres would.
 */

const DAY_MS: number = 24 * 60 * 60 * 1000;

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "5d000000-0000-4000-8000-000000000001",
);

// A time condition's SQL (QueryHelper): between two dates.
const BETWEEN_SQL: RegExp = /^\(x >= :\w+ and x <= :\w+\)$/;

function passesStartsAt(
  event: ScheduledMaintenance,
  condition: unknown,
): boolean {
  if (condition === undefined) {
    return true;
  }

  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;
  const sql: string = operator.getSql!("x");
  const dates: Array<Date> = Object.values(
    (operator.objectLiteralParameters as Record<string, unknown>) || {},
  ) as Array<Date>;

  if (!BETWEEN_SQL.test(sql)) {
    throw new Error(`No stand-in for the time condition ${sql}`);
  }

  const startsAt: number = event.startsAt!.getTime();

  return startsAt >= dates[0]!.getTime() && startsAt <= dates[1]!.getTime();
}

function eventStartedDaysAgo(
  key: ProgressStateKey,
  daysAgo: number,
  title: string = `${key}, ${daysAgo} days ago`,
): ScheduledMaintenance {
  const event: ScheduledMaintenance = makeEventInState(key, { title });
  event.isVisibleOnStatusPage = true;
  event.startsAt = new Date(Date.now() - daysAgo * DAY_MS);
  event.endsAt = new Date(event.startsAt.getTime() + 60 * DAY_MS);
  return event;
}

function titlesOf(list: unknown): Array<string> {
  return ((list as JSONArray) || [])
    .map((item: unknown): string => {
      return String((item as JSONObject)["title"]);
    })
    .sort();
}

describe("a status page shows every scheduled maintenance event in progress as ongoing", () => {
  let api: StatusPageAPI;
  let events: Array<ScheduledMaintenance> = [];
  let eventQueries: Array<Record<string, unknown>> = [];
  let stateReads: ReturnType<typeof mockProgressStateReads>;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    api = new StatusPageAPI();
  });

  beforeEach(() => {
    eventQueries = [];
    events = [];

    const statusPage: StatusPage = new StatusPage();
    statusPage._id = STATUS_PAGE_ID.toString();
    statusPage.projectId = PROGRESS_PROJECT_ID;
    statusPage.showScheduledMaintenanceEventsOnStatusPage = true;
    statusPage.showScheduledEventHistoryInDays = 14;

    stateReads = mockProgressStateReads();

    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockResolvedValue(statusPage as never);
    jest
      .spyOn(StatusPageService, "getStatusPageResources")
      .mockResolvedValue([] as never);

    jest.spyOn(api, "getStatusPageResourcesAndTimelines").mockResolvedValue({
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
      monitorsOnStatusPage: [],
      monitorsInGroup: {},
      startDateForMonitorTimeline: new Date(Date.now() - 30 * DAY_MS),
      endDateForMonitorTimeline: new Date(),
    } as never);

    jest.spyOn(api, "checkHasReadAccess").mockResolvedValue(undefined as never);

    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockImplementation((async (args: { query: Record<string, unknown> }) => {
        eventQueries.push(args.query);

        return events.filter((event: ScheduledMaintenance): boolean => {
          return (
            eventMatchesStateQuery(event, args.query) &&
            (args.query["isVisibleOnStatusPage"] === undefined ||
              event.isVisibleOnStatusPage ===
                args.query["isVisibleOnStatusPage"]) &&
            passesStartsAt(event, args.query["startsAt"])
          );
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the overview", () => {
    it("shows an event in a state of the project's own between Ongoing and Ended, as it shows an ongoing one", async () => {
      events = [
        eventStartedDaysAgo("ongoing", 1, "Database upgrade"),
        eventStartedDaysAgo("verifying", 1, "Network cutover"),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      expect(titlesOf(payload["scheduledMaintenanceEvents"])).toEqual([
        "Database upgrade",
        "Network cutover",
      ]);
    });

    it.each([
      "ended",
      "reviewing",
      "completed",
      "archived",
    ] as Array<ProgressStateKey>)(
      "does not show an event in %s as ongoing",
      async (key: ProgressStateKey) => {
        events = [eventStartedDaysAgo(key, 1, "Not in progress")];

        const payload: JSONObject =
          await api.buildOverviewResponse(STATUS_PAGE_ID);

        expect(titlesOf(payload["scheduledMaintenanceEvents"])).toEqual([]);
      },
    );

    it("still lists the events waiting in the scheduled state, after the ones in progress", async () => {
      events = [
        eventStartedDaysAgo("scheduled", -3, "Next week's patching"),
        eventStartedDaysAgo("verifying", 1, "Network cutover"),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      expect(
        ((payload["scheduledMaintenanceEvents"] as JSONArray) || []).map(
          (item: unknown): string => {
            return String((item as JSONObject)["title"]);
          },
        ),
      ).toEqual(["Network cutover", "Next week's patching"]);
    });

    it("lists an event in a state of the project's own between Scheduled and Ongoing among the events to come, as it lists a scheduled one", async () => {
      events = [
        eventStartedDaysAgo("scheduled", -3, "Next week's patching"),
        eventStartedDaysAgo("confirmed", -2, "Confirmed cutover"),
        eventStartedDaysAgo("verifying", 1, "Network cutover"),
      ];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      expect(titlesOf(payload["scheduledMaintenanceEvents"])).toEqual([
        "Confirmed cutover",
        "Network cutover",
        "Next week's patching",
      ]);
    });

    it("asks for the events to come by their state's id - the scheduled state and the project's own before Ongoing - not by the scheduled flag", async () => {
      events = [eventStartedDaysAgo("confirmed", -2)];

      await api.buildOverviewResponse(STATUS_PAGE_ID);

      for (const query of eventQueries) {
        expect(
          (query["currentScheduledMaintenanceState"] as JSONObject)?.[
            "isScheduledState"
          ],
        ).toBeUndefined();
      }

      const waitingQuery: Record<string, unknown> | undefined =
        eventQueries.find((query: Record<string, unknown>): boolean => {
          return (
            (idsOfCondition(query["currentScheduledMaintenanceStateId"]) || [])
              .includes(progressStateId("confirmed").toString().toLowerCase())
          );
        });

      expect(waitingQuery).toBeDefined();
      expect(
        idsOfCondition(waitingQuery!["currentScheduledMaintenanceStateId"])!.sort(),
      ).toEqual(
        [
          progressStateId("scheduled").toString().toLowerCase(),
          progressStateId("confirmed").toString().toLowerCase(),
        ].sort(),
      );
      expect(waitingQuery!["isVisibleOnStatusPage"]).toBe(true);
    });

    it("asks for the events in progress by their state's id, among the events shown on status pages", async () => {
      events = [eventStartedDaysAgo("verifying", 1)];

      await api.buildOverviewResponse(STATUS_PAGE_ID);

      const inProgressQuery: Record<string, unknown> | undefined =
        eventQueries.find((query: Record<string, unknown>): boolean => {
          return query["currentScheduledMaintenanceStateId"] !== undefined;
        });

      expect(inProgressQuery).toBeDefined();
      expect(inProgressQuery!["isVisibleOnStatusPage"]).toBe(true);
      expect(inProgressQuery!["projectId"]?.toString()).toBe(
        PROGRESS_PROJECT_ID.toString(),
      );

      for (const query of eventQueries) {
        expect(
          (query["currentScheduledMaintenanceState"] as JSONObject)?.[
            "isOngoingState"
          ],
        ).toBeUndefined();
      }
    });

    it("ships the project's states, so the page can tell an event in progress by its place", async () => {
      events = [eventStartedDaysAgo("verifying", 1)];

      const payload: JSONObject =
        await api.buildOverviewResponse(STATUS_PAGE_ID);

      const stateIds: Array<string> = (
        (payload["scheduledMaintenanceStates"] as JSONArray) || []
      ).map((state: unknown): string => {
        return String((state as JSONObject)["_id"]);
      });

      expect(stateIds).toContain(progressStateId("verifying").toString());
      expect(stateIds).toContain(progressStateId("ongoing").toString());
    });
  });

  describe("the events list and the RSS feed built from it", () => {
    function request(): ExpressRequest {
      return {
        params: {},
        body: {},
        query: {},
        cookies: {},
        headers: {},
      } as unknown as ExpressRequest;
    }

    it("lists an event in progress that started before its history window", async () => {
      events = [
        eventStartedDaysAgo("ongoing", 30, "A month of migrations"),
        eventStartedDaysAgo("verifying", 30, "A month of verifying"),
      ];

      const payload: JSONObject = await api.getScheduledMaintenanceEvents(
        STATUS_PAGE_ID,
        null,
        request(),
      );

      expect(titlesOf(payload["scheduledMaintenanceEvents"])).toEqual([
        "A month of migrations",
        "A month of verifying",
      ]);
    });

    it("lists an event in progress inside the window once", async () => {
      events = [eventStartedDaysAgo("verifying", 2, "Network cutover")];

      const payload: JSONObject = await api.getScheduledMaintenanceEvents(
        STATUS_PAGE_ID,
        null,
        request(),
      );

      expect(titlesOf(payload["scheduledMaintenanceEvents"])).toEqual([
        "Network cutover",
      ]);
    });

    it.each([
      "scheduled",
      "confirmed",
    ] as Array<ProgressStateKey>)(
      "lists an event waiting in %s, whenever it was due to start, as an event to come",
      async (key: ProgressStateKey) => {
        events = [
          eventStartedDaysAgo(key, 30, "Overdue start"),
          eventStartedDaysAgo(key, -5, "Next week"),
        ];

        const payload: JSONObject = await api.getScheduledMaintenanceEvents(
          STATUS_PAGE_ID,
          null,
          request(),
        );

        expect(titlesOf(payload["scheduledMaintenanceEvents"])).toEqual([
          "Next week",
          "Overdue start",
        ]);
      },
    );

    it.each([
      "ended",
      "reviewing",
      "completed",
      "archived",
    ] as Array<ProgressStateKey>)(
      "leaves out an event in %s that started before its history window",
      async (key: ProgressStateKey) => {
        events = [eventStartedDaysAgo(key, 30, "Old event")];

        const payload: JSONObject = await api.getScheduledMaintenanceEvents(
          STATUS_PAGE_ID,
          null,
          request(),
        );

        expect(titlesOf(payload["scheduledMaintenanceEvents"])).toEqual([]);
      },
    );

    it("an event hidden from status pages stays hidden, in progress or not", async () => {
      const hidden: ScheduledMaintenance = eventStartedDaysAgo(
        "verifying",
        30,
        "Internal rehearsal",
      );
      hidden.isVisibleOnStatusPage = false;
      events = [hidden];

      const payload: JSONObject = await api.getScheduledMaintenanceEvents(
        STATUS_PAGE_ID,
        null,
        request(),
      );

      expect(titlesOf(payload["scheduledMaintenanceEvents"])).toEqual([]);

      for (const query of eventQueries) {
        expect(query["isVisibleOnStatusPage"]).toBe(true);
      }
    });

    it("reads each state's place and every built-in flag, so the page sorts events as the server does", async () => {
      events = [eventStartedDaysAgo("verifying", 2)];

      await api.getScheduledMaintenanceEvents(STATUS_PAGE_ID, null, request());

      const selects: Array<Record<string, unknown>> =
        stateReads.findBy.mock.calls.map(
          (call: Array<unknown>): Record<string, unknown> => {
            return ((call[0] as { select?: Record<string, unknown> }).select ||
              {}) as Record<string, unknown>;
          },
        );

      expect(selects.length).toBeGreaterThan(0);

      for (const select of selects) {
        expect(select).toEqual(
          expect.objectContaining({
            _id: true,
            order: true,
            isScheduledState: true,
            isOngoingState: true,
            isEndedState: true,
            isResolvedState: true,
          }),
        );
      }
    });
  });
});
