import { AddSecurityCasePullRequest1809187540604 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187540604-AddSecurityCasePullRequest";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import SecurityCasePullRequest from "../../../../Models/DatabaseModels/SecurityCasePullRequest";
import { describe, expect, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The table of a person's own pull requests linked to a security case
 * (#10604). The SQL is generated, and the schema-drift check proves it
 * matches the model. This pins what a regeneration could silently reverse:
 *
 *  1. A LINK GOES WITH ITS CASE, ITS PROJECT AND ITS REPOSITORY, and
 *     outlives the person who made it.
 *  2. WHAT IT SAYS OF THE PULL REQUEST IS NULLABLE: OneUptime writes it,
 *     and a row is made before its deploy is known.
 *  3. THE FOLLOWER AND THE CASE'S CARD READ IT BY INDEX: by the case, by
 *     state, by when it was last followed.
 *  4. IT IS A NEW TABLE, ALONE IN ITS MIGRATION, and down() drops it; it
 *     runs after every migration before it.
 */

type MigrationClass = new () => MigrationInterface;

const TABLE: string = "SecurityCasePullRequest";

async function recordQueries(
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];
  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<Array<unknown>> => {
      statements.push(statement.trim());
      return [];
    },
  } as unknown as QueryRunner;

  await new AddSecurityCasePullRequest1809187540604()[direction](queryRunner);

  return statements;
}

function keyTo(statements: Array<string>, column: string): string {
  const found: string | undefined = statements.find(
    (statement: string): boolean => {
      return (
        statement.startsWith(`ALTER TABLE "${TABLE}" ADD CONSTRAINT`) &&
        statement.includes(`FOREIGN KEY ("${column}")`)
      );
    },
  );

  expect({ column, keyed: Boolean(found) }).toEqual({ column, keyed: true });
  return found!;
}

describe("AddSecurityCasePullRequest1809187540604", () => {
  test("a link goes with its case, its project and its repository, and outlives who made it", async () => {
    const up: Array<string> = await recordQueries("up");

    expect(keyTo(up, "securityCaseId")).toContain(
      `REFERENCES "SecurityCase"("_id") ON DELETE CASCADE`,
    );
    expect(keyTo(up, "projectId")).toContain(
      `REFERENCES "Project"("_id") ON DELETE CASCADE`,
    );
    expect(keyTo(up, "codeRepositoryId")).toContain(
      `REFERENCES "CodeRepository"("_id") ON DELETE CASCADE`,
    );
    expect(keyTo(up, "createdByUserId")).toContain(
      `REFERENCES "User"("_id") ON DELETE SET NULL`,
    );
  });

  test("the case, the project and the address are required; what OneUptime reads of it is not", async () => {
    const create: string | undefined = (await recordQueries("up")).find(
      (statement: string): boolean => {
        return statement.startsWith(`CREATE TABLE "${TABLE}" (`);
      },
    );

    expect(create).toBeDefined();

    for (const required of [
      `"projectId" uuid NOT NULL`,
      `"securityCaseId" uuid NOT NULL`,
      `"pullRequestUrl" text NOT NULL`,
    ]) {
      expect(create).toContain(required);
    }

    for (const nullable of [
      `"codeRepositoryId" uuid,`,
      `"pullRequestNumber" integer,`,
      `"pullRequestState" character varying(100),`,
      `"mergeCommitSha" character varying(100),`,
      `"mergedAt" TIMESTAMP WITH TIME ZONE,`,
      `"deployedAt" TIMESTAMP WITH TIME ZONE,`,
      `"deployedVersion" character varying(100),`,
      `"deployedCommitSha" character varying(100),`,
      `"followedAt" TIMESTAMP WITH TIME ZONE,`,
    ]) {
      expect(create).toContain(nullable);
    }
  });

  test("the card reads a case's links, and the follower reads them by state and by when it last looked", async () => {
    const up: Array<string> = await recordQueries("up");
    const indexes: Array<string> = up.filter((statement: string): boolean => {
      return statement.startsWith("CREATE INDEX");
    });

    for (const columns of [
      `("securityCaseId", "createdAt")`,
      `("securityCaseId")`,
      `("projectId")`,
      `("codeRepositoryId")`,
      `("pullRequestState")`,
      `("followedAt")`,
    ]) {
      expect({
        columns,
        indexed: indexes.some((statement: string): boolean => {
          return statement.endsWith(`ON "${TABLE}" ${columns}`);
        }),
      }).toEqual({ columns, indexed: true });
    }
  });

  test("a new table, alone: nothing else is altered, and down() drops it", async () => {
    const up: Array<string> = await recordQueries("up");

    for (const statement of up) {
      expect(statement).toContain(`"${TABLE}"`);
    }

    const down: Array<string> = await recordQueries("down");

    expect(down[down.length - 1]).toBe(`DROP TABLE "${TABLE}"`);
  });

  test("its model is the table", () => {
    expect(new SecurityCasePullRequest().tableName).toBe(TABLE);
  });

  test("runs after every migration before it", () => {
    const migrations: Array<MigrationClass> =
      SchemaMigrations as unknown as Array<MigrationClass>;
    const index: number = migrations.indexOf(
      AddSecurityCasePullRequest1809187540604,
    );

    expect(index).toBeGreaterThan(0);

    const stamps: Array<number> = migrations
      .slice(0, index)
      .map((migration: MigrationClass): number => {
        return Number(/(\d{13})$/.exec(migration.name)?.[1] || "0");
      });

    expect(Math.max(...stamps)).toBeLessThan(1809187540604);
  });
});
