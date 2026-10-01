import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DefaultNamingStrategy, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import Dashboard from "../../../../Models/DatabaseModels/Dashboard";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import Migrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddArchiveToMoreResources1797100000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1797100000000-AddArchiveToMoreResources";

/*
 * The migration that makes workflows, monitors, status pages, dashboards and
 * on-call policies archivable. It was generated against a migrated database
 * (and the schema drift check ran clean after it); these tests keep it that
 * way: every column, index and foreign key the models declare is created
 * under the name TypeORM expects - a different name is a green deploy and a
 * red Schema Drift job - down() undoes all of it, and the migration is
 * registered last, where it runs.
 */

const MIGRATION_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
  "1797100000000-AddArchiveToMoreResources.ts",
);

const SOURCE: string = fs.readFileSync(MIGRATION_PATH, "utf8");
const UP: string = SOURCE.slice(
  SOURCE.indexOf("public async up"),
  SOURCE.indexOf("public async down"),
);
const DOWN: string = SOURCE.slice(SOURCE.indexOf("public async down"));

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

const TABLES: Array<{ table: string; modelType: unknown }> = [
  { table: "Workflow", modelType: Workflow },
  { table: "Monitor", modelType: Monitor },
  { table: "StatusPage", modelType: StatusPage },
  { table: "Dashboard", modelType: Dashboard },
  { table: "OnCallDutyPolicy", modelType: OnCallDutyPolicy },
];

const COLUMNS: Array<string> = ["isArchived", "archivedAt", "archivedByUserId"];

function declaredColumns(modelType: unknown): Array<string> {
  return getMetadataArgsStorage()
    .columns.filter((column: ColumnMetadataArgs): boolean => {
      return column.target === modelType;
    })
    .map((column: ColumnMetadataArgs): string => {
      return column.propertyName;
    });
}

describe("AddArchiveToMoreResources1797100000000", () => {
  test("is registered, after the migration it was generated on top of", () => {
    /*
     * Only order relative to what came before is pinned: later migrations
     * land after this one, and must be free to.
     */
    const names: Array<string> = Migrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );
    const ours: number = names.indexOf(
      "AddArchiveToMoreResources1797100000000",
    );

    expect(ours).toBeGreaterThan(-1);
    expect(Migrations[ours]).toBe(AddArchiveToMoreResources1797100000000);
    expect(ours).toBeGreaterThan(
      names.indexOf("AddWorkflowIncomingEmailSecretKey1797000000000"),
    );
    expect(
      names.indexOf("AddWorkflowIncomingEmailSecretKey1797000000000"),
    ).toBeGreaterThan(-1);
  });

  test("its name matches its class and its file's timestamp", () => {
    expect(new AddArchiveToMoreResources1797100000000().name).toBe(
      "AddArchiveToMoreResources1797100000000",
    );
    expect(path.basename(MIGRATION_PATH)).toBe(
      "1797100000000-AddArchiveToMoreResources.ts",
    );
  });

  describe.each(TABLES)("$table", ({ table, modelType }) => {
    test.each(COLUMNS)("%s is declared on the model", (column: string) => {
      expect(declaredColumns(modelType)).toContain(column);
    });

    test.each(COLUMNS)(
      "%s is added by up() and dropped by down()",
      (column: string) => {
        expect(UP).toContain(`ALTER TABLE "${table}" ADD "${column}"`);
        expect(DOWN).toContain(
          `ALTER TABLE "${table}" DROP COLUMN "${column}"`,
        );
      },
    );

    test("isArchived is NOT NULL DEFAULT false, so every existing row stays live", () => {
      /*
       * A nullable flag would leave existing rows neither archived nor not,
       * and the lists' `isArchived: false` would not find them: every
       * workflow, monitor and status page would vanish on deploy.
       */
      expect(UP).toContain(
        `ALTER TABLE "${table}" ADD "isArchived" boolean NOT NULL DEFAULT false`,
      );
    });

    test("the stamps are nullable: nothing is archived yet", () => {
      expect(UP).toContain(
        `ALTER TABLE "${table}" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
      );
      expect(UP).toContain(
        `ALTER TABLE "${table}" ADD "archivedByUserId" uuid`,
      );
      expect(UP).not.toMatch(
        new RegExp(`"${table}" ADD "archived(At|ByUserId)"[^\`]*NOT NULL`),
      );
    });

    test("the (projectId, isArchived) index carries TypeORM's name", () => {
      const expected: string = namingStrategy.indexName(table, [
        "projectId",
        "isArchived",
      ]);

      expect(UP).toContain(
        `CREATE INDEX "${expected}" ON "${table}" ("projectId", "isArchived")`,
      );
      expect(DOWN).toContain(`DROP INDEX "public"."${expected}"`);
    });

    test("the archivedByUser foreign key carries TypeORM's name and is cleared when the user goes", () => {
      const expected: string = namingStrategy.foreignKeyName(table, [
        "archivedByUserId",
      ]);

      expect(UP).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${expected}" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
      expect(DOWN).toContain(
        `ALTER TABLE "${table}" DROP CONSTRAINT "${expected}"`,
      );
    });
  });

  test("touches only the five tables", () => {
    const tablesTouched: Set<string> = new Set(
      Array.from(SOURCE.matchAll(/(?:ALTER TABLE|ON) "(\w+)"/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    );

    tablesTouched.delete("User");

    expect(Array.from(tablesTouched).sort()).toEqual(
      TABLES.map(({ table }) => {
        return table;
      }).sort(),
    );
  });

  test("down() drops the constraints before the columns they use", () => {
    for (const { table } of TABLES) {
      const constraint: number = DOWN.indexOf(
        `ALTER TABLE "${table}" DROP CONSTRAINT`,
      );
      const column: number = DOWN.indexOf(
        `ALTER TABLE "${table}" DROP COLUMN "archivedByUserId"`,
      );

      expect(constraint).toBeGreaterThan(-1);
      expect(column).toBeGreaterThan(constraint);
    }
  });
});
