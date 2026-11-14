/*
 * A probe's result stored as its last, and the monitor's other probes read
 * for agreement - by Postgres itself (MonitorProbeLastResults).
 *
 * The statement is the whole of what a probe result does with
 * MonitorProbe.lastMonitoringLog, so it is run here against the migrated
 * table, with several probes:
 *
 *   - the reporting probe's step is merged into its column, its other steps
 *     kept as they were, an empty column started;
 *   - no other probe's column is touched, and a probe that is not the
 *     monitor's stores nothing;
 *   - of the others, only the step judged is read, and only from an
 *     enabled, connected probe; a deleted probe or monitor probe is not one
 *     of the monitor's;
 *   - the write leaves every indexed column alone, so it can be HOT.
 *
 * Opt in with RUN_POSTGRES_MONITOR_RESULT_PATH_TESTS=true against a
 * Postgres migrated to head (.github/workflows/postgres-schema-drift.yaml
 * runs it, with MonitorResultStatementsPostgres.test.ts):
 *
 *   RUN_POSTGRES_MONITOR_RESULT_PATH_TESTS=true \
 *   MONITOR_RESULT_PATH_TEST_DATABASE_HOST=127.0.0.1 \
 *   MONITOR_RESULT_PATH_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/Monitor/MonitorProbeLastResultsPostgres.test.ts
 *
 * The MonitorProbe and Probe tables' STRUCTURE is cloned into a unique
 * schema, dropped afterwards; every row is synthetic.
 */

import Entities from "../../../../Models/DatabaseModels/Index";
import { ProbeConnectionStatus } from "../../../../Models/DatabaseModels/Probe";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import MonitorProbeLastResults, {
  MonitorProbeOfResult,
  MonitorProbesOfResult,
} from "../../../../Server/Utils/Monitor/MonitorProbeLastResults";
import { JSONObject } from "../../../../Types/JSON";
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

const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_MONITOR_RESULT_PATH_TESTS"] === "true"
    ? describe
    : describe.skip;

const DASHES: RegExp = /-/g;

interface ProbeFixture {
  probeId: ObjectID;
  monitorProbeId: ObjectID;
}

