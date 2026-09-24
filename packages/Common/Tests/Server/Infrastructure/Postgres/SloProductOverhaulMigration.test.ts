import { SloProductOverhaul1793100000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1793100000000-SloProductOverhaul";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveFeed from "../../../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import ServiceLevelObjectiveMonitorRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * The schema half of the SLO product overhaul.
 *
 * The migration was generated against the models, so its names are TypeORM's
 * by construction. What this pins is that it STAYS the migration for these
 * models: every table, join table and column the design names is created,
 * every constraint carries TypeORM's own name (a hand edit that renamed one
 * would pass review and then fail the post-deploy Schema Drift job), the
 * delete rules are the ones the product relies on, nothing unrelated rode
 * along, and down() undoes up() exactly, in reverse.
 *
 * Fake QueryRunner only. Applying it to Postgres and re-generating to "No
 * changes in database schema were found" is how it was verified when written.
 */

const MIGRATION_FILE_NAME: string = "1793100000000-SloProductOverhaul.ts";

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
  MIGRATION_FILE_NAME,
);

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

type ModelClass = unknown;

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

  await new SloProductOverhaul1793100000000()[direction](queryRunner);

  return statements;
};

/*
 * Column names a class persists, walking up to DatabaseBaseModel / RuleBaseModel
 * so inherited columns (_id, version, criteria, ...) are included. Read off
 * decorator metadata so a column added to a model without a migration fails.
 */
type PersistedColumnsFunction = (modelType: ModelClass) => Array<string>;

const persistedColumns: PersistedColumnsFunction = (
  modelType: ModelClass,
): Array<string> => {
  const names: Array<string> = [];
  let current: unknown = modelType;

  while (typeof current === "function" && current !== Function.prototype) {
    const target: unknown = current;

    for (const column of getMetadataArgsStorage().columns) {
      if (column.target === target) {
        const columnArgs: ColumnMetadataArgs = column;
        names.push(columnArgs.options.name || columnArgs.propertyName);
      }
    }

    current = Object.getPrototypeOf(current);
  }

  return names;
};

const MIGRATION_TIMESTAMP: number = 1793100000000;

const MIGRATIONS_DIRECTORY: string = path.dirname(MIGRATION_PATH);

/*
 * Columns that a migration registered AFTER this one adds to `tableName`.
 *
 * This migration has shipped, so a column its models gain later arrives in a
 * later migration, never in an edit to the CREATE TABLE here: editing it would
 * do nothing for the databases that already ran it while putting them out of
 * step with fresh ones. So the invariant the column checks below pin is "every
 * column the model persists is created here or added by a later registered
 * migration", which still fails a column that no migration creates at all. The
 * later migration's own test pins that column's definition, and the Schema
 * Drift job owns the end-state schema.
 *
 * "Later" is by the timestamp in the class name, which is what TypeORM sorts
 * by, and only registered migrations count - a file nobody registered never
 * runs. Their source is read rather than run against the fake QueryRunner, so
 * a later data migration that reads rows back cannot break this suite.
 */
type ColumnsAddedLaterFunction = (tableName: string) => Set<string>;

const columnsAddedByLaterMigrations: ColumnsAddedLaterFunction = (
  tableName: string,
): Set<string> => {
  const laterTimestamps: Set<string> = new Set<string>();

  for (const migration of SchemaMigrations as unknown as Array<{
    name: string;
  }>) {
    const timestamp: string | undefined =
      migration.name.match(/(\d{13})$/)?.[1];

    if (timestamp && Number(timestamp) > MIGRATION_TIMESTAMP) {
      laterTimestamps.add(timestamp);
    }
  }

  const addColumn: RegExp = new RegExp(
    `ALTER TABLE "${tableName}" ADD (?:COLUMN )?"([^"]+)"`,
    "g",
  );

  const added: Set<string> = new Set<string>();

  for (const fileName of fs.readdirSync(MIGRATIONS_DIRECTORY)) {
    if (
      !fileName.endsWith(".ts") ||
      !laterTimestamps.has(fileName.split("-")[0]!)
    ) {
      continue;
    }

    const source: string = fs.readFileSync(
      path.join(MIGRATIONS_DIRECTORY, fileName),
      "utf8",
    );

    let match: RegExpExecArray | null = addColumn.exec(source);

    while (match) {
      added.add(match[1]!);
      match = addColumn.exec(source);
    }
  }

  return added;
};

