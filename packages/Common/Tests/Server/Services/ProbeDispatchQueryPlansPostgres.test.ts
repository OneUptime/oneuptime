import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorTestService from "../../../Server/Services/MonitorTestService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
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
import { DataSource, QueryRunner } from "typeorm";

/*
 * THE STATEMENTS THAT HAND WORK TO PROBES, PLANNED AT THE SCALE OF #10819.
 *
 * A self-hosted install with 39,800 monitor assignments, each probe's
 * replicas and workers asking for monitors all minute and for Test Monitor
 * runs every ten seconds. Each statement the dispatch path sends is
 * captured as the services build it and run under EXPLAIN (ANALYZE,
 * BUFFERS) on copies of the migrated tables, filled to that scale:
 *
 *   - the monitor claim reads its probe's due rows by the (probeId,
 *     isEnabled, nextPingAt) index in its order, locks what it claims and
 *     reads a few hundred pages for a batch, never a table - also while
 *     other claims hold the oldest rows, which its check for stepped-over
 *     rows reads by index lookups, not by a scan of Monitor;
 *   - the read of the claimed monitors that follows goes by primary key;
 *   - the Test Monitor claim reads the probe's unanswered tests by their
 *     own partial index, not every answered test the probe has had for two
 *     days.
 *
 * Opt in with RUN_POSTGRES_PROBE_DISPATCH_PLAN_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The tables' STRUCTURE is cloned into
 * a unique schema (search_path holds only that schema) that is dropped
 * afterwards. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from PROBE_DISPATCH_PLAN_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from PROBE_DISPATCH_PLAN_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PROBE_DISPATCH_PLAN_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "Monitor",
  "MonitorProbe",
  "MonitorTest",
];

// The issue's install.
const ONE_MINUTE_ASSIGNMENTS: number = 28_200;
const FIVE_MINUTE_ASSIGNMENTS: number = 11_500;
const PROBES: number = 4;
const PROJECTS: number = 40;
const ANSWERED_TESTS: number = 20_000;

// What a batch of 10 may read, with room to spare (measured: about 300).
const CLAIM_BUFFER_BOUND: number = 2000;

interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Actual Loops"?: number;
  "Actual Rows"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: Array<PlanNode>;
}

interface ExplainedPlan {
  Plan: PlanNode;
  Planning?: { "Shared Hit Blocks"?: number };
}

interface CapturedStatement {
  sql: string;
  parameters: Array<unknown>;
}

function nodesOf(node: PlanNode): Array<PlanNode> {
  return [node, ...(node.Plans || []).flatMap(nodesOf)];
}

function buffersOf(plan: ExplainedPlan): number {
  return (
    (plan.Plan["Shared Hit Blocks"] || 0) +
    (plan.Plan["Shared Read Blocks"] || 0)
  );
}

/*
 * The big tables read whole: the ones that grow with the monitors and the
 * tests. A plan can hold a scan that never runs - a hash join whose other
 * side came back empty never builds its table - so only the scans that ran
 * count. A scan of Project, a page or two here, is the planner's to choose;
 * what any read costs shows in the buffers.
 */
const BIG_TABLES: Array<string> = ["Monitor", "MonitorProbe", "MonitorTest"];

function seqScansOf(plan: ExplainedPlan): Array<string> {
  return nodesOf(plan.Plan)
    .filter((node: PlanNode): boolean => {
      return (
        node["Node Type"] === "Seq Scan" &&
        (node["Actual Loops"] || 0) > 0 &&
        BIG_TABLES.includes(String(node["Relation Name"]))
      );
    })
    .map((node: PlanNode): string => {
      return String(node["Relation Name"]);
    });
}

// The plan in one line a failure shows: each node, its table, loops, pages.
function summaryOf(plan: ExplainedPlan): string {
  return nodesOf(plan.Plan)
    .map((node: PlanNode): string => {
      return `${node["Node Type"]}${node["Relation Name"] ? ` ${node["Relation Name"]}` : ""}${node["Index Name"] ? ` (${node["Index Name"]})` : ""} x${node["Actual Loops"] ?? "?"} ${(node["Shared Hit Blocks"] || 0) + (node["Shared Read Blocks"] || 0)}p`;
    })
    .join(" | ");
}

