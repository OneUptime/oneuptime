import { AddMessageQueueTables1796500000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796500000000-AddMessageQueueTables";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import MessageQueue from "../../../../Models/DatabaseModels/MessageQueue";
import MessageQueueLabelRule from "../../../../Models/DatabaseModels/MessageQueueLabelRule";
import MessageQueueOwnerRule from "../../../../Models/DatabaseModels/MessageQueueOwnerRule";
import MessageQueueOwnerTeam from "../../../../Models/DatabaseModels/MessageQueueOwnerTeam";
import MessageQueueOwnerUser from "../../../../Models/DatabaseModels/MessageQueueOwnerUser";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The schema half of the Queues product.
 *
 * The migration was generated against the models (against a scratch database
 * migrated to the previous head), so its names are TypeORM's by construction.
 * What this pins is that it STAYS the migration for these models: every table
 * is created with every column its model persists, every constraint carries
 * TypeORM's own name (a hand edit that renamed one would pass review and then
 * fail the Schema Drift job), the identity and slug indexes are the NAMED
 * partial unique ones the models declare, a queue's owners go with it,
 * nothing unrelated rode along, and down() undoes up().
 *
 * Fake QueryRunner only.
 */

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

const OWN_TIMESTAMP: number = 1796500000000;

type RecordQueriesFunction = (
  direction: "up" | "down",
) => Promise<Array<string>>;

const recordQueries: RecordQueriesFunction = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddMessageQueueTables1796500000000()[direction](queryRunner);

  return statements;
};

// Columns a model persists, inherited ones (_id, version, criteria) included.
function persistedColumns(modelType: unknown): Array<string> {
  const names: Array<string> = [];
  let current: unknown = modelType;

  while (typeof current === "function" && current !== Function.prototype) {
    for (const column of getMetadataArgsStorage().columns) {
      if (column.target === current) {
        const args: ColumnMetadataArgs = column;
        names.push(args.options.name || args.propertyName);
      }
    }

    current = Object.getPrototypeOf(current);
  }

  return names;
}

/*
 * Columns a LATER migration adds to a table this migration creates. This
 * migration will ship, so a new column arrives in a new migration rather
 * than in this CREATE TABLE; the invariant is "every model column is created
 * here or added later", which still fails a column no migration mentions at
 * all. The end-state schema itself is owned by the Schema Drift job.
 */
function columnsAddedByLaterMigrations(tableName: string): Set<string> {
  const migrationsDirectory: string = path.join(
    __dirname,
    "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
  );
  const ownFileName: string = "1796500000000-AddMessageQueueTables.ts";
  const added: Set<string> = new Set<string>();

  for (const fileName of fs.readdirSync(migrationsDirectory)) {
    const stamp: RegExpMatchArray | null = fileName.match(/^(\d{13})-/);

    if (
      !fileName.endsWith(".ts") ||
      fileName === ownFileName ||
      !stamp ||
      Number(stamp[1]) <= OWN_TIMESTAMP
    ) {
      continue;
    }

    const source: string = fs.readFileSync(
      path.join(migrationsDirectory, fileName),
      "utf8",
    );
    const addPattern: RegExp = new RegExp(
      `ALTER TABLE "${tableName}" ADD "([^"]+)"`,
      "g",
    );
    let match: RegExpExecArray | null = addPattern.exec(source);

    while (match) {
      added.add(match[1]!);
      match = addPattern.exec(source);
    }
  }

  return added;
}

function createTableStatement(
  statements: Array<string>,
  tableName: string,
): string {
  const matches: Array<string> = statements.filter(
    (statement: string): boolean => {
      return statement.startsWith(`CREATE TABLE "${tableName}" (`);
    },
  );

  expect({ tableName, found: matches.length }).toEqual({
    tableName,
    found: 1,
  });

  return matches[0]!;
}

