import { MigrationName1725898621366 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1725898621366-MigrationName";
import { MigrationName1725901024444 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1725901024444-MigrationName";
import {
  CLEAR_NEXT_EVENT_OF_TEMPLATES_THAT_DO_NOT_RECUR,
  ClearNextEventOfTemplatesThatDoNotRecur1802800000000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1802800000000-ClearNextEventOfTemplatesThatDoNotRecur";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ScheduledMaintenanceTemplate from "../../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";

/*
 * A scheduled maintenance template with Recurring Event off has no next
 * event.
 *
 * Turning the switch off used to leave the template's next time
 * (scheduleNextEventAt) in place, and the templates list went on promising
 * an event the job would never create. ScheduledMaintenanceTemplateService
 * clears it now; this data migration clears it on the templates already
 * stored that way. What it must hold to:
 *
 *   - it clears the next time, and only that, of every template whose switch
 *     is off - never of a recurring template, which the job still reads;
 *   - nothing of a template's schedule (its first event and interval) is
 *     touched, so a template turned back on is scheduled again;
 *   - registered once, after the migrations that made the two columns what
 *     it reads, and with no rollback: no code reads the time of a template
 *     that does not recur.
 *
 * Fake QueryRunner here. ClearNextEventOfTemplatesThatDoNotRecurPostgres runs
 * the statement on real rows; the Schema Drift job applies it to a migrated
 * database.
 */

const MIGRATION_NAME: string =
  "ClearNextEventOfTemplatesThatDoNotRecur1802800000000";

type MigrationClass = new () => {
  up: (queryRunner: QueryRunner) => Promise<void>;
  down: (queryRunner: QueryRunner) => Promise<void>;
};

async function recordQueries(
  migration: MigrationClass,
  direction: "up" | "down",
): Promise<Array<{ statement: string; parameters: unknown }>> {
  const queries: Array<{ statement: string; parameters: unknown }> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string, parameters?: unknown): Promise<void> => {
      queries.push({ statement, parameters });
    },
  } as unknown as QueryRunner;

  await new migration()[direction](queryRunner);

  return queries;
}

async function upStatements(migration: MigrationClass): Promise<Array<string>> {
  return (await recordQueries(migration, "up")).map(
    (query: { statement: string }): string => {
      return query.statement;
    },
  );
}

function registeredNames(): Array<string> {
  return (SchemaMigrations as unknown as Array<{ name: string }>).map(
    (registered: { name: string }): string => {
      return registered.name;
    },
  );
}

const SET: string = ` SET "scheduleNextEventAt" = NULL `;
const WHERE: string = ` WHERE "isRecurringEvent" = false AND "scheduleNextEventAt" IS NOT NULL`;

describe("ClearNextEventOfTemplatesThatDoNotRecur1802800000000", () => {
  test("is registered once, under the name its class carries", () => {
    expect(
      new ClearNextEventOfTemplatesThatDoNotRecur1802800000000().name,
    ).toBe(MIGRATION_NAME);
    expect(SchemaMigrations).toContain(
      ClearNextEventOfTemplatesThatDoNotRecur1802800000000,
    );
    expect(
      registeredNames().filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
  });

  test("runs after the migrations that made the switch and the next time what it reads", async () => {
    const names: Array<string> = registeredNames();

    for (const earlier of [
      "MigrationName1725898621366",
      "MigrationName1725901024444",
    ]) {
      expect(names.indexOf(earlier)).toBeGreaterThan(-1);
      expect(names.indexOf(MIGRATION_NAME)).toBeGreaterThan(
        names.indexOf(earlier),
      );
    }

    // The switch: never null, off unless turned on.
    expect(await upStatements(MigrationName1725898621366)).toContain(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD "isRecurringEvent" boolean NOT NULL DEFAULT false`,
    );

    // The next time: a time, or none.
    expect(await upStatements(MigrationName1725901024444)).toContain(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD "scheduleNextEventAt" TIMESTAMP WITH TIME ZONE`,
    );
  });

  test("up() runs the one UPDATE, with no parameters", async () => {
    expect(
      await recordQueries(
        ClearNextEventOfTemplatesThatDoNotRecur1802800000000,
        "up",
      ),
    ).toEqual([
      {
        statement: CLEAR_NEXT_EVENT_OF_TEMPLATES_THAT_DO_NOT_RECUR,
        parameters: undefined,
      },
    ]);
  });

  test("down() changes nothing", async () => {
    expect(
      await recordQueries(
        ClearNextEventOfTemplatesThatDoNotRecur1802800000000,
        "down",
      ),
    ).toEqual([]);
  });

  test("it updates the templates' table, clearing the next time and nothing else", () => {
    expect(CLEAR_NEXT_EVENT_OF_TEMPLATES_THAT_DO_NOT_RECUR).toBe(
      `UPDATE "${new ScheduledMaintenanceTemplate().tableName}"${SET.trimEnd()}${WHERE}`,
    );

    const assignments: string =
      CLEAR_NEXT_EVENT_OF_TEMPLATES_THAT_DO_NOT_RECUR.slice(
        CLEAR_NEXT_EVENT_OF_TEMPLATES_THAT_DO_NOT_RECUR.indexOf(" SET "),
        CLEAR_NEXT_EVENT_OF_TEMPLATES_THAT_DO_NOT_RECUR.indexOf(" WHERE "),
      );

    expect(assignments.split("=")).toHaveLength(2);

    for (const kept of [
      "firstEventScheduledAt",
      "firstEventStartsAt",
      "firstEventEndsAt",
      "recurringInterval",
      "isRecurringEvent",
    ]) {
      expect(assignments).not.toContain(`"${kept}"`);
    }
  });

  test("it picks only the templates whose switch is off and that still hold a time", () => {
    const where: string = CLEAR_NEXT_EVENT_OF_TEMPLATES_THAT_DO_NOT_RECUR.slice(
      CLEAR_NEXT_EVENT_OF_TEMPLATES_THAT_DO_NOT_RECUR.indexOf(" WHERE "),
    );

    expect(where).toBe(WHERE);
    // A recurring template, which the job reads, is never picked.
    expect(where).not.toContain(`"isRecurringEvent" = true`);
    expect(where).not.toContain(" OR ");
  });

  test("the columns it reads and writes are the model's: the switch and the next time", () => {
    const template: ScheduledMaintenanceTemplate =
      new ScheduledMaintenanceTemplate();

    expect(template.getTableColumnMetadata("isRecurringEvent").type).toBe(
      TableColumnType.Boolean,
    );
    expect(template.getTableColumnMetadata("scheduleNextEventAt").type).toBe(
      TableColumnType.Date,
    );
  });
});
