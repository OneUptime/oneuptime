import { AddSecurityCaseAiRespondsFirst1809187453000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187453000-AddSecurityCaseAiRespondsFirst";
import { AddSecurityCaseAiHoldUntilIndex1809187453010 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187453010-AddSecurityCaseAiHoldUntilIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Project from "../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import { SECURITY_CASE_AI_HOLD_MINUTES_DEFAULT } from "../../../../Types/SecurityCase/SecurityCaseAiHold";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * The migrations behind OneUptime AI responding first to security cases
 * (#10353): the project's setting and what it holds, and how a case's hold
 * stands. Pins that up() adds each column as the model declares it - the
 * switch off and the hold time at its default for every project, so no
 * project starts holding and the table is not rewritten; every case's hold
 * empty - that down() undoes up() in reverse, that the index the
 * every-minute review reads is built online, in a migration of its own,
 * and that both run right after the migrations of OneUptime AI working
 * cases (#10352). Fake QueryRunner only.
 */

const PREVIOUS_CLASS_NAME: string = "AddSecurityCaseAiNextLookIndex1809187452010";

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

interface AddedColumn {
  table: string;
  model: unknown;
  column: string;
  statement: string;
}

// In the order up() adds them.
const COLUMNS: Array<AddedColumn> = [
  {
    table: "Project",
    model: Project,
    column: "enableSecurityCaseAiRespondsFirst",
    statement: `ALTER TABLE "Project" ADD "enableSecurityCaseAiRespondsFirst" boolean NOT NULL DEFAULT false`,
  },
  {
    table: "Project",
    model: Project,
    column: "securityCaseAiHoldBelowPriorityId",
    statement: `ALTER TABLE "Project" ADD "securityCaseAiHoldBelowPriorityId" uuid`,
  },
  {
    table: "Project",
    model: Project,
    column: "securityCaseAiHoldMinutes",
    statement: `ALTER TABLE "Project" ADD "securityCaseAiHoldMinutes" integer NOT NULL DEFAULT '${SECURITY_CASE_AI_HOLD_MINUTES_DEFAULT}'`,
  },
  {
    table: "SecurityCase",
    model: SecurityCase,
    column: "aiHoldOutcome",
    statement: `ALTER TABLE "SecurityCase" ADD "aiHoldOutcome" character varying(100)`,
  },
  {
    table: "SecurityCase",
    model: SecurityCase,
    column: "aiHoldUntil",
    statement: `ALTER TABLE "SecurityCase" ADD "aiHoldUntil" TIMESTAMP WITH TIME ZONE`,
  },
  {
    table: "SecurityCase",
    model: SecurityCase,
    column: "aiHoldEndedAt",
    statement: `ALTER TABLE "SecurityCase" ADD "aiHoldEndedAt" TIMESTAMP WITH TIME ZONE`,
  },
  {
    table: "SecurityCase",
    model: SecurityCase,
    column: "aiHoldEndedByUserId",
    statement: `ALTER TABLE "SecurityCase" ADD "aiHoldEndedByUserId" uuid`,
  },
];

type MigrationClass = new () => MigrationInterface;

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<MigrationClass>
).map((migration: MigrationClass): string => {
  return migration.name;
});

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddSecurityCaseAiRespondsFirst1809187453000()[direction](
    queryRunner,
  );

  return statements;
}

function declaredColumn(entry: AddedColumn): ColumnMetadataArgs {
  const found: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((column: ColumnMetadataArgs): boolean => {
      return column.target === entry.model;
    })
    .find((column: ColumnMetadataArgs): boolean => {
      return column.propertyName === entry.column;
    });

  expect({ column: entry.column, declared: Boolean(found) }).toEqual({
    column: entry.column,
    declared: true,
  });

  return found as ColumnMetadataArgs;
}

describe("AddSecurityCaseAiRespondsFirst1809187453000", () => {
  test("up() adds each column, in this order, as TypeORM generated it", async () => {
    expect(await recordQueries("up")).toEqual(
      COLUMNS.map((entry: AddedColumn): string => {
        return entry.statement;
      }),
    );
  });

  test("each column is the model's: its type, whether it may be empty, and its default", () => {
    const declared: Record<string, unknown> = {};

    for (const entry of COLUMNS) {
      const column: ColumnMetadataArgs = declaredColumn(entry);

      declared[entry.column] = {
        type: column.options.type,
        nullable: column.options.nullable,
        default: column.options.default,
        ...(column.options.length ? { length: column.options.length } : {}),
      };
    }

    expect(declared).toEqual({
      // Off for every project: none starts holding its cases' alerts.
      enableSecurityCaseAiRespondsFirst: {
        type: "boolean",
        nullable: false,
        default: false,
      },
      // Empty: the built-in High.
      securityCaseAiHoldBelowPriorityId: {
        type: "uuid",
        nullable: true,
        default: undefined,
      },
      securityCaseAiHoldMinutes: {
        type: "integer",
        nullable: false,
        default: SECURITY_CASE_AI_HOLD_MINUTES_DEFAULT,
      },
      // Empty on every existing case: none is held.
      aiHoldOutcome: {
        type: "varchar",
        nullable: true,
        default: undefined,
        length: 100,
      },
      aiHoldUntil: {
        type: "timestamptz",
        nullable: true,
        default: undefined,
      },
      aiHoldEndedAt: {
        type: "timestamptz",
        nullable: true,
        default: undefined,
      },
      aiHoldEndedByUserId: {
        type: "uuid",
        nullable: true,
        default: undefined,
      },
    });
  });

  test("down() drops what up() added, in reverse", async () => {
    expect(await recordQueries("down")).toEqual(
      [...COLUMNS].reverse().map((entry: AddedColumn): string => {
        return `ALTER TABLE "${entry.table}" DROP COLUMN "${entry.column}"`;
      }),
    );
  });
});

describe("AddSecurityCaseAiHoldUntilIndex1809187453010", () => {
  test("builds the model's index of when a hold runs out, online and outside a transaction", () => {
    const index: IndexMetadataArgs | undefined = getMetadataArgsStorage()
      .indices.filter((entry: IndexMetadataArgs): boolean => {
        return entry.target === SecurityCase;
      })
      .find((entry: IndexMetadataArgs): boolean => {
        return (
          Array.isArray(entry.columns) &&
          entry.columns.length === 1 &&
          entry.columns[0] === "aiHoldUntil"
        );
      });

    expect(index).toBeDefined();
    expect(new AddSecurityCaseAiHoldUntilIndex1809187453010().transaction).toBe(
      false,
    );

    const source: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "1809187453010-AddSecurityCaseAiHoldUntilIndex.ts"),
      "utf8",
    );

    expect(source).toContain(
      'OnlineDdl.createIndex(\n      queryRunner,\n      `CREATE INDEX "IDX_44563c58a2520ba11e7a4fb634" ON "SecurityCase" ("aiHoldUntil") `,',
    );
    expect(source).toContain(
      'OnlineDdl.dropIndex(\n      queryRunner,\n      `DROP INDEX "public"."IDX_44563c58a2520ba11e7a4fb634"`,',
    );
  });
});

describe("where they run", () => {
  test("both are registered right after OneUptime AI working cases, the columns before their index", () => {
    const at: number = registeredNames.indexOf(PREVIOUS_CLASS_NAME);

    expect(at).toBeGreaterThanOrEqual(0);
    expect(registeredNames.slice(at, at + 3)).toEqual([
      PREVIOUS_CLASS_NAME,
      "AddSecurityCaseAiRespondsFirst1809187453000",
      "AddSecurityCaseAiHoldUntilIndex1809187453010",
    ]);
  });

  test("each class's name ends with the timestamp its file starts with", () => {
    for (const [file, name] of [
      [
        "1809187453000-AddSecurityCaseAiRespondsFirst.ts",
        new AddSecurityCaseAiRespondsFirst1809187453000().name,
      ],
      [
        "1809187453010-AddSecurityCaseAiHoldUntilIndex.ts",
        new AddSecurityCaseAiHoldUntilIndex1809187453010().name,
      ],
    ] as Array<[string, string]>) {
      expect(fs.existsSync(path.join(MIGRATIONS_DIR, file))).toBe(true);
      expect(name.endsWith(file.slice(0, 13))).toBe(true);
    }
  });
});
