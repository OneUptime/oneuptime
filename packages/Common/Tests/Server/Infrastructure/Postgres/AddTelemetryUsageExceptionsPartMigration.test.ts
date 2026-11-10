import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import TelemetryUsageBilling from "../../../../Models/DatabaseModels/TelemetryUsageBilling";
import { AddIncomingMonitorRequestAsReceived1809080466402 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809080466402-AddIncomingMonitorRequestAsReceived";
import { AddTelemetryUsageExceptionsPart1809080476356 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809080476356-AddTelemetryUsageExceptionsPart";
import { AddTeamOwners1809086561000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809086561000-AddTeamOwners";
import Migrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import ColumnType from "../../../../Types/Database/ColumnType";

/*
 * The migration that lets telemetry usage show exceptions apart from the
 * traces they are billed with (issue #6356): one nullable numeric column,
 * TelemetryUsageBilling.exceptionDataIngestedInGB, that records how much of
 * a Traces row's dataIngestedInGB was exceptions.
 *
 * TelemetryUsageExceptionsPostgres.test.ts checks the column on a migrated
 * database, but it is opt-in and runs only in the Postgres Schema Drift
 * workflow. These run everywhere, and keep the parts a merge or an edit can
 * quietly break:
 *
 * - the migration is registered once, where it runs: in timestamp order,
 *   after the migration it was generated on top of and before the ones main
 *   added while the branch was open (the merge that brought them in had to
 *   interleave the two lists by hand);
 * - up() adds exactly the column the model declares - nullable, numeric and
 *   with no default, so no row is rewritten and every row counted before it
 *   keeps its exceptions inside Traces - and down() drops exactly that;
 * - it touches nothing billing reads: dataIngestedInGB and totalCostInUSD
 *   stay NOT NULL and unaltered, which is what keeps every invoice the same;
 * - nobody can write the part through the API, and whoever can read the
 *   billed figure can read its part;
 * - the opt-in Postgres suite is really switched on in CI, with the variable
 *   names the suite reads.
 */

const REPO_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const MIGRATIONS_DIR: string = path.join(
  REPO_ROOT,
  "packages",
  "Common",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const FILE: string = "1809080476356-AddTelemetryUsageExceptionsPart.ts";
const NAME: string = "AddTelemetryUsageExceptionsPart1809080476356";
// The migration it was generated on top of, on its branch.
const PREVIOUS_NAME: string =
  "AddIncomingMonitorRequestAsReceived1809080466402";
/*
 * The first migration main added while the branch was open. It was generated
 * later, so it runs after this one.
 */
const NEXT_ON_MAIN_NAME: string = "AddTeamOwners1809086561000";

const TABLE: string = "TelemetryUsageBilling";
const COLUMN: string = "exceptionDataIngestedInGB";

const UP_SQL: string = `ALTER TABLE "${TABLE}" ADD "${COLUMN}" numeric`;
const DOWN_SQL: string = `ALTER TABLE "${TABLE}" DROP COLUMN "${COLUMN}"`;

const SOURCE: string = fs.readFileSync(path.join(MIGRATIONS_DIR, FILE), "utf8");
const INDEX_SOURCE: string = fs.readFileSync(
  path.join(MIGRATIONS_DIR, "Index.ts"),
  "utf8",
);

const names: Array<string> = Migrations.map(
  (migration: { name: string }): string => {
    return migration.name;
  },
);

// TypeORM reads a migration's timestamp from the last 13 digits of its name.
const timestampOf: (name: string) => string = (name: string): string => {
  return name.slice(-13);
};

/*
 * Runs up() or down() against a query runner that only records the SQL it
 * is given, so these check what the migration really sends, not how its
 * source happens to be written.
 */
const sqlSentBy: (
  run: (queryRunner: QueryRunner) => Promise<void>,
) => Promise<Array<string>> = async (
  run: (queryRunner: QueryRunner) => Promise<void>,
): Promise<Array<string>> => {
  const sent: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      sent.push(sql);
    },
  } as unknown as QueryRunner;

  await run(queryRunner);

  return sent;
};

const sentByUp: () => Promise<Array<string>> = (): Promise<Array<string>> => {
  return sqlSentBy((queryRunner: QueryRunner): Promise<void> => {
    return new AddTelemetryUsageExceptionsPart1809080476356().up(queryRunner);
  });
};

const sentByDown: () => Promise<Array<string>> = (): Promise<Array<string>> => {
  return sqlSentBy((queryRunner: QueryRunner): Promise<void> => {
    return new AddTelemetryUsageExceptionsPart1809080476356().down(queryRunner);
  });
};

const declaredColumn: (propertyName: string) => ColumnMetadataArgs = (
  propertyName: string,
): ColumnMetadataArgs => {
  const found: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (column: ColumnMetadataArgs): boolean => {
        return (
          column.target === TelemetryUsageBilling &&
          column.propertyName === propertyName
        );
      },
    );

  if (!found) {
    throw new Error(`${TABLE}.${propertyName} is not declared on the model`);
  }

  return found;
};

describe("registration", () => {
  test("it is registered exactly once, as its own class", () => {
    expect(
      names.filter((name: string): boolean => {
        return name === NAME;
      }),
    ).toHaveLength(1);
    expect(Migrations[names.indexOf(NAME)]).toBe(
      AddTelemetryUsageExceptionsPart1809080476356,
    );
  });

  test("its name matches its class and its file's timestamp", () => {
    expect(new AddTelemetryUsageExceptionsPart1809080476356().name).toBe(NAME);
    expect(FILE.split("-")[0]).toBe(timestampOf(NAME));
    expect(FILE).toBe(
      `${timestampOf(NAME)}-AddTelemetryUsageExceptionsPart.ts`,
    );
  });

  test("Index.ts imports it from its own file", () => {
    expect(INDEX_SOURCE).toContain(
      `import { ${NAME} } from "./${FILE.replace(/\.ts$/, "")}";`,
    );
  });

  test("no other migration shares its timestamp, so TypeORM's order is never a tie", () => {
    expect(
      names.filter((name: string): boolean => {
        return timestampOf(name) === timestampOf(NAME);
      }),
    ).toEqual([NAME]);
  });

  test("it runs after the migration it was generated on top of", () => {
    expect(names.indexOf(PREVIOUS_NAME)).toBeGreaterThan(-1);
    expect(Migrations[names.indexOf(PREVIOUS_NAME)]).toBe(
      AddIncomingMonitorRequestAsReceived1809080466402,
    );
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf(PREVIOUS_NAME));
  });

  test("it runs before the migrations main added after it was generated", () => {
    expect(names.indexOf(NEXT_ON_MAIN_NAME)).toBeGreaterThan(-1);
    expect(Migrations[names.indexOf(NEXT_ON_MAIN_NAME)]).toBe(
      AddTeamOwners1809086561000,
    );
    // Registered at all, so "before" cannot pass on an index of -1.
    expect(names.indexOf(NAME)).toBeGreaterThan(-1);
    expect(names.indexOf(NAME)).toBeLessThan(names.indexOf(NEXT_ON_MAIN_NAME));
  });

  test("its neighbours in the list are in timestamp order around it", () => {
    const index: number = names.indexOf(NAME);
    const before: string = names[index - 1]!;
    const after: string | undefined = names[index + 1];

    expect(Number(timestampOf(before))).toBeLessThan(Number(timestampOf(NAME)));

    // It may be the newest migration on a branch; on main something follows.
    if (after) {
      expect(Number(timestampOf(after))).toBeGreaterThan(
        Number(timestampOf(NAME)),
      );
    }
  });
});

