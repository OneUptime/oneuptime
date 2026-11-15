import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddTeamMemberUserProjectIndex1809168000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809168000000-AddTeamMemberUserProjectIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A PERSON'S MEMBERSHIPS, BY PERSON AND PROJECT.
 *
 * "TeamMember" was indexed on teamId and projectId only, so every read of
 * one person's memberships read the whole table: every sign-in reads all of
 * them (AccessTokenService.refreshUserAllPermissions), a request in a
 * project reads theirs in it (getTeamIdsForUser, a permission set rebuilt),
 * and the dashboard's header counts their pending invitations on every
 * page. ("userId", "projectId") makes each a range.
 *
 * Named as TypeORM names it from the model's declaration, so the schema
 * drift check finds nothing to change, and built online, outside a
 * transaction (OnlineDdl): TeamMember already holds data. Pure SQL-contract
 * assertions against a fake QueryRunner; OnlineDdl's own steps are recorded
 * as "online: <statement>".
 */

const NAME: string = "IDX_2b0c3c8c89e21cadd48af0c979";
const CREATE: string = `CREATE INDEX "${NAME}" ON "TeamMember" ("userId", "projectId") `;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  for (const step of ["createIndex", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      statements.push(`online: ${statement}`);
    }) as never);
  }

  await run({
    isTransactionActive: false,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddTeamMemberUserProjectIndex1809168000000", () => {
  test("the index is named as TypeORM names it: the drift check finds nothing", () => {
    expect(
      new DefaultNamingStrategy().indexName("TeamMember", [
        "userId",
        "projectId",
      ]),
    ).toBe(NAME);
  });

  test("builds it online, outside a transaction - and nothing else", async () => {
    const migration: AddTeamMemberUserProjectIndex1809168000000 =
      new AddTeamMemberUserProjectIndex1809168000000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`online: ${CREATE}`]);
  });

  test("OnlineDdl reads the build as one it can run concurrently, person first", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(CREATE);

    expect(parsed.name).toBe(NAME);
    expect(parsed.quotedTable).toBe(`"TeamMember"`);
    expect(parsed.build).toContain("CREATE INDEX CONCURRENTLY");
    expect(parsed.build).toContain(`("userId", "projectId")`);
  });

  test("down() takes it away, online", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddTeamMemberUserProjectIndex1809168000000().down(runner);
      }),
    ).toEqual([`online: DROP INDEX "public"."${NAME}"`]);
  });

  test("is registered once, after the migrations before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddTeamMemberUserProjectIndex1809168000000;
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("AddTeamMemberUserProjectIndex1809168000000"),
    ).toBeGreaterThan(
      names.indexOf("MatchMonitorIndexesToTheirReads1809165000000"),
    );
    expect(new AddTeamMemberUserProjectIndex1809168000000().name).toBe(
      "AddTeamMemberUserProjectIndex1809168000000",
    );
  });
});

describe("the model says the same", () => {
  test("TeamMember declares (userId, projectId), not unique, on every row", () => {
    const declared: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter((index: IndexMetadataArgs) => {
        return (
          index.target === TeamMember &&
          Array.isArray(index.columns) &&
          (index.columns as Array<string>).join(",") === "userId,projectId"
        );
      });

    expect(declared).toHaveLength(1);
    expect(declared[0]!.unique).toBeFalsy();
    expect(declared[0]!.where).toBeUndefined();
  });

  test("the person comes first: a read of all of someone's memberships, which names no project, is a range of it too", () => {
    const declared: IndexMetadataArgs | undefined =
      getMetadataArgsStorage().indices.find((index: IndexMetadataArgs) => {
        return (
          index.target === TeamMember &&
          Array.isArray(index.columns) &&
          (index.columns as Array<string>).includes("userId")
        );
      });

    expect((declared!.columns as Array<string>)[0]).toBe("userId");
  });
});
