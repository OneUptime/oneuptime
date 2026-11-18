import OnCallDutyPolicyScheduleLayerUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyFeedService from "../../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleLayerService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "../../../../Server/Services/OnCallDutyPolicyTimeLogService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../../Server/Utils/Logger";
import { OnCallShiftChangeReason } from "../../../../Server/Utils/OnCall/OnCallShiftChangeListeners";
import ScheduleLayerChanges from "../../../../Server/Utils/OnCall/ScheduleLayerChanges";
import WorkspaceUserGroupSync from "../../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import { at } from "../../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import { stubProjectDirectory } from "../../TestingUtils/ProjectDirectory";
import {
  FakeDb,
  FakeRow,
  emptyDb,
  installFakeDb,
  makeAttachment,
  makeLayer,
  makeLayerUser,
  makeSchedule,
  makeUser,
  oid,
} from "./OnCallResolverTestHarness";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * A TERRAFORM APPLY THAT CHANGES A SCHEDULE'S TURN ORDER IS TOLD ONCE
 * (#7813).
 *
 * The Dashboard's Layers page saves a whole change in one request and tells
 * it once (ScheduleLayersSave). Terraform and the API write one row at a
 * time, and each row written used to work out who is on call and tell the
 * people it reached on its own: an apply that moves two people to the top
 * of a layer told one of them they were on call, then that they were not.
 *
 * Here the REAL hooks of the layer and layer-user services run, row by row,
 * and the REAL roster refresh after them, against tables held in memory
 * (OnCallResolverTestHarness):
 *
 *   - written with an API key, the rows are held: nobody is told anything,
 *     however many rows the change writes, until the Workers find the
 *     change quiet; then who is on call is worked out ONCE and the people
 *     it reaches, the policy's feed and its Slack channels hear about the
 *     whole change once - from what was on call to what is;
 *   - a single row written with an API key is told too, once;
 *   - written by a person in the Dashboard, each row is told at once, as
 *     before.
 *
 * The schedule, Payments primary: the Weekdays layer - Alex, Sam and Kim
 * take turns of a day, handing over at 09:00 UTC from Tuesday 3 March 2026.
 * It is noon on Tuesday: Alex is on call, Sam is next.
 */

const PROJECT: string = "0d781300-0000-4000-8000-000000000001";
const POLICY: string = "0d781300-0000-4000-8000-000000000002";
const SCHEDULE: string = "0d781300-0000-4000-8000-000000000004";
const WEEKDAYS: string = "0d781300-0000-4000-8000-000000000005";
const LEVEL_1: string = "0d781300-0000-4000-8000-000000000011";

const ALEX: string = "0d781300-0000-4000-8000-0000000000a1";
const SAM: string = "0d781300-0000-4000-8000-0000000000b1";
const KIM: string = "0d781300-0000-4000-8000-0000000000c1";

const NOW: Date = at("2026-03-03T12:00:00Z");

const NAMES: Record<string, string> = {
  [ALEX]: "Alex Kim",
  [SAM]: "Sam Lee",
  [KIM]: "Kim Ito",
};

// The rows of the people in the layer, by who they are.
const ROW: Record<string, string> = {
  [ALEX]: "0d781300-0000-4000-8000-000000000101",
  [SAM]: "0d781300-0000-4000-8000-000000000102",
  [KIM]: "0d781300-0000-4000-8000-000000000103",
};

const API_KEY: DatabaseCommonInteractionProps = {
  tenantId: oid(PROJECT),
  userType: UserType.API,
  apiKeyId: oid("0d781300-0000-4000-8000-0000000000f1"),
};

const DASHBOARD: DatabaseCommonInteractionProps = {
  tenantId: oid(PROJECT),
  userId: oid("0d781300-0000-4000-8000-0000000000f2"),
  userType: UserType.User,
};

interface Told {
  userId: string;
  eventType: string;
}

let db: FakeDb;
let now: Date;
let told: Array<Told>;
let feed: Array<string>;
let chat: Array<string>;
let refreshes: number;
let propagated: Array<{ scheduleIds: Array<string>; reason: string }>;

function lower(value: unknown): string {
  return String(value).toLowerCase();
}

function schedule(): FakeRow {
  return db.schedules[0]!;
}

function rowOf(userId: string): FakeRow {
  return db.layerUsers.find((row: FakeRow) => {
    return lower(row["_id"]) === ROW[userId];
  })!;
}

function onRoster(): { current: string; next: string } {
  return {
    current: NAMES[lower(schedule()["currentUserIdOnRoster"])] || "nobody",
    next: NAMES[lower(schedule()["nextUserIdOnRoster"])] || "nobody",
  };
}

function toldAs(): Array<string> {
  return told.map((entry: Told) => {
    const kind: string =
      entry.eventType ===
      NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER
        ? "no longer on call"
        : entry.eventType ===
            NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER
          ? "on call"
          : entry.eventType ===
              NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER
            ? "next"
            : entry.eventType;
    return `${NAMES[entry.userId]}: ${kind}`;
  });
}

// The roster as it is before the change: Alex on call, Sam next - told to nobody here.
async function rosterAsItIs(): Promise<void> {
  await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
    oid(SCHEDULE),
  );
  told = [];
  feed = [];
  chat = [];
  refreshes = 0;
  propagated = [];
}