describe("what up() and down() send", () => {
  test("up() sends exactly one statement: the nullable numeric column", async () => {
    expect(await sentByUp()).toEqual([UP_SQL]);
  });

  test("down() sends exactly one statement: dropping that column", async () => {
    expect(await sentByDown()).toEqual([DOWN_SQL]);
  });

  test("down() undoes up(): the same table and column, added then dropped", async () => {
    const up: Array<string> = await sentByUp();
    const down: Array<string> = await sentByDown();

    expect(up).toHaveLength(down.length);
    expect(up[0]).toContain(`"${TABLE}" ADD "${COLUMN}"`);
    expect(down[0]).toContain(`"${TABLE}" DROP COLUMN "${COLUMN}"`);
  });

  test("the column has no default and allows NULL, so no row is rewritten and old days stay whole", async () => {
    /*
     * A default (even 0) would give every row counted before this change an
     * exceptions part of that value: the reads would then take it out of
     * Traces, and a day whose exceptions were never measured apart would
     * show none. NOT NULL would need one. Both are refused.
     */
    const [up] = await sentByUp();

    expect(up).not.toMatch(/DEFAULT/i);
    expect(up).not.toMatch(/NOT NULL/i);
  });

  test("it adds no index, key or constraint, and updates no row", async () => {
    const sent: string = (await sentByUp()).join("\n");

    expect(sent).not.toMatch(/CREATE (UNIQUE )?INDEX/i);
    expect(sent).not.toMatch(/CONSTRAINT/i);
    expect(sent).not.toMatch(/FOREIGN KEY/i);
    expect(sent).not.toMatch(/\bUPDATE\b/i);
    expect(sent).not.toMatch(/ALTER COLUMN/i);
  });

  test("it touches TelemetryUsageBilling only", async () => {
    const sent: string = [...(await sentByUp()), ...(await sentByDown())].join(
      "\n",
    );
    const tables: Array<string> = Array.from(
      new Set(
        Array.from(sent.matchAll(/ALTER TABLE "(\w+)"/g)).map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
      ),
    );

    expect(tables).toEqual([TABLE]);
  });

  test("it never touches the figures billing reads", async () => {
    const sent: string = [...(await sentByUp()), ...(await sentByDown())].join(
      "\n",
    );

    for (const billed of [
      "dataIngestedInGB",
      "totalCostInUSD",
      "isReportedToBillingProvider",
      "reportedToBillingProviderAt",
      "day",
      "productType",
    ]) {
      expect(sent).not.toContain(`"${billed}"`);
    }
  });

  test("it runs inside the migration transaction, like any metadata-only column add", () => {
    /*
     * Only migrations that build indexes or keys online opt out. Read
     * through TypeORM's interface: a class that does not opt out does not
     * declare the field.
     */
    const migration: MigrationInterface =
      new AddTelemetryUsageExceptionsPart1809080476356();

    expect(migration.transaction).toBeUndefined();
    expect(SOURCE).not.toContain("OnlineDdl");
  });

  test("the source sends its SQL with queryRunner.query and nothing else", () => {
    expect(Array.from(SOURCE.matchAll(/queryRunner\.query\(/g))).toHaveLength(
      2,
    );
    expect(SOURCE).toContain(UP_SQL);
    expect(SOURCE).toContain(DOWN_SQL);
  });
});

describe("the model declares the column the migration adds", () => {
  test("exceptionDataIngestedInGB is a nullable decimal with no default", () => {
    const column: ColumnMetadataArgs = declaredColumn(COLUMN);

    expect(column.options.nullable).toBe(true);
    expect(column.options.type).toBe(ColumnType.Decimal);
    expect(column.options.default).toBeUndefined();
  });

  test("decimal is the type TypeORM writes as numeric in Postgres", () => {
    /*
     * TypeORM's Postgres driver normalizes "decimal" to "numeric", which is
     * why the generated migration says numeric. The schema drift check and
     * the opt-in Postgres suite compare the two on a migrated database.
     */
    expect(ColumnType.Decimal).toBe("decimal");
    expect(UP_SQL.endsWith(" numeric")).toBe(true);
  });

  test("it is read back as a Decimal, like the figure it is a part of", () => {
    const part: ColumnMetadataArgs = declaredColumn(COLUMN);
    const whole: ColumnMetadataArgs = declaredColumn("dataIngestedInGB");

    expect(part.options.transformer).toBeDefined();
    expect(whole.options.transformer).toBeDefined();
    expect(part.options.type).toBe(whole.options.type);
  });

  test("the figures billing reads stay NOT NULL decimals", () => {
    for (const billed of ["dataIngestedInGB", "totalCostInUSD"]) {
      const column: ColumnMetadataArgs = declaredColumn(billed);

      expect(column.options.nullable).toBe(false);
      expect(column.options.type).toBe(ColumnType.Decimal);
    }
  });

  test("the table column is optional: a row without a part is valid", () => {
    const metadata: { required?: boolean } =
      new TelemetryUsageBilling().getTableColumnMetadata(COLUMN);

    expect(metadata).toBeDefined();
    expect(metadata.required).toBe(false);
  });
});

describe("who can read and write the part", () => {
  const model: TelemetryUsageBilling = new TelemetryUsageBilling();
  const part: ColumnAccessControl | null =
    model.getColumnAccessControlFor(COLUMN);
  const whole: ColumnAccessControl | null =
    model.getColumnAccessControlFor("dataIngestedInGB");

  test("nobody creates or updates it through the API: only metering writes it", () => {
    expect(part).not.toBeNull();
    expect(part!.create).toEqual([]);
    expect(part!.update).toEqual([]);
  });

  test("whoever can read the billed figure can read its part, and nobody else", () => {
    expect(whole).not.toBeNull();
    expect(part!.read.length).toBeGreaterThan(0);
    expect([...part!.read].sort()).toEqual([...whole!.read].sort());
  });
});

describe("the opt-in Postgres suite runs in CI", () => {
  const WORKFLOW: string = fs.readFileSync(
    path.join(REPO_ROOT, ".github", "workflows", "postgres-schema-drift.yaml"),
    "utf8",
  );
  const SUITE_FILE: string =
    "Tests/Server/Services/TelemetryUsageExceptionsPostgres.test.ts";
  const SUITE: string = fs.readFileSync(
    path.join(REPO_ROOT, "packages", "Common", SUITE_FILE),
    "utf8",
  );

  // The workflow step that runs the suite, up to the next step.
  const step: string = ((): string => {
    const start: number = WORKFLOW.indexOf(
      "- name: Test telemetry usage with exceptions apart, on migrated Postgres",
    );

    if (start === -1) {
      return "";
    }

    const next: number = WORKFLOW.indexOf("\n      - name:", start + 1);

    return WORKFLOW.slice(start, next === -1 ? undefined : next);
  })();

  test("the schema drift workflow has a step for it", () => {
    expect(step).not.toBe("");
  });

  test("the step runs the suite from packages/Common", () => {
    expect(step).toContain("working-directory: packages/Common");
    expect(step).toContain(SUITE_FILE);
    expect(
      fs.existsSync(path.join(REPO_ROOT, "packages", "Common", SUITE_FILE)),
    ).toBe(true);
  });

  test("the step switches the suite on with the variable the suite checks", () => {
    expect(SUITE).toContain(
      `process.env["RUN_POSTGRES_TELEMETRY_USAGE_EXCEPTIONS_TESTS"] === "true"`,
    );
    expect(step).toContain(
      `RUN_POSTGRES_TELEMETRY_USAGE_EXCEPTIONS_TESTS: "true"`,
    );
  });

  test.each([
    "TELEMETRY_USAGE_EXCEPTIONS_TEST_DATABASE_HOST",
    "TELEMETRY_USAGE_EXCEPTIONS_TEST_DATABASE_PORT",
    "TELEMETRY_USAGE_EXCEPTIONS_TEST_DATABASE_NAME",
  ])("the step gives the suite %s, which it reads", (variable: string) => {
    expect(SUITE).toContain(`process.env["${variable}"]`);
    expect(step).toContain(`${variable}:`);
  });

  test("the step points the suite at the migrated database", () => {
    expect(step).toContain("${{ env.DATABASE_MIGRATIONS_HOST }}");
    expect(step).toContain("${{ env.DATABASE_MIGRATIONS_PORT }}");
  });
});
