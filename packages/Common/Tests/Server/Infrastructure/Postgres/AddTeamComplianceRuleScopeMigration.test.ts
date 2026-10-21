import { AddTeamComplianceRuleScope1796000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796000000000-AddTeamComplianceRuleScope";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import TeamComplianceSetting from "../../../../Models/DatabaseModels/TeamComplianceSetting";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import ColumnType from "../../../../Types/Database/ColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * The schema half of severity- and channel-scoped team compliance rules.
 *
 *  - TeamComplianceSetting.notificationChannel: nullable, no default, so every
 *    existing rule reads as "any channel" - exactly what it checked before.
 *  - TeamComplianceSettingIncidentSeverity / ...AlertSeverity: the severities
 *    an on-call rule is scoped to; empty means every severity, which is again
 *    what every existing rule checked. Both cascade from BOTH ends.
 *  - The unique ("teamId", "ruleType") index goes, because "Call for Critical
 *    incidents" and "Push for Critical incidents" are both
 *    HasIncidentOnCallRules on one team. Dropping it only relaxes a
 *    constraint, so no existing row can make the migration fail.
 *
 * The migration was generated against the model, so its names are TypeORM's
 * by construction; this pins that it STAYS so (a hand edit renaming a
 * constraint passes review and fails the post-deploy Schema Drift job), that
 * nothing outside the rule table rode along, that up() rewrites no rows, and
 * that down() undoes up() in reverse. Fake QueryRunner only.
 */

const OWN_CLASS_NAME: string = "AddTeamComplianceRuleScope1796000000000";

const MIGRATIONS_DIRECTORY: string = path.join(
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

const MIGRATION_FILE_NAME: string =
  "1796000000000-AddTeamComplianceRuleScope.ts";

const MIGRATION_PATH: string = path.join(
  MIGRATIONS_DIRECTORY,
  MIGRATION_FILE_NAME,
);

const RULE_TABLE: string = "TeamComplianceSetting";

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

// The unique index the original TeamComplianceSetting migration created.
const UNIQUE_RULE_TYPE_INDEX: string = namingStrategy.indexName(RULE_TABLE, [
  "teamId",
  "ruleType",
]);

type RecordQueriesFunction = (
  direction: "up" | "down",
) => Promise<Array<string>>;

const recordQueries: RecordQueriesFunction = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: (statement: string): Promise<void> => {
      statements.push(statement);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;

  await new AddTeamComplianceRuleScope1796000000000()[direction](queryRunner);

  return statements;
};

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

type TimestampOfFunction = (className: string) => number | null;

const timestampOf: TimestampOfFunction = (className: string): number | null => {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
};

interface JoinTableSpec {
  propertyName: string;
  tableName: string;
  ownerColumn: string;
  relatedColumn: string;
  relatedTable: string;
}

const JOIN_TABLES: Array<JoinTableSpec> = [
  {
    propertyName: "incidentSeverities",
    tableName: "TeamComplianceSettingIncidentSeverity",
    ownerColumn: "teamComplianceSettingId",
    relatedColumn: "incidentSeverityId",
    relatedTable: "IncidentSeverity",
  },
  {
    propertyName: "alertSeverities",
    tableName: "TeamComplianceSettingAlertSeverity",
    ownerColumn: "teamComplianceSettingId",
    relatedColumn: "alertSeverityId",
    relatedTable: "AlertSeverity",
  },
];

type ForeignKeyStatementFunction = (
  statements: Array<string>,
  tableName: string,
  columnName: string,
) => string;

const foreignKeyStatement: ForeignKeyStatementFunction = (
  statements: Array<string>,
  tableName: string,
  columnName: string,
): string => {
  const name: string = namingStrategy.foreignKeyName(tableName, [columnName]);

  const matches: Array<string> = statements.filter(
    (statement: string): boolean => {
      return statement.startsWith(
        `ALTER TABLE "${tableName}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${columnName}")`,
      );
    },
  );

  expect({ tableName, columnName, found: matches.length }).toEqual({
    tableName,
    columnName,
    found: 1,
  });

  return matches[0]!;
};

/*
 * What a statement creates and what drops it again, as one comparable key:
 * "table:X", "index:X", "constraint:T.X", "column:T.X".
 */
type ObjectKeyFunction = (statement: string) => string | null;

const createdObject: ObjectKeyFunction = (statement: string): string | null => {
  let match: RegExpMatchArray | null = statement.match(
    /^CREATE TABLE "([^"]+)"/,
  );

  if (match) {
    return `table:${match[1]}`;
  }

  match = statement.match(/^CREATE (?:UNIQUE )?INDEX "([^"]+)"/);

  if (match) {
    return `index:${match[1]}`;
  }

  match = statement.match(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/);

  if (match) {
    return `constraint:${match[1]}.${match[2]}`;
  }

  match = statement.match(/^ALTER TABLE "([^"]+)" ADD "([^"]+)"/);

  if (match) {
    return `column:${match[1]}.${match[2]}`;
  }

  return null;
};

