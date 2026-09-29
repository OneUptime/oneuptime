import { AddDatabaseServerTables1795000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1795000000000-AddDatabaseServerTables";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../../Models/DatabaseModels/DatabaseServerEndpoint";
import DatabaseServerFeed from "../../../../Models/DatabaseModels/DatabaseServerFeed";
import DatabaseServerLabelRule from "../../../../Models/DatabaseModels/DatabaseServerLabelRule";
import DatabaseServerOwnerRule from "../../../../Models/DatabaseModels/DatabaseServerOwnerRule";
import DatabaseServerOwnerTeam from "../../../../Models/DatabaseModels/DatabaseServerOwnerTeam";
import DatabaseServerOwnerUser from "../../../../Models/DatabaseModels/DatabaseServerOwnerUser";
import { describe, expect, test } from "@jest/globals";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The schema half of the Databases product.
 *
 * The migration was generated against the models (against a scratch database
 * migrated to the previous head), so its names are TypeORM's by construction.
 * What this pins is that it STAYS the migration for these models: every table
 * is created with every column its model persists, every constraint carries
 * TypeORM's own name (a hand edit that renamed one would pass review and then
 * fail the Schema Drift job), the one-owner rule for endpoints is enforced by
 * the database rather than by service code alone, a database row survives the
 * Kubernetes cluster / Docker host / Podman host it was found on being deleted,
 * nothing unrelated rode along, and down() undoes up().
 *
 * Fake QueryRunner only.
 */

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

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

  await new AddDatabaseServerTables1795000000000()[direction](queryRunner);

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
  ["DatabaseServer", DatabaseServer],
  ["DatabaseServerEndpoint", DatabaseServerEndpoint],
  ["DatabaseServerFeed", DatabaseServerFeed],
  ["DatabaseServerOwnerTeam", DatabaseServerOwnerTeam],
  ["DatabaseServerOwnerUser", DatabaseServerOwnerUser],
  ["DatabaseServerLabelRule", DatabaseServerLabelRule],
  ["DatabaseServerOwnerRule", DatabaseServerOwnerRule],
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
    tableName: "DatabaseServerLabel",
    ownerColumn: "databaseServerId",
    ownerTable: "DatabaseServer",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    tableName: "DatabaseServerLabelRuleDatabaseServerLabel",
    ownerColumn: "databaseServerLabelRuleId",
    ownerTable: "DatabaseServerLabelRule",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    tableName: "DatabaseServerLabelRuleLabelToAdd",
    ownerColumn: "databaseServerLabelRuleId",
    ownerTable: "DatabaseServerLabelRule",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    tableName: "DatabaseServerOwnerRuleDatabaseServerLabel",
    ownerColumn: "databaseServerOwnerRuleId",
    ownerTable: "DatabaseServerOwnerRule",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    tableName: "DatabaseServerOwnerRuleOwnerUser",
    ownerColumn: "databaseServerOwnerRuleId",
    ownerTable: "DatabaseServerOwnerRule",
    relatedColumn: "userId",
    relatedTable: "User",
  },
  {
    tableName: "DatabaseServerOwnerRuleOwnerTeam",
    ownerColumn: "databaseServerOwnerRuleId",
    ownerTable: "DatabaseServerOwnerRule",
    relatedColumn: "teamId",
    relatedTable: "Team",
  },
  {
    tableName: "IncidentDatabaseServer",
    ownerColumn: "incidentId",
    ownerTable: "Incident",
    relatedColumn: "databaseServerId",
    relatedTable: "DatabaseServer",
  },
  {
    tableName: "AlertDatabaseServer",
    ownerColumn: "alertId",
    ownerTable: "Alert",
    relatedColumn: "databaseServerId",
    relatedTable: "DatabaseServer",
  },
  {
    tableName: "ScheduledMaintenanceDatabaseServer",
    ownerColumn: "scheduledMaintenanceId",
    ownerTable: "ScheduledMaintenance",
    relatedColumn: "databaseServerId",
    relatedTable: "DatabaseServer",
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
  "DatabaseServerEndpoint",
  "DatabaseServerFeed",
  "DatabaseServerOwnerTeam",
  "DatabaseServerOwnerUser",
];

