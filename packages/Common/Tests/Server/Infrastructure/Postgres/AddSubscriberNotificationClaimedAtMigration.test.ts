import { AddSubscriberNotificationClaimedAt1795900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1795900000000-AddSubscriberNotificationClaimedAt";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import ColumnType from "../../../../Types/Database/ColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * When a subscriber job claimed the incident created, postmortem and episode
 * created notifications, for the sweeper to time an interrupted send from
 * instead of updatedAt, which other code keeps moving on an open incident or
 * episode.
 *
 * It pins that the columns match the models (a mismatch is a red Schema
 * Drift job), that they are nullable with no default - adding them rewrites
 * nothing, and a row claimed before they existed is timed from updatedAt -
 * that down() undoes up(), and that the migration is registered last. Fake
 * QueryRunner only; generating the migration against a fully migrated
 * database, applying it and generating again to "No changes" is how the
 * schema was verified.
 */

const OWN_CLASS_NAME: string =
  "AddSubscriberNotificationClaimedAt1795900000000";

const MIGRATION_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
  "1795900000000-AddSubscriberNotificationClaimedAt.ts",
);

const COLUMNS: Array<{ table: string; model: unknown; column: string }> = [
  {
    table: "Incident",
    model: Incident,
    column: "subscriberNotificationClaimedAtOnIncidentCreated",
  },
  {
    table: "Incident",
    model: Incident,
    column: "subscriberNotificationClaimedAtOnPostmortemPublished",
  },
  {
    table: "IncidentEpisode",
    model: IncidentEpisode,
    column: "subscriberNotificationClaimedAtOnEpisodeCreated",
  },
];

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

function timestampOfClassName(className: string): number | null {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
}

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddSubscriberNotificationClaimedAt1795900000000()[direction](
    queryRunner,
  );

  return statements;
}

describe("AddSubscriberNotificationClaimedAt migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(new AddSubscriberNotificationClaimedAt1795900000000().name).toBe(
      OWN_CLASS_NAME,
    );
  });

  test("is registered once, behind every migration registered before it", () => {
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === OWN_CLASS_NAME;
      }),
    ).toHaveLength(1);

    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);
    const ownTimestamp: number = timestampOfClassName(OWN_CLASS_NAME)!;

    expect(
      registeredNames.slice(0, ownIndex).filter((className: string) => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp !== null && timestamp >= ownTimestamp;
      }),
    ).toEqual([]);
  });
});

describe("AddSubscriberNotificationClaimedAt migration - up() and down()", () => {
  test.each(COLUMNS)(
    "adds $table.$column as the model declares it: a nullable timestamp with no default",
    async (entry: { table: string; model: unknown; column: string }) => {
      const declared: ColumnMetadataArgs | undefined =
        getMetadataArgsStorage().columns.find(
          (column: ColumnMetadataArgs): boolean => {
            return (
              column.target === entry.model &&
              column.propertyName === entry.column
            );
          },
        );

      expect(declared?.options.type).toBe(ColumnType.Date);
      expect(declared?.options.nullable).toBe(true);
      expect(declared?.options.default).toBeUndefined();

      expect(await recordQueries("up")).toContain(
        `ALTER TABLE "${entry.table}" ADD "${entry.column}" TIMESTAMP WITH TIME ZONE`,
      );
      expect(await recordQueries("down")).toContain(
        `ALTER TABLE "${entry.table}" DROP COLUMN "${entry.column}"`,
      );
    },
  );

  test("adds nothing else: no default, no index, no backfill", async () => {
    const up: Array<string> = await recordQueries("up");

    expect(up).toHaveLength(COLUMNS.length);
    for (const statement of up) {
      expect(statement).toMatch(
        /^ALTER TABLE "\w+" ADD "\w+" TIMESTAMP WITH TIME ZONE$/,
      );
    }
    expect(await recordQueries("down")).toHaveLength(COLUMNS.length);
  });
});