const droppedObject: ObjectKeyFunction = (statement: string): string | null => {
  let match: RegExpMatchArray | null = statement.match(/^DROP TABLE "([^"]+)"/);

  if (match) {
    return `table:${match[1]}`;
  }

  match = statement.match(/^DROP INDEX "public"\."([^"]+)"/);

  if (match) {
    return `index:${match[1]}`;
  }

  match = statement.match(/^ALTER TABLE "([^"]+)" DROP CONSTRAINT "([^"]+)"/);

  if (match) {
    return `constraint:${match[1]}.${match[2]}`;
  }

  match = statement.match(/^ALTER TABLE "([^"]+)" DROP COLUMN "([^"]+)"/);

  if (match) {
    return `column:${match[1]}.${match[2]}`;
  }

  return null;
};

type KeysFunction = (
  statements: Array<string>,
  keyOf: ObjectKeyFunction,
) => Array<string>;

const keysOf: KeysFunction = (
  statements: Array<string>,
  keyOf: ObjectKeyFunction,
): Array<string> => {
  return statements
    .map((statement: string): string | null => {
      return keyOf(statement);
    })
    .filter((key: string | null): key is string => {
      return Boolean(key);
    });
};

describe("AddTeamComplianceRuleScope migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(new AddTeamComplianceRuleScope1796000000000().name).toBe(
      OWN_CLASS_NAME,
    );
  });

  test("is registered exactly once", () => {
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === OWN_CLASS_NAME;
      }),
    ).toHaveLength(1);
  });

  test("runs after every migration registered before it, and before every one registered after it", () => {
    /*
     * A fresh install runs the list in order, an existing one runs whatever
     * it has not recorded; both only agree if the timestamps rise along the
     * list around this entry.
     */
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);
    const ownTimestamp: number = timestampOf(OWN_CLASS_NAME)!;

    expect(
      registeredNames.slice(0, ownIndex).filter((name: string): boolean => {
        const timestamp: number | null = timestampOf(name);
        return timestamp !== null && timestamp >= ownTimestamp;
      }),
    ).toEqual([]);

    expect(
      registeredNames.slice(ownIndex + 1).filter((name: string): boolean => {
        const timestamp: number | null = timestampOf(name);
        return timestamp === null || timestamp <= ownTimestamp;
      }),
    ).toEqual([]);

    // It was registered straight after the newest migration of its time.
    expect(registeredNames[ownIndex - 1]).toBe(
      "AddSubscriberNotificationClaimedAt1795900000000",
    );
  });

  test("the wall-clock file typeorm generated was not left behind", () => {
    expect(
      fs
        .readdirSync(MIGRATIONS_DIRECTORY)
        .filter((fileName: string): boolean => {
          return (
            fileName.endsWith("-AddTeamComplianceRuleScope.ts") &&
            fileName !== MIGRATION_FILE_NAME
          );
        }),
    ).toEqual([]);
  });
});