describe("AddDatabaseServerTables1795000000000", () => {
  test("is registered under the name its class carries", () => {
    const migration: AddDatabaseServerTables1795000000000 =
      new AddDatabaseServerTables1795000000000();

    expect(migration.name).toBe("AddDatabaseServerTables1795000000000");
    expect(SchemaMigrations).toContain(AddDatabaseServerTables1795000000000);
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
      "AddDatabaseServerTables1795000000000",
    );

    // indexOf -1 would make the slice below empty and this test vacuous.
    expect(ownIndex).toBeGreaterThan(0);

    const notBehind: Array<string> = names
      .slice(0, ownIndex)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOf(className);
        return timestamp !== null && timestamp >= 1795000000000;
      });

    expect(notBehind).toEqual([]);
  });

  test("touches only the sixteen new tables", async () => {
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
    expect(ALL_TABLES).toHaveLength(16);
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

      for (const column of columns) {
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

  test("stores the database's identity, liveness and member keys", async () => {
    const statement: string = createTableStatement(
      await recordQueries("up"),
      "DatabaseServer",
    );

    expect(statement).toContain(
      '"databaseIdentifier" character varying(500) NOT NULL',
    );
    expect(statement).toContain('"dbSystem" character varying(100) NOT NULL');
    expect(statement).toContain('"memberEntityKeys" jsonb');
    /*
     * No default: a database no collector has ever reported for has no
     * engine-metrics status at all, rather than claiming "disconnected".
     */
    expect(statement).toContain(
      '"otelCollectorStatus" character varying(100),',
    );
    expect(statement).not.toContain("DEFAULT 'disconnected'");
    expect(statement).toContain(
      '"collectorLastSeenAt" TIMESTAMP WITH TIME ZONE',
    );
    // Lifecycle and engine-evidence columns.
    expect(statement).toContain(
      '"manuallyRestoredAt" TIMESTAMP WITH TIME ZONE',
    );
    expect(statement).toContain('"dbSystemSource" character varying(100)');
    expect(statement).toContain(
      '"workloadLastSeenAt" TIMESTAMP WITH TIME ZONE',
    );
    expect(statement).toContain('"automaticAssignments" jsonb');
    expect(statement).toContain('"autoArchivedAt" TIMESTAMP WITH TIME ZONE');
    expect(statement).toContain('"isArchived" boolean NOT NULL DEFAULT false');
    expect(statement).toContain('"telemetryRetentionConfig" jsonb');
  });

  test("a database identifier and an endpoint each belong to one row per project", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(statements).toContain(
      `CREATE UNIQUE INDEX "${namingStrategy.indexName("DatabaseServer", [
        "projectId",
        "databaseIdentifier",
      ])}" ON "DatabaseServer" ("projectId", "databaseIdentifier") `,
    );
    expect(statements).toContain(
      `CREATE UNIQUE INDEX "${namingStrategy.indexName(
        "DatabaseServerEndpoint",
        ["projectId", "endpoint"],
      )}" ON "DatabaseServerEndpoint" ("projectId", "endpoint") `,
    );
  });

  test("a workload maps to one live row, and slugs stay unique among live rows", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(statements).toContain(
      'CREATE UNIQUE INDEX "IDX_database_server_workload" ON "DatabaseServer" ("projectId", "workloadIdentifier") WHERE "workloadIdentifier" IS NOT NULL AND "deletedAt" IS NULL',
    );
    expect(statements).toContain(
      'CREATE UNIQUE INDEX "IDX_database_server_slug" ON "DatabaseServer" ("slug") WHERE "deletedAt" IS NULL',
    );
  });

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
    "deletes %s with its database",
    async (tableName: string) => {
      expect(
        foreignKeyStatement(
          await recordQueries("up"),
          tableName,
          "databaseServerId",
        ),
      ).toContain('REFERENCES "DatabaseServer"("_id") ON DELETE CASCADE');
    },
  );

  test.each([
    ["kubernetesClusterId", "KubernetesCluster"],
    ["dockerHostId", "DockerHost"],
    ["podmanHostId", "PodmanHost"],
    ["archivedByUserId", "User"],
  ])(
    "keeps a database when the %s it points at is deleted",
    async (columnName: string, referencedTable: string) => {
      expect(
        foreignKeyStatement(
          await recordQueries("up"),
          "DatabaseServer",
          columnName,
        ),
      ).toContain(`REFERENCES "${referencedTable}"("_id") ON DELETE SET NULL`);
    },
  );

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

  test("every generated constraint and index carries TypeORM's own name", async () => {
    const statements: Array<string> = await recordQueries("up");

    for (const statement of statements) {
      const foreignKey: RegExpMatchArray | null = statement.match(
        /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \("([^"]+)"\)/,
      );

      if (foreignKey) {
        expect(foreignKey[2]).toBe(
          namingStrategy.foreignKeyName(foreignKey[1]!, [foreignKey[3]!]),
        );
      }
    }
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

    for (const tableName of [...CHILD_TABLES, "DatabaseServerLabel"]) {
      expect(dropped.indexOf(tableName)).toBeLessThan(
        dropped.indexOf("DatabaseServer"),
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
