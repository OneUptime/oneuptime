import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import MonitorService from "../../../../Server/Services/MonitorService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import logger from "../../../../Server/Utils/Logger";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import NotOperationalMonitorQuery from "../../../../Utils/Monitor/NotOperationalMonitorQuery";
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
import { DataSource, Logger as TypeOrmLogger } from "typeorm";

/*
 * MONITOR'S INDEXES ON POSTGRES (MatchMonitorIndexesToTheirReads1809165000000).
 *
 * Which index a read can use, and whether a write is a HOT update, only a
 * database answers. So this asks one migrated to the current head:
 *
 *   - the migrated "Monitor" carries exactly the indexes the model declares,
 *     every one valid (an online build that failed part way leaves an
 *     INVALID one behind), none names a column the busiest writes move, and
 *     a tenth of every page is kept free for the next update (fillfactor 90,
 *     SetMonitorFillfactor);
 *   - the reads those indexes are for, as the services build them - a
 *     device delete's count of its automatic monitors and its foreign key
 *     check, the Monitors menu's counts (Not Operational asked in its
 *     project, through currentMonitorStatusId), the list's first page and a
 *     heartbeat sweep's page - each can be answered from its index;
 *   - the busiest writes - the telemetry sweep's stamp, the heartbeats, a
 *     request, an email, a server report - are HOT updates, which write no
 *     index entry; a status change is not, nor is the telemetry stamp with
 *     the index on telemetryMonitorLastMonitorAt back, as main had it.
 *
 * Opt in with RUN_POSTGRES_MONITOR_INDEX_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The Project, MonitorStatus and
 * Monitor tables' STRUCTURE (indexes included) is cloned into a unique schema that is
 * dropped afterwards; the public tables are only read. One connection, so a
 * statement's counts are flushed before they are read
 * (pg_stat_force_next_flush). Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from MONITOR_INDEX_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from MONITOR_INDEX_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MONITOR_INDEX_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["Project", "MonitorStatus", "Monitor"];

const NOW: Date = new Date("2026-11-14T10:00:00.000Z");

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

// A read, as TypeORM sends one: what the planner is asked about here.
const SELECT_STATEMENT: RegExp = /^\s*SELECT/i;

interface Captured {
  sql: string;
  parameters: Array<unknown>;
}

// What the migrated table has: columns, then the WHERE as Postgres prints it.
const EXPECTED_INDEXES: ReadonlyArray<{
  columns: string;
  predicate: string | null;
  isUnique: boolean;
}> = [
  { columns: "_id", predicate: null, isUnique: true },
  { columns: "slug", predicate: null, isUnique: true },
  { columns: "incomingEmailCustomLocalPart", predicate: null, isUnique: true },
  { columns: "name", predicate: null, isUnique: false },
  { columns: "currentMonitorStatusId", predicate: null, isUnique: false },
  {
    columns: "isOwnerNotifiedOfResourceCreation",
    predicate: null,
    isUnique: false,
  },
  { columns: "serverMonitorSecretKey", predicate: null, isUnique: false },
  { columns: "incomingRequestSecretKey", predicate: null, isUnique: false },
  { columns: "incomingEmailSecretKey", predicate: null, isUnique: false },
  /*
   * The keys' lookup hashes, which a request presenting a key finds its
   * monitor by now that the key is kept encrypted (#9012: built online by
   * PresentedKeyLookupHashIndexes1809182940000).
   */
  { columns: "serverMonitorSecretKeyHash", predicate: null, isUnique: false },
  { columns: "incomingRequestSecretKeyHash", predicate: null, isUnique: false },
  { columns: "incomingEmailSecretKeyHash", predicate: null, isUnique: false },
  { columns: "monitorTemplateId", predicate: null, isUnique: false },
  { columns: "networkAlertPolicyId", predicate: null, isUnique: false },
  {
    columns: "autoProvisionedNetworkDeviceId,monitorTemplateId",
    predicate:
      '(("deletedAt" IS NULL) AND ("autoProvisionedNetworkDeviceId" IS NOT NULL) AND ("monitorTemplateId" IS NOT NULL))',
    isUnique: true,
  },
  {
    columns: "projectId,isArchived,createdAt",
    predicate: null,
    isUnique: false,
  },
  {
    columns: "autoProvisionedNetworkDeviceId",
    predicate: '("autoProvisionedNetworkDeviceId" IS NOT NULL)',
    isUnique: false,
  },
  /*
   * The network device a person tied the monitor to, which the device's
   * pages, an import's duplicate check and a device delete's SET NULL read
   * by (#9545: built online by AddMonitorNetworkDeviceIdIndexAndKey
   * 1809184900100, partial on non-null).
   */
  {
    columns: "networkDeviceId",
    predicate: '("networkDeviceId" IS NOT NULL)',
    isUnique: false,
  },
  { columns: "monitorType,_id", predicate: null, isUnique: false },
  {
    columns: "projectId",
    predicate:
      '(("isAllProbesDisconnectedFromThisMonitor" = true) AND ("isArchived" = false) AND ("deletedAt" IS NULL))',
    isUnique: false,
  },
  {
    columns: "projectId",
    predicate:
      '(("isNoProbeEnabledOnThisMonitor" = true) AND ("isArchived" = false) AND ("deletedAt" IS NULL))',
    isUnique: false,
  },
  {
    columns: "projectId",
    predicate:
      '(("disableActiveMonitoring" = true) AND ("isArchived" = false) AND ("deletedAt" IS NULL))',
    isUnique: false,
  },
];

