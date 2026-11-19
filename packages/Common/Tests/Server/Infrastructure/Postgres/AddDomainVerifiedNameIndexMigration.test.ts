import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getMetadataArgsStorage, QueryRunner } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import Domain from "../../../../Models/DatabaseModels/Domain";
import dataSourceOptions from "../../../../Server/Infrastructure/Postgres/DataSourceOptions";
import { ONLINE_DDL_LIMITS } from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddDomainVerifiedNameIndex1809186820000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186820000-AddDomainVerifiedNameIndex";
import { BackfillSsoProviderDomains1809186620000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186620000-BackfillSsoProviderDomains";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import logger from "../../../../Server/Utils/Logger";

/*
 * The migration that gives "Domain" the index "Sign in with SSO"'s lookup
 * reads (#9988): the verified project domains named like an address's,
 * whatever case a row was saved in (ProjectSsoDiscovery.findVerifiedDomains).
 *
 * TypeORM cannot write an expression index, so the migration is written out
 * and the drift check cannot see what it builds: its statements are pinned
 * here, executed against a fake QueryRunner that records them. The real
 * build, its use by the lookup's own SQL (EXPLAIN) and down() run on
 * Postgres in AddDomainVerifiedNameIndexPostgres.test.ts.
 */

const MIGRATION_TIMESTAMP: string = "1809186820000";
const MIGRATION_BASE_NAME: string = "AddDomainVerifiedNameIndex";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);
const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

const INDEX_NAME: string = "IDX_domain_verified_lower_domain";

/*
 * What the lookup compares, LOWER("domain") as QueryHelper.findWithSameText
 * writes it, over only the rows it can return: verified and not deleted. A
 * row nobody verified - which anyone can add, for any name, in a project of
 * their own - never reaches the index.
 */
const ONLINE_BUILD: string = `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${INDEX_NAME}" ON "Domain" (LOWER("domain")) WHERE "isVerified" = true AND "deletedAt" IS NULL`;

const LOOKUP: string = "<catalog lookup>";

interface FakeRun {
  runner: QueryRunner;
  statements: Array<string>;
  lookups: Array<Array<unknown> | undefined>;
  builds: Array<{ text: string; query_timeout: number }>;
}

