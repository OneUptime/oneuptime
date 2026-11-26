import EndOnCallTimeLogsOfDeletedPolicies, {
  DeletedPolicy,
  PAGE_SIZE,
  PolicyDeletionReader,
  getPolicyKey,
} from "../../../FeatureSet/Workers/DataMigrations/EndOnCallTimeLogsOfDeletedPolicies";
import Entities from "Common/Models/DatabaseModels/Index";
import OnCallDutyPolicyTimeLog from "Common/Models/DatabaseModels/OnCallDutyPolicyTimeLog";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import OnCallDutyPolicyTimeLogService from "Common/Server/Services/OnCallDutyPolicyTimeLogService";
import logger from "Common/Server/Utils/Logger";
import GreaterThanOrNull from "Common/Types/BaseDatabase/GreaterThanOrNull";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import {
  OnCallStint,
  getMinutesOnCallInRange,
} from "Common/Types/OnCallDutyPolicy/OnCallTimeInRange";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { DataSource } from "Common/node_modules/typeorm";
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
 * THE TIME LOGS DELETED ON-CALL POLICIES LEFT OPEN, ENDED ON A MIGRATED
 * POSTGRES (#11023).
 *
 * Until #10983, deleting an on-call policy ended none of its people's time
 * logs, and User On-Call Time counted them on call around the clock from
 * then on. EndOnCallTimeLogsOfDeletedPolicies ends them once. Run against
 * the real statements, on copies of the migrated tables:
 *
 *   - which logs: open, not deleted, of a policy no row has - never one of
 *     a policy that exists (a soft-deleted row still counts as there), one
 *     already ended, or one naming no policy;
 *   - where each ends: when the audit log says its policy was deleted; else
 *     the last time an on-call stint started on the policy (not when one
 *     of its logs ended: a team's or a schedule's deletion ends those after
 *     the policy is gone); else its own start - each checked against what
 *     the seeded world says, and never past the deletion;
 *   - more logs than a page, paged on the id;
 *   - a second run changes nothing, not even a row's version or updatedAt,
 *     and two runs at once come to the same as one;
 *   - the report: what User On-Call Time reads with its own query, through
 *     OnCallDutyPolicyTimeLogService, and adds up with
 *     getMinutesOnCallInRange, before and after - the person on call
 *     through a deleted policy no longer counted on call after it went,
 *     and their time before it kept as far as the data can place it.
 *
 * The audit log (ClickHouse) is stood in for here: its read runs against a
 * real ClickHouse in EndOnCallTimeLogsOfDeletedPoliciesClickhouse.
 *
 * Opt in with RUN_POSTGRES_ORPHANED_ON_CALL_TIME_LOGS_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database, right after its drift check. The OnCallDutyPolicy
 * and OnCallDutyPolicyTimeLog tables' STRUCTURE is cloned into a unique
 * schema (search_path holds only that schema), dropped afterwards; every
 * row is synthetic. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from ORPHANED_ON_CALL_TIME_LOGS_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from ORPHANED_ON_CALL_TIME_LOGS_TEST_DATABASE_HOST
 * / _PORT (default localhost:5400).
 */
// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_ORPHANED_ON_CALL_TIME_LOGS_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;

// Day 0 of every world below: 1 March 2026, midnight UTC.
const T0: number = Date.UTC(2026, 2, 1);

function day(days: number): Date {
  return new Date(T0 + days * DAY);
}

// A stretch drawn in whole minutes: a draw takes at most 2^32 values.
function drawTime(random: SeededRandom, milliseconds: number): number {
  return random(Math.max(1, Math.floor(milliseconds / MINUTE))) * MINUTE;
}

const PROJECT: string = "11023000-0000-4000-8000-0000000000a1";
const OTHER_PROJECT: string = "11023000-0000-4000-8000-0000000000a2";

// The people of the report's world.
const ANN: string = "11023000-0000-4000-8000-00000000a001";
const BEN: string = "11023000-0000-4000-8000-00000000a002";
const CY: string = "11023000-0000-4000-8000-00000000a003";
const DEE: string = "11023000-0000-4000-8000-00000000a004";
const EVE: string = "11023000-0000-4000-8000-00000000a005";

interface LogSeed {
  id: string;
  projectId?: string;
  policyId: string | null;
  userId?: string;
  startsAt: Date;
  endsAt?: Date | null;
  // When the row was written: its start, unless said.
  createdAt?: Date;
  deletedAt?: Date | null;
}

interface StoredLog {
  _id: string;
  projectId: string;
  onCallDutyPolicyId: string | null;
  userId: string;
  startsAt: Date;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

// An audit log that knows the deletions it is handed.
function auditLogOf(
  deletions: Map<string, Array<Date>>,
  asked?: Array<Array<DeletedPolicy>>,
): PolicyDeletionReader {
  return {
    hasAuditLog: async (): Promise<boolean> => {
      return true;
    },
    readDeletions: async (
      policies: ReadonlyArray<DeletedPolicy>,
    ): Promise<Map<string, Array<Date>>> => {
      asked?.push([...policies]);

      const known: Map<string, Array<Date>> = new Map<string, Array<Date>>();

      for (const policy of policies) {
        const times: Array<Date> | undefined = deletions.get(
          getPolicyKey(policy),
        );

        if (times) {
          known.set(getPolicyKey(policy), times);
        }
      }

      return known;
    },
  };
}

describePostgres(
  "the time logs deleted on-call policies left open (Postgres)",
  () => {
    const schema: string = `orphaned_time_logs_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["ORPHANED_ON_CALL_TIME_LOGS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["ORPHANED_ON_CALL_TIME_LOGS_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["ORPHANED_ON_CALL_TIME_LOGS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of ["OnCallDutyPolicy", "OnCallDutyPolicyTimeLog"]) {
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
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);

      for (const table of ["OnCallDutyPolicyTimeLog", "OnCallDutyPolicy"]) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // A policy that exists: a row of "OnCallDutyPolicy", soft deleted or not.
    async function insertPolicy(data: {
      id: string;
      projectId?: string;
      deletedAt?: Date;
    }): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."OnCallDutyPolicy" ("_id", "version", "projectId", "name", "slug", "deletedAt") VALUES ($1, 1, $2, $3, $4, $5)`,
        [
          data.id,
          data.projectId || PROJECT,
          `Policy ${data.id}`,
          `policy-${data.id}`,
          data.deletedAt || null,
        ],
      );
    }

    // Logs as OneUptime wrote them, many in one statement.
    async function insertLogs(seeds: Array<LogSeed>): Promise<void> {
      for (let index: number = 0; index < seeds.length; index += 500) {
        const page: Array<LogSeed> = seeds.slice(index, index + 500);

        await database.query(
          `INSERT INTO "${schema}"."OnCallDutyPolicyTimeLog" ("_id", "version", "projectId", "onCallDutyPolicyId", "userId", "startsAt", "endsAt", "createdAt", "updatedAt", "deletedAt") SELECT "row"."id", 1, "row"."projectId", "row"."policyId", "row"."userId", "row"."startsAt", "row"."endsAt", "row"."createdAt", "row"."createdAt", "row"."deletedAt" FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::timestamptz[], $6::timestamptz[], $7::timestamptz[], $8::timestamptz[]) AS "row"("id", "projectId", "policyId", "userId", "startsAt", "endsAt", "createdAt", "deletedAt")`,
          [
            page.map((seed: LogSeed): string => {
              return seed.id;
            }),
            page.map((seed: LogSeed): string => {
              return seed.projectId || PROJECT;
            }),
            page.map((seed: LogSeed): string | null => {
              return seed.policyId;
            }),
            page.map((seed: LogSeed): string => {
              return seed.userId || ANN;
            }),
            page.map((seed: LogSeed): string => {
              return seed.startsAt.toISOString();
            }),
            page.map((seed: LogSeed): string | null => {
              return seed.endsAt ? seed.endsAt.toISOString() : null;
            }),
            page.map((seed: LogSeed): string => {
              return (seed.createdAt || seed.startsAt).toISOString();
            }),
            page.map((seed: LogSeed): string | null => {
              return seed.deletedAt ? seed.deletedAt.toISOString() : null;
            }),
          ],
        );
      }
    }

    // Every log as Postgres holds it, by id.
    async function storedLogs(): Promise<Map<string, StoredLog>> {
      const rows: Array<StoredLog> = (await database.query(
        `SELECT "_id", "projectId", "onCallDutyPolicyId", "userId", "startsAt", "endsAt", "createdAt", "updatedAt", "deletedAt", "version" FROM "${schema}"."OnCallDutyPolicyTimeLog" ORDER BY "_id"`,
      )) as Array<StoredLog>;

      return new Map<string, StoredLog>(
        rows.map((row: StoredLog): [string, StoredLog] => {
          return [row._id, row];
        }),
      );
    }

    /*
     * What User On-Call Time shows for the range: the stints its own query
     * reads, through the service the API serves it from, added up per
     * person by getMinutesOnCallInRange.
     */
    async function report(data: {
      from: Date;
      to: Date;
      now: Date;
    }): Promise<Record<string, number>> {
      const logs: Array<OnCallDutyPolicyTimeLog> =
        await OnCallDutyPolicyTimeLogService.findBy({
          query: {
            projectId: new ObjectID(PROJECT),
            startsAt: new LessThan<Date>(data.to),
            endsAt: new GreaterThanOrNull<Date>(data.from),
          },
          select: { userId: true, startsAt: true, endsAt: true },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        });

      const stints: Map<string, Array<OnCallStint>> = new Map<
        string,
        Array<OnCallStint>
      >();

      for (const log of logs) {
        const userId: string = log.userId!.toString();
        const known: Array<OnCallStint> = stints.get(userId) || [];

        known.push({ startsAt: log.startsAt!, endsAt: log.endsAt || null });
        stints.set(userId, known);
      }

      const totals: Record<string, number> = {};

      for (const [userId, userStints] of stints) {
        totals[userId] = getMinutesOnCallInRange({
          stints: userStints,
          range: { startsAt: data.from, endsAt: data.to },
          now: data.now,
        });
      }

      return totals;
    }

    function days(count: number): number {
      return count * 24 * 60;
    }

    test("the report: a person on call through a deleted policy is no longer counted on call after it went, and their time before it is kept as far as the data can place it", async () => {
      const P: string = "11023000-0000-4000-8000-0000000000b1";
      const Q: string = "11023000-0000-4000-8000-0000000000b2";
      const R: string = "11023000-0000-4000-8000-0000000000b3";

      // Q is in force; P (deleted on day 40, in the audit log) and R (deleted on day 45, not) are gone.
      await insertPolicy({ id: Q });

      await insertLogs([
        // P: Ann by name since day 0; Eve by name on days 0 to 3, taken off while P was in force.
        {
          id: "11023000-0000-4000-8000-000000001001",
          policyId: P,
          userId: ANN,
          startsAt: day(0),
        },
        {
          id: "11023000-0000-4000-8000-000000001002",
          policyId: P,
          userId: EVE,
          startsAt: day(0),
          endsAt: day(3),
        },
        // Q: Ann's turns of its schedule, days 10 to 17 and 31 to 38, and since day 52.
        {
          id: "11023000-0000-4000-8000-000000001003",
          policyId: Q,
          userId: ANN,
          startsAt: day(10),
          endsAt: day(17),
        },
        {
          id: "11023000-0000-4000-8000-000000001004",
          policyId: Q,
          userId: ANN,
          startsAt: day(31),
          endsAt: day(38),
        },
        {
          id: "11023000-0000-4000-8000-000000001005",
          policyId: Q,
          userId: ANN,
          startsAt: day(52),
        },
        // R: Ben by name since day 5; its schedule's turns, Cy's on days 12 to 19 and Dee's since.
        {
          id: "11023000-0000-4000-8000-000000001006",
          policyId: R,
          userId: BEN,
          startsAt: day(5),
        },
        {
          id: "11023000-0000-4000-8000-000000001007",
          policyId: R,
          userId: CY,
          startsAt: day(12),
          endsAt: day(19),
        },
        {
          id: "11023000-0000-4000-8000-000000001008",
          policyId: R,
          userId: DEE,
          startsAt: day(19),
        },
        // R: Eve through a team from day 8, ended when the team was deleted on day 50, after R was gone.
        {
          id: "11023000-0000-4000-8000-000000001009",
          policyId: R,
          userId: EVE,
          startsAt: day(8),
          endsAt: day(50),
        },
      ]);

      const now: Date = day(60);

      // Before: Ann, Ben and Dee are on call around the clock to this day.
      expect(await report({ from: day(50), to: now, now })).toEqual({
        [ANN]: days(10),
        [BEN]: days(10),
        [DEE]: days(10),
      });
      expect(await report({ from: day(30), to: now, now })).toEqual({
        [ANN]: days(30),
        [BEN]: days(30),
        [DEE]: days(30),
        [EVE]: days(20),
      });
      expect(await report({ from: day(0), to: day(30), now })).toEqual({
        [ANN]: days(30),
        [BEN]: days(25),
        [CY]: days(7),
        [DEE]: days(11),
        [EVE]: days(3) + days(22),
      });

      await new EndOnCallTimeLogsOfDeletedPolicies({
        deletionReader: auditLogOf(
          new Map<string, Array<Date>>([
            [getPolicyKey({ projectId: PROJECT, policyId: P }), [day(40)]],
          ]),
        ),
      }).migrate();

      const stored: Map<string, StoredLog> = await storedLogs();

      // P: its deletion, from the audit log.
      expect(
        stored.get("11023000-0000-4000-8000-000000001001")!.endsAt,
      ).toEqual(day(40));
      /*
       * R: the last stint that started on it, Dee's on day 19 - not the
       * team's log ended on day 50, after R was gone. Dee's own stint ends
       * at its start: nothing says how long it ran.
       */
      expect(
        stored.get("11023000-0000-4000-8000-000000001006")!.endsAt,
      ).toEqual(day(19));
      expect(
        stored.get("11023000-0000-4000-8000-000000001008")!.endsAt,
      ).toEqual(day(19));
      // Q's open turn is Q's: still going on.
      expect(
        stored.get("11023000-0000-4000-8000-000000001005")!.endsAt,
      ).toBeNull();

      // After: Ann's last ten days are Q's turn since day 52; nobody else was on call.
      expect(await report({ from: day(50), to: now, now })).toEqual({
        [ANN]: days(8),
      });

      /*
       * The month before: Ann through P until day 40, with Q's turn inside
       * it counted once, and Q's turn since day 52; Ben's and Dee's time
       * through R is before the month; Eve's team log, ended by OneUptime
       * on day 50, is as it was.
       */
      expect(await report({ from: day(30), to: now, now })).toEqual({
        [ANN]: days(10) + days(8),
        [EVE]: days(20),
      });

      /*
       * The month P and R were in force: Ann's, Cy's and Eve's as before.
       * Ben's time through R up to the last stint that started on it, on
       * day 19: R's deletion, on day 45, is nowhere in the data, so the
       * days between are not counted - never more than he was on call. Dee's
       * turn from day 19 nothing can place: none of it.
       */
      expect(await report({ from: day(0), to: day(30), now })).toEqual({
        [ANN]: days(30),
        [BEN]: days(14),
        [CY]: days(7),
        [DEE]: 0,
        [EVE]: days(3) + days(22),
      });
    });

    test("never a log of a policy that exists - soft deleted too - one already ended, one deleted, or one naming no policy", async () => {
      const IN_FORCE: string = "11023000-0000-4000-8000-0000000000c1";
      const SOFT_DELETED: string = "11023000-0000-4000-8000-0000000000c2";
      const GONE: string = "11023000-0000-4000-8000-0000000000c3";

      await insertPolicy({ id: IN_FORCE });
      await insertPolicy({ id: SOFT_DELETED, deletedAt: day(20) });

      await insertLogs([
        {
          id: "11023000-0000-4000-8000-000000002001",
          policyId: IN_FORCE,
          startsAt: day(1),
        },
        {
          id: "11023000-0000-4000-8000-000000002002",
          policyId: SOFT_DELETED,
          startsAt: day(2),
        },
        {
          id: "11023000-0000-4000-8000-000000002003",
          policyId: GONE,
          startsAt: day(3),
          endsAt: day(4),
        },
        {
          id: "11023000-0000-4000-8000-000000002004",
          policyId: GONE,
          startsAt: day(5),
          deletedAt: day(6),
        },
        {
          id: "11023000-0000-4000-8000-000000002005",
          policyId: null,
          startsAt: day(7),
        },
        // The one to end, in another project.
        {
          id: "11023000-0000-4000-8000-000000002006",
          policyId: GONE,
          projectId: OTHER_PROJECT,
          startsAt: day(8),
        },
      ]);

      const before: Map<string, StoredLog> = await storedLogs();

      await new EndOnCallTimeLogsOfDeletedPolicies({
        deletionReader: auditLogOf(new Map()),
      }).migrate();

      const after: Map<string, StoredLog> = await storedLogs();

      for (const id of [
        "11023000-0000-4000-8000-000000002001",
        "11023000-0000-4000-8000-000000002002",
        "11023000-0000-4000-8000-000000002003",
        "11023000-0000-4000-8000-000000002004",
        "11023000-0000-4000-8000-000000002005",
      ]) {
        expect(after.get(id)).toEqual(before.get(id));
      }

      // Its last stint started on day 8 in its own project: its own start.
      const ended: StoredLog = after.get(
        "11023000-0000-4000-8000-000000002006",
      )!;
      const was: StoredLog = before.get(
        "11023000-0000-4000-8000-000000002006",
      )!;

      expect(ended.endsAt).toEqual(day(8));
      expect(ended.version).toBe(was.version + 1);
      expect(ended.updatedAt.getTime()).toBeGreaterThanOrEqual(
        was.updatedAt.getTime(),
      );
    });

    test("the last stint started is read as never later than its log was written", async () => {
      const GONE: string = "11023000-0000-4000-8000-0000000000d1";
      const ALSO_GONE: string = "11023000-0000-4000-8000-0000000000d2";

      await insertLogs([
        {
          id: "11023000-0000-4000-8000-000000003001",
          policyId: GONE,
          startsAt: day(1),
        },
        // Written on day 6 with a start on day 9, as an API call could: day 6 counts.
        {
          id: "11023000-0000-4000-8000-000000003002",
          policyId: GONE,
          startsAt: day(9),
          endsAt: day(10),
          createdAt: day(6),
        },
        {
          id: "11023000-0000-4000-8000-000000003003",
          policyId: GONE,
          startsAt: day(4),
          createdAt: new Date(day(4).getTime() + 2000),
        },
        // The newest, written a second before its start by a clock running behind.
        {
          id: "11023000-0000-4000-8000-000000003101",
          policyId: ALSO_GONE,
          startsAt: day(2),
        },
        {
          id: "11023000-0000-4000-8000-000000003102",
          policyId: ALSO_GONE,
          startsAt: day(7),
          createdAt: new Date(day(7).getTime() - 1000),
        },
      ]);

      await new EndOnCallTimeLogsOfDeletedPolicies({
        deletionReader: auditLogOf(new Map()),
      }).migrate();

      const after: Map<string, StoredLog> = await storedLogs();

      // Day 6, not the day 9 the start says.
      expect(after.get("11023000-0000-4000-8000-000000003001")!.endsAt).toEqual(
        day(6),
      );
      expect(after.get("11023000-0000-4000-8000-000000003003")!.endsAt).toEqual(
        day(6),
      );
      // The second before day 7 for the older; the newest ends at its own start.
      expect(after.get("11023000-0000-4000-8000-000000003101")!.endsAt).toEqual(
        new Date(day(7).getTime() - 1000),
      );
      expect(after.get("11023000-0000-4000-8000-000000003102")!.endsAt).toEqual(
        day(7),
      );
    });

    test("more logs than a page: every one is ended, page by page", async () => {
      const GONE: string = "11023000-0000-4000-8000-0000000000e1";
      const count: number = PAGE_SIZE * 2 + 3;
      const seeds: Array<LogSeed> = [];

      for (let index: number = 0; index < count; index++) {
        seeds.push({
          id: ObjectID.generate().toString(),
          policyId: GONE,
          startsAt: new Date(T0 + index * MINUTE),
        });
      }

      await insertLogs(seeds);

      await new EndOnCallTimeLogsOfDeletedPolicies({
        deletionReader: auditLogOf(new Map()),
      }).migrate();

      const after: Map<string, StoredLog> = await storedLogs();

      expect(after.size).toBe(count);

      for (const log of after.values()) {
        expect(log.endsAt).toEqual(new Date(T0 + (count - 1) * MINUTE));
      }
    });

    /*
     * A world of policies, some deleted - each at its own time, some with
     * the deletion in the audit log - and their logs, drawn from the shared
     * seeded generator: logs started while their policy was in force, some
     * ended by OneUptime while it was, some ended after it was gone (by a
     * team's or a schedule's deletion), some deleted, some naming no policy.
     */
    interface World {
      seeds: Array<LogSeed>;
      // When each deleted policy was deleted, by its key.
      deletedAt: Map<string, number>;
      // The deletions the audit log has.
      deletions: Map<string, Array<Date>>;
    }

    async function seedWorld(seed: number): Promise<World> {
      const random: SeededRandom = seededRandom(seed);
      const world: World = {
        seeds: [],
        deletedAt: new Map<string, number>(),
        deletions: new Map<string, Array<Date>>(),
      };

      for (let index: number = 0; index < 12; index++) {
        const policyId: string = ObjectID.generate().toString();
        const projectId: string = random(4) === 0 ? OTHER_PROJECT : PROJECT;
        const key: string = getPolicyKey({ projectId, policyId });
        let end: number = T0 + 400 * DAY;

        if (random(3) === 0) {
          await insertPolicy({
            id: policyId,
            projectId,
            ...(random(4) === 0 ? { deletedAt: day(300) } : {}),
          });
        } else {
          end = T0 + (20 + random(300)) * DAY + drawTime(random, DAY);
          world.deletedAt.set(key, end);

          if (random(2) === 0) {
            world.deletions.set(key, [new Date(end)]);
          }
        }

        for (let log: number = 0; log < random(9); log++) {
          const startsAt: number = T0 + drawTime(random, end - T0);
          const kind: number = random(6);

          world.seeds.push({
            id: ObjectID.generate().toString(),
            projectId,
            policyId,
            startsAt: new Date(startsAt),
            // Written a few seconds after its start, or before it.
            createdAt: new Date(startsAt + (random(20) - 5) * 1000),
            endsAt:
              kind === 0
                ? new Date(startsAt + drawTime(random, end - startsAt + MINUTE))
                : kind === 1
                  ? new Date(end + drawTime(random, 30 * DAY))
                  : null,
            deletedAt:
              kind === 2 && random(2) === 0 ? new Date(startsAt) : null,
          });
        }
      }

      for (let log: number = 0; log < 3; log++) {
        world.seeds.push({
          id: ObjectID.generate().toString(),
          policyId: null,
          startsAt: day(random(100)),
        });
      }

      await insertLogs(world.seeds);

      return world;
    }

    // Where the world says each log ends: by the rules, from the seeds alone.
    function expectedEnds(world: World): Map<string, Date> {
      const lastStarted: Map<string, number> = new Map<string, number>();

      for (const seed of world.seeds) {
        if (!seed.policyId) {
          continue;
        }

        const key: string = getPolicyKey({
          projectId: seed.projectId || PROJECT,
          policyId: seed.policyId,
        });
        const started: number = Math.min(
          seed.startsAt.getTime(),
          (seed.createdAt || seed.startsAt).getTime(),
        );

        lastStarted.set(key, Math.max(lastStarted.get(key) ?? 0, started));
      }

      const ends: Map<string, Date> = new Map<string, Date>();

      for (const seed of world.seeds) {
        if (!seed.policyId || seed.endsAt || seed.deletedAt) {
          continue;
        }

        const key: string = getPolicyKey({
          projectId: seed.projectId || PROJECT,
          policyId: seed.policyId,
        });

        if (!world.deletedAt.has(key)) {
          continue;
        }

        const start: number = seed.startsAt.getTime();
        const deletion: Array<Date> | undefined = world.deletions.get(key);

        ends.set(
          seed.id,
          deletion
            ? new Date(Math.max(start, deletion[0]!.getTime()))
            : new Date(Math.max(start, lastStarted.get(key) ?? 0)),
        );
      }

      return ends;
    }

    function expectEndedAsTheWorldSays(
      world: World,
      before: Map<string, StoredLog>,
      after: Map<string, StoredLog>,
    ): void {
      const ends: Map<string, Date> = expectedEnds(world);

      expect(ends.size).toBeGreaterThan(0);

      for (const [id, was] of before) {
        const is: StoredLog = after.get(id)!;
        const end: Date | undefined = ends.get(id);

        if (!end) {
          expect(is).toEqual(was);
          continue;
        }

        const key: string = getPolicyKey({
          projectId: was.projectId,
          policyId: was.onCallDutyPolicyId!,
        });

        expect(is.endsAt).toEqual(end);
        expect(is.version).toBe(was.version + 1);
        // Never before it started, never after its policy was deleted.
        expect(is.endsAt!.getTime()).toBeGreaterThanOrEqual(
          was.startsAt.getTime(),
        );
        expect(is.endsAt!.getTime()).toBeLessThanOrEqual(
          world.deletedAt.get(key)!,
        );
      }
    }

    test("drawn at random: ends exactly the open logs of deleted policies, each where the data places it, and a second run changes nothing", async () => {
      for (const seed of [11023, 10983, 10970]) {
        for (const table of ["OnCallDutyPolicyTimeLog", "OnCallDutyPolicy"]) {
          await database.query(`DELETE FROM "${schema}"."${table}"`);
        }

        const world: World = await seedWorld(seed);
        const before: Map<string, StoredLog> = await storedLogs();

        await new EndOnCallTimeLogsOfDeletedPolicies({
          deletionReader: auditLogOf(world.deletions),
        }).migrate();

        const afterFirst: Map<string, StoredLog> = await storedLogs();

        expectEndedAsTheWorldSays(world, before, afterFirst);

        // Again: not a row, not its version, not its updatedAt.
        const asked: Array<Array<DeletedPolicy>> = [];

        await new EndOnCallTimeLogsOfDeletedPolicies({
          deletionReader: auditLogOf(world.deletions, asked),
        }).migrate();

        expect(await storedLogs()).toEqual(afterFirst);
        expect(asked).toEqual([]);
        expect(logger.info).toHaveBeenLastCalledWith(
          "EndOnCallTimeLogsOfDeletedPolicies: no on-call time log was left open by a deleted on-call policy.",
        );
      }
    });

    test("two runs at once come to the same as one", async () => {
      const world: World = await seedWorld(6817);
      const before: Map<string, StoredLog> = await storedLogs();

      await Promise.all([
        new EndOnCallTimeLogsOfDeletedPolicies({
          deletionReader: auditLogOf(world.deletions),
        }).migrate(),
        new EndOnCallTimeLogsOfDeletedPolicies({
          deletionReader: auditLogOf(world.deletions),
        }).migrate(),
      ]);

      // Each log ended once: one more version, at the time the world says.
      expectEndedAsTheWorldSays(world, before, await storedLogs());
    });
  },
);
