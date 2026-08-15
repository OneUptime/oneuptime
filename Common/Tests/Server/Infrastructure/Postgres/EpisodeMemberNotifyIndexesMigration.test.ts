import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DefaultNamingStrategy,
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import AlertEpisodeMember from "../../../../Models/DatabaseModels/AlertEpisodeMember";
import IncidentEpisodeMember from "../../../../Models/DatabaseModels/IncidentEpisodeMember";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddEpisodeMemberNotifyIndexes1787300000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1787300000000-AddEpisodeMemberNotifyIndexes";

/*
 * The partial indexes behind the two episode-member "owner notified" sweeps.
 *
 * Two failures are guarded here. The first is the one the indexes exist to
 * fix: a sweep predicate with nothing behind it, so an EVERY_MINUTE cron
 * sequentially scans the whole table to return no rows. The second is a green
 * deploy followed by a red Schema Drift job, because the migration created
 * the index under a name TypeORM would not have chosen — and for a PARTIAL
 * index the generated name is a hash of the WHERE text as well as the table
 * and columns, so the migration and the decorator have to agree on the
 * predicate character for character. Both names are therefore recomputed here
 * from TypeORM's own naming strategy, fed with the WHERE read off the model's
 * decorator metadata rather than a string written out twice.
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
  "1787300000000-AddEpisodeMemberNotifyIndexes.ts",
);

const SOURCE: string = fs.readFileSync(MIGRATION_PATH, "utf8");

const UP: string = SOURCE.slice(
  SOURCE.indexOf("public async up"),
  SOURCE.indexOf("public async down"),
);

const DOWN: string = SOURCE.slice(SOURCE.indexOf("public async down"));

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

/*
 * What TypeORM's metadata storage keys entities by: the class itself. Only
 * ever compared by identity against `index.target`, so `unknown` states the
 * requirement exactly — and avoids `Function`/`object`, both of which this
 * repo's eslint config bans.
 */
type ModelClass = unknown;

type NotifyIndexCase = {
  table: string;
  model: ModelClass;
  flagColumn: string;
};

const CASES: ReadonlyArray<NotifyIndexCase> = [
  {
    table: "AlertEpisodeMember",
    model: AlertEpisodeMember,
    flagColumn: "isOwnerNotifiedOfAlertAdded",
  },
  {
    table: "IncidentEpisodeMember",
    model: IncidentEpisodeMember,
    flagColumn: "isOwnerNotifiedOfIncidentAdded",
  },
];

type DeclaredIndexFunction = (
  modelType: ModelClass,
  flagColumn: string,
) => IndexMetadataArgs | undefined;

const getDeclaredIndex: DeclaredIndexFunction = (
  modelType: ModelClass,
  flagColumn: string,
): IndexMetadataArgs | undefined => {
  return getMetadataArgsStorage().indices.find(
    (index: IndexMetadataArgs): boolean => {
      if (index.target !== modelType) {
        return false;
      }

      const columns: Array<string> = (index.columns as Array<string>) || [];

      return columns.length === 1 && columns[0] === flagColumn;
    },
  );
};

type ExpectedNameFunction = (testCase: NotifyIndexCase) => string;

const expectedIndexName: ExpectedNameFunction = (
  testCase: NotifyIndexCase,
): string => {
  const declared: IndexMetadataArgs | undefined = getDeclaredIndex(
    testCase.model,
    testCase.flagColumn,
  );

  return namingStrategy.indexName(
    testCase.table,
    [testCase.flagColumn],
    declared?.where,
  );
};

/*
 * TypeORM orders migrations by the timestamp embedded in the class name, so
 * that is the only thing worth asserting about ordering — never a literal
 * copied out of the file, which would compare a number to itself.
 * `InitialMigration` is the one registered class that carries no timestamp,
 * hence the nullable return.
 */
type MigrationClass = { readonly name: string };

type TimestampFunction = (migrationClass: MigrationClass) => number | null;

const timestampOf: TimestampFunction = (
  migrationClass: MigrationClass,
): number | null => {
  const match: RegExpMatchArray | null = migrationClass.name.match(/(\d{13})$/);

  return match ? Number(match[1]) : null;
};

