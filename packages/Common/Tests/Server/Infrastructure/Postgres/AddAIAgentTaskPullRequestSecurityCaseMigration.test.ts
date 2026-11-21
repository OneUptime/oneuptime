import { describe, expect, test } from "@jest/globals";
import { createHash } from "crypto";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddAIAgentTaskPullRequestSecurityCase1809187420000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187420000-AddAIAgentTaskPullRequestSecurityCase";
import { AddAIAgentTaskPullRequestSecurityCaseIndex1809187420010 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187420010-AddAIAgentTaskPullRequestSecurityCaseIndex";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migrations that keep a security case's fixes on the case (#10347):
 * "AIAgentTaskPullRequest" gains "securityCaseId", nullable, with nothing
 * backfilled, and its index - the table already holds every pull request
 * OneUptime AI opened, and the pull request sync writes it - is built
 * online in a migration of its own (Docs/migrations/README.md), named as
 * TypeORM names the model's @Index, so the drift check finds nothing to
 * make again.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart.
 */

interface Recorded {
  statements: Array<string>;
}

function runner(recorded: Recorded): QueryRunner {
  return {
    query: async (sql: string): Promise<void> => {
      recorded.statements.push(sql);
    },
  } as unknown as QueryRunner;
}

async function statementsOf(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const recorded: Recorded = { statements: [] };

  if (direction === "up") {
    await migration.up(runner(recorded));
  } else {
    await migration.down(runner(recorded));
  }

  return recorded.statements;
}

// TypeORM's name for an index on these columns of this table.
function typeOrmIndexName(table: string, columns: Array<string>): string {
  return `IDX_${createHash("sha1")
    .update(`${table}_${[...columns].sort().join("_")}`)
    .digest("hex")
    .substring(0, 26)}`;
}

describe("AddAIAgentTaskPullRequestSecurityCase1809187420000", () => {
  test("adds the case a pull request fixes, nullable, and nothing else", async () => {
    expect(
      await statementsOf(
        new AddAIAgentTaskPullRequestSecurityCase1809187420000(),
        "up",
      ),
    ).toEqual([
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "securityCaseId" uuid`,
    ]);
    expect(
      await statementsOf(
        new AddAIAgentTaskPullRequestSecurityCase1809187420000(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "securityCaseId"`,
    ]);
  });

  test("the model declares it: an id, written by OneUptime only, read as the pull request is, indexed", () => {
    const model: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
    const column: string = "securityCaseId";

    expect(model.getTableColumns().columns).toContain(column);
    expect(model.getTableColumnMetadata(column).type).toBe(
      TableColumnType.ObjectID,
    );
    expect(model.getTableColumnMetadata(column).required).toBeFalsy();
    expect(model.getColumnAccessControlFor(column)?.create).toEqual([]);
    expect(model.getColumnAccessControlFor(column)?.update).toEqual([]);
    expect(model.getColumnAccessControlFor(column)?.read).toEqual(
      model.getColumnAccessControlFor("aiRunId")?.read,
    );
  });
});

describe("AddAIAgentTaskPullRequestSecurityCaseIndex1809187420010", () => {
  const migration: AddAIAgentTaskPullRequestSecurityCaseIndex1809187420010 =
    new AddAIAgentTaskPullRequestSecurityCaseIndex1809187420010();

  test("builds the index online, outside a transaction, under TypeORM's own name for it", () => {
    expect(migration.transaction).toBe(false);
    expect(typeOrmIndexName("AIAgentTaskPullRequest", ["securityCaseId"])).toBe(
      "IDX_36aa96d76154de8d529861b7c1",
    );
    // Handed to OnlineDdl, exactly as generated (SchemaMigrationsOnlineDdl reads the files too).
    expect(migration.up.toString()).toContain(".createIndex(");
    expect(migration.up.toString()).toContain(
      `CREATE INDEX "IDX_36aa96d76154de8d529861b7c1" ON "AIAgentTaskPullRequest" ("securityCaseId") `,
    );
    expect(migration.down.toString()).toContain(".dropIndex(");
  });

  test("both are registered once, under their own names, the column first, after every migration before them", () => {
    const names: Array<string> = SchemaMigrations.map(
      (registered: { name: string }): string => {
        return registered.name;
      },
    );
    const column: string = "AddAIAgentTaskPullRequestSecurityCase1809187420000";
    const index: string =
      "AddAIAgentTaskPullRequestSecurityCaseIndex1809187420010";

    expect(new AddAIAgentTaskPullRequestSecurityCase1809187420000().name).toBe(
      column,
    );
    expect(migration.name).toBe(index);

    for (const name of [column, index]) {
      expect(
        names.filter((registered: string): boolean => {
          return registered === name;
        }),
      ).toHaveLength(1);
    }

    expect(names.indexOf(index)).toBeGreaterThan(names.indexOf(column));
    expect(names.indexOf(column)).toBeGreaterThan(
      names.indexOf("AddRecordCreatedByAndLastModifiedColumns1809187400000"),
    );
  });
});
