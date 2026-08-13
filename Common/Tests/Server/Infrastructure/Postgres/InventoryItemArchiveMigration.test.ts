import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DefaultNamingStrategy, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import InventoryItemCustomField from "../../../../Models/DatabaseModels/InventoryItemCustomField";

/*
 * The archive columns and the custom-field table, added by hand for the same
 * reason as the rename before them: no database was reachable to generate
 * against.
 *
 * The failure this guards is not a broken app — it is a green deploy followed
 * by a red Schema Drift job, because an index or foreign key was created under
 * a name TypeORM does not expect. So every name in the migration is recomputed
 * here from TypeORM's own naming strategy, and the columns are checked against
 * the models' decorator metadata rather than against a list written twice.
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
  "1786900000000-AddInventoryItemArchiveAndCustomFields.ts",
);

const SOURCE: string = fs.readFileSync(MIGRATION_PATH, "utf8");

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

type DeclaredColumnsFunction = (
  // eslint-disable-next-line @typescript-eslint/ban-types
  modelType: Function,
) => Array<string>;

const getDeclaredColumns: DeclaredColumnsFunction = (
  // eslint-disable-next-line @typescript-eslint/ban-types
  modelType: Function,
): Array<string> => {
  return getMetadataArgsStorage()
    .columns.filter((column: ColumnMetadataArgs): boolean => {
      return column.target === modelType;
    })
    .map((column: ColumnMetadataArgs): string => {
      return column.propertyName;
    });
};

describe("the migration file is where the test expects it", () => {
  test("reads", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    expect(SOURCE.length).toBeGreaterThan(0);
  });
});

describe("the archive columns", () => {
  const COLUMNS: ReadonlyArray<string> = [
    "isArchived",
    "archivedAt",
    "archivedByUserId",
    "customFields",
  ];

  test.each(COLUMNS)("%s is declared on the model", (column: string) => {
    expect(getDeclaredColumns(InventoryItem)).toContain(column);
  });

  test.each(COLUMNS)("%s is added by the migration", (column: string) => {
    expect(SOURCE).toContain(`ALTER TABLE "InventoryItem" ADD "${column}"`);
  });

  test.each(COLUMNS)("%s is dropped again by down()", (column: string) => {
    const down: string = SOURCE.slice(SOURCE.indexOf("public async down"));

    expect(down).toContain(
      `ALTER TABLE "InventoryItem" DROP COLUMN "${column}"`,
    );
  });

  test("isArchived is NOT NULL with a default, so existing rows stay live", () => {
    /*
     * A nullable isArchived would leave every pre-existing row neither
     * archived nor not, and `isArchived: false` would not select them — the
     * whole list would look empty after deploy.
     */
    expect(SOURCE).toContain(
      `ALTER TABLE "InventoryItem" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
  });

  test("the archive index carries TypeORM's name", () => {
    const expected: string = namingStrategy.indexName("InventoryItem", [
      "projectId",
      "isArchived",
    ]);

    expect(SOURCE).toContain(`CREATE INDEX "${expected}" ON "InventoryItem"`);
    expect(SOURCE).toContain(`DROP INDEX "public"."${expected}"`);
  });

  test("the archivedByUser foreign key carries TypeORM's name", () => {
    const expected: string = namingStrategy.foreignKeyName("InventoryItem", [
      "archivedByUserId",
    ]);

    expect(SOURCE).toContain(`ADD CONSTRAINT "${expected}"`);
    expect(SOURCE).toContain(`DROP CONSTRAINT "${expected}"`);
  });

  test("archiving a user does not delete their items", () => {
    // SET NULL, not CASCADE: the item outlives whoever archived it.
    const fkStatement: string = SOURCE.slice(
      SOURCE.indexOf('FOREIGN KEY ("archivedByUserId")'),
    ).split("`")[0]!;

    expect(fkStatement).toContain("ON DELETE SET NULL");
  });
});

describe("the custom field table", () => {
  test("is created", () => {
    expect(SOURCE).toContain('CREATE TABLE "InventoryItemCustomField"');
  });

  test("carries every column the model declares", () => {
    /*
     * Read off the model rather than listed here, so a column added to the
     * model without a migration fails rather than throwing at runtime.
     */
    const createStatement: string = SOURCE.slice(
      SOURCE.indexOf('CREATE TABLE "InventoryItemCustomField"'),
    ).split("`")[0]!;

    for (const column of getDeclaredColumns(InventoryItemCustomField)) {
      expect(createStatement).toContain(`"${column}"`);
    }
  });

  test("its index and foreign keys carry TypeORM's names", () => {
    const table: string = "InventoryItemCustomField";

    expect(SOURCE).toContain(
      `CREATE INDEX "${namingStrategy.indexName(table, ["projectId"])}"`,
    );

    for (const column of ["projectId", "createdByUserId", "deletedByUserId"]) {
      expect(SOURCE).toContain(
        `ADD CONSTRAINT "${namingStrategy.foreignKeyName(table, [column])}"`,
      );
    }
  });

  test("deleting a project takes its field definitions with it", () => {
    const projectFk: string = SOURCE.slice(
      SOURCE.indexOf('ALTER TABLE "InventoryItemCustomField" ADD CONSTRAINT'),
    ).split("`")[0]!;

    expect(projectFk).toContain("ON DELETE CASCADE");
  });

  test("down() drops the table and its constraints", () => {
    const down: string = SOURCE.slice(SOURCE.indexOf("public async down"));

    expect(down).toContain('DROP TABLE "InventoryItemCustomField"');
    expect(down).toContain(
      `DROP INDEX "public"."${namingStrategy.indexName("InventoryItemCustomField", ["projectId"])}"`,
    );
  });
});

describe("the migration runs", () => {
  test("it is registered", () => {
    const index: string = fs.readFileSync(
      path.join(path.dirname(MIGRATION_PATH), "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'from "./1786900000000-AddInventoryItemArchiveAndCustomFields"',
    );
    expect(index).toContain(
      "AddInventoryItemArchiveAndCustomFields1786900000000,",
    );
  });

  test("it sorts after the rename it builds on", () => {
    /*
     * It alters "InventoryItem", which only exists under that name once the
     * rename has run. Migrations execute in timestamp order.
     */
    expect(1786900000000).toBeGreaterThan(1786800000000);
  });

  test("its class name carries its timestamp", () => {
    expect(SOURCE).toContain(
      "export class AddInventoryItemArchiveAndCustomFields1786900000000",
    );
    expect(SOURCE).toContain(
      'public name = "AddInventoryItemArchiveAndCustomFields1786900000000"',
    );
  });
});
