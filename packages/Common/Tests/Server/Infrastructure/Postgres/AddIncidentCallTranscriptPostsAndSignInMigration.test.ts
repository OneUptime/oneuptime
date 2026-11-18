import { describe, expect, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddIncidentCallTranscriptPostsAndSignIn1809184700000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184700000-AddIncidentCallTranscriptPostsAndSignIn";
import { AddIncidentCallTranscriptSignInIndexes1809184710000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184710000-AddIncidentCallTranscriptSignInIndexes";
import IncidentVideoCall from "../../../../Models/DatabaseModels/IncidentVideoCall";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migrations behind taking back a call's transcript, and what OneUptime
 * AI read in it, everywhere it went (#9289, #9290):
 *
 *   - AddIncidentCallTranscriptPostsAndSignIn: three nullable columns on
 *     IncidentVideoCall, with no default - where each reading was posted
 *     (callSummaryPosts), whose sign-in read the transcript
 *     (transcriptSignInAccountId), and when that account removed OneUptime
 *     (transcriptSignInRemovedAt). Adding them rewrites nothing and blocks
 *     nothing.
 *   - AddIncidentCallTranscriptSignInIndexes: their two partial indexes,
 *     built online (Docs/migrations/README.md), since IncidentVideoCall is
 *     written by every call a rule starts.
 *
 * The statements run against a fake QueryRunner. The schema drift check
 * holds them to the model; here, the model's columns are server-only, and
 * both migrations are registered, in order, after every migration before
 * them.
 */

async function statementsOf(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<Array<unknown>> => {
      statements.push(sql);
      return [];
    },
  } as unknown as QueryRunner;

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddIncidentCallTranscriptPostsAndSignIn1809184700000", () => {
  test("adds the three columns to IncidentVideoCall, nullable, with no default", async () => {
    expect(
      await statementsOf(
        new AddIncidentCallTranscriptPostsAndSignIn1809184700000(),
        "up",
      ),
    ).toEqual([
      `ALTER TABLE "IncidentVideoCall" ADD "callSummaryPosts" jsonb`,
      `ALTER TABLE "IncidentVideoCall" ADD "transcriptSignInAccountId" character varying(100)`,
      `ALTER TABLE "IncidentVideoCall" ADD "transcriptSignInRemovedAt" TIMESTAMP WITH TIME ZONE`,
    ]);
  });

  test("down drops what up added, and nothing else", async () => {
    expect(
      await statementsOf(
        new AddIncidentCallTranscriptPostsAndSignIn1809184700000(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "transcriptSignInRemovedAt"`,
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "transcriptSignInAccountId"`,
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "callSummaryPosts"`,
    ]);
  });

  test("the model declares each column: written and read only by OneUptime", () => {
    const model: IncidentVideoCall = new IncidentVideoCall();

    for (const [column, type] of [
      ["callSummaryPosts", TableColumnType.JSON],
      ["transcriptSignInAccountId", TableColumnType.ShortText],
      ["transcriptSignInRemovedAt", TableColumnType.Date],
    ] as Array<[string, TableColumnType]>) {
      expect(model.getTableColumns().columns).toContain(column);
      expect(model.getTableColumnMetadata(column).type).toBe(type);
      expect(model.getTableColumnMetadata(column).required).toBeFalsy();
      // No reader, not even a project owner: it names channels and accounts.
      expect(model.getColumnAccessControlFor(column)?.read).toEqual([]);
      expect(model.getColumnAccessControlFor(column)?.create).toEqual([]);
      expect(model.getColumnAccessControlFor(column)?.update).toEqual([]);
    }
  });
});

describe("AddIncidentCallTranscriptSignInIndexes1809184710000", () => {
  test("builds both partial indexes online, outside a transaction", async () => {
    const migration: AddIncidentCallTranscriptSignInIndexes1809184710000 =
      new AddIncidentCallTranscriptSignInIndexes1809184710000();
    const created: Array<string> = [];
    const original: typeof OnlineDdl.createIndex = OnlineDdl.createIndex;

    OnlineDdl.createIndex = async (
      _runner: QueryRunner,
      statement: string,
    ): Promise<void> => {
      created.push(statement);
    };

    try {
      await migration.up({} as QueryRunner);
    } finally {
      OnlineDdl.createIndex = original;
    }

    expect(migration.transaction).toBe(false);
    expect(created).toEqual([
      `CREATE INDEX "IDX_9de180854541dc15c8d06111a7" ON "IncidentVideoCall" ("transcriptSignInRemovedAt") WHERE "transcriptSignInRemovedAt" IS NOT NULL`,
      `CREATE INDEX "IDX_0b478574bffaf40674fc5f4e40" ON "IncidentVideoCall" ("transcriptSignInAccountId") WHERE "transcriptSignInAccountId" IS NOT NULL`,
    ]);
  });
});

describe("their place among the migrations", () => {
  test("both are registered once, under their own names, the columns before their indexes, after every migration before them", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );
    const columns: string =
      "AddIncidentCallTranscriptPostsAndSignIn1809184700000";
    const indexes: string =
      "AddIncidentCallTranscriptSignInIndexes1809184710000";

    for (const name of [columns, indexes]) {
      expect(
        names.filter((each: string): boolean => {
          return each === name;
        }),
      ).toHaveLength(1);
    }

    expect(new AddIncidentCallTranscriptPostsAndSignIn1809184700000().name).toBe(
      columns,
    );
    expect(new AddIncidentCallTranscriptSignInIndexes1809184710000().name).toBe(
      indexes,
    );
    expect(names.indexOf(indexes)).toBe(names.indexOf(columns) + 1);
    expect(names.indexOf(columns)).toBeGreaterThan(
      names.indexOf("AddBiLineageSummaryAndDashboardUpstream1809184620000"),
    );
  });
});
