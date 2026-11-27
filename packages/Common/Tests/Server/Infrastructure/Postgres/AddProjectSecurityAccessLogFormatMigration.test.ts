import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProjectSecurityAccessLogFormat1809187791129 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187791129-AddProjectSecurityAccessLogFormat";
import Project from "../../../../Models/DatabaseModels/Project";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * AddProjectSecurityAccessLogFormat (OneUptime issue #11048): the format a
 * project's web servers write their access logs in,
 * Project.securityAccessLogFormat - nullable text with no default, so
 * Postgres adds it without rewriting a row of "Project".
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

describe("AddProjectSecurityAccessLogFormat1809187791129", () => {
  test("adds the column to Project, as generated, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProjectSecurityAccessLogFormat1809187791129().up(runner);
      }),
    ).toEqual([`ALTER TABLE "Project" ADD "securityAccessLogFormat" text`]);
  });

  test("no default, index, key or update: no row of Project is rewritten", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddProjectSecurityAccessLogFormat1809187791129().up(runner);
    })) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE |DEFAULT|NOT NULL/i,
      );
    }
  });

  test("the column is the model's: optional very long text", () => {
    const metadata: ReturnType<Project["getTableColumnMetadata"]> =
      new Project().getTableColumnMetadata("securityAccessLogFormat");

    expect(metadata).toBeDefined();
    expect(metadata.type).toBe(TableColumnType.VeryLongText);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("Access Log Format");
    expect(metadata.description).toContain("X-Forwarded-For");
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProjectSecurityAccessLogFormat1809187791129().down(
          runner,
        );
      }),
    ).toEqual([`ALTER TABLE "Project" DROP COLUMN "securityAccessLogFormat"`]);
  });

  test("registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddProjectSecurityAccessLogFormat1809187791129;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddProjectSecurityAccessLogFormat1809187791129,
    );

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(timestampOf(AddProjectSecurityAccessLogFormat1809187791129));
    expect(new AddProjectSecurityAccessLogFormat1809187791129().name).toBe(
      "AddProjectSecurityAccessLogFormat1809187791129",
    );
  });
});
