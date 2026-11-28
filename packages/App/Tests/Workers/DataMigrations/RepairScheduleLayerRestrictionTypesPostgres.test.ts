import RepairScheduleLayerRestrictionTypes, {
  PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/RepairScheduleLayerRestrictionTypes";
import Entities from "Common/Models/DatabaseModels/Index";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
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
 * THE SCHEDULE LAYERS STORED IN A STATE THAT PAGED NOBODY, REPAIRED ON A
 * MIGRATED POSTGRES (#11269).
 *
 * RepairScheduleLayerRestrictionTypes, run against its real statements, on a
 * copy of the migrated layer table in a schema of the test's own (search_path
 * holds only it), dropped afterwards:
 *
 *   - a layer written with restrictionType, or with no type the engine read,
 *     is stored with the type it holds, under restrictionType alone, with a
 *     new version - and its schedule is told, once however many of its
 *     layers changed;
 *   - one stored with the older spelling alone is only respelled: no new
 *     version, and nobody told, as it pages exactly as before;
 *   - a rotation written as "Weekly" is the week it names;
 *   - a deleted layer, a layer already as stored, and a value that is no
 *     restriction are left alone;
 *   - more layers than a page are all read, paged on the id;
 *   - a layer saved between the read and the write keeps the save;
 *   - a second run changes nothing and tells nobody.
 *
 * Who is on call is worked out, and the change propagated, by the schedule
 * service: stood in for here, and counted.
 *
 * Opt in with RUN_POSTGRES_LAYER_RESTRICTION_REPAIR_TESTS=true, against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_LAYER_RESTRICTION_REPAIR_TESTS=true \
 *   LAYER_RESTRICTION_REPAIR_TEST_DATABASE_HOST=127.0.0.1 \
 *   LAYER_RESTRICTION_REPAIR_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Workers/DataMigrations/RepairScheduleLayerRestrictionTypesPostgres.test.ts
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_LAYER_RESTRICTION_REPAIR_TESTS"] === "true"
    ? describe
    : describe.skip;

const DASHES: RegExp = /-/g;

const PROJECT_ID: string = "11269111-0000-4000-8000-000000000001";
const SCHEDULE_A: string = "11269111-0000-4000-8000-0000000000a0";
const SCHEDULE_B: string = "11269111-0000-4000-8000-0000000000b0";
const SCHEDULE_C: string = "11269111-0000-4000-8000-0000000000c0";

function restriction(value: JSONObject): JSONObject {
  return { _type: "RestrictionTimes", value: value };
}

function rotation(intervalType: string): JSONObject {
  return {
    _type: "Recurring",
    value: {
      intervalType: intervalType,
      intervalCount: { _type: "PositiveNumber", value: 1 },
    },
  };
}

const NIGHTS: JSONObject = {
  startTime: { _type: "DateTime", value: "2026-01-05T16:00:00.000Z" },
  endTime: { _type: "DateTime", value: "2026-01-06T06:00:00.000Z" },
};

const MONDAY: JSONObject = {
  startDay: "Monday",
  endDay: "Monday",
  startTime: { _type: "DateTime", value: "2026-01-05T08:00:00.000Z" },
  endTime: { _type: "DateTime", value: "2026-01-05T16:00:00.000Z" },
};

interface Layer {
  id: string;
  scheduleId: string;
  restrictionTimes: JSONObject;
  rotation?: JSONObject;
  deletedAt?: Date;
}

// Each case a layer can be stored in, and its schedule.
const LAYERS: Record<string, Layer> = {
  // The issue's: the natural spelling, around the clock.
  naturalNone: {
    id: "11269111-0000-4000-8000-000000000011",
    scheduleId: SCHEDULE_A,
    restrictionTimes: restriction({
      restrictionType: "None",
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: [],
    }),
  },
  naturalDaily: {
    id: "11269111-0000-4000-8000-000000000012",
    scheduleId: SCHEDULE_A,
    restrictionTimes: restriction({
      restrictionType: "Daily",
      dayRestrictionTimes: NIGHTS,
      weeklyRestrictionTimes: [],
    }),
  },
  typelessWeekly: {
    id: "11269111-0000-4000-8000-000000000013",
    scheduleId: SCHEDULE_B,
    restrictionTimes: restriction({ weeklyRestrictionTimes: [MONDAY] }),
  },
  olderSpellingDaily: {
    id: "11269111-0000-4000-8000-000000000014",
    scheduleId: SCHEDULE_C,
    restrictionTimes: restriction({
      restictionType: "Daily",
      dayRestrictionTimes: NIGHTS,
      weeklyRestrictionTimes: [],
    }),
  },
  /*
   * As stored now - by a write since the fix, or by one before it with the
   * natural spelling, which the row cannot tell apart: never written again,
   * and its schedule told, as for the natural spelling.
   */
  alreadyStored: {
    id: "11269111-0000-4000-8000-000000000015",
    scheduleId: SCHEDULE_A,
    restrictionTimes: restriction({
      restrictionType: "None",
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: [],
    }),
  },
  weeklyRotation: {
    id: "11269111-0000-4000-8000-000000000016",
    scheduleId: SCHEDULE_B,
    restrictionTimes: restriction({
      restrictionType: "None",
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: [],
    }),
    rotation: rotation("Weekly"),
  },
  deleted: {
    id: "11269111-0000-4000-8000-000000000017",
    scheduleId: SCHEDULE_C,
    restrictionTimes: restriction({ restrictionType: "Daily" }),
    deletedAt: new Date("2026-11-01T00:00:00.000Z"),
  },
  notARestriction: {
    id: "11269111-0000-4000-8000-000000000018",
    scheduleId: SCHEDULE_C,
    restrictionTimes: { hours: "nights" },
  },
};

describePostgres(
  "the schedule layers stored with no restriction type the engine read (Postgres)",
  () => {
    const schema: string = `layer_restriction_repair_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;
    let refreshed: Array<string>;
    let propagated: Array<string>;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["LAYER_RESTRICTION_REPAIR_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["LAYER_RESTRICTION_REPAIR_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["LAYER_RESTRICTION_REPAIR_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema}` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."OnCallDutyPolicyScheduleLayer" (LIKE public."OnCallDutyPolicyScheduleLayer" INCLUDING ALL)`,
      );
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
          JSON.stringify(layer.rotation || rotation("Week")),
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
        `SELECT "restrictionTimes", "rotation", "version", "updatedAt" FROM "${schema}"."OnCallDutyPolicyScheduleLayer" WHERE "_id" = $1`,
        [id],
      );
      return rows[0]!;
    }

    function valueOf(json: unknown): JSONObject {
      return (json as JSONObject)["value"] as JSONObject;
    }

    test("REGRESSION #11269: each layer is stored with the type it holds, and its schedule told once", async () => {
      await insertAll();

      await new RepairScheduleLayerRestrictionTypes().migrate();

      /*
       * The natural spelling: already as stored now, so not written - but it
       * paged nobody before, so its schedule is told.
       */
      const naturalNone: JSONObject = await row(LAYERS["naturalNone"]!.id);
      expect(valueOf(naturalNone["restrictionTimes"])).toEqual({
        restrictionType: "None",
        dayRestrictionTimes: null,
        weeklyRestrictionTimes: [],
      });
      expect(naturalNone["version"]).toBe(1);

      const naturalDaily: JSONObject = await row(LAYERS["naturalDaily"]!.id);
      expect(valueOf(naturalDaily["restrictionTimes"])["restrictionType"]).toBe(
        "Daily",
      );
      expect(
        valueOf(naturalDaily["restrictionTimes"])["dayRestrictionTimes"],
      ).toEqual(NIGHTS);

      // No type at all: the windows it holds.
      const typeless: JSONObject = await row(LAYERS["typelessWeekly"]!.id);
      expect(valueOf(typeless["restrictionTimes"])["restrictionType"]).toBe(
        "Weekly",
      );
      expect(typeless["version"]).toBe(2);

      // The older spelling alone: respelled, paging as before - no new version.
      const older: JSONObject = await row(LAYERS["olderSpellingDaily"]!.id);
      expect(valueOf(older["restrictionTimes"])).toEqual({
        restrictionType: "Daily",
        dayRestrictionTimes: NIGHTS,
        weeklyRestrictionTimes: [],
      });
      expect(older["version"]).toBe(1);
      expect((older["updatedAt"] as Date).toISOString()).toBe(
        "2026-01-01T00:00:00.000Z",
      );

      // "Weekly": the week it names.
      const weekly: JSONObject = await row(LAYERS["weeklyRotation"]!.id);
      expect(valueOf(weekly["rotation"])["intervalType"]).toBe("Week");
      expect(weekly["version"]).toBe(2);

      // Left alone: as stored, deleted, and no restriction at all.
      for (const name of ["alreadyStored", "deleted", "notARestriction"]) {
        const untouched: JSONObject = await row(LAYERS[name]!.id);
        expect({ name, value: untouched["restrictionTimes"] }).toEqual({
          name,
          value: LAYERS[name]!.restrictionTimes,
        });
        expect(untouched["version"]).toBe(1);
      }

      // Each schedule whose paging changed, once; never the respelled one's.
      expect(refreshed.sort()).toEqual([SCHEDULE_A, SCHEDULE_B].sort());
      expect(propagated.sort()).toEqual([SCHEDULE_A, SCHEDULE_B].sort());

      // What the engine reads from each row now is what it pages by.
      expect(
        RestrictionTimes.fromJSON(naturalNone["restrictionTimes"] as JSONObject)
          .restrictionType,
      ).toBe(RestrictionType.None);
    });

    test("a second run writes nothing", async () => {
      await insertAll();
      await new RepairScheduleLayerRestrictionTypes().migrate();

      const before: Array<JSONObject> = await database.query(
        `SELECT "_id", "restrictionTimes", "rotation", "version", "updatedAt" FROM "${schema}"."OnCallDutyPolicyScheduleLayer" ORDER BY "_id"`,
      );

      await new RepairScheduleLayerRestrictionTypes().migrate();

      const after: Array<JSONObject> = await database.query(
        `SELECT "_id", "restrictionTimes", "rotation", "version", "updatedAt" FROM "${schema}"."OnCallDutyPolicyScheduleLayer" ORDER BY "_id"`,
      );

      expect(after).toEqual(before);
    });

    test("more layers than a page are all read", async () => {
      const count: number = PAGE_SIZE + 25;

      await database.query(
        `INSERT INTO "${schema}"."OnCallDutyPolicyScheduleLayer" ("_id", "projectId", "onCallDutyPolicyScheduleId", "name", "order", "startsAt", "handOffTime", "rotation", "restrictionTimes", "version") SELECT gen_random_uuid(), $1, $2, 'Layer ' || n, n, now(), now(), $3::jsonb, $4::jsonb, 1 FROM generate_series(1, $5) AS n`,
        [
          PROJECT_ID,
          SCHEDULE_A,
          JSON.stringify(rotation("Week")),
          JSON.stringify(restriction({ restrictionType: "None" })),
          count,
        ],
      );

      await new RepairScheduleLayerRestrictionTypes().migrate();

      const rows: Array<JSONObject> = await database.query(
        `SELECT count(*)::int AS "repaired" FROM "${schema}"."OnCallDutyPolicyScheduleLayer" WHERE "version" = 2 AND "restrictionTimes"#>>'{value,restrictionType}' = 'None'`,
      );
      expect(rows[0]!["repaired"]).toBe(count);
      expect(refreshed).toEqual([SCHEDULE_A]);
    });

    test("a layer saved between the read and the write keeps the save", async () => {
      // One the repair writes: its type under no key the engine read.
      await insert(
        {
          ...LAYERS["typelessWeekly"]!,
          id: LAYERS["naturalDaily"]!.id,
          scheduleId: SCHEDULE_A,
        },
        1,
      );

      const saved: JSONObject = restriction({
        restrictionType: "Weekly",
        weeklyRestrictionTimes: [MONDAY],
      });

      // The save lands just before the repair's write of the layer.
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
            [LAYERS["naturalDaily"]!.id, JSON.stringify(saved)],
          );
        }
        return await query(sql, parameters);
      }) as never);

      await new RepairScheduleLayerRestrictionTypes().migrate();

      const kept: JSONObject = await row(LAYERS["naturalDaily"]!.id);
      expect(kept["restrictionTimes"]).toEqual(saved);
      expect(kept["version"]).toBe(5);
      expect(refreshed).toEqual([]);
    });
  },
);