describe("the migration file is where the test expects it", () => {
  test("reads", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    expect(SOURCE.length).toBeGreaterThan(0);
  });
});

describe("the models declare the partial indexes", () => {
  test.each(CASES)(
    "$table indexes $flagColumn",
    (testCase: NotifyIndexCase) => {
      expect(
        getDeclaredIndex(testCase.model, testCase.flagColumn),
      ).toBeDefined();
    },
  );

  /*
   * The whole point. A non-partial index here would be the size of the table
   * — the flag is true on nearly every row once its owner has been notified —
   * and would be maintained on every one of those writes.
   */
  test.each(CASES)(
    "$table's index is partial, not a full-column index",
    (testCase: NotifyIndexCase) => {
      const declared: IndexMetadataArgs | undefined = getDeclaredIndex(
        testCase.model,
        testCase.flagColumn,
      );

      expect(declared?.where).toBeTruthy();
    },
  );

  /*
   * The predicate has to be one the sweep's own WHERE implies, or Postgres
   * will not use the index. The sweep asks for `flag: false` and TypeORM adds
   * the soft-delete clause, so the index covers exactly that pair.
   */
  test.each(CASES)(
    "$table's predicate covers the un-notified, live rows the sweep asks for",
    (testCase: NotifyIndexCase) => {
      const declared: IndexMetadataArgs | undefined = getDeclaredIndex(
        testCase.model,
        testCase.flagColumn,
      );

      expect(declared?.where).toBe(
        `"${testCase.flagColumn}" = false AND "deletedAt" IS NULL`,
      );
    },
  );

  /*
   * Regression guard on the direction of the predicate. Indexing the
   * notified rows would cover the whole table and serve no query anybody
   * runs — the sweeps only ever look for false.
   */
  test.each(CASES)(
    "$table's predicate is not inverted onto the notified rows",
    (testCase: NotifyIndexCase) => {
      const declared: IndexMetadataArgs | undefined = getDeclaredIndex(
        testCase.model,
        testCase.flagColumn,
      );

      expect(declared?.where).not.toContain("= true");
    },
  );

  test.each(CASES)(
    "$table's index is not unique — many rows are un-notified at once",
    (testCase: NotifyIndexCase) => {
      const declared: IndexMetadataArgs | undefined = getDeclaredIndex(
        testCase.model,
        testCase.flagColumn,
      );

      expect(declared?.unique).toBeFalsy();
    },
  );

  // An explicit name would defeat the drift check the generated name gives us.
  test.each(CASES)(
    "$table's index leaves its name to TypeORM",
    (testCase: NotifyIndexCase) => {
      const declared: IndexMetadataArgs | undefined = getDeclaredIndex(
        testCase.model,
        testCase.flagColumn,
      );

      expect(declared?.name).toBeUndefined();
    },
  );

  /*
   * The composite index that was already on these tables serves the episode
   * lookups and must survive alongside the new one.
   */
  test("the pre-existing composite indexes are untouched", () => {
    const alertIndexColumns: Array<Array<string>> = getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs): boolean => {
        return index.target === AlertEpisodeMember;
      })
      .map((index: IndexMetadataArgs): Array<string> => {
        return (index.columns as Array<string>) || [];
      });

    expect(alertIndexColumns).toContainEqual([
      "alertEpisodeId",
      "alertId",
      "projectId",
    ]);

    const incidentIndexColumns: Array<Array<string>> = getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs): boolean => {
        return index.target === IncidentEpisodeMember;
      })
      .map((index: IndexMetadataArgs): Array<string> => {
        return (index.columns as Array<string>) || [];
      });

    expect(incidentIndexColumns).toContainEqual([
      "incidentEpisodeId",
      "incidentId",
      "projectId",
    ]);
  });
});

