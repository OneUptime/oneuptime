import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import { AddSubscriberUpdateNotificationStatus1793400000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1793400000000-AddSubscriberUpdateNotificationStatus";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import InitialMigration from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1717605043663-InitialMigration";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * AddSubscriberUpdateNotificationStatus1793400000000 gives each of the four
 * tables whose edits can notify status page subscribers a status and a
 * message for that "updated" notification.
 *
 * What must hold, all without a database:
 *   - the columns are nullable with no default, so existing rows read as
 *     "no update notification requested" and the update worker, which looks
 *     for Pending, has nothing to pick up after the migration runs;
 *   - the status column is indexed (the worker polls it every minute) with
 *     the exact name TypeORM derives, so schema:generate sees no drift;
 *   - down() removes exactly what up() added;
 *   - the migration is registered, so it runs on boot.
 * The drift check in CI covers the generated SQL against a real database.
 */

type ModelClass = { new (): unknown };

interface TableCase {
  model: ModelClass;
  table: string;
  statusColumn: string;
  messageColumn: string;
}

const TABLES: Array<TableCase> = [
  {
    model: StatusPageAnnouncement,
    table: "StatusPageAnnouncement",
    statusColumn: "subscriberNotificationStatusOnAnnouncementUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnAnnouncementUpdated",
  },
  {
    model: IncidentPublicNote,
    table: "IncidentPublicNote",
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
  },
  {
    model: ScheduledMaintenancePublicNote,
    table: "ScheduledMaintenancePublicNote",
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
  },
  {
    model: IncidentEpisodePublicNote,
    table: "IncidentEpisodePublicNote",
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
  },
];

const ADD_COLUMN_REGEX: RegExp =
  /^ALTER TABLE "([^"]+)" ADD "([^"]+)" (character varying|text)$/;
const DROP_COLUMN_REGEX: RegExp =
  /^ALTER TABLE "([^"]+)" DROP COLUMN "([^"]+)"$/;
const CREATE_INDEX_REGEX: RegExp =
  /^CREATE INDEX "([^"]+)" ON "([^"]+)" \("([^"]+)"\)\s*$/;
const DROP_INDEX_REGEX: RegExp = /^DROP INDEX "public"\."([^"]+)"$/;

function makeQueryRunner(): { runner: QueryRunner; query: jest.Mock } {
  const query: jest.Mock = jest.fn().mockResolvedValue(undefined);
  return { runner: { query } as unknown as QueryRunner, query };
}

function executedSql(query: jest.Mock): Array<string> {
  return query.mock.calls.map((call: Array<unknown>) => {
    return String(call[0]);
  });
}

async function upStatements(): Promise<Array<string>> {
  const { runner, query } = makeQueryRunner();
  await new AddSubscriberUpdateNotificationStatus1793400000000().up(runner);
  return executedSql(query);
}

async function downStatements(): Promise<Array<string>> {
  const { runner, query } = makeQueryRunner();
  await new AddSubscriberUpdateNotificationStatus1793400000000().down(runner);
  return executedSql(query);
}

function columnArgs(model: ModelClass, property: string): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((args: ColumnMetadataArgs) => {
      return args.target === model && args.propertyName === property;
    })
    .pop();

  expect(column).toBeDefined();
  return column!;
}

describe("AddSubscriberUpdateNotificationStatus: entity columns", () => {
  test.each(TABLES)(
    "$table update notification columns are nullable with no default",
    (tableCase: TableCase) => {
      for (const property of [
        tableCase.statusColumn,
        tableCase.messageColumn,
      ]) {
        const args: ColumnMetadataArgs = columnArgs(tableCase.model, property);

        expect(args.options.nullable).toBe(true);
        expect(args.options.default).toBeUndefined();
      }
    },
  );

  test.each(TABLES)(
    "$table.$statusColumn has a single-column index decorator",
    (tableCase: TableCase) => {
      const indexed: Array<string> = getMetadataArgsStorage()
        .indices.filter((index: IndexMetadataArgs) => {
          return (
            index.target === tableCase.model && Array.isArray(index.columns)
          );
        })
        .map((index: IndexMetadataArgs) => {
          return (index.columns as Array<string>).join(",");
        });

      expect(indexed).toContain(tableCase.statusColumn);
      expect(indexed).not.toContain(tableCase.messageColumn);
    },
  );
});

