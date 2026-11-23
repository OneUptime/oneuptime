import { AddSecurityAutomaticResponse1809187480000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187480000-AddSecurityAutomaticResponse";
import { AddSecurityAutomaticResponseIndexesAndKeys1809187480010 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187480010-AddSecurityAutomaticResponseIndexesAndKeys";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { describe, expect, jest, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The migrations behind automatic response (#10350): the policies and what
 * each did (SecurityAutomaticResponsePolicy, SecurityAutomaticResponseAction),
 * and the columns the blocklist, the playbook engine and a case keep of
 * them.
 *
 * The SQL is generated, and the schema-drift check proves it matches the
 * models. This pins what a regeneration could silently reverse:
 *
 *  1. A POLICY STARTS OFF, and a block falls back to nothing until a
 *     policy says so: the defaults every existing row and every new one
 *     take.
 *  2. WHAT A POLICY DID GOES WITH THE POLICY AND THE CASE, and outlives the
 *     block and the run it points at; a block and a run outlive the policy.
 *  3. THE TABLES THAT HOLD DATA ARE CHANGED WITHOUT BLOCKING THEM: their new
 *     columns are nullable or have a constant default, and the index and
 *     keys on the blocklist and the runs are built online, in a migration
 *     of their own that runs outside a transaction.
 *  4. down() undoes up(), and the two run in order, after every migration
 *     before them.
 */

type MigrationClass = new () => MigrationInterface;

// The table an ALTER TABLE statement changes, and a migration's stamp at the end of its name.
const ALTER_TABLE: RegExp = /^ALTER TABLE "([^"]+)"/;
const STAMP: RegExp = /(\d{13})$/;

async function recordQueries(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];
  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<Array<unknown>> => {
      statements.push(statement.trim());
      return [];
    },
    // OnlineDdl runs its statements on the connection itself, with limits.
    connect: async (): Promise<unknown> => {
      return {
        query: async (statement: {
          text: string;
        }): Promise<{ rows: Array<unknown> }> => {
          statements.push(statement.text.trim());
          return { rows: [] };
        },
      };
    },
  } as unknown as QueryRunner;

  await migration[direction](queryRunner);

  return statements;
}

function createTableOf(statements: Array<string>, table: string): string {
  const found: string | undefined = statements.find((text: string) => {
    return text.startsWith(`CREATE TABLE "${table}" (`);
  });

  expect({ table, created: Boolean(found) }).toEqual({ table, created: true });
  return found!;
}

describe("AddSecurityAutomaticResponse1809187480000", () => {
  test("a policy starts off, and a block holds a challenge as a block only when a policy says so", async () => {
    const up: Array<string> = await recordQueries(
      new AddSecurityAutomaticResponse1809187480000(),
      "up",
    );
    const policy: string = createTableOf(up, "SecurityAutomaticResponsePolicy");

    expect(policy).toContain(
      `"mode" character varying(100) NOT NULL DEFAULT 'Off'`,
    );
    expect(policy).toContain(
      `"kind" character varying(100) NOT NULL DEFAULT 'Custom'`,
    );
    createTableOf(up, "SecurityAutomaticResponseAction");
    expect(up).toContain(
      `ALTER TABLE "SecurityBlock" ADD "challengeFallsBackToBlock" boolean NOT NULL DEFAULT false`,
    );
  });

  test("what a policy did goes with the policy and the case, and outlives the block and the run", async () => {
    const up: Array<string> = await recordQueries(
      new AddSecurityAutomaticResponse1809187480000(),
      "up",
    );
    const keyTo: (column: string) => string | undefined = (
      column: string,
    ): string | undefined => {
      return up.find((statement: string): boolean => {
        return (
          statement.startsWith(
            `ALTER TABLE "SecurityAutomaticResponseAction" ADD CONSTRAINT`,
          ) && statement.includes(`FOREIGN KEY ("${column}")`)
        );
      });
    };

    expect(keyTo("securityAutomaticResponsePolicyId")).toContain(
      "ON DELETE CASCADE",
    );
    expect(keyTo("securityCaseId")).toContain("ON DELETE CASCADE");
    expect(keyTo("projectId")).toContain("ON DELETE CASCADE");
    expect(keyTo("securityBlockId")).toContain("ON DELETE SET NULL");
    expect(keyTo("securityPlaybookRunId")).toContain("ON DELETE SET NULL");
  });

  test("the tables that hold data get nullable columns, or one with a constant default, and nothing else", async () => {
    const up: Array<string> = await recordQueries(
      new AddSecurityAutomaticResponse1809187480000(),
      "up",
    );
    const busy: Array<string> = [
      "SecurityBlock",
      "SecurityPlaybookRun",
      "SecurityCase",
    ];

    for (const statement of up) {
      const table: string | undefined = ALTER_TABLE.exec(statement)?.[1];

      if (!table || !busy.includes(table)) {
        continue;
      }

      expect(statement).toMatch(
        /^ALTER TABLE "[^"]+" ADD "[^"]+" (uuid|integer|TIMESTAMP WITH TIME ZONE|boolean NOT NULL DEFAULT false)$/,
      );
    }
  });

  test("down() drops what up() made", async () => {
    const down: Array<string> = await recordQueries(
      new AddSecurityAutomaticResponse1809187480000(),
      "down",
    );

    expect(down).toContain(`DROP TABLE "SecurityAutomaticResponseAction"`);
    expect(down).toContain(`DROP TABLE "SecurityAutomaticResponsePolicy"`);
    expect(down).toContain(
      `ALTER TABLE "SecurityBlock" DROP COLUMN "challengeFallsBackToBlock"`,
    );
    // The actions go before the policies they point at.
    expect(
      down.indexOf(`DROP TABLE "SecurityAutomaticResponseAction"`),
    ).toBeLessThan(
      down.indexOf(`DROP TABLE "SecurityAutomaticResponsePolicy"`),
    );
  });
});

