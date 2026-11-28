import MoveWeeklyWindowsOntoTheirDays, {
  PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/MoveWeeklyWindowsOntoTheirDays";
import Entities from "Common/Models/DatabaseModels/Index";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RestrictionTimes from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import WeeklyWindowDays from "Common/Types/OnCallDutyPolicy/WeeklyWindowDays";
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
 * THE WEEKLY WINDOWS STORED ON OTHER DAYS THAN THEY NAME, ON A MIGRATED
 * POSTGRES (#11455).
 *
 * MoveWeeklyWindowsOntoTheirDays, run against its real statements, on
 * copies of the migrated layer and schedule tables in a schema of the
 * test's own (search_path holds only it), dropped afterwards:
 *
 *   - the issue's layer - Monday, dated on a Wednesday - is moved onto its
 *     Monday, at its time of day, in its schedule's zone, with a new
 *     version, and its schedule told once however many of its layers moved;
 *   - a layer whose days were left out has them filled in: no new version,
 *     and nobody told, as it pages as before;
 *   - a window a time zone explains is left as it pages;
 *   - a layer on its days, a Daily one and a deleted one are left alone;
 *   - a schedule without a zone, or with none stored at all, is read on the
 *     server's clock;
 *   - more layers than a page are all read, paged on the id;
 *   - a layer saved between the read and the write keeps the save;
 *   - a second run changes nothing and tells nobody.
 *
 * Who is on call is worked out, and the change propagated, by the schedule
 * service: stood in for here, and counted.
 *
 * Opt in with RUN_POSTGRES_WEEKLY_WINDOW_DAYS_TESTS=true, against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_WEEKLY_WINDOW_DAYS_TESTS=true \
 *   WEEKLY_WINDOW_DAYS_TEST_DATABASE_HOST=127.0.0.1 \
 *   WEEKLY_WINDOW_DAYS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Workers/DataMigrations/MoveWeeklyWindowsOntoTheirDaysPostgres.test.ts
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_WEEKLY_WINDOW_DAYS_TESTS"] === "true"
    ? describe
    : describe.skip;

const DASHES: RegExp = /-/g;

const PROJECT_ID: string = "11455333-0000-4000-8000-000000000001";
const WARSAW_SCHEDULE: string = "11455333-0000-4000-8000-0000000000a0";
const NEW_YORK_SCHEDULE: string = "11455333-0000-4000-8000-0000000000b0";
const NO_ZONE_SCHEDULE: string = "11455333-0000-4000-8000-0000000000c0";
// A schedule no row is stored for: read as one without a zone.
const MISSING_SCHEDULE: string = "11455333-0000-4000-8000-0000000000d0";

const WARSAW: string = "Europe/Warsaw";
const NEW_YORK: string = "America/New_York";

function dateTime(iso: string): JSONObject {
  return { _type: "DateTime", value: iso };
}

function weekly(windows: Array<JSONObject>): JSONObject {
  return {
    _type: "RestrictionTimes",
    value: {
      restrictionType: "Weekly",
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: windows,
    },
  };
}

const ROTATION: JSONObject = {
  _type: "Recurring",
  value: {
    intervalType: "Week",
    intervalCount: { _type: "PositiveNumber", value: 1 },
  },
};

// Monday 09:00 to 17:00 in Warsaw, on its days.
const ON_ITS_DAYS: JSONObject = {
  startDay: "Monday",
  endDay: "Monday",
  startTime: dateTime("2026-01-05T08:00:00.000Z"),
  endTime: dateTime("2026-01-05T16:00:00.000Z"),
};

// The issue's: Monday, dated on a Wednesday (09:00 to 17:00 in Warsaw).
const DATED_WRONG: JSONObject = {
  startDay: "Monday",
  endDay: "Monday",
  startTime: dateTime("2026-01-07T08:00:00.000Z"),
  endTime: dateTime("2026-01-07T16:00:00.000Z"),
};

// Monday 01:00 to 09:00 set in Warsaw: from Sunday 19:00 read in New York.
const ANOTHER_ZONE: JSONObject = {
  startDay: "Monday",
  endDay: "Monday",
  startTime: dateTime("2026-01-05T00:00:00.000Z"),
  endTime: dateTime("2026-01-05T08:00:00.000Z"),
};

interface Layer {
  id: string;
  scheduleId: string;
  restrictionTimes: JSONObject;
  deletedAt?: Date;
}

const LAYERS: Record<string, Layer> = {
  issue: {
    id: "11455333-0000-4000-8000-000000000011",
    scheduleId: WARSAW_SCHEDULE,
    restrictionTimes: weekly([DATED_WRONG]),
  },
  issueAgain: {
    id: "11455333-0000-4000-8000-000000000012",
    scheduleId: WARSAW_SCHEDULE,
    restrictionTimes: weekly([ON_ITS_DAYS, DATED_WRONG]),
  },
  daysLeftOut: {
    id: "11455333-0000-4000-8000-000000000013",
    scheduleId: NEW_YORK_SCHEDULE,
    restrictionTimes: weekly([
      {
        startTime: dateTime("2026-01-09T22:00:00.000Z"),
        endTime: dateTime("2026-01-12T13:00:00.000Z"),
      },
    ]),
  },
  anotherZone: {
    id: "11455333-0000-4000-8000-000000000014",
    scheduleId: NEW_YORK_SCHEDULE,
    restrictionTimes: weekly([ANOTHER_ZONE]),
  },
  onItsDays: {
    id: "11455333-0000-4000-8000-000000000015",
    scheduleId: WARSAW_SCHEDULE,
    restrictionTimes: weekly([ON_ITS_DAYS]),
  },
  daily: {
    id: "11455333-0000-4000-8000-000000000016",
    scheduleId: WARSAW_SCHEDULE,
    restrictionTimes: {
      _type: "RestrictionTimes",
      value: {
        restrictionType: "Daily",
        dayRestrictionTimes: {
          startTime: dateTime("2026-01-07T16:00:00.000Z"),
          endTime: dateTime("2026-01-08T06:00:00.000Z"),
        },
        weeklyRestrictionTimes: [DATED_WRONG],
      },
    },
  },
  deleted: {
    id: "11455333-0000-4000-8000-000000000017",
    scheduleId: WARSAW_SCHEDULE,
    restrictionTimes: weekly([DATED_WRONG]),
    deletedAt: new Date("2026-11-01T00:00:00.000Z"),
  },
  noZoneExplained: {
    id: "11455333-0000-4000-8000-000000000018",
    scheduleId: NO_ZONE_SCHEDULE,
    restrictionTimes: weekly([
      {
        startDay: "Monday",
        endDay: "Monday",
        startTime: dateTime("2026-01-04T23:30:00.000Z"),
        endTime: dateTime("2026-01-05T07:00:00.000Z"),
      },
    ]),
  },
  missingSchedule: {
    id: "11455333-0000-4000-8000-000000000019",
    scheduleId: MISSING_SCHEDULE,
    restrictionTimes: weekly([DATED_WRONG]),
  },
};

describePostgres(
  "the weekly windows stored on other days than they name (Postgres)",
  () => {
    const schema: string = `weekly_window_days_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;
    let refreshed: Array<string>;
    let propagated: Array<string>;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["WEEKLY_WINDOW_DAYS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["WEEKLY_WINDOW_DAYS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["WEEKLY_WINDOW_DAYS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema}` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      for (const table of [
        "OnCallDutyPolicyScheduleLayer",
        "OnCallDutyPolicySchedule",
      ]) {
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
      refreshed = [];
      propagated = [];

      for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);

      jest
        .spyOn(
          OnCallDutyPolicyScheduleService,
          "refreshCurrentUserIdAndHandoffTimeInSchedule",
        )
        .mockImplementation((async (scheduleId: ObjectID) => {
          refreshed.push(scheduleId.toString());
        }) as never);
      jest
        .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
        .mockImplementation((async (data: { scheduleIds: Array<ObjectID> }) => {
          propagated.push(
            ...data.scheduleIds.map((id: ObjectID): string => {
              return id.toString();
            }),
          );
        }) as never);

      await database.query(
        `DELETE FROM "${schema}"."OnCallDutyPolicyScheduleLayer"`,
      );
      await database.query(
        `DELETE FROM "${schema}"."OnCallDutyPolicySchedule"`,
      );

      for (const [id, timezone] of [
        [WARSAW_SCHEDULE, WARSAW],
        [NEW_YORK_SCHEDULE, NEW_YORK],
        [NO_ZONE_SCHEDULE, null],
      ] as Array<[string, string | null]>) {
        await database.query(
          `INSERT INTO "${schema}"."OnCallDutyPolicySchedule" ("_id", "projectId", "name", "slug", "timezone", "version") VALUES ($1, $2, $3, $4, $5, 1)`,
          [id, PROJECT_ID, `Schedule ${id}`, `schedule-${id}`, timezone],
        );
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function insert(layer: Layer, order: number): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."OnCallDutyPolicyScheduleLayer" ("_id", "projectId", "onCallDutyPolicyScheduleId", "name", "order", "startsAt", "handOffTime", "rotation", "restrictionTimes", "version", "updatedAt", "deletedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 1, $10, $11)`,
        [
          layer.id,
          PROJECT_ID,
          layer.scheduleId,
          `Layer ${order}`,
          order,
          new Date("2026-11-23T08:00:00.000Z"),
          new Date("2026-11-30T08:00:00.000Z"),
          JSON.stringify(ROTATION),
          JSON.stringify(layer.restrictionTimes),
          new Date("2026-01-01T00:00:00.000Z"),
          layer.deletedAt || null,
        ],
      );
    }

    async function insertAll(): Promise<void> {
      let order: number = 1;
      for (const layer of Object.values(LAYERS)) {
        await insert(layer, order++);
      }
    }

    async function row(id: string): Promise<JSONObject> {
      const rows: Array<JSONObject> = await database.query(
        `SELECT "restrictionTimes", "version", "updatedAt" FROM "${schema}"."OnCallDutyPolicyScheduleLayer" WHERE "_id" = $1`,
        [id],
      );
      return rows[0]!;
    }

    function windowsOf(json: unknown): Array<JSONObject> {
      return ((json as JSONObject)["value"] as JSONObject)[
        "weeklyRestrictionTimes"
      ] as Array<JSONObject>;
    }

    // "Monday 09:00" on a zone's clock, as the engine reads a stored time.
    function clockOf(value: unknown, zone: string): string {
      const time: Date = RestrictionTimes.readMoment(value)!;
      return `${WeeklyWindowDays.getDayOf(time, zone)} ${new Intl.DateTimeFormat(
        "en-GB",
        {
          timeZone: zone,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        },
      ).format(time)}`;
    }

    test("REGRESSION #11455: the issue's layers are moved onto Monday in Warsaw, with a new version, and their schedule told once", async () => {
      await insertAll();

      await new MoveWeeklyWindowsOntoTheirDays().migrate();

      for (const name of ["issue", "issueAgain"]) {
        const moved: JSONObject = await row(LAYERS[name]!.id);
        const windows: Array<JSONObject> = windowsOf(moved["restrictionTimes"]);
        const last: JSONObject = windows[windows.length - 1]!;

        expect(clockOf(last["startTime"], WARSAW)).toBe("Monday 09:00");
        expect(clockOf(last["endTime"], WARSAW)).toBe("Monday 17:00");
        expect(last["startDay"]).toBe("Monday");
        expect(moved["version"]).toBe(2);
        expect((moved["updatedAt"] as Date).toISOString()).not.toBe(
          "2026-01-01T00:00:00.000Z",
        );
      }

      // The window on its days beside it is stored exactly as it was.
      expect(
        windowsOf((await row(LAYERS["issueAgain"]!.id))["restrictionTimes"])[0],
      ).toEqual(ON_ITS_DAYS);

      // Filled in: the days its times fall on in New York, paging as before.
      const filled: JSONObject = await row(LAYERS["daysLeftOut"]!.id);
      expect(windowsOf(filled["restrictionTimes"])[0]!["startDay"]).toBe(
        "Friday",
      );
      expect(windowsOf(filled["restrictionTimes"])[0]!["endDay"]).toBe(
        "Monday",
      );
      expect(filled["version"]).toBe(1);
      expect((filled["updatedAt"] as Date).toISOString()).toBe(
        "2026-01-01T00:00:00.000Z",
      );

      // Left as they page, or alone.
      for (const name of [
        "anotherZone",
        "onItsDays",
        "daily",
        "deleted",
        "noZoneExplained",
      ]) {
        const untouched: JSONObject = await row(LAYERS[name]!.id);
        expect({ name, value: untouched["restrictionTimes"] }).toEqual({
          name,
          value: LAYERS[name]!.restrictionTimes,
        });
        expect(untouched["version"]).toBe(1);
      }

      // No schedule row: the server's clock (UTC in CI), so moved there.
      const missing: JSONObject = await row(LAYERS["missingSchedule"]!.id);
      expect(missing["version"]).toBe(2);
      expect(
        WeeklyWindowDays.getDayOf(
          RestrictionTimes.readMoment(
            windowsOf(missing["restrictionTimes"])[0]!["startTime"],
          )!,
          null,
        ),
      ).toBe("Monday");

      // Each schedule whose paging changed, once.
      expect(refreshed.sort()).toEqual(
        [WARSAW_SCHEDULE, MISSING_SCHEDULE].sort(),
      );
      expect(propagated.sort()).toEqual(
        [WARSAW_SCHEDULE, MISSING_SCHEDULE].sort(),
      );
    });

    test("a second run writes nothing, and tells nobody", async () => {
      await insertAll();
      await new MoveWeeklyWindowsOntoTheirDays().migrate();

      const before: Array<JSONObject> = await database.query(
        `SELECT "_id", "restrictionTimes", "version", "updatedAt" FROM "${schema}"."OnCallDutyPolicyScheduleLayer" ORDER BY "_id"`,
      );

      refreshed = [];
      propagated = [];
      await new MoveWeeklyWindowsOntoTheirDays().migrate();

      const after: Array<JSONObject> = await database.query(
        `SELECT "_id", "restrictionTimes", "version", "updatedAt" FROM "${schema}"."OnCallDutyPolicyScheduleLayer" ORDER BY "_id"`,
      );

      expect(after).toEqual(before);
      expect(refreshed).toEqual([]);
      expect(propagated).toEqual([]);
    });

    test("more layers than a page are all read", async () => {
      const count: number = PAGE_SIZE + 25;

      await database.query(
        `INSERT INTO "${schema}"."OnCallDutyPolicyScheduleLayer" ("_id", "projectId", "onCallDutyPolicyScheduleId", "name", "order", "startsAt", "handOffTime", "rotation", "restrictionTimes", "version") SELECT gen_random_uuid(), $1, $2, 'Layer ' || n, n, now(), now(), $3::jsonb, $4::jsonb, 1 FROM generate_series(1, $5) AS n`,
        [
          PROJECT_ID,
          WARSAW_SCHEDULE,
          JSON.stringify(ROTATION),
          JSON.stringify(weekly([DATED_WRONG])),
          count,
        ],
      );

      await new MoveWeeklyWindowsOntoTheirDays().migrate();

      const rows: Array<JSONObject> = await database.query(
        `SELECT count(*)::int AS "moved" FROM "${schema}"."OnCallDutyPolicyScheduleLayer" WHERE "version" = 2 AND "restrictionTimes"#>>'{value,weeklyRestrictionTimes,0,startTime,value}' = '2026-01-05T08:00:00.000Z'`,
      );
      expect(rows[0]!["moved"]).toBe(count);
      expect(refreshed).toEqual([WARSAW_SCHEDULE]);
    });

    test("a layer saved between the read and the write keeps the save", async () => {
      await insert(LAYERS["issue"]!, 1);

      const saved: JSONObject = weekly([
        { ...ON_ITS_DAYS, startDay: "Monday", endDay: "Monday" },
      ]);

      // The save lands just before the migration's write of the layer.
      const query: (
        sql: string,
        parameters?: Array<unknown>,
      ) => Promise<unknown> = database.manager.query.bind(database.manager);
      jest.spyOn(database.manager, "query").mockImplementation((async (
        sql: string,
        parameters?: Array<unknown>,
      ) => {
        if (sql.startsWith('UPDATE "OnCallDutyPolicyScheduleLayer"')) {
          await query(
            `UPDATE "${schema}"."OnCallDutyPolicyScheduleLayer" SET "restrictionTimes" = $2::jsonb, "version" = 5 WHERE "_id" = $1`,
            [LAYERS["issue"]!.id, JSON.stringify(saved)],
          );
        }
        return await query(sql, parameters);
      }) as never);

      await new MoveWeeklyWindowsOntoTheirDays().migrate();

      const kept: JSONObject = await row(LAYERS["issue"]!.id);
      expect(kept["restrictionTimes"]).toEqual(saved);
      expect(kept["version"]).toBe(5);
      expect(refreshed).toEqual([]);
    });
  },
);