type CreateTableStatementFunction = (
  statements: Array<string>,
  tableName: string,
) => string;

const createTableStatement: CreateTableStatementFunction = (
  statements: Array<string>,
  tableName: string,
): string => {
  const matches: Array<string> = statements.filter(
    (statement: string): boolean => {
      return statement.startsWith(`CREATE TABLE "${tableName}" (`);
    },
  );

  expect(matches).toHaveLength(1);

  return matches[0]!;
};

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

interface JoinTableSpec {
  owner: ModelClass;
  propertyName: string;
  tableName: string;
  ownerColumn: string;
  ownerTable: string;
  relatedColumn: string;
  relatedTable: string;
}

const JOIN_TABLES: Array<JoinTableSpec> = [
  {
    owner: ServiceLevelObjectiveMonitorRule,
    propertyName: "monitorLabels",
    tableName: "ServiceLevelObjectiveMonitorRuleMonitorLabel",
    ownerColumn: "serviceLevelObjectiveMonitorRuleId",
    ownerTable: "ServiceLevelObjectiveMonitorRule",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    owner: ServiceLevelObjectiveBurnRateRule,
    propertyName: "alertLabels",
    tableName: "ServiceLevelObjectiveBurnRateRuleAlertLabel",
    ownerColumn: "serviceLevelObjectiveBurnRateRuleId",
    ownerTable: "ServiceLevelObjectiveBurnRateRule",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    owner: ServiceLevelObjectiveBurnRateRule,
    propertyName: "alertOwnerTeams",
    tableName: "ServiceLevelObjectiveBurnRateRuleAlertOwnerTeam",
    ownerColumn: "serviceLevelObjectiveBurnRateRuleId",
    ownerTable: "ServiceLevelObjectiveBurnRateRule",
    relatedColumn: "teamId",
    relatedTable: "Team",
  },
  {
    owner: ServiceLevelObjectiveBurnRateRule,
    propertyName: "alertOwnerUsers",
    tableName: "ServiceLevelObjectiveBurnRateRuleAlertOwnerUser",
    ownerColumn: "serviceLevelObjectiveBurnRateRuleId",
    ownerTable: "ServiceLevelObjectiveBurnRateRule",
    relatedColumn: "userId",
    relatedTable: "User",
  },
  {
    owner: ServiceLevelObjectiveBurnRateRule,
    propertyName: "incidentLabels",
    tableName: "ServiceLevelObjectiveBurnRateRuleIncidentLabel",
    ownerColumn: "serviceLevelObjectiveBurnRateRuleId",
    ownerTable: "ServiceLevelObjectiveBurnRateRule",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    owner: ServiceLevelObjectiveBurnRateRule,
    propertyName: "incidentOwnerTeams",
    tableName: "ServiceLevelObjectiveBurnRateRuleIncidentOwnerTeam",
    ownerColumn: "serviceLevelObjectiveBurnRateRuleId",
    ownerTable: "ServiceLevelObjectiveBurnRateRule",
    relatedColumn: "teamId",
    relatedTable: "Team",
  },
  {
    owner: ServiceLevelObjectiveBurnRateRule,
    propertyName: "incidentOwnerUsers",
    tableName: "ServiceLevelObjectiveBurnRateRuleIncidentOwnerUser",
    ownerColumn: "serviceLevelObjectiveBurnRateRuleId",
    ownerTable: "ServiceLevelObjectiveBurnRateRule",
    relatedColumn: "userId",
    relatedTable: "User",
  },
  {
    owner: Incident,
    propertyName: "serviceLevelObjectives",
    tableName: "IncidentServiceLevelObjective",
    ownerColumn: "incidentId",
    ownerTable: "Incident",
    relatedColumn: "serviceLevelObjectiveId",
    relatedTable: "ServiceLevelObjective",
  },
  {
    owner: Alert,
    propertyName: "serviceLevelObjectives",
    tableName: "AlertServiceLevelObjective",
    ownerColumn: "alertId",
    ownerTable: "Alert",
    relatedColumn: "serviceLevelObjectiveId",
    relatedTable: "ServiceLevelObjective",
  },
];

const NEW_ENTITY_TABLES: Array<string> = [
  "ServiceLevelObjectiveMonitorRule",
  "ServiceLevelObjectiveFeed",
];

