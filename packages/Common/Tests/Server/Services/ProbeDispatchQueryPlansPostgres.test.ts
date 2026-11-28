import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorTestService from "../../../Server/Services/MonitorTestService";
import ClaimedMonitor from "../../../Server/Utils/Probe/ClaimedMonitor";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
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
 *     isEnabled, nextPingAt, lastPingAt) index in its order - rows due at
 *     the same moment by when each was last handed out, sorting nothing
 *     (#11386) - locks what it claims and
 *     reads a few hundred pages for a batch, never a table - also while
 *     other claims hold the oldest rows, which its check for stepped-over
 *     rows reads by index lookups, not by a scan of Monitor. It hands back
 *     each claimed monitor with its row, so nothing reads them again
 *     (#11120);
 *   - a probe's pending count, which its KEDA autoscaler reads, joins its
 *     thousands of due rows to the monitors a probe may check by their own
 *     partial index - the ids alone - not by reading the whole of Monitor,
 *     as it did before that index (#11119);
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

/*
 * What a probe's pending count may read with 9,925 of its rows due: its
 * due rows (about 770 pages) and the ids of the monitors a probe may check
 * (155), with room to spare. Without that index, as main had it, it read
 * every page of Monitor as well: 10,695 here, 10,689 on the copy of the
 * issue's install (#11119).
 */
const COUNT_BUFFER_BOUND: number = 1500;

interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  // A CTE's plan: "CTE claimable".
  "Subplan Name"?: string;
  "Sort Key"?: Array<string>;
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

      /*
       * A Website monitor's steps take a kilobyte or two that compress
       * little: four monitors a page, 9,925 pages for the issue's 39,700, as
       * on the copy of its install the issue was measured on (#11119).
       */
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
             jsonb_build_array(jsonb_build_object('step',
               (SELECT string_agg(md5(n::text || '-' || part::text), '')
                FROM generate_series(1, 55) AS part))))),
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
        "MonitorProbe:MonitorProbe_probeId_isEnabled_nextPingAt_lastPingAt_idx",
      );
      expect(
        nodesOf(plan.Plan).some((node: PlanNode): boolean => {
          return node["Node Type"] === "LockRows";
        }),
      ).toBe(true);
      expect(buffersOf(plan)).toBeLessThan(CLAIM_BUFFER_BOUND);
    });

    /*
     * #11386: of the rows due at the same moment, the claim hands out the one
     * handed out longest ago first. Every one-minute monitor a probe claims
     * is stamped with the same next minute, so on a running server most of
     * a probe's rows are due at the same instant. The index holds them in
     * the claim's order, so the read takes them as the index has them and
     * stops at its batch: no Sort under the read, which would read and sort
     * every row due at that minute - here 10,000 of a probe's - to hand out
     * ten.
     */
    test("the monitor claim takes the rows due at the same moment in its index's order, longest ago handed out first, and sorts nothing to do so (#11386)", async () => {
      const probeId: string = ObjectID.generate().toString();

      // A fifth probe with 10,000 rows due at the same whole minute, each last handed out at its own moment.
      await database.query(
        `INSERT INTO "${schema}"."MonitorProbe"
           ("_id", "projectId", "probeId", "monitorId", "isEnabled", "nextPingAt", "lastPingAt", "version")
         SELECT gen_random_uuid(), m."projectId", $1, m."_id", true,
           date_trunc('minute', now()) - INTERVAL '1 minute',
           date_trunc('minute', now()) - INTERVAL '2 minutes' + random() * INTERVAL '50 seconds', 1
         FROM (SELECT "_id", "projectId" FROM "${schema}"."Monitor" ORDER BY "_id" LIMIT 10000) m`,
        [probeId],
      );
      await database.query(`ANALYZE "${schema}"."MonitorProbe"`);

      try {
        const plan: ExplainedPlan = await explain(
          await claimStatement(probeId, 10),
        );

        const claimable: PlanNode | undefined = nodesOf(plan.Plan).find(
          (node: PlanNode): boolean => {
            return node["Subplan Name"] === "CTE claimable";
          },
        );
        expect(claimable).toBeDefined();

        const read: Array<PlanNode> = nodesOf(claimable!);
        expect(
          read
            .filter((node: PlanNode): boolean => {
              return node["Node Type"] === "Sort";
            })
            .map((node: PlanNode): Array<string> => {
              return node["Sort Key"] || [];
            }),
        ).toEqual([]);
        expect(
          read
            .filter((node: PlanNode): boolean => {
              return (
                node["Index Name"] ===
                "MonitorProbe_probeId_isEnabled_nextPingAt_lastPingAt_idx"
              );
            })
            .map((node: PlanNode): boolean => {
              // The batch, and the few it steps over: never the minute's 10,000.
              return (node["Actual Rows"] || 0) < 100;
            }),
        ).toEqual([true]);
        expectNoTableReadWhole(plan);
        expect(buffersOf(plan)).toBeLessThan(CLAIM_BUFFER_BOUND);
      } finally {
        await database.query(
          `DELETE FROM "${schema}"."MonitorProbe" WHERE "probeId" = $1`,
          [probeId],
        );
      }
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

    /*
     * The claim's statement as main had it before #11120: the same, without
     * the claimed monitors' columns.
     */
    function withoutClaimedMonitors(
      statement: CapturedStatement,
    ): CapturedStatement {
      let sql: string = statement.sql;

      for (const columns of [
        ClaimedMonitor.COLUMNS,
        ClaimedMonitor.COLUMNS_OF_CLAIMED,
      ]) {
        sql = sql.replace(
          new RegExp(`,\\s*${escapeRegExp(columns.join(", "))}`, "g"),
          "",
        );
      }

      expect(sql).not.toContain('"monitorSteps"');
      return { sql, parameters: statement.parameters };
    }

    /*
     * The read main ran after the claim, for the answer: the claimed
     * monitor probes again with their monitor, by primary key.
     */
    async function readOfClaimedAsMainHadIt(
      monitorProbeIds: Array<string>,
    ): Promise<CapturedStatement> {
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
            monitorProbeIds.map((id: string): ObjectID => {
              return new ObjectID(id);
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
        limit: monitorProbeIds.length,
        skip: 0,
        props: { isRoot: true },
      });

      spy.mockRestore();
      expect(statements.length).toBeGreaterThanOrEqual(1);
      return statements[0]!;
    }

    // A statement's rows, as it answers them, rolled back: the claims write.
    async function rowsOf(
      statement: CapturedStatement,
    ): Promise<Array<Record<string, unknown>>> {
      const runner: QueryRunner = database.createQueryRunner();
      await runner.connect();

      try {
        await runner.query("BEGIN");
        return (await runner.query(
          statement.sql,
          statement.parameters,
        )) as Array<Record<string, unknown>>;
      } finally {
        await runner.query("ROLLBACK");
        await runner.release();
      }
    }

    test("the claim hands each claimed monitor out with its row, so nothing reads them again (#11120)", async () => {
      const statement: CapturedStatement = await claimStatement(
        probeIds[0]!,
        50,
      );
      const rows: Array<Record<string, unknown>> = await rowsOf(statement);
      const claimed: Array<Record<string, unknown>> = rows.filter(
        (row: Record<string, unknown>): boolean => {
          return Boolean(row["_id"]);
        },
      );

      expect(claimed).toHaveLength(50);

      for (const row of claimed) {
        expect(typeof row["monitorId"]).toBe("string");
        expect(typeof row["monitorProjectId"]).toBe("string");
        expect(row["monitorType"]).toBe("Website");
        expect(row["monitorSteps"]).toEqual(
          expect.objectContaining({ _type: "MonitorSteps" }),
        );
      }

      const plan: ExplainedPlan = await explain(statement);
      expectNoTableReadWhole(plan);
      expect(buffersOf(plan)).toBeLessThan(CLAIM_BUFFER_BOUND);
    });

    test("that one statement reads no more than the claim and the read after it did, as main had them", async () => {
      const statement: CapturedStatement = await claimStatement(
        probeIds[0]!,
        50,
      );
      const claimedIds: Array<string> = (await rowsOf(statement))
        .map((row: Record<string, unknown>): string => {
          return String(row["_id"] || "");
        })
        .filter(Boolean);

      const now: number = buffersOf(await explain(statement));
      const mainClaim: number = buffersOf(
        await explain(withoutClaimedMonitors(statement)),
      );
      const mainRead: ExplainedPlan = await explain(
        await readOfClaimedAsMainHadIt(claimedIds),
      );

      // The read main ran after it went by primary key, never a table.
      expectNoTableReadWhole(mainRead);
      // The monitors' columns come from the rows the claim reads anyway.
      expect(now).toBeLessThanOrEqual(mainClaim + 20);
      expect(now).toBeLessThan(mainClaim + buffersOf(mainRead));
    });

    // The pending count's statement, as the service sends it.
    async function countStatement(probeId: string): Promise<CapturedStatement> {
      const captured: {
        statements: Array<CapturedStatement>;
        restore: () => void;
      } = captureStatements(
        MonitorProbeService as unknown as { getRepository: () => unknown },
        [{ count: 0 }],
      );

      await MonitorProbeService.countMonitorProbesDueForProbing({
        probeId: new ObjectID(probeId),
        dueAt: new Date(),
      });

      captured.restore();
      return captured.statements[0]!;
    }

    /*
     * This schema's copy of the index of the monitors a probe may check
     * (IDX_35665422ae411fa9290bc619e9 on the migrated table).
     */
    async function probeableIndexName(): Promise<string> {
      const rows: Array<{ indexname: string }> = await database.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = $1 AND tablename = 'Monitor'
           AND indexdef LIKE '%disableActiveMonitoringBecauseOfManualIncident%'
           AND indexdef LIKE '%(_id)%'`,
        [schema],
      );
      expect(rows).toHaveLength(1);
      return rows[0]!.indexname;
    }

    /*
     * A quarter of MonitorProbe is the probe's, all of it due, and some of
     * its rows are on every page: Postgres reads them by the claim's index
     * range and then every page they are on, or by reading the table,
     * whichever it costs less. Here the two are within 2% of each other in
     * its costs, so which it takes changes from one seed to the next, and
     * either reads every page of MonitorProbe once (the table itself, the
     * fewer pages). What #11119 was about is the other side of the join:
     * the monitors, read by their ids alone, never the whole of Monitor -
     * as ProbeDispatchTwoProbesAtScalePostgres holds at half the table.
     */
    test("a probe's pending count joins its due rows to the monitors it may check by their own index, not the whole Monitor table (#11119)", async () => {
      const statement: CapturedStatement = await countStatement(probeIds[1]!);
      const plan: ExplainedPlan = await explain(statement);

      expect({
        monitorReadWhole: seqScansOf(plan).includes("Monitor"),
        plan: summaryOf(plan),
      }).toEqual({ monitorReadWhole: false, plan: summaryOf(plan) });
      expect(indexesOf(plan)).toContain(
        `Monitor:${await probeableIndexName()}`,
      );
      expect(buffersOf(plan)).toBeLessThan(COUNT_BUFFER_BOUND);

      // And it counts every due row of the probe: all of them may be probed.
      const rows: Array<Record<string, unknown>> = await rowsOf(statement);
      expect(rows[0]!["count"]).toBe(
        (ONE_MINUTE_ASSIGNMENTS + FIVE_MINUTE_ASSIGNMENTS) / PROBES,
      );
    });

    test("as main had it, without that index, the same count read every page of Monitor (#11119)", async () => {
      const statement: CapturedStatement = await countStatement(probeIds[1]!);
      const index: string = await probeableIndexName();
      const runner: QueryRunner = database.createQueryRunner();
      await runner.connect();

      try {
        await runner.query("BEGIN");
        await runner.query(`DROP INDEX "${schema}"."${index}"`);

        const rows: Array<{ "QUERY PLAN": Array<ExplainedPlan> }> =
          await runner.query(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`,
            statement.parameters,
          );
        const plan: ExplainedPlan = rows[0]!["QUERY PLAN"][0]!;
        const pages: Array<{ relpages: number }> = await runner.query(
          `SELECT relpages FROM pg_class WHERE oid = $1::regclass`,
          [`"${schema}"."Monitor"`],
        );

        expect(seqScansOf(plan)).toContain("Monitor");
        expect(buffersOf(plan)).toBeGreaterThanOrEqual(pages[0]!.relpages);
        expect(buffersOf(plan)).toBeGreaterThan(COUNT_BUFFER_BOUND * 5);
      } finally {
        await runner.query("ROLLBACK");
        await runner.release();
      }
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