function foreignKeyStatement(
  statements: Array<string>,
  tableName: string,
  columnName: string,
): string {
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
}

const MODEL_TABLES: Array<[string, unknown]> = [
  ["MessageQueue", MessageQueue],
  ["MessageQueueOwnerTeam", MessageQueueOwnerTeam],
  ["MessageQueueOwnerUser", MessageQueueOwnerUser],
  ["MessageQueueLabelRule", MessageQueueLabelRule],
  ["MessageQueueOwnerRule", MessageQueueOwnerRule],
];

interface JoinTableSpec {
  tableName: string;
  ownerColumn: string;
  ownerTable: string;
  relatedColumn: string;
  relatedTable: string;
}

const JOIN_TABLES: Array<JoinTableSpec> = [
  {
    tableName: "MessageQueueLabel",
    ownerColumn: "messageQueueId",
    ownerTable: "MessageQueue",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    tableName: "MessageQueueLabelRuleMessageQueueLabel",
    ownerColumn: "messageQueueLabelRuleId",
    ownerTable: "MessageQueueLabelRule",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    tableName: "MessageQueueLabelRuleLabelToAdd",
    ownerColumn: "messageQueueLabelRuleId",
    ownerTable: "MessageQueueLabelRule",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    tableName: "MessageQueueOwnerRuleMessageQueueLabel",
    ownerColumn: "messageQueueOwnerRuleId",
    ownerTable: "MessageQueueOwnerRule",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    tableName: "MessageQueueOwnerRuleOwnerUser",
    ownerColumn: "messageQueueOwnerRuleId",
    ownerTable: "MessageQueueOwnerRule",
    relatedColumn: "userId",
    relatedTable: "User",
  },
  {
    tableName: "MessageQueueOwnerRuleOwnerTeam",
    ownerColumn: "messageQueueOwnerRuleId",
    ownerTable: "MessageQueueOwnerRule",
    relatedColumn: "teamId",
    relatedTable: "Team",
  },
];

const ALL_TABLES: Array<string> = [
  ...MODEL_TABLES.map(([tableName]: [string, unknown]): string => {
    return tableName;
  }),
  ...JOIN_TABLES.map((spec: JoinTableSpec): string => {
    return spec.tableName;
  }),
];

const CHILD_TABLES: Array<string> = [
  "MessageQueueOwnerTeam",
  "MessageQueueOwnerUser",
];

