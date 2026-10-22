import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { RemoveRunbookCredentials1805780000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805780000000-RemoveRunbookCredentials";
import ApiKeyPermission from "../../../../Models/DatabaseModels/ApiKeyPermission";
import CustomRolePermission from "../../../../Models/DatabaseModels/CustomRolePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import TeamPermission from "../../../../Models/DatabaseModels/TeamPermission";
import Permission from "../../../../Types/Permission";

/*
 * The schema half of removing runbook credentials (Runbooks > Runners > AI
 * Access): the Kubernetes cluster's credential column goes, with its
 * foreign key, and the four Runbook Credential permissions - which grant
 * nothing any more - leave every team, API key and custom role that held
 * them. The credentials themselves are deleted by the data migration
 * RemoveRunbookCredentials, which runs after every schema migration: it
 * moves the runbook steps that still name one to variables first, which
 * reads them, so their tables stay (emptied).
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read
 * as text, so up() and down() are told apart and the deletes' parameters
 * are seen. (The schema statements were generated with TypeORM against a
 * database migrated up to master's last migration, and the schema drift
 * check finds nothing left to generate once this one has run.)
 */

const MIGRATION_TIMESTAMP: string = "1805780000000";
const MIGRATION_BASE_NAME: string = "RemoveRunbookCredentials";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

// A migration's 13-digit timestamp, read off its class name.
const TIMESTAMP_OF_NAME: RegExp = /(\d{13})$/;

const REMOVED_PERMISSIONS: Array<string> = [
  "CreateRunbookCredential",
  "EditRunbookCredential",
  "DeleteRunbookCredential",
  "ReadRunbookCredential",
];

interface Statement {
  sql: string;
  parameters?: Array<unknown> | undefined;
}

async function statementsOf(
  direction: "up" | "down",
): Promise<Array<Statement>> {
  const statements: Array<Statement> = [];
  const runner: QueryRunner = {
    query: async (sql: string, parameters?: Array<unknown>): Promise<void> => {
      statements.push(parameters ? { sql, parameters } : { sql });
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new RemoveRunbookCredentials1805780000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("RemoveRunbookCredentials1805780000000", () => {
  test("drops the cluster's credential column with its foreign key, then the four permissions from every table that grants them", async () => {
    expect(await statementsOf("up")).toEqual([
      {
        sql: `ALTER TABLE "KubernetesCluster" DROP CONSTRAINT "FK_b4a0ae50ee63ca22e46e396ca3e"`,
      },
      {
        sql: `ALTER TABLE "KubernetesCluster" DROP COLUMN "aiAccessCredentialId"`,
      },
      {
        sql: `DELETE FROM "TeamPermission" WHERE "permission" = ANY($1::text[])`,
        parameters: [REMOVED_PERMISSIONS],
      },
      {
        sql: `DELETE FROM "ApiKeyPermission" WHERE "permission" = ANY($1::text[])`,
        parameters: [REMOVED_PERMISSIONS],
      },
      {
        sql: `DELETE FROM "CustomRolePermission" WHERE "permission" = ANY($1::text[])`,
        parameters: [REMOVED_PERMISSIONS],
      },
    ]);
  });

  test("deletes only rows of the four permissions: every other permission of a team, key or role stays", async () => {
    const deletes: Array<Statement> = (await statementsOf("up")).filter(
      (statement: Statement): boolean => {
        return statement.sql.startsWith("DELETE");
      },
    );

    expect(deletes).toHaveLength(3);

    for (const statement of deletes) {
      // One condition: the permission is one of the four, passed as data.
      expect(statement.sql).toMatch(
        /^DELETE FROM "\w+" WHERE "permission" = ANY\(\$1::text\[\]\)$/,
      );
      expect(statement.parameters).toEqual([REMOVED_PERMISSIONS]);
    }
  });

  test("the four permissions are the ones that went: no Permission is named so any more, and the runbook ones that stay still are", () => {
    const permissions: Array<string> = Object.values(
      Permission,
    ) as Array<string>;

    for (const removed of REMOVED_PERMISSIONS) {
      expect({ removed, present: permissions.includes(removed) }).toEqual({
        removed,
        present: false,
      });
    }

    for (const kept of [
      "ReadRunbook",
      "CreateRunbook",
      "ReadRunbookSecret",
      "CreateRunbookSecret",
    ]) {
      expect({ kept, present: permissions.includes(kept) }).toEqual({
        kept,
        present: true,
      });
    }
  });

  test("names the tables that hold a permission per row, by the column they keep it in", () => {
    const tables: Array<{ new (): BaseModel }> = [
      TeamPermission,
      ApiKeyPermission,
      CustomRolePermission,
    ];

    for (const modelType of tables) {
      const model: BaseModel = new modelType();

      expect(model.getTableColumns().columns).toContain("permission");
    }

    expect(
      tables.map((modelType: { new (): BaseModel }): string => {
        return new modelType().tableName || "";
      }),
    ).toEqual(["TeamPermission", "ApiKeyPermission", "CustomRolePermission"]);
  });

  test("leaves the credential tables for the data migration that reads, then deletes, them", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement.sql).not.toMatch(/DROP TABLE|"RunbookCredential"/);
    }
  });

  test("down puts the column and its foreign key back, as TypeORM generated them, and no permission", async () => {
    expect(await statementsOf("down")).toEqual([
      {
        sql: `ALTER TABLE "KubernetesCluster" ADD "aiAccessCredentialId" uuid`,
      },
      {
        sql: `ALTER TABLE "KubernetesCluster" ADD CONSTRAINT "FK_b4a0ae50ee63ca22e46e396ca3e" FOREIGN KEY ("aiAccessCredentialId") REFERENCES "RunbookCredential"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      },
    ]);
  });

  test("matches the model: a cluster names no credential, under either name", () => {
    const cluster: KubernetesCluster = new KubernetesCluster();

    expect(cluster.getTableColumns().columns).not.toContain(
      "aiAccessCredentialId",
    );
    expect(cluster.getTableColumns().columns).not.toContain(
      "aiAccessCredential",
    );
    // The Runner binding stays: the previous in-cluster Runner binds itself.
    expect(cluster.getTableColumns().columns).toContain("aiAccessRunnerId");
  });

  test("is registered, named for its class, and ordered after every migration before it", () => {
    const registered: Array<string> = (
      SchemaMigrations as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    expect(registered).toContain(MIGRATION_CLASS_NAME);
    expect(new RemoveRunbookCredentials1805780000000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);
    // Renumbered past master's migrations, twice: the old names are no file.
    for (const renumberedFrom of ["1805650000000", "1805750000000"]) {
      expect(
        fs.existsSync(
          path.join(
            MIGRATION_DIRECTORY,
            `${renumberedFrom}-${MIGRATION_BASE_NAME}.ts`,
          ),
        ),
      ).toBe(false);
    }

    const timestamps: Array<number> = registered.map((name: string): number => {
      const match: RegExpMatchArray | null = name.match(TIMESTAMP_OF_NAME);
      return match ? parseInt(match[1]!, 10) : 0;
    });
    const at: number = registered.indexOf(MIGRATION_CLASS_NAME);

    for (const earlier of timestamps.slice(0, at)) {
      expect(earlier).toBeLessThan(parseInt(MIGRATION_TIMESTAMP, 10));
    }
  });
});