// The columns the busiest writes move, row after row.
const MOVED_BY_THE_BUSIEST_WRITES: ReadonlyArray<string> = [
  "telemetryMonitorLastMonitorAt",
  "telemetryMonitorNextMonitorAt",
  "incomingRequestMonitorHeartbeatCheckedAt",
  "incomingEmailMonitorHeartbeatCheckedAt",
  "incomingEmailMonitorLastEmailReceivedAt",
  "incomingEmailMonitorRequest",
  "incomingMonitorRequest",
  "incomingMonitorRequestAsReceived",
  "serverMonitorRequestReceivedAt",
  "serverMonitorResponse",
  "updatedAt",
  "version",
];

/*
 * Records the statements the services send while `capturing` is on, so the
 * test plans exactly those, with their parameters.
 */
class CapturingLogger implements TypeOrmLogger {
  public capturing: boolean = false;
  public captured: Array<Captured> = [];

  public logQuery(query: string, parameters?: Array<unknown>): void {
    if (this.capturing) {
      this.captured.push({ sql: query, parameters: parameters || [] });
    }
  }

  public logQueryError(): void {}
  public logQuerySlow(): void {}
  public logSchemaBuild(): void {}
  public logMigration(): void {}
  public log(): void {}
}

function indexesUsedBy(plan: JSONObject): Array<string> {
  const names: Array<string> = [];
  const visit: (node: JSONObject) => void = (node: JSONObject): void => {
    if (typeof node["Index Name"] === "string") {
      names.push(node["Index Name"] as string);
    }
    for (const child of (node["Plans"] as Array<JSONObject>) || []) {
      visit(child);
    }
  };
  visit(plan);
  return names;
}

