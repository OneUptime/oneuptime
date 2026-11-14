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
import Entities from "../../../../Models/DatabaseModels/Index";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import {
  AddMonitorNetworkDevice1809163000000,
  INSERT_TRIGGER,
  SYNC_FUNCTION,
  UPDATE_TRIGGER,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809163000000-AddMonitorNetworkDevice";
import { BackfillMonitorNetworkDevice1809163100000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809163100000-BackfillMonitorNetworkDevice";
import NetworkDeviceWalkUtil from "../../../../Server/Utils/Monitor/NetworkDeviceWalkUtil";
import logger from "../../../../Server/Utils/Logger";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource, QueryRunner } from "typeorm";

/*
 * MonitorNetworkDevice against a real Postgres: the table a device's poll
 * and its traps find their monitors through, and the triggers on "Monitor"
 * that keep it (migrations AddMonitorNetworkDevice and
 * BackfillMonitorNetworkDevice).
 *
 * Opt in with RUN_POSTGRES_MONITOR_NETWORK_DEVICE_TESTS=true and the normal
 * database credentials; MONITOR_NETWORK_DEVICE_TEST_DATABASE_HOST / _PORT /
 * _NAME point it at a database other than the local development one. The
 * database must already be migrated: "Project", "MonitorStatus", "Monitor"
 * and "NetworkDevice" are cloned from public, indexes included, into a
 * uniquely named schema, the two migrations' up() run there, and the schema
 * is dropped afterwards. Monitors are written as the app writes them - their
 * steps by MonitorSteps.toJSON - and read back by the app's own lookup
 * (NetworkDeviceWalkUtil.findMonitorsWatchingDevices).
 *
 * What it pins:
 *   - the backfill writes a row for every device each existing Network
 *     Device monitor's steps name, and none for other monitors;
 *   - from then on every write keeps the rows right: a monitor created, its
 *     steps edited to name another device, a step added or removed, its type
 *     changed away and back, soft deleted and restored, deleted;
 *   - a write that changes none of those - a status, a heartbeat, a name, the
 *     same steps written again - does not run the trigger at all;
 *   - steps naming no device, garbage, a value that is not a UUID or a device
 *     that does not exist all save, with no row for what is not a UUID;
 *   - the lookup finds a device's monitors in its project only, and through
 *     the device index (EXPLAIN), however many monitors the project has;
 *   - down() removes the triggers, the functions and the table, and the
 *     monitors still save.
 */

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MONITOR_NETWORK_DEVICE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "MonitorStatus",
  "Monitor",
  "NetworkDevice",
];

const DASHES: RegExp = /-/g;

interface PlanNode {
  "Node Type": string;
  "Index Name"?: string;
  "Relation Name"?: string;
  Plans?: Array<PlanNode>;
}

function nodesOf(node: PlanNode): Array<PlanNode> {
  return [
    node,
    ...(node.Plans || []).flatMap((child: PlanNode): Array<PlanNode> => {
      return nodesOf(child);
    }),
  ];
}

// Steps as the app stores them, one step per device named.
function stepsNaming(...deviceIds: Array<string | undefined>): string {
  const steps: MonitorSteps = new MonitorSteps();

  steps.data!.monitorStepsInstanceArray = deviceIds.map(
    (deviceId: string | undefined): MonitorStep => {
      const step: MonitorStep = new MonitorStep();
      step.data!.networkDeviceMonitor = {
        networkDeviceId: deviceId,
        monitorInterfaces: true,
        oids: [],
      };
      return step;
    },
  );

  return JSON.stringify(steps.toJSON());
}

