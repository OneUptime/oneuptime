import OnCallDutyPolicyScheduleLayer from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../../Server/Services/AuditLogService";
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
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import logger from "../../../../Server/Utils/Logger";
import { OnCallShiftChangeReason } from "../../../../Server/Utils/OnCall/OnCallShiftChangeListeners";
import ScheduleLayersSave from "../../../../Server/Utils/OnCall/ScheduleLayersSave";
import WorkspaceUserGroupSync from "../../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ConflictException from "../../../../Types/Exception/ConflictException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../../Types/JSON";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import ScheduleLayersSaveUtil, {
  ScheduleLayersSaveRequest,
  ScheduleLayersSaveResult,
  ScheduleLayersState,
} from "../../../../Types/OnCallDutyPolicy/ScheduleLayersSave";
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
import { EntityManager } from "typeorm";

/*
 * SAVING THE CHANGES MADE ON A SCHEDULE'S LAYERS PAGE, ALL AT ONCE
 * (issue #7575) - on the server.
 *
 * Dragging someone in a layer used to save at once, and each change made
 * on its own worked out who is on call and messaged the people it reached.
 * The page now holds its changes until Save, and Save sends them in one
 * request (ScheduleLayersSave.save), which:
 *
 *   - writes them in one transaction, the schedule's row locked, held to
 *     the version of the layers the page read: a save made to layers
 *     someone has changed since is refused (409) and writes nothing;
 *   - asks the permission each change takes, as the change made on its own
 *     asks it, and writes nothing when one is refused;
 *   - works out who is on call ONCE, so the people it reaches hear about it
 *     once - from what was on call to what is, never the steps between;
 *   - tells the calendar feeds and reminders once, and records each row it
 *     wrote in the audit log.
 *
 * These run the real save and the real roster refresh against tables held
 * in memory (OnCallResolverTestHarness): the reads through the services,
 * the save's own statements through a stand-in for the transaction that
 * applies them to the same tables.
 *
 * The schedule, Payments primary: the Weekdays layer - Alex, Sam and Kim
 * take turns of a day, handing over at 09:00 UTC from Tuesday 3 March 2026
 * - and below it the Backup layer, Ria. It is noon on Tuesday: Alex is on
 * call, Sam is next.
 */

const PROJECT: string = "0d750000-0000-4000-8000-000000000001";
const POLICY: string = "0d750000-0000-4000-8000-000000000002";
const SCHEDULE: string = "0d750000-0000-4000-8000-000000000004";
const WEEKDAYS: string = "0d750000-0000-4000-8000-000000000005";
const BACKUP: string = "0d750000-0000-4000-8000-000000000006";
const LEVEL_1: string = "0d750000-0000-4000-8000-000000000011";
const SAVER: string = "0d750000-0000-4000-8000-0000000000f1";

const ALEX: string = "0d750000-0000-4000-8000-0000000000a1";
const SAM: string = "0d750000-0000-4000-8000-0000000000b1";
const KIM: string = "0d750000-0000-4000-8000-0000000000c1";
const RIA: string = "0d750000-0000-4000-8000-0000000000d1";
const LEE: string = "0d750000-0000-4000-8000-0000000000e1";

const NOW: Date = at("2026-03-03T12:00:00Z");

const NAMES: Record<string, string> = {
  [ALEX]: "Alex Kim",
  [SAM]: "Sam Lee",
  [KIM]: "Kim Ito",
  [RIA]: "Ria Das",
  [LEE]: "Lee Park",
};

// The rows of the people in the layers, by who they are.
const ROW: Record<string, string> = {
  [ALEX]: "0d750000-0000-4000-8000-000000000101",
  [SAM]: "0d750000-0000-4000-8000-000000000102",
  [KIM]: "0d750000-0000-4000-8000-000000000103",
  [RIA]: "0d750000-0000-4000-8000-000000000201",
};

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

interface Told {
  userId: string;
  eventType: string;
}

let db: FakeDb;
// The statements the save sent through its transaction, in order.
let statements: Array<Statement>;
let transactions: number;
// Runs inside the transaction before the save's first statement: someone else's change.
let beforeTheLock: (() => void) | null;
let insertedCount: number;
let told: Array<Told>;
let feed: Array<string>;
// The lines a hand-off sends the policy's chat channels (OnCallHandoffPosts).
let chat: Array<string>;
let refreshes: number;
let propagated: Array<{
  scheduleIds: Array<string>;
  projectId: string;
  userIds: Array<string>;
  reason: string;
}>;
let audit: Array<{
  kind: string;
  table: string;
  itemId: string;
  fields?: JSONObject;
}>;
let errors: Array<string>;

function props(
  overrides: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    tenantId: oid(PROJECT),
    userId: oid(SAVER),
    userType: UserType.User,
    ...overrides,
  };
}

function lower(value: unknown): string {
  return String(value).toLowerCase();
}

function layerRowsOf(layerId: string): Array<FakeRow> {
  return db.layerUsers
    .filter((row: FakeRow) => {
      return lower(row["onCallDutyPolicyScheduleLayerId"]) === layerId;
    })
    .sort((a: FakeRow, b: FakeRow) => {
      return Number(a["order"]) - Number(b["order"]);
    });
}

// Who takes turns in a layer now, in turn order, with their orders.
function turns(layerId: string): Array<string> {
  return layerRowsOf(layerId).map((row: FakeRow) => {
    return `${NAMES[lower(row["userId"])]}:${String(row["order"])}`;
  });
}

