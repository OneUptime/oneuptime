import {
  ADD_UPDATE_KIND_SQL,
  AddCustomFieldsAndRemindersToUpdatesToPost1809181400026,
  CUSTOM_FIELDS_EVENT_TYPES,
  REMINDERS_EVENT_TYPES,
  REMOVE_UPDATE_KIND_SQL,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809181400026-AddCustomFieldsAndRemindersToUpdatesToPost";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import { describe, expect, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * AddCustomFieldsAndRemindersToUpdatesToPost1809181400026: the rules that
 * chose their updates before custom field edits and still-open reminders
 * had boxes of their own (#7937, #7938) get the new box wherever they
 * ticked the one it came out of, so they post what they did.
 *
 * What this pins with a fake QueryRunner: its place among the migrations,
 * its statements, and that the kinds of rule it rewrites are the ones that
 * choose the new updates - read from NotificationRuleUpdates, so a kind
 * that starts choosing one is not left out. The statements run against a
 * real Postgres in AddCustomFieldsAndRemindersToUpdatesToPostPostgres.
 */

interface Statement {
  sql: string;
  parameters: Array<unknown> | undefined;
}

async function statementsFor(
  direction: "up" | "down",
): Promise<Array<Statement>> {
  const statements: Array<Statement> = [];
  const runner: QueryRunner = {
    query: async (sql: string, parameters?: Array<unknown>): Promise<void> => {
      statements.push({ sql, parameters });
    },
  } as unknown as QueryRunner;

  await new AddCustomFieldsAndRemindersToUpdatesToPost1809181400026()[
    direction
  ](runner);

  return statements;
}

// The kinds of rule that can choose an update, as WorkspaceNotificationRule stores them.
function eventTypesChoosing(kind: NotificationRuleUpdateKind): Array<string> {
  return Object.values(NotificationRuleEventType).filter(
    (eventType: NotificationRuleEventType): boolean => {
      return NotificationRuleUpdates.getChoosableKinds(eventType).includes(
        kind,
      );
    },
  );
}

describe("AddCustomFieldsAndRemindersToUpdatesToPost1809181400026", () => {
  test("is registered, after every migration before it", () => {
    const migrations: Array<{ new (): MigrationInterface }> =
      SchemaMigrations as unknown as Array<{ new (): MigrationInterface }>;

    const index: number = migrations.indexOf(
      AddCustomFieldsAndRemindersToUpdatesToPost1809181400026,
    );

    expect(index).toBeGreaterThan(-1);

    const names: Array<string> = migrations.map(
      (migration: { new (): MigrationInterface }): string => {
        return new migration().name || "";
      },
    );

    expect(names[index]).toBe(
      "AddCustomFieldsAndRemindersToUpdatesToPost1809181400026",
    );

    // Numbered after the one before it.
    const trailingNumber: RegExp = /(\d+)$/;
    const numberOf: (name: string) => number = (name: string): number => {
      return Number(trailingNumber.exec(name)?.[1] || "0");
    };

    expect(numberOf(names[index]!)).toBeGreaterThan(
      numberOf(names[index - 1]!),
    );
  });

  test("ticks Custom field changes where Other edits is, and Reminders where Everything else is", async () => {
    expect(await statementsFor("up")).toEqual([
      {
        sql: ADD_UPDATE_KIND_SQL,
        parameters: ["CustomFields", "Edits", CUSTOM_FIELDS_EVENT_TYPES],
      },
      {
        sql: ADD_UPDATE_KIND_SQL,
        parameters: ["Reminders", "Other", REMINDERS_EVENT_TYPES],
      },
    ]);
  });

  test("rewrites the kinds of rule that choose each new box: incident and alert rules, and maintenance rules' reminders", () => {
    expect([...CUSTOM_FIELDS_EVENT_TYPES].sort()).toEqual(
      eventTypesChoosing(NotificationRuleUpdateKind.CustomFields).sort(),
    );
    expect([...REMINDERS_EVENT_TYPES].sort()).toEqual(
      eventTypesChoosing(NotificationRuleUpdateKind.Reminders).sort(),
    );
    expect(REMINDERS_EVENT_TYPES).toEqual([
      "Incident",
      "Alert",
      "Scheduled Maintenance",
    ]);

    // Each box it ticks beside one that every such rule can choose.
    for (const eventType of CUSTOM_FIELDS_EVENT_TYPES) {
      expect(
        NotificationRuleUpdates.getChoosableKinds(
          eventType as NotificationRuleEventType,
        ),
      ).toContain(NotificationRuleUpdateKind.Edits);
    }

    for (const eventType of REMINDERS_EVENT_TYPES) {
      expect(
        NotificationRuleUpdates.getChoosableKinds(
          eventType as NotificationRuleEventType,
        ),
      ).toContain(NotificationRuleUpdateKind.Other);
    }
  });

  test("touches only a list that holds the old box and not the new one, of the kinds of rule given", () => {
    const sql: string = ADD_UPDATE_KIND_SQL;

    expect(sql).toContain('UPDATE "WorkspaceNotificationRule"');
    expect(sql).toContain('"eventType" = ANY($3::varchar[])');
    expect(sql).toContain(
      `jsonb_typeof("notificationRule" -> 'updatesToPost') = 'array'`,
    );
    expect(sql).toContain(`("notificationRule" -> 'updatesToPost') ? $2::text`);
    expect(sql).toContain(
      `NOT (("notificationRule" -> 'updatesToPost') ? $1::text)`,
    );
    // Added at the end; the rest of the rule's JSON is kept as it is.
    expect(sql).toContain(
      `jsonb_set("notificationRule", '{updatesToPost}', ("notificationRule" -> 'updatesToPost') || to_jsonb($1::text))`,
    );
  });

  test("its down takes both new boxes out of every list again", async () => {
    expect(await statementsFor("down")).toEqual([
      { sql: REMOVE_UPDATE_KIND_SQL, parameters: ["Reminders"] },
      { sql: REMOVE_UPDATE_KIND_SQL, parameters: ["CustomFields"] },
    ]);
    expect(REMOVE_UPDATE_KIND_SQL).toContain(
      `("notificationRule" -> 'updatesToPost') - $1::text`,
    );
  });

  test("writes data and no schema: no table, column or index is made or dropped", async () => {
    for (const statement of [
      ...(await statementsFor("up")),
      ...(await statementsFor("down")),
    ]) {
      expect(statement.sql).not.toMatch(
        /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|COLUMN)\b/i,
      );
    }
  });
});