const ALTERED_EXISTING_TABLES: Array<string> = [
  "ServiceLevelObjective",
  "ServiceLevelObjectiveBurnRateRule",
];

const BURN_RATE_RULE_COLUMNS: Array<[string, string]> = [
  ["alertTitleTemplate", "character varying(500)"],
  ["alertDescriptionTemplate", "text"],
  ["alertRemediationNotes", "text"],
  ["isAlertPrivate", "boolean NOT NULL DEFAULT false"],
  ["autoResolveAlert", "boolean NOT NULL DEFAULT true"],
  ["incidentTitleTemplate", "character varying(500)"],
  ["incidentDescriptionTemplate", "text"],
  ["incidentRemediationNotes", "text"],
  ["isIncidentPrivate", "boolean NOT NULL DEFAULT false"],
  ["autoResolveIncident", "boolean NOT NULL DEFAULT true"],
  ["addSloOwnersAsOwners", "boolean NOT NULL DEFAULT false"],
];

describe("SloProductOverhaul migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(source).toContain(
      "export class SloProductOverhaul1793100000000 implements MigrationInterface",
    );
    expect(source).toContain(
      'public name: string = "SloProductOverhaul1793100000000";',
    );
    expect(new SloProductOverhaul1793100000000().name).toBe(
      "SloProductOverhaul1793100000000",
    );
  });

  test("is registered, so a fresh database actually gets these tables", () => {
    const names: Array<string> = (
      SchemaMigrations as unknown as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    expect(names).toContain("SloProductOverhaul1793100000000");
    /*
     * Renumbered from 1792900000000 when master shipped two NetworkDevice
     * migrations on 1792900000000 / 1793000000000 first: it must follow the
     * newest migration that was already registered when it merged.
     */
    expect(names.indexOf("SloProductOverhaul1793100000000")).toBeGreaterThan(
      names.indexOf(
        "AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000",
      ),
    );
    expect(
      names.indexOf(
        "AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000",
      ),
    ).toBeGreaterThanOrEqual(0);
  });

  test("the wall-clock file typeorm generated was not left behind", () => {
    const leftovers: Array<string> = fs
      .readdirSync(path.dirname(MIGRATION_PATH))
      .filter((fileName: string): boolean => {
        return (
          fileName.endsWith("-SloProductOverhaul.ts") &&
          fileName !== MIGRATION_FILE_NAME
        );
      });

    expect(leftovers).toEqual([]);
  });
});

describe("SloProductOverhaul migration - scope", () => {
  test("creates exactly the tables of this overhaul and nothing else", async () => {
    const created: Array<string> = (await recordQueries("up"))
      .map((statement: string): string | undefined => {
        return statement.match(/^CREATE TABLE "([^"]+)"/)?.[1];
      })
      .filter((tableName: string | undefined): tableName is string => {
        return Boolean(tableName);
      })
      .sort();

    expect(created).toEqual(
      [
        ...NEW_ENTITY_TABLES,
        ...JOIN_TABLES.map((spec: JoinTableSpec): string => {
          return spec.tableName;
        }),
      ].sort(),
    );
  });

  test("alters, indexes and constrains no table outside the overhaul", async () => {
    /*
     * A generated migration also sweeps up any unrelated drift between the
     * models and the database it ran against. That drift belongs to its own
     * change, not hidden inside this one.
     */
    const allowed: Set<string> = new Set([
      ...NEW_ENTITY_TABLES,
      ...ALTERED_EXISTING_TABLES,
      ...JOIN_TABLES.map((spec: JoinTableSpec): string => {
        return spec.tableName;
      }),
    ]);

    for (const statement of await recordQueries("up")) {
      const touched: string | undefined =
        statement.match(/^ALTER TABLE "([^"]+)"/)?.[1] ||
        statement.match(
          /^CREATE (?:UNIQUE )?INDEX "[^"]+" ON "([^"]+)"/,
        )?.[1] ||
        statement.match(/^CREATE TABLE "([^"]+)"/)?.[1];

      expect({
        statement,
        allowed: touched ? allowed.has(touched) : false,
      }).toEqual({ statement, allowed: true });
    }
  });

  test("up() never drops anything", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).not.toMatch(/\bDROP\b/);
    }
  });

  test("leaves the deprecated SLO label list and its data alone", async () => {
    const statements: Array<string> = [
      ...(await recordQueries("up")),
      ...(await recordQueries("down")),
    ];

    for (const statement of statements) {
      expect(statement).not.toContain('"ServiceLevelObjectiveMonitorLabel"');
    }
  });
});