function layersInOrder(): Array<string> {
  return [...db.layers]
    .sort((a: FakeRow, b: FakeRow) => {
      return Number(a["order"]) - Number(b["order"]);
    })
    .map((row: FakeRow) => {
      return `${String(row["name"])}:${String(row["order"])}`;
    });
}

function currentState(): ScheduleLayersState {
  return {
    layers: db.layers.map((row: FakeRow) => {
      return { id: lower(row["_id"]), order: Number(row["order"]) };
    }),
    layerUsers: db.layerUsers.map((row: FakeRow) => {
      return {
        id: lower(row["_id"]),
        layerId: lower(row["onCallDutyPolicyScheduleLayerId"]),
        userId: lower(row["userId"]),
        order: Number(row["order"]),
      };
    }),
  };
}

// What the page sends when nothing is changed, to change a part of.
function unchanged(): ScheduleLayersSaveRequest {
  return ScheduleLayersSaveUtil.getUnchangedRequest(currentState());
}

// The people of a layer, in the order given: kept by their row, or added.
function peopleOf(
  ...userIds: Array<string>
): Array<{ layerUserId?: string | undefined; userId: string }> {
  return userIds.map((userId: string) => {
    const kept: string | undefined = ROW[userId];
    const stillThere: boolean = db.layerUsers.some((row: FakeRow) => {
      return lower(row["_id"]) === kept;
    });
    return kept && stillThere
      ? { layerUserId: kept, userId: userId }
      : { userId: userId };
  });
}

async function save(
  request: ScheduleLayersSaveRequest,
  callerProps: DatabaseCommonInteractionProps = props(),
): Promise<ScheduleLayersSaveResult> {
  return await ScheduleLayersSave.save({
    scheduleId: oid(SCHEDULE),
    request: request,
    props: callerProps,
  });
}

async function refusal(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the save to be refused");
}

// A statement, as what it does to which table.
function describeStatement(statement: Statement): string {
  const verb: string = statement.sql.split(" ")[0]!;
  const table: string =
    statement.sql.match(
      verb === "SELECT"
        ? / FROM "(\w+)"/
        : /^(?:DELETE FROM|UPDATE|INSERT INTO) "(\w+)"/,
    )?.[1] || "?";
  const locks: string = statement.sql.endsWith("FOR UPDATE")
    ? " FOR UPDATE"
    : "";
  return `${verb} ${table}${locks}`;
}

function writes(): Array<Statement> {
  return statements.filter((statement: Statement) => {
    return !statement.sql.startsWith("SELECT");
  });
}

/*
 * The transaction's statements, applied to the tables in memory as
 * Postgres would apply them - the save's own SQL, read just far enough.
 */
function runStatement(sql: string, parameters: Array<unknown>): unknown {
  statements.push({ sql: sql, parameters: parameters });

  const inSchedule: (row: FakeRow, scheduleAt: number) => boolean = (
    row: FakeRow,
    scheduleAt: number,
  ): boolean => {
    return (
      lower(row["onCallDutyPolicyScheduleId"]) ===
        lower(parameters[scheduleAt]) &&
      lower(row["projectId"]) === lower(parameters[scheduleAt + 1])
    );
  };

  if (sql.startsWith(`SELECT "_id" FROM "OnCallDutyPolicySchedule"`)) {
    return db.schedules
      .filter((row: FakeRow) => {
        return (
          lower(row["_id"]) === lower(parameters[0]) &&
          lower(row["projectId"]) === lower(parameters[1])
        );
      })
      .map((row: FakeRow) => {
        return { _id: lower(row["_id"]) };
      });
  }

  if (
    sql.startsWith(`SELECT "_id", "order" FROM "OnCallDutyPolicyScheduleLayer"`)
  ) {
    return db.layers
      .filter((row: FakeRow) => {
        return inSchedule(row, 0);
      })
      .map((row: FakeRow) => {
        return { _id: lower(row["_id"]), order: row["order"] };
      });
  }

  if (
    sql.startsWith(
      `SELECT "_id", "onCallDutyPolicyScheduleLayerId", "userId", "order" FROM "OnCallDutyPolicyScheduleLayerUser"`,
    )
  ) {
    return db.layerUsers
      .filter((row: FakeRow) => {
        return inSchedule(row, 0);
      })
      .map((row: FakeRow) => {
        return {
          _id: lower(row["_id"]),
          onCallDutyPolicyScheduleLayerId: lower(
            row["onCallDutyPolicyScheduleLayerId"],
          ),
          userId: lower(row["userId"]),
          order: row["order"],
        };
      });
  }

  if (sql.startsWith(`DELETE FROM "OnCallDutyPolicyScheduleLayerUser"`)) {
    const ids: Array<string> = (parameters[0] as Array<string>).map(lower);
    const before: number = db.layerUsers.length;
    db.layerUsers = db.layerUsers.filter((row: FakeRow) => {
      return !(ids.includes(lower(row["_id"])) && inSchedule(row, 1));
    });
    return [[], before - db.layerUsers.length];
  }

  if (sql.startsWith(`DELETE FROM "OnCallDutyPolicyScheduleLayer"`)) {
    const ids: Array<string> = (parameters[0] as Array<string>).map(lower);
    const deleted: Array<string> = db.layers
      .filter((row: FakeRow) => {
        return ids.includes(lower(row["_id"])) && inSchedule(row, 1);
      })
      .map((row: FakeRow) => {
        return lower(row["_id"]);
      });
    db.layers = db.layers.filter((row: FakeRow) => {
      return !deleted.includes(lower(row["_id"]));
    });
    // ON DELETE CASCADE.
    db.layerUsers = db.layerUsers.filter((row: FakeRow) => {
      return !deleted.includes(lower(row["onCallDutyPolicyScheduleLayerId"]));
    });
    return [[], deleted.length];
  }

  const update: RegExpMatchArray | null = sql.match(
    /^UPDATE "(OnCallDutyPolicyScheduleLayer|OnCallDutyPolicyScheduleLayerUser)" AS "row" SET "order" = "moved"\."order"/,
  );

  if (update) {
    const table: Array<FakeRow> =
      update[1] === "OnCallDutyPolicyScheduleLayer" ? db.layers : db.layerUsers;
    let count: number = 0;
    for (let at: number = 2; at < parameters.length; at += 2) {
      const row: FakeRow | undefined = table.find((candidate: FakeRow) => {
        return (
          lower(candidate["_id"]) === lower(parameters[at]) &&
          inSchedule(candidate, 0)
        );
      });
      if (row) {
        row["order"] = parameters[at + 1];
        count++;
      }
    }
    return [[], count];
  }

  if (sql.startsWith(`INSERT INTO "OnCallDutyPolicyScheduleLayerUser"`)) {
    const returned: Array<FakeRow> = [];
    for (let at: number = 3; at < parameters.length; at += 3) {
      insertedCount++;
      const id: string = `0d750000-0000-4000-8000-0000000009${String(insertedCount).padStart(2, "0")}`;
      const row: FakeRow = {
        ...makeLayerUser({
          id: id,
          scheduleId: lower(parameters[1]),
          layerId: lower(parameters[at]),
          projectId: lower(parameters[0]),
          userId: lower(parameters[at + 1]),
          order: Number(parameters[at + 2]),
        }),
        createdByUserId: parameters[2] ? oid(lower(parameters[2])) : null,
      };
      db.layerUsers.push(row);
      returned.push({
        _id: id,
        onCallDutyPolicyScheduleLayerId: lower(parameters[at]),
        userId: lower(parameters[at + 1]),
        order: Number(parameters[at + 2]),
      });
    }
    return returned;
  }

  throw new Error(`A statement the stand-in does not know: ${sql}`);
}