describe("AddTeamComplianceRuleScope migration - the unique (teamId, ruleType) index", () => {
  test("up() drops exactly the unique index the original migration created", async () => {
    const original: string = fs.readFileSync(
      path.join(MIGRATIONS_DIRECTORY, "1758629540993-MigrationName.ts"),
      "utf8",
    );

    expect(UNIQUE_RULE_TYPE_INDEX).toBe("IDX_ef7342919ff02501c2b0ddc029");
    expect(original).toContain(
      `CREATE UNIQUE INDEX "${UNIQUE_RULE_TYPE_INDEX}" ON "${RULE_TABLE}" ("teamId", "ruleType") `,
    );

    const dropped: Array<string> = (await recordQueries("up")).filter(
      (statement: string): boolean => {
        return statement.startsWith("DROP ");
      },
    );

    expect(dropped).toEqual([
      `DROP INDEX "public"."${UNIQUE_RULE_TYPE_INDEX}"`,
    ]);
  });

  test("the model no longer declares a unique index over the rule type", () => {
    const indexes: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return index.target === TeamComplianceSetting;
        },
      );

    // The scan sees the model's indexes: the plain projectId / teamId ones.
    expect(indexes.length).toBeGreaterThanOrEqual(2);

    expect(
      indexes.filter((index: IndexMetadataArgs): boolean => {
        return Boolean(index.unique);
      }),
    ).toEqual([]);
  });

  test("down() puts the unique index back, last, once the join tables are gone", async () => {
    /*
     * Rolling back is only possible while no team holds two rules of one
     * type - which is inherent: the old schema cannot represent them.
     */
    const down: Array<string> = await recordQueries("down");

    expect(down[down.length - 1]).toBe(
      `CREATE UNIQUE INDEX "${UNIQUE_RULE_TYPE_INDEX}" ON "${RULE_TABLE}" ("teamId", "ruleType") `,
    );
  });
});

describe("AddTeamComplianceRuleScope migration - notificationChannel", () => {
  test("is added as the model declares it: varchar(100), nullable, no default", async () => {
    const declared: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (column: ColumnMetadataArgs): boolean => {
          return (
            column.target === TeamComplianceSetting &&
            column.propertyName === "notificationChannel"
          );
        },
      );

    expect(declared?.options.type).toBe(ColumnType.ShortText);
    expect(declared?.options.length).toBe(ColumnLength.ShortText);
    expect(ColumnLength.ShortText).toBe(100);
    expect(declared?.options.nullable).toBe(true);
    expect(declared?.options.default).toBeUndefined();

    const added: Array<string> = (await recordQueries("up")).filter(
      (statement: string): boolean => {
        return statement.startsWith(`ALTER TABLE "${RULE_TABLE}" ADD "`);
      },
    );

    // Existing rules read as "any channel"; adding it rewrites nothing.
    expect(added).toEqual([
      `ALTER TABLE "${RULE_TABLE}" ADD "notificationChannel" character varying(100)`,
    ]);
  });

  test("down() drops it", async () => {
    expect(await recordQueries("down")).toContain(
      `ALTER TABLE "${RULE_TABLE}" DROP COLUMN "notificationChannel"`,
    );
  });
});