describePostgres("MonitorProbeLastResults against Postgres", () => {
  const schema: string = `monitor_probe_last_results_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;

  let database: DataSource;

  const projectId: ObjectID = ObjectID.generate();
  const stepA: string = ObjectID.generate().toString();
  const stepB: string = ObjectID.generate().toString();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["MONITOR_RESULT_PATH_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["MONITOR_RESULT_PATH_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MONITOR_RESULT_PATH_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of ["MonitorProbe", "Probe"]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // A fixture names only what the statement reads; keys stay NOT NULL.
    for (const table of ["MonitorProbe", "Probe"]) {
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema, table],
      );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function check(name: string): JSONObject {
    return {
      isOnline: true,
      responseTimeInMs: 120,
      responseBody: `<html>${name}</html>`,
      responseHeaders: { "content-type": "text/html" },
      monitoredAt: "2026-11-14T10:00:00.000Z",
      probeName: name,
    };
  }

  async function addProbe(data: {
    monitorId: ObjectID;
    isEnabled?: boolean;
    connectionStatus?: ProbeConnectionStatus | null;
    lastMonitoringLog?: JSONObject | null;
    isProbeDeleted?: boolean;
    isMonitorProbeDeleted?: boolean;
    createdAt?: string;
  }): Promise<ProbeFixture> {
    const fixture: ProbeFixture = {
      probeId: ObjectID.generate(),
      monitorProbeId: ObjectID.generate(),
    };

    await database.query(
      `INSERT INTO "Probe" ("_id", "projectId", "name", "slug", "key", "connectionStatus", "deletedAt")
       VALUES ($1::uuid, $2, $3, $1::text, $4, $5, $6)`,
      [
        fixture.probeId.toString(),
        projectId.toString(),
        `Probe ${fixture.probeId.toString().slice(0, 8)}`,
        ObjectID.generate().toString(),
        data.connectionStatus === undefined
          ? ProbeConnectionStatus.Connected
          : data.connectionStatus,
        data.isProbeDeleted ? new Date() : null,
      ],
    );

    await database.query(
      `INSERT INTO "MonitorProbe" ("_id", "projectId", "monitorId", "probeId", "isEnabled", "lastMonitoringLog", "deletedAt", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, COALESCE($8::timestamptz, now()), now() - interval '1 day', 1)`,
      [
        fixture.monitorProbeId.toString(),
        projectId.toString(),
        data.monitorId.toString(),
        fixture.probeId.toString(),
        data.isEnabled === undefined ? true : data.isEnabled,
        data.lastMonitoringLog === undefined || data.lastMonitoringLog === null
          ? null
          : JSON.stringify(data.lastMonitoringLog),
        data.isMonitorProbeDeleted ? new Date() : null,
        data.createdAt || null,
      ],
    );

    return fixture;
  }

  async function stored(fixture: ProbeFixture): Promise<{
    lastMonitoringLog: JSONObject | null;
    updatedAt: Date;
  }> {
    const rows: Array<{
      lastMonitoringLog: JSONObject | null;
      updatedAt: Date;
    }> = await database.query(
      `SELECT "lastMonitoringLog", "updatedAt" FROM "MonitorProbe" WHERE "_id" = $1`,
      [fixture.monitorProbeId.toString()],
    );

    return rows[0]!;
  }

  function byProbe(
    read: MonitorProbesOfResult | Array<MonitorProbeOfResult>,
    fixture: ProbeFixture,
  ): MonitorProbeOfResult | undefined {
    const probes: Array<MonitorProbeOfResult> = Array.isArray(read)
      ? read
      : read.probes;

    return probes.find((probe: MonitorProbeOfResult) => {
      return probe.probeId.toString() === fixture.probeId.toString();
    });
  }

  test("the reporting probe's step is merged in, its other steps kept as they were", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const reporting: ProbeFixture = await addProbe({
      monitorId,
      lastMonitoringLog: {
        [stepA]: check("old A"),
        [stepB]: check("old B"),
      },
    });

    const read: MonitorProbesOfResult =
      await MonitorProbeLastResults.storeResultAndReadProbes({
        monitorId,
        reportingProbeId: reporting.probeId,
        reportedStepId: stepA,
        judgedStepId: stepA,
        result: check("new A"),
      });

    expect(read.isResultStored).toBe(true);

    const after: { lastMonitoringLog: JSONObject | null; updatedAt: Date } =
      await stored(reporting);

    expect(after.lastMonitoringLog).toEqual({
      [stepA]: check("new A"),
      [stepB]: check("old B"),
    });
    // Stamped as written, as the ORM's write did.
    expect(after.updatedAt.getTime()).toBeGreaterThan(
      Date.now() - 60 * 60 * 1000,
    );
  });

  test("an empty column is started with the step", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const reporting: ProbeFixture = await addProbe({ monitorId });

    await MonitorProbeLastResults.storeResultAndReadProbes({
      monitorId,
      reportingProbeId: reporting.probeId,
      reportedStepId: stepB,
      judgedStepId: stepB,
      result: check("first"),
    });

    expect((await stored(reporting)).lastMonitoringLog).toEqual({
      [stepB]: check("first"),
    });
  });

  test("the reporting probe's own column is never read back", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const reporting: ProbeFixture = await addProbe({
      monitorId,
      lastMonitoringLog: { [stepA]: check("old") },
    });

    const read: MonitorProbesOfResult =
      await MonitorProbeLastResults.storeResultAndReadProbes({
        monitorId,
        reportingProbeId: reporting.probeId,
        reportedStepId: stepA,
        judgedStepId: stepA,
        result: check("new"),
      });

    expect(byProbe(read, reporting)?.resultForJudgedStep).toBeUndefined();
  });

  test("of the other probes only the step judged is read, and only where agreement reads it", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const reporting: ProbeFixture = await addProbe({ monitorId });
    const peer: ProbeFixture = await addProbe({
      monitorId,
      lastMonitoringLog: { [stepA]: check("peer A"), [stepB]: check("peer B") },
    });
    const disabled: ProbeFixture = await addProbe({
      monitorId,
      isEnabled: false,
      lastMonitoringLog: { [stepA]: check("disabled A") },
    });
    const disconnected: ProbeFixture = await addProbe({
      monitorId,
      connectionStatus: ProbeConnectionStatus.Disconnected,
      lastMonitoringLog: { [stepA]: check("disconnected A") },
    });
    const neverReported: ProbeFixture = await addProbe({ monitorId });

    const read: MonitorProbesOfResult =
      await MonitorProbeLastResults.storeResultAndReadProbes({
        monitorId,
        reportingProbeId: reporting.probeId,
        reportedStepId: stepA,
        judgedStepId: stepA,
        result: check("reporting A"),
      });

    expect(read.probes).toHaveLength(5);
    expect(byProbe(read, peer)?.resultForJudgedStep).toEqual(check("peer A"));
    expect(byProbe(read, disabled)?.resultForJudgedStep).toBeUndefined();
    expect(byProbe(read, disabled)?.isEnabled).toBe(false);
    expect(byProbe(read, disconnected)?.resultForJudgedStep).toBeUndefined();
    expect(byProbe(read, disconnected)?.probeConnectionStatus).toBe(
      ProbeConnectionStatus.Disconnected,
    );
    expect(byProbe(read, neverReported)?.resultForJudgedStep).toBeUndefined();
    expect(byProbe(read, peer)?.probeName).toMatch(/^Probe /);
    expect(byProbe(read, peer)?.monitorProbeId.toString()).toBe(
      peer.monitorProbeId.toString(),
    );

    // No other probe's column was written.
    expect((await stored(peer)).lastMonitoringLog).toEqual({
      [stepA]: check("peer A"),
      [stepB]: check("peer B"),
    });
    expect((await stored(disabled)).lastMonitoringLog).toEqual({
      [stepA]: check("disabled A"),
    });
  });

  test("a step judged that is not the step reported is read from the reporting probe too", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const reporting: ProbeFixture = await addProbe({
      monitorId,
      lastMonitoringLog: { [stepA]: check("reporting's A") },
    });

    const read: MonitorProbesOfResult =
      await MonitorProbeLastResults.storeResultAndReadProbes({
        monitorId,
        reportingProbeId: reporting.probeId,
        reportedStepId: stepB,
        judgedStepId: stepA,
        result: check("reporting's B"),
      });

    // As it stood before this result, which stores step B.
    expect(byProbe(read, reporting)?.resultForJudgedStep).toEqual(
      check("reporting's A"),
    );
    expect((await stored(reporting)).lastMonitoringLog).toEqual({
      [stepA]: check("reporting's A"),
      [stepB]: check("reporting's B"),
    });
  });

  test("a probe that is not the monitor's stores nothing", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const otherMonitorId: ObjectID = ObjectID.generate();
    const peer: ProbeFixture = await addProbe({
      monitorId,
      lastMonitoringLog: { [stepA]: check("peer") },
    });
    const elsewhere: ProbeFixture = await addProbe({
      monitorId: otherMonitorId,
      lastMonitoringLog: { [stepA]: check("elsewhere") },
    });

    const read: MonitorProbesOfResult =
      await MonitorProbeLastResults.storeResultAndReadProbes({
        monitorId,
        reportingProbeId: elsewhere.probeId,
        reportedStepId: stepA,
        judgedStepId: stepA,
        result: check("intruder"),
      });

    expect(read.isResultStored).toBe(false);
    expect(byProbe(read, elsewhere)).toBeUndefined();
    expect((await stored(elsewhere)).lastMonitoringLog).toEqual({
      [stepA]: check("elsewhere"),
    });
    expect((await stored(peer)).lastMonitoringLog).toEqual({
      [stepA]: check("peer"),
    });
  });

  test("a deleted monitor probe is not the monitor's, and a deleted probe has no name or status", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const removed: ProbeFixture = await addProbe({
      monitorId,
      isMonitorProbeDeleted: true,
      lastMonitoringLog: { [stepA]: check("removed") },
    });
    const probeDeleted: ProbeFixture = await addProbe({
      monitorId,
      isProbeDeleted: true,
      lastMonitoringLog: { [stepA]: check("probe deleted") },
    });

    const read: MonitorProbesOfResult =
      await MonitorProbeLastResults.storeResultAndReadProbes({
        monitorId,
        reportingProbeId: removed.probeId,
        reportedStepId: stepA,
        judgedStepId: stepA,
        result: check("from a removed assignment"),
      });

    expect(read.isResultStored).toBe(false);
    expect(byProbe(read, removed)).toBeUndefined();
    expect((await stored(removed)).lastMonitoringLog).toEqual({
      [stepA]: check("removed"),
    });

    const deletedProbe: MonitorProbeOfResult | undefined = byProbe(
      read,
      probeDeleted,
    );
    expect(deletedProbe?.probeName).toBeUndefined();
    expect(deletedProbe?.probeConnectionStatus).toBeUndefined();
    expect(deletedProbe?.resultForJudgedStep).toBeUndefined();
  });

  test("with no result (a trap) the probes are only read", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const reporting: ProbeFixture = await addProbe({
      monitorId,
      lastMonitoringLog: { [stepA]: check("kept") },
    });
    const peer: ProbeFixture = await addProbe({
      monitorId,
      lastMonitoringLog: { [stepA]: check("peer") },
    });

    const before: { updatedAt: Date } = await stored(reporting);

    const read: MonitorProbesOfResult =
      await MonitorProbeLastResults.storeResultAndReadProbes({
        monitorId,
        reportingProbeId: reporting.probeId,
        reportedStepId: stepA,
        judgedStepId: undefined,
        result: undefined,
      });

    expect(read.isResultStored).toBe(false);
    expect(read.probes).toHaveLength(2);
    // Nothing is judged, so nothing is read.
    expect(byProbe(read, peer)?.resultForJudgedStep).toBeUndefined();
    expect((await stored(reporting)).lastMonitoringLog).toEqual({
      [stepA]: check("kept"),
    });
    expect((await stored(reporting)).updatedAt).toEqual(before.updatedAt);
  });

  test("the probes come in the order the ORM read them in: newest first", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const oldest: ProbeFixture = await addProbe({
      monitorId,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const newest: ProbeFixture = await addProbe({
      monitorId,
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    const middle: ProbeFixture = await addProbe({
      monitorId,
      createdAt: "2026-02-01T00:00:00.000Z",
    });

    const read: MonitorProbesOfResult =
      await MonitorProbeLastResults.storeResultAndReadProbes({
        monitorId,
        reportingProbeId: oldest.probeId,
        reportedStepId: stepA,
        judgedStepId: stepA,
        result: check("x"),
      });

    expect(
      read.probes.map((probe: MonitorProbeOfResult) => {
        return probe.probeId.toString();
      }),
    ).toEqual([
      newest.probeId.toString(),
      middle.probeId.toString(),
      oldest.probeId.toString(),
    ]);
  });

  test("readProbes reads the step judged from every enabled, connected probe", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const first: ProbeFixture = await addProbe({
      monitorId,
      lastMonitoringLog: { [stepA]: check("first") },
    });
    const second: ProbeFixture = await addProbe({
      monitorId,
      lastMonitoringLog: { [stepA]: check("second") },
    });
    const disabled: ProbeFixture = await addProbe({
      monitorId,
      isEnabled: false,
      lastMonitoringLog: { [stepA]: check("disabled") },
    });

    const probes: Array<MonitorProbeOfResult> =
      await MonitorProbeLastResults.readProbes({
        monitorId,
        judgedStepId: stepA,
      });

    expect(byProbe(probes, first)?.resultForJudgedStep).toEqual(check("first"));
    expect(byProbe(probes, second)?.resultForJudgedStep).toEqual(
      check("second"),
    );
    expect(byProbe(probes, disabled)?.resultForJudgedStep).toBeUndefined();
  });

  test("the write leaves every indexed column of MonitorProbe alone, so it can be HOT", async () => {
    const indexedColumns: Array<{ attname: string }> = await database.query(
      `SELECT DISTINCT a.attname
         FROM pg_index x
         JOIN pg_class t ON t.oid = x.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(x.indkey)
        WHERE n.nspname = 'public' AND t.relname = 'MonitorProbe'`,
    );

    const written: Array<string> = ["lastMonitoringLog", "updatedAt"];

    expect(
      indexedColumns
        .map((column: { attname: string }) => {
          return column.attname;
        })
        .filter((column: string) => {
          return written.includes(column);
        }),
    ).toEqual([]);
  });
});