describePostgres("MonitorNetworkDevice and its triggers, on Postgres", () => {
  const schema: string = `monitor_network_device_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const statusId: ObjectID = ObjectID.generate();

  const deviceA: string = ObjectID.generate().toString();
  const deviceB: string = ObjectID.generate().toString();
  const deviceC: string = ObjectID.generate().toString();

  async function runInSchema(
    step: (queryRunner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();

    try {
      await step(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  async function insertMonitor(input: {
    monitorType?: MonitorType | string;
    steps: string | null;
    project?: ObjectID;
  }): Promise<string> {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "Monitor" ("_id", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "version", "monitorSteps")
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7::jsonb)`,
      [
        id,
        (input.project || projectId).toString(),
        `monitor ${id}`,
        `monitor-${id}`,
        input.monitorType || MonitorType.NetworkDevice,
        statusId.toString(),
        input.steps,
      ],
    );

    return id;
  }

  async function linksOf(monitorId: string): Promise<Array<string>> {
    const rows: Array<{ networkDeviceId: string }> = await database.query(
      `SELECT "networkDeviceId" FROM "MonitorNetworkDevice" WHERE "monitorId" = $1 ORDER BY "networkDeviceId"`,
      [monitorId],
    );

    return rows.map((row: { networkDeviceId: string }): string => {
      return row.networkDeviceId;
    });
  }

  type Run = (sql: string, parameters?: Array<unknown>) => Promise<unknown>;

  // How often the sync function ran for the writes `work` makes.
  async function syncCallsDuring(
    work: (run: Run) => Promise<void>,
  ): Promise<number> {
    const queryRunner: QueryRunner = database.createQueryRunner();

    try {
      await queryRunner.startTransaction();
      await queryRunner.query(`SET LOCAL track_functions = 'pl'`);

      const found: Array<{ fn: string | null }> = await queryRunner.query(
        `SELECT to_regproc($1)::text AS fn`,
        [`"${schema}"."${SYNC_FUNCTION}"`],
      );
      expect(found[0]?.fn).toBeTruthy();

      const read: () => Promise<number> = async (): Promise<number> => {
        const rows: Array<{ calls: string | null }> = await queryRunner.query(
          `SELECT pg_stat_get_xact_function_calls(to_regproc($1)) AS calls`,
          [`"${schema}"."${SYNC_FUNCTION}"`],
        );
        return Number(rows[0]?.calls || 0);
      };

      const before: number = await read();

      await work((sql: string, parameters?: Array<unknown>) => {
        return queryRunner.query(sql, parameters);
      });

      const after: number = await read();
      await queryRunner.commitTransaction();

      return after - before;
    } finally {
      await queryRunner.release();
    }
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["MONITOR_NETWORK_DEVICE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["MONITOR_NETWORK_DEVICE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MONITOR_NETWORK_DEVICE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        // public too: the generated table's default is uuid_generate_v4().
        options: `-c search_path=${schema},public`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // A fixture names only what a statement reads; ids stay NOT NULL.
    const columns: Array<{ table_name: string; column_name: string }> =
      await database.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = $1 AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema],
      );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }

    await database.query(
      `INSERT INTO "Project" ("_id", "name", "slug", "version") VALUES ($1, 'P', $2, 1), ($3, 'Q', $4, 1)`,
      [
        projectId.toString(),
        `p-${projectId.toString()}`,
        otherProjectId.toString(),
        `q-${otherProjectId.toString()}`,
      ],
    );
    await database.query(
      `INSERT INTO "MonitorStatus" ("_id", "projectId", "name", "slug", "color", "priority", "version") VALUES ($1, $2, 'Up', 'up', '#00ff00', 1, 1)`,
      [statusId.toString(), projectId.toString()],
    );

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

  beforeEach(() => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest
      .spyOn(PostgresAppInstance, "getDataSource")
      .mockReturnValue(database as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Monitors that exist before the migrations run, for the backfill.
  let existingOnA: string;
  let existingOnBAndC: string;
  let existingApi: string;
  let existingInOtherProject: string;

  test("the backfill writes the rows of the monitors that already exist", async () => {
    existingOnA = await insertMonitor({ steps: stepsNaming(deviceA) });
    existingOnBAndC = await insertMonitor({
      steps: stepsNaming(deviceB, deviceC, deviceB),
    });
    existingApi = await insertMonitor({
      monitorType: MonitorType.API,
      steps: stepsNaming(deviceA),
    });
    existingInOtherProject = await insertMonitor({
      steps: stepsNaming(deviceA),
      project: otherProjectId,
    });

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddMonitorNetworkDevice1809163000000().up(queryRunner);
    });

    // Before the backfill: the triggers exist, the old monitors have no rows.
    expect(await linksOf(existingOnA)).toEqual([]);

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new BackfillMonitorNetworkDevice1809163100000().up(queryRunner);
    });

    expect(await linksOf(existingOnA)).toEqual([deviceA]);
    expect(await linksOf(existingOnBAndC)).toEqual([deviceB, deviceC].sort());
    expect(await linksOf(existingApi)).toEqual([]);
    expect(await linksOf(existingInOtherProject)).toEqual([deviceA]);

    const projects: Array<{ projectId: string }> = await database.query(
      `SELECT "projectId" FROM "MonitorNetworkDevice" WHERE "monitorId" = $1`,
      [existingInOtherProject],
    );
    expect(projects[0]?.projectId).toBe(otherProjectId.toString());
  });

  test("the backfill run again adds nothing", async () => {
    const before: Array<{ count: string }> = await database.query(
      `SELECT count(*) AS count FROM "MonitorNetworkDevice"`,
    );

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new BackfillMonitorNetworkDevice1809163100000().up(queryRunner);
    });

    const after: Array<{ count: string }> = await database.query(
      `SELECT count(*) AS count FROM "MonitorNetworkDevice"`,
    );
    expect(after[0]!.count).toBe(before[0]!.count);
  });

  test("a Network Device monitor created gets a row per device its steps name", async () => {
    const monitorId: string = await insertMonitor({
      steps: stepsNaming(deviceA, deviceB),
    });

    expect(await linksOf(monitorId)).toEqual([deviceA, deviceB].sort());
  });

  test("a monitor of another type gets none, whatever its steps name", async () => {
    const monitorId: string = await insertMonitor({
      monitorType: MonitorType.Ping,
      steps: stepsNaming(deviceA),
    });

    expect(await linksOf(monitorId)).toEqual([]);
  });

  test("steps edited to name another device move the row", async () => {
    const monitorId: string = await insertMonitor({
      steps: stepsNaming(deviceA),
    });

    await database.query(
      `UPDATE "Monitor" SET "monitorSteps" = $1::jsonb WHERE "_id" = $2`,
      [stepsNaming(deviceB), monitorId],
    );

    expect(await linksOf(monitorId)).toEqual([deviceB]);
  });

  test("a step added, and a step removed", async () => {
    const monitorId: string = await insertMonitor({
      steps: stepsNaming(deviceA),
    });

    await database.query(
      `UPDATE "Monitor" SET "monitorSteps" = $1::jsonb WHERE "_id" = $2`,
      [stepsNaming(deviceA, deviceC), monitorId],
    );
    expect(await linksOf(monitorId)).toEqual([deviceA, deviceC].sort());

    await database.query(
      `UPDATE "Monitor" SET "monitorSteps" = $1::jsonb WHERE "_id" = $2`,
      [stepsNaming(deviceC), monitorId],
    );
    expect(await linksOf(monitorId)).toEqual([deviceC]);
  });

  test("its type changed away and back", async () => {
    const monitorId: string = await insertMonitor({
      steps: stepsNaming(deviceA),
    });

    await database.query(
      `UPDATE "Monitor" SET "monitorType" = $1 WHERE "_id" = $2`,
      [MonitorType.API, monitorId],
    );
    expect(await linksOf(monitorId)).toEqual([]);

    await database.query(
      `UPDATE "Monitor" SET "monitorType" = $1 WHERE "_id" = $2`,
      [MonitorType.NetworkDevice, monitorId],
    );
    expect(await linksOf(monitorId)).toEqual([deviceA]);
  });

  test("soft deleted and restored, then deleted", async () => {
    const monitorId: string = await insertMonitor({
      steps: stepsNaming(deviceA),
    });

    await database.query(
      `UPDATE "Monitor" SET "deletedAt" = now() WHERE "_id" = $1`,
      [monitorId],
    );
    expect(await linksOf(monitorId)).toEqual([]);

    await database.query(
      `UPDATE "Monitor" SET "deletedAt" = NULL WHERE "_id" = $1`,
      [monitorId],
    );
    expect(await linksOf(monitorId)).toEqual([deviceA]);

    await database.query(`DELETE FROM "Monitor" WHERE "_id" = $1`, [monitorId]);
    expect(await linksOf(monitorId)).toEqual([]);
  });

  test("status, heartbeat and name writes, and the same steps written again, never run the trigger", async () => {
    const monitorId: string = await insertMonitor({
      steps: stepsNaming(deviceA),
    });

    const calls: number = await syncCallsDuring(async (run: Run) => {
      await run(
        `UPDATE "Monitor" SET "currentMonitorStatusId" = $1, "name" = 'renamed' WHERE "_id" = $2`,
        [statusId.toString(), monitorId],
      );
      await run(
        `UPDATE "Monitor" SET "serverMonitorRequestReceivedAt" = now() WHERE "_id" = $1`,
        [monitorId],
      );
      await run(
        `UPDATE "Monitor" SET "monitorSteps" = "monitorSteps" WHERE "_id" = $1`,
        [monitorId],
      );
    });

    expect(calls).toBe(0);
    expect(await linksOf(monitorId)).toEqual([deviceA]);

    const stepCalls: number = await syncCallsDuring(async (run: Run) => {
      await run(
        `UPDATE "Monitor" SET "monitorSteps" = $1::jsonb WHERE "_id" = $2`,
        [stepsNaming(deviceB), monitorId],
      );
    });

    expect(stepCalls).toBe(1);
    expect(await linksOf(monitorId)).toEqual([deviceB]);
  });

  test("steps that name nothing, garbage, a value that is not a UUID or a device that does not exist all save", async () => {
    const nothing: string = await insertMonitor({ steps: null });
    const noDevice: string = await insertMonitor({
      steps: stepsNaming(undefined),
    });
    const notUuid: string = await insertMonitor({
      steps: stepsNaming("not-a-uuid", deviceA),
    });
    const garbage: string = await insertMonitor({
      steps: JSON.stringify({ value: { monitorStepsInstanceArray: "x" } }),
    });
    const missingDevice: string = ObjectID.generate().toString();
    const ghost: string = await insertMonitor({
      steps: stepsNaming(missingDevice),
    });

    expect(await linksOf(nothing)).toEqual([]);
    expect(await linksOf(noDevice)).toEqual([]);
    expect(await linksOf(notUuid)).toEqual([deviceA]);
    expect(await linksOf(garbage)).toEqual([]);
    // No foreign key to the device: the stale poll check reads these.
    expect(await linksOf(ghost)).toEqual([missingDevice]);
  });

  test("the lookup a poll runs finds the device's monitors in its project only", async () => {
    const device: string = ObjectID.generate().toString();
    const mine: string = await insertMonitor({ steps: stepsNaming(device) });
    const alsoMine: string = await insertMonitor({
      steps: stepsNaming(deviceA, device),
    });
    await insertMonitor({
      steps: stepsNaming(device),
      project: otherProjectId,
    });
    await insertMonitor({
      monitorType: MonitorType.API,
      steps: stepsNaming(device),
    });

    const found: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: projectId,
        deviceIds: [device],
      });

    expect(
      found
        .map((monitor: Monitor): string => {
          return monitor.id!.toString();
        })
        .sort(),
    ).toEqual([mine, alsoMine].sort());

    // Each comes with the steps the fan-out evaluates.
    for (const monitor of found) {
      expect(
        monitor.monitorSteps!.data!.monitorStepsInstanceArray.some(
          (step: MonitorStep): boolean => {
            return step.data?.networkDeviceMonitor?.networkDeviceId === device;
          },
        ),
      ).toBe(true);
    }
  });

  test("the lookup reads the device index, however many monitors the project has", async () => {
    await database.query(
      `INSERT INTO "Monitor" ("_id", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "version", "monitorSteps")
       SELECT gen_random_uuid(), $1, 'bulk ' || g, 'bulk-' || g, $2, $3, 1,
         replace($4, $5, gen_random_uuid()::text)::jsonb
       FROM generate_series(1, 3000) g`,
      [
        projectId.toString(),
        MonitorType.NetworkDevice,
        statusId.toString(),
        stepsNaming(deviceC),
        deviceC,
      ],
    );
    await database.query(`ANALYZE "MonitorNetworkDevice"`);

    const plan: Array<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }> =
      await database.query(
        `EXPLAIN (FORMAT JSON) SELECT "_id", "monitorId" FROM "MonitorNetworkDevice"
         WHERE "projectId" = $1 AND "networkDeviceId" IN ($2) AND "deletedAt" IS NULL
         ORDER BY "_id" ASC LIMIT 10000`,
        [projectId.toString(), deviceA],
      );

    const nodes: Array<PlanNode> = nodesOf(plan[0]!["QUERY PLAN"][0]!.Plan);

    expect(
      nodes.some((node: PlanNode): boolean => {
        return (
          node["Relation Name"] === "MonitorNetworkDevice" &&
          node["Node Type"] === "Seq Scan"
        );
      }),
    ).toBe(false);
    expect(
      nodes.some((node: PlanNode): boolean => {
        return Boolean(node["Index Name"]);
      }),
    ).toBe(true);
  });

  test("down() removes the triggers, the functions and the table, and monitors still save", async () => {
    await runInSchema(async (queryRunner: QueryRunner) => {
      /*
       * The generated down() names its indexes "public"."IDX_...": run here,
       * in the test's schema, so the database's own table keeps them.
       */
      const inSchema: QueryRunner = {
        query: (sql: string, parameters?: Array<unknown>): Promise<unknown> => {
          return queryRunner.query(
            sql.replace(/"public"\./g, `"${schema}".`),
            parameters,
          );
        },
      } as unknown as QueryRunner;

      await new BackfillMonitorNetworkDevice1809163100000().down(inSchema);
      await new AddMonitorNetworkDevice1809163000000().down(inSchema);
    });

    const triggers: Array<{ tgname: string }> = await database.query(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = to_regclass($1) AND tgname IN ($2, $3)`,
      [`"${schema}"."Monitor"`, INSERT_TRIGGER, UPDATE_TRIGGER],
    );
    expect(triggers).toEqual([]);

    const table: Array<{ exists: string | null }> = await database.query(
      `SELECT to_regclass($1) AS exists`,
      [`"${schema}"."MonitorNetworkDevice"`],
    );
    expect(table[0]?.exists).toBeNull();

    const monitorId: string = await insertMonitor({
      steps: stepsNaming(deviceA),
    });
    await database.query(
      `UPDATE "Monitor" SET "monitorSteps" = $1::jsonb WHERE "_id" = $2`,
      [stepsNaming(deviceB), monitorId],
    );
  });
});
