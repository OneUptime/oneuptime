import { AddSecurityAutomaticResponseHourlyLimit1809187530746 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187530746-AddSecurityAutomaticResponseHourlyLimit";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Project from "../../../../Models/DatabaseModels/Project";
import { SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR } from "../../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import { describe, expect, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The migration behind a project's own hourly limit of automatic blocks
 * (#10746): Project.securityAutomaticResponseMaxBlocksPerHour.
 *
 * The SQL is generated, and the schema-drift check proves it matches the
 * model. This pins what a regeneration could silently reverse:
 *
 *  1. EVERY PROJECT KEEPS THE LIMIT IT HAD: the column defaults to 50, the
 *     limit every project's policies were held to before, and is never
 *     null - a read of it never finds no limit.
 *  2. THE PROJECT TABLE IS NOT HELD UP: a constant default, so Postgres
 *     adds the column without rewriting the table; no index, no key.
 *  3. down() undoes up(), and it runs after every migration before it.
 */

type MigrationClass = new () => MigrationInterface;

const STAMP: RegExp = /(\d{13})$/;

async function recordQueries(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];
  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<Array<unknown>> => {
      statements.push(statement.trim());
      return [];
    },
  } as unknown as QueryRunner;

  await migration[direction](queryRunner);

  return statements;
}

describe("AddSecurityAutomaticResponseHourlyLimit1809187530746", () => {
  test("adds the project's limit, 50 for every project, never null", async () => {
    expect(
      await recordQueries(
        new AddSecurityAutomaticResponseHourlyLimit1809187530746(),
        "up",
      ),
    ).toEqual([
      `ALTER TABLE "Project" ADD "securityAutomaticResponseMaxBlocksPerHour" integer NOT NULL DEFAULT '50'`,
    ]);
  });

  test("its default is the model's, and the limit the policies were held to before", () => {
    const column: { defaultValue?: unknown; required?: boolean } =
      new Project().getTableColumnMetadata(
        "securityAutomaticResponseMaxBlocksPerHour",
      ) as unknown as { defaultValue?: unknown; required?: boolean };

    expect(column.defaultValue).toBe(50);
    expect(column.required).toBe(true);
    expect(SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR).toBe(50);
  });

  test("builds no index and adds no key: nothing that scans the Project table", async () => {
    const up: Array<string> = await recordQueries(
      new AddSecurityAutomaticResponseHourlyLimit1809187530746(),
      "up",
    );

    for (const statement of up) {
      expect(statement).not.toMatch(/CREATE (UNIQUE )?INDEX|FOREIGN KEY/);
    }
  });

  test("down() drops what up() added", async () => {
    expect(
      await recordQueries(
        new AddSecurityAutomaticResponseHourlyLimit1809187530746(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "Project" DROP COLUMN "securityAutomaticResponseMaxBlocksPerHour"`,
    ]);
  });

  test("is registered, after every migration before it", () => {
    const migrations: Array<MigrationClass> =
      SchemaMigrations as unknown as Array<MigrationClass>;
    const index: number = migrations.indexOf(
      AddSecurityAutomaticResponseHourlyLimit1809187530746 as unknown as MigrationClass,
    );

    expect(index).toBeGreaterThan(-1);

    const stampOf: (migration: MigrationClass) => number = (
      migration: MigrationClass,
    ): number => {
      return Number(STAMP.exec(migration.name)?.[1] || 0);
    };
    const stamp: number = stampOf(
      AddSecurityAutomaticResponseHourlyLimit1809187530746 as unknown as MigrationClass,
    );

    for (const earlier of migrations.slice(0, index)) {
      expect({
        earlier: earlier.name,
        before: stampOf(earlier) < stamp,
      }).toEqual({ earlier: earlier.name, before: true });
    }
  });
});
