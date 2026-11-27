import { AddCloudCostReports1809187761009 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187761009-AddCloudCostReports";
import { AddExternalMcpToolReadOnlyMarks1809187791081 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187791081-AddExternalMcpToolReadOnlyMarks";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ExternalMcpToolReadOnlyMark from "../../../../Models/DatabaseModels/ExternalMcpToolReadOnlyMark";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * ISSUE #11081: the table a Project Admin's read-only marks on external MCP
 * servers' tools are kept in - one row a mark, with its project, its
 * server, the tool and the fingerprint of the definition it holds, and who
 * made it (createdByUserId) when (createdAt).
 *
 * The table is new, so its indexes are built and its keys checked on no
 * rows, and no existing row is read or written. Statements are recorded
 * against a fake QueryRunner; the schema drift check runs the migration on
 * Postgres against the model (it was generated against a database every
 * earlier migration had run on, and the check found no drift after it).
 */

const MIGRATION_NAME: string = "AddExternalMcpToolReadOnlyMarks1809187791081";
const TABLE: string = "ExternalMcpToolReadOnlyMark";

const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;
// A column of a CREATE TABLE: its quoted name, then its type.
const CREATED_COLUMN: RegExp = /(?:\(|, )"([A-Za-z_]+)" [A-Za-z]/g;

type MigrationClass = new () => MigrationInterface;

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];
  const runner: QueryRunner = {
    isTransactionActive: true,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;

  const migration: AddExternalMcpToolReadOnlyMarks1809187791081 =
    new AddExternalMcpToolReadOnlyMarks1809187791081();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

function timestampOf(migration: MigrationClass): number {
  const match: RegExpMatchArray | null =
    migration.name.match(TRAILING_TIMESTAMP);

  return match ? parseInt(match[1]!, 10) : 0;
}

describe("the read-only marks migration", () => {
  test("names itself after its timestamp", () => {
    expect(new AddExternalMcpToolReadOnlyMarks1809187791081().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("is registered once, after the newest before it, above every migration before it", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddExternalMcpToolReadOnlyMarks1809187791081,
    );

    expect(
      registered.filter((candidate: MigrationClass): boolean => {
        return candidate === AddExternalMcpToolReadOnlyMarks1809187791081;
      }),
    ).toHaveLength(1);
    expect(at).toBeGreaterThan(
      registered.indexOf(AddCloudCostReports1809187761009),
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddExternalMcpToolReadOnlyMarks1809187791081),
      );
    }
  });

  test("is backed by exactly one file", () => {
    const files: Array<string> = fs.readdirSync(
      path.join(
        __dirname,
        "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
      ),
    );

    expect(
      files.filter((file: string): boolean => {
        return file.startsWith(
          `${timestampOf(AddExternalMcpToolReadOnlyMarks1809187791081)}-`,
        );
      }),
    ).toEqual(["1809187791081-AddExternalMcpToolReadOnlyMarks.ts"]);
  });

  test("creates the marks' table with every column the model stores", async () => {
    const markModel: ExternalMcpToolReadOnlyMark =
      new ExternalMcpToolReadOnlyMark();
    const stored: Array<string> = Object.keys(getTableColumns(markModel))
      .filter((column: string): boolean => {
        return !markModel.isEntityColumn(column);
      })
      .sort();

    const create: string | undefined = (await record("up")).find(
      (step: string): boolean => {
        return step.startsWith(`CREATE TABLE "${TABLE}" `);
      },
    );

    expect(create).toBeDefined();
    expect(
      Array.from(create!.matchAll(CREATED_COLUMN))
        .map((match: RegExpMatchArray): string => {
          return match[1]!;
        })
        .sort(),
    ).toEqual(stored);
  });

  test("a mark goes with its project and its server, and outlives the person who made it", async () => {
    const steps: Array<string> = await record("up");

    expect(
      steps.filter((step: string): boolean => {
        return step.includes(`ALTER TABLE "${TABLE}" ADD CONSTRAINT`);
      }),
    ).toEqual([
      expect.stringMatching(
        /FOREIGN KEY \("projectId"\) REFERENCES "Project"\("_id"\) ON DELETE CASCADE/,
      ),
      expect.stringMatching(
        /FOREIGN KEY \("externalMcpServerId"\) REFERENCES "ExternalMcpServer"\("_id"\) ON DELETE CASCADE/,
      ),
      expect.stringMatching(
        /FOREIGN KEY \("createdByUserId"\) REFERENCES "User"\("_id"\) ON DELETE SET NULL/,
      ),
    ]);
  });

  test("a run finds a server's marks by an index on the server", async () => {
    const steps: Array<string> = await record("up");

    expect(
      steps.filter((step: string): boolean => {
        return step.startsWith("CREATE INDEX");
      }),
    ).toEqual([
      expect.stringContaining(`ON "${TABLE}" ("projectId")`),
      expect.stringContaining(`ON "${TABLE}" ("externalMcpServerId")`),
    ]);
  });

  test("writes no row and touches no other table", async () => {
    for (const step of await record("up")) {
      expect(step).not.toMatch(/^(INSERT|UPDATE|DELETE)\b/);
      expect(step).toMatch(
        new RegExp(
          `^(CREATE TABLE "${TABLE}"|CREATE INDEX "IDX_[0-9a-f]+" ON "${TABLE}"|ALTER TABLE "${TABLE}")`,
        ),
      );
    }
  });

  test("down takes away what up made, keys and indexes first, the table last", async () => {
    const steps: Array<string> = await record("down");

    expect(steps[steps.length - 1]).toBe(`DROP TABLE "${TABLE}"`);
    expect(
      steps.filter((step: string): boolean => {
        return step.includes("DROP CONSTRAINT");
      }),
    ).toHaveLength(3);
    expect(
      steps.filter((step: string): boolean => {
        return step.startsWith("DROP INDEX");
      }),
    ).toHaveLength(2);
  });
});
