import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityLogSource from "../../../../Models/DatabaseModels/SecurityLogSource";
import Migrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddSecurityLogSourceCaseMinimumSeverity1808992580000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808992580000-AddSecurityLogSourceCaseMinimumSeverity";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";

/*
 * The migration behind Your logs' "Open cases from"
 * (SecurityLogSource.caseMinimumSeverity): which threats security products
 * write in the logs open a case, as a connection's Open Cases From Severity
 * says for its alerts. High for every project's Your logs, as it was for
 * every connection when cases came, added without rewriting a row (a
 * constant default). Pinned here without a database: what up() and down()
 * run, where it is registered, and that the model declares the column the
 * migration makes, as the connection's; the drift check
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

const NAME: string = "AddSecurityLogSourceCaseMinimumSeverity1808992580000";
const TIMESTAMP: number = 1808992580000;
const COLUMN: string = "caseMinimumSeverity";

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

  await new AddSecurityLogSourceCaseMinimumSeverity1808992580000()[direction](
    queryRunner,
  );

  return statements;
}

function declaredColumn(target: unknown): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (candidate: ColumnMetadataArgs): boolean => {
      return candidate.target === target && candidate.propertyName === COLUMN;
    },
  );
}

describe("AddSecurityLogSourceCaseMinimumSeverity: registration", () => {
  test("its name and its file carry its timestamp", () => {
    expect(
      new AddSecurityLogSourceCaseMinimumSeverity1808992580000().name,
    ).toBe(NAME);
    expect(
      fs.existsSync(
        path.join(
          MIGRATIONS_DIR,
          `${TIMESTAMP}-AddSecurityLogSourceCaseMinimumSeverity.ts`,
        ),
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
    ).toEqual([`${TIMESTAMP}-AddSecurityLogSourceCaseMinimumSeverity.ts`]);
  });
});

describe("AddSecurityLogSourceCaseMinimumSeverity: what it runs", () => {
  test("up() adds the threshold to Your logs, High, in one statement that rewrites no row", async () => {
    expect(await recordQueries("up")).toEqual([
      `ALTER TABLE "SecurityLogSource" ADD "${COLUMN}" character varying(100) DEFAULT 'High'`,
    ]);
  });

  test("down() drops it and nothing else", async () => {
    expect(await recordQueries("down")).toEqual([
      `ALTER TABLE "SecurityLogSource" DROP COLUMN "${COLUMN}"`,
    ]);
  });
});

describe("AddSecurityLogSourceCaseMinimumSeverity: the column the model declares", () => {
  test("short text, empty allowed, High by default - as the migration makes it, and as a connection's is", () => {
    const declared: ColumnMetadataArgs | undefined =
      declaredColumn(SecurityLogSource);
    const connection: ColumnMetadataArgs | undefined = declaredColumn(
      SecurityEventConnection,
    );

    expect({
      nullable: declared?.options.nullable,
      default: declared?.options.default,
      length: declared?.options.length,
    }).toEqual({ nullable: true, default: "High", length: 100 });
    expect({
      nullable: connection?.options.nullable,
      default: connection?.options.default,
      length: connection?.options.length,
    }).toEqual({
      nullable: declared?.options.nullable,
      default: declared?.options.default,
      length: declared?.options.length,
    });
  });

  test("the API documents it as optional, High unless set", () => {
    const metadata: TableColumnMetadata =
      new SecurityLogSource().getTableColumnMetadata(COLUMN);

    expect({
      type: metadata.type,
      required: metadata.required,
      defaultValue: metadata.defaultValue,
      title: metadata.title,
    }).toEqual({
      type: TableColumnType.ShortText,
      required: false,
      defaultValue: "High",
      title: "Open Cases From Severity",
    });
  });

  test("who turns Your logs on sets it; every Security tier reads it", () => {
    const access: {
      create?: Array<Permission>;
      read?: Array<Permission>;
      update?: Array<Permission>;
    } =
      new SecurityLogSource().getColumnAccessControlForAllColumns()[COLUMN] ||
      {};
    const isEnabledAccess: {
      create?: Array<Permission>;
      read?: Array<Permission>;
      update?: Array<Permission>;
    } =
      new SecurityLogSource().getColumnAccessControlForAllColumns()[
        "isEnabled"
      ] || {};

    expect(access.create).toEqual(isEnabledAccess.create);
    expect(access.update).toEqual(isEnabledAccess.update);
    expect(access.read).toEqual(isEnabledAccess.read);
    expect(access.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
    ]);
    expect(access.read).toContain(Permission.SecurityViewer);
  });
});
