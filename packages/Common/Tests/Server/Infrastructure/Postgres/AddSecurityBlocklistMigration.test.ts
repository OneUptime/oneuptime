import { AddSecurityBlocklist1809187150000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187150000-AddSecurityBlocklist";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Probe from "../../../../Models/DatabaseModels/Probe";
import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import { RecordActorUtil } from "../../../../Types/Database/RecordActor";
import { describe, expect, test } from "@jest/globals";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * The migration behind the blocklist (#10338): SecurityBlock, one address
 * or range a project blocks, SecurityBlockEnforcement, where each block is
 * enforced, and Probe.egressIpAddress, the address a probe checks in from.
 *
 * The SQL is generated, and the schema-drift check (npm run
 * check-postgres-schema-drift, and CI's Postgres Schema Drift job) proves it
 * matches the models. This pins what a regeneration could silently reverse,
 * which no functional test would notice:
 *
 *  1. ONE ACTIVE BLOCK PER VALUE. (projectId, value) is UNIQUE among the
 *     active rows only: two people blocking an address at once make one
 *     block, and a lifted or expired block leaves room for the next.
 *  2. ONE ENFORCEMENT ROW PER BLOCK PER DESTINATION, so two reconciles
 *     racing never say a block is applied twice.
 *  3. THE EXPIRY SWEEP READS AN INDEX OF THE ACTIVE BLOCKS' ENDS only.
 *  4. A BLOCK GOES WITH ITS PROJECT, AND ITS ENFORCEMENT WITH THE BLOCK;
 *     a deleted case, playbook run or person leaves the block, unlinked.
 *  5. EVERY BLOCK MAY BE KEPT UNTIL LIFTED: expiresAt is nullable, and the
 *     server holds who may leave it empty.
 *  6. Probe's new column is nullable with no default, so no probe row is
 *     rewritten; both tables are new, so their indexes and keys are made on
 *     empty tables, with no online DDL.
 *  7. down() undoes up() in reverse, and the migration runs after every
 *     migration before it.
 */

const CLASS_NAME: string = "AddSecurityBlocklist1809187150000";
const TIMESTAMP: number = 1809187150000;

// A migration class's stamp, at the end of its name.
const STAMP: RegExp = /(\d{13})$/;

// The table an ALTER TABLE statement changes.
const ALTERED_TABLE: RegExp = /^ALTER TABLE "([^"]+)"/;

type MigrationClass = new () => MigrationInterface;

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement.trim());
    },
  } as unknown as QueryRunner;

  await new AddSecurityBlocklist1809187150000()[direction](queryRunner);

  return statements;
}

function createTableOf(statements: Array<string>, table: string): string {
  const found: string | undefined = statements.find((text: string) => {
    return text.startsWith(`CREATE TABLE "${table}"`);
  });

  if (!found) {
    throw new Error(`up() does not create ${table}.`);
  }

  return found;
}

