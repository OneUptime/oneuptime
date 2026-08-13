import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DefaultNamingStrategy, getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../../../Models/DatabaseModels/InventoryItemRelationship";

/*
 * The TelemetryEntity -> InventoryItem table rename is the one migration in
 * this change that cannot be generated, and the one that is dangerous to get
 * wrong in a way nothing notices:
 *
 *   - Postgres does not rename a table's indexes and constraints along with
 *     the table. They keep names derived from the old table name, while
 *     TypeORM starts expecting names derived from the new one. The tables and
 *     the data are fine; the Schema Drift CI job is what fails, and only after
 *     the fact.
 *   - A missed index is invisible locally and only shows up as drift.
 *   - A DROP+CREATE instead of a RENAME loses every row, silently, on deploy.
 *
 * So rather than restating the hashes the migration already contains, this
 * derives them from TypeORM's own naming strategy and from the models'
 * declared indexes, and checks the migration against that. If TypeORM ever
 * changes how it names things, or someone adds an index to either model
 * without extending the migration, this fails.
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
  "1786800000000-RenameTelemetryEntityToInventoryItem.ts",
);

const MIGRATIONS_INDEX_PATH: string = path.join(
  path.dirname(MIGRATION_PATH),
  "Index.ts",
);

const MIGRATION_SOURCE: string = fs.readFileSync(MIGRATION_PATH, "utf8");

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

interface TableRename {
  oldTable: string;
  newTable: string;
  // eslint-disable-next-line @typescript-eslint/ban-types
  modelType: Function;
}

const TABLES: Array<TableRename> = [
  {
    oldTable: "TelemetryEntity",
    newTable: "InventoryItem",
    modelType: InventoryItem,
  },
  {
    oldTable: "TelemetryEntityRelationship",
    newTable: "InventoryItemRelationship",
    modelType: InventoryItemRelationship,
  },
];

/**
 * Every relation column that gets a foreign key on these two models. Both
 * carry exactly the standard trio; a new relation would need a new rename
 * pair, which the count assertion below catches.
 */
const FOREIGN_KEY_COLUMNS: Array<Array<string>> = [
  ["projectId"],
  ["createdByUserId"],
  ["deletedByUserId"],
];

type DeclaredIndexColumnsFunction = (
  // eslint-disable-next-line @typescript-eslint/ban-types
  modelType: Function,
) => Array<Array<string>>;

/*
 * The indexes a model actually declares, read out of TypeORM's decorator
 * metadata rather than out of a list written here. Class-level
 * `@Index([...])` carries its columns; a column-level `@Index()` records the
 * property it decorates instead.
 */
const getDeclaredIndexColumns: DeclaredIndexColumnsFunction = (
  // eslint-disable-next-line @typescript-eslint/ban-types
  modelType: Function,
): Array<Array<string>> => {
  return getMetadataArgsStorage()
    .indices.filter((index: IndexMetadataArgs): boolean => {
      return index.target === modelType;
    })
    .map((index: IndexMetadataArgs): Array<string> => {
      if (Array.isArray(index.columns)) {
        return index.columns as Array<string>;
      }

      return [String((index as { propertyName?: string }).propertyName)];
    });
};

type NamePairsFunction = (source: string) => Array<[string, string]>;

/** Every `{ from: "...", to: "..." }` pair declared in the migration. */
const getRenamePairs: NamePairsFunction = (
  source: string,
): Array<[string, string]> => {
  const pairs: Array<[string, string]> = [];
  const pattern: RegExp = /\{\s*from:\s*"([^"]+)",\s*to:\s*"([^"]+)",?\s*\}/g;

  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    pairs.push([match[1]!, match[2]!]);
    match = pattern.exec(source);
  }

  return pairs;
};

const RENAME_PAIRS: Array<[string, string]> = getRenamePairs(MIGRATION_SOURCE);

type PairMapFunction = (prefix: string) => Map<string, string>;