/*
 * A person moved to a place in the turn order through the API, the people
 * they pass moved along, as a move does (ContiguousOrder.move) - then the
 * hook that tells of a layer user's change, as an update of the row runs
 * it. What is told, and when, is the same for the move: both tell through
 * tellLayerUserChange (ScheduleLayerChanges).
 */
async function movedTo(
  userId: string,
  newOrder: number,
  props: DatabaseCommonInteractionProps,
): Promise<void> {
  const moved: FakeRow = rowOf(userId);
  const previousOrder: number = Number(moved["order"]);

  for (const row of db.layerUsers) {
    const order: number = Number(row["order"]);

    if (row === moved) {
      continue;
    }

    if (
      newOrder < previousOrder &&
      order >= newOrder &&
      order < previousOrder
    ) {
      row["order"] = order + 1;
    }

    if (
      newOrder > previousOrder &&
      order <= newOrder &&
      order > previousOrder
    ) {
      row["order"] = order - 1;
    }
  }

  moved["order"] = newOrder;

  await (
    OnCallDutyPolicyScheduleLayerUserService as unknown as {
      onUpdateSuccess: (
        onUpdate: unknown,
        updatedItemIds: Array<ObjectID>,
      ) => Promise<unknown>;
    }
  ).onUpdateSuccess(
    {
      updateBy: {
        query: { _id: oid(ROW[userId]!) },
        data: { order: newOrder },
        props: props,
      },
      carryForward: null,
    },
    [oid(ROW[userId]!)],
  );
}

// The Workers' run at a moment: the changes whose quiet period is over are told.
async function workersRunAt(moment: Date): Promise<number> {
  now = moment;
  return await ScheduleLayerChanges.tellDueChanges(moment);
}

function secondsAfterNow(seconds: number): Date {
  return OneUptimeDate.addRemoveSeconds(NOW, seconds);
}

