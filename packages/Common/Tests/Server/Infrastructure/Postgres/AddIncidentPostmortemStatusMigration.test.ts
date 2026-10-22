import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DefaultNamingStrategy, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentPostmortemStatus from "../../../../Models/DatabaseModels/IncidentPostmortemStatus";
import Migrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddIncidentPostmortemStatus1805900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805900000000-AddIncidentPostmortemStatus";
import { AddIncidentPostmortemStatusIndexesAndKey1805910000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805910000000-AddIncidentPostmortemStatusIndexesAndKey";

/*
 * The two migrations behind postmortem statuses (Incidents > Postmortems):
 *
 *   - AddIncidentPostmortemStatus creates the project's statuses table -
 *     every column, index and key the model declares, under the names
 *     TypeORM gives them - and adds "Incident"."postmortemStatusId", a
 *     nullable column with no default, so the incidents table is not
 *     rewritten and every existing incident starts with none (the data
 *     migration AddDefaultPostmortemStatusesToExistingProjects gives each
 *     one its status afterwards);
 *   - AddIncidentPostmortemStatusIndexesAndKey builds the column's two
 *     indexes and its key online, outside a transaction (OnlineDdl), since
 *     "Incident" is written all the time.
 *
 * Both were generated against a migrated database and the schema drift
 * check ran clean after them; these keep them that way. They run against
 * real Postgres in IncidentPostmortemStatusPostgres.test.ts.
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

const TABLE_FILE: string = "1805900000000-AddIncidentPostmortemStatus.ts";
const KEYS_FILE: string =
  "1805910000000-AddIncidentPostmortemStatusIndexesAndKey.ts";
const TABLE_NAME: string = "AddIncidentPostmortemStatus1805900000000";
const KEYS_NAME: string =
  "AddIncidentPostmortemStatusIndexesAndKey1805910000000";
// The newest migration when these were generated on top of it.
const GENERATED_AFTER: string = "AddArchiveToValuesUserKeys1805810000000";

const STATUS_TABLE: string = "IncidentPostmortemStatus";

interface MigrationSource {
  up: string;
  down: string;
  source: string;
}

const read: (file: string) => MigrationSource = (
  file: string,
): MigrationSource => {
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

const TABLE_MIGRATION: MigrationSource = read(TABLE_FILE);
const KEYS_MIGRATION: MigrationSource = read(KEYS_FILE);

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

// The CREATE TABLE statement, as the generator wrote it on one line.
const CREATE_TABLE: string =
  TABLE_MIGRATION.up.split("\n").find((line: string): boolean => {
    return line.includes(`CREATE TABLE "${STATUS_TABLE}"`);
  }) || "";

// Every column a model declares itself (not the ones every model shares).
const declaredColumns: (target: unknown) => Array<ColumnMetadataArgs> = (
  target: unknown,
): Array<ColumnMetadataArgs> => {
  return getMetadataArgsStorage().columns.filter(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === target;
    },
  );
};

const relationOf: (
  target: unknown,
  propertyName: string,
) => RelationMetadataArgs | undefined = (
  target: unknown,
  propertyName: string,
): RelationMetadataArgs | undefined => {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs): boolean => {
      return (
        relation.target === target && relation.propertyName === propertyName
      );
    },
  );
};

/*
 * The column lists of the indexes a model declares: class-level
 * @Index([...]) and column-level @Index() alike.
 */
const declaredIndexColumns: (target: unknown) => Array<Array<string>> = (
  target: unknown,
): Array<Array<string>> => {
  return getMetadataArgsStorage()
    .indices.filter((index: IndexMetadataArgs): boolean => {
      return index.target === target;
    })
    .map((index: IndexMetadataArgs): Array<string> => {
      if (Array.isArray(index.columns)) {
        return index.columns as Array<string>;
      }

      return [index.columns as unknown as string];
    })
    .filter((columns: Array<string>): boolean => {
      return columns.length > 0 && Boolean(columns[0]);
    });
};

describe("registration", () => {
  const names: Array<string> = Migrations.map(
    (migration: { name: string }): string => {
      return migration.name;
    },
  );

  test("both are registered once, the indexes and key right after the table", () => {
    expect(
      names.filter((name: string): boolean => {
        return name === TABLE_NAME;
      }),
    ).toHaveLength(1);
    expect(
      names.filter((name: string): boolean => {
        return name === KEYS_NAME;
      }),
    ).toHaveLength(1);

    const table: number = names.indexOf(TABLE_NAME);

    expect(Migrations[table]).toBe(AddIncidentPostmortemStatus1805900000000);
    expect(Migrations[table + 1]).toBe(
      AddIncidentPostmortemStatusIndexesAndKey1805910000000,
    );
  });

  test("after the migration they were generated on top of", () => {
    expect(names.indexOf(GENERATED_AFTER)).toBeGreaterThan(-1);
    expect(names.indexOf(TABLE_NAME)).toBeGreaterThan(
      names.indexOf(GENERATED_AFTER),
    );
  });

  test("their names match their classes and their files' timestamps", () => {
    expect(new AddIncidentPostmortemStatus1805900000000().name).toBe(
      TABLE_NAME,
    );
    expect(
      new AddIncidentPostmortemStatusIndexesAndKey1805910000000().name,
    ).toBe(KEYS_NAME);
    expect(TABLE_FILE.split("-")[0]).toBe(TABLE_NAME.slice(-13));
    expect(KEYS_FILE.split("-")[0]).toBe(KEYS_NAME.slice(-13));
  });

  test("their timestamps are in the order they are registered", () => {
    expect(Number(TABLE_NAME.slice(-13))).toBeLessThan(
      Number(KEYS_NAME.slice(-13)),
    );

    const generatedAfter: number = Number(GENERATED_AFTER.slice(-13));

    expect(Number(TABLE_NAME.slice(-13))).toBeGreaterThan(generatedAfter);
  });
});

describe("the statuses table", () => {
  test("is created once, under TypeORM's primary key name", () => {
    expect(CREATE_TABLE).not.toBe("");
    expect(
      Array.from(TABLE_MIGRATION.up.matchAll(/CREATE TABLE/g)),
    ).toHaveLength(1);
    expect(CREATE_TABLE).toContain(
      `CONSTRAINT "${namingStrategy.primaryKeyName(STATUS_TABLE, ["_id"])}" PRIMARY KEY ("_id")`,
    );
  });

  test("holds every column the model declares, and the ones every model has", () => {
    const columns: Array<string> = [
      "_id",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "version",
      ...declaredColumns(IncidentPostmortemStatus).map(
        (column: ColumnMetadataArgs): string => {
          return column.propertyName;
        },
      ),
    ];

    expect(columns).toEqual(
      expect.arrayContaining([
        "projectId",
        "name",
        "slug",
        "description",
        "color",
        "order",
        "isNotStartedStatus",
        "isDraftStatus",
        "isCompletedStatus",
        "isArchived",
        "archivedAt",
        "archivedByUserId",
        "createdByUserId",
        "deletedByUserId",
      ]),
    );

    for (const column of columns) {
      expect(CREATE_TABLE).toContain(`"${column}" `);
    }
  });

  test("the three built-in flags and the archive switch are NOT NULL DEFAULT false", () => {
    for (const flag of [
      "isNotStartedStatus",
      "isDraftStatus",
      "isCompletedStatus",
      "isArchived",
    ]) {
      expect(CREATE_TABLE).toContain(
        `"${flag}" boolean NOT NULL DEFAULT false`,
      );
    }
  });

  test("a status always has a project, a name, a slug, a colour and a place", () => {
    expect(CREATE_TABLE).toContain(`"projectId" uuid NOT NULL`);
    expect(CREATE_TABLE).toContain(`"name" character varying(100) NOT NULL`);
    expect(CREATE_TABLE).toContain(`"slug" character varying(100) NOT NULL`);
    expect(CREATE_TABLE).toContain(`"color" character varying(10) NOT NULL`);
    expect(CREATE_TABLE).toContain(`"order" smallint NOT NULL`);
    // The description is optional.
    expect(CREATE_TABLE).toContain(`"description" character varying(500),`);
  });

  test("every index the model declares is created under TypeORM's name", () => {
    const indexes: Array<Array<string>> = declaredIndexColumns(
      IncidentPostmortemStatus,
    );

    expect(indexes).toEqual(
      expect.arrayContaining([
        ["projectId"],
        ["projectId", "order"],
        ["projectId", "isNotStartedStatus"],
      ]),
    );

    for (const columns of indexes) {
      const name: string = namingStrategy.indexName(STATUS_TABLE, columns);

      expect(TABLE_MIGRATION.up).toContain(
        `CREATE INDEX "${name}" ON "${STATUS_TABLE}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) `,
      );
      expect(TABLE_MIGRATION.down).toContain(`DROP INDEX "public"."${name}"`);
    }
  });

  test.each([
    ["projectId", "Project", "CASCADE"],
    ["createdByUserId", "User", "SET NULL"],
    ["deletedByUserId", "User", "SET NULL"],
    ["archivedByUserId", "User", "SET NULL"],
  ])(
    "the %s key to %s carries TypeORM's name, ON DELETE %s, and down() drops it",
    (column: string, referenced: string, onDelete: string) => {
      const name: string = namingStrategy.foreignKeyName(STATUS_TABLE, [
        column,
      ]);

      expect(TABLE_MIGRATION.up).toContain(
        `ALTER TABLE "${STATUS_TABLE}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${referenced}"("_id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
      );
      expect(TABLE_MIGRATION.down).toContain(
        `ALTER TABLE "${STATUS_TABLE}" DROP CONSTRAINT "${name}"`,
      );
    },
  );

  test("a project's statuses go with the project, and who made or archived one is let go with the user", () => {
    expect(
      relationOf(IncidentPostmortemStatus, "project")!.options.onDelete,
    ).toBe("CASCADE");

    for (const relation of [
      "createdByUser",
      "deletedByUser",
      "archivedByUser",
    ]) {
      expect(
        relationOf(IncidentPostmortemStatus, relation)!.options.onDelete,
      ).toBe("SET NULL");
    }
  });
});

describe("the incident's status column", () => {
  test("is added nullable with no default: no rewrite of the incidents table, every incident starts with none", () => {
    expect(TABLE_MIGRATION.up).toContain(
      'ALTER TABLE "Incident" ADD "postmortemStatusId" uuid`',
    );
    expect(TABLE_MIGRATION.up).not.toMatch(
      /"postmortemStatusId" uuid NOT NULL/,
    );
    expect(TABLE_MIGRATION.up).not.toMatch(/"postmortemStatusId" uuid DEFAULT/);

    const column: ColumnMetadataArgs | undefined = declaredColumns(
      Incident,
    ).find((candidate: ColumnMetadataArgs): boolean => {
      return candidate.propertyName === "postmortemStatusId";
    });

    expect(column).toBeDefined();
    expect(column!.options.nullable).toBe(true);
    expect(column!.options.default).toBeUndefined();
  });

  test("the table migration writes no row and builds nothing on the incidents table", () => {
    expect(TABLE_MIGRATION.up).not.toMatch(/UPDATE "/);
    expect(TABLE_MIGRATION.up).not.toMatch(/INSERT INTO/);
    expect(TABLE_MIGRATION.up).not.toMatch(/ON "Incident"/);
    expect(TABLE_MIGRATION.up).not.toContain(
      'ALTER TABLE "Incident" ADD CONSTRAINT',
    );
    expect(TABLE_MIGRATION.up).not.toContain("ALTER COLUMN");
  });

  test("the model declares the two indexes the online migration builds", () => {
    expect(declaredIndexColumns(Incident)).toEqual(
      expect.arrayContaining([
        ["postmortemStatusId"],
        ["projectId", "postmortemStatusId"],
      ]),
    );
  });

  test("the model's relation is NO ACTION: a status incidents are in can't be deleted", () => {
    const relation: RelationMetadataArgs | undefined = relationOf(
      Incident,
      "postmortemStatus",
    );

    expect(relation).toBeDefined();
    expect(relation!.options.onDelete).toBeUndefined();
    expect(relation!.options.nullable).toBe(true);
  });
});

describe("the online indexes and key", () => {
  test("run outside a transaction, through OnlineDdl only", () => {
    expect(
      new AddIncidentPostmortemStatusIndexesAndKey1805910000000().transaction,
    ).toBe(false);
    // The table migration is an ordinary one, in a transaction.
    expect(
      (
        new AddIncidentPostmortemStatus1805900000000() as unknown as {
          transaction?: boolean;
        }
      ).transaction,
    ).toBeUndefined();
    expect(KEYS_MIGRATION.up).not.toContain("queryRunner.query(");
    expect(
      Array.from(KEYS_MIGRATION.up.matchAll(/OnlineDdl\.createIndex/g)),
    ).toHaveLength(2);
    expect(
      Array.from(KEYS_MIGRATION.up.matchAll(/OnlineDdl\.addForeignKey/g)),
    ).toHaveLength(1);
  });

  test.each([[["postmortemStatusId"]], [["projectId", "postmortemStatusId"]]])(
    "the index on %p carries TypeORM's name, and down() drops it online",
    (columns: Array<string>) => {
      const name: string = namingStrategy.indexName("Incident", columns);

      expect(KEYS_MIGRATION.up).toContain(
        `CREATE INDEX "${name}" ON "Incident" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) `,
      );
      expect(KEYS_MIGRATION.down).toContain(
        `OnlineDdl.dropIndex(\n      queryRunner,\n      \`DROP INDEX "public"."${name}"\``,
      );
    },
  );

  test("the key carries TypeORM's name, is NO ACTION, and down() drops it first", () => {
    const name: string = namingStrategy.foreignKeyName("Incident", [
      "postmortemStatusId",
    ]);

    expect(KEYS_MIGRATION.up).toContain(
      `ALTER TABLE "Incident" ADD CONSTRAINT "${name}" FOREIGN KEY ("postmortemStatusId") REFERENCES "${STATUS_TABLE}"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    const dropKey: number = KEYS_MIGRATION.down.indexOf(
      `ALTER TABLE "Incident" DROP CONSTRAINT "${name}"`,
    );

    expect(dropKey).toBeGreaterThan(-1);
    expect(dropKey).toBeLessThan(KEYS_MIGRATION.down.indexOf("dropIndex"));
  });

  test("touch only the incidents table", () => {
    expect(
      new Set(
        Array.from(
          KEYS_MIGRATION.source.matchAll(/(?:ALTER TABLE|ON) "(\w+)"/g),
        ).map((match: RegExpMatchArray): string => {
          return match[1]!;
        }),
      ),
    ).toEqual(new Set(["Incident"]));
  });
});

describe("down()", () => {
  test("the table migration undoes all of up(): its keys, the column, the indexes, then the table", () => {
    const keysAdded: number = Array.from(
      TABLE_MIGRATION.up.matchAll(/ADD CONSTRAINT/g),
    ).length;

    expect(
      Array.from(TABLE_MIGRATION.down.matchAll(/DROP CONSTRAINT/g)),
    ).toHaveLength(keysAdded);
    expect(
      Array.from(TABLE_MIGRATION.down.matchAll(/DROP INDEX/g)),
    ).toHaveLength(
      Array.from(TABLE_MIGRATION.up.matchAll(/CREATE INDEX/g)).length,
    );
    expect(TABLE_MIGRATION.down).toContain(
      'ALTER TABLE "Incident" DROP COLUMN "postmortemStatusId"',
    );

    const dropTable: number = TABLE_MIGRATION.down.indexOf(
      `DROP TABLE "${STATUS_TABLE}"`,
    );

    expect(dropTable).toBeGreaterThan(-1);
    // The table goes last, after everything that hangs on it.
    expect(dropTable).toBeGreaterThan(
      TABLE_MIGRATION.down.lastIndexOf("DROP CONSTRAINT"),
    );
    expect(dropTable).toBeGreaterThan(
      TABLE_MIGRATION.down.lastIndexOf("DROP INDEX"),
    );
  });
});
