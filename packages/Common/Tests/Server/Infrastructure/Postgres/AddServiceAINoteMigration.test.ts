import { RecordActorUtil } from "../../../../Types/Database/RecordActor";
import { AddServiceAINote1809185918000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185918000-AddServiceAINote";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ServiceAINote from "../../../../Models/DatabaseModels/ServiceAINote";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import {
  DefaultNamingStrategy,
  MigrationInterface,
  QueryRunner,
} from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind ServiceAINote (#7672): the table a service's notes
 * for OneUptime AI are kept in.
 *
 * The table is new, so its indexes are built and its keys checked on no
 * rows; no existing row is read or written. Its names are TypeORM's own
 * (DefaultNamingStrategy), as the generator wrote them, so the schema drift
 * check finds the model and the database alike. Statements are recorded
 * against a fake QueryRunner.
 */

const MIGRATION_NAME: string = "AddServiceAINote1809185918000";
const TABLE: string = "ServiceAINote";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;
// A column of a CREATE TABLE: its quoted name, then its type.
const CREATED_COLUMN: RegExp = /(?:\(|, )"([A-Za-z_]+)" [A-Za-z]/g;
const CREATE_TABLE: RegExp = /^CREATE TABLE "([A-Za-z]+)"/;
const DROP_TABLE: RegExp = /^DROP TABLE "([A-Za-z]+)"$/;
const ADD_CONSTRAINT: RegExp = /ADD CONSTRAINT "([A-Za-z0-9_]+)"/;
const DROP_CONSTRAINT: RegExp = /DROP CONSTRAINT "([A-Za-z0-9_]+)"$/;
const CREATE_INDEX: RegExp = /^CREATE INDEX "([A-Za-z0-9_]+)"/;
const DROP_INDEX: RegExp = /^DROP INDEX "public"\."([A-Za-z0-9_]+)"$/;
const TABLE_STATEMENT: RegExp = /^(ALTER|DROP|CREATE) TABLE/;
const ROW_STATEMENT: RegExp = /^\s*(UPDATE|INSERT|DELETE|SELECT)\b/i;

const NAMING: DefaultNamingStrategy = new DefaultNamingStrategy();

type MigrationClass = new () => MigrationInterface;

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];
  const runner: QueryRunner = {
    isTransactionActive: true,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: AddServiceAINote1809185918000 =
    new AddServiceAINote1809185918000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

function timestampOf(migration: MigrationClass): number {
  const match: RegExpMatchArray | null =
    migration.name.match(TRAILING_TIMESTAMP);

  return match ? parseInt(match[1]!, 10) : 0;
}

function named(steps: Array<string>, pattern: RegExp): Array<string> {
  return steps.flatMap((step: string): Array<string> => {
    const match: RegExpMatchArray | null = step.match(pattern);

    return match ? [match[1]!] : [];
  });
}

function createStatement(steps: Array<string>): string {
  const statement: string | undefined = steps.find((step: string) => {
    return step.startsWith(`CREATE TABLE "${TABLE}" `);
  });

  expect(statement).toBeDefined();

  return statement!;
}

describe("the Service AI Note migration", () => {
  test("names itself after its timestamp", () => {
    expect(new AddServiceAINote1809185918000().name).toBe(MIGRATION_NAME);
  });

  test("is registered once, after every earlier migration", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(AddServiceAINote1809185918000);

    expect(
      registered.filter((candidate: MigrationClass): boolean => {
        return candidate === AddServiceAINote1809185918000;
      }),
    ).toHaveLength(1);
    // Not pinned to a neighbour: a migration main adds later may land next to it.
    expect(at).toBeGreaterThan(0);

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddServiceAINote1809185918000),
      );
    }
  });

  test("is backed by exactly one file", () => {
    const files: Array<string> = fs.readdirSync(
      path.join(
        __dirname,
        "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
      ),
    );

    expect(
      files.filter((file: string): boolean => {
        return file.startsWith(
          `${timestampOf(AddServiceAINote1809185918000)}-`,
        );
      }),
    ).toEqual(["1809185918000-AddServiceAINote.ts"]);
  });

  test("creates the table with every column the model stores", async () => {
    const note: ServiceAINote = new ServiceAINote();
    const stored: Array<string> = Object.keys(getTableColumns(note))
      .filter((column: string): boolean => {
        return !note.isEntityColumn(column);
      })
      .filter((column: string): boolean => {
        // Added to every table later (AddRecordCreatedByAndLastModifiedColumns, #10290).
        return !RecordActorUtil.isColumn(column);
      })
      .sort();

    const created: Array<string> = Array.from(
      createStatement(await record("up")).matchAll(CREATED_COLUMN),
    )
      .map((match: RegExpMatchArray): string => {
        return match[1]!;
      })
      .sort();

    expect(created).toEqual(stored);
    expect(created).toEqual(
      expect.arrayContaining(["projectId", "serviceId", "note"]),
    );
  });

  test("the project, the service and the note are required", async () => {
    const statement: string = createStatement(await record("up"));

    expect(statement).toContain(`"projectId" uuid NOT NULL`);
    expect(statement).toContain(`"serviceId" uuid NOT NULL`);
    expect(statement).toContain(`"note" character varying NOT NULL`);
    expect(statement).toContain(`"createdByUserId" uuid,`);
    expect(statement).toContain(
      `CONSTRAINT "${NAMING.primaryKeyName(TABLE, ["_id"])}" PRIMARY KEY ("_id")`,
    );
  });

  test("indexes the project, and a service's notes by when they were written, under TypeORM's names", async () => {
    expect(
      (await record("up")).filter((step: string): boolean => {
        return CREATE_INDEX.test(step);
      }),
    ).toEqual([
      `CREATE INDEX "${NAMING.indexName(TABLE, ["projectId"])}" ON "${TABLE}" ("projectId") `,
      `CREATE INDEX "${NAMING.indexName(TABLE, ["serviceId", "createdAt"])}" ON "${TABLE}" ("serviceId", "createdAt") `,
    ]);
  });

  test("a deleted project or service takes its notes with it; a deleted person leaves them", async () => {
    const steps: Array<string> = await record("up");

    expect(
      steps.filter((step: string): boolean => {
        return ADD_CONSTRAINT.test(step);
      }),
    ).toEqual([
      `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${NAMING.foreignKeyName(TABLE, ["projectId"])}" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${NAMING.foreignKeyName(TABLE, ["serviceId"])}" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${NAMING.foreignKeyName(TABLE, ["createdByUserId"])}" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${NAMING.foreignKeyName(TABLE, ["deletedByUserId"])}" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    ]);
  });

  test("creates the table first, then its indexes, then its keys", async () => {
    const steps: Array<string> = await record("up");

    expect(steps).toHaveLength(7);
    expect(CREATE_TABLE.test(steps[0]!)).toBe(true);
    expect(named(steps, CREATE_TABLE)).toEqual([TABLE]);
  });

  test("touches no other table, and reads and writes no row", async () => {
    for (const step of [...(await record("up")), ...(await record("down"))]) {
      expect(step).not.toMatch(ROW_STATEMENT);
      expect(step).toMatch(
        new RegExp(
          `^(CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE INDEX .* ON|DROP INDEX)`,
        ),
      );

      if (TABLE_STATEMENT.test(step)) {
        expect(step).toMatch(
          new RegExp(`^(ALTER|DROP|CREATE) TABLE "${TABLE}"`),
        );
      }
    }
  });

  test("down drops exactly what up made, keys first and the table last", async () => {
    const up: Array<string> = await record("up");
    const down: Array<string> = await record("down");

    expect(named(down, DROP_TABLE)).toEqual(named(up, CREATE_TABLE));
    expect(named(down, DROP_CONSTRAINT).sort()).toEqual(
      named(up, ADD_CONSTRAINT).sort(),
    );
    expect(named(down, DROP_INDEX).sort()).toEqual(
      named(up, CREATE_INDEX).sort(),
    );

    const lastKey: number = Math.max(
      ...down.map((step: string, index: number): number => {
        return DROP_CONSTRAINT.test(step) ? index : -1;
      }),
    );
    const firstIndex: number = down.findIndex((step: string): boolean => {
      return DROP_INDEX.test(step);
    });

    expect(lastKey).toBeLessThan(firstIndex);
    expect(down[down.length - 1]).toBe(`DROP TABLE "${TABLE}"`);
  });
});
