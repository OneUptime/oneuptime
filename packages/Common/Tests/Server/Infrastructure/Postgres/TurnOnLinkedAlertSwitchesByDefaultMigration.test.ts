import { AddIncidentAlert1794900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1794900000000-AddIncidentAlert";
import { TurnOnLinkedAlertSwitchesByDefault1797300000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1797300000000-TurnOnLinkedAlertSwitchesByDefault";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Project from "../../../../Models/DatabaseModels/Project";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The linked alert switches on by default.
 *
 * The maintainer asked for "Acknowledge linked alerts when incident is
 * acknowledged" and "Resolve linked alerts when incident is resolved" to be
 * true by default. This migration makes the database agree with the model for
 * every project created from now on, and deliberately does nothing else:
 *
 *   - it changes the two column defaults and no row. An existing project's
 *     false may be the old default or a deliberate "off", and the table cannot
 *     tell them apart; switching it on would change how that project's alerts
 *     are acknowledged and paged without anyone asking;
 *   - down() puts back exactly the defaults AddIncidentAlert created the
 *     columns with.
 *
 * Fake QueryRunner only. The Schema Drift job applies it to a real database,
 * and IncidentAlertPostgres.test.ts reads the migrated defaults back.
 */

const MIGRATION_NAME: string =
  "TurnOnLinkedAlertSwitchesByDefault1797300000000";
const TIMESTAMP: number = 1797300000000;

const SWITCHES: Array<string> = [
  "acknowledgeLinkedAlertsWhenIncidentAcknowledged",
  "resolveLinkedAlertsWhenIncidentResolved",
];

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
function storedDefaultOf(column: string): unknown {
  const stored: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find((candidate: ColumnMetadataArgs) => {
      return candidate.target === Project && candidate.propertyName === column;
    });

  return stored?.options.default;
}

describe("TurnOnLinkedAlertSwitchesByDefault1797300000000", () => {
  test("is registered under the name its class carries", () => {
    expect(new TurnOnLinkedAlertSwitchesByDefault1797300000000().name).toBe(
      MIGRATION_NAME,
    );
    expect(SchemaMigrations).toContain(
      TurnOnLinkedAlertSwitchesByDefault1797300000000,
    );
    expect(
      registeredNames().filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
  });

  test("runs after the migration that created the two columns", () => {
    const names: Array<string> = registeredNames();

    expect(names.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      names.indexOf("AddIncidentAlert1794900000000"),
    );
    expect(names.indexOf("AddIncidentAlert1794900000000")).toBeGreaterThan(0);
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
   * last", which the next migration would falsify without touching Project.
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

  test("up() turns both switches on by default, and does nothing else", async () => {
    expect(
      await recordQueries(
        TurnOnLinkedAlertSwitchesByDefault1797300000000,
        "up",
      ),
    ).toEqual(
      SWITCHES.map((column: string): string => {
        return `ALTER TABLE "Project" ALTER COLUMN "${column}" SET DEFAULT true`;
      }),
    );
  });

  test("up() leaves every existing project's switches as they are", async () => {
    const statements: Array<string> = await recordQueries(
      TurnOnLinkedAlertSwitchesByDefault1797300000000,
      "up",
    );

    for (const statement of statements) {
      // A catalog change only: no row is written, no column re-created.
      expect(statement).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
      expect(statement).not.toMatch(/\b(ADD|DROP)\s+(COLUMN\s+)?"/i);
      expect(statement).not.toMatch(/\bSET NOT NULL\b|\bTYPE\b/i);
    }
  });

  test("down() puts back the defaults in reverse order", async () => {
    const up: Array<string> = await recordQueries(
      TurnOnLinkedAlertSwitchesByDefault1797300000000,
      "up",
    );
    const down: Array<string> = await recordQueries(
      TurnOnLinkedAlertSwitchesByDefault1797300000000,
      "down",
    );

    expect(down).toEqual(
      [...up].reverse().map((statement: string): string => {
        return statement.replace("SET DEFAULT true", "SET DEFAULT false");
      }),
    );
  });

  /*
   * down() must land where AddIncidentAlert left the columns, or a rollback
   * would leave a default no migration ever declared.
   */
  test.each(SWITCHES)(
    "down() restores the default AddIncidentAlert created %s with",
    async (column: string) => {
      const created: string | undefined = (
        await recordQueries(AddIncidentAlert1794900000000, "up")
      ).find((statement: string): boolean => {
        return statement.startsWith(`ALTER TABLE "Project" ADD "${column}"`);
      });

      expect(created).toBe(
        `ALTER TABLE "Project" ADD "${column}" boolean NOT NULL DEFAULT false`,
      );
      expect(
        await recordQueries(
          TurnOnLinkedAlertSwitchesByDefault1797300000000,
          "down",
        ),
      ).toContain(
        `ALTER TABLE "Project" ALTER COLUMN "${column}" SET DEFAULT false`,
      );
    },
  );

  // The Schema Drift job would catch a mismatch too, but only in CI.
  test.each(SWITCHES)(
    "the default up() sets for %s is the one the model declares",
    async (column: string) => {
      expect(storedDefaultOf(column)).toBe(true);
      expect(new Project().getTableColumnMetadata(column).defaultValue).toBe(
        true,
      );
      expect(
        await recordQueries(
          TurnOnLinkedAlertSwitchesByDefault1797300000000,
          "up",
        ),
      ).toContain(
        `ALTER TABLE "Project" ALTER COLUMN "${column}" SET DEFAULT ${String(storedDefaultOf(column))}`,
      );
    },
  );
});