beforeEach(() => {
  stubProjectDirectory({});

  db = emptyDb();
  statements = [];
  transactions = 0;
  beforeTheLock = null;
  insertedCount = 0;
  told = [];
  feed = [];
  chat = [];
  refreshes = 0;
  propagated = [];
  audit = [];
  errors = [];

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
    makeLayer({
      id: BACKUP,
      scheduleId: SCHEDULE,
      projectId: PROJECT,
      name: "Backup",
      order: 2,
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

  db.layerUsers.push(
    makeLayerUser({
      id: ROW[RIA]!,
      scheduleId: SCHEDULE,
      layerId: BACKUP,
      projectId: PROJECT,
      userId: RIA,
      order: 1,
    }),
  );

  for (const userId of [ALEX, SAM, KIM, RIA, LEE]) {
    db.users.push(
      makeUser({ id: userId, name: NAMES[userId], timezone: "UTC" }),
    );
  }

  // The schedule pages Level 1 of the Payments policy: a hand-off tells people.
  db.attachments.push(
    makeAttachment({
      id: "0d750000-0000-4000-8000-000000000501",
      scheduleId: SCHEDULE,
      projectId: PROJECT,
      policyId: POLICY,
      policyName: "Payments",
      ruleId: LEVEL_1,
      ruleName: "Level 1",
    }),
  );

  installFakeDb(db);
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  for (const level of ["debug", "info", "warn"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined as never;
    });
  }
  jest.spyOn(logger, "error").mockImplementation(((message: unknown) => {
    errors.push(message instanceof Error ? message.message : String(message));
  }) as never);

  // The caller's permission reaches every row, unless a test says otherwise.
  jest
    .spyOn(ModelPermission, "checkDeleteQueryPermission")
    .mockImplementation((async (_model: unknown, query: unknown) => {
      return query;
    }) as never);
  jest
    .spyOn(ModelPermission, "checkUpdateQueryPermissions")
    .mockImplementation((async (_model: unknown, query: unknown) => {
      return query;
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleLayerUserService, "checkCallerMayCreate")
    .mockResolvedValue(undefined as never);

  // The transaction: the save's statements, applied to the tables above.
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "executeTransaction")
    .mockImplementation((async (
      run: (manager: EntityManager) => Promise<unknown>,
    ) => {
      transactions++;
      beforeTheLock?.();
      const manager: EntityManager = {
        query: async (sql: string, parameters: Array<unknown>) => {
          return runStatement(sql, parameters);
        },
      } as unknown as EntityManager;
      return await run(manager);
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

  /*
   * What a hand-off tells people: an entry in the policy's feed, and a line
   * in each of its Slack channels that wants one (OnCallHandoffPosts, issue
   * #7549). The policy pages this schedule alone, so its lines do not name
   * the schedule.
   */
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
      projectId: ObjectID;
      userIds: Array<ObjectID>;
      reason: OnCallShiftChangeReason;
    }) => {
      propagated.push({
        scheduleIds: change.scheduleIds.map(lower),
        projectId: lower(change.projectId),
        userIds: change.userIds.map(lower).sort(),
        reason: change.reason,
      });
    }) as never);

  // The audit log.
  jest.spyOn(AuditLogService, "recordDelete").mockImplementation((async (data: {
    model: { tableName?: string };
    itemId: ObjectID;
  }) => {
    audit.push({
      kind: "delete",
      table: data.model.tableName || "",
      itemId: lower(data.itemId),
    });
  }) as never);
  jest.spyOn(AuditLogService, "recordUpdate").mockImplementation((async (data: {
    model: { tableName?: string };
    itemId: ObjectID;
    updatedFields: JSONObject;
  }) => {
    audit.push({
      kind: "update",
      table: data.model.tableName || "",
      itemId: lower(data.itemId),
      fields: data.updatedFields,
    });
  }) as never);
  jest.spyOn(AuditLogService, "recordCreate").mockImplementation((async (data: {
    model: { tableName?: string };
    createdItem: OnCallDutyPolicyScheduleLayerUser;
  }) => {
    audit.push({
      kind: "create",
      table: data.model.tableName || "",
      itemId: lower(data.createdItem.id),
      fields: {
        userId: lower(data.createdItem.userId),
        order: data.createdItem.order || 0,
        createdByUserId: lower(data.createdItem.createdByUserId),
      },
    });
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The roster as it is before the save: Alex on call, Sam next - told to nobody here.
async function rosterAsItIs(): Promise<void> {
  await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
    oid(SCHEDULE),
  );
  told = [];
  feed = [];
  chat = [];
  refreshes = 0;
}

function onRoster(): { current: string; next: string } {
  const row: FakeRow = db.schedules[0]!;
  return {
    current: NAMES[lower(row["currentUserIdOnRoster"])] || "nobody",
    next: NAMES[lower(row["nextUserIdOnRoster"])] || "nobody",
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

describe("one save, one round of messages", () => {
  test("people dragged into a new turn order: who is on call is worked out once, and only the final order is announced", async () => {
    await rosterAsItIs();
    expect(onRoster()).toEqual({ current: "Alex Kim", next: "Sam Lee" });

    /*
     * On the page: Kim dragged to the top, then Sam above her - two drags,
     * each of which used to be saved, and announced, on its own.
     */
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[0]!.users = peopleOf(SAM, KIM, ALEX);

    await save(request);

    expect(turns(WEEKDAYS)).toEqual(["Sam Lee:1", "Kim Ito:2", "Alex Kim:3"]);
    expect(refreshes).toBe(1);
    expect(onRoster()).toEqual({ current: "Sam Lee", next: "Kim Ito" });

    // Alex hands over to Sam, Kim is next - and nobody hears of the step between.
    expect(toldAs()).toEqual([
      "Alex Kim: no longer on call",
      "Sam Lee: on call",
      "Kim Ito: next",
    ]);

    /*
     * The policy's feed: one entry for the hand-off (issue #7549) - Sam on
     * call, Kim after - not one for each of the three people.
     */
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatch(
      /^📞 \*\*Sam Lee\*\* is now on call for \[Payments\]\(https:\/\/oneuptime\.example\/policy\) until .+, then \*\*Kim Ito\*\*\.$/,
    );

    /*
     * Its channels: a line for each way a channel can want the hand-off -
     * who is on call with who is next, who is on call alone, who is next
     * alone - of which each channel gets one (OnCallHandoffPosts).
     */
    expect(chat).toHaveLength(3);
    expect(chat[0]).toMatch(
      /^📞 @Sam Lee is now on call for \[Payments\]\(https:\/\/oneuptime\.example\/policy\) until .+, then @Kim Ito\.$/,
    );
    expect(chat[1]).toMatch(/^📞 @Sam Lee is now on call for .+ until .+\.$/);
    expect(chat[1]).not.toContain("Kim Ito");
    expect(chat[2]).toMatch(/^➡️ @Kim Ito is next on call for .+, from .+\.$/);

    // Nobody hears of the step between: Kim on call after the first drag.
    for (const entry of [...feed, ...chat]) {
      expect(entry).not.toMatch(/Kim Ito\W* is now on call/);
      expect(entry).not.toContain("Alex Kim");
    }
  });

  test("a layer moved to the top: one hand-off, to the person at the top of it", async () => {
    await rosterAsItIs();

    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers = [request.layers[1]!, request.layers[0]!];

    const result: ScheduleLayersSaveResult = await save(request);

    expect(layersInOrder()).toEqual(["Backup:1", "Weekdays:2"]);
    expect(refreshes).toBe(1);
    expect(onRoster().current).toBe("Ria Das");
    expect(
      toldAs().filter((line: string) => {
        return line.endsWith(": on call");
      }),
    ).toEqual(["Ria Das: on call"]);
    expect(toldAs()).toContain("Alex Kim: no longer on call");
    expect(result.movedLayers).toBe(2);

    // The policy's feed: one entry for the one hand-off (issue #7549).
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatch(
      /^📞 \*\*Ria Das\*\* is now on call for \[Payments\]/,
    );
  });

  test("someone added at the end changes nobody's turn now: worked out once, and nobody is told anything", async () => {
    await rosterAsItIs();

    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[0]!.users = peopleOf(ALEX, SAM, KIM, LEE);

    await save(request);

    expect(turns(WEEKDAYS)).toEqual([
      "Alex Kim:1",
      "Sam Lee:2",
      "Kim Ito:3",
      "Lee Park:4",
    ]);
    expect(refreshes).toBe(1);
    expect(told).toEqual([]);
    expect(feed).toEqual([]);
  });

  test("a save that changes nothing writes nothing, works nothing out and tells nobody", async () => {
    await rosterAsItIs();

    const result: ScheduleLayersSaveResult = await save(unchanged());

    expect(transactions).toBe(0);
    expect(statements).toEqual([]);
    expect(refreshes).toBe(0);
    expect(told).toEqual([]);
    expect(propagated).toEqual([]);
    expect(audit).toEqual([]);
    expect(result).toEqual({
      version: ScheduleLayersSaveUtil.getVersion(currentState()),
      deletedLayers: 0,
      movedLayers: 0,
      addedLayerUsers: 0,
      removedLayerUsers: 0,
      movedLayerUsers: 0,
    });
  });

  test("a roster that cannot be worked out does not make a saved change unsaved", async () => {
    jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "refreshCurrentUserIdAndHandoffTimeInSchedule",
      )
      .mockRejectedValue(new Error("Slack is down") as never);

    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[0]!.users = peopleOf(SAM, ALEX, KIM);

    const result: ScheduleLayersSaveResult = await save(request);

    expect(turns(WEEKDAYS)).toEqual(["Sam Lee:1", "Alex Kim:2", "Kim Ito:3"]);
    expect(result.movedLayerUsers).toBeGreaterThan(0);
    expect(errors).toContain("Slack is down");
    // The feeds and the audit log still hear of it.
    expect(propagated.length).toBe(1);
    expect(audit.length).toBeGreaterThan(0);
  });
});

describe("what the save writes, in one transaction", () => {
  test("every change at once: the statements, in order, through one transaction - and no change made on its own", async () => {
    const created: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OnCallDutyPolicyScheduleLayerUserService,
      "create",
    );
    const updated: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OnCallDutyPolicyScheduleLayerUserService,
      "updateOneById",
    );
    const deleted: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OnCallDutyPolicyScheduleLayerService,
      "deleteOneById",
    );

    // Weekdays: Kim to the top, Alex out, Lee added. Backup deleted.
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers = [request.layers[0]!];
    request.layers[0]!.users = peopleOf(KIM, SAM, LEE);
    request.deletedLayerIds = [BACKUP];

    const result: ScheduleLayersSaveResult = await save(request);

    expect(transactions).toBe(1);
    expect(statements.map(describeStatement)).toEqual([
      "SELECT OnCallDutyPolicySchedule FOR UPDATE",
      "SELECT OnCallDutyPolicyScheduleLayer FOR UPDATE",
      "SELECT OnCallDutyPolicyScheduleLayerUser FOR UPDATE",
      "DELETE OnCallDutyPolicyScheduleLayerUser",
      "DELETE OnCallDutyPolicyScheduleLayer",
      "UPDATE OnCallDutyPolicyScheduleLayerUser",
      "INSERT OnCallDutyPolicyScheduleLayerUser",
      "SELECT OnCallDutyPolicyScheduleLayer FOR UPDATE",
      "SELECT OnCallDutyPolicyScheduleLayerUser FOR UPDATE",
    ]);

    // The schedule's row is locked first, and the layers read under the lock.
    expect(statements[0]!.parameters).toEqual([SCHEDULE, PROJECT]);

    expect(layersInOrder()).toEqual(["Weekdays:1"]);
    expect(turns(WEEKDAYS)).toEqual(["Kim Ito:1", "Sam Lee:2", "Lee Park:3"]);
    // Ria went with the Backup layer.
    expect(turns(BACKUP)).toEqual([]);

    // Lee's row: by the person who saved.
    const lee: FakeRow = layerRowsOf(WEEKDAYS)[2]!;
    expect(lower(lee["createdByUserId"])).toBe(SAVER);
    expect(lower(lee["onCallDutyPolicyScheduleId"])).toBe(SCHEDULE);
    expect(lower(lee["projectId"])).toBe(PROJECT);

    // No change made on its own, with hooks that would each refresh the roster.
    expect(created).not.toHaveBeenCalled();
    expect(updated).not.toHaveBeenCalled();
    expect(deleted).not.toHaveBeenCalled();
    expect(refreshes).toBe(1);

    expect(result).toEqual({
      version: ScheduleLayersSaveUtil.getVersion(currentState()),
      deletedLayers: 1,
      movedLayers: 0,
      addedLayerUsers: 1,
      removedLayerUsers: 1,
      // Kim; Sam keeps the second turn.
      movedLayerUsers: 1,
    });
  });

  test("the new orders go in one statement per table, every row of the schedule's", async () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers = [request.layers[1]!, request.layers[0]!];
    request.layers[1]!.users = peopleOf(KIM, ALEX, SAM);

    await save(request);

    const updates: Array<Statement> = writes().filter(
      (statement: Statement) => {
        return statement.sql.startsWith("UPDATE");
      },
    );

    expect(updates.length).toBe(2);
    expect(updates[0]!.sql).toContain(
      `UPDATE "OnCallDutyPolicyScheduleLayer" AS`,
    );
    expect(updates[0]!.parameters).toEqual([
      SCHEDULE,
      PROJECT,
      BACKUP,
      1,
      WEEKDAYS,
      2,
    ]);
    expect(updates[1]!.sql).toContain(
      `UPDATE "OnCallDutyPolicyScheduleLayerUser" AS`,
    );
    expect(updates[1]!.parameters).toEqual([
      SCHEDULE,
      PROJECT,
      ROW[KIM],
      1,
      ROW[ALEX],
      2,
      ROW[SAM],
      3,
    ]);
    // Each changed row is a new version of itself, as an edit makes it.
    for (const update of updates) {
      expect(update.sql).toContain(`"version" = "row"."version" + 1`);
      expect(update.sql).toContain(`"updatedAt" = now()`);
      expect(update.sql).toContain(
        `"row"."onCallDutyPolicyScheduleId" = $1 AND "row"."projectId" = $2`,
      );
    }
  });

  test("someone added to a layer twice takes two turns, and two rows", async () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[1]!.users = peopleOf(RIA, LEE, LEE);

    const result: ScheduleLayersSaveResult = await save(request);

    expect(turns(BACKUP)).toEqual(["Ria Das:1", "Lee Park:2", "Lee Park:3"]);
    expect(result.addedLayerUsers).toBe(2);
    expect(
      writes().filter((statement: Statement) => {
        return statement.sql.startsWith("INSERT");
      }).length,
    ).toBe(1);
  });

  test("everyone taken out of a layer leaves the layer, with nobody in it", async () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[0]!.users = [];

    await save(request);

    expect(turns(WEEKDAYS)).toEqual([]);
    expect(layersInOrder()).toEqual(["Weekdays:1", "Backup:2"]);
  });
});

