import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import { AddDomainVerifiedNameIndex1809186820000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186820000-AddDomainVerifiedNameIndex";
import logger from "../../../../Server/Utils/Logger";
import ProjectSsoDiscovery, {
  VerifiedProjectDomains,
} from "../../../../Server/Utils/ProjectSsoDiscovery";
import Entities from "../../../../Models/DatabaseModels/Index";
import ObjectID from "../../../../Types/ObjectID";
import { getJestSpyOn } from "../../../Spy";
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
import { DataSource, Logger as TypeOrmLogger, QueryRunner } from "typeorm";

/*
 * "SIGN IN WITH SSO" READS AN INDEX TO FIND A DOMAIN, ON POSTGRES (#9988).
 *
 * Every "Sign in with SSO" lookup - a request anyone can make, with nobody
 * signed in - first finds the verified project domains named like the
 * address's (ProjectSsoDiscovery.findVerifiedDomains). With an index on
 * "projectId" alone, Postgres read the whole Domain table for it.
 *
 * This runs the lookup's own SQL, captured from TypeORM as the lookup sends
 * it, against a realistic Domain table - tens of thousands of rows across
 * thousands of projects, verified and not, deleted and not, in every case -
 * and asks Postgres how it runs it (EXPLAIN, and EXPLAIN ANALYZE):
 *
 *   - without the index, it reads every row of the table (a Seq Scan) and
 *     throws all but one away;
 *   - after the migration builds it (AddDomainVerifiedNameIndex1809186820000,
 *     run here as it is, on a copy of the table), it reads the index and the
 *     one row the lookup returns, a handful of pages in all;
 *   - rows nobody verified - "gmail.com" added to thousands of projects -
 *     never reach the index, so they never slow the lookup;
 *   - the lookup answers exactly the same either way;
 *   - the migrated database's own "Domain" carries the index as pinned, and
 *     the migration's down() takes it off the copy again.
 *
 * Opt in with RUN_POSTGRES_DOMAIN_LOOKUP_INDEX_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_DOMAIN_LOOKUP_INDEX_TESTS=true \
 *   DOMAIN_LOOKUP_INDEX_TEST_DATABASE_HOST=127.0.0.1 \
 *   DOMAIN_LOOKUP_INDEX_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Infrastructure/Postgres/AddDomainVerifiedNameIndexPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Only the
 * table's definition is copied from public, into a uniquely named schema
 * that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_DOMAIN_LOOKUP_INDEX_TESTS"] === "true"
    ? describe
    : describe.skip;

const INDEX_NAME: string = "IDX_domain_verified_lower_domain";

// What Postgres says the migration built, as pg_indexes writes it.
const PINNED_DEFINITION: string = `CREATE INDEX "${INDEX_NAME}" ON public."Domain" USING btree (lower((domain)::text)) WHERE (("isVerified" = true) AND ("deletedAt" IS NULL))`;

const SELECT_STATEMENT: RegExp = /^\s*SELECT\b/i;

// A realistic table: OneUptime Cloud's projects, each with a few domains.
const PROJECTS: number = 6000;
const DOMAINS_PER_PROJECT: number = 5;

interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Index Cond"?: string;
  "Actual Rows"?: number;
  "Rows Removed by Filter"?: number;
  "Rows Removed by Index Recheck"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: Array<PlanNode>;
  [key: string]: unknown;
}

interface CapturedQuery {
  sql: string;
  parameters: Array<unknown>;
}

interface Lookup {
  statement: CapturedQuery;
  answer: Array<VerifiedProjectDomains>;
}

// Every node of a plan, depth first.
function nodesOf(plan: PlanNode): Array<PlanNode> {
  return [
    plan,
    ...(plan.Plans || []).flatMap((child: PlanNode): Array<PlanNode> => {
      return nodesOf(child);
    }),
  ];
}

// How each node of a plan reads Domain: "Seq Scan", "Bitmap Index Scan using IDX_...".
function readsOf(plan: PlanNode): Array<string> {
  return nodesOf(plan)
    .filter((node: PlanNode): boolean => {
      return (
        node["Relation Name"] === "Domain" || node["Index Name"] !== undefined
      );
    })
    .map((node: PlanNode): string => {
      return node["Index Name"]
        ? `${node["Node Type"]} using ${node["Index Name"]}`
        : node["Node Type"];
    });
}

// The pages a run of the plan touched, in memory or not.
function blocksOf(plan: PlanNode): number {
  return (plan["Shared Hit Blocks"] || 0) + (plan["Shared Read Blocks"] || 0);
}

// The node that reads the index, when one does.
function indexNodeOf(plan: PlanNode): PlanNode | undefined {
  return nodesOf(plan).find((node: PlanNode): boolean => {
    return node["Index Name"] === INDEX_NAME;
  });
}

describePostgres(
  "Sign in with SSO's domain lookup reads an index, on Postgres",
  () => {
    const schema: string = `domain_lookup_index_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;
    let captured: Array<CapturedQuery> = [];
    let isCapturing: boolean = false;

    // The lookup's statements, as TypeORM hands them to Postgres.
    const captureLogger: TypeOrmLogger = {
      logQuery: (query: string, parameters?: Array<unknown>): void => {
        if (isCapturing) {
          captured.push({ sql: query, parameters: parameters || [] });
        }
      },
      logQueryError: (): void => {
        return undefined;
      },
      logQuerySlow: (): void => {
        return undefined;
      },
      logSchemaBuild: (): void => {
        return undefined;
      },
      logMigration: (): void => {
        return undefined;
      },
      log: (): void => {
        return undefined;
      },
    };

    const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<any> => {
      return database.query(sql, parameters);
    };

    // The project ids, by number, so each test can name the ones it means.
    const projectIds: Array<string> = [];

    // The lookup for `domain`: its answer, and the statement it sent.
    const lookUp: (domain: string) => Promise<Lookup> = async (
      domain: string,
    ): Promise<Lookup> => {
      captured = [];
      isCapturing = true;

      let answer: Array<VerifiedProjectDomains>;

      try {
        answer = await ProjectSsoDiscovery.findVerifiedDomains(domain);
      } finally {
        isCapturing = false;
      }

      const selects: Array<CapturedQuery> = captured.filter(
        (statement: CapturedQuery): boolean => {
          return (
            SELECT_STATEMENT.test(statement.sql) &&
            statement.sql.includes(`"Domain"`)
          );
        },
      );

      expect(selects).toHaveLength(1);

      return { statement: selects[0]!, answer };
    };

    const explain: (
      statement: CapturedQuery,
      options: string,
    ) => Promise<PlanNode> = async (
      statement: CapturedQuery,
      options: string,
    ): Promise<PlanNode> => {
      const rows: Array<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }> =
        await query(
          `EXPLAIN (${options}FORMAT JSON) ${statement.sql}`,
          statement.parameters,
        );

      return rows[0]!["QUERY PLAN"][0]!.Plan;
    };

    // How Postgres would run it.
    const plan: (statement: CapturedQuery) => Promise<PlanNode> = (
      statement: CapturedQuery,
    ): Promise<PlanNode> => {
      return explain(statement, "");
    };

    // How Postgres ran it, with the rows and pages each step read.
    const run: (statement: CapturedQuery) => Promise<PlanNode> = (
      statement: CapturedQuery,
    ): Promise<PlanNode> => {
      return explain(statement, "ANALYZE, BUFFERS, ");
    };

    // The copy's lookup index, by whatever name Postgres gave it.
    const lookupIndexes: () => Promise<
      Array<{ indexname: string }>
    > = async (): Promise<Array<{ indexname: string }>> => {
      return await query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'Domain' AND indexdef ILIKE '%lower((domain)::text)%'`,
        [schema],
      );
    };

    const runMigration: (direction: "up" | "down") => Promise<void> = async (
      direction: "up" | "down",
    ): Promise<void> => {
      const queryRunner: QueryRunner = database.createQueryRunner();

      try {
        await queryRunner.connect();
        await new AddDomainVerifiedNameIndex1809186820000()[direction](
          queryRunner,
        );
      } finally {
        await queryRunner.release();
      }
    };

    const addDomain: (data: {
      projectId: string;
      domain: string;
      isVerified: boolean;
      createdAt: string;
      deletedAt?: string;
    }) => Promise<string> = async (data: {
      projectId: string;
      domain: string;
      isVerified: boolean;
      createdAt: string;
      deletedAt?: string;
    }): Promise<string> => {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."Domain" ("_id", "version", "projectId", "domain", "slug", "isVerified", "domainVerificationText", "createdAt", "deletedAt") VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          data.projectId,
          data.domain,
          `slug-${id}`,
          data.isVerified,
          `verification-${id}`,
          data.createdAt,
          data.deletedAt || null,
        ],
      );

      return id;
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["DOMAIN_LOOKUP_INDEX_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["DOMAIN_LOOKUP_INDEX_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["DOMAIN_LOOKUP_INDEX_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        logging: ["query"],
        logger: captureLogger,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await query(`CREATE SCHEMA "${schema}"`);

      /*
       * The migrated table as it is, with every index the migrations gave
       * it - then without the one this suite is about, which the migration
       * builds again on the copy.
       */
      await query(
        `CREATE TABLE "${schema}"."Domain" (LIKE public."Domain" INCLUDING ALL)`,
      );

      for (const copied of await lookupIndexes()) {
        await query(`DROP INDEX "${schema}"."${copied.indexname}"`);
      }

      const currentSchema: Array<{ current_schema: string }> = await query(
        "SELECT current_schema()",
      );
      expect(currentSchema[0]?.current_schema).toBe(schema);

      for (let project: number = 0; project < PROJECTS; project++) {
        projectIds.push(ObjectID.generate().toString());
      }

      /*
       * Thousands of projects, each with a few domains of its own, one row
       * a minute apart: most verified, every fifth only added and never
       * verified, every seventh deleted; a third saved in mixed case, as
       * names were before #9824 lower-cased new ones.
       */
      await query(
        `INSERT INTO "${schema}"."Domain" ("_id", "version", "projectId", "domain", "slug", "isVerified", "domainVerificationText", "createdAt", "updatedAt", "deletedAt")
         SELECT md5('domain-' || n)::uuid,
                1,
                ($1::uuid[])[1 + (n / ${DOMAINS_PER_PROJECT})],
                CASE WHEN n % 3 = 0 THEN 'Org' || (n / ${DOMAINS_PER_PROJECT}) || '-Site' || (n % ${DOMAINS_PER_PROJECT}) || '.COM'
                     ELSE 'org' || (n / ${DOMAINS_PER_PROJECT}) || '-site' || (n % ${DOMAINS_PER_PROJECT}) || '.com' END,
                'domain-' || n,
                n % 5 <> 0,
                'oneuptime-verification-' || n,
                timestamptz '2026-01-01' + n * interval '1 minute',
                timestamptz '2026-01-01' + n * interval '1 minute',
                CASE WHEN n % 7 = 0 THEN timestamptz '2026-06-01' ELSE NULL END
           FROM generate_series(0, ${PROJECTS * DOMAINS_PER_PROJECT - 1}) AS n`,
        [projectIds],
      );

      await query(`ANALYZE "${schema}"."Domain"`);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(() => {
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      for (const silenced of ["debug", "info", "warn", "error"]) {
        getJestSpyOn(logger, silenced).mockImplementation((): void => {
          return undefined;
        });
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("the migrated database's own Domain carries the index, as pinned", async () => {
      const rows: Array<{ indexdef: string }> = await query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Domain' AND indexname = $1`,
        [INDEX_NAME],
      );

      expect(
        rows.map((row: { indexdef: string }): string => {
          return row.indexdef;
        }),
      ).toEqual([PINNED_DEFINITION]);
    });

    /*
     * In order: the table without the index, then the migration builds it on
     * the copy, then the same lookups read it, then down() takes it away.
     */
    test("without the index the lookup reads every row of Domain; with it, the index and the one row it returns", async () => {
      // Saved in mixed case ("Org1234-Site1.COM"), verified, of project 1234.
      const domain: string = "org1234-site1.com";

      expect(await lookupIndexes()).toEqual([]);

      const before: Lookup = await lookUp(domain);

      /*
       * What the lookup sends: the lower-cased name, verified and not
       * deleted - the index's expression and its WHERE.
       */
      expect(before.statement.sql).toMatch(
        /LOWER\("Domain"\."domain"\) = \$\d/,
      );
      expect(before.statement.sql).toContain(`"Domain"."isVerified" = $`);
      expect(before.statement.sql).toContain(`"Domain"."deletedAt" IS NULL`);
      expect(before.answer).toHaveLength(1);

      expect(readsOf(await plan(before.statement))).toEqual(["Seq Scan"]);

      const ranBefore: PlanNode = await run(before.statement);
      const seqScan: PlanNode = nodesOf(ranBefore).find(
        (node: PlanNode): boolean => {
          return node["Node Type"] === "Seq Scan";
        },
      )!;

      // Every row read, all but the one returned thrown away.
      expect(seqScan["Actual Rows"]).toBe(1);
      expect(seqScan["Rows Removed by Filter"]).toBe(
        PROJECTS * DOMAINS_PER_PROJECT - 1,
      );

      await runMigration("up");

      expect(await lookupIndexes()).toEqual([{ indexname: INDEX_NAME }]);

      const after: Lookup = await lookUp(domain);

      // The same statement, the same answer: only how Postgres reads it changed.
      expect(after.statement.sql).toBe(before.statement.sql);
      expect(JSON.stringify(after.answer)).toBe(JSON.stringify(before.answer));
      expect(
        after.answer.map((entry: VerifiedProjectDomains): string => {
          return entry.projectId.toString();
        }),
      ).toEqual([projectIds[1234]]);

      const planAfter: PlanNode = await plan(after.statement);

      expect(readsOf(planAfter)).not.toContain("Seq Scan");
      expect(indexNodeOf(planAfter)).toBeDefined();
      expect(indexNodeOf(planAfter)!["Index Cond"]).toContain(
        "lower((domain)::text)",
      );

      // Run: the index found the one row, and nothing was read and thrown away.
      const ranAfter: PlanNode = await run(after.statement);

      expect(indexNodeOf(ranAfter)!["Actual Rows"]).toBe(1);

      for (const node of nodesOf(ranAfter)) {
        expect(node["Rows Removed by Filter"] || 0).toBe(0);
        expect(node["Rows Removed by Index Recheck"] || 0).toBe(0);
      }

      // A handful of pages, where the table took hundreds.
      expect(blocksOf(ranAfter)).toBeLessThanOrEqual(10);
      expect(blocksOf(ranAfter) * 20).toBeLessThan(blocksOf(ranBefore));

      // A name in any case, and a name nobody has, read the index too.
      for (const other of ["ORG12-SITE1.com", "nobody-uses-this.example"]) {
        expect(readsOf(await plan((await lookUp(other)).statement))).toEqual(
          readsOf(planAfter),
        );
      }

      await runMigration("down");

      expect(await lookupIndexes()).toEqual([]);

      // down() took the copy's index, never the migrated database's own.
      const publicRows: Array<{ indexname: string }> = await query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Domain' AND indexname = $1`,
        [INDEX_NAME],
      );
      expect(publicRows).toEqual([{ indexname: INDEX_NAME }]);

      // Back to reading the table, with the same answer still.
      const again: Lookup = await lookUp(domain);

      expect(JSON.stringify(again.answer)).toBe(JSON.stringify(before.answer));
      expect(readsOf(await plan(again.statement))).toEqual(["Seq Scan"]);
    });

    test("rows nobody verified never reach the index: a name added to thousands of projects is looked up in a handful of pages", async () => {
      await runMigration("up");

      try {
        // Anyone can make projects and add "gmail.com" to each, unproved.
        for (let project: number = 0; project < 2000; project++) {
          await addDomain({
            projectId: projectIds[project]!,
            domain: project % 2 === 0 ? "gmail.com" : "GMAIL.COM",
            isVerified: false,
            createdAt: "2027-02-01T00:00:00Z",
          });
        }

        await query(`ANALYZE "${schema}"."Domain"`);

        const lookup: Lookup = await lookUp("gmail.com");

        expect(lookup.answer).toEqual([]);

        const ran: PlanNode = await run(lookup.statement);

        expect(readsOf(ran)).not.toContain("Seq Scan");
        expect(indexNodeOf(ran)!["Actual Rows"]).toBe(0);
        expect(blocksOf(ran)).toBeLessThanOrEqual(10);
      } finally {
        await query(
          `DELETE FROM "${schema}"."Domain" WHERE LOWER("domain") = 'gmail.com'`,
        );
        await runMigration("down");
      }
    });

    test("through the index, the lookup still finds only verified rows that are not deleted, of every project, in the order they were added", async () => {
      await runMigration("up");

      try {
        const first: string = projectIds[10]!;
        const second: string = projectIds[20]!;

        const secondDomain: string = await addDomain({
          projectId: second,
          domain: "Shared.Example.ORG",
          isVerified: true,
          createdAt: "2027-01-02T00:00:00Z",
        });
        const firstDomain: string = await addDomain({
          projectId: first,
          domain: "shared.example.org",
          isVerified: true,
          createdAt: "2027-01-01T00:00:00Z",
        });
        // Added and never verified, and verified then deleted: neither found.
        await addDomain({
          projectId: projectIds[30]!,
          domain: "shared.example.org",
          isVerified: false,
          createdAt: "2026-12-01T00:00:00Z",
        });
        await addDomain({
          projectId: projectIds[40]!,
          domain: "shared.example.org",
          isVerified: true,
          createdAt: "2026-12-02T00:00:00Z",
          deletedAt: "2027-01-03T00:00:00Z",
        });

        const found: Array<VerifiedProjectDomains> = (
          await lookUp("shared.example.org")
        ).answer;

        expect(
          found.map((entry: VerifiedProjectDomains): Array<string> => {
            return [
              entry.projectId.toString(),
              ...entry.domainIds.map((id: ObjectID): string => {
                return id.toString();
              }),
            ];
          }),
        ).toEqual([
          [first, firstDomain],
          [second, secondDomain],
        ]);
      } finally {
        await runMigration("down");
      }
    });
  },
);