describe("AddSubscriberUpdateNotificationStatus1793400000000 SQL contract", () => {
  test("up() adds exactly the eight columns, as nullable, and nothing else", async () => {
    const statements: Array<string> = (await upStatements()).filter(
      (sql: string) => {
        return sql.startsWith("ALTER TABLE");
      },
    );

    expect(statements).toHaveLength(8);

    const added: Array<string> = statements.map((sql: string) => {
      expect(sql).toMatch(ADD_COLUMN_REGEX);
      expect(sql).not.toMatch(/NOT NULL|DEFAULT/);
      const match: RegExpMatchArray = sql.match(
        ADD_COLUMN_REGEX,
      ) as RegExpMatchArray;
      return `${match[1]}.${match[2]}:${match[3]}`;
    });

    const expected: Array<string> = TABLES.flatMap((tableCase: TableCase) => {
      return [
        `${tableCase.table}.${tableCase.statusColumn}:character varying`,
        `${tableCase.table}.${tableCase.messageColumn}:text`,
      ];
    });

    expect([...added].sort()).toEqual([...expected].sort());
  });

  test("up() creates one index per status column, named the way TypeORM names it", async () => {
    const statements: Array<string> = (await upStatements()).filter(
      (sql: string) => {
        return sql.startsWith("CREATE INDEX");
      },
    );

    expect(statements).toHaveLength(4);

    const naming: DefaultNamingStrategy = new DefaultNamingStrategy();

    for (const tableCase of TABLES) {
      const expectedName: string = naming.indexName(tableCase.table, [
        tableCase.statusColumn,
      ]);

      expect(statements).toContainEqual(
        expect.stringMatching(
          new RegExp(
            `^CREATE INDEX "${expectedName}" ON "${tableCase.table}" \\("${tableCase.statusColumn}"\\)\\s*$`,
          ),
        ),
      );
    }
  });

  test("up() issues only column additions and index creations", async () => {
    for (const sql of await upStatements()) {
      expect(ADD_COLUMN_REGEX.test(sql) || CREATE_INDEX_REGEX.test(sql)).toBe(
        true,
      );
      expect(sql).not.toMatch(/DROP|ALTER COLUMN|UPDATE /);
    }
  });

  test("up() adds the columns before indexing them", async () => {
    const statements: Array<string> = await upStatements();
    const lastAdd: number = statements
      .map((sql: string) => {
        return ADD_COLUMN_REGEX.test(sql);
      })
      .lastIndexOf(true);
    const firstIndex: number = statements.findIndex((sql: string) => {
      return CREATE_INDEX_REGEX.test(sql);
    });

    expect(lastAdd).toBeLessThan(firstIndex);
  });

  test("down() drops exactly the indexes and columns up() created", async () => {
    const up: Array<string> = await upStatements();
    const down: Array<string> = await downStatements();

    const createdIndexes: Array<string> = up
      .filter((sql: string) => {
        return CREATE_INDEX_REGEX.test(sql);
      })
      .map((sql: string) => {
        return (sql.match(CREATE_INDEX_REGEX) as RegExpMatchArray)[1]!;
      });
    const droppedIndexes: Array<string> = down
      .filter((sql: string) => {
        return DROP_INDEX_REGEX.test(sql);
      })
      .map((sql: string) => {
        return (sql.match(DROP_INDEX_REGEX) as RegExpMatchArray)[1]!;
      });

    const addedColumns: Array<string> = up
      .filter((sql: string) => {
        return ADD_COLUMN_REGEX.test(sql);
      })
      .map((sql: string) => {
        const match: RegExpMatchArray = sql.match(
          ADD_COLUMN_REGEX,
        ) as RegExpMatchArray;
        return `${match[1]}.${match[2]}`;
      });
    const droppedColumns: Array<string> = down
      .filter((sql: string) => {
        return DROP_COLUMN_REGEX.test(sql);
      })
      .map((sql: string) => {
        const match: RegExpMatchArray = sql.match(
          DROP_COLUMN_REGEX,
        ) as RegExpMatchArray;
        return `${match[1]}.${match[2]}`;
      });

    expect(down).toHaveLength(up.length);
    expect([...droppedIndexes].sort()).toEqual([...createdIndexes].sort());
    expect([...droppedColumns].sort()).toEqual([...addedColumns].sort());
  });

  test("down() drops the indexes before the columns they cover", async () => {
    const down: Array<string> = await downStatements();
    const lastIndexDrop: number = down
      .map((sql: string) => {
        return DROP_INDEX_REGEX.test(sql);
      })
      .lastIndexOf(true);
    const firstColumnDrop: number = down.findIndex((sql: string) => {
      return DROP_COLUMN_REGEX.test(sql);
    });

    expect(lastIndexDrop).toBeLessThan(firstColumnDrop);
  });

  test("names itself after its class", () => {
    expect(new AddSubscriberUpdateNotificationStatus1793400000000().name).toBe(
      "AddSubscriberUpdateNotificationStatus1793400000000",
    );
  });
});

describe("AddSubscriberUpdateNotificationStatus1793400000000 registration", () => {
  test("is registered in SchemaMigrations/Index.ts so it runs on boot", () => {
    expect(SchemaMigrations).toContain(
      AddSubscriberUpdateNotificationStatus1793400000000,
    );
  });

  test("runs after the initial migration that created the tables it alters", () => {
    const position: number = SchemaMigrations.indexOf(
      AddSubscriberUpdateNotificationStatus1793400000000,
    );

    expect(position).toBeGreaterThan(
      SchemaMigrations.indexOf(InitialMigration),
    );
    expect(SchemaMigrations.indexOf(InitialMigration)).toBe(0);
  });
});