describe("the migration matches what TypeORM would generate", () => {
  test.each(CASES)(
    "$table's index carries TypeORM's name",
    (testCase: NotifyIndexCase) => {
      expect(UP).toContain(`CREATE INDEX "${expectedIndexName(testCase)}"`);
    },
  );

  /*
   * PostgresQueryRunner.createIndexSql emits exactly this shape. Anything
   * else — a missing WHERE, a different column list — is an index the drift
   * job will want to drop and recreate.
   */
  test.each(CASES)(
    "$table's CREATE statement is the generator's shape, predicate included",
    (testCase: NotifyIndexCase) => {
      const declared: IndexMetadataArgs | undefined = getDeclaredIndex(
        testCase.model,
        testCase.flagColumn,
      );

      expect(UP).toContain(
        `CREATE INDEX "${expectedIndexName(testCase)}" ON "${testCase.table}" ("${testCase.flagColumn}") WHERE ${declared?.where}`,
      );
    },
  );

  test.each(CASES)(
    "$table's index is created non-unique",
    (testCase: NotifyIndexCase) => {
      expect(UP).not.toContain(
        `CREATE UNIQUE INDEX "${expectedIndexName(testCase)}"`,
      );
    },
  );

  test("the two indexes are given different names", () => {
    const [alertCase, incidentCase] = CASES as ReadonlyArray<NotifyIndexCase>;

    expect(expectedIndexName(alertCase as NotifyIndexCase)).not.toBe(
      expectedIndexName(incidentCase as NotifyIndexCase),
    );
  });
});

describe("up and down are symmetric", () => {
  test.each(CASES)(
    "$table's index is dropped again by down()",
    (testCase: NotifyIndexCase) => {
      expect(DOWN).toContain(
        `DROP INDEX "public"."${expectedIndexName(testCase)}"`,
      );
    },
  );

  test("down() drops exactly what up() creates, and nothing else", () => {
    const created: Array<string> = [...UP.matchAll(/CREATE INDEX "(IDX_\w+)"/g)]
      .map((match: RegExpMatchArray): string => {
        return match[1] as string;
      })
      .sort();

    const dropped: Array<string> = [
      ...DOWN.matchAll(/DROP INDEX "public"\."(IDX_\w+)"/g),
    ]
      .map((match: RegExpMatchArray): string => {
        return match[1] as string;
      })
      .sort();

    expect(created).toHaveLength(CASES.length);
    expect(dropped).toEqual(created);
  });

  // Indexes only. A stray ALTER TABLE here would be an unreviewed schema change.
  test("the migration touches nothing but indexes", () => {
    expect(SOURCE).not.toContain("ALTER TABLE");
    expect(SOURCE).not.toContain("DROP TABLE");
    expect(SOURCE).not.toContain("CREATE TABLE");
  });
});

/*
 * Executed against a stub QueryRunner. Nothing here needs a database, and
 * none is reachable in CI's unit stage — but the statements, their order and
 * their symmetry are all observable without one.
 */
describe("running up() and down()", () => {
  type RecordingRunner = { query: jest.Mock; queries: Array<string> };

  function recordingRunner(): RecordingRunner {
    const queries: Array<string> = [];

    return {
      queries: queries,
      query: jest.fn(async (sql: unknown): Promise<void> => {
        queries.push(sql as string);
      }),
    };
  }

  function migration(): MigrationInterface {
    return new AddEpisodeMemberNotifyIndexes1787300000000();
  }

  test("up() issues one CREATE INDEX per table and nothing more", async () => {
    const runner: RecordingRunner = recordingRunner();

    await migration().up(runner as unknown as QueryRunner);

    expect(runner.queries).toHaveLength(CASES.length);

    for (const testCase of CASES) {
      expect(runner.queries).toContain(
        `CREATE INDEX "${expectedIndexName(testCase)}" ON "${testCase.table}" ("${testCase.flagColumn}") WHERE ${getDeclaredIndex(testCase.model, testCase.flagColumn)?.where}`,
      );
    }
  });

  test("down() reverses up() exactly, in reverse order", async () => {
    const upRunner: RecordingRunner = recordingRunner();
    const downRunner: RecordingRunner = recordingRunner();

    await migration().up(upRunner as unknown as QueryRunner);
    await migration().down(downRunner as unknown as QueryRunner);

    const createdInOrder: Array<string> = upRunner.queries.map(
      (sql: string): string => {
        return (sql.match(/CREATE INDEX "(IDX_\w+)"/) || [])[1] as string;
      },
    );

    const droppedInOrder: Array<string> = downRunner.queries.map(
      (sql: string): string => {
        return (sql.match(/DROP INDEX "public"\."(IDX_\w+)"/) ||
          [])[1] as string;
      },
    );

    expect(droppedInOrder).toEqual([...createdInOrder].reverse());
  });

  test("every statement is a complete, single statement", () => {
    // A stray semicolon would split one queryRunner.query() into two.
    for (const statement of [
      ...SOURCE.matchAll(/`(CREATE INDEX[^`]+|DROP INDEX[^`]+)`/g),
    ]) {
      expect(statement[1]).not.toContain(";");
      expect(statement[1]!.trim()).toBe(statement[1]);
    }
  });
});

