import { MigrationName1739209832500 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1739209832500-MigrationName";
import {
  KEEP_CHANNEL_NAME_PREFIX_UPDATE,
  KeepChannelNamePrefixOfRulesWithoutOne1802200000000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1802200000000-KeepChannelNamePrefixOfRulesWithoutOne";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceChannelName from "../../../../Utils/Workspace/WorkspaceChannelName";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";

/*
 * A notification rule that creates channels without a prefix keeps naming
 * them as it did.
 *
 * Until now a rule saved without a prefix (through the API or Terraform, or
 * a monitor or on-call policy rule, whose form never asked) was given
 * "oneuptime-" + its event type + "-" by the server. An empty prefix now
 * means none - the channel is the record's own name, inc-42 - so this data
 * migration writes the old default into those rules, before any server reads
 * a rule under the new meaning. What it must hold to:
 *
 *   - the rules it picks are the ones the server gave the default: create
 *     channels as JavaScript reads the switch, prefix missing as JavaScript
 *     reads it (absent, null, "", false, 0) - never a rule with a prefix of
 *     its own, spaces included, never one that creates no channels;
 *   - the default it writes is WorkspaceChannelName.getLegacyDefaultPrefix
 *     for every event type (lower() of an ASCII event type);
 *   - only JSON objects are touched; nothing else in the rule changes;
 *   - registered once, after the table was created, last of all migrations.
 *
 * Fake QueryRunner here. KeepChannelNamePrefixOfRulesWithoutOnePostgres
 * runs the statement on real rows; the Schema Drift job applies it to a
 * migrated database.
 */

const MIGRATION_NAME: string =
  "KeepChannelNamePrefixOfRulesWithoutOne1802200000000";

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

function registeredNames(): Array<string> {
  return (SchemaMigrations as unknown as Array<{ name: string }>).map(
    (registered: { name: string }): string => {
      return registered.name;
    },
  );
}

describe("KeepChannelNamePrefixOfRulesWithoutOne1802200000000", () => {
  test("is registered once, under the name its class carries", () => {
    expect(new KeepChannelNamePrefixOfRulesWithoutOne1802200000000().name).toBe(
      MIGRATION_NAME,
    );
    expect(SchemaMigrations).toContain(
      KeepChannelNamePrefixOfRulesWithoutOne1802200000000,
    );
    expect(
      registeredNames().filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
  });

  test("runs after the migration that created the rule table", async () => {
    const names: Array<string> = registeredNames();

    expect(names.indexOf("MigrationName1739209832500")).toBeGreaterThan(-1);
    expect(names.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      names.indexOf("MigrationName1739209832500"),
    );

    // The table it updates, and the two columns it reads and writes.
    const created: string | undefined = (
      await recordQueries(MigrationName1739209832500, "up")
    )
      .map((query: { statement: string }): string => {
        return query.statement;
      })
      .find((statement: string): boolean => {
        return statement.startsWith(`CREATE TABLE "WorkspaceNotificationRule"`);
      });

    expect(created).toContain(`"notificationRule" jsonb NOT NULL`);
    expect(created).toContain(`"eventType" character varying NOT NULL`);
  });

  test("up() runs the one UPDATE, with no parameters", async () => {
    expect(
      await recordQueries(
        KeepChannelNamePrefixOfRulesWithoutOne1802200000000,
        "up",
      ),
    ).toEqual([
      { statement: KEEP_CHANNEL_NAME_PREFIX_UPDATE, parameters: undefined },
    ]);
  });

  test("down() changes nothing", async () => {
    expect(
      await recordQueries(
        KeepChannelNamePrefixOfRulesWithoutOne1802200000000,
        "down",
      ),
    ).toEqual([]);
  });

  test("it writes the old default - oneuptime-, the event type lowercased, - - and nothing else", () => {
    expect(KEEP_CHANNEL_NAME_PREFIX_UPDATE).toContain(
      `SET "notificationRule" = jsonb_set("notificationRule", '{newChannelTemplateName}', to_jsonb('oneuptime-' || lower("eventType") || '-'))`,
    );

    // The same default WorkspaceChannelName hands out, for every event type.
    for (const eventType of Object.values(NotificationRuleEventType)) {
      expect(`oneuptime-${eventType.toLowerCase()}-`).toBe(
        WorkspaceChannelName.getLegacyDefaultPrefix(eventType),
      );
      // lower() and toLowerCase() agree on ASCII only.
      expect(
        Array.from(eventType).every((character: string): boolean => {
          return character.charCodeAt(0) >= 32 && character.charCodeAt(0) < 127;
        }),
      ).toBe(true);
    }
  });

  test("it picks only JSON objects whose rule creates channels and has no prefix", () => {
    const where: string = KEEP_CHANNEL_NAME_PREFIX_UPDATE.substring(
      KEEP_CHANNEL_NAME_PREFIX_UPDATE.indexOf(" WHERE "),
    );

    expect(where).toContain(`jsonb_typeof("notificationRule") = 'object'`);
    expect(where).toContain(
      `NOT ("notificationRule" ? 'newChannelTemplateName')`,
    );
    expect(where).toContain(
      `"notificationRule"->'newChannelTemplateName' IN ('null'::jsonb, '""'::jsonb, 'false'::jsonb, '0'::jsonb)`,
    );
    expect(where).toContain(
      `CASE jsonb_typeof("notificationRule"->'shouldCreateNewChannel') WHEN 'boolean' THEN ("notificationRule"->>'shouldCreateNewChannel')::boolean`,
    );
    expect(where).toContain(`ELSE false END`);
  });
});
