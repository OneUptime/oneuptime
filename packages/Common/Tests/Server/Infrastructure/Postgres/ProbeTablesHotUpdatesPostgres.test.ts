import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import logger from "../../../../Server/Utils/Logger";
import NetworkDeviceWalkUtil from "../../../../Server/Utils/Monitor/NetworkDeviceWalkUtil";
import MonitorProbeLastResults from "../../../../Server/Utils/Monitor/MonitorProbeLastResults";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
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
import { DataSource } from "typeorm";

/*
 * THE WRITES OF A PROBE CYCLE, AS HOT UPDATES OR NOT, ON POSTGRES (issue
 * #7921).
 *
 * An update that changes a column any index on the table names - in its
 * key, its INCLUDE list or a partial index's predicate - cannot be HOT: it
 * writes an entry into every index on the table and leaves a dead one in
 * each for vacuum. One that changes none of them, and fits on its row's
 * page, is HOT: no index entry, and the next read of the page reclaims the
 * old version. "MonitorProbe" and "NetworkDevice" take every claim, every
 * probe result and every poll's verdict and rate baseline, so which of
 * those writes can be HOT is most of what they cost Postgres.
 *
 * Only a database answers that, so this runs the services' own statements
 * and reads pg_stat_user_tables after each:
 *
 *   - the migrated tables carry the indexes and storage parameters the
 *     #7921 migrations leave (no index names a column every poll moves);
 *   - a probe's result stored over a monitor probe is HOT; the claim, which
 *     moves the indexed nextPingAt, is not and cannot be;
 *   - a reachable poll's verdict whose state did not change is HOT, and so
 *     is its rate baseline; the claim (nextPollAt) is not, nor is a verdict
 *     that changes a state an index names (reachability, ports down);
 *   - with "lastSeenAt" indexed again, as it was before, the same verdict
 *     is not HOT.
 *
 * Opt in with RUN_POSTGRES_PROBE_TABLE_HOT_UPDATE_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The Project, Probe,
 * Monitor, MonitorProbe and NetworkDevice tables' STRUCTURE (indexes and
 * fillfactor included) is cloned into a unique schema that is dropped
 * afterwards. One connection, so each statement's counts are flushed before
 * they are read (pg_stat_force_next_flush). Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * PROBE_TABLE_HOT_UPDATE_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * PROBE_TABLE_HOT_UPDATE_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PROBE_TABLE_HOT_UPDATE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "Probe",
  "Monitor",
  "MonitorProbe",
  "NetworkDevice",
];

const NOW: Date = new Date("2026-11-14T10:00:00.000Z");

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

interface IndexRow {
  name: string;
  columns: string;
  predicate: string | null;
  isUnique: boolean;
  isValid: boolean;
}

interface UpdateCounts {
  updates: number;
  hot: number;
}

describePostgres("the probe tables' writes, HOT or not, on Postgres", () => {
  const schema: string = `probe_table_hot_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  const PROJECT_ID: ObjectID = ObjectID.generate();
  const PROBE_ID: ObjectID = ObjectID.generate();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["PROBE_TABLE_HOT_UPDATE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["PROBE_TABLE_HOT_UPDATE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PROBE_TABLE_HOT_UPDATE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      // One connection: a statement's counts are flushed before it answers.
      extra: {
        options: `-c search_path=${schema}`,
        max: 1,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );

      // The page room the migrations leave, which LIKE does not copy.
      const options: Array<{ reloptions: Array<string> | null }> =
        await database.query(
          `SELECT reloptions FROM pg_class WHERE oid = $1::regclass`,
          [`public."${table}"`],
        );
      for (const option of options[0]?.reloptions || []) {
        if (option.startsWith("fillfactor=")) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" SET (${option})`,
          );
        }
      }

      // A fixture names only what the statements touch.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'
           AND column_name <> '_id'`,
        [schema, table],
      );
      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation((() => {
        return undefined;
      }) as never);
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    // Empty pages for every case: a HOT update needs room on its page.
    for (const table of TABLES) {
      await database.query(`TRUNCATE "${schema}"."${table}"`);
    }

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "isBlocked", "isSampleProject")
       VALUES ($1, 'Probe tables', false, false)`,
      [PROJECT_ID.toString()],
    );
    await database.query(
      `INSERT INTO "${schema}"."Probe" ("_id", "name", "projectId", "isGlobalProbe")
       VALUES ($1, 'Probe', $2, false)`,
      [PROBE_ID.toString(), PROJECT_ID.toString()],
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The table's update counts so far. pg_stat_force_next_flush makes this
   * connection flush its pending counts as it finishes that statement -
   * before it answers - so the read after it sees every statement before.
   */
  async function countsOf(table: string): Promise<UpdateCounts> {
    await database.query("SELECT pg_stat_force_next_flush()");
    await database.query("SELECT pg_stat_clear_snapshot()");
    const rows: Array<UpdateCounts> = await database.query(
      `SELECT n_tup_upd::int AS updates, n_tup_hot_upd::int AS hot
         FROM pg_stat_user_tables WHERE relid = $1::regclass`,
      [`"${schema}"."${table}"`],
    );
    return rows[0]!;
  }

  // What a write did to the table's counts.
  async function writesOf(
    table: string,
    write: () => Promise<unknown>,
  ): Promise<UpdateCounts> {
    const before: UpdateCounts = await countsOf(table);
    await write();
    const after: UpdateCounts = await countsOf(table);
    return {
      updates: after.updates - before.updates,
      hot: after.hot - before.hot,
    };
  }

  async function indexesOf(table: string): Promise<Array<IndexRow>> {
    return await database.query(
      `SELECT ic.relname AS name,
              (SELECT string_agg(a.attname, ',' ORDER BY k.position)
                 FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
              ) AS columns,
              pg_get_expr(i.indpred, i.indrelid) AS predicate,
              i.indisunique AS "isUnique",
              i.indisvalid AS "isValid"
         FROM pg_index i
         JOIN pg_class ic ON ic.oid = i.indexrelid
        WHERE i.indrelid = $1::regclass
        ORDER BY 2`,
      [`public."${table}"`],
    );
  }

  async function fillfactorOf(table: string): Promise<string | undefined> {
    const rows: Array<{ reloptions: Array<string> | null }> =
      await database.query(
        `SELECT reloptions FROM pg_class WHERE oid = $1::regclass`,
        [`public."${table}"`],
      );
    return (rows[0]?.reloptions || []).find((option: string): boolean => {
      return option.startsWith("fillfactor=");
    });
  }

  describe("the migrated tables", () => {
    test("MonitorProbe: five indexes, none of them a bare monitorId or probeId, every one valid", async () => {
      const indexes: Array<IndexRow> = await indexesOf("MonitorProbe");

      expect(
        indexes
          .map((index: IndexRow): string => {
            return index.columns;
          })
          .sort(),
      ).toEqual(
        [
          "_id",
          "monitorId,probeId",
          "monitorId,projectId",
          "probeId,isEnabled,nextPingAt",
          "projectId",
        ].sort(),
      );
      expect(
        indexes.every((index: IndexRow): boolean => {
          return index.isValid;
        }),
      ).toBe(true);
    });

    test("NetworkDevice: no index names lastSeenAt, the Status index has no fourth column, and no bare projectId index is left", async () => {
      const indexes: Array<IndexRow> = await indexesOf("NetworkDevice");

      expect(
        indexes.filter((index: IndexRow): boolean => {
          return (
            index.columns.split(",").includes("lastSeenAt") ||
            (index.predicate || "").includes("lastSeenAt")
          );
        }),
      ).toEqual([]);
      expect(
        indexes.filter((index: IndexRow): boolean => {
          return (
            index.columns === "projectId,isArchived,isReachable" &&
            !index.predicate
          );
        }),
      ).toHaveLength(1);
      expect(
        indexes.filter((index: IndexRow): boolean => {
          return index.columns === "projectId";
        }),
      ).toEqual([]);
      expect(indexes).toHaveLength(13);
      expect(
        indexes.every((index: IndexRow): boolean => {
          return index.isValid;
        }),
      ).toBe(true);
    });

    test("room on every page: fillfactor 90 on MonitorProbe, 80 on NetworkDevice", async () => {
      expect(await fillfactorOf("MonitorProbe")).toBe("fillfactor=90");
      expect(await fillfactorOf("NetworkDevice")).toBe("fillfactor=80");
    });
  });

  describe("MonitorProbe", () => {
    async function insertMonitorProbe(): Promise<{
      id: ObjectID;
      monitorId: ObjectID;
    }> {
      const monitorId: ObjectID = ObjectID.generate();
      const id: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."Monitor"
           ("_id", "projectId", "name", "monitorType", "monitoringInterval",
            "isArchived", "disableActiveMonitoring",
            "disableActiveMonitoringBecauseOfManualIncident",
            "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent")
         VALUES ($1, $2, 'Website', 'Website', '* * * * *', false, false, false, false)`,
        [monitorId.toString(), PROJECT_ID.toString()],
      );
      await database.query(
        `INSERT INTO "${schema}"."MonitorProbe"
           ("_id", "projectId", "probeId", "monitorId", "isEnabled", "nextPingAt",
            "lastMonitoringLog", "createdAt", "updatedAt", "version")
         VALUES ($1, $2, $3, $4, true, $5, '{}'::jsonb, $6, $6, 1)`,
        [
          id.toString(),
          PROJECT_ID.toString(),
          PROBE_ID.toString(),
          monitorId.toString(),
          minutesFromNow(-1),
          minutesFromNow(-60),
        ],
      );

      return { id, monitorId };
    }

    test("a probe's result stored over a monitor probe is a HOT update", async () => {
      const { monitorId } = await insertMonitorProbe();

      expect(
        await writesOf("MonitorProbe", async (): Promise<void> => {
          // MonitorResource's write of a probe's latest result.
          await MonitorProbeLastResults.storeResultAndReadProbes({
            monitorId,
            reportingProbeId: PROBE_ID,
            reportedStepId: "step-1",
            judgedStepId: "step-1",
            result: {
              isOnline: true,
              responseTimeInMs: 182,
              monitoredAt: NOW.toISOString(),
            },
          });
        }),
      ).toEqual({ updates: 1, hot: 1 });
    });

    test("the claim is not, and cannot be: it moves nextPingAt, which the claim's own index orders by", async () => {
      const { id } = await insertMonitorProbe();
      let claimed: Array<ObjectID> = [];

      expect(
        await writesOf("MonitorProbe", async () => {
          claimed = await MonitorProbeService.claimMonitorProbesForProbing({
            probeId: PROBE_ID,
            limit: 10,
          });
        }),
      ).toEqual({ updates: 1, hot: 0 });
      expect(
        claimed.map((claimedId: ObjectID): string => {
          return claimedId.toString();
        }),
      ).toEqual([id.toString()]);
    });
  });

  describe("NetworkDevice", () => {
    const SEEN_AT: Date = minutesFromNow(-5);

    async function insertDevice(): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."NetworkDevice"
           ("_id", "projectId", "probeId", "name", "slug", "hostname",
            "isPollingEnabled", "pollingIntervalInMinutes", "nextPollAt",
            "monitoringMethod", "isArchived", "isReachable", "isSnmpReachable",
            "lastSeenAt", "lastSnmpSeenAt", "lastPolledAt", "lastPollReceivedAt",
            "interfacesTotal", "interfacesUp", "interfacesDown",
            "createdAt", "updatedAt", "version")
         VALUES ($1, $2, $3, 'core-sw', $4, '10.20.12.7', true, 5, $5, 'Probe',
                 false, true, true, $6, $6, $6, $6, 24, 24, 0, $7, $7, 1)`,
        [
          id.toString(),
          PROJECT_ID.toString(),
          PROBE_ID.toString(),
          `core-sw-${id.toString()}`,
          minutesFromNow(-1),
          SEEN_AT,
          minutesFromNow(-60),
        ],
      );

      return id;
    }

    async function lastSeenAtOf(id: ObjectID): Promise<Date> {
      const rows: Array<{ lastSeenAt: Date }> = await database.query(
        `SELECT "lastSeenAt" FROM "${schema}"."NetworkDevice" WHERE "_id" = $1`,
        [id.toString()],
      );
      return rows[0]!.lastSeenAt;
    }

    // NetworkDeviceService.writePollVerdict of a poll received now.
    function writeVerdict(
      id: ObjectID,
      verdict: {
        isReachable: boolean;
        interfacesDown: number;
      },
    ): Promise<boolean> {
      return NetworkDeviceService.writePollVerdict({
        projectId: PROJECT_ID,
        deviceId: id,
        receivedAt: NOW,
        processedAt: NOW,
        verdict: {
          isReachable: verdict.isReachable,
          isSnmpReachable: verdict.isReachable,
          interfaceCounts: verdict.isReachable
            ? {
                total: 24,
                up: 24 - verdict.interfacesDown,
                down: verdict.interfacesDown,
              }
            : undefined,
        },
      });
    }

    test("a reachable poll's verdict, nothing changed but its times, is a HOT update - lastSeenAt moved all the same", async () => {
      const id: ObjectID = await insertDevice();
      let written: boolean = false;

      expect(
        await writesOf("NetworkDevice", async () => {
          written = await writeVerdict(id, {
            isReachable: true,
            interfacesDown: 0,
          });
        }),
      ).toEqual({ updates: 1, hot: 1 });
      expect(written).toBe(true);
      expect((await lastSeenAtOf(id)).toISOString()).toBe(NOW.toISOString());
    });

    test("its rate baseline is a HOT update", async () => {
      const id: ObjectID = await insertDevice();

      expect(
        await writesOf("NetworkDevice", () => {
          return NetworkDeviceWalkUtil.writeWalkBaseline({
            deviceId: id,
            lastWalkLog: {
              snmpResponse: {
                interfaces: [
                  {
                    interfaceIndex: 1,
                    name: "GigabitEthernet1/0/1",
                    isOperationallyUp: true,
                    isAdministrativelyUp: true,
                    inOctets: 1048576,
                    outOctets: 2097152,
                  },
                ],
              },
              monitoredAt: NOW.toISOString(),
            },
          });
        }),
      ).toEqual({ updates: 1, hot: 1 });
    });

    test("the claim is not, and cannot be: it moves nextPollAt, which the claim's own index orders by", async () => {
      const id: ObjectID = await insertDevice();
      let claimed: Array<ObjectID> = [];

      expect(
        await writesOf("NetworkDevice", async () => {
          claimed = await NetworkDeviceService.claimDevicesForPolling({
            probeId: PROBE_ID,
            limit: 10,
          });
        }),
      ).toEqual({ updates: 1, hot: 0 });
      expect(
        claimed.map((claimedId: ObjectID): string => {
          return claimedId.toString();
        }),
      ).toEqual([id.toString()]);
    });

    test("a verdict that changes a state an index names is not HOT: ports going down, a device going down", async () => {
      const portsDown: ObjectID = await insertDevice();
      const wentDown: ObjectID = await insertDevice();

      // interfacesDown: the partial index of devices with ports down.
      expect(
        await writesOf("NetworkDevice", () => {
          return writeVerdict(portsDown, {
            isReachable: true,
            interfacesDown: 2,
          });
        }),
      ).toEqual({ updates: 1, hot: 0 });

      // isReachable: the Status index.
      expect(
        await writesOf("NetworkDevice", () => {
          return writeVerdict(wentDown, {
            isReachable: false,
            interfacesDown: 0,
          });
        }),
      ).toEqual({ updates: 1, hot: 0 });
    });

    test("with lastSeenAt indexed again, as before #7921, the same verdict is not HOT", async () => {
      const id: ObjectID = await insertDevice();

      await database.query(
        `CREATE INDEX "status_with_last_seen" ON "${schema}"."NetworkDevice"
           ("projectId", "isArchived", "isReachable", "lastSeenAt")`,
      );

      try {
        expect(
          await writesOf("NetworkDevice", () => {
            return writeVerdict(id, { isReachable: true, interfacesDown: 0 });
          }),
        ).toEqual({ updates: 1, hot: 0 });
      } finally {
        await database.query(`DROP INDEX "${schema}"."status_with_last_seen"`);
      }
    });
  });
});
