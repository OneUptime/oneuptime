import { AddWorkflowLogRunAgain1808994200000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1808994200000-AddWorkflowLogRunAgain";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import WorkflowLog from "../../../Models/DatabaseModels/WorkflowLog";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Issue #5944: a run keeps what it started with so a person can run it again. A
 * webhook's payload can hold anything, so nobody reads it back through the API:
 * only whether there is one to start from.
 */

const run: WorkflowLog = new WorkflowLog();

describe("WorkflowLog.triggerValues", () => {
  const column: TableColumnMetadata =
    run.getTableColumnMetadata("triggerValues");
  const access: ColumnAccessControl = run.getColumnAccessControlFor(
    "triggerValues",
  ) as ColumnAccessControl;

  test("is read, written and changed by no request", () => {
    expect(access.read).toEqual([]);
    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
  });

  test("is encrypted at rest", () => {
    expect(column.encrypted).toBe(true);
    expect(run.getEncryptedColumns().columns).toContain("triggerValues");
  });

  test("is text, so a payload comes back with its keys in their order", () => {
    expect(column.type).toBe(TableColumnType.VeryLongText);
  });

  test("is not required: a run may have nothing kept", () => {
    expect(column.required).toBeFalsy();
  });
});

describe("WorkflowLog.canRunAgain", () => {
  const column: TableColumnMetadata = run.getTableColumnMetadata("canRunAgain");
  const access: ColumnAccessControl = run.getColumnAccessControlFor(
    "canRunAgain",
  ) as ColumnAccessControl;
  const logsAccess: ColumnAccessControl = run.getColumnAccessControlFor(
    "logs",
  ) as ColumnAccessControl;

  test("is read by whoever reads the run", () => {
    expect(access.read).toEqual(logsAccess.read);
    expect(access.read).toContain(Permission.WorkflowMember);
    expect(access.read).toContain(Permission.ReadWorkflowLog);
  });

  test("is written by OneUptime alone", () => {
    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
  });

  test("is false unless a run says otherwise", () => {
    expect(column.type).toBe(TableColumnType.Boolean);
    expect(column.isDefaultValueColumn).toBe(true);
    expect(column.defaultValue).toBe(false);
  });
});

describe("AddWorkflowLogRunAgain1808994200000", () => {
  type RunMigrationFunction = (
    direction: "up" | "down",
  ) => Promise<Array<string>>;

  const runMigration: RunMigrationFunction = async (
    direction: "up" | "down",
  ): Promise<Array<string>> => {
    const statements: Array<string> = [];

    await new AddWorkflowLogRunAgain1808994200000()[direction]({
      query: (statement: string): Promise<undefined> => {
        statements.push(statement);
        return Promise.resolve(undefined);
      },
    } as unknown as QueryRunner);

    return statements;
  };

  test("is registered, and last among the ones it was written after", () => {
    const names: Array<string> = (
      SchemaMigrations as unknown as Array<new () => MigrationInterface>
    ).map((type: new () => MigrationInterface): string => {
      return type.name;
    });

    expect(names).toContain("AddWorkflowLogRunAgain1808994200000");
    expect(
      names.indexOf("AddWorkflowLogRunAgain1808994200000"),
    ).toBeGreaterThan(names.indexOf("AddOpenStackProjectNotices1808994120000"));
  });

  test("adds the two columns, rewriting nothing", async () => {
    expect(await runMigration("up")).toEqual([
      `ALTER TABLE "WorkflowLog" ADD "triggerValues" text`,
      `ALTER TABLE "WorkflowLog" ADD "canRunAgain" boolean NOT NULL DEFAULT false`,
    ]);
  });

  test("takes them out again, in the other order", async () => {
    expect(await runMigration("down")).toEqual([
      `ALTER TABLE "WorkflowLog" DROP COLUMN "canRunAgain"`,
      `ALTER TABLE "WorkflowLog" DROP COLUMN "triggerValues"`,
    ]);
  });
});
