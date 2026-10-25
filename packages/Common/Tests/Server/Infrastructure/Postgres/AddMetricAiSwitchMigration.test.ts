import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import Project from "../../../../Models/DatabaseModels/Project";
import Migrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddMetricAiSwitch1807400000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807400000000-AddMetricAiSwitch";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import {
  TELEMETRY_AI_LANES,
  TelemetryAiLane,
} from "../../../../Types/AI/TelemetryAi";

/*
 * The migration behind Metrics → AI → Settings' switch, "Improve metrics and
 * add missing ones" (Project.enableAutomaticMetricRemediation): one column,
 * off for every project that already exists - an upgrade spends no AI
 * credits and opens no pull request unasked - and added without rewriting a
 * row (a constant default). New projects turn it on as they are created
 * (ProjectServiceNewProjectAiDefaults holds that). Pinned here without a
 * database: what up() and down() run, where it is registered, and that the
 * model declares the column the migration makes; the drift check
 * (Scripts/Postgres/CheckSchemaDrift) holds the two together on Postgres.
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

const NAME: string = "AddMetricAiSwitch1807400000000";
const TIMESTAMP: number = 1807400000000;
const COLUMN: string = "enableAutomaticMetricRemediation";

type MigrationClass = { name: string };

const registeredNames: Array<string> = (
  Migrations as unknown as Array<MigrationClass>
).map((migration: MigrationClass): string => {
  return migration.name;
});

const TIMESTAMP_PATTERN: RegExp = /(\d{13})$/;

function timestampOf(name: string): number | null {
  const stamp: RegExpMatchArray | null = name.match(TIMESTAMP_PATTERN);

  return stamp ? Number(stamp[1]) : null;
}

// What up() or down() sends, on a database that answers every read with nothing.
async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<Array<unknown>> => {
      statements.push(statement.trim());
      return [];
    },
  } as unknown as QueryRunner;

  await new AddMetricAiSwitch1807400000000()[direction](queryRunner);

  return statements;
}

describe("AddMetricAiSwitch: registration", () => {
  test("its name and its file carry its timestamp", () => {
    expect(new AddMetricAiSwitch1807400000000().name).toBe(NAME);
    expect(
      fs.existsSync(
        path.join(MIGRATIONS_DIR, `${TIMESTAMP}-AddMetricAiSwitch.ts`),
      ),
    ).toBe(true);
  });

  test("registered once, after every migration with an earlier timestamp", () => {
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === NAME;
      }),
    ).toEqual([NAME]);

    const index: number = registeredNames.indexOf(NAME);

    for (const name of registeredNames.slice(0, index)) {
      const stamp: number | null = timestampOf(name);

      if (stamp !== null) {
        expect([name, stamp < TIMESTAMP]).toEqual([name, true]);
      }
    }
  });

  test("no other migration file shares its timestamp", () => {
    expect(
      fs.readdirSync(MIGRATIONS_DIR).filter((file: string): boolean => {
        return file.startsWith(`${TIMESTAMP}-`);
      }),
    ).toEqual([`${TIMESTAMP}-AddMetricAiSwitch.ts`]);
  });
});

describe("AddMetricAiSwitch: what it runs", () => {
  test("up() adds the switch to Project, off, in one statement that rewrites no row", async () => {
    expect(await recordQueries("up")).toEqual([
      `ALTER TABLE "Project" ADD "${COLUMN}" boolean NOT NULL DEFAULT false`,
    ]);
  });

  test("down() drops the switch and nothing else", async () => {
    expect(await recordQueries("down")).toEqual([
      `ALTER TABLE "Project" DROP COLUMN "${COLUMN}"`,
    ]);
  });
});

describe("AddMetricAiSwitch: the column the model declares", () => {
  test("Project's column is the Metric lane's switch", () => {
    expect(TELEMETRY_AI_LANES[TelemetryAiLane.Metric].switchColumn).toBe(
      COLUMN,
    );
  });

  test("a boolean, not null, false by default - as the migration makes it", () => {
    const declared: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.target === Project && candidate.propertyName === COLUMN
          );
        },
      );

    expect({
      nullable: declared?.options.nullable,
      default: declared?.options.default,
    }).toEqual({ nullable: false, default: false });
  });

  test("the API documents it as a switch a create may leave out: off unless set", () => {
    const metadata: TableColumnMetadata = new Project().getTableColumnMetadata(
      COLUMN,
    );

    expect({
      type: metadata.type,
      required: metadata.required,
      isDefaultValueColumn: metadata.isDefaultValueColumn,
      defaultValue: metadata.defaultValue,
    }).toEqual({
      type: TableColumnType.Boolean,
      required: true,
      isDefaultValueColumn: true,
      defaultValue: false,
    });
  });
});
