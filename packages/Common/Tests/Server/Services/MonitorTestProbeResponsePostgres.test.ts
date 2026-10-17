import Entities from "../../../Models/DatabaseModels/Index";
import { MonitorStepProbeResponse } from "../../../Models/DatabaseModels/MonitorProbe";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import MonitorTestService from "../../../Server/Services/MonitorTestService";
import logger from "../../../Server/Utils/Logger";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { DataSource } from "typeorm";

/*
 * A monitor test's result, written on a real Postgres: only the probe the
 * test was handed to writes it. MonitorTestService.mergeStepProbeResponse
 * keys its UPDATE on the test and the probe that reported (as it
 * authenticated to probe ingest), merges step after step into the same
 * jsonb, and says whether it wrote - which the probe ingest worker turns into
 * a refusal. A probe that learned another test's id - another project's -
 * writes nothing.
 *
 * Opt in with RUN_POSTGRES_MONITOR_TEST_PROBE_RESPONSE_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check (CI runs it in
 * .github/workflows/postgres-schema-drift.yaml). The MonitorTest table's
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema), dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from
 * MONITOR_TEST_PROBE_RESPONSE_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from MONITOR_TEST_PROBE_RESPONSE_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_MONITOR_TEST_PROBE_RESPONSE_TESTS"] === "true"
    ? describe
    : describe.skip;

const DASHES: RegExp = /-/g;

const TABLES: Array<string> = ["MonitorTest"];

interface TestRow {
  monitorStepProbeResponse: JSONObject | null;
  testedAt: Date | null;
  updatedAt: Date;
}

describePostgres("monitor test results on Postgres", () => {
  const schema: string = `monitor_test_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  // The probe the test was handed to, and one of another project.
  const probeId: ObjectID = ObjectID.generate();
  const otherProbeId: ObjectID = ObjectID.generate();

  const testId: ObjectID = ObjectID.generate();
  const otherProjectTestId: ObjectID = ObjectID.generate();

  const firstStepId: string = ObjectID.generate().toString();
  const secondStepId: string = ObjectID.generate().toString();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["MONITOR_TEST_PROBE_RESPONSE_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["MONITOR_TEST_PROBE_RESPONSE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MONITOR_TEST_PROBE_RESPONSE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
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
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const table of TABLES) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    await insertTest({ id: testId, projectId, probeId });
    await insertTest({
      id: otherProjectTestId,
      projectId: otherProjectId,
      probeId: otherProbeId,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insertTest(data: {
    id: ObjectID;
    projectId: ObjectID;
    probeId: ObjectID;
    deletedAt?: Date | undefined;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."MonitorTest"
         ("_id", "projectId", "monitorType", "probeId", "isInQueue", "version", "createdAt", "updatedAt", "deletedAt")
       VALUES ($1, $2, $3, $4, false, 1, now() - interval '1 minute', now() - interval '1 minute', $5)`,
      [
        data.id.toString(),
        data.projectId.toString(),
        MonitorType.Website,
        data.probeId.toString(),
        data.deletedAt || null,
      ],
    );
  }

  async function readTest(id: ObjectID): Promise<TestRow> {
    const rows: Array<TestRow> = await database.query(
      `SELECT "monitorStepProbeResponse", "testedAt", "updatedAt"
       FROM "${schema}"."MonitorTest" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0]!;
  }

  function stepResponse(
    stepId: string,
    failureCause: string,
  ): MonitorStepProbeResponse {
    return {
      [stepId]: {
        monitorStepId: stepId,
        isOnline: !failureCause,
        failureCause: failureCause,
      } as unknown as ProbeMonitorResponse,
    };
  }

  test("the probe the test was handed to writes its result", async () => {
    const written: boolean = await MonitorTestService.mergeStepProbeResponse({
      testId,
      probeId,
      monitorStepProbeResponse: stepResponse(firstStepId, ""),
    });

    expect(written).toBe(true);

    const row: TestRow = await readTest(testId);

    expect(Object.keys(row.monitorStepProbeResponse || {})).toEqual([
      firstStepId,
    ]);
    expect(row.testedAt).toBeInstanceOf(Date);
  });

  test("its steps merge into one result, step after step", async () => {
    await MonitorTestService.mergeStepProbeResponse({
      testId,
      probeId,
      monitorStepProbeResponse: stepResponse(firstStepId, ""),
    });

    await MonitorTestService.mergeStepProbeResponse({
      testId,
      probeId,
      monitorStepProbeResponse: stepResponse(secondStepId, "Timed out"),
    });

    const row: TestRow = await readTest(testId);

    expect(Object.keys(row.monitorStepProbeResponse || {}).sort()).toEqual(
      [firstStepId, secondStepId].sort(),
    );
    expect(
      (row.monitorStepProbeResponse![secondStepId] as JSONObject)[
        "failureCause"
      ],
    ).toBe("Timed out");
  });

  test("another probe - of another project - writes nothing on it", async () => {
    const before: TestRow = await readTest(testId);

    const written: boolean = await MonitorTestService.mergeStepProbeResponse({
      testId,
      probeId: otherProbeId,
      monitorStepProbeResponse: stepResponse(firstStepId, "Forged outage"),
    });

    expect(written).toBe(false);

    const after: TestRow = await readTest(testId);

    expect(after.monitorStepProbeResponse).toBeNull();
    expect(after.testedAt).toBeNull();
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  test("a probe cannot add to a result its test's own probe already wrote", async () => {
    await MonitorTestService.mergeStepProbeResponse({
      testId,
      probeId,
      monitorStepProbeResponse: stepResponse(firstStepId, ""),
    });

    const written: boolean = await MonitorTestService.mergeStepProbeResponse({
      testId,
      probeId: otherProbeId,
      monitorStepProbeResponse: stepResponse(firstStepId, "Forged outage"),
    });

    expect(written).toBe(false);

    const row: TestRow = await readTest(testId);

    expect(
      (row.monitorStepProbeResponse![firstStepId] as JSONObject)[
        "failureCause"
      ],
    ).toBe("");
  });

  test("each probe writes only its own test, side by side", async () => {
    expect(
      await MonitorTestService.mergeStepProbeResponse({
        testId: otherProjectTestId,
        probeId: otherProbeId,
        monitorStepProbeResponse: stepResponse(firstStepId, ""),
      }),
    ).toBe(true);

    expect(
      await MonitorTestService.mergeStepProbeResponse({
        testId: otherProjectTestId,
        probeId,
        monitorStepProbeResponse: stepResponse(secondStepId, "Forged"),
      }),
    ).toBe(false);

    const row: TestRow = await readTest(otherProjectTestId);

    expect(Object.keys(row.monitorStepProbeResponse || {})).toEqual([
      firstStepId,
    ]);
    expect((await readTest(testId)).monitorStepProbeResponse).toBeNull();
  });

  test("the probe is matched as Postgres matches a uuid, whatever its case", async () => {
    expect(
      await MonitorTestService.mergeStepProbeResponse({
        testId,
        probeId: new ObjectID(probeId.toString().toUpperCase()),
        monitorStepProbeResponse: stepResponse(firstStepId, ""),
      }),
    ).toBe(true);
  });

  test("a test that is gone, or never was, takes no result", async () => {
    const deletedTestId: ObjectID = ObjectID.generate();

    await insertTest({
      id: deletedTestId,
      projectId,
      probeId,
      deletedAt: new Date(),
    });

    expect(
      await MonitorTestService.mergeStepProbeResponse({
        testId: deletedTestId,
        probeId,
        monitorStepProbeResponse: stepResponse(firstStepId, ""),
      }),
    ).toBe(false);

    expect((await readTest(deletedTestId)).monitorStepProbeResponse).toBeNull();

    expect(
      await MonitorTestService.mergeStepProbeResponse({
        testId: ObjectID.generate(),
        probeId,
        monitorStepProbeResponse: stepResponse(firstStepId, ""),
      }),
    ).toBe(false);
  });
});
