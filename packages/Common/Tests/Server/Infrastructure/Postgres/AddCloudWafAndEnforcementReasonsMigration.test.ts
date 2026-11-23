import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddCloudWafAndEnforcementReasons1809187455000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187455000-AddCloudWafAndEnforcementReasons";
import SecurityBlockCloudWaf from "../../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import SecurityBlockEnforcement from "../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Permission from "../../../../Types/Permission";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * AddCloudWafAndEnforcementReasons (OneUptime issues #10348, #10349,
 * #10629): a block's enforcement row keeps its destination's reason as a
 * sentence and its values (errorReason), and a cloud WAF keeps why it is not
 * enforcing (statusReason), for the Dashboard to word in the reader's
 * language. Nullable JSON with no default: Postgres adds them without
 * rewriting a row, and every row from before keeps its English text.
 */

const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

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

describe("AddCloudWafAndEnforcementReasons1809187455000", () => {
  test("adds the two columns, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddCloudWafAndEnforcementReasons1809187455000().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "SecurityBlockEnforcement" ADD "errorReason" jsonb`,
      `ALTER TABLE "SecurityBlockCloudWaf" ADD "statusReason" jsonb`,
    ]);
  });

  test("nullable, no default, no index, no row rewritten", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddCloudWafAndEnforcementReasons1809187455000().up(runner);
    })) {
      expect(statement).not.toMatch(
        /NOT NULL|DEFAULT|CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE /i,
      );
    }
  });

  test.each([
    {
      model: new SecurityBlockEnforcement() as BaseModel,
      column: "errorReason",
    },
    { model: new SecurityBlockCloudWaf() as BaseModel, column: "statusReason" },
  ])(
    "$column is the model's: JSON, not required, read by whoever reads the blocklist and written by OneUptime alone",
    ({ model, column }: { model: BaseModel; column: string }) => {
      expect(model.getTableColumnMetadata(column)).toBeDefined();
      expect(model.getTableColumnMetadata(column).required).toBe(false);
      expect(model.getTableColumnMetadata(column).type).toBe(
        TableColumnType.JSON,
      );

      const access: {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      } = model.getColumnAccessControlForAllColumns()[column] as {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      };

      expect(access.create).toEqual([]);
      expect(access.update).toEqual([]);
      expect(access.read).toEqual(
        expect.arrayContaining([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SecurityAdmin,
          Permission.SecurityMember,
          Permission.SecurityViewer,
          Permission.ReadSecurityBlock,
        ]),
      );
    },
  );

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddCloudWafAndEnforcementReasons1809187455000().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "SecurityBlockCloudWaf" DROP COLUMN "statusReason"`,
      `ALTER TABLE "SecurityBlockEnforcement" DROP COLUMN "errorReason"`,
    ]);
  });

  test("registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddCloudWafAndEnforcementReasons1809187455000;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddCloudWafAndEnforcementReasons1809187455000,
    );

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(timestampOf(AddCloudWafAndEnforcementReasons1809187455000));
    expect(new AddCloudWafAndEnforcementReasons1809187455000().name).toBe(
      "AddCloudWafAndEnforcementReasons1809187455000",
    );
  });
});
