import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import MonitorProbeService, {
  ClaimedMonitorProbe,
  PENDING_MONITOR_PROBE_COUNT_CAP,
} from "../../../Server/Services/MonitorProbeService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import CronTab from "../../../Server/Utils/CronTab";
import logger from "../../../Server/Utils/Logger";
import { SET_ASIDE_FOR_MINUTES } from "../../../Server/Utils/Probe/ClaimSetAside";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
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
import { createHash } from "crypto";
import { DataSource, QueryRunner } from "typeorm";

/*
 * TWO PROBES CLAIMING AT ONCE, AT 40,000 ASSIGNMENTS, ON POSTGRES
 * (issues #11119 and #11120).
 *
 * 40,000 Website monitors, the steps the Dashboard makes for one, each on
 * one of two probes - 20,000 a probe, all due, as when a probe has fallen
 * behind - with 1 in 100 paused. Both probes' workers claim at once, the
 * way a probe's FetchList does (ask again while a batch comes back full),
 * on the real statements, and:
 *
 *   - every assignment that may be probed is handed out exactly once, to
 *     its own probe, and none that may not (#10819's claim: SKIP LOCKED, a
 *     batch never short while rows are due, the set-aside);
 *   - each comes with its monitor, read by the claim's own statement, and
 *     that monitor is to the byte the one the read after the claim used to
 *     hand the probe (MonitorProbeService.findBy, as main had it, #11120);
 *   - each is written its last ping and the next run of its schedule, as
 *     before;
 *   - each probe's pending count, which its KEDA autoscaler reads, counts
 *     exactly what the claim's rule hands out, up to the cap, and reads by
 *     index: the due rows and the ids of the monitors a probe may check,
 *     never the whole Monitor table (#11119) - also while the other probe
 *     claims, as the claim itself does.
 *
 * Opt in with RUN_POSTGRES_PROBE_DISPATCH_SCALE_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The tables' STRUCTURE is cloned
 * into a unique schema (search_path holds only that schema) that is dropped
 * afterwards. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from PROBE_DISPATCH_SCALE_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from PROBE_DISPATCH_SCALE_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PROBE_DISPATCH_SCALE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["Project", "Monitor", "MonitorProbe"];

const ASSIGNMENTS: number = 40_000;
const PROJECTS: number = 40;
// One monitor in this many is paused: due, never handed out.
const PAUSED_EVERY: number = 100;
// One in this many is checked every five minutes, the rest every minute.
const FIVE_MINUTES_EVERY: number = 4;
const WORKERS_PER_PROBE: number = 6;
const FETCH_LIMIT: number = 10;
const STEPS_DOCUMENTS: number = 100;

const ONE_MINUTE: string = "* * * * *";
const FIVE_MINUTES: string = "*/5 * * * *";
const MINUTE_IN_MS: number = 60 * 1000;

// What a claim or a count may read, with room to spare (measured: below 450 and 650).
const CLAIM_BUFFER_BOUND: number = 2000;
const COUNT_BUFFER_BOUND: number = 1500;

interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Actual Loops"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: Array<PlanNode>;
}

interface ExplainedPlan {
  Plan: PlanNode;
}

interface CapturedStatement {
  sql: string;
  parameters: Array<unknown>;
}

