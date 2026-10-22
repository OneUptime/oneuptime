import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DefaultNamingStrategy, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import Migrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddOnCallAcknowledgementTimeout1805920000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805920000000-AddOnCallAcknowledgementTimeout";
import { AddOnCallAcknowledgementTimeoutIndex1805930000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805930000000-AddOnCallAcknowledgementTimeoutIndex";

/*
 * The two migrations behind an on-call policy's acknowledgement timeout
 * (issue #5123, Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout):
 *
 *   - AddOnCallAcknowledgementTimeout adds three columns, each nullable with
 *     no default, so neither table is rewritten and nothing is backfilled:
 *     every policy there is keeps not paging again, and no run has a clock
 *     running or is a page again;
 *   - AddOnCallAcknowledgementTimeoutIndex builds the partial index the
 *     minute worker reads the running clocks through, online and outside a
 *     transaction (OnlineDdl), since on-call runs are written all the time.
 *
 * Both were generated against a migrated database, and the schema drift
 * check ran clean after them; these keep them that way.
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

const COLUMNS_FILE: string = "1805920000000-AddOnCallAcknowledgementTimeout.ts";
const INDEX_FILE: string =
  "1805930000000-AddOnCallAcknowledgementTimeoutIndex.ts";
const COLUMNS_NAME: string = "AddOnCallAcknowledgementTimeout1805920000000";
const INDEX_NAME: string = "AddOnCallAcknowledgementTimeoutIndex1805930000000";
// The newest migration when these were renumbered on top of it.
const GENERATED_AFTER: string =
  "AddIncidentPostmortemStatusIndexesAndKey1805910000000";

const POLICY_TABLE: string = "OnCallDutyPolicy";
const RUN_TABLE: string = "OnCallDutyPolicyExecutionLog";
const CLOCK_COLUMN: string = "acknowledgementTimeoutStartedAt";
// The rows the worker reads: a running clock, on a run not deleted.
const CLOCK_INDEX_WHERE: string =
  '"acknowledgementTimeoutStartedAt" IS NOT NULL AND "deletedAt" IS NULL';

const CREATE_INDEX: RegExp = /CREATE INDEX/g;
const ROW_WRITES: RegExp = /UPDATE "|INSERT INTO|DELETE FROM/;
const ONLINE_CREATE_INDEX: RegExp = /OnlineDdl\.createIndex/g;
const ONLINE_DROP_INDEX: RegExp = /OnlineDdl\.dropIndex/g;
const TABLES_TOUCHED: RegExp = /(?:ALTER TABLE|ON) "(\w+)"/g;

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

const COLUMNS_MIGRATION: MigrationSource = read(COLUMNS_FILE);
const INDEX_MIGRATION: MigrationSource = read(INDEX_FILE);

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

const declaredColumn: (
  target: unknown,
  propertyName: string,
) => ColumnMetadataArgs | undefined = (
  target: unknown,
  propertyName: string,
): ColumnMetadataArgs | undefined => {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === target && column.propertyName === propertyName;
    },
  );
};

// [table, column, the type the migration adds it with, its model]
const COLUMNS: Array<[string, string, string, unknown]> = [
  [
    POLICY_TABLE,
    "acknowledgementTimeoutInMinutes",
    "integer",
    OnCallDutyPolicy,
  ],
  [
    RUN_TABLE,
    "acknowledgementTimeoutStartedAt",
    "TIMESTAMP WITH TIME ZONE",
    OnCallDutyPolicyExecutionLog,
  ],
  [RUN_TABLE, "pageAgainNumber", "integer", OnCallDutyPolicyExecutionLog],
];

describe("registration", () => {
  const names: Array<string> = Migrations.map(
    (migration: { name: string }): string => {
      return migration.name;
    },
  );

  test("both are registered once, the index right after the columns", () => {
    expect(
      names.filter((name: string): boolean => {
        return name === COLUMNS_NAME;
      }),
    ).toHaveLength(1);
    expect(
      names.filter((name: string): boolean => {
        return name === INDEX_NAME;
      }),
    ).toHaveLength(1);

    const columns: number = names.indexOf(COLUMNS_NAME);

    expect(Migrations[columns]).toBe(
      AddOnCallAcknowledgementTimeout1805920000000,
    );
    expect(Migrations[columns + 1]).toBe(
      AddOnCallAcknowledgementTimeoutIndex1805930000000,
    );
  });

  test("after the migration they were renumbered on top of", () => {
    expect(names.indexOf(GENERATED_AFTER)).toBeGreaterThan(-1);
    expect(names.indexOf(COLUMNS_NAME)).toBeGreaterThan(
      names.indexOf(GENERATED_AFTER),
    );
    expect(Number(COLUMNS_NAME.slice(-13))).toBeGreaterThan(
      Number(GENERATED_AFTER.slice(-13)),
    );
  });

  test("their names match their classes and their files' timestamps, in order", () => {
    expect(new AddOnCallAcknowledgementTimeout1805920000000().name).toBe(
      COLUMNS_NAME,
    );
    expect(new AddOnCallAcknowledgementTimeoutIndex1805930000000().name).toBe(
      INDEX_NAME,
    );
    expect(COLUMNS_FILE.split("-")[0]).toBe(COLUMNS_NAME.slice(-13));
    expect(INDEX_FILE.split("-")[0]).toBe(INDEX_NAME.slice(-13));
    expect(Number(COLUMNS_NAME.slice(-13))).toBeLessThan(
      Number(INDEX_NAME.slice(-13)),
    );
  });

  test("no other registered migration has either timestamp", () => {
    for (const name of [COLUMNS_NAME, INDEX_NAME]) {
      const timestamp: string = name.slice(-13);

      expect(
        names.filter((other: string): boolean => {
          return other.endsWith(timestamp);
        }),
      ).toEqual([name]);
    }
  });
});

describe("the columns", () => {
  test.each(COLUMNS)(
    "%s.%s is added as %s, nullable with no default, and dropped by down()",
    (table: string, column: string, type: string, model: unknown) => {
      expect(COLUMNS_MIGRATION.up).toContain(
        `ALTER TABLE "${table}" ADD "${column}" ${type}\``,
      );
      expect(COLUMNS_MIGRATION.down).toContain(
        `ALTER TABLE "${table}" DROP COLUMN "${column}"`,
      );

      const declared: ColumnMetadataArgs | undefined = declaredColumn(
        model,
        column,
      );

      expect(declared).toBeDefined();
      expect(declared!.options.nullable).toBe(true);
      expect(declared!.options.default).toBeUndefined();
    },
  );

  test("are the three it adds, and nothing else: no row written, no index, no column changed", () => {
    expect(COLUMNS_MIGRATION.up.split("queryRunner.query(").length - 1).toBe(3);
    expect(COLUMNS_MIGRATION.up).not.toMatch(ROW_WRITES);
    expect(COLUMNS_MIGRATION.up.match(CREATE_INDEX)).toBeNull();
    expect(COLUMNS_MIGRATION.up).not.toContain("ALTER COLUMN");
    expect(COLUMNS_MIGRATION.up).not.toContain("NOT NULL");
    expect(COLUMNS_MIGRATION.up).not.toContain("DEFAULT");
  });

  test("down() drops them in the reverse order up() adds them", () => {
    const dropped: Array<number> = COLUMNS.map(
      ([table, column]: [string, string, string, unknown]): number => {
        return COLUMNS_MIGRATION.down.indexOf(
          `ALTER TABLE "${table}" DROP COLUMN "${column}"`,
        );
      },
    );

    for (const at of dropped) {
      expect(at).toBeGreaterThan(-1);
    }

    expect(
      [...dropped].sort((a: number, b: number): number => {
        return b - a;
      }),
    ).toEqual(dropped);
  });

  test("run in an ordinary transaction", () => {
    expect(
      (
        new AddOnCallAcknowledgementTimeout1805920000000() as unknown as {
          transaction?: boolean;
        }
      ).transaction,
    ).toBeUndefined();
  });
});

describe("the clock index", () => {
  const clockIndex: IndexMetadataArgs | undefined = getMetadataArgsStorage()
    .indices.filter((index: IndexMetadataArgs): boolean => {
      return index.target === OnCallDutyPolicyExecutionLog;
    })
    .find((index: IndexMetadataArgs): boolean => {
      return (
        Array.isArray(index.columns) &&
        (index.columns as Array<string>).length === 1 &&
        (index.columns as Array<string>)[0] === CLOCK_COLUMN
      );
    });

  const name: string = namingStrategy.indexName(
    RUN_TABLE,
    [CLOCK_COLUMN],
    CLOCK_INDEX_WHERE,
  );

  test("is the model's own: partial, on the running clocks of runs not deleted", () => {
    expect(clockIndex).toBeDefined();
    expect(clockIndex!.where).toBe(CLOCK_INDEX_WHERE);
  });

  test("is built online, outside a transaction, under TypeORM's name for it", () => {
    expect(
      new AddOnCallAcknowledgementTimeoutIndex1805930000000().transaction,
    ).toBe(false);
    expect(INDEX_MIGRATION.up).not.toContain("queryRunner.query(");
    expect(INDEX_MIGRATION.up.match(ONLINE_CREATE_INDEX)).toHaveLength(1);
    expect(INDEX_MIGRATION.up).toContain(
      `CREATE INDEX "${name}" ON "${RUN_TABLE}" ("${CLOCK_COLUMN}") WHERE ${CLOCK_INDEX_WHERE}\``,
    );
  });

  test("is dropped online by down()", () => {
    expect(INDEX_MIGRATION.down).not.toContain("queryRunner.query(");
    expect(INDEX_MIGRATION.down.match(ONLINE_DROP_INDEX)).toHaveLength(1);
    expect(INDEX_MIGRATION.down).toContain(`DROP INDEX "public"."${name}"`);
  });

  test("touches only the runs' table", () => {
    expect(
      new Set(
        Array.from(INDEX_MIGRATION.source.matchAll(TABLES_TOUCHED)).map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
      ),
    ).toEqual(new Set([RUN_TABLE]));
  });
});