function fakeRunner(data: {
  indexState: "missing" | "valid";
  inTransaction?: boolean;
}): FakeRun {
  let isValid: boolean = data.indexState === "valid";
  const statements: Array<string> = [];
  const lookups: Array<Array<unknown> | undefined> = [];
  const builds: Array<{ text: string; query_timeout: number }> = [];

  const runner: QueryRunner = {
    isTransactionActive: data.inTransaction === true,
    query: async (sql: string, params?: Array<unknown>): Promise<unknown> => {
      const statement: string = sql.replace(/\s+/g, " ").trim();

      if (statement.includes("FROM pg_index")) {
        statements.push(LOOKUP);
        lookups.push(params);
        return isValid
          ? [{ isValid: true, isBuilding: false, regclass: INDEX_NAME }]
          : [];
      }

      statements.push(statement);
      return [];
    },
    connect: async (): Promise<unknown> => {
      return {
        query: async (config: {
          text: string;
          query_timeout: number;
        }): Promise<unknown> => {
          statements.push(config.text);
          builds.push({
            text: config.text,
            query_timeout: config.query_timeout,
          });
          isValid = true;
          return { rows: [] };
        },
      };
    },
  } as unknown as QueryRunner;

  return { runner, statements, lookups, builds };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("up()", () => {
  test("TypeORM is told to run it outside a transaction, as an online build must", () => {
    expect(new AddDomainVerifiedNameIndex1809186820000().transaction).toBe(
      false,
    );
  });

  test("builds the index online, within OnlineDdl's bounds, and puts the connection's settings back", async () => {
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

    const run: FakeRun = fakeRunner({ indexState: "missing" });

    await new AddDomainVerifiedNameIndex1809186820000().up(run.runner);

    expect(run.statements).toEqual([
      LOOKUP,
      `SET statement_timeout = ${ONLINE_DDL_LIMITS.statementTimeoutInMs}`,
      `SET lock_timeout = ${ONLINE_DDL_LIMITS.lockTimeoutInMs}`,
      ONLINE_BUILD,
      `SET statement_timeout = DEFAULT`,
      `SET lock_timeout = DEFAULT`,
      LOOKUP,
    ]);
    expect(run.builds).toEqual([
      {
        text: ONLINE_BUILD,
        query_timeout:
          ONLINE_DDL_LIMITS.statementTimeoutInMs +
          ONLINE_DDL_LIMITS.clientTimeoutMarginInMs,
      },
    ]);
  });

  test("looks the index up on the Domain the connection's search_path finds, by its name", async () => {
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

    const run: FakeRun = fakeRunner({ indexState: "missing" });

    await new AddDomainVerifiedNameIndex1809186820000().up(run.runner);

    /*
     * Unqualified, so on every install it is public's, and the Postgres
     * suite can build it on a copy of the table in a schema of its own.
     */
    expect(run.lookups[0]).toEqual([`"Domain"`, INDEX_NAME]);
  });

  test("an index already there - built by hand ahead of the upgrade, or a run stopped after it - is left as it is", async () => {
    const run: FakeRun = fakeRunner({ indexState: "valid" });

    await new AddDomainVerifiedNameIndex1809186820000().up(run.runner);

    expect(run.statements).toEqual([LOOKUP]);
    expect(run.builds).toEqual([]);
  });

  test("refuses to run inside a transaction, before anything is built", async () => {
    const run: FakeRun = fakeRunner({
      indexState: "missing",
      inTransaction: true,
    });

    await expect(
      new AddDomainVerifiedNameIndex1809186820000().up(run.runner),
    ).rejects.toThrow("transaction");
    expect(run.builds).toEqual([]);
  });
});

describe("down()", () => {
  test("outside a transaction: dropped online, by its unqualified name", async () => {
    const run: FakeRun = fakeRunner({ indexState: "valid" });

    await new AddDomainVerifiedNameIndex1809186820000().down(run.runner);

    expect(run.statements).toEqual([
      `SET statement_timeout = ${ONLINE_DDL_LIMITS.statementTimeoutInMs}`,
      `SET lock_timeout = ${ONLINE_DDL_LIMITS.lockTimeoutInMs}`,
      `DROP INDEX CONCURRENTLY IF EXISTS "${INDEX_NAME}"`,
      `SET statement_timeout = DEFAULT`,
      `SET lock_timeout = DEFAULT`,
    ]);
  });

  test("inside TypeORM's revert transaction: a plain DROP of the same index", async () => {
    const run: FakeRun = fakeRunner({
      indexState: "valid",
      inTransaction: true,
    });

    await new AddDomainVerifiedNameIndex1809186820000().down(run.runner);

    expect(run.statements[run.statements.length - 1]).toBe(
      `DROP INDEX IF EXISTS "${INDEX_NAME}"`,
    );
  });
});

describe("the index is the lookup's", () => {
  /*
   * findVerifiedDomains asks for the domain through findWithSameText, which
   * writes LOWER(<column>) = <the name, trimmed and lower-cased>: the
   * expression the index is built on, so the planner can use it.
   */
  test('the lookup compares LOWER("domain"), the index\'s first expression', () => {
    const operator: { getSql?: (alias: string) => string } =
      QueryHelper.findWithSameText("  Acme.COM ") as unknown as {
        getSql?: (alias: string) => string;
      };
    const parameters: Record<string, unknown> = (
      operator as unknown as {
        objectLiteralParameters: Record<string, unknown>;
      }
    ).objectLiteralParameters;

    expect(operator.getSql!(`"Domain"."domain"`)).toMatch(
      /^\(LOWER\("Domain"\."domain"\) = :\w+\)$/,
    );
    expect(Object.values(parameters)).toEqual(["acme.com"]);
  });

  test("Domain declares it by name, unsynchronized, so the schema builder leaves it alone", () => {
    const args: IndexMetadataArgs | undefined =
      getMetadataArgsStorage().indices.find(
        (index: IndexMetadataArgs): boolean => {
          return index.target === Domain && index.name === INDEX_NAME;
        },
      );

    expect(args).toBeDefined();
    expect(args!.synchronize).toBe(false);
  });

  test("the model's comment names the migration that owns the real definition", () => {
    const model: string = fs.readFileSync(
      path.join(__dirname, "../../../../Models/DatabaseModels/Domain.ts"),
      "utf8",
    );

    expect(model).toContain(`${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}`);
  });
});

describe("the migration runs", () => {
  test("it is imported and listed in Index.ts", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATION_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import { ${MIGRATION_CLASS_NAME} } from "./${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}";`,
    );
    expect(index).toContain(`  ${MIGRATION_CLASS_NAME},\n`);
  });

  test("it is in the exported migration list, exactly once, after the backfill that fills the lookup's domain lists", () => {
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return migration === AddDomainVerifiedNameIndex1809186820000;
      }),
    ).toHaveLength(1);
    expect(
      SchemaMigrations.indexOf(AddDomainVerifiedNameIndex1809186820000),
    ).toBeGreaterThan(
      SchemaMigrations.indexOf(BackfillSsoProviderDomains1809186620000),
    );
  });

  test("the app runs migrations one transaction each, the mode that lets it opt out", () => {
    expect(dataSourceOptions.migrationsTransactionMode).toBe("each");
  });

  // TypeORM records applied migrations by `name`; a mismatch would run it on every boot.
  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddDomainVerifiedNameIndex1809186820000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddDomainVerifiedNameIndex1809186820000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddDomainVerifiedNameIndex1809186820000.name.match(CLASS_TIMESTAMP)?.[1],
    ).toBe(MIGRATION_TIMESTAMP);
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    expect(
      fs.readdirSync(MIGRATION_DIRECTORY).filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      }),
    ).toEqual([MIGRATION_FILE_NAME]);
  });

  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddDomainVerifiedNameIndex1809186820000,
    );
    const earlier: Array<number> = SchemaMigrations.slice(0, position)
      .map((migration: unknown): RegExpMatchArray | null => {
        return (migration as { name: string }).name.match(CLASS_TIMESTAMP);
      })
      .filter((match: RegExpMatchArray | null): boolean => {
        return Boolean(match);
      })
      .map((match: RegExpMatchArray | null): number => {
        return Number(match![1]);
      });

    expect(earlier.length).toBeGreaterThan(100);
    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(Math.max(...earlier));
  });
});
