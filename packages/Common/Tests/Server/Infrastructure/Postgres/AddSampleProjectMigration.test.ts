import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddProductFeedback1809123000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809123000000-AddProductFeedback";
import { AddSampleProject1809123500000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809123500000-AddSampleProject";
import { AddSampleProjectUserIndex1809123500001 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809123500001-AddSampleProjectUserIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Project from "../../../../Models/DatabaseModels/Project";
import User from "../../../../Models/DatabaseModels/User";
import { getTableColumn } from "../../../../Types/Database/TableColumn";
import { MigrationInterface, QueryRunner } from "typeorm";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { DefaultNamingStrategy } from "typeorm";

/*
 * The migrations behind a sample project (issue #6808):
 *
 *   - AddSampleProject adds Project.isSampleProject (false for every
 *     project there is: a constant default, no rewrite) and
 *     User.sampleProjectId (nullable, no default, no rewrite);
 *   - AddSampleProjectUserIndex builds User.sampleProjectId's index and its
 *     foreign key to Project - ON DELETE CASCADE, so a sample's made-up
 *     people go with it - online, outside a transaction: "User" is written
 *     by every sign-in.
 *
 * Statements are recorded against a fake QueryRunner, the online steps by
 * stubbing OnlineDdl; the schema drift check runs them on Postgres against
 * the models. The names are TypeORM's, worked out here as it works them out.
 */

const ROW_STATEMENT: RegExp = /^\s*(UPDATE|INSERT|DELETE|SELECT)\b/i;
const naming: DefaultNamingStrategy = new DefaultNamingStrategy();
const INDEX_NAME: string = naming.indexName("User", ["sampleProjectId"]);
const FOREIGN_KEY_NAME: string = naming.foreignKeyName(
  "User",
  ["sampleProjectId"],
  "Project",
  ["_id"],
);

interface Recorded {
  queries: Array<string>;
  online: Array<{ step: string; sql: string }>;
}

async function record(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Recorded> {
  const recorded: Recorded = { queries: [], online: [] };

  for (const step of ["createIndex", "dropIndex", "addForeignKey"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      sql: string,
    ) => {
      recorded.online.push({ step: step, sql: sql });
    }) as never);
  }

  const runner: QueryRunner = {
    isTransactionActive: false,
    query: async (sql: string): Promise<void> => {
      recorded.queries.push(sql);
    },
  } as unknown as QueryRunner;

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return recorded;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddSampleProject1809123500000", () => {
  test("adds the two columns the models have, rewriting no row", async () => {
    const { queries } = await record(new AddSampleProject1809123500000(), "up");

    expect(queries).toEqual([
      `ALTER TABLE "Project" ADD "isSampleProject" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "User" ADD "sampleProjectId" uuid`,
    ]);
    expect(
      queries.filter((query: string): boolean => {
        return ROW_STATEMENT.test(query);
      }),
    ).toEqual([]);

    expect(getTableColumn(new Project(), "isSampleProject")).toBeDefined();
    expect(getTableColumn(new User(), "sampleProjectId")).toBeDefined();
  });

  test("down undoes up, in the reverse order", async () => {
    const { queries } = await record(
      new AddSampleProject1809123500000(),
      "down",
    );

    expect(queries).toEqual([
      `ALTER TABLE "User" DROP COLUMN "sampleProjectId"`,
      `ALTER TABLE "Project" DROP COLUMN "isSampleProject"`,
    ]);
  });
});

describe("AddSampleProjectUserIndex1809123500001", () => {
  test("runs outside a transaction, as CREATE INDEX CONCURRENTLY must", () => {
    expect(new AddSampleProjectUserIndex1809123500001().transaction).toBe(
      false,
    );
  });

  test("builds the index and the cascading foreign key online, under TypeORM's names", async () => {
    const { queries, online } = await record(
      new AddSampleProjectUserIndex1809123500001(),
      "up",
    );

    expect(queries).toEqual([]);
    expect(online).toEqual([
      {
        step: "createIndex",
        sql: `CREATE INDEX "${INDEX_NAME}" ON "User" ("sampleProjectId") `,
      },
      {
        step: "addForeignKey",
        sql: `ALTER TABLE "User" ADD CONSTRAINT "${FOREIGN_KEY_NAME}" FOREIGN KEY ("sampleProjectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      },
    ]);
  });

  test("down drops the key, then the index", async () => {
    const { queries, online } = await record(
      new AddSampleProjectUserIndex1809123500001(),
      "down",
    );

    expect(queries).toEqual([
      `ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "${FOREIGN_KEY_NAME}"`,
    ]);
    expect(online).toEqual([
      {
        step: "dropIndex",
        sql: `DROP INDEX "public"."${INDEX_NAME}"`,
      },
    ]);
  });
});

describe("their place", () => {
  test("each registered once, in order, after the migration before them", () => {
    const migrations: Array<unknown> = SchemaMigrations as Array<unknown>;
    const columns: number = migrations.indexOf(AddSampleProject1809123500000);
    const index: number = migrations.indexOf(
      AddSampleProjectUserIndex1809123500001,
    );

    expect(columns).toBeGreaterThan(
      migrations.indexOf(AddProductFeedback1809123000000),
    );
    expect(index).toBe(columns + 1);
    expect(
      migrations.filter((migration: unknown): boolean => {
        return (
          migration === AddSampleProject1809123500000 ||
          migration === AddSampleProjectUserIndex1809123500001
        );
      }),
    ).toHaveLength(2);
  });
});