describe("AddSecurityAutomaticResponseIndexesAndKeys1809187480010", () => {
  test("builds the blocklist's index and the blocklist's and the runs' keys online, outside a transaction, keeping a block and a run when their policy goes", async () => {
    const migration: AddSecurityAutomaticResponseIndexesAndKeys1809187480010 =
      new AddSecurityAutomaticResponseIndexesAndKeys1809187480010();
    const handed: Array<{ step: string; statement: string }> = [];

    for (const step of ["createIndex", "addForeignKey"] as const) {
      jest.spyOn(OnlineDdl, step).mockImplementation((async (
        _queryRunner: QueryRunner,
        statement: string,
      ): Promise<void> => {
        handed.push({ step, statement });
      }) as never);
    }

    expect(migration.transaction).toBe(false);

    await recordQueries(migration, "up");
    jest.restoreAllMocks();

    expect(handed).toEqual([
      {
        step: "createIndex",
        statement: expect.stringMatching(
          /^CREATE INDEX "IDX_[0-9a-f]+" ON "SecurityBlock" \("securityAutomaticResponsePolicyId"\)/,
        ),
      },
      {
        step: "addForeignKey",
        statement: expect.stringMatching(
          /^ALTER TABLE "SecurityPlaybookRun" ADD CONSTRAINT "FK_[0-9a-f]+" FOREIGN KEY \("securityAutomaticResponsePolicyId"\) REFERENCES "SecurityAutomaticResponsePolicy"\("_id"\) ON DELETE SET NULL/,
        ),
      },
      {
        step: "addForeignKey",
        statement: expect.stringMatching(
          /^ALTER TABLE "SecurityBlock" ADD CONSTRAINT "FK_[0-9a-f]+" FOREIGN KEY \("securityAutomaticResponsePolicyId"\) REFERENCES "SecurityAutomaticResponsePolicy"\("_id"\) ON DELETE SET NULL/,
        ),
      },
    ]);
  });
});

describe("the order they run in", () => {
  test("both run after every migration before them, the keys after the tables", () => {
    const names: Array<string> = (
      SchemaMigrations as unknown as Array<MigrationClass>
    ).map((migration: MigrationClass): string => {
      return migration.name;
    });
    const tables: number = names.indexOf(
      "AddSecurityAutomaticResponse1809187480000",
    );
    const keys: number = names.indexOf(
      "AddSecurityAutomaticResponseIndexesAndKeys1809187480010",
    );

    expect(tables).toBeGreaterThan(-1);
    expect(keys).toBe(tables + 1);

    const stamps: Array<number> = names.map((name: string): number => {
      return Number(STAMP.exec(name)?.[1] || 0);
    });

    for (const stamp of stamps.slice(0, tables)) {
      expect(stamp).toBeLessThan(1809187480000);
    }
  });
});
