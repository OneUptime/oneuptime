import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProjectSecurityTrustedProxies1809187364416 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187364416-AddProjectSecurityTrustedProxies";
import Project from "../../../../Models/DatabaseModels/Project";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * AddProjectSecurityTrustedProxies (OneUptime issue #10416):
 * Project.securityTrustedProxies, the proxies a project's apps sit behind,
 * one IP address or range a line. Nullable text with no default: Postgres
 * adds it to "Project" without rewriting a row, and every project from
 * before trusts only private addresses - nothing is backfilled.
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

describe("AddProjectSecurityTrustedProxies1809187364416", () => {
  test("adds the one column to Project, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProjectSecurityTrustedProxies1809187364416().up(runner);
      }),
    ).toEqual([`ALTER TABLE "Project" ADD "securityTrustedProxies" text`]);
  });

  test("nullable, no default, no index, no row rewritten", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddProjectSecurityTrustedProxies1809187364416().up(runner);
    })) {
      expect(statement).not.toMatch(
        /NOT NULL|DEFAULT|CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE /i,
      );
    }
  });

  test("the column is the model's: very long text, not required", () => {
    const project: Project = new Project();

    expect(
      project.getTableColumnMetadata("securityTrustedProxies"),
    ).toBeDefined();
    expect(
      project.getTableColumnMetadata("securityTrustedProxies").required,
    ).toBe(false);
    expect(project.getTableColumnMetadata("securityTrustedProxies").type).toBe(
      TableColumnType.VeryLongText,
    );
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProjectSecurityTrustedProxies1809187364416().down(runner);
      }),
    ).toEqual([`ALTER TABLE "Project" DROP COLUMN "securityTrustedProxies"`]);
  });

  test("registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddProjectSecurityTrustedProxies1809187364416;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddProjectSecurityTrustedProxies1809187364416,
    );

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(timestampOf(AddProjectSecurityTrustedProxies1809187364416));
    expect(new AddProjectSecurityTrustedProxies1809187364416().name).toBe(
      "AddProjectSecurityTrustedProxies1809187364416",
    );
  });
});
