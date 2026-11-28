import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProjectSecurityTrustPrivateAddresses1809187791240 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187791240-AddProjectSecurityTrustPrivateAddresses";
import Project from "../../../../Models/DatabaseModels/Project";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * AddProjectSecurityTrustPrivateAddresses (#11389): Private Addresses, the
 * switch that says whether Security Events trusts private, loopback and
 * link-local addresses as proxies unlisted. On for every project already
 * here - the column's default - so none behind an ordinary HTTP proxy
 * starts naming the proxy as the attacker overnight; a new project starts
 * with it off (ProjectService.applyNewProjectSecurityDefaults). A boolean
 * with a constant default: Postgres adds it without rewriting a row of
 * "Project".
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

function up(): Promise<Array<string>> {
  return statementsOf((runner: QueryRunner) => {
    return new AddProjectSecurityTrustPrivateAddresses1809187791240().up(
      runner,
    );
  });
}

describe("AddProjectSecurityTrustPrivateAddresses1809187791240", () => {
  test("adds the column to Project, on for every project there is, as generated, and nothing else", async () => {
    expect(await up()).toEqual([
      `ALTER TABLE "Project" ADD "securityTrustPrivateAddresses" boolean NOT NULL DEFAULT true`,
    ]);
  });

  test("a constant default, and no index, key or update: no row of Project is rewritten", async () => {
    for (const statement of await up()) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE |now\(\)|USING /i,
      );
      expect(statement).toMatch(/DEFAULT true$/);
    }
  });

  test("the column is the model's: a required boolean, on by default for the projects there are", () => {
    const metadata: ReturnType<Project["getTableColumnMetadata"]> =
      new Project().getTableColumnMetadata("securityTrustPrivateAddresses");

    expect(metadata).toBeDefined();
    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.required).toBe(true);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(true);
    expect(metadata.description?.length).toBeLessThanOrEqual(150);
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProjectSecurityTrustPrivateAddresses1809187791240().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "Project" DROP COLUMN "securityTrustPrivateAddresses"`,
    ]);
  });

  test("registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return (
          candidate === AddProjectSecurityTrustPrivateAddresses1809187791240
        );
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddProjectSecurityTrustPrivateAddresses1809187791240,
    );

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(
      timestampOf(AddProjectSecurityTrustPrivateAddresses1809187791240),
    );
    expect(
      new AddProjectSecurityTrustPrivateAddresses1809187791240().name,
    ).toBe("AddProjectSecurityTrustPrivateAddresses1809187791240");
  });
});