describe("the migration runs", () => {
  test("it is registered", () => {
    const index: string = fs.readFileSync(
      path.join(path.dirname(MIGRATION_PATH), "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'from "./1787300000000-AddEpisodeMemberNotifyIndexes"',
    );
    expect(index).toContain("AddEpisodeMemberNotifyIndexes1787300000000,");
  });

  /*
   * ...and registered for real, not just mentioned in the file: an import
   * that never reaches the default-export array leaves the migration
   * unregistered, and it silently never runs.
   */
  test("it is in the exported migration list", () => {
    expect(SchemaMigrations).toContain(
      AddEpisodeMemberNotifyIndexes1787300000000,
    );
  });

  test("it is appended last, matching its timestamp", () => {
    expect(SchemaMigrations[SchemaMigrations.length - 1]).toBe(
      AddEpisodeMemberNotifyIndexes1787300000000,
    );
  });

  /*
   * TypeORM records applied migrations by the `name` property, not the file
   * name. A mismatch re-runs the migration on every boot.
   */
  test("its declared name matches its class name", () => {
    expect(new AddEpisodeMemberNotifyIndexes1787300000000().name).toBe(
      "AddEpisodeMemberNotifyIndexes1787300000000",
    );
  });

  /*
   * Migrations execute in timestamp order, and TypeORM will not re-order an
   * already-applied set: a migration added with a timestamp below one that
   * has already run is simply skipped on every existing deployment, so the
   * index never appears in production and only ever shows up on fresh
   * installs. Both sides of the comparison are therefore read off the
   * registered classes themselves — rename this migration to a lower
   * timestamp, or land another one above it, and this fails.
   */
  test("its timestamp sorts after every other registered migration", () => {
    const ourTimestamp: number | null = timestampOf(
      AddEpisodeMemberNotifyIndexes1787300000000,
    );

    expect(ourTimestamp).not.toBeNull();

    const otherTimestamps: Array<number> = [];

    for (const migrationClass of SchemaMigrations) {
      if (migrationClass === AddEpisodeMemberNotifyIndexes1787300000000) {
        continue;
      }

      const timestamp: number | null = timestampOf(
        migrationClass as MigrationClass,
      );

      if (timestamp !== null) {
        otherTimestamps.push(timestamp);
      }
    }

    /*
     * Math.max() of an empty list is -Infinity, which every timestamp beats.
     * Prove the list was actually enumerated before leaning on the maximum,
     * or the assertion below is vacuous again.
     */
    expect(otherTimestamps.length).toBeGreaterThan(100);

    expect(ourTimestamp).toBeGreaterThan(Math.max(...otherTimestamps));
  });

  /*
   * ...and the timestamp in the class name is the one on disk. A class
   * renamed without renaming its file (or two migrations landing on the same
   * timestamp) leaves the ordering above asserting something that is not
   * what actually runs.
   */
  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    const ourTimestamp: number | null = timestampOf(
      AddEpisodeMemberNotifyIndexes1787300000000,
    );

    const matching: Array<string> = fs
      .readdirSync(path.dirname(MIGRATION_PATH))
      .filter((fileName: string): boolean => {
        return fileName.startsWith(`${ourTimestamp}-`);
      });

    expect(matching).toEqual([path.basename(MIGRATION_PATH)]);
  });

  test("its class name carries its timestamp", () => {
    expect(SOURCE).toContain(
      "export class AddEpisodeMemberNotifyIndexes1787300000000",
    );
    expect(SOURCE).toContain(
      'public name: string = "AddEpisodeMemberNotifyIndexes1787300000000"',
    );
  });
});
