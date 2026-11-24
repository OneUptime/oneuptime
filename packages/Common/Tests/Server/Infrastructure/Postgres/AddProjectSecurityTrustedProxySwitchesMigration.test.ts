import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProjectSecurityTrustedProxySwitches1809187580546 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187580546-AddProjectSecurityTrustedProxySwitches";
import Project from "../../../../Models/DatabaseModels/Project";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * AddProjectSecurityTrustedProxySwitches (OneUptime issues #10546 and
 * #10548): the two switches of Security Events' Trusted Proxies.
 * Project.securityTrustOwnLoadBalancers is on for every project, those from
 * before included; Project.securityReadAccessLogForwardedFor is off until a
 * project says its access logs end with X-Forwarded-For. Each a boolean with
 * a constant default: Postgres adds it without rewriting a row of "Project".
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

describe("AddProjectSecurityTrustedProxySwitches1809187580546", () => {
  test("adds the two columns to Project, as generated, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProjectSecurityTrustedProxySwitches1809187580546().up(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "Project" ADD "securityTrustOwnLoadBalancers" boolean NOT NULL DEFAULT true`,
      `ALTER TABLE "Project" ADD "securityReadAccessLogForwardedFor" boolean NOT NULL DEFAULT false`,
    ]);
  });

  test("a constant default and no index, key or update: no row of Project is rewritten", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddProjectSecurityTrustedProxySwitches1809187580546().up(
        runner,
      );
    })) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE |now\(\)/i,
      );
      expect(statement).toMatch(/DEFAULT (true|false)$/);
    }
  });

  test("the columns are the model's: required booleans, on and off by default", () => {
    const project: Project = new Project();

    for (const [column, defaultValue] of [
      ["securityTrustOwnLoadBalancers", true],
      ["securityReadAccessLogForwardedFor", false],
    ] as Array<[string, boolean]>) {
      const metadata: ReturnType<Project["getTableColumnMetadata"]> =
        project.getTableColumnMetadata(column);

      expect(metadata).toBeDefined();
      expect(metadata.type).toBe(TableColumnType.Boolean);
      expect(metadata.required).toBe(true);
      expect(metadata.isDefaultValueColumn).toBe(true);
      expect(metadata.defaultValue).toBe(defaultValue);
    }
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProjectSecurityTrustedProxySwitches1809187580546().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "Project" DROP COLUMN "securityReadAccessLogForwardedFor"`,
      `ALTER TABLE "Project" DROP COLUMN "securityTrustOwnLoadBalancers"`,
    ]);
  });

  test("registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddProjectSecurityTrustedProxySwitches1809187580546;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddProjectSecurityTrustedProxySwitches1809187580546,
    );

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(
      timestampOf(AddProjectSecurityTrustedProxySwitches1809187580546),
    );
    expect(new AddProjectSecurityTrustedProxySwitches1809187580546().name).toBe(
      "AddProjectSecurityTrustedProxySwitches1809187580546",
    );
  });
});