// No table read whole; on failure, the plan says where.
function expectNoTableReadWhole(plan: ExplainedPlan): void {
  expect({ seqScans: seqScansOf(plan), plan: summaryOf(plan) }).toEqual({
    seqScans: [],
    plan: summaryOf(plan),
  });
}

function indexesOf(plan: ExplainedPlan): Array<string> {
  return nodesOf(plan.Plan)
    .filter((node: PlanNode): boolean => {
      return Boolean(node["Index Name"]);
    })
    .map((node: PlanNode): string => {
      return `${node["Relation Name"] || ""}:${node["Index Name"]}`;
    });
}

describePostgres(
  "the probe dispatch path's statements, at 39,800 assignments",
  () => {
    const schema: string = `probe_dispatch_plans_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;
    const probeIds: Array<string> = [];
    let testProbeId: string = "";

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["PROBE_DISPATCH_PLAN_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["PROBE_DISPATCH_PLAN_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PROBE_DISPATCH_PLAN_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema} -c jit=off`,
          max: 4,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );

        const columns: Array<{ column_name: string }> = await database.query(
          `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'
           AND column_name NOT IN ('_id', 'isEnabled')`,
          [schema, table],
        );

        for (const column of columns) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
          );
        }
      }

      for (let probe: number = 0; probe < PROBES; probe++) {
        probeIds.push(ObjectID.generate().toString());
      }
      testProbeId = probeIds[0]!;

      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "isBlocked", "version")
       SELECT gen_random_uuid(), 'Project ' || n, false, 1
       FROM generate_series(1, $1) AS n`,
        [PROJECTS],
      );

      // A Website monitor's steps take a few kilobytes, stored out of line.
      await database.query(
        `INSERT INTO "${schema}"."Monitor"
         ("_id", "projectId", "name", "monitorType", "monitoringInterval",
          "monitorSteps", "isArchived", "disableActiveMonitoring",
          "disableActiveMonitoringBecauseOfManualIncident",
          "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent", "version")
       SELECT gen_random_uuid(),
         (SELECT array_agg("_id") FROM "${schema}"."Project")[1 + (n % $2)],
         'Website ' || n, 'Website',
         CASE WHEN n < $3 THEN '* * * * *' ELSE '*/5 * * * *' END,
         jsonb_build_object('_type', 'MonitorSteps', 'value',
           jsonb_build_object('monitorStepsInstanceArray',
             jsonb_build_array(jsonb_build_object('step', md5(n::text) || repeat('x', 3000))))),
         false, false, false, false, 1
       FROM generate_series(0, $1 - 1) AS n`,
        [
          ONE_MINUTE_ASSIGNMENTS + FIVE_MINUTE_ASSIGNMENTS,
          PROJECTS,
          ONE_MINUTE_ASSIGNMENTS,
        ],
      );

      // Every assignment due, a second to a minute ago: a probe falling behind.
      await database.query(
        `INSERT INTO "${schema}"."MonitorProbe"
         ("_id", "projectId", "probeId", "monitorId", "isEnabled", "nextPingAt", "version")
       SELECT gen_random_uuid(), x."projectId",
         ($1::uuid[])[1 + (x.position % $2)], x."_id", true,
         now() - (1 + random() * 59) * INTERVAL '1 second', 1
       FROM (
         SELECT m."_id", m."projectId", (row_number() OVER (ORDER BY m."_id"))::int AS position
         FROM "${schema}"."Monitor" m
       ) x`,
        [probeIds, PROBES],
      );

      // Two days of one probe's answered tests, and three still waiting.
      await database.query(
        `INSERT INTO "${schema}"."MonitorTest"
         ("_id", "projectId", "probeId", "monitorType", "monitorSteps", "isInQueue",
          "monitorStepProbeResponse", "createdAt", "updatedAt", "version")
       SELECT gen_random_uuid(), (SELECT "_id" FROM "${schema}"."Project" LIMIT 1),
         $1, 'Website', jsonb_build_object('steps', repeat('s', 800)), false,
         jsonb_build_object('response', repeat('r', 1500)),
         now() - (n * 8) * INTERVAL '1 second', now() - (n * 8) * INTERVAL '1 second', 1
       FROM generate_series(1, $2) AS n`,
        [testProbeId, ANSWERED_TESTS],
      );
      await database.query(
        `INSERT INTO "${schema}"."MonitorTest"
         ("_id", "projectId", "probeId", "monitorType", "monitorSteps", "isInQueue",
          "createdAt", "updatedAt", "version")
       SELECT gen_random_uuid(), (SELECT "_id" FROM "${schema}"."Project" LIMIT 1),
         $1, 'Website', jsonb_build_object('steps', repeat('s', 800)), true,
         now() - n * INTERVAL '1 second', now(), 1
       FROM generate_series(1, 3) AS n`,
        [testProbeId],
      );

      for (const table of TABLES) {
        await database.query(`VACUUM ANALYZE "${schema}"."${table}"`);
      }
    }, 300_000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(() => {
      for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation((() => {
          return undefined;
        }) as never);
      }
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // The statements a service sends through its manager, answered `answer`.
    function captureStatements(
      service: { getRepository: () => unknown },
      answer: Array<Record<string, unknown>>,
    ): { statements: Array<CapturedStatement>; restore: () => void } {
      const statements: Array<CapturedStatement> = [];

      const spy: { mockRestore: () => void } = jest
        .spyOn(service, "getRepository")
        .mockReturnValue({
          manager: {
            query: async (
              sql: string,
              parameters?: Array<unknown>,
            ): Promise<Array<Record<string, unknown>>> => {
              statements.push({ sql, parameters: parameters || [] });
              return statements.length === 1 ? answer : [];
            },
          },
        } as never);

      return {
        statements,
        restore: (): void => {
          spy.mockRestore();
        },
      };
    }

    /*
     * EXPLAIN (ANALYZE, BUFFERS) of a statement as sent, rolled back: the
     * claims write.
     */
    async function explain(
      statement: CapturedStatement,
      runner?: QueryRunner,
    ): Promise<ExplainedPlan> {
      const own: QueryRunner = runner || database.createQueryRunner();

      if (!runner) {
        await own.connect();
      }

      try {
        await own.query("BEGIN");
        const rows: Array<{ "QUERY PLAN": Array<ExplainedPlan> }> =
          await own.query(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`,
            statement.parameters,
          );
        return rows[0]!["QUERY PLAN"][0]!;
      } finally {
        await own.query("ROLLBACK");

        if (!runner) {
          await own.release();
        }
      }
    }

    async function claimStatement(
      probeId: string,
      limit: number,
    ): Promise<CapturedStatement> {
      const captured: {
        statements: Array<CapturedStatement>;
        restore: () => void;
      } = captureStatements(
        MonitorProbeService as unknown as { getRepository: () => unknown },
        [{ _id: null, steppedOver: false }],
      );

      await MonitorProbeService.claimMonitorProbesForProbing({
        probeId: new ObjectID(probeId),
        limit: limit,
      });

      captured.restore();
      return captured.statements[0]!;
    }

    test("the seed is the issue's install", async () => {
      const rows: Array<{ count: number }> = await database.query(
        `SELECT COUNT(*)::int AS "count" FROM "${schema}"."MonitorProbe"`,
      );
      expect(rows[0]!.count).toBe(
        ONE_MINUTE_ASSIGNMENTS + FIVE_MINUTE_ASSIGNMENTS,
      );
    });

    test("the monitor claim reads its probe's due rows by index, in order, and a few hundred pages for a batch", async () => {
      const plan: ExplainedPlan = await explain(
        await claimStatement(probeIds[1]!, 10),
      );

      expectNoTableReadWhole(plan);
      expect(indexesOf(plan)).toContain(
        "MonitorProbe:MonitorProbe_probeId_isEnabled_nextPingAt_idx",
      );
      expect(
        nodesOf(plan.Plan).some((node: PlanNode): boolean => {
          return node["Node Type"] === "LockRows";
        }),
      ).toBe(true);
      expect(buffersOf(plan)).toBeLessThan(CLAIM_BUFFER_BOUND);
    });

    test("a bigger batch reads in proportion, not the probe's backlog", async () => {
      const ten: number = buffersOf(
        await explain(await claimStatement(probeIds[2]!, 10)),
      );
      const hundred: ExplainedPlan = await explain(
        await claimStatement(probeIds[2]!, 100),
      );

      expectNoTableReadWhole(hundred);
      // About ten times the batch, far short of the probe's ~10,000 due rows.
      expect(buffersOf(hundred)).toBeLessThan(Math.max(ten * 20, 4000));
    });

    test("with other claims holding the oldest rows, its check for what it stepped over goes by index lookups too", async () => {
      const statement: CapturedStatement = await claimStatement(
        probeIds[3]!,
        10,
      );

      // Another claim holds the probe's 40 oldest due rows.
      const holder: QueryRunner = database.createQueryRunner();
      await holder.connect();
      await holder.query("BEGIN");

      try {
        await holder.query(
          `SELECT "_id" FROM "${schema}"."MonitorProbe"
         WHERE "probeId" = $1 AND "isEnabled" = true AND "nextPingAt" <= now()
         ORDER BY "nextPingAt" ASC LIMIT 40
         FOR NO KEY UPDATE`,
          [probeIds[3]],
        );

        const plan: ExplainedPlan = await explain(statement);

        expectNoTableReadWhole(plan);
        expect(buffersOf(plan)).toBeLessThan(CLAIM_BUFFER_BOUND);
      } finally {
        await holder.query("ROLLBACK");
        await holder.release();
      }
    });

    test("a probe with nothing due costs index probes", async () => {
      const plan: ExplainedPlan = await explain(
        await claimStatement(ObjectID.generate().toString(), 10),
      );

      expectNoTableReadWhole(plan);
      expect(buffersOf(plan)).toBeLessThan(50);
    });

    test("the read of the claimed monitors that follows goes by primary key", async () => {
      const claimed: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${schema}"."MonitorProbe"
       WHERE "probeId" = $1 ORDER BY "nextPingAt" ASC LIMIT 50`,
        [probeIds[0]],
      );

      const statements: Array<CapturedStatement> = [];
      const original: () => QueryRunner = database.createQueryRunner.bind(
        database,
      ) as () => QueryRunner;

      const spy: { mockRestore: () => void } = jest
        .spyOn(database, "createQueryRunner")
        .mockImplementation((...args: Array<unknown>): QueryRunner => {
          const runner: QueryRunner = (
            original as unknown as (...rest: Array<unknown>) => QueryRunner
          )(...args);
          const query: (...rest: Array<unknown>) => Promise<unknown> =
            runner.query.bind(runner) as never;
          runner.query = (async (
            sql: string,
            parameters?: Array<unknown>,
            ...rest: Array<unknown>
          ): Promise<unknown> => {
            // TypeORM names the table with its schema here.
            if (
              sql.trim().startsWith("SELECT") &&
              sql.includes('"MonitorProbe" "MonitorProbe"')
            ) {
              statements.push({ sql, parameters: parameters || [] });
            }
            return await query(sql, parameters, ...rest);
          }) as QueryRunner["query"];
          return runner;
        });

      await MonitorProbeService.findBy({
        query: {
          _id: QueryHelper.any(
            claimed.map((row: { _id: string }): ObjectID => {
              return new ObjectID(row._id);
            }),
          ),
        },
        select: {
          nextPingAt: true,
          probeId: true,
          monitorId: true,
          monitor: {
            monitorSteps: true,
            monitorType: true,
            monitoringInterval: true,
            projectId: true,
          },
        },
        limit: claimed.length,
        skip: 0,
        props: { isRoot: true },
      });

      spy.mockRestore();
      expect(statements.length).toBeGreaterThanOrEqual(1);

      const plan: ExplainedPlan = await explain(statements[0]!);
      expectNoTableReadWhole(plan);
      expect(buffersOf(plan)).toBeLessThan(CLAIM_BUFFER_BOUND);
    });

    test("the Test Monitor claim reads the probe's unanswered tests by their own index, not two days of answered ones", async () => {
      const captured: {
        statements: Array<CapturedStatement>;
        restore: () => void;
      } = captureStatements(
        MonitorTestService as unknown as { getRepository: () => unknown },
        [],
      );

      await MonitorTestService.claimMonitorTestsForProbing({
        probeId: new ObjectID(testProbeId),
        limit: 100,
      });
      captured.restore();

      const plan: ExplainedPlan = await explain(captured.statements[0]!);

      expectNoTableReadWhole(plan);
      expect(indexesOf(plan)).toContain(
        "MonitorTest:MonitorTest_probeId_createdAt_idx",
      );
      // It read 2,501 pages for 3 tests among 20,000 answered ones.
      expect(buffersOf(plan)).toBeLessThan(200);
    });
  },
);
