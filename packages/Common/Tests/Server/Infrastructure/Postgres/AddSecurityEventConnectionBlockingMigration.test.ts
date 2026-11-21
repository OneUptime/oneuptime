import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddSecurityEventConnectionBlocking1809187364500 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187364500-AddSecurityEventConnectionBlocking";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import Permission from "../../../../Types/Permission";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * AddSecurityEventConnectionBlocking (OneUptime issue #10343): a security
 * connection keeps whether OneUptime enforces the blocklist through it
 * (blockingSettings), and what OneUptime last found at the provider
 * (blockingStatus). Nullable JSON with no default: Postgres adds them without
 * rewriting a row, and every connection from before blocks nothing.
 */

const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;
const COLUMNS: Array<string> = ["blockingSettings", "blockingStatus"];

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  await run({
    isTransactionActive: false,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

function timestampOf(migration: unknown): number {
  return Number(
    MIGRATION_TIMESTAMP.exec((migration as { name: string }).name)?.[1] || 0,
  );
}

describe("AddSecurityEventConnectionBlocking1809187364500", () => {
  test("adds the two columns to SecurityEventConnection, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddSecurityEventConnectionBlocking1809187364500().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "SecurityEventConnection" ADD "blockingSettings" jsonb`,
      `ALTER TABLE "SecurityEventConnection" ADD "blockingStatus" jsonb`,
    ]);
  });

  test("nullable, no default, no index, no row rewritten", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddSecurityEventConnectionBlocking1809187364500().up(runner);
    })) {
      expect(statement).not.toMatch(
        /NOT NULL|DEFAULT|CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE /i,
      );
    }
  });

  test("the columns are the model's: JSON, not required, read by every Security role and written by OneUptime alone", () => {
    const connection: SecurityEventConnection = new SecurityEventConnection();

    for (const column of COLUMNS) {
      expect(connection.getTableColumnMetadata(column)).toBeDefined();
      expect(connection.getTableColumnMetadata(column).required).toBe(false);
      expect(connection.getTableColumnMetadata(column).type).toBe(
        TableColumnType.JSON,
      );

      const access: {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      } = connection.getColumnAccessControlForAllColumns()[column] as {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      };

      // Written through the blocking routes, as OneUptime, never by a plain create or update.
      expect(access.create).toEqual([]);
      expect(access.update).toEqual([]);
      expect(access.read).toEqual(
        expect.arrayContaining([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SecurityAdmin,
          Permission.SecurityMember,
          Permission.SecurityViewer,
        ]),
      );
    }
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddSecurityEventConnectionBlocking1809187364500().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "SecurityEventConnection" DROP COLUMN "blockingStatus"`,
      `ALTER TABLE "SecurityEventConnection" DROP COLUMN "blockingSettings"`,
    ]);
  });

  test("registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddSecurityEventConnectionBlocking1809187364500;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddSecurityEventConnectionBlocking1809187364500,
    );

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(
      timestampOf(AddSecurityEventConnectionBlocking1809187364500),
    );
    expect(new AddSecurityEventConnectionBlocking1809187364500().name).toBe(
      "AddSecurityEventConnectionBlocking1809187364500",
    );
  });
});
