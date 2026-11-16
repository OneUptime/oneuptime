import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddSampleProject1809123500000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809123500000-AddSampleProject";
import { AddSampleProjectUserIndex1809123500001 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809123500001-AddSampleProjectUserIndex";
import { MasterApiKeyHashedColumn1809180790100 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809180790100-MasterApiKeyHashedColumn";
import { RemoveSampleProject1809180800000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809180800000-RemoveSampleProject";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Project from "../../../../Models/DatabaseModels/Project";
import User from "../../../../Models/DatabaseModels/User";
import { getTableColumn } from "../../../../Types/Database/TableColumn";
import {
  DefaultNamingStrategy,
  MigrationInterface,
  QueryRunner,
} from "typeorm";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The sample project is removed (it was added by AddSampleProject and
 * AddSampleProjectUserIndex, issue #6808), by one migration:
 *
 *   - every sample project is deleted while Project.isSampleProject still
 *     finds it, and with it everything in it, its made-up people included
 *     (User.sampleProjectId, ON DELETE CASCADE): with the code that kept a
 *     sample quiet gone, one left behind would notify, probe and bill;
 *   - a made-up person whose sample is somehow already gone is deleted too;
 *   - then the foreign key, the index (online: "User" is written by every
 *     sign-in) and both columns go, as the models no longer have them.
 *
 * Statements are recorded against a fake QueryRunner, the online step by
 * stubbing OnlineDdl; the schema drift check runs them on Postgres against
 * the models. The names are TypeORM's, worked out here as it works them out.
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();
const INDEX_NAME: string = naming.indexName("User", ["sampleProjectId"]);
const FOREIGN_KEY_NAME: string = naming.foreignKeyName(
  "User",
  ["sampleProjectId"],
  "Project",
  ["_id"],
);

const DELETE_SAMPLE_PROJECTS: string = `DELETE FROM "Project" WHERE "isSampleProject" = true`;
const DELETE_SAMPLE_PEOPLE: string = `DELETE FROM "User" WHERE "sampleProjectId" IS NOT NULL`;

// Every statement, in the order it ran; an online one names its step.
type Recorded = Array<string>;

async function record(data: {
  migration: MigrationInterface;
  direction: "up" | "down";
  // The columns the database still has, as hasColumn answers.
  columns?: Array<string>;
}): Promise<Recorded> {
  const recorded: Recorded = [];

  for (const step of ["createIndex", "dropIndex", "addForeignKey"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      sql: string,
    ) => {
      recorded.push(`OnlineDdl.${step}: ${sql}`);
    }) as never);
  }

  const columns: Array<string> = data.columns || [
    "Project.isSampleProject",
    "User.sampleProjectId",
  ];

  const runner: QueryRunner = {
    isTransactionActive: false,
    query: async (sql: string): Promise<void> => {
      recorded.push(sql);
    },
    hasColumn: async (table: string, column: string): Promise<boolean> => {
      return columns.includes(`${table}.${column}`);
    },
  } as unknown as QueryRunner;

  if (data.direction === "up") {
    await data.migration.up(runner);
  } else {
    await data.migration.down(runner);
  }

  return recorded;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RemoveSampleProject1809180800000", () => {
  test("runs outside a transaction, as DROP INDEX CONCURRENTLY must", () => {
    expect(new RemoveSampleProject1809180800000().transaction).toBe(false);
  });

  test("deletes the sample projects and their people, then drops the key, the index and both columns", async () => {
    const recorded: Recorded = await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "up",
    });

    expect(recorded).toEqual([
      DELETE_SAMPLE_PROJECTS,
      DELETE_SAMPLE_PEOPLE,
      `ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "${FOREIGN_KEY_NAME}"`,
      `OnlineDdl.dropIndex: DROP INDEX "public"."${INDEX_NAME}"`,
      `ALTER TABLE "User" DROP COLUMN IF EXISTS "sampleProjectId"`,
      `ALTER TABLE "Project" DROP COLUMN IF EXISTS "isSampleProject"`,
    ]);
  });

  test("deletes the samples while the foreign key that takes their people with them is still there", async () => {
    const recorded: Recorded = await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "up",
    });

    const foreignKeyDropped: number = recorded.findIndex(
      (statement: string): boolean => {
        return statement.includes("DROP CONSTRAINT");
      },
    );

    expect(recorded.indexOf(DELETE_SAMPLE_PROJECTS)).toBeGreaterThanOrEqual(0);
    expect(recorded.indexOf(DELETE_SAMPLE_PROJECTS)).toBeLessThan(
      foreignKeyDropped,
    );
    expect(recorded.indexOf(DELETE_SAMPLE_PEOPLE)).toBeLessThan(
      foreignKeyDropped,
    );
  });

  test("run again after a stop part way, it deletes only by the columns still there and fails on nothing gone", async () => {
    // Stopped after User.sampleProjectId went: the samples are already gone.
    const afterUserColumn: Recorded = await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "up",
      columns: ["Project.isSampleProject"],
    });

    expect(afterUserColumn).not.toContain(DELETE_SAMPLE_PEOPLE);
    expect(afterUserColumn[0]).toBe(DELETE_SAMPLE_PROJECTS);

    // Stopped after both columns went, before the run was recorded.
    const afterBoth: Recorded = await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "up",
      columns: [],
    });

    expect(
      afterBoth.filter((statement: string): boolean => {
        return statement.startsWith("DELETE");
      }),
    ).toEqual([]);

    for (const statement of afterBoth) {
      if (statement.startsWith("ALTER TABLE")) {
        expect(statement).toMatch(/\bIF EXISTS\b/);
      }
    }
  });

  test("down puts back the columns, the index and the key as AddSampleProject and AddSampleProjectUserIndex made them", async () => {
    const recorded: Recorded = await record({
      migration: new RemoveSampleProject1809180800000(),
      direction: "down",
    });

    expect(recorded).toEqual([
      `ALTER TABLE "Project" ADD "isSampleProject" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "User" ADD "sampleProjectId" uuid`,
      `CREATE INDEX "${INDEX_NAME}" ON "User" ("sampleProjectId") `,
      `ALTER TABLE "User" ADD CONSTRAINT "${FOREIGN_KEY_NAME}" FOREIGN KEY ("sampleProjectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    ]);
  });

  test("drops what the migrations that added the sample project built, by the same names", async () => {
    const added: Recorded = [
      ...(await record({
        migration: new AddSampleProject1809123500000(),
        direction: "up",
      })),
      ...(await record({
        migration: new AddSampleProjectUserIndex1809123500001(),
        direction: "up",
      })),
    ];

    expect(added).toEqual([
      `ALTER TABLE "Project" ADD "isSampleProject" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "User" ADD "sampleProjectId" uuid`,
      `OnlineDdl.createIndex: CREATE INDEX "${INDEX_NAME}" ON "User" ("sampleProjectId") `,
      `OnlineDdl.addForeignKey: ALTER TABLE "User" ADD CONSTRAINT "${FOREIGN_KEY_NAME}" FOREIGN KEY ("sampleProjectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    ]);
  });

  test("the models no longer have the columns", () => {
    expect(getTableColumn(new Project(), "isSampleProject")).toBeUndefined();
    expect(getTableColumn(new User(), "sampleProject")).toBeUndefined();
    expect(getTableColumn(new User(), "sampleProjectId")).toBeUndefined();
  });
});

describe("its place", () => {
  test("registered once, after the migrations that added the sample project and the one before it", () => {
    const migrations: Array<unknown> = SchemaMigrations as Array<unknown>;
    const removal: number = migrations.indexOf(
      RemoveSampleProject1809180800000,
    );

    expect(removal).toBeGreaterThan(
      migrations.indexOf(AddSampleProjectUserIndex1809123500001),
    );
    expect(removal).toBeGreaterThan(
      migrations.indexOf(MasterApiKeyHashedColumn1809180790100),
    );
    expect(
      migrations.filter((migration: unknown): boolean => {
        return migration === RemoveSampleProject1809180800000;
      }),
    ).toHaveLength(1);
  });

  test("the migrations that added the sample project stay registered: installs have run them", () => {
    const migrations: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(migrations).toContain(AddSampleProject1809123500000);
    expect(migrations).toContain(AddSampleProjectUserIndex1809123500001);
  });
});