describe("SloProductOverhaul migration - ServiceLevelObjectiveMonitorRule", () => {
  test("creates every column the model persists, criteria included, bar those a later migration adds", async () => {
    const statement: string = createTableStatement(
      await recordQueries("up"),
      "ServiceLevelObjectiveMonitorRule",
    );

    const columns: Array<string> = persistedColumns(
      ServiceLevelObjectiveMonitorRule,
    );

    expect(columns).toContain("criteria");
    expect(columns).toContain("monitorNamePattern");

    const addedLater: Set<string> = columnsAddedByLaterMigrations(
      "ServiceLevelObjectiveMonitorRule",
    );

    for (const column of columns) {
      expect({
        column,
        created: statement.includes(`"${column}"`) || addedLater.has(column),
      }).toEqual({
        column,
        created: true,
      });
    }
  });

  test("isEnabled is NOT NULL DEFAULT true and version is required", async () => {
    const statement: string = createTableStatement(
      await recordQueries("up"),
      "ServiceLevelObjectiveMonitorRule",
    );

    expect(statement).toContain('"isEnabled" boolean NOT NULL DEFAULT true');
    expect(statement).toContain('"version" integer NOT NULL');
    expect(statement).toContain('"criteria" jsonb');
    expect(statement).toContain('"serviceLevelObjectiveId" uuid NOT NULL');
  });

  test.each(["projectId", "serviceLevelObjectiveId", "name", "isEnabled"])(
    "indexes %s under TypeORM's name",
    async (column: string) => {
      const indexName: string = namingStrategy.indexName(
        "ServiceLevelObjectiveMonitorRule",
        [column],
      );

      expect(await recordQueries("up")).toContain(
        `CREATE INDEX "${indexName}" ON "ServiceLevelObjectiveMonitorRule" ("${column}") `,
      );
    },
  );

  test.each([
    ["projectId", "Project", "CASCADE"],
    ["serviceLevelObjectiveId", "ServiceLevelObjective", "CASCADE"],
    ["createdByUserId", "User", "SET NULL"],
    ["deletedByUserId", "User", "SET NULL"],
  ])(
    "%s references %s ON DELETE %s",
    async (column: string, referenced: string, onDelete: string) => {
      expect(
        foreignKeyStatement(
          await recordQueries("up"),
          "ServiceLevelObjectiveMonitorRule",
          column,
        ),
      ).toContain(
        `REFERENCES "${referenced}"("_id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
      );
    },
  );
});

describe("SloProductOverhaul migration - ServiceLevelObjectiveFeed", () => {
  test("creates every column the model persists, bar those a later migration adds", async () => {
    const statement: string = createTableStatement(
      await recordQueries("up"),
      "ServiceLevelObjectiveFeed",
    );

    const addedLater: Set<string> = columnsAddedByLaterMigrations(
      "ServiceLevelObjectiveFeed",
    );

    for (const column of persistedColumns(ServiceLevelObjectiveFeed)) {
      expect({
        column,
        created: statement.includes(`"${column}"`) || addedLater.has(column),
      }).toEqual({
        column,
        created: true,
      });
    }

    expect(statement).toContain(
      '"serviceLevelObjectiveFeedEventType" character varying',
    );
    expect(statement).toContain('"feedInfoInMarkdown" text NOT NULL');
  });

  test("indexes the feed page query (serviceLevelObjectiveId, postedAt)", async () => {
    const indexName: string = namingStrategy.indexName(
      "ServiceLevelObjectiveFeed",
      ["serviceLevelObjectiveId", "postedAt"],
    );

    expect(await recordQueries("up")).toContain(
      `CREATE INDEX "${indexName}" ON "ServiceLevelObjectiveFeed" ("serviceLevelObjectiveId", "postedAt") `,
    );
  });

  test.each([
    ["projectId", "Project", "CASCADE"],
    ["serviceLevelObjectiveId", "ServiceLevelObjective", "CASCADE"],
    ["createdByUserId", "User", "SET NULL"],
    ["deletedByUserId", "User", "SET NULL"],
    ["userId", "User", "SET NULL"],
  ])(
    "%s references %s ON DELETE %s",
    async (column: string, referenced: string, onDelete: string) => {
      expect(
        foreignKeyStatement(
          await recordQueries("up"),
          "ServiceLevelObjectiveFeed",
          column,
        ),
      ).toContain(
        `REFERENCES "${referenced}"("_id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
      );
    },
  );
});

describe("SloProductOverhaul migration - join tables", () => {
  test.each(JOIN_TABLES)(
    "$tableName matches the model's @JoinTable declaration",
    (spec: JoinTableSpec) => {
      const declared: JoinTableMetadataArgs | undefined =
        getMetadataArgsStorage().joinTables.find(
          (joinTable: JoinTableMetadataArgs): boolean => {
            return (
              joinTable.target === spec.owner &&
              joinTable.propertyName === spec.propertyName
            );
          },
        );

      expect(declared?.name).toBe(spec.tableName);
      expect(declared?.joinColumns?.[0]?.name).toBe(spec.ownerColumn);
      expect(declared?.inverseJoinColumns?.[0]?.name).toBe(spec.relatedColumn);
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
    "$tableName indexes both sides",
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
    "$tableName cascades from BOTH sides, so deleting either end removes the link",
    async (spec: JoinTableSpec) => {
      /*
       * Deleting a label, team or user must drop it out of a rule rather than
       * block the delete - and deleting an SLO must drop it from the alerts
       * and incidents that referenced it.
       */
      const statements: Array<string> = await recordQueries("up");

      expect(
        foreignKeyStatement(statements, spec.tableName, spec.ownerColumn),
      ).toContain(
        `REFERENCES "${spec.ownerTable}"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
      );
      expect(
        foreignKeyStatement(statements, spec.tableName, spec.relatedColumn),
      ).toContain(
        `REFERENCES "${spec.relatedTable}"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
      );
    },
  );
});

describe("SloProductOverhaul migration - ServiceLevelObjective archive", () => {
  test("adds the three archive columns, isArchived NOT NULL DEFAULT false", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(statements).toContain(
      'ALTER TABLE "ServiceLevelObjective" ADD "isArchived" boolean NOT NULL DEFAULT false',
    );
    expect(statements).toContain(
      'ALTER TABLE "ServiceLevelObjective" ADD "archivedAt" TIMESTAMP WITH TIME ZONE',
    );
    expect(statements).toContain(
      'ALTER TABLE "ServiceLevelObjective" ADD "archivedByUserId" uuid',
    );
  });

  test("the model persists every column the migration adds to it", async () => {
    const columns: Array<string> = persistedColumns(ServiceLevelObjective);

    for (const statement of await recordQueries("up")) {
      const added: string | undefined = statement.match(
        /^ALTER TABLE "ServiceLevelObjective" ADD "([^"]+)"/,
      )?.[1];

      if (added) {
        expect(columns).toContain(added);
      }
    }
  });

  test("the (projectId, isArchived) index carries TypeORM's name", async () => {
    const indexName: string = namingStrategy.indexName(
      "ServiceLevelObjective",
      ["projectId", "isArchived"],
    );

    expect(indexName).toBe("IDX_bdf8df0961417c55c4e3e60e18");
    expect(await recordQueries("up")).toContain(
      `CREATE INDEX "${indexName}" ON "ServiceLevelObjective" ("projectId", "isArchived") `,
    );
  });

  test("archivedByUserId is SET NULL, so deleting a user never deletes an SLO", async () => {
    expect(
      foreignKeyStatement(
        await recordQueries("up"),
        "ServiceLevelObjective",
        "archivedByUserId",
      ),
    ).toContain(
      'REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
  });
});