describe("a save made to layers someone has changed since", () => {
  test("is refused before anything is written, in plain words, as a conflict", async () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[0]!.users = peopleOf(SAM, ALEX, KIM);

    // Someone else adds Lee before this save arrives.
    db.layerUsers.push(
      makeLayerUser({
        id: "0d750000-0000-4000-8000-000000000301",
        scheduleId: SCHEDULE,
        layerId: BACKUP,
        projectId: PROJECT,
        userId: LEE,
        order: 2,
      }),
    );

    const error: Error = await refusal(() => {
      return save(request);
    });

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(ScheduleLayersSave.CONFLICT_MESSAGE);
    expect(transactions).toBe(0);
    expect(turns(WEEKDAYS)).toEqual(["Alex Kim:1", "Sam Lee:2", "Kim Ito:3"]);
    expect(refreshes).toBe(0);
    expect(propagated).toEqual([]);
    expect(audit).toEqual([]);
  });

  test("a change that lands while the save waits for the lock: refused under the lock, nothing written", async () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[0]!.users = peopleOf(SAM, ALEX, KIM);

    // Another save of these layers commits between this save's read and its lock.
    beforeTheLock = (): void => {
      const kim: FakeRow = db.layerUsers.find((row: FakeRow) => {
        return lower(row["_id"]) === ROW[KIM];
      })!;
      const alex: FakeRow = db.layerUsers.find((row: FakeRow) => {
        return lower(row["_id"]) === ROW[ALEX];
      })!;
      kim["order"] = 1;
      alex["order"] = 3;
    };

    const error: Error = await refusal(() => {
      return save(request);
    });

    expect(error).toBeInstanceOf(ConflictException);
    expect(transactions).toBe(1);
    // The lock, the layers and their people read again - and no write.
    expect(statements.length).toBe(3);
    expect(writes()).toEqual([]);
    expect(turns(WEEKDAYS)).toEqual(["Kim Ito:1", "Sam Lee:2", "Alex Kim:3"]);
    expect(refreshes).toBe(0);
    expect(propagated).toEqual([]);
    expect(audit).toEqual([]);
  });

  test("a schedule deleted while the save waits: not found, nothing written", async () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[0]!.users = peopleOf(SAM, ALEX, KIM);

    beforeTheLock = (): void => {
      db.schedules = [];
    };

    const error: Error = await refusal(() => {
      return save(request);
    });

    expect(error).toBeInstanceOf(NotFoundException);
    expect(statements.length).toBe(1);
    expect(refreshes).toBe(0);
  });

  test("the version the save answers is the one the page saves next to", async () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[0]!.users = peopleOf(SAM, ALEX, KIM);

    const first: ScheduleLayersSaveResult = await save(request);
    expect(first.version).not.toBe(request.basedOnVersion);

    // The page's next save, made to what the first one answered.
    const next: ScheduleLayersSaveRequest = unchanged();
    expect(next.basedOnVersion).toBe(first.version);
    next.layers[0]!.users = peopleOf(KIM, SAM, ALEX);
    await save(next);

    expect(turns(WEEKDAYS)).toEqual(["Kim Ito:1", "Sam Lee:2", "Alex Kim:3"]);

    // The first page's version is gone: saved again, it is a conflict.
    const stale: Error = await refusal(() => {
      return save(request);
    });
    expect(stale).toBeInstanceOf(ConflictException);
  });
});