// A batch one worker was handed, and when it asked.
interface Handed {
  probe: string;
  askedAt: number;
  answeredAt: number;
  claimed: Array<{ monitorProbeId: string; monitorId: string; digest: string }>;
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

// The plan in one line a failure shows.
function summaryOf(plan: ExplainedPlan): string {
  return nodesOf(plan.Plan)
    .map((node: PlanNode): string => {
      return `${node["Node Type"]}${node["Relation Name"] ? ` ${node["Relation Name"]}` : ""}${node["Index Name"] ? ` (${node["Index Name"]})` : ""} x${node["Actual Loops"] ?? "?"} ${(node["Shared Hit Blocks"] || 0) + (node["Shared Read Blocks"] || 0)}p`;
    })
    .join(" | ");
}

// The big tables read whole by a scan that ran.
function seqScansOf(plan: ExplainedPlan): Array<string> {
  return nodesOf(plan.Plan)
    .filter((node: PlanNode): boolean => {
      return (
        node["Node Type"] === "Seq Scan" &&
        (node["Actual Loops"] || 0) > 0 &&
        ["Monitor", "MonitorProbe"].includes(String(node["Relation Name"]))
      );
    })
    .map((node: PlanNode): string => {
      return String(node["Relation Name"]);
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

/*
 * A monitor as the probe is sent it, in a few bytes: two reads that send
 * the probe the same JSON have the same digest.
 */
function digestOf(monitor: Monitor): string {
  return createHash("sha1")
    .update(JSON.stringify(BaseModel.toJSON(monitor, Monitor)))
    .digest("hex");
}

// The next run of a schedule after `at`, as cron puts it.
function nextRunAfter(interval: string, at: number): number {
  const everyMs: number =
    interval === FIVE_MINUTES ? 5 * MINUTE_IN_MS : MINUTE_IN_MS;
  return (Math.floor(at / everyMs) + 1) * everyMs;
}

describePostgres(
  "two probes claiming at once, at 40,000 assignments, on Postgres",
  () => {
    const schema: string = `probe_dispatch_scale_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;
    const probeIds: Array<string> = [
      ObjectID.generate().toString(),
      ObjectID.generate().toString(),
    ];

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["PROBE_DISPATCH_SCALE_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["PROBE_DISPATCH_SCALE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PROBE_DISPATCH_SCALE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        // Both probes' workers at once, a count and an EXPLAIN beside them.
        extra: {
          options: `-c search_path=${schema} -c jit=off -c lock_timeout=10000`,
          max: 2 * WORKERS_PER_PROBE + 4,
          connectionTimeoutMillis: 20000,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );

        // A fixture names only what the statements touch.
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

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);

      await database.query(
        `INSERT INTO "Project" ("_id", "name", "isBlocked", "version")
         SELECT gen_random_uuid(), 'Project ' || n, false, 1
         FROM generate_series(1, $1) AS n`,
        [PROJECTS],
      );

      // A Website monitor's steps as the Dashboard makes them, as stored.
      const stepsDocuments: Array<string> = [];

      for (let document: number = 0; document < STEPS_DOCUMENTS; document++) {
        stepsDocuments.push(
          JSON.stringify(
            MonitorSteps.getDatabaseTransformer().to(
              MonitorSteps.getDefaultMonitorSteps({
                defaultMonitorStatusId: ObjectID.generate(),
                monitorType: MonitorType.Website,
                monitorName: `Website ${document}`,
                onlineMonitorStatusId: ObjectID.generate(),
                offlineMonitorStatusId: ObjectID.generate(),
                defaultIncidentSeverityId: ObjectID.generate(),
                defaultAlertSeverityId: ObjectID.generate(),
              }),
            ),
          ),
        );
      }

      await database.query(
        `INSERT INTO "Monitor"
           ("_id", "projectId", "name", "monitorType", "monitoringInterval",
            "monitorSteps", "isArchived", "disableActiveMonitoring",
            "disableActiveMonitoringBecauseOfManualIncident",
            "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent",
            "version")
         SELECT gen_random_uuid(),
           (SELECT array_agg("_id") FROM "Project")[1 + (n % $2)],
           'Website ' || n, 'Website',
           CASE WHEN n % $3 = 0 THEN $4 ELSE $5 END,
           ($6::jsonb[])[1 + (n % $7)],
           false, n % $8 = 7, false, false, 1
         FROM generate_series(0, $1 - 1) AS n`,
        [
          ASSIGNMENTS,
          PROJECTS,
          FIVE_MINUTES_EVERY,
          FIVE_MINUTES,
          ONE_MINUTE,
          stepsDocuments,
          STEPS_DOCUMENTS,
          PAUSED_EVERY,
        ],
      );

      // Every assignment due, a second to a minute ago, on one probe or the other.
      await database.query(
        `INSERT INTO "MonitorProbe"
           ("_id", "projectId", "probeId", "monitorId", "isEnabled",
            "nextPingAt", "version")
         SELECT gen_random_uuid(), x."projectId",
           ($1::uuid[])[1 + (x.position % 2)], x."_id", true,
           now() - (1 + random() * 59) * INTERVAL '1 second', 1
         FROM (
           SELECT m."_id", m."projectId",
             (row_number() OVER (ORDER BY m."_id"))::int AS position
           FROM "Monitor" m
         ) x`,
        [probeIds],
      );

      for (const table of TABLES) {
        await database.query(`VACUUM ANALYZE "${schema}"."${table}"`);
      }
    }, 600_000);

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
      CronTab.clearNextExecutionMemo();
    });

    // The statement a service call sends first, answered `answer`.
    async function statementOf(
      call: () => Promise<unknown>,
      answer: Array<Record<string, unknown>>,
    ): Promise<CapturedStatement> {
      const statements: Array<CapturedStatement> = [];
      const spy: { mockRestore: () => void } = jest
        .spyOn(
          MonitorProbeService as unknown as { getRepository: () => unknown },
          "getRepository",
        )
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

      await call();
      spy.mockRestore();
      return statements[0]!;
    }

    function countStatementOf(probe: string): Promise<CapturedStatement> {
      return statementOf(() => {
        return MonitorProbeService.countMonitorProbesDueForProbing({
          probeId: new ObjectID(probe),
          dueAt: new Date(),
        });
      }, [{ count: 0 }]);
    }

    function claimStatementOf(probe: string): Promise<CapturedStatement> {
      return statementOf(() => {
        return MonitorProbeService.claimMonitorProbesForProbing({
          probeId: new ObjectID(probe),
          limit: FETCH_LIMIT,
        });
      }, [{ _id: null, steppedOver: false }]);
    }

    // EXPLAIN (ANALYZE, BUFFERS) of a statement as sent, rolled back.
    async function explain(
      statement: CapturedStatement,
    ): Promise<ExplainedPlan> {
      const runner: QueryRunner = database.createQueryRunner();
      await runner.connect();

      try {
        await runner.query("BEGIN");
        const rows: Array<{ "QUERY PLAN": Array<ExplainedPlan> }> =
          await runner.query(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`,
            statement.parameters,
          );
        return rows[0]!["QUERY PLAN"][0]!;
      } finally {
        await runner.query("ROLLBACK");
        await runner.release();
      }
    }

    // This schema's copy of the index of the monitors a probe may check.
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
     * What may be handed to `probe` and is due by `dueAt`, counted
     * without a cap by the rule written out here - the monitor and its
     * project may be probed - not by the service's own SQL.
     */
    async function mayBeHandedOut(probe: string, dueAt: Date): Promise<number> {
      const rows: Array<{ count: number }> = await database.query(
        `SELECT COUNT(*)::int AS "count"
         FROM "MonitorProbe" mp
         JOIN "Monitor" m ON m."_id" = mp."monitorId"
         JOIN "Project" p ON p."_id" = mp."projectId"
         WHERE mp."probeId" = $1 AND mp."isEnabled" AND mp."nextPingAt" <= $2
           AND mp."deletedAt" IS NULL
           AND NOT m."isArchived" AND NOT m."disableActiveMonitoring"
           AND NOT m."disableActiveMonitoringBecauseOfManualIncident"
           AND NOT m."disableActiveMonitoringBecauseOfScheduledMaintenanceEvent"
           AND m."deletedAt" IS NULL AND p."deletedAt" IS NULL
           AND NOT p."isBlocked"
           AND (p."paymentProviderSubscriptionStatus" IS NULL
             OR p."paymentProviderSubscriptionStatus" = ANY($3::text[]))
           AND (p."paymentProviderMeteredSubscriptionStatus" IS NULL
             OR p."paymentProviderMeteredSubscriptionStatus" = ANY($3::text[]))`,
        [probe, dueAt, SubscriptionStatusUtil.getActiveSubscriptionStatuses()],
      );
      return rows[0]!.count;
    }

    /*
     * One probe worker, as FetchList runs one: ask for a batch, and again
     * while the batch comes back full.
     */
    async function worker(probe: string): Promise<Array<Handed>> {
      const batches: Array<Handed> = [];

      for (;;) {
        const askedAt: number = Date.now();
        const claimed: Array<ClaimedMonitorProbe> =
          await MonitorProbeService.claimMonitorProbesForProbing({
            probeId: new ObjectID(probe),
            limit: FETCH_LIMIT,
          });

        batches.push({
          probe: probe,
          askedAt: askedAt,
          answeredAt: Date.now(),
          claimed: claimed.map(
            (
              one: ClaimedMonitorProbe,
            ): {
              monitorProbeId: string;
              monitorId: string;
              digest: string;
            } => {
              return {
                monitorProbeId: one.monitorProbeId.toString(),
                monitorId: one.monitor._id || "",
                digest: digestOf(one.monitor),
              };
            },
          ),
        });

        if (claimed.length < FETCH_LIMIT) {
          return batches;
        }
      }
    }

    test("the seed: 20,000 due on each probe, 1 in 100 paused", async () => {
      const rows: Array<{ probeId: string; count: number }> =
        await database.query(
          `SELECT "probeId", COUNT(*)::int AS "count" FROM "MonitorProbe"
           WHERE "nextPingAt" <= now() GROUP BY "probeId"`,
        );

      expect(
        rows
          .map((row: { probeId: string; count: number }): number => {
            return row.count;
          })
          .sort(),
      ).toEqual([ASSIGNMENTS / 2, ASSIGNMENTS / 2]);

      // Both over the count's cap, and every paused monitor left out.
      const mayBe: Array<number> = [
        await mayBeHandedOut(probeIds[0]!, new Date()),
        await mayBeHandedOut(probeIds[1]!, new Date()),
      ];
      expect(mayBe[0]! + mayBe[1]!).toBe(
        ASSIGNMENTS - ASSIGNMENTS / PAUSED_EVERY,
      );
      expect(Math.min(...mayBe)).toBeGreaterThan(
        PENDING_MONITOR_PROBE_COUNT_CAP,
      );
    });

    /*
     * Half of MonitorProbe is each probe's, and all of it due: Postgres
     * reads that half by reading the table, the cheapest way to 20,000 of
     * its 40,000 rows. What #11119 was about is the other side of the join:
     * the monitors, which it now reads by their ids alone, and only until
     * the cap is reached.
     */
    test("each probe's pending count is its cap, counted by the ids of the monitors it may check, not the whole Monitor table", async () => {
      const index: string = await probeableIndexName();

      for (const probe of probeIds) {
        const statement: CapturedStatement = await countStatementOf(probe);
        const plan: ExplainedPlan = await explain(statement);

        expect({
          monitorReadWhole: seqScansOf(plan).includes("Monitor"),
          plan: summaryOf(plan),
        }).toEqual({ monitorReadWhole: false, plan: summaryOf(plan) });
        expect(indexesOf(plan)).toContain(`Monitor:${index}`);
        expect(buffersOf(plan)).toBeLessThan(COUNT_BUFFER_BOUND);

        await expect(
          MonitorProbeService.countMonitorProbesDueForProbing({
            probeId: new ObjectID(probe),
            dueAt: new Date(),
          }),
        ).resolves.toBe(PENDING_MONITOR_PROBE_COUNT_CAP);
      }
    });

    test("as main had it, without that index, the same count read Monitor's own pages, a scan of the table (#11119)", async () => {
      const statement: CapturedStatement = await countStatementOf(probeIds[0]!);
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

        expect(seqScansOf(plan)).toContain("Monitor");
      } finally {
        await runner.query("ROLLBACK");
        await runner.release();
      }
    });

    test("under its cap, the count is exactly what the claim's rule hands out", async () => {
      // Waiting for more than 50 seconds: a few thousand, under the cap.
      const dueAt: Date = new Date(Date.now() - 50 * 1000);
      const expected: number = await mayBeHandedOut(probeIds[1]!, dueAt);

      expect(expected).toBeGreaterThan(0);
      expect(expected).toBeLessThan(PENDING_MONITOR_PROBE_COUNT_CAP);
      await expect(
        MonitorProbeService.countMonitorProbesDueForProbing({
          probeId: new ObjectID(probeIds[1]!),
          dueAt: dueAt,
        }),
      ).resolves.toBe(expected);
    });

    test("while the other probe's workers claim, a probe's claim reads by index and its count never reads all of Monitor, a few hundred pages each", async () => {
      const claim: CapturedStatement = await claimStatementOf(probeIds[0]!);
      const count: CapturedStatement = await countStatementOf(probeIds[0]!);
      let claiming: boolean = true;

      // The other probe's workers, claiming until told to stop.
      const others: Promise<void> = Promise.all(
        Array.from({ length: WORKERS_PER_PROBE }, async () => {
          while (claiming) {
            await MonitorProbeService.claimMonitorProbesForProbing({
              probeId: new ObjectID(probeIds[1]!),
              limit: FETCH_LIMIT,
            });
          }
        }),
      ).then((): void => {
        return undefined;
      });

      try {
        // The claim reads no table whole.
        const claimPlan: ExplainedPlan = await explain(claim);
        expect({
          seqScans: seqScansOf(claimPlan),
          plan: summaryOf(claimPlan),
        }).toEqual({ seqScans: [], plan: summaryOf(claimPlan) });
        expect(buffersOf(claimPlan)).toBeLessThan(CLAIM_BUFFER_BOUND);

        // The count reads its own probe's rows, never the whole of Monitor.
        const countPlan: ExplainedPlan = await explain(count);
        expect({
          monitorReadWhole: seqScansOf(countPlan).includes("Monitor"),
          plan: summaryOf(countPlan),
        }).toEqual({ monitorReadWhole: false, plan: summaryOf(countPlan) });
        expect(buffersOf(countPlan)).toBeLessThan(COUNT_BUFFER_BOUND);
      } finally {
        claiming = false;
        await others;
      }

      // Hand the other probe's rows back to due for the next test.
      await database.query(
        `UPDATE "MonitorProbe"
         SET "nextPingAt" = now() - (1 + random() * 59) * INTERVAL '1 second',
             "lastPingAt" = NULL
         WHERE "probeId" = $1`,
        [probeIds[1]],
      );
      await database.query(`VACUUM ANALYZE "${schema}"."MonitorProbe"`);
    });

    test("both probes' workers at once hand out every assignment that may be probed exactly once, to its own probe, each with the monitor the read after the claim used to hand out", async () => {
      const startedAt: number = Date.now();
      const expected: Array<number> = [
        await mayBeHandedOut(probeIds[0]!, new Date()),
        await mayBeHandedOut(probeIds[1]!, new Date()),
      ];

      const batches: Array<Handed> = (
        await Promise.all(
          probeIds.flatMap((probe: string): Array<Promise<Array<Handed>>> => {
            return Array.from({ length: WORKERS_PER_PROBE }, () => {
              return worker(probe);
            });
          }),
        )
      ).flat();

      const handed: Array<{
        probe: string;
        monitorProbeId: string;
        monitorId: string;
        digest: string;
        askedAt: number;
        answeredAt: number;
      }> = batches.flatMap((batch: Handed) => {
        return batch.claimed.map((one: Handed["claimed"][number]) => {
          return {
            ...one,
            probe: batch.probe,
            askedAt: batch.askedAt,
            answeredAt: batch.answeredAt,
          };
        });
      });

      // Exactly once each, and exactly what may be probed, per probe.
      expect(
        new Set(
          handed.map((one: { monitorProbeId: string }): string => {
            return one.monitorProbeId;
          }),
        ).size,
      ).toBe(handed.length);
      for (let index: number = 0; index < probeIds.length; index++) {
        expect(
          handed.filter((one: { probe: string }): boolean => {
            return one.probe === probeIds[index];
          }).length,
        ).toBe(expected[index]);
      }

      /*
       * No worker was sent away while its probe still had rows due: each
       * stopped at its first short batch, and nothing that may be probed
       * is left due (#10819's collision fix).
       */
      expect(await mayBeHandedOut(probeIds[0]!, new Date())).toBe(0);
      expect(await mayBeHandedOut(probeIds[1]!, new Date())).toBe(0);
      expect(
        batches.filter((batch: Handed): boolean => {
          return batch.claimed.length < FETCH_LIMIT;
        }).length,
      ).toBe(2 * WORKERS_PER_PROBE);

      // Each row is the claiming probe's, its monitor the row's own.
      const rows: Array<{
        _id: string;
        probeId: string;
        monitorId: string;
        lastPingAt: Date | null;
        nextPingAt: Date | null;
        monitoringInterval: string;
        disableActiveMonitoring: boolean;
      }> = await database.query(
        `SELECT mp."_id"::text AS "_id", mp."probeId"::text AS "probeId",
           mp."monitorId"::text AS "monitorId", mp."lastPingAt",
           mp."nextPingAt", m."monitoringInterval",
           m."disableActiveMonitoring"
         FROM "MonitorProbe" mp JOIN "Monitor" m ON m."_id" = mp."monitorId"`,
      );
      const rowById: Map<string, (typeof rows)[number]> = new Map(
        rows.map((row: (typeof rows)[number]) => {
          return [row._id, row];
        }),
      );

      for (const one of handed) {
        const row: (typeof rows)[number] = rowById.get(one.monitorProbeId)!;

        expect(row.probeId).toBe(one.probe);
        expect(row.monitorId).toBe(one.monitorId);
        expect(row.disableActiveMonitoring).toBe(false);

        // Its last ping is its claim's; its next check its schedule's next run.
        expect(row.lastPingAt!.getTime()).toBeGreaterThanOrEqual(
          one.askedAt - 1000,
        );
        expect(row.lastPingAt!.getTime()).toBeLessThanOrEqual(
          one.answeredAt + 1000,
        );
        expect([
          nextRunAfter(row.monitoringInterval, row.lastPingAt!.getTime()),
          nextRunAfter(
            row.monitoringInterval,
            row.lastPingAt!.getTime() + 1000,
          ),
        ]).toContain(row.nextPingAt!.getTime());
      }

      // The paused ones were never handed out, and are set aside.
      for (const row of rows) {
        if (row.disableActiveMonitoring) {
          expect(row.nextPingAt!.getTime()).toBeGreaterThanOrEqual(
            startedAt + SET_ASIDE_FOR_MINUTES * MINUTE_IN_MS - 1000,
          );
        }
      }

      /*
       * Each monitor, to the byte, as the read after the claim handed it
       * to the probe before #11120: that read, as main ran it, of every
       * row handed out.
       */
      const digestById: Map<string, string> = new Map(
        handed.map((one: { monitorProbeId: string; digest: string }) => {
          return [one.monitorProbeId, one.digest];
        }),
      );
      const ids: Array<string> = Array.from(digestById.keys());
      let compared: number = 0;

      for (let start: number = 0; start < ids.length; start += 1000) {
        const chunk: Array<string> = ids.slice(start, start + 1000);
        const read: Array<MonitorProbe> = await MonitorProbeService.findBy({
          query: {
            _id: QueryHelper.any(
              chunk.map((id: string): ObjectID => {
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
          limit: chunk.length,
          skip: 0,
          props: { isRoot: true },
        });

        expect(read).toHaveLength(chunk.length);

        for (const monitorProbe of read) {
          expect(digestOf(monitorProbe.monitor!)).toBe(
            digestById.get(monitorProbe.id!.toString()),
          );
          compared++;
        }
      }

      expect(compared).toBe(handed.length);
    }, 600_000);

    test("and once everything that may be probed is handed out, each probe's pending count is 0", async () => {
      for (const probe of probeIds) {
        await expect(
          MonitorProbeService.countMonitorProbesDueForProbing({
            probeId: new ObjectID(probe),
            dueAt: new Date(),
          }),
        ).resolves.toBe(0);
      }
    });
  },
);
