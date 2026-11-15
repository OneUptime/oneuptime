import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import { getAlertSelfPrivacyRaw } from "../../../../Server/Utils/Alert/AlertPrivacyFilter";
import { getIncidentSelfPrivacyRaw } from "../../../../Server/Utils/Incident/IncidentPrivacyFilter";
import logger from "../../../../Server/Utils/Logger";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
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
import {
  DataSource,
  DefaultNamingStrategy,
  Logger as TypeOrmLogger,
} from "typeorm";

/*
 * THE ALERTS AND INCIDENTS LISTS' INDEXES ON POSTGRES
 * (AddAlertAndIncidentListIndexes1809169000000).
 *
 * Which index a read can use only a database answers. So this asks one
 * migrated to the current head:
 *
 *   - the migrated "Alert" and "Incident" carry ("projectId", "createdAt"),
 *     valid (an online build that failed part way leaves an INVALID one
 *     behind), and no longer the bare "projectId" index every composite
 *     already leads with;
 *   - a list's page, newest first - what the dashboard lists show and what
 *     DatabaseService reads when no order is given - takes its ids from
 *     ("projectId", "createdAt") in its order (PagedFind's id page): no sort
 *     of the project's records, on the first page, a later one, or kept to
 *     the private records a member may see;
 *   - the rows of those ids are read by primary key, not by another pass
 *     over the project;
 *   - the list's capped count (CappedCount) stops reading at its cap.
 *
 * Opt in with RUN_POSTGRES_ALERT_INCIDENT_LIST_INDEX_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The tables' STRUCTURE
 * (indexes included) is cloned into a unique schema that is dropped
 * afterwards; the public tables are only read. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * ALERT_INCIDENT_LIST_INDEX_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from ALERT_INCIDENT_LIST_INDEX_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_ALERT_INCIDENT_LIST_INDEX_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Label",
  "Alert",
  "AlertLabel",
  "Incident",
  "IncidentLabel",
];

// Records per project: enough that sorting them would show in a plan.
const RECORDS_PER_PROJECT: number = 2000;

const PAGE_SIZE: number = 10;

/*
 * Cloning five tables and seeding 8,000 records, then dropping the clones:
 * more than the default hook timeout on a busy runner.
 */
const SETUP_TIMEOUT_MS: number = 300000;
const TEARDOWN_TIMEOUT_MS: number = 120000;

const NOW: Date = new Date("2026-11-14T10:00:00.000Z");

// A read, as TypeORM sends one: what the planner is asked about here.
const SELECT_STATEMENT: RegExp = /^\s*SELECT/i;

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

interface IndexRow {
  name: string;
  columns: string;
  predicate: string | null;
  isUnique: boolean;
  isValid: boolean;
}

interface Captured {
  sql: string;
  parameters: Array<unknown>;
}

// A table the plan reads, and how.
interface Scan {
  relation: string;
  nodeType: string;
  indexes: Array<string>;
}

interface Page {
  projectId: ObjectID;
  skip: number;
  // Newest first, as the dashboard lists ask; left out, DatabaseService's own.
  sortNewestFirst: boolean;
  // A member's read, kept to the private records they own.
  memberId?: ObjectID | undefined;
}

interface ListedTable {
  table: "Alert" | "Incident";
  labelTable: "AlertLabel" | "IncidentLabel";
  recordColumn: "alertId" | "incidentId";
  readPage: (page: Page) => Promise<Array<unknown>>;
  countUpTo: (projectId: ObjectID, upTo: number) => Promise<PositiveNumber>;
}