const pairsWithPrefix: PairMapFunction = (
  prefix: string,
): Map<string, string> => {
  return new Map<string, string>(
    RENAME_PAIRS.filter((pair: [string, string]): boolean => {
      return pair[0].startsWith(prefix);
    }),
  );
};

describe("the migration file is where the test expects it", () => {
  test("reads", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    expect(MIGRATION_SOURCE.length).toBeGreaterThan(0);
  });

  test("it declares rename pairs at all", () => {
    // Everything below would pass vacuously against an empty list.
    expect(RENAME_PAIRS.length).toBeGreaterThan(0);
  });
});

describe("the data survives", () => {
  test("the tables are renamed, not recreated", () => {
    /*
     * The whole reason this migration is hand-written: a generator emits
     * DROP + CREATE for a rename, which would discard every row.
     */
    expect(MIGRATION_SOURCE).toContain(
      'ALTER TABLE "TelemetryEntity" RENAME TO "InventoryItem"',
    );
    expect(MIGRATION_SOURCE).toContain(
      'ALTER TABLE "TelemetryEntityRelationship" RENAME TO "InventoryItemRelationship"',
    );
  });

  test("nothing is dropped or created", () => {
    expect(MIGRATION_SOURCE).not.toContain("DROP TABLE");
    expect(MIGRATION_SOURCE).not.toContain("CREATE TABLE");
    expect(MIGRATION_SOURCE).not.toContain("DROP INDEX");
    expect(MIGRATION_SOURCE).not.toContain("DROP COLUMN");
    // Renaming rather than re-adding is what preserves the backing data.
    expect(MIGRATION_SOURCE).not.toContain("DROP CONSTRAINT");
  });
});

describe("index names match TypeORM's naming strategy", () => {
  for (const table of TABLES) {
    const declared: Array<Array<string>> = getDeclaredIndexColumns(
      table.modelType,
    );

    test(`${table.newTable} declares indexes to rename`, () => {
      expect(declared.length).toBeGreaterThan(0);
    });

    for (const columns of declared) {
      const oldName: string = namingStrategy.indexName(table.oldTable, columns);
      const newName: string = namingStrategy.indexName(table.newTable, columns);

      test(`${table.newTable} (${columns.join(", ")}) is renamed`, () => {
        const indexPairs: Map<string, string> = pairsWithPrefix("IDX_");

        expect(indexPairs.has(oldName)).toBe(true);
        expect(indexPairs.get(oldName)).toBe(newName);
      });
    }
  }

  test("no index rename pair is left over", () => {
    /*
     * A pair for an index that no longer exists would fail at deploy time
     * with "relation does not exist", taking the whole migration with it.
     */
    const expected: Set<string> = new Set<string>();

    for (const table of TABLES) {
      for (const columns of getDeclaredIndexColumns(table.modelType)) {
        expected.add(namingStrategy.indexName(table.oldTable, columns));
      }
    }

    for (const oldName of pairsWithPrefix("IDX_").keys()) {
      expect(expected.has(oldName)).toBe(true);
    }

    expect(pairsWithPrefix("IDX_").size).toBe(expected.size);
  });
});

describe("foreign key names match TypeORM's naming strategy", () => {
  for (const table of TABLES) {
    for (const columns of FOREIGN_KEY_COLUMNS) {
      const oldName: string = namingStrategy.foreignKeyName(
        table.oldTable,
        columns,
      );
      const newName: string = namingStrategy.foreignKeyName(
        table.newTable,
        columns,
      );

      test(`${table.newTable} FK (${columns.join(", ")}) is renamed`, () => {
        const fkPairs: Map<string, string> = pairsWithPrefix("FK_");

        expect(fkPairs.has(oldName)).toBe(true);
        expect(fkPairs.get(oldName)).toBe(newName);
      });
    }
  }

  test("there is exactly one FK rename per relation column per table", () => {
    expect(pairsWithPrefix("FK_").size).toBe(
      TABLES.length * FOREIGN_KEY_COLUMNS.length,
    );
  });
});

