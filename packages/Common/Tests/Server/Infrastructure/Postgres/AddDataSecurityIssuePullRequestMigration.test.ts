import { AddDataSecurityIssuePullRequest1809187660831 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187660831-AddDataSecurityIssuePullRequest";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import DataSecurityIssuePullRequest from "../../../../Models/DatabaseModels/DataSecurityIssuePullRequest";
import { describe, expect, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The table of a person's own pull requests linked to a Data Security
 * issue as its fix (#10831). The SQL is generated, and the schema-drift
 * check proves it matches the model. This pins what a regeneration could
 * silently reverse:
 *
 *  1. A LINK GOES WITH ITS ISSUE, ITS PROJECT AND ITS REPOSITORY, and
 *     outlives the person who made it.
 *  2. WHAT IT SAYS OF THE PULL REQUEST AND OF PRODUCTION IS NULLABLE:
 *     OneUptime writes it, and a row is made before it merges.
 *  3. THE FOLLOWER, THE VERIFIER AND THE ISSUE'S CARD READ IT BY INDEX: by
 *     the issue, by state, by production status, by when it was last
 *     followed.
 *  4. IT IS A NEW TABLE, ALONE IN ITS MIGRATION, and down() drops it; it
 *     runs after every migration before it.
 */

type MigrationClass = new () => MigrationInterface;

const TABLE: string = "DataSecurityIssuePullRequest";

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<Array<unknown>> => {
      statements.push(statement.trim());
      return [];
    },
  } as unknown as QueryRunner;

  await new AddDataSecurityIssuePullRequest1809187660831()[direction](
    queryRunner,
  );

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

describe("AddDataSecurityIssuePullRequest1809187660831", () => {
  test("a link goes with its issue, its project and its repository, and outlives who made it", async () => {
    const up: Array<string> = await recordQueries("up");

    expect(keyTo(up, "dataSecurityIssueId")).toContain(
      `REFERENCES "DataSecurityIssue"("_id") ON DELETE CASCADE`,
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

  test("the issue, the project and the address are required; what OneUptime reads of it and of production is not", async () => {
    const create: string | undefined = (await recordQueries("up")).find(
      (statement: string): boolean => {
        return statement.startsWith(`CREATE TABLE "${TABLE}" (`);
      },
    );

    expect(create).toBeDefined();

    for (const required of [
      `"projectId" uuid NOT NULL`,
      `"dataSecurityIssueId" uuid NOT NULL`,
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
      `"followedAt" TIMESTAMP WITH TIME ZONE,`,
      `"productionCheck" character varying(100),`,
      `"productionStatus" character varying(100),`,
      `"productionStatusAt" TIMESTAMP WITH TIME ZONE,`,
      `"productionSummary" character varying(500),`,
      `"productionBaseline" jsonb,`,
      `"deployedAt" TIMESTAMP WITH TIME ZONE,`,
      `"deployedVersion" character varying(100),`,
      `"deployedCommitSha" character varying(100),`,
    ]) {
      expect(create).toContain(nullable);
    }
  });

  test("the issue's card reads its links, the follower by state and when it last looked, the verifier by production status", async () => {
    const up: Array<string> = await recordQueries("up");
    const indexes: Array<string> = up.filter((statement: string): boolean => {
      return statement.startsWith("CREATE INDEX");
    });

    for (const columns of [
      `("dataSecurityIssueId", "createdAt")`,
      `("dataSecurityIssueId")`,
      `("projectId")`,
      `("codeRepositoryId")`,
      `("pullRequestState")`,
      `("followedAt")`,
      `("productionStatus")`,
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
    expect(new DataSecurityIssuePullRequest().tableName).toBe(TABLE);
  });

  test("runs after every migration before it", () => {
    const migrations: Array<MigrationClass> =
      SchemaMigrations as unknown as Array<MigrationClass>;
    const index: number = migrations.indexOf(
      AddDataSecurityIssuePullRequest1809187660831,
    );

    expect(index).toBeGreaterThan(0);

    // A migration's moment: the thirteen digits its class name ends with.
    const stamp: RegExp = /(\d{13})$/;
    const stamps: Array<number> = migrations
      .slice(0, index)
      .map((migration: MigrationClass): number => {
        return Number(stamp.exec(migration.name)?.[1] || "0");
      });

    expect(Math.max(...stamps)).toBeLessThan(1809187660831);
  });
});
