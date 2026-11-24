import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddOnCallPolicyIncidentRole1809187660000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187660000-AddOnCallPolicyIncidentRole";
import { AddOnCallPolicyIncidentRoleIndexAndKey1809187660010 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187660010-AddOnCallPolicyIncidentRoleIndexAndKey";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * An on-call policy can give the people it pages a role on the incident or
 * the incident episode it pages them about ("OnCallDutyPolicy".
 * "incidentRoleId", OnCallPolicyIncidentRole).
 *
 * Two migrations, written as the generator writes them: the first adds the
 * nullable column, so no row is rewritten; the second builds its index and
 * its key to "IncidentRole" online, outside a transaction - every page
 * reads the policy, and a key added in a transaction would hold it. The
 * names are TypeORM's, worked out here with its own naming strategy, so the
 * drift check finds nothing to change.
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();
const INDEX: string = naming.indexName("OnCallDutyPolicy", ["incidentRoleId"]);
const FOREIGN_KEY: string = naming.foreignKeyName(
  "OnCallDutyPolicy",
  ["incidentRoleId"],
  "IncidentRole",
  ["_id"],
);

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  for (const step of ["createIndex", "addForeignKey", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      statements.push(`online: ${statement}`);
    }) as never);
  }

  await run({
    isTransactionActive: false,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

function migrationNames(): Array<string> {
  return SchemaMigrations.map((migration: unknown): string => {
    return (migration as { name: string }).name;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddOnCallPolicyIncidentRole1809187660000", () => {
  test("adds the role's id - and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddOnCallPolicyIncidentRole1809187660000().up(runner);
      }),
    ).toEqual([`ALTER TABLE "OnCallDutyPolicy" ADD "incidentRoleId" uuid`]);
  });

  test("never rewrites the table: the column is nullable, with no default", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddOnCallPolicyIncidentRole1809187660000().up(runner);
      },
    );

    for (const statement of statements) {
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toMatch(/^UPDATE/);
    }
  });

  test("down() takes back exactly what up() added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddOnCallPolicyIncidentRole1809187660000().down(runner);
      }),
    ).toEqual([`ALTER TABLE "OnCallDutyPolicy" DROP COLUMN "incidentRoleId"`]);
  });

  test("the column is the model's: a nullable uuid", () => {
    const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
      .columns.filter((args: ColumnMetadataArgs) => {
        return (
          args.target === OnCallDutyPolicy &&
          args.propertyName === "incidentRoleId"
        );
      })
      .pop();

    expect(column?.options).toMatchObject({ type: "uuid", nullable: true });
  });
});

describe("AddOnCallPolicyIncidentRoleIndexAndKey1809187660010", () => {
  test("builds the column's index and its key to IncidentRole online, outside a transaction", async () => {
    const migration: AddOnCallPolicyIncidentRoleIndexAndKey1809187660010 =
      new AddOnCallPolicyIncidentRoleIndexAndKey1809187660010();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      `online: CREATE INDEX "${INDEX}" ON "OnCallDutyPolicy" ("incidentRoleId") `,
      `online: ALTER TABLE "OnCallDutyPolicy" ADD CONSTRAINT "${FOREIGN_KEY}" FOREIGN KEY ("incidentRoleId") REFERENCES "IncidentRole"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    ]);
  });

  test("a deleted role keeps its policies: the key sets the id to null", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddOnCallPolicyIncidentRoleIndexAndKey1809187660010().up(
          runner,
        );
      },
    );

    expect(statements[1]).toContain("ON DELETE SET NULL");
    expect(statements.join("\n")).not.toContain("CASCADE");
  });

  test("down() takes the key, then the index, away", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddOnCallPolicyIncidentRoleIndexAndKey1809187660010().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "OnCallDutyPolicy" DROP CONSTRAINT "${FOREIGN_KEY}"`,
      `online: DROP INDEX "public"."${INDEX}"`,
    ]);
  });

  test("the index and the key are the model's", () => {
    const indexed: boolean = getMetadataArgsStorage().indices.some(
      (args: IndexMetadataArgs): boolean => {
        return (
          args.target === OnCallDutyPolicy &&
          JSON.stringify(args.columns || []).includes("incidentRoleId")
        );
      },
    );
    const relation: RelationMetadataArgs | undefined = getMetadataArgsStorage()
      .relations.filter((args: RelationMetadataArgs) => {
        return (
          args.target === OnCallDutyPolicy &&
          args.propertyName === "incidentRole"
        );
      })
      .pop();

    expect(indexed).toBe(true);
    expect(relation?.options).toMatchObject({
      onDelete: "SET NULL",
      nullable: true,
    });
  });
});

describe("both migrations", () => {
  test("are registered once each, the column's first, after every migration before them", () => {
    const names: Array<string> = migrationNames();
    const column: number = names.indexOf(
      "AddOnCallPolicyIncidentRole1809187660000",
    );
    const keys: number = names.indexOf(
      "AddOnCallPolicyIncidentRoleIndexAndKey1809187660010",
    );

    expect(column).toBeGreaterThan(-1);
    // The key needs the column: it runs after it.
    expect(keys).toBeGreaterThan(column);
    expect(
      names.filter((name: string): boolean => {
        return name.startsWith("AddOnCallPolicyIncidentRole");
      }),
    ).toHaveLength(2);
    // After the newest migration on main when they were written.
    expect(column).toBeGreaterThan(
      names.indexOf("AddSecurityUserErasureRequest1809187650908"),
    );
    expect(new AddOnCallPolicyIncidentRole1809187660000().name).toBe(
      "AddOnCallPolicyIncidentRole1809187660000",
    );
    expect(new AddOnCallPolicyIncidentRoleIndexAndKey1809187660010().name).toBe(
      "AddOnCallPolicyIncidentRoleIndexAndKey1809187660010",
    );
  });
});