describe("AddMessageQueueTables1796500000000", () => {
  test("is registered under the name its class carries", () => {
    const migration: AddMessageQueueTables1796500000000 =
      new AddMessageQueueTables1796500000000();

    expect(migration.name).toBe("AddMessageQueueTables1796500000000");
    expect(SchemaMigrations).toContain(AddMessageQueueTables1796500000000);
    expect(
      SchemaMigrations.filter((registered: unknown): boolean => {
        return registered === AddMessageQueueTables1796500000000;
      }),
    ).toHaveLength(1);
  });

  /*
   * Not "is registered last": the next migration to land falsifies that
   * without going anywhere near these tables. What this migration must not do
   * is jump the queue of those registered before it; the registry-wide guard
   * on the newest entry lives in SchemaMigrationsOrdering.
   */
  test("its timestamp keeps it behind every migration registered before it", () => {
    const timestampOf: (className: string) => number | null = (
      className: string,
    ): number | null => {
      const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
      return match ? Number(match[1]) : null;
    };

    const names: Array<string> = (
      SchemaMigrations as unknown as Array<{ name: string }>
    ).map((registered: { name: string }): string => {
      return registered.name;
    });

    const ownIndex: number = names.indexOf(
      "AddMessageQueueTables1796500000000",
    );

    // indexOf -1 would make the slice below empty and this test vacuous.
    expect(ownIndex).toBeGreaterThan(0);

    const notBehind: Array<string> = names
      .slice(0, ownIndex)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOf(className);
        return timestamp !== null && timestamp >= OWN_TIMESTAMP;
      });

    expect(notBehind).toEqual([]);
  });

  test("touches only the eleven new tables", async () => {
    const statements: Array<string> = await recordQueries("up");

    for (const statement of statements) {
      const table: RegExpMatchArray | null = statement.match(
        /^(?:CREATE TABLE|ALTER TABLE|CREATE (?:UNIQUE )?INDEX "[^"]+" ON) "([^"]+)"/,
      );

      expect({ statement, table: table?.[1] }).toEqual({
        statement,
        table: expect.stringMatching(new RegExp(`^(${ALL_TABLES.join("|")})$`)),
      });
    }

    expect(
      statements.filter((statement: string): boolean => {
        return statement.startsWith("CREATE TABLE");
      }),
    ).toHaveLength(ALL_TABLES.length);
    expect(ALL_TABLES).toHaveLength(11);
  });

  test.each(MODEL_TABLES)(
    "creates %s with every column the model persists",
    async (tableName: string, modelType: unknown) => {
      const statement: string = createTableStatement(
        await recordQueries("up"),
        tableName,
      );

      const columns: Array<string> = persistedColumns(modelType);
      expect(columns.length).toBeGreaterThan(5);

      const addedLater: Set<string> = columnsAddedByLaterMigrations(tableName);

      for (const column of columns) {
        if (addedLater.has(column)) {
          expect({
            tableName,
            column,
            alsoCreatedHere: statement.includes(`"${column}"`),
          }).toEqual({ tableName, column, alsoCreatedHere: false });
          continue;
        }

        expect({
          tableName,
          column,
          created: statement.includes(`"${column}"`),
        }).toEqual({ tableName, column, created: true });
      }

      expect(statement).toContain('"projectId" uuid NOT NULL');
      expect(tableName.length).toBeLessThanOrEqual(63);
    },
  );

  test("stores the queue's identity, liveness and archive bookkeeping", async () => {
    const statement: string = createTableStatement(
      await recordQueries("up"),
      "MessageQueue",
    );

    expect(statement).toContain(
      '"queueIdentifier" character varying(500) NOT NULL',
    );
    expect(statement).toContain(
      '"messagingSystem" character varying(100) NOT NULL',
    );
    expect(statement).toContain(
      '"destinationName" character varying(500) NOT NULL',
    );
    expect(statement).toContain('"brokerScope" character varying(100),');
    expect(statement).toContain('"brokerAddress" character varying(500),');
    expect(statement).toContain('"discoverySource" character varying(100),');
    expect(statement).toContain('"lastSeenAt" TIMESTAMP WITH TIME ZONE,');
    expect(statement).toContain(
      '"brokerMetricsLastSeenAt" TIMESTAMP WITH TIME ZONE,',
    );
    expect(statement).toContain('"autoArchivedAt" TIMESTAMP WITH TIME ZONE');
    expect(statement).toContain(
      '"manuallyRestoredAt" TIMESTAMP WITH TIME ZONE',
    );
    expect(statement).toContain('"automaticAssignments" jsonb');
    expect(statement).toContain('"isArchived" boolean NOT NULL DEFAULT false');
    // No retention, AI, workload or collector columns.
    for (const column of [
      "retainTelemetryDataForDays",
      "telemetryRetentionConfig",
      "otelCollectorStatus",
      "workloadIdentifier",
      "aiRemediationMode",
    ]) {
      expect(statement).not.toContain(`"${column}"`);
    }
  });

  test("a queue identifier and a slug each belong to one live row - named, partial, unique", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(statements).toContain(
      'CREATE UNIQUE INDEX "IDX_message_queue_identifier" ON "MessageQueue" ("projectId", "queueIdentifier") WHERE "deletedAt" IS NULL',
    );
    expect(statements).toContain(
      'CREATE UNIQUE INDEX "IDX_message_queue_slug" ON "MessageQueue" ("slug") WHERE "deletedAt" IS NULL',
    );
  });

  test("the list filters are indexed, and no name is unique", async () => {
    const statements: Array<string> = await recordQueries("up");

    for (const columns of [
      ["projectId", "isArchived"],
      ["projectId", "messagingSystem"],
    ]) {
      expect(statements).toContain(
        `CREATE INDEX "${namingStrategy.indexName("MessageQueue", columns)}" ON "MessageQueue" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) `,
      );
    }

    expect(
      statements.filter((statement: string): boolean => {
        return (
          statement.startsWith("CREATE UNIQUE INDEX") &&
          statement.includes('("name")')
        );
      }),
    ).toEqual([]);
  });

  test.each([
    ["MessageQueueOwnerTeam", "teamId"],
    ["MessageQueueOwnerUser", "userId"],
  ])(
    "%s allows one row per (queue, owner, project)",
    async (tableName: string, ownerColumn: string) => {
      const columns: Array<string> = [
        "messageQueueId",
        ownerColumn,
        "projectId",
      ];

      expect(await recordQueries("up")).toContain(
        `CREATE UNIQUE INDEX "${namingStrategy.indexName(tableName, columns)}" ON "${tableName}" ("messageQueueId", "${ownerColumn}", "projectId") `,
      );
    },
  );

  test.each(MODEL_TABLES)(
    "deletes %s with its project, and keeps it when its author is deleted",
    async (tableName: string) => {
      const statements: Array<string> = await recordQueries("up");

      expect(foreignKeyStatement(statements, tableName, "projectId")).toContain(
        'REFERENCES "Project"("_id") ON DELETE CASCADE',
      );
      expect(
        foreignKeyStatement(statements, tableName, "createdByUserId"),
      ).toContain('REFERENCES "User"("_id") ON DELETE SET NULL');
      expect(
        foreignKeyStatement(statements, tableName, "deletedByUserId"),
      ).toContain('REFERENCES "User"("_id") ON DELETE SET NULL');
    },
  );

  test.each(CHILD_TABLES)(
    "deletes %s with its queue",
    async (tableName: string) => {
      expect(
        foreignKeyStatement(
          await recordQueries("up"),
          tableName,
          "messageQueueId",
        ),
      ).toContain('REFERENCES "MessageQueue"("_id") ON DELETE CASCADE');
    },
  );

  test("keeps a queue when the person who archived it is deleted", async () => {
    expect(
      foreignKeyStatement(
        await recordQueries("up"),
        "MessageQueue",
        "archivedByUserId",
      ),
    ).toContain('REFERENCES "User"("_id") ON DELETE SET NULL');
  });

  test.each(JOIN_TABLES)(
    "creates $tableName, keyed by both sides and cleaned up by both",
    async (spec: JoinTableSpec) => {
      const statements: Array<string> = await recordQueries("up");
      const statement: string = createTableStatement(
        statements,
        spec.tableName,
      );

      expect(statement).toContain(
        `PRIMARY KEY ("${spec.ownerColumn}", "${spec.relatedColumn}")`,
      );
      expect(spec.tableName.length).toBeLessThanOrEqual(63);

      expect(
        foreignKeyStatement(statements, spec.tableName, spec.ownerColumn),
      ).toContain(`REFERENCES "${spec.ownerTable}"("_id") ON DELETE CASCADE`);
      expect(
        foreignKeyStatement(statements, spec.tableName, spec.relatedColumn),
      ).toContain(`REFERENCES "${spec.relatedTable}"("_id") ON DELETE CASCADE`);

      for (const column of [spec.ownerColumn, spec.relatedColumn]) {
        const indexName: string = namingStrategy.indexName(spec.tableName, [
          column,
        ]);

        expect(statements).toContain(
          `CREATE INDEX "${indexName}" ON "${spec.tableName}" ("${column}") `,
        );
      }
    },
  );

  test("every generated constraint carries TypeORM's own name", async () => {
    const statements: Array<string> = await recordQueries("up");
    let foreignKeys: number = 0;

    for (const statement of statements) {
      const foreignKey: RegExpMatchArray | null = statement.match(
        /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \("([^"]+)"\)/,
      );

      if (foreignKey) {
        foreignKeys++;
        expect(foreignKey[2]).toBe(
          namingStrategy.foreignKeyName(foreignKey[1]!, [foreignKey[3]!]),
        );
      }
    }

    // 5 tables x (project, creator, deleter) + archiver + 2 x (team|user, queue) + 6 x 2.
    expect(foreignKeys).toBe(15 + 1 + 4 + 12);
  });

  test("every unnamed index carries TypeORM's own name - only the two partial ones are named by hand", async () => {
    const statements: Array<string> = await recordQueries("up");
    const handNamed: Array<string> = [];

    for (const statement of statements) {
      const index: RegExpMatchArray | null = statement.match(
        /^CREATE (?:UNIQUE )?INDEX "([^"]+)" ON "([^"]+)" \(([^)]+)\)/,
      );

      if (!index) {
        continue;
      }

      const columns: Array<string> = index[3]!
        .split(",")
        .map((column: string): string => {
          return column.trim().replace(/"/g, "");
        });

      if (index[1] !== namingStrategy.indexName(index[2]!, columns)) {
        handNamed.push(index[1]!);
      }
    }

    expect(handNamed.sort()).toEqual([
      "IDX_message_queue_identifier",
      "IDX_message_queue_slug",
    ]);
  });

  test("down() drops every table up() created, dependants first", async () => {
    const down: Array<string> = await recordQueries("down");
    const dropped: Array<string> = down
      .map((statement: string): string | null => {
        const match: RegExpMatchArray | null = statement.match(
          /^DROP TABLE "([^"]+)"$/,
        );
        return match ? match[1]! : null;
      })
      .filter((tableName: string | null): tableName is string => {
        return tableName !== null;
      });

    expect([...dropped].sort()).toEqual([...ALL_TABLES].sort());

    for (const tableName of [...CHILD_TABLES, "MessageQueueLabel"]) {
      expect(dropped.indexOf(tableName)).toBeLessThan(
        dropped.indexOf("MessageQueue"),
      );
    }
  });

  test("down() removes every constraint and index up() added, in reverse", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    const addedConstraints: Array<string> = up
      .map((statement: string): string | null => {
        const match: RegExpMatchArray | null = statement.match(
          /ADD CONSTRAINT "([^"]+)"/,
        );
        return match ? match[1]! : null;
      })
      .filter((name: string | null): name is string => {
        return name !== null;
      });
    const droppedConstraints: Array<string> = down
      .map((statement: string): string | null => {
        const match: RegExpMatchArray | null = statement.match(
          /DROP CONSTRAINT "([^"]+)"/,
        );
        return match ? match[1]! : null;
      })
      .filter((name: string | null): name is string => {
        return name !== null;
      });

    expect(droppedConstraints).toEqual([...addedConstraints].reverse());

    const addedIndexes: Array<string> = up
      .map((statement: string): string | null => {
        const match: RegExpMatchArray | null = statement.match(
          /^CREATE (?:UNIQUE )?INDEX "([^"]+)"/,
        );
        return match ? match[1]! : null;
      })
      .filter((name: string | null): name is string => {
        return name !== null;
      });
    const droppedIndexes: Array<string> = down
      .map((statement: string): string | null => {
        const match: RegExpMatchArray | null = statement.match(
          /^DROP INDEX "public"\."([^"]+)"$/,
        );
        return match ? match[1]! : null;
      })
      .filter((name: string | null): name is string => {
        return name !== null;
      });

    expect([...droppedIndexes].sort()).toEqual([...addedIndexes].sort());
  });
});