describe("what the save is refused, before anything is written", () => {
  test("a schedule the caller cannot read, or of another project, is not found", async () => {
    const findOne: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OnCallDutyPolicyScheduleService, "findOneBy")
      .mockResolvedValue(null as never);

    const error: Error = await refusal(() => {
      return save(unchanged());
    });

    expect(error).toBeInstanceOf(NotFoundException);
    // Asked as the caller, in the caller's project.
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: oid(SCHEDULE), projectId: oid(PROJECT) },
        props: expect.objectContaining({ userId: oid(SAVER) }),
      }),
    );
    expect(transactions).toBe(0);
  });

  test("a save that names no project", async () => {
    const error: Error = await refusal(() => {
      return save(unchanged(), props({ tenantId: undefined }));
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(transactions).toBe(0);
  });

  test("a save that is no save of these layers, in plain words", async () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    // Ria moved into Weekdays by her Backup row.
    request.layers[0]!.users.push(request.layers[1]!.users.pop()!);

    const error: Error = await refusal(() => {
      return save(request);
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("is a person in another layer");
    expect(transactions).toBe(0);
  });

  type DeniedCheck = {
    name: string;
    change: (request: ScheduleLayersSaveRequest) => void;
    deny: () => void;
    says: string;
  };

  const deniedChecks: Array<DeniedCheck> = [
    {
      name: "a layer deleted, by someone who may not delete layers",
      change: (request: ScheduleLayersSaveRequest): void => {
        request.layers = [request.layers[0]!];
        request.deletedLayerIds = [BACKUP];
      },
      deny: (): void => {
        jest
          .spyOn(ModelPermission, "checkDeleteQueryPermission")
          .mockRejectedValue(
            new NotAuthorizedException(
              "You do not have permissions to delete this record.",
            ) as never,
          );
      },
      says: "You do not have permissions to delete this record.",
    },
    {
      name: "a layer deleted that the caller's permission does not reach",
      change: (request: ScheduleLayersSaveRequest): void => {
        request.layers = [request.layers[0]!];
        request.deletedLayerIds = [BACKUP];
      },
      deny: (): void => {
        // Narrowed, as a scoped permission narrows it, to rows that are not this one.
        jest
          .spyOn(ModelPermission, "checkDeleteQueryPermission")
          .mockImplementation((async (_model: unknown, query: JSONObject) => {
            return { ...query, _id: QueryHelper.any([oid(WEEKDAYS)]) };
          }) as never);
      },
      says: "You do not have permission to delete the layers of this schedule.",
    },
    {
      name: "the layers' priority changed, by someone who may not edit layers",
      change: (request: ScheduleLayersSaveRequest): void => {
        request.layers = [request.layers[1]!, request.layers[0]!];
      },
      deny: (): void => {
        jest
          .spyOn(ModelPermission, "checkUpdateQueryPermissions")
          .mockImplementation((async (_model: unknown, query: JSONObject) => {
            return { ...query, _id: QueryHelper.any([]) };
          }) as never);
      },
      says: "You do not have permission to change the priority of this schedule's layers.",
    },
    {
      name: "someone taken out, by someone who may not take people out",
      change: (request: ScheduleLayersSaveRequest): void => {
        request.layers[0]!.users = peopleOf(ALEX, KIM);
      },
      deny: (): void => {
        jest
          .spyOn(ModelPermission, "checkDeleteQueryPermission")
          .mockImplementation((async (_model: unknown, query: JSONObject) => {
            return { ...query, _id: QueryHelper.any([]) };
          }) as never);
      },
      says: "You do not have permission to take people out of this schedule's layers.",
    },
    {
      name: "the turn order changed, by someone who may not edit it",
      change: (request: ScheduleLayersSaveRequest): void => {
        request.layers[0]!.users = peopleOf(KIM, ALEX, SAM);
      },
      deny: (): void => {
        jest
          .spyOn(ModelPermission, "checkUpdateQueryPermissions")
          .mockImplementation((async (_model: unknown, query: JSONObject) => {
            return { ...query, _id: QueryHelper.any([]) };
          }) as never);
      },
      says: "You do not have permission to change the turn order of this schedule's layers.",
    },
    {
      name: "someone added, by someone who may not add people",
      change: (request: ScheduleLayersSaveRequest): void => {
        request.layers[1]!.users = peopleOf(RIA, LEE);
      },
      deny: (): void => {
        jest
          .spyOn(
            OnCallDutyPolicyScheduleLayerUserService,
            "checkCallerMayCreate",
          )
          .mockRejectedValue(
            new NotAuthorizedException(
              "You do not have permissions to create this record.",
            ) as never,
          );
      },
      says: "You do not have permissions to create this record.",
    },
  ];

  test.each(deniedChecks)(
    "$name: refused, and nothing else saved with it",
    async (denied: DeniedCheck) => {
      denied.deny();

      // Along with it, a change the caller may make.
      const request: ScheduleLayersSaveRequest = unchanged();
      denied.change(request);

      const error: Error = await refusal(() => {
        return save(request);
      });

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error.message).toBe(denied.says);
      expect(transactions).toBe(0);
      expect(statements).toEqual([]);
      expect(refreshes).toBe(0);
      expect(propagated).toEqual([]);
      expect(audit).toEqual([]);
    },
  );

  test("someone who is not a member of the project is not added", async () => {
    stubProjectDirectory({
      projectId: oid(PROJECT),
      members: [ALEX, SAM, KIM, RIA],
    });

    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[1]!.users = peopleOf(RIA, LEE);

    const error: Error = await refusal(() => {
      return save(request);
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(transactions).toBe(0);
  });

  test("each change is asked as it is asked when made on its own", async () => {
    const deleteChecks: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ModelPermission,
      "checkDeleteQueryPermission",
    );
    const updateChecks: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ModelPermission,
      "checkUpdateQueryPermissions",
    );
    const createChecks: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OnCallDutyPolicyScheduleLayerUserService,
      "checkCallerMayCreate",
    );

    // Weekdays: Kim moved up, Alex out, Lee added twice. Backup deleted.
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers = [request.layers[0]!];
    request.layers[0]!.users = peopleOf(KIM, SAM, LEE, LEE);
    request.deletedLayerIds = [BACKUP];

    const callerProps: DatabaseCommonInteractionProps = props();
    await save(request, callerProps);

    // The layer deleted, and Alex taken out: as deletes.
    expect(
      deleteChecks.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as { name: string }).name;
      }),
    ).toEqual([
      OnCallDutyPolicyScheduleLayer.name,
      OnCallDutyPolicyScheduleLayerUser.name,
    ]);
    // Kim and Sam in a new turn order: as an edit of their order - and no layer edit, as Weekdays only stepped up.
    expect(updateChecks).toHaveBeenCalledTimes(1);
    expect(updateChecks.mock.calls[0]![0]).toBe(
      OnCallDutyPolicyScheduleLayerUser,
    );
    expect(updateChecks.mock.calls[0]![2]).toEqual({ order: 1 });
    expect(updateChecks.mock.calls[0]![3]).toBe(callerProps);
    // Lee: asked about once, as his row would be created.
    expect(createChecks).toHaveBeenCalledTimes(1);
    const asked: OnCallDutyPolicyScheduleLayerUser = (
      createChecks.mock.calls[0]![0] as {
        data: OnCallDutyPolicyScheduleLayerUser;
      }
    ).data;
    expect(lower(asked.userId)).toBe(LEE);
    expect(lower(asked.onCallDutyPolicyScheduleLayerId)).toBe(WEEKDAYS);
    expect(lower(asked.onCallDutyPolicyScheduleId)).toBe(SCHEDULE);
    expect(lower(asked.projectId)).toBe(PROJECT);
    expect(asked.order).toBe(3);
  });

  test("the people of a layer stepping down for someone added above them is no edit of theirs", async () => {
    const updateChecks: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ModelPermission,
      "checkUpdateQueryPermissions",
    );

    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[0]!.users = peopleOf(LEE, ALEX, SAM, KIM);

    await save(request);

    expect(updateChecks).not.toHaveBeenCalled();
    expect(turns(WEEKDAYS)).toEqual([
      "Lee Park:1",
      "Alex Kim:2",
      "Sam Lee:3",
      "Kim Ito:4",
    ]);
  });
});