describe("SloProductOverhaul migration - ServiceLevelObjectiveBurnRateRule options", () => {
  test.each(BURN_RATE_RULE_COLUMNS)(
    "adds %s as %s",
    async (column: string, definition: string) => {
      expect(await recordQueries("up")).toContain(
        `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "${column}" ${definition}`,
      );
    },
  );

  test("adds no other column to the burn rate rule", async () => {
    const added: Array<string> = (await recordQueries("up"))
      .map((statement: string): string | undefined => {
        return statement.match(
          /^ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "([^"]+)"/,
        )?.[1];
      })
      .filter((column: string | undefined): column is string => {
        return Boolean(column);
      })
      .sort();

    expect(added).toEqual(
      BURN_RATE_RULE_COLUMNS.map(([column]: [string, string]): string => {
        return column;
      }).sort(),
    );
  });

  test("the model persists every column the migration adds to it", () => {
    const columns: Array<string> = persistedColumns(
      ServiceLevelObjectiveBurnRateRule,
    );

    for (const [column] of BURN_RATE_RULE_COLUMNS) {
      expect(columns).toContain(column);
    }
  });
});

describe("SloProductOverhaul migration - down()", () => {
  /*
   * Maps a statement to the object it creates (up) or destroys (down), so the
   * two directions can be compared as sequences.
   */
  type ObjectKeyFunction = (statement: string) => string;

  const upKey: ObjectKeyFunction = (statement: string): string => {
    const createTable: string | undefined = statement.match(
      /^CREATE TABLE "([^"]+)"/,
    )?.[1];
    if (createTable) {
      return `table:${createTable}`;
    }

    const createIndex: string | undefined = statement.match(
      /^CREATE INDEX "([^"]+)"/,
    )?.[1];
    if (createIndex) {
      return `index:${createIndex}`;
    }

    const addConstraint: string | undefined = statement.match(
      /^ALTER TABLE "[^"]+" ADD CONSTRAINT "([^"]+)"/,
    )?.[1];
    if (addConstraint) {
      return `constraint:${addConstraint}`;
    }

    const addColumn: RegExpMatchArray | null = statement.match(
      /^ALTER TABLE "([^"]+)" ADD "([^"]+)"/,
    );
    if (addColumn) {
      return `column:${addColumn[1]}.${addColumn[2]}`;
    }

    throw new Error(`Unrecognised up() statement: ${statement}`);
  };

  const downKey: ObjectKeyFunction = (statement: string): string => {
    const dropTable: string | undefined = statement.match(
      /^DROP TABLE "([^"]+)"$/,
    )?.[1];
    if (dropTable) {
      return `table:${dropTable}`;
    }

    const dropIndex: string | undefined = statement.match(
      /^DROP INDEX "public"\."([^"]+)"$/,
    )?.[1];
    if (dropIndex) {
      return `index:${dropIndex}`;
    }

    const dropConstraint: string | undefined = statement.match(
      /^ALTER TABLE "[^"]+" DROP CONSTRAINT "([^"]+)"$/,
    )?.[1];
    if (dropConstraint) {
      return `constraint:${dropConstraint}`;
    }

    const dropColumn: RegExpMatchArray | null = statement.match(
      /^ALTER TABLE "([^"]+)" DROP COLUMN "([^"]+)"$/,
    );
    if (dropColumn) {
      return `column:${dropColumn[1]}.${dropColumn[2]}`;
    }

    throw new Error(`Unrecognised down() statement: ${statement}`);
  };

  test("undoes every object up() creates, in exactly the reverse order", async () => {
    const upKeys: Array<string> = (await recordQueries("up")).map(upKey);
    const downKeys: Array<string> = (await recordQueries("down")).map(downKey);

    expect(downKeys).toEqual([...upKeys].reverse());
  });

  test("drops every foreign key before any table it points at", async () => {
    const statements: Array<string> = await recordQueries("down");

    const lastConstraintDrop: number = statements.reduce(
      (last: number, statement: string, index: number): number => {
        return statement.includes(" DROP CONSTRAINT ") ? index : last;
      },
      -1,
    );
    const firstTableDrop: number = statements.findIndex(
      (statement: string): boolean => {
        return statement.startsWith("DROP TABLE ");
      },
    );

    expect(lastConstraintDrop).toBeGreaterThanOrEqual(0);
    expect(firstTableDrop).toBeGreaterThan(lastConstraintDrop);
  });

  test("drops the join tables before the rule table they reference", async () => {
    const statements: Array<string> = await recordQueries("down");

    expect(
      statements.indexOf(
        'DROP TABLE "ServiceLevelObjectiveMonitorRuleMonitorLabel"',
      ),
    ).toBeLessThan(
      statements.indexOf('DROP TABLE "ServiceLevelObjectiveMonitorRule"'),
    );
  });

  test("never drops an existing table", async () => {
    for (const table of [
      ...ALTERED_EXISTING_TABLES,
      "Incident",
      "Alert",
      "ServiceLevelObjectiveMonitorLabel",
    ]) {
      expect(await recordQueries("down")).not.toContain(
        `DROP TABLE "${table}"`,
      );
    }
  });
});
