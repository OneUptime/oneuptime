import moment from "moment-timezone";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyScheduleLayerService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import EscalationRuleReach, {
  PolicyReachOfPerson,
} from "../../../Server/Utils/OnCall/EscalationRuleReach";
import OnCallHandoffPosts from "../../../Server/Utils/OnCall/OnCallHandoffPosts";
import ScheduleLayerChanges from "../../../Server/Utils/OnCall/ScheduleLayerChanges";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import WorkspaceUserGroupSync from "../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import Entities from "../../../Models/DatabaseModels/Index";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import URL from "../../../Types/API/URL";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Timezone from "../../../Types/Timezone";
import { DataSource } from "typeorm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A SCHEDULE OF NIGHTS, STORED AS THE CUSTOMER'S API CLIENT STORED IT, ON A
 * MIGRATED POSTGRES (#11269, #11268, #11270).
 *
 * The layer is a row written before #11269 by a client that spelled the key
 * restrictionType: on call 17:00 to 07:00 in Europe/Warsaw, weekly turns of
 * Alice and Bob. Read through the real snapshot of the schedule's layers
 * (ScheduleLayersSnapshot, and the column's own transformer), resolved by the
 * real engine and roster, and the roster written to the schedule's real row:
 *
 *   - the layer pages its people: the type under restrictionType is read;
 *   - the stored roster says Thursday's shift ends at 07:00 Friday, from
 *     17:00 Thursday, and keeps the turn (rosterTurnKey) through the day;
 *   - a week of refreshes tells each person once each way, per policy;
 *   - a layer written through the layer service with either spelling is
 *     stored with restrictionType alone, and an update whose two spellings
 *     disagree is decided against the type the row holds.
 *
 * The tables are copies of the migrated ones in a schema of the test's own
 * (search_path holds only it), dropped afterwards. The escalation rules,
 * memberships and the sends are stood in for: what they decide has suites
 * of their own.
 *
 * Opt in with RUN_POSTGRES_ON_CALL_ROSTER_TESTS=true, against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_ON_CALL_ROSTER_TESTS=true \
 *   ON_CALL_ROSTER_TEST_DATABASE_HOST=127.0.0.1 \
 *   ON_CALL_ROSTER_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/OnCallRosterActiveHoursPostgres.test.ts
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_ON_CALL_ROSTER_TESTS"] === "true"
    ? describe
    : describe.skip;

const WARSAW: string = "Europe/Warsaw";
const DASHES: RegExp = /-/g;

const TABLES: Array<string> = [
  "User",
  "OnCallDutyPolicySchedule",
  "OnCallDutyPolicyScheduleLayer",
  "OnCallDutyPolicyScheduleLayerUser",
  "OnCallDutyPolicyUserOverride",
];

const PROJECT_ID: string = "11270000-0000-4000-8000-000000000001";
const SCHEDULE_ID: string = "11270000-0000-4000-8000-000000000002";
const LAYER_ID: string = "11270000-0000-4000-8000-000000000003";
const ALICE: string = "11270000-0000-4000-8000-0000000000a1";
const BOB: string = "11270000-0000-4000-8000-0000000000b1";
const TEAM_POLICY: string = "11270000-0000-4000-8000-000000000004";
const MAJOR_POLICY: string = "11270000-0000-4000-8000-000000000005";

const NAMES: Record<string, string> = { [ALICE]: "alice", [BOB]: "bob" };

// An instant that is `wallClock` ("YYYY-MM-DD HH:mm") in Warsaw.
function inWarsaw(wallClock: string): Date {
  return moment.tz(wallClock, WARSAW).toDate();
}

function wallClock(date: Date | null | undefined): string | null {
  return date ? moment.tz(date, WARSAW).format("ddd, MMM D, HH:mm") : null;
}

function dateTime(date: Date): JSONObject {
  return { _type: ObjectType.DateTime, value: date.toISOString() };
}

// The layer's restriction, as the customer's client sent it: restrictionType.
const STORED_BEFORE_THE_FIX: JSONObject = {
  _type: ObjectType.RestrictionTimes,
  value: {
    restrictionType: "Daily",
    dayRestrictionTimes: {
      startTime: dateTime(inWarsaw("2026-01-05 17:00")),
      endTime: dateTime(inWarsaw("2026-01-05 07:00")),
    },
    weeklyRestrictionTimes: [],
  },
};

const WEEKLY: JSONObject = {
  _type: ObjectType.Recurring,
  value: {
    intervalType: "Week",
    intervalCount: { _type: ObjectType.PositiveNumber, value: 1 },
  },
};

function attachment(
  policyId: string,
  policyName: string,
): OnCallDutyPolicyEscalationRuleSchedule {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.id = new ObjectID(policyId);
  policy.name = policyName;

  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule.id = ObjectID.generate();
  rule.name = "Nights first";
  rule.order = 1;

  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.id = new ObjectID(SCHEDULE_ID);
  schedule.name = "Nights";
  schedule.timezone = Timezone.EuropeWarsaw;

  const row: OnCallDutyPolicyEscalationRuleSchedule =
    new OnCallDutyPolicyEscalationRuleSchedule();
  row.id = ObjectID.generate();
  row.projectId = new ObjectID(PROJECT_ID);
  row.pageNextInRotation = false;
  row.onCallDutyPolicy = policy;
  row.onCallDutyPolicyEscalationRule = rule;
  row.onCallDutyPolicySchedule = schedule;
  return row;
}

describePostgres("a schedule of nights on a migrated Postgres", () => {
  const schema: string = `on_call_roster_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;

  let database: DataSource;

  let sent: Array<{ who: string; eventType: string; at: string | null }>;
  let timeLogStarts: number;
  let timeLogEnds: number;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["ON_CALL_ROSTER_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["ON_CALL_ROSTER_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["ON_CALL_ROSTER_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
  }, 120000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    sent = [];
    timeLogStarts = 0;
    timeLogEnds = 0;

    for (const table of [...TABLES].reverse()) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    for (const [id, name] of [
      [ALICE, "alice"],
      [BOB, "bob"],
    ] as Array<[string, string]>) {
      await database.query(
        `INSERT INTO "${schema}"."User" ("_id", "email", "slug", "name", "version") VALUES ($1, $2, $3, $4, 1)`,
        [id, `${name}@example.com`, name, name],
      );
    }

    await database.query(
      `INSERT INTO "${schema}"."OnCallDutyPolicySchedule" ("_id", "projectId", "name", "slug", "timezone", "version") VALUES ($1, $2, 'Nights', 'nights', $3, 1)`,
      [SCHEDULE_ID, PROJECT_ID, WARSAW],
    );

    await database.query(
      `INSERT INTO "${schema}"."OnCallDutyPolicyScheduleLayer" ("_id", "projectId", "onCallDutyPolicyScheduleId", "name", "order", "startsAt", "handOffTime", "rotation", "restrictionTimes", "version") VALUES ($1, $2, $3, 'Primary rotation', 1, $4, $5, $6::jsonb, $7::jsonb, 1)`,
      [
        LAYER_ID,
        PROJECT_ID,
        SCHEDULE_ID,
        new Date("2026-11-23T08:00:00.000Z"),
        new Date("2026-11-30T08:00:00.000Z"),
        JSON.stringify(WEEKLY),
        JSON.stringify(STORED_BEFORE_THE_FIX),
      ],
    );

    for (const [userId, order] of [
      [ALICE, 1],
      [BOB, 2],
    ] as Array<[string, number]>) {
      await database.query(
        `INSERT INTO "${schema}"."OnCallDutyPolicyScheduleLayerUser" ("_id", "projectId", "onCallDutyPolicyScheduleId", "onCallDutyPolicyScheduleLayerId", "order", "userId", "version") VALUES ($1, $2, $3, $4, $5, $6, 1)`,
        [
          ObjectID.generate().toString(),
          PROJECT_ID,
          SCHEDULE_ID,
          LAYER_ID,
          order,
          userId,
        ],
      );
    }

    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest
      .spyOn(PostgresAppInstance, "getDataSource")
      .mockReturnValue(database as never);

    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "setImmediate",
        "setTimeout",
        "setInterval",
        "clearTimeout",
        "clearInterval",
        "queueMicrotask",
      ],
    });

    jest.spyOn(Semaphore, "lock").mockRejectedValue(new Error("no Redis here"));
    jest
      .spyOn(WorkspaceUserGroupSync, "requestSyncForSchedules")
      .mockResolvedValue(undefined as never);
    for (const method of [
      "recordCreate",
      "recordUpdate",
      "recordDelete",
    ] as const) {
      jest.spyOn(AuditLogService, method).mockResolvedValue(undefined as never);
    }
    jest
      .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockResolvedValue([
        attachment(TEAM_POLICY, "Team"),
        attachment(MAJOR_POLICY, "Major incident"),
      ] as never);
    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation((async (data: { userIds: Array<ObjectID> }) => {
        return new Set<string>(
          data.userIds.map((userId: ObjectID): string => {
            return userId.toString().toLowerCase();
          }),
        );
      }) as never);
    jest
      .spyOn(EscalationRuleReach, "readPolicyPathsOfPerson")
      .mockResolvedValue(new Map() as PolicyReachOfPerson);
    jest
      .spyOn(UserService, "getTimezoneForUser")
      .mockResolvedValue(Timezone.EuropeWarsaw);
    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/policy"));
    jest
      .spyOn(UserNotificationSettingService, "sendUserNotification")
      .mockImplementation((async (data: {
        userId: ObjectID;
        eventType: NotificationSettingEventType;
      }) => {
        sent.push({
          who: NAMES[data.userId.toString()] || "?",
          eventType: data.eventType,
          at: wallClock(new Date()),
        });
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
      .mockImplementation((async () => {
        timeLogStarts++;
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
      .mockImplementation((async () => {
        timeLogEnds++;
      }) as never);
    jest
      .spyOn(OnCallHandoffPosts, "post")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // The schedule's roster, as stored.
  async function storedRoster(): Promise<JSONObject> {
    const rows: Array<JSONObject> = await database.query(
      `SELECT "currentUserIdOnRoster", "rosterStartAt", "rosterHandoffAt", "nextUserIdOnRoster", "rosterNextStartAt", "rosterNextHandoffAt", "rosterTurnKey" FROM "${schema}"."OnCallDutyPolicySchedule" WHERE "_id" = $1`,
      [SCHEDULE_ID],
    );
    return rows[0]!;
  }

  async function refreshAt(now: Date): Promise<void> {
    jest.setSystemTime(now);
    await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
      new ObjectID(SCHEDULE_ID),
    );
  }

  test("REGRESSION #11269 and #11268: the stored layer pages Alice, until 07:00 Friday", async () => {
    await refreshAt(inWarsaw("2026-11-26 17:00"));

    const roster: JSONObject = await storedRoster();

    expect(String(roster["currentUserIdOnRoster"])).toBe(ALICE);
    expect(wallClock(roster["rosterStartAt"] as Date)).toBe(
      "Thu, Nov 26, 17:00",
    );
    expect(wallClock(roster["rosterHandoffAt"] as Date)).toBe(
      "Fri, Nov 27, 07:00",
    );
    expect(String(roster["nextUserIdOnRoster"])).toBe(ALICE);
    expect(wallClock(roster["rosterNextStartAt"] as Date)).toBe(
      "Fri, Nov 27, 17:00",
    );
    expect(String(roster["rosterTurnKey"])).toContain(ALICE);
  });

  test("REGRESSION #11270: a week of refreshes tells each person once each way, per policy", async () => {
    let now: Date = inWarsaw("2026-11-23 12:00");
    const until: Date = inWarsaw("2026-12-07 12:00");

    for (let guard: number = 0; guard < 200; guard++) {
      await refreshAt(now);

      const roster: JSONObject = await storedRoster();
      const due: Date | undefined = (roster["rosterHandoffAt"] ||
        roster["rosterNextStartAt"]) as Date | undefined;

      if (!due || due.getTime() > until.getTime()) {
        break;
      }

      now = new Date(Math.ceil(due.getTime() / 60000) * 60000);
    }

    const told: (eventType: NotificationSettingEventType) => Array<string> = (
      eventType: NotificationSettingEventType,
    ): Array<string> => {
      return sent
        .filter((one: { eventType: string }): boolean => {
          return one.eventType === eventType;
        })
        .map((one: { who: string; at: string | null }): string => {
          return `${one.who} ${one.at}`;
        });
    };

    expect(
      told(NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER),
    ).toEqual([
      "alice Mon, Nov 23, 17:00",
      "alice Mon, Nov 23, 17:00",
      "bob Mon, Nov 30, 17:00",
      "bob Mon, Nov 30, 17:00",
    ]);
    expect(
      told(
        NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER,
      ),
    ).toEqual([
      "alice Mon, Nov 30, 07:00",
      "alice Mon, Nov 30, 07:00",
      "bob Mon, Dec 7, 07:00",
      "bob Mon, Dec 7, 07:00",
    ]);

    // Fourteen nights, logged for both policies.
    expect(timeLogStarts).toBe(28);
    expect(timeLogEnds).toBe(28);
  });

  test("a write through the layer service, in either spelling, is stored under restrictionType alone", async () => {
    jest
      .spyOn(ScheduleLayerChanges, "afterLayersWritten")
      .mockResolvedValue(undefined as never);

    for (const key of ["restrictionType", "restictionType"]) {
      const layer: OnCallDutyPolicyScheduleLayer =
        new OnCallDutyPolicyScheduleLayer();
      layer.projectId = new ObjectID(PROJECT_ID);
      layer.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE_ID);
      layer.name = `Written with ${key}`;
      layer.startsAt = new Date("2026-11-23T08:00:00.000Z");
      layer.handOffTime = new Date("2026-11-30T08:00:00.000Z");
      (layer as unknown as Record<string, unknown>)["rotation"] = WEEKLY;
      (layer as unknown as Record<string, unknown>)["restrictionTimes"] = {
        _type: ObjectType.RestrictionTimes,
        value: {
          [key]: "Weekly",
          weeklyRestrictionTimes: [
            {
              startDay: "Monday",
              endDay: "Monday",
              startTime: dateTime(inWarsaw("2026-01-05 09:00")),
              endTime: dateTime(inWarsaw("2026-01-05 17:00")),
            },
          ],
        },
      };

      const created: OnCallDutyPolicyScheduleLayer =
        await OnCallDutyPolicyScheduleLayerService.create({
          data: layer,
          props: { isRoot: true },
        });

      const rows: Array<JSONObject> = await database.query(
        `SELECT "restrictionTimes"#>>'{value,restrictionType}' AS "named", ("restrictionTimes"->'value') ? 'restictionType' AS "spelledBefore" FROM "${schema}"."OnCallDutyPolicyScheduleLayer" WHERE "_id" = $1`,
        [created.id!.toString()],
      );

      expect(rows[0]).toEqual({ named: "Weekly", spelledBefore: false });
    }
  });

  test("an update whose two spellings disagree is decided against the type the row holds", async () => {
    jest
      .spyOn(ScheduleLayerChanges, "afterLayersWritten")
      .mockResolvedValue(undefined as never);

    // A client that read the layer (Daily under both) and changed restictionType.
    await OnCallDutyPolicyScheduleLayerService.updateOneById({
      id: new ObjectID(LAYER_ID),
      data: {
        restrictionTimes: {
          _type: ObjectType.RestrictionTimes,
          value: { restrictionType: "Daily", restictionType: "None" },
        } as unknown as RestrictionTimes,
      },
      props: { isRoot: true },
    });

    const rows: Array<JSONObject> = await database.query(
      `SELECT "restrictionTimes" FROM "${schema}"."OnCallDutyPolicyScheduleLayer" WHERE "_id" = $1`,
      [LAYER_ID],
    );

    expect(
      RestrictionTimes.fromJSON(rows[0]!["restrictionTimes"] as JSONObject)
        .restrictionType,
    ).toBe(RestrictionType.None);
    expect(
      ((rows[0]!["restrictionTimes"] as JSONObject)["value"] as JSONObject)[
        "restrictionType"
      ],
    ).toBe(RestrictionType.None);
  });
});