// The columns a CREATE TABLE makes, by name, with what follows each name.
function columnsOf(createTable: string): Map<string, string> {
  const body: string = createTable.slice(
    createTable.indexOf("(") + 1,
    createTable.indexOf(", CONSTRAINT"),
  );

  const columns: Map<string, string> = new Map();

  for (const part of body.split(/, (?=")/)) {
    const match: RegExpMatchArray | null = part.match(/^"([^"]+)" (.+)$/);

    if (match) {
      columns.set(match[1] as string, match[2] as string);
    }
  }

  return columns;
}

// The model's columns, with those every model has from the classes it extends (_id, createdAt...).
function declaredColumns(model: unknown): Array<string> {
  const classes: Array<unknown> = [];

  for (
    let current: unknown = model;
    typeof current === "function" && current !== Function.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    classes.push(current);
  }

  return getMetadataArgsStorage()
    .columns.filter((column: ColumnMetadataArgs): boolean => {
      return classes.includes(column.target);
    })
    .map((column: ColumnMetadataArgs): string => {
      return column.propertyName;
    })
    .filter((column: string): boolean => {
      // Added to every table later (AddRecordCreatedByAndLastModifiedColumns, #10290).
      return !RecordActorUtil.isColumn(column);
    })
    .filter((column: string): boolean => {
      // Added to SecurityBlock later (AddSecurityBlockReachAndWiderValue, #10346).
      return !(model === SecurityBlock && column === "reach");
    })
    .filter((column: string): boolean => {
      // Added to SecurityBlockEnforcement later (AddCloudWafAndEnforcementReasons, #10629).
      return !(model === SecurityBlockEnforcement && column === "errorReason");
    })
    .filter((column: string): boolean => {
      // Added to SecurityBlock later (AddSecurityAutomaticResponse, #10350).
      return !(
        model === SecurityBlock &&
        AUTOMATIC_RESPONSE_COLUMNS.includes(column)
      );
    });
}

// What automatic response (#10350) added to a block: the policy that made it, and whether its challenge is held as a block where an edge cannot challenge.
const AUTOMATIC_RESPONSE_COLUMNS: ReadonlyArray<string> = [
  "securityAutomaticResponsePolicyId",
  "challengeFallsBackToBlock",
];

// The model's own indexes (@Index on the class), as the generator words each.
function declaredIndexes(model: unknown): Array<{
  columns: Array<string>;
  unique: boolean;
  where: string | undefined;
}> {
  return getMetadataArgsStorage()
    .indices.filter((index: IndexMetadataArgs): boolean => {
      return index.target === model && Array.isArray(index.columns);
    })
    .filter((index: IndexMetadataArgs): boolean => {
      // One active block per value and reach is built later (AddSecurityBlockValueReachIndex, #10346).
      return !(index.columns as Array<string>).includes("reach");
    })
    .filter((index: IndexMetadataArgs): boolean => {
      // The blocks a policy made are found by it later (AddSecurityAutomaticResponseIndexesAndKeys, #10350).
      return !(index.columns as Array<string>).some((column: string) => {
        return AUTOMATIC_RESPONSE_COLUMNS.includes(column);
      });
    })
    .map((index: IndexMetadataArgs) => {
      return {
        columns: index.columns as Array<string>,
        unique: Boolean(index.unique),
        where: index.where,
      };
    });
}

function indexStatement(
  statements: Array<string>,
  table: string,
  columns: Array<string>,
): string | undefined {
  const onColumns: string = `ON "${table}" (${columns
    .map((column: string): string => {
      return `"${column}"`;
    })
    .join(", ")})`;

  return statements.find((text: string): boolean => {
    return (
      (text.startsWith("CREATE INDEX") ||
        text.startsWith("CREATE UNIQUE INDEX")) &&
      text.includes(onColumns)
    );
  });
}

function foreignKeyOf(
  statements: Array<string>,
  table: string,
  column: string,
): string {
  const found: string | undefined = statements.find((text: string) => {
    return (
      text.startsWith(`ALTER TABLE "${table}" ADD CONSTRAINT`) &&
      text.includes(`FOREIGN KEY ("${column}")`)
    );
  });

  if (!found) {
    throw new Error(`up() adds no key on ${table}.${column}.`);
  }

  return found;
}

describe("AddSecurityBlocklist migration - identity and registration", () => {
  test("its class, name and stamp agree", () => {
    expect(new AddSecurityBlocklist1809187150000().name).toBe(CLASS_NAME);
    expect(AddSecurityBlocklist1809187150000.name).toBe(CLASS_NAME);
  });

  test("is registered once, after every migration before it", () => {
    const names: Array<string> = (
      SchemaMigrations as unknown as Array<MigrationClass>
    ).map((migration: MigrationClass): string => {
      return migration.name;
    });

    const index: number = names.indexOf(CLASS_NAME);

    expect(index).toBeGreaterThan(-1);
    expect(names.lastIndexOf(CLASS_NAME)).toBe(index);

    for (const earlier of names.slice(0, index)) {
      const stamp: number = Number(STAMP.exec(earlier)?.[1] || 0);
      expect(stamp).toBeLessThan(TIMESTAMP);
    }
  });
});

describe("AddSecurityBlocklist migration - what it makes", () => {
  test("SecurityBlock has every column the model declares, and none it does not", async () => {
    const up: Array<string> = await recordQueries("up");
    const columns: Map<string, string> = columnsOf(
      createTableOf(up, "SecurityBlock"),
    );

    expect([...columns.keys()].sort()).toEqual(
      declaredColumns(SecurityBlock).sort(),
    );
  });

  test("SecurityBlockEnforcement has every column the model declares, and none it does not", async () => {
    const up: Array<string> = await recordQueries("up");
    const columns: Map<string, string> = columnsOf(
      createTableOf(up, "SecurityBlockEnforcement"),
    );

    expect([...columns.keys()].sort()).toEqual(
      declaredColumns(SecurityBlockEnforcement).sort(),
    );
  });

  test("a block's value, kind, action, state and source are required; its end, reason and case are not", async () => {
    const up: Array<string> = await recordQueries("up");
    const columns: Map<string, string> = columnsOf(
      createTableOf(up, "SecurityBlock"),
    );

    expect(columns.get("value")).toBe("character varying(100) NOT NULL");
    expect(columns.get("indicatorType")).toBe(
      "character varying(100) NOT NULL",
    );
    expect(columns.get("action")).toBe(
      "character varying(100) NOT NULL DEFAULT 'Block'",
    );
    expect(columns.get("state")).toBe(
      "character varying(100) NOT NULL DEFAULT 'Active'",
    );
    expect(columns.get("source")).toBe(
      "character varying(100) NOT NULL DEFAULT 'Person'",
    );

    // Kept until lifted is an empty end; the server holds who may leave it so.
    expect(columns.get("expiresAt")).toBe("TIMESTAMP WITH TIME ZONE");
    expect(columns.get("reason")).toBe("character varying(500)");
    expect(columns.get("liftReason")).toBe("character varying(500)");
    expect(columns.get("securityCaseId")).toBe("uuid");
    expect(columns.get("liftedAt")).toBe("TIMESTAMP WITH TIME ZONE");
  });

  test("an enforcement row starts Pending, with no failures", async () => {
    const up: Array<string> = await recordQueries("up");
    const columns: Map<string, string> = columnsOf(
      createTableOf(up, "SecurityBlockEnforcement"),
    );

    expect(columns.get("state")).toBe(
      "character varying(100) NOT NULL DEFAULT 'Pending'",
    );
    expect(columns.get("failedAttempts")).toBe("integer NOT NULL DEFAULT '0'");
    expect(columns.get("securityBlockId")).toBe("uuid NOT NULL");
    expect(columns.get("destinationKey")).toBe(
      "character varying(500) NOT NULL",
    );
    expect(columns.get("lastConfirmedAt")).toBe("TIMESTAMP WITH TIME ZONE");
  });

  test("one active block per value in a project: unique among the active rows only", async () => {
    const up: Array<string> = await recordQueries("up");
    const unique: string | undefined = indexStatement(up, "SecurityBlock", [
      "projectId",
      "value",
    ]);

    expect(unique).toBeDefined();
    expect(unique!.startsWith("CREATE UNIQUE INDEX")).toBe(true);
    expect(unique).toMatch(/WHERE "state" = 'Active' AND "deletedAt" IS NULL$/);
  });

  test("one enforcement row per block per destination", async () => {
    const up: Array<string> = await recordQueries("up");
    const unique: string | undefined = indexStatement(
      up,
      "SecurityBlockEnforcement",
      ["securityBlockId", "destinationKey"],
    );

    expect(unique).toBeDefined();
    expect(unique!.startsWith("CREATE UNIQUE INDEX")).toBe(true);
    expect(unique).toMatch(/WHERE "deletedAt" IS NULL$/);
  });

  test("the expiry sweep reads an index of the active blocks' ends", async () => {
    const up: Array<string> = await recordQueries("up");
    const sweep: string | undefined = indexStatement(up, "SecurityBlock", [
      "expiresAt",
    ]);

    expect(sweep).toBeDefined();
    expect(sweep).toMatch(/WHERE "state" = 'Active' AND "deletedAt" IS NULL$/);
  });

  test("every index the models declare is made, as they declare it", async () => {
    const up: Array<string> = await recordQueries("up");

    for (const [table, model] of [
      ["SecurityBlock", SecurityBlock],
      ["SecurityBlockEnforcement", SecurityBlockEnforcement],
    ] as Array<[string, unknown]>) {
      const declared: ReturnType<typeof declaredIndexes> =
        declaredIndexes(model);

      expect(declared.length).toBeGreaterThan(0);

      for (const index of declared) {
        const made: string | undefined = indexStatement(
          up,
          table,
          index.columns,
        );

        expect(made).toBeDefined();
        expect(made!.startsWith("CREATE UNIQUE INDEX")).toBe(index.unique);

        if (index.where) {
          expect(made!.endsWith(`WHERE ${index.where}`)).toBe(true);
        }
      }
    }
  });

  test("a block goes with its project, and its enforcement with the block", async () => {
    const up: Array<string> = await recordQueries("up");

    expect(foreignKeyOf(up, "SecurityBlock", "projectId")).toContain(
      `REFERENCES "Project"("_id") ON DELETE CASCADE`,
    );
    expect(foreignKeyOf(up, "SecurityBlockEnforcement", "projectId")).toContain(
      `REFERENCES "Project"("_id") ON DELETE CASCADE`,
    );
    expect(
      foreignKeyOf(up, "SecurityBlockEnforcement", "securityBlockId"),
    ).toContain(`REFERENCES "SecurityBlock"("_id") ON DELETE CASCADE`);
  });

  test("a deleted case, playbook run or person leaves the block, unlinked", async () => {
    const up: Array<string> = await recordQueries("up");

    expect(foreignKeyOf(up, "SecurityBlock", "securityCaseId")).toContain(
      `REFERENCES "SecurityCase"("_id") ON DELETE SET NULL`,
    );
    expect(
      foreignKeyOf(up, "SecurityBlock", "securityPlaybookRunId"),
    ).toContain(`REFERENCES "SecurityPlaybookRun"("_id") ON DELETE SET NULL`);
    expect(foreignKeyOf(up, "SecurityBlock", "createdByUserId")).toContain(
      `REFERENCES "User"("_id") ON DELETE SET NULL`,
    );
    expect(foreignKeyOf(up, "SecurityBlock", "liftedByUserId")).toContain(
      `REFERENCES "User"("_id") ON DELETE SET NULL`,
    );
  });

  test("a probe's address in is a nullable column with no default, on the model", async () => {
    const up: Array<string> = await recordQueries("up");

    expect(up).toContain(
      `ALTER TABLE "Probe" ADD "egressIpAddress" character varying(100)`,
    );
    expect(declaredColumns(Probe)).toContain("egressIpAddress");
  });

  test("touches no table that holds data but Probe, and Probe only by adding a column", async () => {
    const up: Array<string> = await recordQueries("up");

    for (const text of up) {
      if (
        text.startsWith("CREATE INDEX") ||
        text.startsWith("CREATE UNIQUE INDEX")
      ) {
        expect(text).toMatch(/ON "(SecurityBlock|SecurityBlockEnforcement)" /);
        // Built with the empty table, in the migration's transaction.
        expect(text).not.toContain("CONCURRENTLY");
      }

      if (text.startsWith("ALTER TABLE")) {
        expect(text).toMatch(
          /^ALTER TABLE "(SecurityBlock|SecurityBlockEnforcement)" ADD CONSTRAINT|^ALTER TABLE "Probe" ADD "egressIpAddress"/,
        );
      }
    }
  });
});

describe("AddSecurityBlocklist migration - down()", () => {
  test("drops every key, index, column and table up() made, keys first, the enforcement table before the blocks", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    const constraintName: RegExp = /ADD CONSTRAINT "([^"]+)"/;
    const indexName: RegExp = /INDEX "([^"]+)"/;

    for (const text of up) {
      const key: string | undefined = constraintName.exec(text)?.[1];

      if (key) {
        const table: string = ALTERED_TABLE.exec(text)![1]!;
        expect(down).toContain(
          `ALTER TABLE "${table}" DROP CONSTRAINT "${key}"`,
        );
      }

      const index: string | undefined = text.startsWith("CREATE")
        ? indexName.exec(text)?.[1]
        : undefined;

      if (index) {
        expect(down).toContain(`DROP INDEX "public"."${index}"`);
      }
    }

    expect(down).toContain(`ALTER TABLE "Probe" DROP COLUMN "egressIpAddress"`);

    const lastKey: number = Math.max(
      ...down
        .map((text: string, at: number): number => {
          return text.includes("DROP CONSTRAINT") ? at : -1;
        })
        .filter((at: number): boolean => {
          return at >= 0;
        }),
    );
    const enforcementDropped: number = down.indexOf(
      `DROP TABLE "SecurityBlockEnforcement"`,
    );
    const blocksDropped: number = down.indexOf(`DROP TABLE "SecurityBlock"`);

    expect(enforcementDropped).toBeGreaterThan(lastKey);
    expect(blocksDropped).toBeGreaterThan(enforcementDropped);
    expect(down[down.length - 1]).toBe(`DROP TABLE "SecurityBlock"`);
  });

  test("runs as many statements as up(), one undoing each", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    expect(down).toHaveLength(up.length);
  });
});