describe("primary keys", () => {
  test("both are renamed to match their table", () => {
    const pkPairs: Map<string, string> = pairsWithPrefix("PK_");

    expect(pkPairs.get("PK_TelemetryEntity")).toBe("PK_InventoryItem");
    expect(pkPairs.get("PK_TelemetryEntityRelationship")).toBe(
      "PK_InventoryItemRelationship",
    );
  });
});

describe("names are internally consistent", () => {
  test("no old name is reused as a new name, or vice versa", () => {
    /*
     * A collision would make the rename order load-bearing and could produce
     * a duplicate-name error halfway through.
     */
    const olds: Set<string> = new Set<string>(
      RENAME_PAIRS.map((pair: [string, string]): string => {
        return pair[0];
      }),
    );
    const news: Set<string> = new Set<string>(
      RENAME_PAIRS.map((pair: [string, string]): string => {
        return pair[1];
      }),
    );

    expect(olds.size).toBe(RENAME_PAIRS.length);
    expect(news.size).toBe(RENAME_PAIRS.length);

    for (const name of news) {
      expect(olds.has(name)).toBe(false);
    }
  });

  test("every new name fits Postgres's 63-byte identifier limit", () => {
    // Past 63 bytes Postgres truncates silently, which would produce drift.
    for (const [, newName] of RENAME_PAIRS) {
      expect(Buffer.byteLength(newName, "utf8")).toBeLessThanOrEqual(63);
    }
  });
});

describe("the migration is reversible", () => {
  test("down() reverses the table renames", () => {
    const down: string = MIGRATION_SOURCE.slice(
      MIGRATION_SOURCE.indexOf("public async down"),
    );

    expect(down).toContain(
      'ALTER TABLE "InventoryItem" RENAME TO "TelemetryEntity"',
    );
    expect(down).toContain(
      'ALTER TABLE "InventoryItemRelationship" RENAME TO "TelemetryEntityRelationship"',
    );
  });

  test("down() reverses every index and constraint rename", () => {
    /*
     * The helpers take a `reverse` flag rather than duplicating the pair
     * lists, so this checks that down() actually passes it — the mistake
     * would otherwise be a down() that renames everything the same way twice.
     */
    const down: string = MIGRATION_SOURCE.slice(
      MIGRATION_SOURCE.indexOf("public async down"),
    );
    const up: string = MIGRATION_SOURCE.slice(
      MIGRATION_SOURCE.indexOf("public async up"),
      MIGRATION_SOURCE.indexOf("public async down"),
    );

    expect(up).toContain("false,");
    expect(up).not.toContain("true,");
    expect(down).toContain("true,");
    expect(down).not.toContain("false,");
  });
});

describe("the migration runs at all", () => {
  test("it is registered, or nothing executes it on startup", () => {
    const index: string = fs.readFileSync(MIGRATIONS_INDEX_PATH, "utf8");

    expect(index).toContain(
      'from "./1786800000000-RenameTelemetryEntityToInventoryItem"',
    );
    expect(index).toContain(
      "RenameTelemetryEntityToInventoryItem1786800000000,",
    );
  });

  test("its class name carries its timestamp, as the runner expects", () => {
    expect(MIGRATION_SOURCE).toContain(
      "export class RenameTelemetryEntityToInventoryItem1786800000000",
    );
    expect(MIGRATION_SOURCE).toContain(
      'public name = "RenameTelemetryEntityToInventoryItem1786800000000"',
    );
  });

  test("it sorts after every migration it depends on", () => {
    /*
     * The rename must run after the migrations that created the indexes it
     * renames; migrations run in timestamp order.
     */
    const dependencies: Array<number> = [
      1781200000000, // creates TelemetryEntity
      1781200000001, // creates TelemetryEntityRelationship
      1781250074195, // replaces the hand-named indexes with hashed ones
      1781750000000, // drops the duplicate hand-named foreign keys
      1786551733814, // adds the `source` column and its index
    ];

    for (const dependency of dependencies) {
      expect(1786800000000).toBeGreaterThan(dependency);
    }
  });
});
