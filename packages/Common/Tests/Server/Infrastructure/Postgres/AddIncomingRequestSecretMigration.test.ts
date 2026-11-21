import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import { RecordActorUtil } from "../../../../Types/Database/RecordActor";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddIncomingRequestSecret1809178800000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809178800000-AddIncomingRequestSecret";
import { AddIncomingRequestSecretMonitorAccess1809181830000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809181830000-AddIncomingRequestSecretMonitorAccess";
import { AddServiceLevelObjectiveRequestSli1809178700000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809178700000-AddServiceLevelObjectiveRequestSli";
import IncomingRequestSecret from "../../../../Models/DatabaseModels/IncomingRequestSecret";
import Project from "../../../../Models/DatabaseModels/Project";
import { getTableColumns } from "../../../../Types/Database/TableColumn";

/*
 * The migration behind a project's incoming request secrets (issue #7526):
 * the IncomingRequestSecret table and Project.requireIncomingRequestSecret.
 *
 * The SQL is generated, and the schema-drift job proves it matches the
 * models. What this pins is what a regeneration could quietly reverse:
 *
 *  1. EVERY EXISTING PROJECT KEEPS ACCEPTING REQUESTS AS IT DID. The column
 *     is NOT NULL DEFAULT false: an upgrade turns nothing on, and no project
 *     starts refusing its senders because it was upgraded.
 *  2. A PROJECT'S SECRETS GO WITH IT. projectId cascades, so a deleted
 *     project leaves no secret behind.
 *  3. THE SECRET HAS ROOM FOR ITS CIPHERTEXT. secretValue is encrypted at rest,
 *     and encryption makes a 256-character secret longer than any varchar a
 *     regeneration might pick: it is text, and NOT NULL, since every secret
 *     has a value (generated when left empty).
 *  4. IT RUNS AFTER THE MIGRATION BEFORE IT, and its file and class agree.
 */

const MIGRATION_FILE_NAME: string = "1809178800000-AddIncomingRequestSecret.ts";

const SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    `../../../../Server/Infrastructure/Postgres/SchemaMigrations/${MIGRATION_FILE_NAME}`,
  ),
  "utf8",
);

function bodyOf(method: "up" | "down"): string {
  const start: number = SOURCE.indexOf(`public async ${method}(`);

  expect(start).toBeGreaterThan(-1);

  const end: number =
    method === "up" ? SOURCE.indexOf("public async down(") : SOURCE.length;

  return SOURCE.slice(start, end);
}

const UP: string = bodyOf("up");
const DOWN: string = bodyOf("down");

/*
 * What the model declares that a later migration adds, each with the
 * statement that adds it: which monitors a secret covers (#8501) - its mode,
 * a column of this table, and the monitors and labels a limited secret
 * names, each a join table of its own. They stay that migration's
 * (AddIncomingRequestSecretMonitorAccessMigration pins it): this one stays as
 * it shipped.
 */
const ADDED_LATER: ReadonlyArray<[string, string]> = [
  ["monitorAccess", `ALTER TABLE "IncomingRequestSecret" ADD "monitorAccess" `],
  ["monitors", `CREATE TABLE "IncomingRequestSecretMonitor" (`],
  ["labels", `CREATE TABLE "IncomingRequestSecretLabel" (`],
];

const ADDED_LATER_COLUMNS: Array<string> = ADDED_LATER.map(
  ([column]: [string, string]): string => {
    return column;
  },
);

describe("AddIncomingRequestSecret migration", () => {
  test("an upgrade requires a secret of no project", () => {
    expect(UP).toContain(
      `ALTER TABLE "Project" ADD "requireIncomingRequestSecret" boolean NOT NULL DEFAULT false`,
    );

    const column: unknown = new Project().getTableColumnMetadata(
      "requireIncomingRequestSecret",
    );

    expect(column).toMatchObject({ defaultValue: false });
  });

  test("creates the table with every column the model declares", () => {
    const create: string | undefined = UP.split("\n").find((line: string) => {
      return line.includes(`CREATE TABLE "IncomingRequestSecret"`);
    });

    expect(create).toBeDefined();

    const columns: Array<string> = Object.keys(
      getTableColumns(new IncomingRequestSecret()),
    ).filter((column: string) => {
      // Relations are their id columns in SQL.
      return (
        !["project", "createdByUser", "deletedByUser"].includes(column) &&
        // Added to every table later (AddRecordCreatedByAndLastModifiedColumns, #10290).
        !RecordActorUtil.isColumn(column)
      );
    });

    for (const column of columns) {
      expect({ column, created: create!.includes(`"${column}"`) }).toEqual({
        column,
        // A later migration's column is that migration's, not this one's.
        created: !ADDED_LATER_COLUMNS.includes(column),
      });
    }
  });

  test("what the model declares beyond it is a later migration's, registered after this one", async () => {
    const steps: Array<string> = [];

    await new AddIncomingRequestSecretMonitorAccess1809181830000().up({
      query: async (sql: string): Promise<void> => {
        steps.push(sql);
      },
    } as unknown as QueryRunner);

    for (const [column, statement] of ADDED_LATER) {
      expect({
        column,
        added: steps.some((step: string): boolean => {
          return step.startsWith(statement);
        }),
      }).toEqual({ column, added: true });
    }

    expect(
      SchemaMigrations.indexOf(
        AddIncomingRequestSecretMonitorAccess1809181830000,
      ),
    ).toBeGreaterThan(
      SchemaMigrations.indexOf(AddIncomingRequestSecret1809178800000),
    );
  });

  test("the secret is NOT NULL text, with room for its ciphertext", () => {
    expect(UP).toContain(`"secretValue" text NOT NULL`);
    expect(
      new IncomingRequestSecret().getTableColumnMetadata("secretValue"),
    ).toMatchObject({ encrypted: true });
  });

  test("a project's secrets are deleted with it", () => {
    expect(UP).toMatch(
      /FOREIGN KEY \("projectId"\) REFERENCES "Project"\("_id"\) ON DELETE CASCADE/,
    );
    expect(UP).toContain(`ON "IncomingRequestSecret" ("projectId")`);
  });

  test("a deleted user leaves the secrets they created or deleted", () => {
    expect(UP).toMatch(
      /FOREIGN KEY \("createdByUserId"\) REFERENCES "User"\("_id"\) ON DELETE SET NULL/,
    );
    expect(UP).toMatch(
      /FOREIGN KEY \("deletedByUserId"\) REFERENCES "User"\("_id"\) ON DELETE SET NULL/,
    );
  });

  test("down takes away everything up added, the table last", () => {
    expect(DOWN).toContain(
      `ALTER TABLE "Project" DROP COLUMN "requireIncomingRequestSecret"`,
    );
    expect(DOWN).toContain(`DROP TABLE "IncomingRequestSecret"`);
    expect(DOWN.indexOf(`DROP TABLE "IncomingRequestSecret"`)).toBeGreaterThan(
      DOWN.indexOf(`DROP CONSTRAINT`),
    );
  });

  test("is registered right after the migration before it, under its own name", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { new (): MigrationInterface }) => {
        return migration.name;
      },
    );

    const index: number = names.indexOf(
      AddIncomingRequestSecret1809178800000.name,
    );

    expect(index).toBeGreaterThan(-1);
    expect(index).toBe(
      names.indexOf(AddServiceLevelObjectiveRequestSli1809178700000.name) + 1,
    );

    expect(new AddIncomingRequestSecret1809178800000().name).toBe(
      "AddIncomingRequestSecret1809178800000",
    );
    expect(MIGRATION_FILE_NAME.startsWith("1809178800000-")).toBe(true);
  });
});
