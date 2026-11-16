import BackfillMonitorFirstMeasuredAt from "../../../FeatureSet/Workers/DataMigrations/BackfillMonitorFirstMeasuredAt";
import BackfillMonitorFirstMeasuredAtForUptimeHistory from "../../../FeatureSet/Workers/DataMigrations/BackfillMonitorFirstMeasuredAtForUptimeHistory";
import Entities from "Common/Models/DatabaseModels/Index";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorStatusTimelineService, {
  FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME,
} from "Common/Server/Services/MonitorStatusTimelineService";
import logger from "Common/Server/Utils/Logger";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import {
  UptimeDailyAggregate,
  UptimeDayBucket,
} from "Common/Types/StatusPage/UptimeDailyAggregate";
import { DataSource } from "Common/node_modules/typeorm";

/*
 * A MONITOR'S FIRST CHECK, PUT RIGHT FOR ITS UPTIME HISTORY, ON A MIGRATED
 * POSTGRES (issue #8960).
 *
 * Since #8960 a monitor's uptime bars and percentages leave out the time
 * before its first check (Monitor.firstMeasuredAt). On an upgrade the column
 * is added empty, the app starts, and every result that comes back stamps
 * its monitor with now - before BackfillMonitorFirstMeasuredAt, which runs
 * with the other data migrations, can stamp it with its creation. Read as
 * it is, nearly every monitor's history before the upgrade would turn to no
 * data. Only Postgres can show:
 *
 *  - BackfillMonitorFirstMeasuredAtForUptimeHistory gives a monitor a
 *    result stamped before the backfill finished, a Probe Status monitor,
 *    and a Network Device monitor whose device has been polled, the time it
 *    was created - and leaves a monitor first measured after the backfill
 *    finished, one nothing has measured, a manual monitor, one the backfill
 *    stamped and one created after it finished as they are; run again, it
 *    changes nothing; without the backfill's row it does nothing;
 *  - the whole upgrade, in order, leaves a monitor checked all along with
 *    its history, and one nothing ever checked with none - and until the
 *    migration's row is there, the uptime statements leave nothing out.
 *
 * Opt in with RUN_POSTGRES_MONITOR_FIRST_MEASURED_HISTORY_TESTS=true against
 * a Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database, right after its drift check. The STRUCTURE of the
 * tables it reads is cloned into a unique schema (search_path holds only
 * that schema), dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from
 * MONITOR_FIRST_MEASURED_HISTORY_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from MONITOR_FIRST_MEASURED_HISTORY_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_MONITOR_FIRST_MEASURED_HISTORY_TESTS"] === "true"
    ? describe
    : describe.skip;

const DASHES: RegExp = /-/g;

const TABLES: Array<string> = [
  "Monitor",
  "MonitorProbe",
  "MonitorStatusTimeline",
  "MonitorStatus",
  "MonitorNetworkDevice",
  "NetworkDevice",
  "DataMigrations",
];

interface StoredMonitor {
  _id: string;
  firstMeasuredAt: Date | null;
}

// Created long before the upgrade.
const CREATED_AT: Date = new Date("2025-03-01T10:00:00.000Z");
// The upgrade: the column is added and the app starts.
const UPGRADE_AT: Date = new Date("2026-11-20T10:00:00.000Z");
// When BackfillMonitorFirstMeasuredAt finished, as its row says.
const BACKFILL_FINISHED_AT: Date = new Date("2026-11-20T10:15:00.000Z");

describePostgres(
  "a monitor's first check, put right for its uptime history (Postgres)",
  () => {
    const schema: string = `first_measured_history_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;
    const projectId: ObjectID = ObjectID.generate();
    const operationalId: ObjectID = ObjectID.generate();

    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["MONITOR_FIRST_MEASURED_HISTORY_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["MONITOR_FIRST_MEASURED_HISTORY_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["MONITOR_FIRST_MEASURED_HISTORY_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=5000`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // The status every monitor is created in.
      await database.query(
        `INSERT INTO "${schema}"."MonitorStatus" ("_id", "version", "projectId", "name", "slug", "color", "priority", "isOperationalState", "isOfflineState") VALUES ($1, 1, $2, 'Operational', 'operational', '#10b981', 1, true, false)`,
        [operationalId.toString(), projectId.toString()],
      );
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
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      for (const table of TABLES) {
        if (table !== "MonitorStatus") {
          await database.query(`DELETE FROM "${schema}"."${table}"`);
        }
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function insertMonitor(data: {
      name: string;
      monitorType: MonitorType;
      createdAt?: Date | undefined;
      firstMeasuredAt?: Date | null | undefined;
    }): Promise<string> {
      const id: string = ObjectID.generate().toString();

      await database.query(
        `INSERT INTO "${schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "createdAt", "firstMeasuredAt") VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          projectId.toString(),
          data.name,
          `${data.name}-${id}`,
          data.monitorType,
          operationalId.toString(),
          data.createdAt || CREATED_AT,
          data.firstMeasuredAt || null,
        ],
      );

      return id;
    }

    async function linkDevice(data: {
      monitorId: string;
      lastPolledAt: Date | null;
    }): Promise<void> {
      const deviceId: string = ObjectID.generate().toString();

      await database.query(
        `INSERT INTO "${schema}"."NetworkDevice" ("_id", "version", "projectId", "name", "slug", "hostname", "lastPolledAt") VALUES ($1, 1, $2, $3, $3, '10.0.0.1', $4)`,
        [
          deviceId,
          projectId.toString(),
          `switch-${deviceId}`,
          data.lastPolledAt,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."MonitorNetworkDevice" ("_id", "version", "projectId", "monitorId", "networkDeviceId") VALUES ($1, 1, $2, $3, $4)`,
        [
          ObjectID.generate().toString(),
          projectId.toString(),
          data.monitorId,
          deviceId,
        ],
      );
    }

    // What the runner writes once a data migration has run.
    async function recordRun(name: string, executedAt: Date): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."DataMigrations" ("_id", "version", "name", "executed", "executedAt") VALUES ($1, 1, $2, true, $3)`,
        [ObjectID.generate().toString(), name, executedAt],
      );
    }

    async function stored(): Promise<Map<string, Date | null>> {
      const rows: Array<StoredMonitor> = (await database.query(
        `SELECT "_id", "firstMeasuredAt" FROM "${schema}"."Monitor"`,
      )) as Array<StoredMonitor>;

      return new Map<string, Date | null>(
        rows.map((row: StoredMonitor): [string, Date | null] => {
          return [row._id, row.firstMeasuredAt];
        }),
      );
    }

    test("gives each monitor measured before the backfill finished its creation, and leaves the rest as they are", async () => {
      await recordRun("BackfillMonitorFirstMeasuredAt", BACKFILL_FINISHED_AT);

      // A result got there before the backfill.
      const stampedDuringTheUpgrade: string = await insertMonitor({
        name: "stamped-during-the-upgrade",
        monitorType: MonitorType.Website,
        firstMeasuredAt: new Date(UPGRADE_AT.getTime() + 60 * 1000),
      });
      // Its first check came after the backfill: nothing had measured it.
      const firstCheckedLater: string = await insertMonitor({
        name: "first-checked-later",
        monitorType: MonitorType.Website,
        firstMeasuredAt: new Date("2026-11-27T00:00:00.000Z"),
      });
      const neverChecked: string = await insertMonitor({
        name: "never-checked",
        monitorType: MonitorType.Website,
      });
      // Measured by OneUptime itself, with no trace the backfill reads.
      const probeStatus: string = await insertMonitor({
        name: "probe-status",
        monitorType: MonitorType.ProbeStatus,
      });
      const probeStatusStampedLater: string = await insertMonitor({
        name: "probe-status-stamped-later",
        monitorType: MonitorType.ProbeStatus,
        firstMeasuredAt: new Date("2026-11-21T00:00:00.000Z"),
      });
      const polledDevice: string = await insertMonitor({
        name: "polled-device",
        monitorType: MonitorType.NetworkDevice,
        firstMeasuredAt: new Date("2026-11-20T11:00:00.000Z"),
      });
      await linkDevice({
        monitorId: polledDevice,
        lastPolledAt: new Date("2026-11-20T10:55:00.000Z"),
      });
      const unpolledDevice: string = await insertMonitor({
        name: "unpolled-device",
        monitorType: MonitorType.NetworkDevice,
      });
      await linkDevice({ monitorId: unpolledDevice, lastPolledAt: null });
      // Left as they are.
      const manual: string = await insertMonitor({
        name: "manual",
        monitorType: MonitorType.Manual,
        firstMeasuredAt: new Date(UPGRADE_AT.getTime() + 60 * 1000),
      });
      const backfilled: string = await insertMonitor({
        name: "backfilled",
        monitorType: MonitorType.Website,
        firstMeasuredAt: CREATED_AT,
      });
      const createdAfter: Date = new Date("2026-11-21T08:00:00.000Z");
      const createdAfterTheBackfill: string = await insertMonitor({
        name: "created-after-the-backfill",
        monitorType: MonitorType.ProbeStatus,
        createdAt: createdAfter,
        firstMeasuredAt: new Date(createdAfter.getTime() + 60 * 1000),
      });

      await new BackfillMonitorFirstMeasuredAtForUptimeHistory().migrate();

      const rows: Map<string, Date | null> = await stored();

      for (const id of [
        stampedDuringTheUpgrade,
        probeStatus,
        probeStatusStampedLater,
        polledDevice,
        backfilled,
      ]) {
        expect({ id, firstMeasuredAt: rows.get(id)?.toISOString() }).toEqual({
          id,
          firstMeasuredAt: CREATED_AT.toISOString(),
        });
      }

      expect(rows.get(firstCheckedLater)?.toISOString()).toBe(
        "2026-11-27T00:00:00.000Z",
      );
      expect(rows.get(neverChecked)).toBeNull();
      expect(rows.get(unpolledDevice)).toBeNull();
      expect(rows.get(manual)?.toISOString()).toBe(
        new Date(UPGRADE_AT.getTime() + 60 * 1000).toISOString(),
      );
      expect(rows.get(createdAfterTheBackfill)?.toISOString()).toBe(
        new Date(createdAfter.getTime() + 60 * 1000).toISOString(),
      );

      // Run again, nothing changes.
      await new BackfillMonitorFirstMeasuredAtForUptimeHistory().migrate();
      const again: Map<string, Date | null> = await stored();

      for (const [id, firstMeasuredAt] of Array.from(rows.entries())) {
        expect(again.get(id)?.toISOString()).toBe(
          firstMeasuredAt?.toISOString(),
        );
      }
    }, 60000);

    test("without the backfill's row it changes nothing", async () => {
      const stamped: string = await insertMonitor({
        name: "stamped",
        monitorType: MonitorType.Website,
        firstMeasuredAt: new Date(UPGRADE_AT.getTime() + 60 * 1000),
      });
      const probeStatus: string = await insertMonitor({
        name: "probe-status",
        monitorType: MonitorType.ProbeStatus,
      });

      await new BackfillMonitorFirstMeasuredAtForUptimeHistory().migrate();

      const rows: Map<string, Date | null> = await stored();

      expect(rows.get(stamped)?.toISOString()).toBe(
        new Date(UPGRADE_AT.getTime() + 60 * 1000).toISOString(),
      );
      expect(rows.get(probeStatus)).toBeNull();
    });

    test("the whole upgrade, in order: a monitor checked all along keeps its history; one nothing ever checked has none", async () => {
      /*
       * Two monitors created on 1 March 2025, Operational ever since: one
       * a probe checks (its result came back right after the upgrade and
       * stamped it, before the backfill), one no probe ever reached.
       */
      const checked: string = await insertMonitor({
        name: "checked",
        monitorType: MonitorType.Website,
        firstMeasuredAt: new Date(UPGRADE_AT.getTime() + 30 * 1000),
      });
      await database.query(
        `INSERT INTO "${schema}"."MonitorProbe" ("_id", "version", "projectId", "monitorId", "probeId", "isEnabled", "lastMonitoringLog") VALUES ($1, 1, $2, $3, $4, true, $5::jsonb)`,
        [
          ObjectID.generate().toString(),
          projectId.toString(),
          checked,
          ObjectID.generate().toString(),
          JSON.stringify({ monitoredAt: UPGRADE_AT.toISOString() }),
        ],
      );
      const neverChecked: string = await insertMonitor({
        name: "never-checked",
        monitorType: MonitorType.Website,
      });

      for (const monitorId of [checked, neverChecked]) {
        await database.query(
          `INSERT INTO "${schema}"."MonitorStatusTimeline" ("_id", "version", "projectId", "monitorId", "monitorStatusId", "startsAt") VALUES ($1, 1, $2, $3, $4, $5)`,
          [
            ObjectID.generate().toString(),
            projectId.toString(),
            monitorId,
            operationalId.toString(),
            CREATED_AT,
          ],
        );
      }

      const days: () => Promise<
        Map<string, Array<UptimeDayBucket>>
      > = async (): Promise<Map<string, Array<UptimeDayBucket>>> => {
        const aggregate: UptimeDailyAggregate =
          await MonitorStatusTimelineService.getDailyUptimeAggregate({
            monitorIds: [new ObjectID(checked), new ObjectID(neverChecked)],
            startDate: new Date("2026-10-01T00:00:00.000Z"),
            endDate: new Date("2026-10-31T00:00:00.000Z"),
            timezone: "UTC",
          });

        return new Map<string, Array<UptimeDayBucket>>(
          aggregate.monitors.map(
            (monitor: {
              monitorId: ObjectID;
              buckets: Array<UptimeDayBucket>;
            }): [string, Array<UptimeDayBucket>] => {
              return [monitor.monitorId.toString(), monitor.buckets];
            },
          ),
        );
      };

      const coveredDays: (buckets: Array<UptimeDayBucket>) => number = (
        buckets: Array<UptimeDayBucket>,
      ): number => {
        return buckets.filter((bucket: UptimeDayBucket): boolean => {
          return bucket.coveredSeconds > 0;
        }).length;
      };

      // Mid-upgrade: nothing is cut yet, whatever the column holds.
      const midUpgrade: Map<string, Array<UptimeDayBucket>> = await days();
      expect(coveredDays(midUpgrade.get(checked)!)).toBe(30);
      expect(coveredDays(midUpgrade.get(neverChecked)!)).toBe(30);

      // The backfill, then the runner's row for it, then this migration and its row.
      await new BackfillMonitorFirstMeasuredAt().migrate();
      await recordRun("BackfillMonitorFirstMeasuredAt", BACKFILL_FINISHED_AT);
      await new BackfillMonitorFirstMeasuredAtForUptimeHistory().migrate();
      await recordRun(
        FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME,
        new Date(BACKFILL_FINISHED_AT.getTime() + 60 * 1000),
      );

      const rows: Map<string, Date | null> = await stored();
      expect(rows.get(checked)?.toISOString()).toBe(CREATED_AT.toISOString());
      expect(rows.get(neverChecked)).toBeNull();

      // October, long before the upgrade: the one checked all along was up; the other has no data.
      const upgraded: Map<string, Array<UptimeDayBucket>> = await days();
      expect(coveredDays(upgraded.get(checked)!)).toBe(30);
      expect(coveredDays(upgraded.get(neverChecked)!)).toBe(0);
    }, 60000);
  },
);