const LISTED_TABLES: Array<ListedTable> = [
  {
    table: "Alert",
    labelTable: "AlertLabel",
    recordColumn: "alertId",
    readPage: (page: Page): Promise<Array<unknown>> => {
      return AlertService.findBy({
        query: Object.assign(
          { projectId: page.projectId },
          page.memberId
            ? { isPrivate: getAlertSelfPrivacyRaw({ userId: page.memberId })! }
            : {},
        ),
        // A to-many relation shown, as the list's labels column is.
        select: { _id: true, title: true, labels: { _id: true, name: true } },
        ...(page.sortNewestFirst
          ? { sort: { createdAt: SortOrder.Descending } }
          : {}),
        skip: page.skip,
        limit: PAGE_SIZE,
        props: { isRoot: true },
      });
    },
    countUpTo: (projectId: ObjectID, upTo: number): Promise<PositiveNumber> => {
      return AlertService.countBy({
        query: { projectId: projectId },
        upTo: upTo,
        props: { isRoot: true },
      });
    },
  },
  {
    table: "Incident",
    labelTable: "IncidentLabel",
    recordColumn: "incidentId",
    readPage: (page: Page): Promise<Array<unknown>> => {
      return IncidentService.findBy({
        query: Object.assign(
          { projectId: page.projectId },
          page.memberId
            ? {
                isPrivate: getIncidentSelfPrivacyRaw({
                  userId: page.memberId,
                })!,
              }
            : {},
        ),
        select: { _id: true, title: true, labels: { _id: true, name: true } },
        ...(page.sortNewestFirst
          ? { sort: { createdAt: SortOrder.Descending } }
          : {}),
        skip: page.skip,
        limit: PAGE_SIZE,
        props: { isRoot: true },
      });
    },
    countUpTo: (projectId: ObjectID, upTo: number): Promise<PositiveNumber> => {
      return IncidentService.countBy({
        query: { projectId: projectId },
        upTo: upTo,
        props: { isRoot: true },
      });
    },
  },
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

function childrenOf(node: JSONObject): Array<JSONObject> {
  return (node["Plans"] as Array<JSONObject> | undefined) || [];
}

/*
 * A node's own inputs, leaving out the subqueries its filter runs beside it
 * (a member's privacy filter): what the node itself reads.
 */
function inputsOf(node: JSONObject): Array<JSONObject> {
  return childrenOf(node).filter((child: JSONObject): boolean => {
    return (
      child["Parent Relationship"] !== "SubPlan" &&
      child["Parent Relationship"] !== "InitPlan"
    );
  });
}

function indexesUnder(node: JSONObject): Array<string> {
  const names: Array<string> =
    typeof node["Index Name"] === "string"
      ? [node["Index Name"] as string]
      : [];

  return names.concat(
    inputsOf(node).flatMap((child: JSONObject): Array<string> => {
      return indexesUnder(child);
    }),
  );
}

// Every table the plan reads: by which node, through which indexes.
function scansOf(plan: JSONObject): Array<Scan> {
  const scans: Array<Scan> = [];
  const visit: (node: JSONObject) => void = (node: JSONObject): void => {
    if (typeof node["Relation Name"] === "string") {
      scans.push({
        relation: node["Relation Name"] as string,
        nodeType: node["Node Type"] as string,
        // A bitmap heap scan's indexes are its children's.
        indexes: indexesUnder(node),
      });
    }

    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  visit(plan);
  return scans;
}

/*
 * The node types on the plan's own path, leaving out the subqueries a
 * privacy filter runs beside it: what the page itself costs.
 */
function nodeTypesOf(plan: JSONObject): Array<string> {
  const types: Array<string> = [plan["Node Type"] as string];

  for (const child of inputsOf(plan)) {
    types.push(...nodeTypesOf(child));
  }

  return types;
}

function findNode(plan: JSONObject, nodeType: string): JSONObject | undefined {
  if (plan["Node Type"] === nodeType) {
    return plan;
  }

  for (const child of childrenOf(plan)) {
    const found: JSONObject | undefined = findNode(child, nodeType);

    if (found) {
      return found;
    }
  }

  return undefined;
}

describePostgres("The Alerts and Incidents lists' indexes, on Postgres", () => {
  const schema: string = `list_indexes_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const captureLogger: CapturingLogger = new CapturingLogger();
  let database: DataSource;

  const PROJECT_ID: ObjectID = ObjectID.generate();
  const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
  const MEMBER_ID: ObjectID = ObjectID.generate();

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

  // The clone's name for the table's index on these columns, with no WHERE.
  async function cloneIndex(table: string, columns: string): Promise<string> {
    const matches: Array<IndexRow> = (
      await indexesOf(`"${schema}"."${table}"`)
    ).filter((index: IndexRow): boolean => {
      return index.columns === columns && index.predicate === null;
    });

    expect(matches).toHaveLength(1);

    return matches[0]!.name;
  }

  // The reads of the table one call sends.
  async function readsOf(
    table: string,
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
      return (
        SELECT_STATEMENT.test(statement.sql) &&
        statement.sql.includes(`"${schema}"."${table}"`)
      );
    });
  }

  // The planner's plan for one statement, sequential scans off.
  async function planOf(
    statement: Captured,
    options: { analyze: boolean } = { analyze: false },
  ): Promise<JSONObject> {
    await database.query("SET enable_seqscan = off");
    try {
      const rows: Array<{ "QUERY PLAN": Array<{ Plan: JSONObject }> }> =
        await database.query(
          `EXPLAIN (${options.analyze ? "ANALYZE, " : ""}FORMAT JSON) ${statement.sql}`,
          statement.parameters,
        );
      return rows[0]!["QUERY PLAN"][0]!.Plan;
    } finally {
      await database.query("SET enable_seqscan = on");
    }
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["ALERT_INCIDENT_LIST_INDEX_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["ALERT_INCIDENT_LIST_INDEX_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["ALERT_INCIDENT_LIST_INDEX_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      logging: true,
      logger: captureLogger,
      extra: {
        /*
         * The clones first. A member's privacy filter names its owner tables
         * unqualified ("AlertOwnerUser", "TeamMember"): they resolve to the
         * migrated, empty public ones.
         */
        options: `-c search_path=${schema},public`,
        // One connection: the SET before a plan is the plan's.
        max: 1,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );

      // A fixture names only what the statements touch: the keys stay required.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT c.column_name FROM information_schema.columns c
         WHERE c.table_schema = $1 AND c.table_name = $2 AND c.is_nullable = 'NO'
           AND NOT EXISTS (
             SELECT 1 FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
             WHERE i.indrelid = format('%I.%I', $1::text, $2::text)::regclass
               AND i.indisprimary AND a.attname = c.column_name
           )`,
        [schema, table],
      );
      if (columns.length > 0) {
        // One statement per table, not one per column.
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ${columns
            .map((column: { column_name: string }): string => {
              return `ALTER COLUMN "${column.column_name}" DROP NOT NULL`;
            })
            .join(", ")}`,
        );
      }
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);

    /*
     * Two projects of 2,000 alerts and 2,000 incidents each, newest every
     * minute with every tenth minute shared by two (ties the page orders by
     * id), one in fifty deleted, one in twenty private, most with labels;
     * then ANALYZE: plans as a real table's would be.
     */
    for (const projectId of [PROJECT_ID, OTHER_PROJECT_ID]) {
      const labelIds: Array<string> = [];

      for (let label: number = 0; label < 4; label++) {
        const labelId: string = ObjectID.generate().toString();
        labelIds.push(labelId);
        await database.query(
          `INSERT INTO "${schema}"."Label" ("_id", "projectId", "name", "createdAt", "updatedAt", "version")
           VALUES ($1, $2, $3, $4, $4, 1)`,
          [labelId, projectId.toString(), `Label ${label}`, NOW],
        );
      }

      for (const listed of LISTED_TABLES) {
        await database.query(
          `INSERT INTO "${schema}"."${listed.table}"
             ("_id", "projectId", "title", "createdAt", "updatedAt", "version", "deletedAt", "isPrivate")
           SELECT gen_random_uuid(), $1::uuid, '${listed.table} ' || g,
                  $2::timestamptz - (g - CASE WHEN g % 10 = 0 THEN 1 ELSE 0 END) * INTERVAL '1 minute',
                  $2::timestamptz, 1,
                  CASE WHEN g % 50 = 0 THEN $2::timestamptz ELSE NULL END,
                  g % 20 = 0
             FROM generate_series(1, ${RECORDS_PER_PROJECT}) AS g`,
          [projectId.toString(), NOW],
        );
        await database.query(
          `INSERT INTO "${schema}"."${listed.labelTable}" ("${listed.recordColumn}", "labelId")
           SELECT record."_id", label.id
             FROM "${schema}"."${listed.table}" record
             JOIN unnest($2::uuid[]) WITH ORDINALITY AS label(id, position)
               ON label.position <= (abs(hashtext(record."_id"::text)) % 3)
            WHERE record."projectId" = $1`,
          [projectId.toString(), labelIds],
        );
      }
    }

    for (const table of TABLES) {
      await database.query(`ANALYZE "${schema}"."${table}"`);
    }
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  }, TEARDOWN_TIMEOUT_MS);

  beforeEach(() => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation((() => {
        return undefined;
      }) as never);
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(LISTED_TABLES)("$table", (listed: ListedTable) => {
    test("the migrated table carries (projectId, createdAt), valid, and no bare projectId index", async () => {
      const indexes: Array<IndexRow> = await indexesOf(
        `public."${listed.table}"`,
      );

      expect(
        indexes.filter((index: IndexRow): boolean => {
          return (
            index.columns === "projectId,createdAt" && index.predicate === null
          );
        }),
      ).toEqual([
        {
          name: namingStrategy.indexName(listed.table, [
            "projectId",
            "createdAt",
          ]),
          columns: "projectId,createdAt",
          predicate: null,
          isUnique: false,
          isValid: true,
        },
      ]);
      expect(
        indexes
          .filter((index: IndexRow): boolean => {
            return index.columns === "projectId" && index.predicate === null;
          })
          .map((index: IndexRow): string => {
            return index.name;
          }),
      ).toEqual([]);
      expect(
        indexes.filter((index: IndexRow): boolean => {
          return !index.isValid;
        }),
      ).toEqual([]);
    });

    test.each([
      {
        title: "the first page, newest first as the list asks",
        skip: 0,
        sortNewestFirst: true,
        member: false,
      },
      {
        title: "the first page in DatabaseService's own order",
        skip: 0,
        sortNewestFirst: false,
        member: false,
      },
      {
        title: "a page 1,000 records in",
        skip: 1000,
        sortNewestFirst: true,
        member: false,
      },
      {
        title: "a member's first page, kept to the private records they own",
        skip: 0,
        sortNewestFirst: true,
        member: true,
      },
    ])(
      "$title takes its ids from (projectId, createdAt) in order, and its rows by primary key",
      async (page: {
        skip: number;
        sortNewestFirst: boolean;
        member: boolean;
      }) => {
        const reads: Array<Captured> = await readsOf(listed.table, () => {
          return listed.readPage({
            projectId: PROJECT_ID,
            skip: page.skip,
            sortNewestFirst: page.sortNewestFirst,
            memberId: page.member ? MEMBER_ID : undefined,
          });
        });

        // The id page, then the rows of its ids (PagedFind).
        expect(reads).toHaveLength(2);
        const idPage: Captured = reads[0]!;
        const rows: Captured = reads[1]!;

        // No relation joined (a member's privacy filter joins in its own subquery).
        expect(idPage.sql).not.toContain(`JOIN "${schema}".`);
        // Newest first, ties by id: the selected primary key's alias.
        expect(idPage.sql).toContain(
          `ORDER BY "${listed.table}"."createdAt" DESC, "${listed.table}__id" ASC`,
        );
        expect(idPage.sql).toContain(`LIMIT ${PAGE_SIZE}`);

        const idPlan: JSONObject = await planOf(idPage);
        const listIndex: string = await cloneIndex(
          listed.table,
          "projectId,createdAt",
        );

        expect(
          scansOf(idPlan).filter((scan: Scan): boolean => {
            return scan.relation === listed.table;
          }),
        ).toEqual([
          {
            relation: listed.table,
            nodeType: "Index Scan",
            indexes: [listIndex],
          },
        ]);
        // Ties on createdAt are put in id order as they come; nothing sorts the project.
        expect(nodeTypesOf(idPlan)).not.toContain("Sort");

        const rowsPlan: JSONObject = await planOf(rows);
        const tableScans: Array<Scan> = scansOf(rowsPlan).filter(
          (scan: Scan): boolean => {
            return scan.relation === listed.table;
          },
        );

        expect(tableScans).toHaveLength(1);
        expect(tableScans[0]!.indexes).toEqual([
          await cloneIndex(listed.table, "_id"),
        ]);
      },
    );

    test("the list's capped count stops reading at its cap", async () => {
      const upTo: number = 500;
      let answer: PositiveNumber | undefined;

      const reads: Array<Captured> = await readsOf(listed.table, async () => {
        answer = await listed.countUpTo(PROJECT_ID, upTo);
      });

      // More matched than the cap: the answer says so, as upTo + 1.
      expect(answer?.toNumber()).toBe(upTo + 1);
      expect(reads).toHaveLength(1);

      const plan: JSONObject = await planOf(reads[0]!, { analyze: true });
      const limit: JSONObject | undefined = findNode(plan, "Limit");

      expect(limit?.["Actual Rows"]).toBe(upTo + 1);

      const scans: Array<Scan> = scansOf(plan).filter((scan: Scan): boolean => {
        return scan.relation === listed.table;
      });

      expect(scans).toHaveLength(1);

      // The scan beneath the cap read no further than it: not the project's 1,960.
      const scan: JSONObject | undefined = findNode(limit!, scans[0]!.nodeType);

      expect(scan?.["Actual Rows"]).toBe(upTo + 1);
    });
  });
});