describe("AddTeamComplianceRuleScope migration - the severity join tables", () => {
  test.each(JOIN_TABLES)(
    "$tableName matches the model's @JoinTable declaration",
    (spec: JoinTableSpec) => {
      const declared: JoinTableMetadataArgs | undefined =
        getMetadataArgsStorage().joinTables.find(
          (joinTable: JoinTableMetadataArgs): boolean => {
            return (
              joinTable.target === TeamComplianceSetting &&
              joinTable.propertyName === spec.propertyName
            );
          },
        );

      expect(declared?.name).toBe(spec.tableName);
      expect(declared?.joinColumns?.[0]?.name).toBe(spec.ownerColumn);
      expect(declared?.joinColumns?.[0]?.referencedColumnName).toBe("_id");
      expect(declared?.inverseJoinColumns?.[0]?.name).toBe(spec.relatedColumn);
      expect(declared?.inverseJoinColumns?.[0]?.referencedColumnName).toBe(
        "_id",
      );
    },
  );

  test.each(JOIN_TABLES)(
    "$tableName is created with a composite primary key under TypeORM's name",
    async (spec: JoinTableSpec) => {
      const primaryKeyName: string = namingStrategy.primaryKeyName(
        spec.tableName,
        [spec.ownerColumn, spec.relatedColumn],
      );

      expect(await recordQueries("up")).toContain(
        `CREATE TABLE "${spec.tableName}" ("${spec.ownerColumn}" uuid NOT NULL, "${spec.relatedColumn}" uuid NOT NULL, CONSTRAINT "${primaryKeyName}" PRIMARY KEY ("${spec.ownerColumn}", "${spec.relatedColumn}"))`,
      );
    },
  );

  test.each(JOIN_TABLES)(
    "$tableName indexes both sides under TypeORM's names",
    async (spec: JoinTableSpec) => {
      const statements: Array<string> = await recordQueries("up");

      for (const column of [spec.ownerColumn, spec.relatedColumn]) {
        expect(statements).toContain(
          `CREATE INDEX "${namingStrategy.indexName(spec.tableName, [column])}" ON "${spec.tableName}" ("${column}") `,
        );
      }
    },
  );

  test.each(JOIN_TABLES)(
    "$tableName cascades from BOTH sides: deleting a rule or a severity removes the link",
    async (spec: JoinTableSpec) => {
      /*
       * Deleting a severity must drop it out of a rule's scope rather than be
       * blocked by it, and deleting a rule must not leave orphaned links.
       */
      const statements: Array<string> = await recordQueries("up");

      expect(
        foreignKeyStatement(statements, spec.tableName, spec.ownerColumn),
      ).toBe(
        `ALTER TABLE "${spec.tableName}" ADD CONSTRAINT "${namingStrategy.foreignKeyName(spec.tableName, [spec.ownerColumn])}" FOREIGN KEY ("${spec.ownerColumn}") REFERENCES "${RULE_TABLE}"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
      );
      expect(
        foreignKeyStatement(statements, spec.tableName, spec.relatedColumn),
      ).toBe(
        `ALTER TABLE "${spec.tableName}" ADD CONSTRAINT "${namingStrategy.foreignKeyName(spec.tableName, [spec.relatedColumn])}" FOREIGN KEY ("${spec.relatedColumn}") REFERENCES "${spec.relatedTable}"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
      );
    },
  );

  test.each(JOIN_TABLES)(
    "$tableName's foreign keys are added only once both tables exist",
    async (spec: JoinTableSpec) => {
      const statements: Array<string> = await recordQueries("up");

      const created: number = statements.findIndex(
        (statement: string): boolean => {
          return statement.startsWith(`CREATE TABLE "${spec.tableName}"`);
        },
      );
      const firstForeignKey: number = statements.findIndex(
        (statement: string): boolean => {
          return statement.startsWith(
            `ALTER TABLE "${spec.tableName}" ADD CONSTRAINT`,
          );
        },
      );

      expect(created).toBeGreaterThanOrEqual(0);
      expect(firstForeignKey).toBeGreaterThan(created);
    },
  );
});

