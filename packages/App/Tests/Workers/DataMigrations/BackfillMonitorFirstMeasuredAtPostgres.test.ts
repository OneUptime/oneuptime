import BackfillMonitorFirstMeasuredAt from "../../../FeatureSet/Workers/DataMigrations/BackfillMonitorFirstMeasuredAt";
import Entities from "Common/Models/DatabaseModels/Index";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import DatabaseService from "Common/Server/Services/DatabaseService";
import logger from "Common/Server/Utils/Logger";
import MonitorFirstMeasured from "Common/Server/Utils/Monitor/MonitorFirstMeasured";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import { DataSource, QueryRunner } from "Common/node_modules/typeorm";

/*
 * WHEN SOMETHING FIRST MEASURED A MONITOR, ON A MIGRATED POSTGRES (#8899).
 *
 * Monitor.firstMeasuredAt, added by 1809180900000-AddMonitorFirstMeasuredAt,
 * is empty while nothing has measured a monitor, and the lists and status
 * pages say such a monitor is waiting for its first check. Only Postgres can
 * show:
 *
 *  - BackfillMonitorFirstMeasuredAt stamps, with its creation time, every
 *    monitor that left a trace of being measured - a probe's result on one
 *    of its probe rows, a heartbeat, an email, a server report, a queued
 *    evaluation, a second event on its status timeline - and every manual
 *    monitor, and leaves the rest empty; run again, it changes nothing, and a
 *    monitor its own result stamped first keeps that time;
 *  - the stamp a first result writes (MonitorFirstMeasured) lands once: a
 *    second first result, read before the first was written, keeps the first
 *    time; and a row another writer holds is skipped at once, never waited
 *    for, and stamped by the next result;
 *  - a manual monitor's stamp on create waits for its row.
 *
 * Opt in with RUN_POSTGRES_MONITOR_FIRST_MEASURED_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database, right after its drift check. The Monitor,
 * MonitorProbe and MonitorStatusTimeline tables' STRUCTURE is cloned into a
 * unique schema (search_path holds only that schema), dropped afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * MONITOR_FIRST_MEASURED_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * MONITOR_FIRST_MEASURED_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_MONITOR_FIRST_MEASURED_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

interface StoredMonitor {
  _id: string;
  firstMeasuredAt: Date | null;
  createdAt: Date;
}

interface MonitorSeed {
  name: string;
  monitorType: MonitorType;
  createdAt: Date;
  firstMeasuredAt?: Date | undefined;
  serverMonitorRequestReceivedAt?: Date | undefined;
  incomingMonitorRequest?: object | undefined;
  incomingRequestWithSecretAt?: Date | undefined;
  incomingEmailMonitorLastEmailReceivedAt?: Date | undefined;
  telemetryMonitorLastMonitorAt?: Date | undefined;
  deletedAt?: Date | undefined;
}

describePostgres("when something first measured a monitor (Postgres)", () => {
  const schema: string = `monitor_first_measured_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const statusId: ObjectID = ObjectID.generate();

  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["MONITOR_FIRST_MEASURED_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["MONITOR_FIRST_MEASURED_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MONITOR_FIRST_MEASURED_TEST_DATABASE_NAME"] ||
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

    for (const table of ["Monitor", "MonitorProbe", "MonitorStatusTimeline"]) {
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

    jest
      .spyOn(DatabaseService.prototype, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);

    for (const table of ["MonitorStatusTimeline", "MonitorProbe", "Monitor"]) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insertMonitor(seed: MonitorSeed): Promise<string> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "createdAt", "firstMeasuredAt", "serverMonitorRequestReceivedAt", "incomingMonitorRequest", "incomingRequestWithSecretAt", "incomingEmailMonitorLastEmailReceivedAt", "telemetryMonitorLastMonitorAt", "deletedAt") VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)`,
      [
        id.toString(),
        projectId.toString(),
        seed.name,
        `${seed.name}-${id.toString()}`,
        seed.monitorType,
        // Foreign keys are not cloned: any status id stands in.
        statusId.toString(),
        seed.createdAt,
        seed.firstMeasuredAt || null,
        seed.serverMonitorRequestReceivedAt || null,
        seed.incomingMonitorRequest
          ? JSON.stringify(seed.incomingMonitorRequest)
          : null,
        seed.incomingRequestWithSecretAt || null,
        seed.incomingEmailMonitorLastEmailReceivedAt || null,
        seed.telemetryMonitorLastMonitorAt || null,
        seed.deletedAt || null,
      ],
    );

    return id.toString();
  }

  async function insertProbeRow(
    monitorId: string,
    lastMonitoringLog: object | null,
  ): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."MonitorProbe" ("_id", "version", "projectId", "monitorId", "probeId", "isEnabled", "lastMonitoringLog") VALUES ($1, 1, $2, $3, $4, true, $5::jsonb)`,
      [
        ObjectID.generate().toString(),
        projectId.toString(),
        monitorId,
        ObjectID.generate().toString(),
        lastMonitoringLog === null ? null : JSON.stringify(lastMonitoringLog),
      ],
    );
  }

  async function insertStatusEvent(
    monitorId: string,
    startsAt: Date,
  ): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."MonitorStatusTimeline" ("_id", "version", "projectId", "monitorId", "monitorStatusId", "startsAt") VALUES ($1, 1, $2, $3, $4, $5)`,
      [
        ObjectID.generate().toString(),
        projectId.toString(),
        monitorId,
        statusId.toString(),
        startsAt,
      ],
    );
  }

  async function stored(): Promise<Map<string, StoredMonitor>> {
    const rows: Array<StoredMonitor> = (await database.query(
      `SELECT "_id", "firstMeasuredAt", "createdAt" FROM "${schema}"."Monitor"`,
    )) as Array<StoredMonitor>;

    return new Map<string, StoredMonitor>(
      rows.map((row: StoredMonitor): [string, StoredMonitor] => {
        return [row._id, row];
      }),
    );
  }

  const CREATED_AT: Date = new Date("2025-03-01T10:00:00.000Z");

  test("the column the schema migration adds is a nullable timestamp, as the model says", async () => {
    const columns: Array<{
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }> = await database.query(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Monitor' AND column_name = 'firstMeasuredAt'`,
    );

    expect(columns).toEqual([
      {
        data_type: "timestamp with time zone",
        is_nullable: "YES",
        column_default: null,
      },
    ]);
  });

  test("stamps every monitor that left a trace of being measured, with its creation time, and leaves the rest", async () => {
    const never: string = await insertMonitor({
      name: "never",
      monitorType: MonitorType.Website,
      createdAt: CREATED_AT,
    });
    const probed: string = await insertMonitor({
      name: "probed",
      monitorType: MonitorType.Website,
      createdAt: CREATED_AT,
    });
    const emptyProbeLog: string = await insertMonitor({
      name: "empty-probe-log",
      monitorType: MonitorType.Ping,
      createdAt: CREATED_AT,
    });
    const manual: string = await insertMonitor({
      name: "manual",
      monitorType: MonitorType.Manual,
      createdAt: CREATED_AT,
    });
    const server: string = await insertMonitor({
      name: "server",
      monitorType: MonitorType.Server,
      createdAt: CREATED_AT,
      serverMonitorRequestReceivedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const heartbeat: string = await insertMonitor({
      name: "heartbeat",
      monitorType: MonitorType.IncomingRequest,
      createdAt: CREATED_AT,
      incomingMonitorRequest: {
        incomingRequestReceivedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const secretChecked: string = await insertMonitor({
      name: "secret-checked",
      monitorType: MonitorType.IncomingRequest,
      createdAt: CREATED_AT,
      incomingRequestWithSecretAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const email: string = await insertMonitor({
      name: "email",
      monitorType: MonitorType.IncomingEmail,
      createdAt: CREATED_AT,
      incomingEmailMonitorLastEmailReceivedAt: new Date(
        "2026-01-01T00:00:00.000Z",
      ),
    });
    const telemetry: string = await insertMonitor({
      name: "telemetry",
      monitorType: MonitorType.Logs,
      createdAt: CREATED_AT,
      telemetryMonitorLastMonitorAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const statusChanged: string = await insertMonitor({
      name: "status-changed",
      monitorType: MonitorType.NetworkDevice,
      createdAt: CREATED_AT,
    });
    const oneStatusEvent: string = await insertMonitor({
      name: "one-status-event",
      monitorType: MonitorType.ProbeStatus,
      createdAt: CREATED_AT,
    });
    const deleted: string = await insertMonitor({
      name: "deleted",
      monitorType: MonitorType.Server,
      createdAt: CREATED_AT,
      serverMonitorRequestReceivedAt: new Date("2026-01-01T00:00:00.000Z"),
      deletedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    const alreadyStamped: string = await insertMonitor({
      name: "already",
      monitorType: MonitorType.Website,
      createdAt: CREATED_AT,
      firstMeasuredAt: new Date("2026-03-03T03:03:03.000Z"),
    });

    await insertProbeRow(probed, {
      step: { monitoredAt: "2026-01-01T00:00:00.000Z", isOnline: true },
    });
    await insertProbeRow(emptyProbeLog, {});
    await insertProbeRow(never, null);
    await insertStatusEvent(never, CREATED_AT);
    await insertStatusEvent(statusChanged, CREATED_AT);
    await insertStatusEvent(
      statusChanged,
      new Date("2025-04-01T00:00:00.000Z"),
    );
    await insertStatusEvent(oneStatusEvent, CREATED_AT);

    await new BackfillMonitorFirstMeasuredAt().migrate();

    const rows: Map<string, StoredMonitor> = await stored();

    for (const id of [
      probed,
      manual,
      server,
      heartbeat,
      secretChecked,
      email,
      telemetry,
      statusChanged,
      deleted,
    ]) {
      expect({
        name: id,
        firstMeasuredAt: rows.get(id)!.firstMeasuredAt?.toISOString(),
      }).toEqual({ name: id, firstMeasuredAt: CREATED_AT.toISOString() });
    }

    for (const id of [never, emptyProbeLog, oneStatusEvent]) {
      expect({ name: id, firstMeasuredAt: rows.get(id)!.firstMeasuredAt }).toEqual(
        { name: id, firstMeasuredAt: null },
      );
    }

    expect(rows.get(alreadyStamped)!.firstMeasuredAt?.toISOString()).toBe(
      "2026-03-03T03:03:03.000Z",
    );

    // Run again, nothing changes.
    const before: Map<string, StoredMonitor> = await stored();
    await new BackfillMonitorFirstMeasuredAt().migrate();
    const after: Map<string, StoredMonitor> = await stored();

    for (const [id, row] of Array.from(before.entries())) {
      expect(after.get(id)!.firstMeasuredAt?.toISOString()).toBe(
        row.firstMeasuredAt?.toISOString(),
      );
    }
  }, 60000);

  test("pages through more monitors than a page holds", async () => {
    const ids: Array<string> = [];

    for (let index: number = 0; index < 1203; index++) {
      ids.push(
        await insertMonitor({
          name: `manual-${index}`,
          monitorType: MonitorType.Manual,
          createdAt: CREATED_AT,
        }),
      );
    }

    await new BackfillMonitorFirstMeasuredAt().migrate();

    const rows: Map<string, StoredMonitor> = await stored();

    expect(
      ids.filter((id: string): boolean => {
        return rows.get(id)!.firstMeasuredAt === null;
      }),
    ).toEqual([]);
  }, 120000);

  test("a first result stamps the monitor once: one read before it keeps its time", async () => {
    const id: string = await insertMonitor({
      name: "new",
      monitorType: MonitorType.Website,
      createdAt: CREATED_AT,
    });
    // Two results read the monitor before either was written.
    const readByBoth: Monitor = new Monitor();
    readByBoth.id = new ObjectID(id);
    (readByBoth as unknown as Record<string, unknown>)["firstMeasuredAt"] =
      null;

    expect(
      await MonitorFirstMeasured.stampIfFirst({
        monitor: readByBoth,
        dataToProcess: {} as ProbeMonitorResponse,
      }),
    ).toBe(true);

    const first: Date = (await stored()).get(id)!.firstMeasuredAt!;

    expect(first).toBeInstanceOf(Date);

    expect(
      await MonitorFirstMeasured.stampIfFirst({
        monitor: readByBoth,
        dataToProcess: {} as ProbeMonitorResponse,
      }),
    ).toBe(false);
    expect((await stored()).get(id)!.firstMeasuredAt!.getTime()).toBe(
      first.getTime(),
    );
  });

  test("a row another writer holds is skipped at once, and the next result stamps it", async () => {
    const id: string = await insertMonitor({
      name: "held",
      monitorType: MonitorType.Website,
      createdAt: CREATED_AT,
    });
    const monitor: Monitor = new Monitor();
    monitor.id = new ObjectID(id);
    (monitor as unknown as Record<string, unknown>)["firstMeasuredAt"] = null;

    const holder: QueryRunner = database.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query(
      `SELECT "_id" FROM "${schema}"."Monitor" WHERE "_id" = $1 FOR UPDATE`,
      [id],
    );

    try {
      const startedAt: number = Date.now();

      expect(
        await MonitorFirstMeasured.stampIfFirst({
          monitor: monitor,
          dataToProcess: {} as ProbeMonitorResponse,
        }),
      ).toBe(false);
      // Not waited for: well inside the lock timeout.
      expect(Date.now() - startedAt).toBeLessThan(LOCK_TIMEOUT_MS / 2);
    } finally {
      await holder.rollbackTransaction();
      await holder.release();
    }

    expect((await stored()).get(id)!.firstMeasuredAt).toBeNull();

    expect(
      await MonitorFirstMeasured.stampIfFirst({
        monitor: monitor,
        dataToProcess: {} as ProbeMonitorResponse,
      }),
    ).toBe(true);
    expect((await stored()).get(id)!.firstMeasuredAt).toBeInstanceOf(Date);
  }, 30000);

  test("a manual monitor is stamped on create with its creation time, once", async () => {
    const id: string = await insertMonitor({
      name: "manual",
      monitorType: MonitorType.Manual,
      createdAt: CREATED_AT,
    });

    await MonitorFirstMeasured.stampManualMonitorOnCreate({
      monitorId: new ObjectID(id),
      monitorType: MonitorType.Manual,
      createdAt: CREATED_AT,
    });
    await MonitorFirstMeasured.stampManualMonitorOnCreate({
      monitorId: new ObjectID(id),
      monitorType: MonitorType.Manual,
      createdAt: new Date("2026-06-06T06:06:06.000Z"),
    });

    expect((await stored()).get(id)!.firstMeasuredAt?.toISOString()).toBe(
      CREATED_AT.toISOString(),
    );
  });
});
