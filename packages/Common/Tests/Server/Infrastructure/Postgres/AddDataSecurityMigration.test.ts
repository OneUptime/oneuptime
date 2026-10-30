import { AddDataSecurity1808500000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808500000000-AddDataSecurity";
import { AddSecurityHunts1808450000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808450000000-AddSecurityHunts";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityCheckSetting from "../../../../Models/DatabaseModels/DataSecurityCheckSetting";
import DataSecurityCustomDataType from "../../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityFlow from "../../../../Models/DatabaseModels/DataSecurityFlow";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueFeed from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataSecurityResidencyRule from "../../../../Models/DatabaseModels/DataSecurityResidencyRule";
import DataSecurityScan from "../../../../Models/DatabaseModels/DataSecurityScan";
import DataSecuritySetting from "../../../../Models/DatabaseModels/DataSecuritySetting";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../../Models/DatabaseModels/DataStoreAccess";
import DataStoreFeed from "../../../../Models/DatabaseModels/DataStoreFeed";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import DataStoreLabelRule from "../../../../Models/DatabaseModels/DataStoreLabelRule";
import DataStoreOwnerRule from "../../../../Models/DatabaseModels/DataStoreOwnerRule";
import DataStoreOwnerTeam from "../../../../Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "../../../../Models/DatabaseModels/DataStoreOwnerUser";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../../Types/Database/TableColumn";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind Data Security: sixteen tables, one per model, and
 * the six join tables of a data store's labels and of the owner and label
 * rules' labels, users and teams. Every index and key it builds is on a
 * table it creates in the same transaction, so each is built on no rows
 * (SchemaMigrationsOnlineDdl leaves a table created in the same migration
 * alone), and it alters no table that exists. Statements are recorded
 * against a fake QueryRunner; the schema drift check runs the migration on
 * Postgres against the models.
 */

type MigrationClass = new () => MigrationInterface;
type ModelClass = new () => BaseModel;

const MIGRATION_NAME: string = "AddDataSecurity1808500000000";
const MIGRATIONS_FOLDER: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;
// A column of a CREATE TABLE: its quoted name, then its type.
const CREATED_COLUMN: RegExp = /(?:\(|, )"([A-Za-z_]+)" [A-Za-z]/g;
const CREATE_TABLE: RegExp = /^CREATE TABLE "([A-Za-z]+)"/;
const DROP_TABLE: RegExp = /^DROP TABLE "([A-Za-z]+)"$/;
const ALTERED_TABLE: RegExp = /^ALTER TABLE "([A-Za-z]+)"/;
const INDEXED_TABLE: RegExp =
  /^CREATE (?:UNIQUE )?INDEX "[A-Za-z0-9_]+" ON "([A-Za-z]+)"/;
const ADD_CONSTRAINT: RegExp = /ADD CONSTRAINT "([A-Za-z0-9_]+)"/;
const DROP_CONSTRAINT: RegExp = /DROP CONSTRAINT "([A-Za-z0-9_]+)"$/;
const CREATE_INDEX: RegExp = /^CREATE (?:UNIQUE )?INDEX "([A-Za-z0-9_]+)"/;
const DROP_INDEX: RegExp = /^DROP INDEX "public"\."([A-Za-z0-9_]+)"$/;
const ROW_STATEMENT: RegExp = /^\s*(UPDATE|INSERT|DELETE|SELECT)\b/i;
// A foreign key: the table, the column, the table it names and what a delete there does.
const FOREIGN_KEY: RegExp =
  /^ALTER TABLE "([A-Za-z]+)" ADD CONSTRAINT "[A-Za-z0-9_]+" FOREIGN KEY \("([A-Za-z]+)"\) REFERENCES "([A-Za-z]+)"\("_id"\) ON DELETE (CASCADE|SET NULL|NO ACTION|RESTRICT) ON UPDATE NO ACTION$/;
const JOIN_TABLE_FOREIGN_KEY: RegExp =
  /^ALTER TABLE "([A-Za-z]+)" ADD CONSTRAINT "[A-Za-z0-9_]+" FOREIGN KEY \("([A-Za-z]+)"\) REFERENCES "([A-Za-z]+)"\("_id"\) ON DELETE (CASCADE|SET NULL|NO ACTION|RESTRICT) ON UPDATE CASCADE$/;
const UNIQUE_INDEX: RegExp =
  /^CREATE UNIQUE INDEX "[A-Za-z0-9_]+" ON "([A-Za-z]+)" \(([^)]+)\) $/;

// Each model's table, in the order the migration creates them.
const MODEL_TABLES: ReadonlyArray<[string, ModelClass]> = [
  ["DataStore", DataStore],
  ["DataSecurityScan", DataSecurityScan],
  ["DataStoreFinding", DataStoreFinding],
  ["DataStoreAccess", DataStoreAccess],
  ["DataStoreFeed", DataStoreFeed],
  ["DataStoreOwnerUser", DataStoreOwnerUser],
  ["DataStoreOwnerTeam", DataStoreOwnerTeam],
  ["DataStoreOwnerRule", DataStoreOwnerRule],
  ["DataStoreLabelRule", DataStoreLabelRule],
  ["DataSecurityFlow", DataSecurityFlow],
  ["DataSecurityIssue", DataSecurityIssue],
  ["DataSecurityIssueFeed", DataSecurityIssueFeed],
  ["DataSecurityCustomDataType", DataSecurityCustomDataType],
  ["DataSecurityCheckSetting", DataSecurityCheckSetting],
  ["DataSecurityResidencyRule", DataSecurityResidencyRule],
  ["DataSecuritySetting", DataSecuritySetting],
];

// The many-to-many tables: the owning row's id, then the other side's.
const JOIN_TABLES: ReadonlyArray<[string, string, string, string]> = [
  ["DataStoreLabel", "dataStoreId", "labelId", "Label"],
  ["DataStoreOwnerRuleMatchLabel", "dataStoreOwnerRuleId", "labelId", "Label"],
  ["DataStoreOwnerRuleUser", "dataStoreOwnerRuleId", "userId", "User"],
  ["DataStoreOwnerRuleTeam", "dataStoreOwnerRuleId", "teamId", "Team"],
  ["DataStoreLabelRuleMatchLabel", "dataStoreLabelRuleId", "labelId", "Label"],
  ["DataStoreLabelRuleAddLabel", "dataStoreLabelRuleId", "labelId", "Label"],
];

const NEW_TABLES: ReadonlyArray<string> = [
  ...MODEL_TABLES.map((entry: [string, ModelClass]): string => {
    return entry[0];
  }),
  ...JOIN_TABLES.map((entry: [string, string, string, string]): string => {
    return entry[0];
  }),
];

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];
  const runner: QueryRunner = {
    isTransactionActive: true,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: AddDataSecurity1808500000000 =
    new AddDataSecurity1808500000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

function timestampOf(migration: MigrationClass): number {
  const match: RegExpMatchArray | null =
    migration.name.match(TRAILING_TIMESTAMP);

  return match ? parseInt(match[1]!, 10) : 0;
}

// What each statement names, by the pattern that finds it.
function named(steps: Array<string>, pattern: RegExp): Array<string> {
  return steps.flatMap((step: string): Array<string> => {
    const match: RegExpMatchArray | null = step.match(pattern);

    return match ? [match[1]!] : [];
  });
}

function createStatement(steps: Array<string>, table: string): string {
  const statements: Array<string> = steps.filter((step: string): boolean => {
    return step.startsWith(`CREATE TABLE "${table}" (`);
  });

  expect(statements).toHaveLength(1);

  return statements[0]!;
}

function columnsCreated(statement: string): Array<string> {
  return Array.from(statement.matchAll(CREATED_COLUMN))
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .sort();
}

// The columns a model keeps in its own table: its own and the base model's, never a relation.
function storedColumns(model: BaseModel): Array<string> {
  return Object.keys(getTableColumns(model))
    .filter((column: string): boolean => {
      return !model.isEntityColumn(column);
    })
    .concat(["createdAt", "updatedAt", "deletedAt", "version"])
    .filter((column: string, index: number, all: Array<string>): boolean => {
      return all.indexOf(column) === index;
    })
    .sort();
}

type ForeignKey = {
  table: string;
  column: string;
  references: string;
  onDelete: string;
};

function foreignKeys(steps: Array<string>, pattern: RegExp): Array<ForeignKey> {
  return steps.flatMap((step: string): Array<ForeignKey> => {
    const match: RegExpMatchArray | null = step.match(pattern);

    return match
      ? [
          {
            table: match[1]!,
            column: match[2]!,
            references: match[3]!,
            onDelete: match[4]!,
          },
        ]
      : [];
  });
}

describe("the Data Security migration", () => {
  test("names itself after its timestamp", () => {
    expect(new AddDataSecurity1808500000000().name).toBe(MIGRATION_NAME);
  });

  test("is registered once, after AddSecurityHunts, above every migration before it", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(AddDataSecurity1808500000000);

    expect(
      registered.filter((candidate: MigrationClass): boolean => {
        return candidate === AddDataSecurity1808500000000;
      }),
    ).toHaveLength(1);
    expect(at).toBeGreaterThan(
      registered.indexOf(AddSecurityHunts1808450000000),
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddDataSecurity1808500000000),
      );
    }
  });

  test("is backed by exactly one file", () => {
    expect(
      fs.readdirSync(MIGRATIONS_FOLDER).filter((file: string): boolean => {
        return file.startsWith(`${timestampOf(AddDataSecurity1808500000000)}-`);
      }),
    ).toEqual(["1808500000000-AddDataSecurity.ts"]);
  });

  test("runs inside the migration's transaction: everything it builds is on a new, empty table", () => {
    expect(
      (new AddDataSecurity1808500000000() as { transaction?: boolean })
        .transaction,
    ).toBeUndefined();
  });

  test("creates the sixteen model tables and the six join tables, each once", async () => {
    expect(named(await record("up"), CREATE_TABLE)).toEqual(NEW_TABLES);
  });

  test.each(MODEL_TABLES)(
    "creates %s with every column its model stores, and the base model's own",
    async (table: string, Model: ModelClass) => {
      const statement: string = createStatement(await record("up"), table);

      expect(columnsCreated(statement)).toEqual(storedColumns(new Model()));
      expect(statement).toContain(
        `"_id" uuid NOT NULL DEFAULT uuid_generate_v4()`,
      );
      expect(statement).toContain(`"projectId" uuid NOT NULL`);
      expect(statement).toContain(`"version" integer NOT NULL`);
    },
  );

  test.each(JOIN_TABLES)(
    "creates the join table %s of two ids, keyed by both",
    async (table: string, owner: string, other: string) => {
      const statement: string = createStatement(await record("up"), table);

      expect(columnsCreated(statement)).toEqual([owner, other].sort());
      expect(statement).toContain(`"${owner}" uuid NOT NULL`);
      expect(statement).toContain(`"${other}" uuid NOT NULL`);
      expect(statement).toContain(`PRIMARY KEY ("${owner}", "${other}")`);
    },
  );

  test("keeps the connection string a text column the model encrypts and never returns", async () => {
    const statement: string = createStatement(await record("up"), "DataStore");
    const column: TableColumnMetadata | undefined = getTableColumns(
      new DataStore(),
    )["connectionString"];

    expect(statement).toContain(`"connectionString" text,`);
    expect(column).toBeDefined();
    expect(column!.encrypted).toBe(true);
  });

  test("starts a store unclassified and quiet: public, its exposure unknown, no findings, no issues, no risk", async () => {
    const statement: string = createStatement(await record("up"), "DataStore");

    expect(statement).toContain(
      `"sensitivity" character varying(100) NOT NULL DEFAULT 'Public'`,
    );
    expect(statement).toContain(
      `"exposure" character varying(100) NOT NULL DEFAULT 'Unknown'`,
    );
    expect(statement).toContain(`"findingCount" integer NOT NULL DEFAULT '0'`);
    expect(statement).toContain(
      `"openIssueCount" integer NOT NULL DEFAULT '0'`,
    );
    expect(statement).toContain(`"riskScore" integer NOT NULL DEFAULT '0'`);
    expect(statement).toContain(
      `"isPublicByDesign" boolean NOT NULL DEFAULT false`,
    );
    expect(statement).toContain(`"isArchived" boolean NOT NULL DEFAULT false`);
  });

  test("keeps one row per natural key: a store per project and store key, and each project's one settings row", async () => {
    const unique: Array<string> = (await record("up")).flatMap(
      (step: string): Array<string> => {
        const match: RegExpMatchArray | null = step.match(UNIQUE_INDEX);

        return match ? [`${match[1]} (${match[2]})`] : [];
      },
    );

    expect(unique.sort()).toEqual(
      [
        `DataStore ("projectId", "storeKey")`,
        `DataStoreFinding ("dataStoreId", "findingKey")`,
        `DataStoreAccess ("dataStoreId", "accessKey")`,
        `DataStoreOwnerUser ("dataStoreId", "userId", "projectId")`,
        `DataStoreOwnerTeam ("dataStoreId", "teamId", "projectId")`,
        `DataSecurityFlow ("projectId", "flowKey")`,
        `DataSecurityIssue ("projectId", "issueKey")`,
        `DataSecurityCustomDataType ("projectId", "name")`,
        `DataSecurityCheckSetting ("projectId", "checkId")`,
        `DataSecurityResidencyRule ("projectId", "name")`,
        `DataSecuritySetting ("projectId")`,
      ].sort(),
    );
  });

  test("indexes and keys only the tables it creates, and alters no table that exists", async () => {
    const steps: Array<string> = await record("up");

    for (const table of [
      ...named(steps, ALTERED_TABLE),
      ...named(steps, INDEXED_TABLE),
    ]) {
      expect(NEW_TABLES).toContain(table);
    }

    for (const step of steps) {
      const statementKind: string = step.split(" ").slice(0, 2).join(" ");

      expect([
        "CREATE TABLE",
        "CREATE INDEX",
        "CREATE UNIQUE",
        "ALTER TABLE",
      ]).toContain(statementKind);
    }
  });

  test("every project key cascades, so deleting a project takes its Data Security rows with it", async () => {
    const keys: Array<ForeignKey> = foreignKeys(
      await record("up"),
      FOREIGN_KEY,
    );

    for (const [table] of MODEL_TABLES) {
      expect(
        keys.filter((key: ForeignKey): boolean => {
          return key.table === table && key.column === "projectId";
        }),
      ).toEqual([
        {
          table: table,
          column: "projectId",
          references: "Project",
          onDelete: "CASCADE",
        },
      ]);
    }
  });

  test("what is found on a store goes with the store; history keeps a deleted person as nobody", async () => {
    const keys: Array<ForeignKey> = foreignKeys(
      await record("up"),
      FOREIGN_KEY,
    );
    const onDeleteOf: (table: string, column: string) => string | undefined = (
      table: string,
      column: string,
    ): string | undefined => {
      return keys.find((key: ForeignKey): boolean => {
        return key.table === table && key.column === column;
      })?.onDelete;
    };

    for (const table of [
      "DataSecurityScan",
      "DataStoreFinding",
      "DataStoreAccess",
      "DataStoreFeed",
      "DataStoreOwnerUser",
      "DataStoreOwnerTeam",
      "DataSecurityIssue",
    ]) {
      expect(onDeleteOf(table, "dataStoreId")).toBe("CASCADE");
    }

    expect(onDeleteOf("DataSecurityFlow", "sourceDataStoreId")).toBe("CASCADE");
    expect(onDeleteOf("DataSecurityFlow", "destinationDataStoreId")).toBe(
      "CASCADE",
    );
    expect(onDeleteOf("DataSecurityIssueFeed", "dataSecurityIssueId")).toBe(
      "CASCADE",
    );

    // An owner who is deleted stops owning; a row they wrote or decided stays, by nobody.
    expect(onDeleteOf("DataStoreOwnerUser", "userId")).toBe("CASCADE");
    expect(onDeleteOf("DataStoreOwnerTeam", "teamId")).toBe("CASCADE");
    expect(onDeleteOf("DataSecurityIssue", "acceptedByUserId")).toBe(
      "SET NULL",
    );
    expect(onDeleteOf("DataSecurityIssue", "assignedToUserId")).toBe(
      "SET NULL",
    );
    expect(onDeleteOf("DataSecurityIssue", "assignedToTeamId")).toBe(
      "SET NULL",
    );

    // The case and the alert an issue opened outlive it, and it outlives them.
    expect(onDeleteOf("DataSecurityIssue", "securityCaseId")).toBe("SET NULL");
    expect(onDeleteOf("DataSecurityIssue", "alertId")).toBe("SET NULL");

    // A store outlives the cloud records, the database and the probe it was found through.
    for (const column of [
      "cloudAccountId",
      "cloudResourceId",
      "cloudConnectionId",
      "databaseServerId",
      "serviceId",
      "scanProbeId",
    ]) {
      expect(onDeleteOf("DataStore", column)).toBe("SET NULL");
    }

    for (const key of keys) {
      if (
        key.column === "createdByUserId" ||
        key.column === "deletedByUserId"
      ) {
        expect(key.references).toBe("User");
        expect(key.onDelete).toBe("SET NULL");
      }
    }
  });

  test.each(JOIN_TABLES)(
    "a row of %s goes when either side is deleted",
    async (table: string, owner: string, other: string, otherTable: string) => {
      const keys: Array<ForeignKey> = foreignKeys(
        await record("up"),
        JOIN_TABLE_FOREIGN_KEY,
      ).filter((key: ForeignKey): boolean => {
        return key.table === table;
      });

      expect(
        keys
          .map((key: ForeignKey): string => {
            return `${key.column} -> ${key.references} ${key.onDelete}`;
          })
          .sort(),
      ).toEqual(
        [
          `${owner} -> ${table.startsWith("DataStoreLabelRule") ? "DataStoreLabelRule" : table.startsWith("DataStoreOwnerRule") ? "DataStoreOwnerRule" : "DataStore"} CASCADE`,
          `${other} -> ${otherTable} CASCADE`,
        ].sort(),
      );
    },
  );

  test("reads or writes no row, either way", async () => {
    for (const step of [...(await record("up")), ...(await record("down"))]) {
      expect(step).not.toMatch(ROW_STATEMENT);
    }
  });

  test("down drops exactly what up made: its keys, its indexes, then its tables, the first one made last", async () => {
    const up: Array<string> = await record("up");
    const down: Array<string> = await record("down");

    expect(named(down, DROP_TABLE)).toEqual(
      [...named(up, CREATE_TABLE)].reverse(),
    );
    expect(named(down, DROP_CONSTRAINT).sort()).toEqual(
      named(up, ADD_CONSTRAINT).sort(),
    );
    expect(named(down, DROP_INDEX).sort()).toEqual(
      named(up, CREATE_INDEX).sort(),
    );
    expect(down.length).toBe(up.length);
    expect(down[down.length - 1]).toBe(`DROP TABLE "DataStore"`);

    // Every key goes before any table goes, so no drop waits on a key to a table already gone.
    const firstTableDrop: number = down.findIndex((step: string): boolean => {
      return DROP_TABLE.test(step);
    });
    const lastKeyDrop: number = down
      .map((step: string): boolean => {
        return DROP_CONSTRAINT.test(step);
      })
      .lastIndexOf(true);

    expect(lastKeyDrop).toBeLessThan(firstTableDrop);
  });
});