describe("after the save", () => {
  test("the calendar feeds and reminders hear of it once, with each person it names", async () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[0]!.users = peopleOf(SAM, ALEX, LEE);

    await save(request);

    expect(propagated).toEqual([
      {
        scheduleIds: [SCHEDULE],
        projectId: PROJECT,
        userIds: [ALEX, SAM, KIM, LEE].sort(),
        reason: OnCallShiftChangeReason.LayerUserChanged,
      },
    ]);
  });

  test("a layer deleted or moved is a change of the layers", async () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers = [request.layers[0]!];
    request.deletedLayerIds = [BACKUP];

    await save(request);

    expect(propagated).toEqual([
      {
        scheduleIds: [SCHEDULE],
        projectId: PROJECT,
        // Ria, in the layer deleted.
        userIds: [RIA],
        reason: OnCallShiftChangeReason.LayerChanged,
      },
    ]);
  });

  test("the audit log records each row written, as each change made on its own records it", async () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers = [request.layers[0]!];
    request.layers[0]!.users = peopleOf(KIM, SAM, LEE);
    request.deletedLayerIds = [BACKUP];

    await save(request);

    // Kim to the first turn; Sam keeps the second, and is no edit.
    const leeRow: string = lower(layerRowsOf(WEEKDAYS)[2]!["_id"]);

    expect(
      [...audit].sort(
        (
          a: { itemId: string; kind: string },
          b: { itemId: string; kind: string },
        ) => {
          return `${a.kind}${a.itemId}`.localeCompare(`${b.kind}${b.itemId}`);
        },
      ),
    ).toEqual(
      [
        {
          kind: "delete",
          table: "OnCallDutyPolicyScheduleLayerUser",
          itemId: ROW[ALEX],
        },
        {
          kind: "delete",
          table: "OnCallDutyPolicyScheduleLayer",
          itemId: BACKUP,
        },
        {
          kind: "update",
          table: "OnCallDutyPolicyScheduleLayerUser",
          itemId: ROW[KIM],
          fields: { order: 1 },
        },
        {
          kind: "create",
          table: "OnCallDutyPolicyScheduleLayerUser",
          itemId: leeRow,
          fields: { userId: LEE, order: 3, createdByUserId: SAVER },
        },
      ].sort(
        (
          a: { itemId: string | undefined; kind: string },
          b: { itemId: string | undefined; kind: string },
        ) => {
          return `${a.kind}${a.itemId}`.localeCompare(`${b.kind}${b.itemId}`);
        },
      ),
    );
  });

  test("an API key's save is recorded as the key's, with nobody as the creator of the rows", async () => {
    const request: ScheduleLayersSaveRequest = unchanged();
    request.layers[1]!.users = peopleOf(RIA, LEE);

    await save(
      request,
      props({
        userId: undefined,
        apiKeyId: ObjectID.generate(),
        userType: UserType.API,
      }),
    );

    const lee: FakeRow = layerRowsOf(BACKUP)[1]!;
    expect(lee["createdByUserId"]).toBeNull();
    expect(
      (statements.find((statement: Statement) => {
        return statement.sql.startsWith("INSERT");
      })!.parameters[2] as unknown) ?? null,
    ).toBeNull();
  });
});
