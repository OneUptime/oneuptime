import { MigrationName1768825402472 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1768825402472-MigrationName";
import { StartIncomingCallRulesAtTwentySeconds1798500000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1798500000000-StartIncomingCallRulesAtTwentySeconds";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import IncomingCallPolicyEscalationRule from "../../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import { DEFAULT_INCOMING_CALL_RING_SECONDS } from "../../../../Types/IncomingCall/IncomingCallRingTime";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * New incoming call escalation rules ring for 20 seconds, not 30.
 *
 * The maintainer's decision: a new rule rings for 20 seconds, so the call
 * moves on before most voicemail picks up and "answers" it, and existing
 * rules keep the ring time they hold. This migration makes the database
 * agree with the model for every rule created from now on - the API and
 * Terraform leave the column out when a rule does not set it, and Postgres
 * fills the default in - and deliberately does nothing else:
 *
 *   - it changes the column default and no row. A rule that rings for 30 may
 *     be the old default or a deliberate choice, and the table cannot tell
 *     them apart;
 *   - down() puts back exactly the default the column was created with.
 *
 * Fake QueryRunner only. The Schema Drift job applies it to a real database,
 * and StartIncomingCallRulesAtTwentySecondsPostgres.test.ts runs it on real
 * rows.
 */

const MIGRATION_NAME: string =
  "StartIncomingCallRulesAtTwentySeconds1798500000000";
const TIMESTAMP: number = 1798500000000;

const UP: string = `ALTER TABLE "IncomingCallPolicyEscalationRule" ALTER COLUMN "escalateAfterSeconds" SET DEFAULT '20'`;
const DOWN: string = `ALTER TABLE "IncomingCallPolicyEscalationRule" ALTER COLUMN "escalateAfterSeconds" SET DEFAULT '30'`;

type MigrationClass = new () => {
  up: (queryRunner: QueryRunner) => Promise<void>;
  down: (queryRunner: QueryRunner) => Promise<void>;
};

async function recordQueries(
  migration: MigrationClass,
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new migration()[direction](queryRunner);

  return statements;
}

function registeredNames(): Array<string> {
  return (SchemaMigrations as unknown as Array<{ name: string }>).map(
    (registered: { name: string }): string => {
      return registered.name;
    },
  );
}

function timestampOf(className: string): number | null {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
}

// What the model's @Column declares as the database default.
function storedRingColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (candidate: ColumnMetadataArgs): boolean => {
      return (
        (candidate.target as unknown) === IncomingCallPolicyEscalationRule &&
        candidate.propertyName === "escalateAfterSeconds"
      );
    },
  );
}

// The statement that created the IncomingCallPolicyEscalationRule table.
async function createTableStatement(): Promise<string> {
  const statement: string | undefined = (
    await recordQueries(MigrationName1768825402472, "up")
  ).find((candidate: string): boolean => {
    return candidate.startsWith(
      `CREATE TABLE "IncomingCallPolicyEscalationRule"`,
    );
  });

  expect(statement).toBeDefined();

  return statement as string;
}

describe("StartIncomingCallRulesAtTwentySeconds1798500000000", () => {
  test("is registered once, under the name its class carries", () => {
    expect(new StartIncomingCallRulesAtTwentySeconds1798500000000().name).toBe(
      MIGRATION_NAME,
    );
    expect(SchemaMigrations).toContain(
      StartIncomingCallRulesAtTwentySeconds1798500000000,
    );
    expect(
      registeredNames().filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
  });

  test("runs after the migration that created the table", () => {
    const names: Array<string> = registeredNames();

    expect(names.indexOf("MigrationName1768825402472")).toBeGreaterThan(-1);
    expect(names.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      names.indexOf("MigrationName1768825402472"),
    );
  });

  test("its timestamp keeps it behind every migration registered before it", () => {
    const names: Array<string> = registeredNames();
    const ownIndex: number = names.indexOf(MIGRATION_NAME);

    expect(ownIndex).toBeGreaterThan(0);

    const notBehind: Array<string> = names
      .slice(0, ownIndex)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOf(className);
        return timestamp !== null && timestamp >= TIMESTAMP;
      });

    expect(notBehind).toEqual([]);
  });

  /*
   * Pinned as "nothing registered after it is older" rather than "it is
   * last", which the next migration would falsify without touching this
   * table.
   */
  test("nothing registered after it is older than it", () => {
    const names: Array<string> = registeredNames();
    const ownIndex: number = names.indexOf(MIGRATION_NAME);

    const olderAfter: Array<string> = names
      .slice(ownIndex + 1)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOf(className);
        return timestamp === null || timestamp <= TIMESTAMP;
      });

    expect(olderAfter).toEqual([]);
  });

  test("up() starts a new rule at 20 seconds, and does nothing else", async () => {
    expect(
      await recordQueries(
        StartIncomingCallRulesAtTwentySeconds1798500000000,
        "up",
      ),
    ).toEqual([UP]);
  });

  test("down() puts the 30 second default back, and does nothing else", async () => {
    expect(
      await recordQueries(
        StartIncomingCallRulesAtTwentySeconds1798500000000,
        "down",
      ),
    ).toEqual([DOWN]);
  });

  test("never writes a row: existing rules keep the ring time they hold", async () => {
    const statements: Array<string> = [
      ...(await recordQueries(
        StartIncomingCallRulesAtTwentySeconds1798500000000,
        "up",
      )),
      ...(await recordQueries(
        StartIncomingCallRulesAtTwentySeconds1798500000000,
        "down",
      )),
    ];

    for (const statement of statements) {
      // A catalog change only: no row is written, no column re-created.
      expect(statement).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
      expect(statement).not.toMatch(/\b(ADD|DROP)\s+(COLUMN\s+)?"/i);
      expect(statement).not.toMatch(/\bSET NOT NULL\b|\bDROP NOT NULL\b/i);
      expect(statement).not.toMatch(/\bTYPE\b/i);
    }
  });

  /*
   * down() must land where the table's own migration left the column, or a
   * rollback would leave a default no migration ever declared.
   */
  test("down() restores the default the column was created with", async () => {
    expect(await createTableStatement()).toContain(
      `"escalateAfterSeconds" integer NOT NULL DEFAULT '30'`,
    );
    expect(DOWN).toContain(`SET DEFAULT '30'`);
  });

  // The Schema Drift job would catch a mismatch too, but only in CI.
  test("the default up() sets is the one the model declares", () => {
    const stored: ColumnMetadataArgs | undefined = storedRingColumn();

    expect(stored?.options.default).toBe(DEFAULT_INCOMING_CALL_RING_SECONDS);
    expect(stored?.options.nullable).toBe(false);
    expect(
      new IncomingCallPolicyEscalationRule().getTableColumnMetadata(
        "escalateAfterSeconds",
      ).defaultValue,
    ).toBe(DEFAULT_INCOMING_CALL_RING_SECONDS);
    expect(UP).toContain(`SET DEFAULT '${DEFAULT_INCOMING_CALL_RING_SECONDS}'`);
  });
});