beforeEach(() => {
  stubProjectDirectory({});

  db = emptyDb();
  now = NOW;
  told = [];
  feed = [];
  chat = [];
  refreshes = 0;
  propagated = [];

  db.schedules.push(
    makeSchedule({
      id: SCHEDULE,
      projectId: PROJECT,
      name: "Payments primary",
      timezone: "UTC",
    }),
  );

  db.layers.push(
    makeLayer({
      id: WEEKDAYS,
      scheduleId: SCHEDULE,
      projectId: PROJECT,
      name: "Weekdays",
      order: 1,
      startsAt: at("2026-03-03T09:00:00Z"),
      handOffTime: at("2026-03-03T09:00:00Z"),
    }),
  );

  for (const [index, userId] of [ALEX, SAM, KIM].entries()) {
    db.layerUsers.push(
      makeLayerUser({
        id: ROW[userId]!,
        scheduleId: SCHEDULE,
        layerId: WEEKDAYS,
        projectId: PROJECT,
        userId: userId,
        order: index + 1,
      }),
    );
  }

  for (const userId of [ALEX, SAM, KIM]) {
    db.users.push(
      makeUser({ id: userId, name: NAMES[userId], timezone: "UTC" }),
    );
  }

  // The schedule pages Level 1 of the Payments policy: a hand-off tells people.
  db.attachments.push(
    makeAttachment({
      id: "0d781300-0000-4000-8000-000000000501",
      scheduleId: SCHEDULE,
      projectId: PROJECT,
      policyId: POLICY,
      policyName: "Payments",
      ruleId: LEVEL_1,
      ruleName: "Level 1",
    }),
  );

  installFakeDb(db);
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return now;
  });

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined as never;
    });
  }

  // A layer's or a layer user's row, as its hooks read it again by id.
  jest
    .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      return (
        db.layerUsers.find((row: FakeRow) => {
          return lower(row["_id"]) === lower(data.id);
        }) || null
      );
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleLayerService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      return (
        db.layers.find((row: FakeRow) => {
          return lower(row["_id"]) === lower(data.id);
        }) || null
      );
    }) as never);

  // Any write of another person's row the services make, as written.
  jest
    .spyOn(OnCallDutyPolicyScheduleLayerUserService, "updateOneBy")
    .mockImplementation((async (data: {
      query: { _id: string };
      data: JSONObject;
    }) => {
      Object.assign(
        db.layerUsers.find((row: FakeRow) => {
          return lower(row["_id"]) === lower(data.query._id);
        }) || {},
        data.data,
      );
      return 1;
    }) as never);

  // The hold, and its letting go: written on the schedule's row.
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      Object.assign(
        db.schedules.find((row: FakeRow) => {
          return lower(row["_id"]) === lower(data.id);
        }) || {},
        data.data,
      );
    }) as never);
  jest
    .spyOn(
      OnCallDutyPolicyScheduleService,
      "compareAndSetColumnsByIdWithoutHooks",
    )
    .mockImplementation((async (data: {
      id: ObjectID;
      data: JSONObject;
      expectedData: JSONObject;
    }) => {
      const row: FakeRow | undefined = db.schedules.find(
        (candidate: FakeRow) => {
          return lower(candidate["_id"]) === lower(data.id);
        },
      );

      const isAsExpected: boolean = Boolean(
        row &&
          Object.entries(data.expectedData).every(
            ([key, value]: [string, unknown]) => {
              return (
                (row[key] as Date | undefined)?.getTime() ===
                (value as Date | undefined)?.getTime()
              );
            },
          ),
      );

      if (row && isAsExpected) {
        Object.assign(row, data.data);
      }

      return isAsExpected;
    }) as never);

  // Who is on call: the real refresh, counted; its lock is a Redis one.
  const refresh: (scheduleId: ObjectID) => Promise<unknown> =
    OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule.bind(
      OnCallDutyPolicyScheduleService,
    );
  jest
    .spyOn(
      OnCallDutyPolicyScheduleService,
      "refreshCurrentUserIdAndHandoffTimeInSchedule",
    )
    .mockImplementation((async (scheduleId: ObjectID) => {
      refreshes++;
      return await refresh(scheduleId);
    }) as never);
  jest.spyOn(Semaphore, "lock").mockRejectedValue(new Error("no lock here"));

  // The roster the refresh works out, written to the schedule's row.
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "updateOneById")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      const row: FakeRow | undefined = db.schedules.find(
        (candidate: FakeRow) => {
          return lower(candidate["_id"]) === lower(data.id);
        },
      );
      Object.assign(row || {}, data.data);
    }) as never);

  // What a hand-off tells people, the policy's feed and its Slack channel.
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/policy"));
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findOneBy")
    .mockResolvedValue(null);
  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockImplementation((async (data: { userId: ObjectID }) => {
      return FeedMarkdown.asMarkdown(NAMES[lower(data.userId)] || "");
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
    .mockImplementation((async (data: { feedInfoInMarkdown: string }) => {
      feed.push(data.feedInfoInMarkdown);
    }) as never);
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
    .mockImplementation((async () => {
      const slack: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
      slack.workspaceType = WorkspaceType.Slack;
      slack.authToken = "xoxb-test";
      return [slack];
    }) as never);
  jest
    .spyOn(WorkspaceUtil, "getUserStringForWorkspace")
    .mockImplementation((async (data: { userId: ObjectID }) => {
      return `@${NAMES[lower(data.userId)] || ""}`;
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyFeedService, "sendWorkspaceNotification")
    .mockImplementation((async (data: {
      markdownByWorkspaceType?: Partial<Record<WorkspaceType, string>>;
    }) => {
      chat.push(data.markdownByWorkspaceType?.[WorkspaceType.Slack] || "");
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: {
      userId: ObjectID;
      eventType: NotificationSettingEventType;
    }) => {
      told.push({ userId: lower(data.userId), eventType: data.eventType });
    }) as never);
  jest
    .spyOn(WorkspaceUserGroupSync, "requestSyncForSchedules")
    .mockResolvedValue(undefined as never);

  // The calendar feeds and reminders: told of the change, here kept to be read.
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
    .mockImplementation((async (change: {
      scheduleIds: Array<ObjectID>;
      reason: OnCallShiftChangeReason;
    }) => {
      propagated.push({
        scheduleIds: change.scheduleIds.map(lower),
        reason: change.reason,
      });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a change written row by row through the API is told once", () => {
  test("two people moved to the top of a layer, row by row: nothing told until the change is quiet, then one round of messages for the final order", async () => {
    await rosterAsItIs();
    expect(onRoster()).toEqual({ current: "Alex Kim", next: "Sam Lee" });

    // The apply: Kim to the top, then Sam above her - two rows, seconds apart.
    await movedTo(KIM, 1, API_KEY);
    now = secondsAfterNow(4);
    await movedTo(SAM, 1, API_KEY);

    expect(
      [SAM, KIM, ALEX].map((userId: string) => {
        return `${NAMES[userId]}:${String(rowOf(userId)["order"])}`;
      }),
    ).toEqual(["Sam Lee:1", "Kim Ito:2", "Alex Kim:3"]);

    // Saved at once, told nothing yet: the roster as it was, nobody messaged.
    expect(refreshes).toBe(0);
    expect(told).toEqual([]);
    expect(feed).toEqual([]);
    expect(chat).toEqual([]);
    expect(propagated).toEqual([]);
    expect(onRoster()).toEqual({ current: "Alex Kim", next: "Sam Lee" });

    // Held until half a minute after the last row.
    expect((schedule()["rosterRefreshDueAt"] as Date).toISOString()).toBe(
      secondsAfterNow(34).toISOString(),
    );

    // A run before then tells nothing.
    expect(await workersRunAt(secondsAfterNow(30))).toBe(0);
    expect(refreshes).toBe(0);

    // The run after it: worked out once, from what was on call to what is.
    expect(await workersRunAt(secondsAfterNow(60))).toBe(1);

    expect(refreshes).toBe(1);
    expect(onRoster()).toEqual({ current: "Sam Lee", next: "Kim Ito" });
    expect(toldAs()).toEqual([
      "Alex Kim: no longer on call",
      "Sam Lee: on call",
      "Kim Ito: next",
    ]);

    // The policy's feed: one entry for the hand-off; its channel, one line each way it may want it.
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatch(/^📞 \*\*Sam Lee\*\* is now on call for /);
    expect(chat).toHaveLength(3);

    // Nobody hears of the step between: Kim on call after the first row.
    for (const entry of [...feed, ...chat]) {
      expect(entry).not.toMatch(/Kim Ito\W* is now on call/);
    }

    // The feeds and reminders: told once.
    expect(propagated).toEqual([
      {
        scheduleIds: [SCHEDULE],
        reason: OnCallShiftChangeReason.LayerChanged,
      },
    ]);

    // Let go: the next run finds nothing.
    expect(schedule()["rosterRefreshDueAt"]).toBeNull();
    expect(await workersRunAt(secondsAfterNow(120))).toBe(0);
    expect(refreshes).toBe(1);
  });

  test("the same rows written in the Dashboard are told at once, each on its own, as before", async () => {
    await rosterAsItIs();

    await movedTo(KIM, 1, DASHBOARD);
    await movedTo(SAM, 1, DASHBOARD);

    expect(refreshes).toBe(2);
    expect(propagated).toHaveLength(2);
    expect(schedule()["rosterRefreshDueAt"]).toBeUndefined();

    // Kim heard she was on call, then that she was not.
    expect(toldAs()).toEqual([
      "Alex Kim: no longer on call",
      "Kim Ito: on call",
      "Alex Kim: next",
      "Kim Ito: no longer on call",
      "Sam Lee: on call",
      "Kim Ito: next",
    ]);

    // Two hand-offs in the policy's feed and its channel, where the change made one.
    expect(feed).toHaveLength(2);
    expect(feed[0]).toMatch(/^📞 \*\*Kim Ito\*\* is now on call for /);
    expect(chat).toHaveLength(6);

    // Nothing waits for the Workers.
    expect(await workersRunAt(secondsAfterNow(60))).toBe(0);
  });

  test("a single row written through the API is told too, once", async () => {
    await rosterAsItIs();

    await movedTo(KIM, 1, API_KEY);

    expect(told).toEqual([]);

    expect(await workersRunAt(secondsAfterNow(31))).toBe(1);

    expect(refreshes).toBe(1);
    expect(onRoster()).toEqual({ current: "Kim Ito", next: "Alex Kim" });
    expect(toldAs()).toEqual([
      "Alex Kim: no longer on call",
      "Kim Ito: on call",
      "Alex Kim: next",
    ]);
    expect(propagated).toHaveLength(1);
  });

  test("a row written while the change was being told is told after it, once its own change is quiet", async () => {
    await rosterAsItIs();

    await movedTo(KIM, 1, API_KEY);

    // While the Workers tell the first change, the apply writes another row.
    const refresh: SpyInstance<
      typeof OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule
    > =
      OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule as unknown as SpyInstance<
        typeof OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule
      >;
    const realRefresh: (scheduleId: ObjectID) => Promise<unknown> =
      refresh.getMockImplementation() as unknown as (
        scheduleId: ObjectID,
      ) => Promise<unknown>;

    refresh.mockImplementationOnce((async (scheduleId: ObjectID) => {
      const answer: unknown = await realRefresh(scheduleId);
      now = secondsAfterNow(31);
      await movedTo(SAM, 1, API_KEY);
      return answer;
    }) as never);

    expect(await workersRunAt(secondsAfterNow(31))).toBe(1);

    // The first change was told; the row written meanwhile still holds the schedule.
    expect(onRoster().current).toBe("Kim Ito");
    expect((schedule()["rosterRefreshDueAt"] as Date).toISOString()).toBe(
      secondsAfterNow(61).toISOString(),
    );

    expect(await workersRunAt(secondsAfterNow(62))).toBe(1);

    expect(onRoster()).toEqual({ current: "Sam Lee", next: "Kim Ito" });
    expect(schedule()["rosterRefreshDueAt"]).toBeNull();
    expect(refreshes).toBe(2);
  });

  test("a layer written through the API waits with its schedule too", async () => {
    await rosterAsItIs();

    await (
      OnCallDutyPolicyScheduleLayerService as unknown as {
        onUpdateSuccess: (
          onUpdate: unknown,
          updatedItemIds: Array<ObjectID>,
        ) => Promise<unknown>;
      }
    ).onUpdateSuccess(
      {
        updateBy: {
          query: { _id: oid(WEEKDAYS) },
          data: { name: "Weekdays (EU)" },
          props: API_KEY,
        },
        carryForward: null,
      },
      [oid(WEEKDAYS)],
    );

    expect(refreshes).toBe(0);
    expect(schedule()["rosterRefreshDueAt"]).toBeInstanceOf(Date);

    expect(await workersRunAt(secondsAfterNow(31))).toBe(1);
    expect(refreshes).toBe(1);
    expect(propagated).toHaveLength(1);
  });

  test("a person added through the API: nothing told at once, the schedule held", async () => {
    await rosterAsItIs();

    const created: OnCallDutyPolicyScheduleLayerUser =
      new OnCallDutyPolicyScheduleLayerUser();
    created.id = oid(ROW[KIM]!);

    await (
      OnCallDutyPolicyScheduleLayerUserService as unknown as {
        onCreateSuccess: (
          onCreate: unknown,
          createdItem: OnCallDutyPolicyScheduleLayerUser,
        ) => Promise<unknown>;
      }
    ).onCreateSuccess(
      {
        createBy: { data: created, props: API_KEY },
        carryForward: null,
      },
      created,
    );

    expect(refreshes).toBe(0);
    expect(propagated).toEqual([]);
    expect(schedule()["rosterRefreshDueAt"]).toBeInstanceOf(Date);
  });
});
