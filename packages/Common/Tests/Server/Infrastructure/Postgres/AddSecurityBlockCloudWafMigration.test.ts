import { AddSecurityBlockCloudWaf1809187430000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187430000-AddSecurityBlockCloudWaf";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import SecurityBlockCloudWaf from "../../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import { describe, expect, test } from "@jest/globals";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The migration behind the cloud WAFs that enforce a project's blocklist
 * (#10344): SecurityBlockCloudWaf, one AWS WAF web ACL a project picked.
 *
 * The SQL is generated, and the schema-drift check (npm run
 * check-postgres-schema-drift, and CI's Postgres Schema Drift job) proves it
 * matches the model. This pins what a regeneration could silently reverse:
 *
 *  1. ONE ROW A WEB ACL: (projectId, wafId) is unique among the rows not
 *     deleted, so a web ACL picked twice at once is one destination.
 *  2. IT GOES WITH ITS PROJECT AND ITS CONNECTION; the inventory row it was
 *     picked from may go - an inventory archived and pruned - and it stays,
 *     unlinked: it is what keeps OneUptime's rule true in the web ACL.
 *  3. A NEW ROW READS THE SOURCE ADDRESS, AND IS CHECKING until OneUptime
 *     reads the web ACL.
 *  4. A new table, so its indexes and keys are made on it empty, with no
 *     online DDL; down() undoes up() in reverse, and it runs after every
 *     migration before it.
 */

const CLASS_NAME: string = "AddSecurityBlockCloudWaf1809187430000";
const TIMESTAMP: number = 1809187430000;
const TABLE: string = "SecurityBlockCloudWaf";

const STAMP: RegExp = /(\d{13})$/;

type MigrationClass = new () => MigrationInterface;

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement.trim());
    },
  } as unknown as QueryRunner;

  await new AddSecurityBlockCloudWaf1809187430000()[direction](queryRunner);

  return statements;
}

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
    });
}

function foreignKeyOf(statements: Array<string>, column: string): string {
  const found: string | undefined = statements.find((text: string) => {
    return (
      text.startsWith(`ALTER TABLE "${TABLE}" ADD CONSTRAINT`) &&
      text.includes(`FOREIGN KEY ("${column}")`)
    );
  });

  if (!found) {
    throw new Error(`up() adds no key on ${TABLE}.${column}.`);
  }

  return found;
}

describe("AddSecurityBlockCloudWaf migration - identity and registration", () => {
  test("its class, name and stamp agree", () => {
    expect(new AddSecurityBlockCloudWaf1809187430000().name).toBe(CLASS_NAME);
    expect(AddSecurityBlockCloudWaf1809187430000.name).toBe(CLASS_NAME);
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
      expect(Number(STAMP.exec(earlier)?.[1] || 0)).toBeLessThan(TIMESTAMP);
    }
  });
});

describe("AddSecurityBlockCloudWaf migration - what it makes", () => {
  test("the table has every column the model declares, and none it does not", async () => {
    const up: Array<string> = await recordQueries("up");
    const create: string = up.find((text: string): boolean => {
      return text.startsWith(`CREATE TABLE "${TABLE}"`);
    })!;

    expect([...columnsOf(create).keys()].sort()).toEqual(
      declaredColumns(SecurityBlockCloudWaf).sort(),
    );
  });

  test("a new row reads the source address and is checking; its connection, ARN, name and cloud are required", async () => {
    const up: Array<string> = await recordQueries("up");
    const columns: Map<string, string> = columnsOf(
      up.find((text: string): boolean => {
        return text.startsWith(`CREATE TABLE "${TABLE}"`);
      })!,
    );

    expect(columns.get("clientAddress")).toBe(
      "character varying(100) NOT NULL DEFAULT 'SourceIp'",
    );
    expect(columns.get("status")).toBe(
      "character varying(100) NOT NULL DEFAULT 'Checking'",
    );
    expect(columns.get("cloudConnectionId")).toBe("uuid NOT NULL");
    expect(columns.get("wafId")).toBe("character varying(500) NOT NULL");
    expect(columns.get("name")).toBe("character varying(100) NOT NULL");
    expect(columns.get("cloudProvider")).toBe(
      "character varying(100) NOT NULL",
    );
    // Its inventory row may go, and it stays.
    expect(columns.get("cloudResourceId")).toBe("uuid");
    expect(columns.get("statusMessage")).toBe("text");
    expect(columns.get("ruleDetails")).toBe("jsonb");
  });

  test("one row a web ACL in a project, among the rows not deleted", async () => {
    const up: Array<string> = await recordQueries("up");

    expect(up).toContain(
      `CREATE UNIQUE INDEX "IDX_910cf27864b22caaeefc7fc788" ON "${TABLE}" ("projectId", "wafId") WHERE "deletedAt" IS NULL`,
    );
  });

  test("goes with its project and its connection; its inventory row and its creator may go without it", async () => {
    const up: Array<string> = await recordQueries("up");

    expect(foreignKeyOf(up, "projectId")).toContain(
      `REFERENCES "Project"("_id") ON DELETE CASCADE`,
    );
    expect(foreignKeyOf(up, "cloudConnectionId")).toContain(
      `REFERENCES "CloudConnection"("_id") ON DELETE CASCADE`,
    );
    expect(foreignKeyOf(up, "cloudResourceId")).toContain(
      `REFERENCES "CloudResource"("_id") ON DELETE SET NULL`,
    );
    expect(foreignKeyOf(up, "createdByUserId")).toContain(
      `REFERENCES "User"("_id") ON DELETE SET NULL`,
    );
  });

  test("changes no other table: every statement is about its own, or drops one of its own indexes", async () => {
    const up: Array<string> = await recordQueries("up");
    const ownIndexes: Array<string> = up
      .map((text: string): string => {
        return text.match(/^CREATE (?:UNIQUE )?INDEX "([^"]+)"/)?.[1] || "";
      })
      .filter(Boolean);

    for (const statement of [...up, ...(await recordQueries("down"))]) {
      const isOwn: boolean =
        statement.startsWith(`CREATE TABLE "${TABLE}"`) ||
        statement.startsWith(`DROP TABLE "${TABLE}"`) ||
        statement.startsWith(`ALTER TABLE "${TABLE}" `) ||
        (statement.includes(`ON "${TABLE}" (`) &&
          statement.startsWith("CREATE")) ||
        ownIndexes.some((index: string): boolean => {
          return statement === `DROP INDEX "public"."${index}"`;
        });

      expect({ statement, isOwn }).toEqual({ statement, isOwn: true });
    }
  });

  test("down() drops what up() made, keys first and the table last", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");
    const keys: Array<string> = up
      .filter((text: string): boolean => {
        return text.includes("ADD CONSTRAINT");
      })
      .map((text: string): string => {
        return text.match(/ADD CONSTRAINT "([^"]+)"/)![1]!;
      });
    const indexes: Array<string> = up
      .filter((text: string): boolean => {
        return text.startsWith("CREATE");
      })
      .map((text: string): string => {
        return text.match(/INDEX "([^"]+)"/)?.[1] || "";
      })
      .filter(Boolean);

    for (const key of keys) {
      expect(down).toContain(`ALTER TABLE "${TABLE}" DROP CONSTRAINT "${key}"`);
    }

    for (const index of indexes) {
      expect(down).toContain(`DROP INDEX "public"."${index}"`);
    }

    expect(down[down.length - 1]).toBe(`DROP TABLE "${TABLE}"`);
  });
});