describe("AddTeamComplianceRuleScope migration - scope", () => {
  test("creates exactly the two join tables", async () => {
    const created: Array<string> = keysOf(
      await recordQueries("up"),
      createdObject,
    ).filter((key: string): boolean => {
      return key.startsWith("table:");
    });

    expect(created.sort()).toEqual(
      JOIN_TABLES.map((spec: JoinTableSpec): string => {
        return `table:${spec.tableName}`;
      }).sort(),
    );
  });

  test("touches nothing outside the rule table and its join tables", async () => {
    /*
     * A generated migration also sweeps up any unrelated drift between the
     * models and the database it ran against. That belongs to its own change.
     */
    const allowed: Set<string> = new Set<string>([
      RULE_TABLE,
      ...JOIN_TABLES.map((spec: JoinTableSpec): string => {
        return spec.tableName;
      }),
    ]);

    /*
     * DROP INDEX names no table, so an index is traced to its table by
     * TypeORM's name for it.
     */
    const indexTables: Map<string, string> = new Map<string, string>([
      [UNIQUE_RULE_TYPE_INDEX, RULE_TABLE],
    ]);

    for (const spec of JOIN_TABLES) {
      for (const column of [spec.ownerColumn, spec.relatedColumn]) {
        indexTables.set(
          namingStrategy.indexName(spec.tableName, [column]),
          spec.tableName,
        );
      }
    }

    const statements: Array<string> = [
      ...(await recordQueries("up")),
      ...(await recordQueries("down")),
    ];

    for (const statement of statements) {
      const droppedIndex: string | undefined = statement.match(
        /^DROP INDEX "public"\."([^"]+)"/,
      )?.[1];

      const touched: string | undefined =
        statement.match(/^ALTER TABLE "([^"]+)"/)?.[1] ||
        statement.match(
          /^CREATE (?:UNIQUE )?INDEX "[^"]+" ON "([^"]+)"/,
        )?.[1] ||
        statement.match(/^(?:CREATE|DROP) TABLE "([^"]+)"/)?.[1] ||
        (droppedIndex ? indexTables.get(droppedIndex) : undefined);

      expect({
        statement,
        allowed: touched ? allowed.has(touched) : false,
      }).toEqual({ statement, allowed: true });
    }
  });

  test("up() rewrites no rows", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).not.toMatch(/^(UPDATE|DELETE|INSERT)\b/);
      expect(statement).not.toMatch(/\bNOT NULL DEFAULT\b/);
    }
  });
});

describe("AddTeamComplianceRuleScope migration - down() undoes up()", () => {
  test("drops exactly what up() created, and re-creates exactly what up() dropped", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    /*
     * Objects up() creates are dropped by down(); the index up() drops is
     * created by down(). Primary keys go with their tables.
     */
    expect(keysOf(down, droppedObject).sort()).toEqual(
      keysOf(up, createdObject).sort(),
    );
    expect(keysOf(down, createdObject).sort()).toEqual(
      keysOf(up, droppedObject).sort(),
    );
  });

  test("runs in reverse: constraints before tables, and each index before its table", async () => {
    const down: Array<string> = await recordQueries("down");

    const lastConstraintDrop: number = Math.max(
      ...down
        .map((statement: string, index: number): number => {
          return statement.includes("DROP CONSTRAINT") ? index : -1;
        })
        .filter((index: number): boolean => {
          return index >= 0;
        }),
    );

    const firstTableDrop: number = down.findIndex(
      (statement: string): boolean => {
        return statement.startsWith("DROP TABLE");
      },
    );

    expect(lastConstraintDrop).toBeLessThan(firstTableDrop);

    for (const spec of JOIN_TABLES) {
      const tableDrop: number = down.indexOf(`DROP TABLE "${spec.tableName}"`);

      expect(tableDrop).toBeGreaterThanOrEqual(0);

      for (const column of [spec.ownerColumn, spec.relatedColumn]) {
        const indexDrop: number = down.indexOf(
          `DROP INDEX "public"."${namingStrategy.indexName(spec.tableName, [column])}"`,
        );

        expect(indexDrop).toBeGreaterThanOrEqual(0);
        expect(indexDrop).toBeLessThan(tableDrop);
      }
    }
  });
});