describePostgres("Monitor's indexes, on Postgres", () => {
  const schema: string = `monitor_indexes_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const captureLogger: CapturingLogger = new CapturingLogger();
  let database: DataSource;

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
        ORDER BY 2, 3`,
      [table],
    );
  }

  // The clone's name for the index with these columns and WHERE.
  async function cloneIndex(
    columns: string,
    predicate: string | null,
  ): Promise<string> {
    const matches: Array<IndexRow> = (
      await indexesOf(`"${schema}"."Monitor"`)
    ).filter((index: IndexRow): boolean => {
      return index.columns === columns && index.predicate === predicate;
    });

    expect(matches).toHaveLength(1);

    return matches[0]!.name;
  }

  // The statements one call sends.
  async function statementsOf(
    run: () => Promise<unknown>,
  ): Promise<Array<Captured>> {
    captureLogger.captured = [];
    captureLogger.capturing = true;
    try {
      await run();
    } finally {
      captureLogger.capturing = false;
    }
    return captureLogger.captured.filter((statement: Captured): boolean => {
      return SELECT_STATEMENT.test(statement.sql);
    });
  }

  // The indexes the planner reads to answer one statement, sequential scans off.
  async function indexesPlannedFor(
    statement: Captured,
  ): Promise<Array<string>> {
    await database.query("SET enable_seqscan = off");
    try {
      const rows: Array<{ "QUERY PLAN": Array<{ Plan: JSONObject }> }> =
        await database.query(
          `EXPLAIN (FORMAT JSON) ${statement.sql}`,
          statement.parameters,
        );
      return indexesUsedBy(rows[0]!["QUERY PLAN"][0]!.Plan);
    } finally {
      await database.query("SET enable_seqscan = on");
    }
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["MONITOR_INDEX_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["MONITOR_INDEX_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MONITOR_INDEX_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      logging: true,
      logger: captureLogger,
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

  beforeEach(() => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation((() => {
        return undefined;
      }) as never);
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the migrated table", () => {
    test("carries exactly the indexes the model declares, every one valid", async () => {
      const indexes: Array<IndexRow> = await indexesOf(`public."Monitor"`);

      const describeIndex: (index: {
        columns: string;
        predicate: string | null;
        isUnique: boolean;
      }) => string = (index: {
        columns: string;
        predicate: string | null;
        isUnique: boolean;
      }): string => {
        return `${index.isUnique ? "UNIQUE " : ""}(${index.columns})${
          index.predicate ? ` WHERE ${index.predicate}` : ""
        }`;
      };

      expect(indexes.map(describeIndex).sort()).toEqual(
        EXPECTED_INDEXES.map(describeIndex).sort(),
      );
      expect(
        indexes.filter((index: IndexRow): boolean => {
          return !index.isValid;
        }),
      ).toEqual([]);
    });

    test("no index names a column the busiest writes move", async () => {
      const indexes: Array<IndexRow> = await indexesOf(`public."Monitor"`);

      expect(
        indexes.flatMap((index: IndexRow): Array<string> => {
          return MOVED_BY_THE_BUSIEST_WRITES.filter(
            (column: string): boolean => {
              return (
                index.columns.split(",").includes(column) ||
                (index.predicate || "").includes(`"${column}"`)
              );
            },
          ).map((column: string): string => {
            return `${index.name} names ${column}`;
          });
        }),
      ).toEqual([]);
    });

    /*
     * Room on every page for the next update (SetMonitorFillfactor): with
     * no index on what they move, it is all the busiest writes need to be
     * HOT.
     */
    test("keeps a tenth of every page free: fillfactor 90", async () => {
      const rows: Array<{ reloptions: Array<string> | null }> =
        await database.query(
          `SELECT reloptions FROM pg_class WHERE oid = 'public."Monitor"'::regclass`,
        );

      expect(
        (rows[0]?.reloptions || []).filter((option: string): boolean => {
          return option.startsWith("fillfactor=");
        }),
      ).toEqual(["fillfactor=90"]);
    });
  });

  describe("the reads, each answered from its index", () => {
    const PROJECT_ID: ObjectID = ObjectID.generate();
    const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
    const DEVICE_ID: ObjectID = new ObjectID(
      "d0110000-0001-4000-8000-000000000007",
    );

    /*
     * Two projects of 2,000 monitors each, with every kind the indexes tell
     * apart, among 300 smaller ones, then ANALYZE: plans as a shared table's
     * would be. As in one, every project has statuses of its own, and a
     * project's monitors lie among other projects' rather than side by
     * side. Both decide whether Postgres starts a Not Operational count
     * from the project's statuses or from its monitors (issue #8096): with
     * two projects, inserted one after the other, it read the monitors.
     */
    beforeAll(async () => {
      await database.query(
        `TRUNCATE "${schema}"."Monitor", "${schema}"."MonitorStatus", "${schema}"."Project"`,
      );

      /*
       * Every project, and the g its monitors are made from. A smaller
       * project's are g 1201 to 1207: seven websites, none archived or
       * flagged, one of them degraded.
       */
      const projects: string = `
        SELECT id, 1 AS first_g, 2000 AS last_g FROM unnest($1::uuid[]) AS id
        UNION ALL
        SELECT ('a0110000-0002-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid, 1201, 1207
          FROM generate_series(1, 300) AS n`;
      const projectIds: Array<string> = [
        PROJECT_ID.toString(),
        OTHER_PROJECT_ID.toString(),
      ];

      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "isBlocked")
         SELECT p.id, 'Monitor indexes', false FROM (${projects}) AS p`,
        [projectIds],
      );
      // Each project's own statuses: one operational, two not.
      await database.query(
        `INSERT INTO "${schema}"."MonitorStatus"
           ("_id", "projectId", "name", "slug", "color", "priority", "isOperationalState")
         SELECT gen_random_uuid(), p.id, s.name, p.id::text || '-' || s.name, '#000000', s.priority, s.operational
           FROM (${projects}) AS p
          CROSS JOIN (VALUES ('Operational', 1, true), ('Degraded', 2, false), ('Offline', 3, false))
                AS s(name, priority, operational)`,
        [projectIds],
      );
      // In g order - the order they were created in - so projects interleave.
      await database.query(
        `INSERT INTO "${schema}"."Monitor"
           ("_id", "projectId", "name", "slug", "monitorType", "createdAt", "updatedAt", "version",
            "autoProvisionedNetworkDeviceId", "isArchived", "disableActiveMonitoring",
            "disableActiveMonitoringBecauseOfManualIncident",
            "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent",
            "isAllProbesDisconnectedFromThisMonitor", "isNoProbeEnabledOnThisMonitor",
            "isOwnerNotifiedOfResourceCreation", "currentMonitorStatusId")
         SELECT gen_random_uuid(), p.id, 'Monitor ' || g, p.id::text || '-' || g,
                CASE WHEN g <= 1000 THEN '${MonitorType.NetworkDevice}'
                     WHEN g <= 1100 THEN '${MonitorType.NetworkDevice}'
                     WHEN g <= 1200 THEN '${MonitorType.IncomingRequest}'
                     ELSE '${MonitorType.Website}' END,
                $2::timestamptz - g * INTERVAL '1 minute', $2, 1,
                CASE WHEN g <= 1000
                     THEN ('d0110000-0001-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid
                     ELSE NULL END,
                g % 50 = 0, g % 40 = 0, false, false, g % 30 = 0, g % 45 = 0, true,
                s."_id"
           FROM (${projects}) AS p
          CROSS JOIN LATERAL generate_series(p.first_g, p.last_g) AS g
           JOIN "${schema}"."MonitorStatus" s
             ON s."projectId" = p.id
            AND s."name" = CASE WHEN g % 20 = 0 THEN 'Offline'
                                WHEN g % 20 = 1 THEN 'Degraded'
                                ELSE 'Operational' END
          ORDER BY g, p.id`,
        [projectIds, NOW],
      );
      await database.query(`ANALYZE "${schema}"."Monitor"`);
      await database.query(`ANALYZE "${schema}"."MonitorStatus"`);
      await database.query(`ANALYZE "${schema}"."Project"`);
    });

    /*
     * The Monitors menu's Not Operational count, asked in its project
     * (NotOperationalMonitorQuery, issue #8096): Postgres starts from the
     * project's statuses that are not operational and reads only the
     * monitors holding one, through the index on currentMonitorStatusId -
     * not every monitor of the project.
     */
    test("the Monitors menu's Not Operational count reads only the monitors holding the project's statuses that are not operational", async () => {
      const statements: Array<Captured> = await statementsOf(() => {
        return MonitorService.countBy({
          query: {
            projectId: PROJECT_ID,
            ...NotOperationalMonitorQuery.getQuery(PROJECT_ID),
          },
          props: { isRoot: true },
        });
      });

      expect(statements).toHaveLength(1);
      expect(statements[0]!.sql).toContain(
        `"Monitor__Monitor_currentMonitorStatus"."projectId" = `,
      );

      const indexes: Array<string> = await indexesPlannedFor(statements[0]!);

      expect(indexes).toContain(
        await cloneIndex("currentMonitorStatusId", null),
      );
      expect(indexes).not.toContain(
        await cloneIndex("projectId,isArchived,createdAt", null),
      );
    });

    test("and counts what it should: the project's checked monitors in a status that is not operational", async () => {
      const counted: number = (
        await MonitorService.countBy({
          query: {
            projectId: PROJECT_ID,
            ...NotOperationalMonitorQuery.getQuery(PROJECT_ID),
          },
          props: { isRoot: true },
        })
      ).toNumber();
      const expected: Array<{ count: number }> = await database.query(
        `SELECT count(*)::int AS count
           FROM "${schema}"."Monitor" m
           JOIN "${schema}"."MonitorStatus" s ON s."_id" = m."currentMonitorStatusId"
          WHERE m."projectId" = $1 AND NOT m."isArchived" AND NOT m."disableActiveMonitoring"
            AND m."deletedAt" IS NULL AND NOT s."isOperationalState"`,
        [PROJECT_ID.toString()],
      );

      expect(expected[0]!.count).toBeGreaterThan(0);
      expect(counted).toBe(expected[0]!.count);
      expect(
        (
          await MonitorService.countBy({
            query: {
              projectId: PROJECT_ID,
              ...NotOperationalMonitorQuery.getQuery(),
            },
            props: { isRoot: true },
          })
        ).toNumber(),
      ).toBe(counted);
    });

    /*
     * NetworkDeviceService's preflight before it deletes a device: how many
     * of the device's automatic monitors the caller would delete with it.
     */
    test("a device delete's count of the monitors made for it, from the device index", async () => {
      const statements: Array<Captured> = await statementsOf(() => {
        return MonitorService.countBy({
          query: {
            projectId: PROJECT_ID,
            autoProvisionedNetworkDeviceId: DEVICE_ID,
            networkAlertPolicyId: QueryHelper.isNull(),
          },
          props: { isRoot: true },
        });
      });

      expect(statements).toHaveLength(1);
      expect(await indexesPlannedFor(statements[0]!)).toEqual([
        await cloneIndex(
          "autoProvisionedNetworkDeviceId",
          '("autoProvisionedNetworkDeviceId" IS NOT NULL)',
        ),
      ]);
    });

    test.each([
      ["Probes Disconnected", "isAllProbesDisconnectedFromThisMonitor"],
      ["No Probe Enabled", "isNoProbeEnabledOnThisMonitor"],
      ["Disabled", "disableActiveMonitoring"],
    ])(
      "the Monitors menu's %s count reads only its partial index",
      async (_title: string, flag: string) => {
        const statements: Array<Captured> = await statementsOf(() => {
          // The count the menu asks for (Pages/Monitor/SideMenu.tsx).
          return MonitorService.countBy({
            query: {
              projectId: PROJECT_ID,
              isArchived: false,
              [flag]: true,
            },
            props: { isRoot: true },
          });
        });

        expect(statements).toHaveLength(1);
        expect(await indexesPlannedFor(statements[0]!)).toEqual([
          await cloneIndex(
            "projectId",
            `(("${flag}" = true) AND ("isArchived" = false) AND ("deletedAt" IS NULL))`,
          ),
        ]);
      },
    );

    test("the list's first page, newest first, from (projectId, isArchived, createdAt)", async () => {
      const statements: Array<Captured> = await statementsOf(() => {
        return MonitorService.findBy({
          query: { projectId: PROJECT_ID, isArchived: false },
          select: { _id: true, name: true },
          limit: 10,
          skip: 0,
          props: { isRoot: true },
        });
      });

      expect(statements).toHaveLength(1);
      // Newest first, ties by id (DatabaseService.getReadSort): the selected column's alias.
      expect(statements[0]!.sql).toContain(
        `ORDER BY "Monitor_createdAt" DESC, "Monitor__id" ASC`,
      );
      expect(await indexesPlannedFor(statements[0]!)).toEqual([
        await cloneIndex("projectId,isArchived,createdAt", null),
      ]);
    });

    test("a heartbeat sweep's page, one type in id order, from (monitorType, _id)", async () => {
      const statements: Array<Captured> = await statementsOf(() => {
        // Workers/Utils/MonitorSweep: the sweep's query, past its cursor.
        return MonitorService.findBy({
          query: {
            ...MonitorService.getEnabledMonitorQuery(),
            monitorType: MonitorType.IncomingRequest,
            _id: QueryHelper.greaterThan(
              new ObjectID("00000000-0000-4000-8000-000000000000"),
            ),
          },
          select: { _id: true },
          sort: { _id: SortOrder.Ascending },
          limit: 100,
          skip: 0,
          props: { isRoot: true },
        });
      });

      expect(statements).toHaveLength(1);
      expect(await indexesPlannedFor(statements[0]!)).toEqual([
        await cloneIndex("monitorType,_id", null),
      ]);
    });

    /*
     * ON DELETE RESTRICT: deleting a device runs this, planned generic, for
     * every device deleted. Without an index it can use, that is a read of
     * the whole table each.
     */
    test("a device delete's foreign key check, from the device index", async () => {
      await database.query("SET plan_cache_mode = force_generic_plan");
      await database.query(
        `PREPARE device_restrict_check(uuid) AS
           SELECT 1 FROM ONLY "${schema}"."Monitor" x
            WHERE $1 OPERATOR(pg_catalog.=) "autoProvisionedNetworkDeviceId"
              FOR KEY SHARE OF x`,
      );
      try {
        const rows: Array<{ "QUERY PLAN": Array<{ Plan: JSONObject }> }> =
          await database.query(
            `EXPLAIN (FORMAT JSON) EXECUTE device_restrict_check('${DEVICE_ID.toString()}')`,
          );

        expect(indexesUsedBy(rows[0]!["QUERY PLAN"][0]!.Plan)).toEqual([
          await cloneIndex(
            "autoProvisionedNetworkDeviceId",
            '("autoProvisionedNetworkDeviceId" IS NOT NULL)',
          ),
        ]);
      } finally {
        await database.query("DEALLOCATE device_restrict_check");
        await database.query("SET plan_cache_mode = auto");
      }
    });
  });

  describe("the busiest writes, HOT or not", () => {
    const PROJECT_ID: ObjectID = ObjectID.generate();

    /*
     * The table's update counts so far. pg_stat_force_next_flush makes this
     * connection flush its pending counts as it finishes that statement -
     * before it answers - so the read after it sees every statement before.
     */
    async function counts(): Promise<UpdateCounts> {
      await database.query("SELECT pg_stat_force_next_flush()");
      await database.query("SELECT pg_stat_clear_snapshot()");
      const rows: Array<UpdateCounts> = await database.query(
        `SELECT n_tup_upd::int AS updates, n_tup_hot_upd::int AS hot
           FROM pg_stat_user_tables WHERE relid = $1::regclass`,
        [`"${schema}"."Monitor"`],
      );
      return rows[0]!;
    }

    async function writesOf(
      run: () => Promise<unknown>,
    ): Promise<UpdateCounts> {
      const before: UpdateCounts = await counts();
      await run();
      const after: UpdateCounts = await counts();
      return {
        updates: after.updates - before.updates,
        hot: after.hot - before.hot,
      };
    }

    // One monitor on an empty page: a HOT update needs room on its page.
    async function insertMonitor(monitorType: MonitorType): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();

      await database.query(`TRUNCATE "${schema}"."Monitor"`);
      await database.query(
        `INSERT INTO "${schema}"."Monitor"
           ("_id", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId",
            "createdAt", "updatedAt", "version", "isArchived", "disableActiveMonitoring",
            "disableActiveMonitoringBecauseOfManualIncident",
            "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent",
            "isAllProbesDisconnectedFromThisMonitor", "isNoProbeEnabledOnThisMonitor",
            "isOwnerNotifiedOfResourceCreation")
         VALUES ($1, $2, 'Monitor', $3, $4, $5, $6, $6, 1, false, false, false, false,
                 false, false, true)`,
        [
          id.toString(),
          PROJECT_ID.toString(),
          `monitor-${id.toString()}`,
          monitorType,
          ObjectID.generate().toString(),
          new Date(NOW.getTime() - 60 * 60 * 1000),
        ],
      );

      return id;
    }

    function write(id: ObjectID, data: Record<string, unknown>): Promise<void> {
      return MonitorService.updateColumnsByIdWithoutHooks({
        id,
        data: data as never,
      });
    }

    test("the telemetry sweep's stamp (MonitorTelemetryMonitor) is HOT", async () => {
      const id: ObjectID = await insertMonitor(MonitorType.Metrics);

      expect(
        await writesOf(() => {
          return write(id, {
            telemetryMonitorLastMonitorAt: NOW,
            telemetryMonitorNextMonitorAt: new Date(NOW.getTime() + 60 * 1000),
          });
        }),
      ).toEqual({ updates: 1, hot: 1 });
    });

    test("the incoming request heartbeat's stamp (CheckHeartbeat), and a request (MonitorResource), are HOT", async () => {
      const id: ObjectID = await insertMonitor(MonitorType.IncomingRequest);

      expect(
        await writesOf(() => {
          return write(id, { incomingRequestMonitorHeartbeatCheckedAt: NOW });
        }),
      ).toEqual({ updates: 1, hot: 1 });

      const request: JSONObject = {
        incomingRequestReceivedAt: NOW.toISOString(),
        requestBody: { status: "ok" },
        requestHeaders: { "content-type": "application/json" },
      };

      expect(
        await writesOf(() => {
          return write(id, {
            incomingRequestMonitorHeartbeatCheckedAt: NOW,
            incomingMonitorRequest: request,
            incomingMonitorRequestAsReceived: request,
          });
        }),
      ).toEqual({ updates: 1, hot: 1 });
    });

    test("the incoming email heartbeat's stamp (CheckOnlineStatus), and an email (ProcessProbeIngest), are HOT", async () => {
      const id: ObjectID = await insertMonitor(MonitorType.IncomingEmail);

      expect(
        await writesOf(() => {
          return write(id, { incomingEmailMonitorHeartbeatCheckedAt: NOW });
        }),
      ).toEqual({ updates: 1, hot: 1 });

      expect(
        await writesOf(() => {
          return write(id, {
            incomingEmailMonitorLastEmailReceivedAt: NOW,
            incomingEmailMonitorRequest: { subject: "Backup finished" },
            incomingEmailMonitorHeartbeatCheckedAt: NOW,
          });
        }),
      ).toEqual({ updates: 1, hot: 1 });
    });

    test("a server's report (MonitorResource) is HOT", async () => {
      const id: ObjectID = await insertMonitor(MonitorType.Server);

      expect(
        await writesOf(() => {
          return write(id, {
            serverMonitorRequestReceivedAt: NOW,
            serverMonitorResponse: {
              requestReceivedAt: NOW.toISOString(),
              hostname: "host-1",
            },
          });
        }),
      ).toEqual({ updates: 1, hot: 1 });
    });

    test("a status change is not, and cannot be: the status reads need currentMonitorStatusId indexed", async () => {
      const id: ObjectID = await insertMonitor(MonitorType.Website);

      expect(
        await writesOf(() => {
          return write(id, { currentMonitorStatusId: ObjectID.generate() });
        }),
      ).toEqual({ updates: 1, hot: 0 });
    });

    test("with telemetryMonitorLastMonitorAt indexed again, as main had it, the telemetry stamp is not HOT", async () => {
      const id: ObjectID = await insertMonitor(MonitorType.Metrics);

      await database.query(
        `CREATE INDEX "telemetry_last_monitor_at" ON "${schema}"."Monitor" ("telemetryMonitorLastMonitorAt")`,
      );

      try {
        expect(
          await writesOf(() => {
            return write(id, {
              telemetryMonitorLastMonitorAt: NOW,
              telemetryMonitorNextMonitorAt: new Date(
                NOW.getTime() + 60 * 1000,
              ),
            });
          }),
        ).toEqual({ updates: 1, hot: 0 });
      } finally {
        await database.query(
          `DROP INDEX "${schema}"."telemetry_last_monitor_at"`,
        );
      }
    });
  });
});
