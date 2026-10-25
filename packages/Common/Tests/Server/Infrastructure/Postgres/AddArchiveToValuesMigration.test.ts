import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DefaultNamingStrategy, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import IncidentRole from "../../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Label from "../../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Migrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddArchiveToValues1805800000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805800000000-AddArchiveToValues";
import { AddArchiveToValuesUserKeys1805810000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805810000000-AddArchiveToValuesUserKeys";
import { ARCHIVABLE_VALUE_TABLE_NAMES } from "../../../../Utils/ArchivableValues";
import {
  ARCHIVABLE_VALUES_CREATED_LATER,
  ArchivableValueCreatedLater,
} from "../../../Helpers/ArchivableValuesCreatedLater";

/*
 * The two migrations that make the values records pick from archivable:
 * the columns (AddArchiveToValues) and, online and outside a transaction,
 * the foreign keys from who archived a value to the user
 * (AddArchiveToValuesUserKeys). Both were generated against a migrated
 * database and the schema drift check ran clean after them; these keep it
 * that way: every column and key the models declare is created under the
 * name TypeORM expects, down() undoes all of it, nothing an existing record
 * points at changes, and both are registered where they run.
 */

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const COLUMNS_FILE: string = "1805800000000-AddArchiveToValues.ts";
const KEYS_FILE: string = "1805810000000-AddArchiveToValuesUserKeys.ts";
const COLUMNS_NAME: string = "AddArchiveToValues1805800000000";
const KEYS_NAME: string = "AddArchiveToValuesUserKeys1805810000000";
// The migration they were generated on top of.
const PREVIOUS_NAME: string = "TurnOnUnsetGitHubCommands1805770000000";

const read: (file: string) => { up: string; down: string; source: string } = (
  file: string,
): { up: string; down: string; source: string } => {
  const source: string = fs.readFileSync(
    path.join(MIGRATIONS_DIR, file),
    "utf8",
  );

  return {
    source: source,
    up: source.slice(
      source.indexOf("public async up"),
      source.indexOf("public async down"),
    ),
    down: source.slice(source.indexOf("public async down")),
  };
};

const COLUMNS_MIGRATION: { up: string; down: string; source: string } =
  read(COLUMNS_FILE);
const KEYS_MIGRATION: { up: string; down: string; source: string } =
  read(KEYS_FILE);

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

interface ValueTable {
  table: string;
  modelType: unknown;
}

const TABLES: Array<ValueTable> = [
  { table: "IncidentState", modelType: IncidentState },
  { table: "IncidentSeverity", modelType: IncidentSeverity },
  { table: "AlertState", modelType: AlertState },
  { table: "AlertSeverity", modelType: AlertSeverity },
  { table: "MonitorStatus", modelType: MonitorStatus },
  { table: "ScheduledMaintenanceState", modelType: ScheduledMaintenanceState },
  { table: "Label", modelType: Label },
  { table: "IncidentRole", modelType: IncidentRole },
];

/*
 * A value table made after these two migrations is not altered by them: its
 * own migration creates it archivable (Tests/Helpers/ArchivableValuesCreatedLater,
 * the list ArchivableValuesPostgres.test.ts leaves out too).
 */
const CREATED_ARCHIVABLE_LATER: Array<ArchivableValueCreatedLater> =
  ARCHIVABLE_VALUES_CREATED_LATER;

const COLUMNS: Array<string> = ["isArchived", "archivedAt", "archivedByUserId"];

const declaredColumns: (modelType: unknown) => Array<string> = (
  modelType: unknown,
): Array<string> => {
  return getMetadataArgsStorage()
    .columns.filter((column: ColumnMetadataArgs): boolean => {
      return column.target === modelType;
    })
    .map((column: ColumnMetadataArgs): string => {
      return column.propertyName;
    });
};

const tablesTouched: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const tables: Set<string> = new Set(
    Array.from(source.matchAll(/(?:ALTER TABLE|ON) "(\w+)"/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    ),
  );

  tables.delete("User");

  return Array.from(tables).sort();
};

describe("registration", () => {
  const names: Array<string> = Migrations.map(
    (migration: { name: string }): string => {
      return migration.name;
    },
  );

  test("both are registered, the keys right after the columns", () => {
    const columns: number = names.indexOf(COLUMNS_NAME);
    const keys: number = names.indexOf(KEYS_NAME);

    expect(columns).toBeGreaterThan(-1);
    expect(Migrations[columns]).toBe(AddArchiveToValues1805800000000);
    expect(Migrations[keys]).toBe(AddArchiveToValuesUserKeys1805810000000);
    expect(keys).toBe(columns + 1);
  });

  test("after the migration they were generated on top of", () => {
    expect(names.indexOf(PREVIOUS_NAME)).toBeGreaterThan(-1);
    expect(names.indexOf(COLUMNS_NAME)).toBeGreaterThan(
      names.indexOf(PREVIOUS_NAME),
    );
  });

  test("their names match their classes and their files' timestamps", () => {
    expect(new AddArchiveToValues1805800000000().name).toBe(COLUMNS_NAME);
    expect(new AddArchiveToValuesUserKeys1805810000000().name).toBe(KEYS_NAME);
    expect(COLUMNS_FILE.split("-")[0]).toBe(COLUMNS_NAME.slice(-13));
    expect(KEYS_FILE.split("-")[0]).toBe(KEYS_NAME.slice(-13));
  });

  test("the tables are the archivable values that existed before them, all eight", () => {
    // Every archivable value is either altered here or created archivable later.
    expect(
      [...TABLES, ...CREATED_ARCHIVABLE_LATER]
        .map((entry: ValueTable): string => {
          return entry.table;
        })
        .sort(),
    ).toEqual([...ARCHIVABLE_VALUE_TABLE_NAMES].sort());

    for (const later of CREATED_ARCHIVABLE_LATER) {
      expect(
        TABLES.map((entry: ValueTable): string => {
          return entry.table;
        }),
      ).not.toContain(later.table);
    }
  });
});

describe.each(CREATED_ARCHIVABLE_LATER)(
  "$table, created archivable by its own migration",
  ({ table, modelType, file, migrationName }: ArchivableValueCreatedLater) => {
    const created: { up: string; down: string; source: string } = read(file);

    // The CREATE TABLE statement, as the generator wrote it on one line.
    const createTable: string =
      created.up.split("\n").find((line: string): boolean => {
        return line.includes(`CREATE TABLE "${table}"`);
      }) || "";

    test("is registered after both archive migrations", () => {
      const names: Array<string> = Migrations.map(
        (migration: { name: string }): string => {
          return migration.name;
        },
      );

      expect(names.indexOf(migrationName)).toBeGreaterThan(
        names.indexOf(KEYS_NAME),
      );
      expect(file.split("-")[0]).toBe(migrationName.slice(-13));
    });

    test.each(COLUMNS)("%s is declared on the model", (column: string) => {
      expect(declaredColumns(modelType)).toContain(column);
    });

    test("its CREATE TABLE holds the three columns as the archive migration adds them", () => {
      expect(createTable).not.toBe("");
      expect(createTable).toContain(
        `"isArchived" boolean NOT NULL DEFAULT false`,
      );
      expect(createTable).toContain(`"archivedAt" TIMESTAMP WITH TIME ZONE,`);
      expect(createTable).toContain(`"archivedByUserId" uuid,`);
    });

    test("is never altered by the archive migrations", () => {
      expect(tablesTouched(COLUMNS_MIGRATION.source)).not.toContain(table);
      expect(tablesTouched(KEYS_MIGRATION.source)).not.toContain(table);
    });

    test("the archivedByUser key carries TypeORM's name, is cleared when the user goes, and down() drops it", () => {
      const expected: string = namingStrategy.foreignKeyName(table, [
        "archivedByUserId",
      ]);

      expect(created.up).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${expected}" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
      expect(created.down).toContain(
        `ALTER TABLE "${table}" DROP CONSTRAINT "${expected}"`,
      );
    });

    test("the model's archivedByUser relation is cleared when the user goes", () => {
      const relation: RelationMetadataArgs | undefined =
        getMetadataArgsStorage().relations.find(
          (candidate: RelationMetadataArgs): boolean => {
            return (
              candidate.target === modelType &&
              candidate.propertyName === "archivedByUser"
            );
          },
        );

      expect(relation).toBeDefined();
      expect(relation!.options.onDelete).toBe("SET NULL");
    });
  },
);

describe.each(TABLES)("$table", ({ table, modelType }: ValueTable) => {
  test.each(COLUMNS)("%s is declared on the model", (column: string) => {
    expect(declaredColumns(modelType)).toContain(column);
  });

  test.each(COLUMNS)(
    "%s is added by up() and dropped by down()",
    (column: string) => {
      expect(COLUMNS_MIGRATION.up).toContain(
        `ALTER TABLE "${table}" ADD "${column}"`,
      );
      expect(COLUMNS_MIGRATION.down).toContain(
        `ALTER TABLE "${table}" DROP COLUMN "${column}"`,
      );
    },
  );

  test("isArchived is NOT NULL DEFAULT false: every value stays live on deploy", () => {
    /*
     * A nullable flag would leave existing values neither archived nor
     * not, and the pickers' `isArchived: false` would not find them: every
     * severity and state would vanish from every form on deploy.
     */
    expect(COLUMNS_MIGRATION.up).toContain(
      `ALTER TABLE "${table}" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
  });

  test("the stamps are nullable: nothing is archived yet", () => {
    expect(COLUMNS_MIGRATION.up).toContain(
      `ALTER TABLE "${table}" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    expect(COLUMNS_MIGRATION.up).toMatch(
      new RegExp(`ALTER TABLE "${table}" ADD "archivedByUserId" uuid\``),
    );
  });

  test("the archivedByUser key carries TypeORM's name, is added online and is cleared when the user goes", () => {
    const expected: string = namingStrategy.foreignKeyName(table, [
      "archivedByUserId",
    ]);

    expect(KEYS_MIGRATION.up).toContain(
      `OnlineDdl.addForeignKey(\n      queryRunner,\n      \`ALTER TABLE "${table}" ADD CONSTRAINT "${expected}" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION\``,
    );
    expect(KEYS_MIGRATION.down).toContain(
      `ALTER TABLE "${table}" DROP CONSTRAINT "${expected}"`,
    );
  });

  test("the model's archivedByUser relation is cleared when the user goes", () => {
    const relation: RelationMetadataArgs | undefined =
      getMetadataArgsStorage().relations.find(
        (candidate: RelationMetadataArgs): boolean => {
          return (
            candidate.target === modelType &&
            candidate.propertyName === "archivedByUser"
          );
        },
      );

    expect(relation).toBeDefined();
    expect(relation!.options.onDelete).toBe("SET NULL");
  });
});

describe("what the migrations change", () => {
  test("the columns migration adds columns only: no key, index or rewrite", () => {
    expect(COLUMNS_MIGRATION.up).not.toContain("CONSTRAINT");
    expect(COLUMNS_MIGRATION.up).not.toContain("CREATE INDEX");
    expect(COLUMNS_MIGRATION.up).not.toMatch(/UPDATE "/);
    expect(COLUMNS_MIGRATION.up).not.toContain("ALTER COLUMN");
  });

  test("the keys migration runs outside a transaction, through OnlineDdl", () => {
    expect(new AddArchiveToValuesUserKeys1805810000000().transaction).toBe(
      false,
    );
    expect(KEYS_MIGRATION.up).not.toContain("queryRunner.query(");
    expect(
      Array.from(KEYS_MIGRATION.up.matchAll(/OnlineDdl\.addForeignKey/g)),
    ).toHaveLength(TABLES.length);
  });

  test("each touches only the eight value tables", () => {
    const expected: Array<string> = TABLES.map((entry: ValueTable): string => {
      return entry.table;
    }).sort();

    expect(tablesTouched(COLUMNS_MIGRATION.source)).toEqual(expected);
    expect(tablesTouched(KEYS_MIGRATION.source)).toEqual(expected);
  });

  test("the columns' down() drops every column it added, and nothing else", () => {
    expect(
      Array.from(COLUMNS_MIGRATION.down.matchAll(/DROP COLUMN/g)),
    ).toHaveLength(TABLES.length * COLUMNS.length);
    expect(Array.from(COLUMNS_MIGRATION.up.matchAll(/ADD "/g))).toHaveLength(
      TABLES.length * COLUMNS.length,
    );
  });
});
