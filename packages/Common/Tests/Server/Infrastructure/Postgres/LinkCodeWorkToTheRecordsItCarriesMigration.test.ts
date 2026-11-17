import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import { AddCarriedRecordsToCodeWork1809182700000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182700000-AddCarriedRecordsToCodeWork";
import {
  CHAT_CALL_MATCH_WINDOW,
  LINK_ACTION_ITEM_TASKS_TO_THEIR_INCIDENT,
  LINK_CHAT_PULL_REQUESTS_TO_THEIR_THREAD,
  LINK_CODE_WORK_STATEMENTS,
  LINK_TASKS_TO_THE_ALERTS_THEIR_REPLIES_CARRY,
  LINK_TASKS_TO_THE_INCIDENTS_THEIR_REPLIES_CARRY,
  LINK_TURNS_TO_THEIR_ALERTS,
  LINK_TURNS_TO_THEIR_INCIDENTS,
  LinkCodeWorkToTheRecordsItCarries1809182710000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182710000-LinkCodeWorkToTheRecordsItCarries";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { CARRIED_RECORD_COLUMNS } from "../../../../Server/Utils/AI/AIRunOutputReadFilter";
import { CodeTaskContextType } from "../../../../Types/AI/CodeTask";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The two migrations that let Code work say which incidents and alerts it
 * carries (#9186):
 *
 *   - AddCarriedRecordsToCodeWork: the generated columns, nullable jsonb on
 *     AIRun and AIAgentTaskPullRequest;
 *   - LinkCodeWorkToTheRecordsItCarries: the links of the work that already
 *     exists, from what it kept - each turn's request context, a postmortem
 *     action item's task, every task from its replies, and a pull request
 *     opened from an incident's or alert's AI conversation when exactly one
 *     such conversation's call matches it.
 *
 * Pinned against a fake QueryRunner. LinkCodeWorkToTheRecordsItCarries
 * Postgres.test.ts runs both on a real database.
 */

interface FakeRun {
  runner: QueryRunner;
  statements: Array<string>;
}

function fakeRun(): FakeRun {
  const statements: Array<string> = [];

  return {
    runner: {
      query: async (sql: string): Promise<unknown> => {
        statements.push(sql.replace(/\s+/g, " ").trim());
        return [];
      },
    } as unknown as QueryRunner,
    statements,
  };
}

function migrationNames(): Array<string> {
  return SchemaMigrations.map((migration: { name: string }): string => {
    return migration.name;
  });
}

describe("AddCarriedRecordsToCodeWork1809182700000", () => {
  test("is registered under its own name, after every migration before it", () => {
    const names: Array<string> = migrationNames();
    const index: number = names.indexOf(
      "AddCarriedRecordsToCodeWork1809182700000",
    );

    expect(new AddCarriedRecordsToCodeWork1809182700000().name).toBe(
      "AddCarriedRecordsToCodeWork1809182700000",
    );
    expect(index).toBeGreaterThan(0);

    for (const name of names.slice(0, index)) {
      const stamp: string | undefined = name.match(/(\d{13})$/)?.[1];

      if (stamp) {
        expect({ name, isEarlier: Number(stamp) < 1809182700000 }).toEqual({
          name,
          isEarlier: true,
        });
      }
    }
  });

  test("adds the two lists to both tables, nullable jsonb: no row is rewritten", async () => {
    const run: FakeRun = fakeRun();

    await new AddCarriedRecordsToCodeWork1809182700000().up(run.runner);

    expect(run.statements).toEqual([
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "carriedIncidentIds" jsonb`,
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "carriedAlertIds" jsonb`,
      `ALTER TABLE "AIRun" ADD "carriedIncidentIds" jsonb`,
      `ALTER TABLE "AIRun" ADD "carriedAlertIds" jsonb`,
    ]);
  });

  test("the columns are the lists the models and the rule read", () => {
    expect([...CARRIED_RECORD_COLUMNS]).toEqual([
      "carriedIncidentIds",
      "carriedAlertIds",
    ]);

    for (const column of CARRIED_RECORD_COLUMNS) {
      for (const model of [new AIRun(), new AIAgentTaskPullRequest()]) {
        expect({
          table: model.tableName,
          column,
          type: model.getTableColumnMetadata(column)?.type,
          required: model.getTableColumnMetadata(column)?.required,
        }).toEqual({
          table: model.tableName,
          column,
          type: TableColumnType.JSON,
          required: false,
        });
      }
    }
  });

  test("down drops them again", async () => {
    const run: FakeRun = fakeRun();

    await new AddCarriedRecordsToCodeWork1809182700000().down(run.runner);

    expect(run.statements).toEqual([
      `ALTER TABLE "AIRun" DROP COLUMN "carriedAlertIds"`,
      `ALTER TABLE "AIRun" DROP COLUMN "carriedIncidentIds"`,
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "carriedAlertIds"`,
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "carriedIncidentIds"`,
    ]);
  });
});

describe("LinkCodeWorkToTheRecordsItCarries1809182710000", () => {
  test("is registered right after the columns, in a transaction of its own", () => {
    const names: Array<string> = migrationNames();

    expect(
      names.indexOf("LinkCodeWorkToTheRecordsItCarries1809182710000"),
    ).toBe(names.indexOf("AddCarriedRecordsToCodeWork1809182700000") + 1);

    const migration: MigrationInterface & { transaction?: boolean } =
      new LinkCodeWorkToTheRecordsItCarries1809182710000();

    expect(migration.name).toBe(
      "LinkCodeWorkToTheRecordsItCarries1809182710000",
    );
    expect(migration.transaction).toBeUndefined();
  });

  test("links each turn first, then a postmortem action item's task, then every task from its replies, then the chats' pull requests", async () => {
    const run: FakeRun = fakeRun();

    await new LinkCodeWorkToTheRecordsItCarries1809182710000().up(run.runner);

    expect(run.statements).toEqual(
      [
        LINK_TURNS_TO_THEIR_INCIDENTS,
        LINK_TURNS_TO_THEIR_ALERTS,
        LINK_ACTION_ITEM_TASKS_TO_THEIR_INCIDENT,
        LINK_TASKS_TO_THE_INCIDENTS_THEIR_REPLIES_CARRY,
        LINK_TASKS_TO_THE_ALERTS_THEIR_REPLIES_CARRY,
        LINK_CHAT_PULL_REQUESTS_TO_THEIR_THREAD,
      ].map((statement: string): string => {
        return statement.replace(/\s+/g, " ").trim();
      }),
    );
    expect(LINK_CODE_WORK_STATEMENTS).toHaveLength(6);
  });

  test.each([
    [
      CodeTaskContextType.Incident,
      LINK_TURNS_TO_THEIR_INCIDENTS,
      "carriedIncidentIds",
    ],
    [CodeTaskContextType.Alert, LINK_TURNS_TO_THEIR_ALERTS, "carriedAlertIds"],
  ])(
    "a turn's own %s: the request's context items of its kind, CodeFix runs only, each id only once it reads as one",
    (type: CodeTaskContextType, statement: string, column: string) => {
      expect(statement).toContain(`UPDATE "AIRun" AS "run" SET "${column}" =`);
      expect(statement).toContain(`"item" ->> 'type' = '${type}'`);
      expect(statement).toContain(`"turn"."runType" = 'CodeFix'`);
      expect(statement).toContain(
        `"turn"."taskContext" -> 'request' -> 'context'`,
      );
      expect(statement).toContain(
        `lower("item" ->> 'recordId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
      );
      // A context that is no list reads as none, never failing the statement.
      expect(statement).toContain(
        `CASE WHEN jsonb_typeof("turn"."taskContext" -> 'request' -> 'context') = 'array'`,
      );
      // Added to what the run already carries, each id once.
      expect(statement).toContain(`jsonb_agg(DISTINCT "merged"."id")`);
    },
  );

  test("a postmortem action item's task carries the item's incident, whatever state the item is in", () => {
    expect(LINK_ACTION_ITEM_TASKS_TO_THEIR_INCIDENT).toContain(
      `FROM "IncidentPostmortemActionItem" AS "item" WHERE "item"."codeTaskId" IS NOT NULL AND "item"."incidentId" IS NOT NULL`,
    );
    expect(LINK_ACTION_ITEM_TASKS_TO_THEIR_INCIDENT).not.toContain(
      `"deletedAt"`,
    );
    expect(LINK_ACTION_ITEM_TASKS_TO_THEIR_INCIDENT).toContain(
      `"task"."runType" = 'CodeFix'`,
    );
  });

  test.each([
    ["carriedIncidentIds", LINK_TASKS_TO_THE_INCIDENTS_THEIR_REPLIES_CARRY],
    ["carriedAlertIds", LINK_TASKS_TO_THE_ALERTS_THEIR_REPLIES_CARRY],
  ])(
    "every task gathers what its replies carry, in %s",
    (column: string, statement: string) => {
      expect(statement).toContain(`UPDATE "AIRun" AS "task" SET "${column}" =`);
      expect(statement).toContain(
        `FROM "AIRun" AS "reply" CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof("reply"."${column}") = 'array'`,
      );
      expect(statement).toContain(
        `WHERE "reply"."codeTaskId" IS NOT NULL GROUP BY "reply"."codeTaskId"`,
      );
    },
  );

  test("a chat's pull request is linked only to an incident's or alert's AI conversation, and only when exactly one matches it", () => {
    const statement: string = LINK_CHAT_PULL_REQUESTS_TO_THEIR_THREAD;

    // A pull request a chat opened: no run of its own, not linked yet.
    expect(statement).toContain(
      `WHERE "pullRequest"."aiRunId" IS NULL AND "pullRequest"."carriedIncidentIds" IS NULL AND "pullRequest"."carriedAlertIds" IS NULL`,
    );
    // Its chat's call: the step that opened a pull request, by the same person, in the same project.
    expect(statement).toContain(`"call"."eventType" = 'ToolCallCompleted'`);
    expect(statement).toContain(`"call"."toolName" = 'open_code_pull_request'`);
    expect(statement).toContain(
      `"call"."userId" IS NOT DISTINCT FROM "pullRequest"."createdByUserId"`,
    );
    expect(statement).toContain(
      `"call"."projectId" = "pullRequest"."projectId"`,
    );
    // Within minutes of it, with the title the record keeps.
    expect(statement).toContain(
      `"call"."createdAt" >= "pullRequest"."createdAt" - INTERVAL '${CHAT_CALL_MATCH_WINDOW.minutesBefore} minutes'`,
    );
    expect(statement).toContain(
      `"call"."createdAt" <= "pullRequest"."createdAt" + INTERVAL '${CHAT_CALL_MATCH_WINDOW.minutesAfter} minutes'`,
    );
    expect(statement).toContain(
      `left(btrim("call"."toolArguments" ->> 'title'), char_length("pullRequest"."title")) = "pullRequest"."title"`,
    );
    // In a chat, in exactly one conversation, which is a record's.
    expect(statement).toContain(`"chat"."runType" = 'Chat'`);
    expect(statement).toContain(
      `"matched"."chats" = 1 AND "matched"."isThread"`,
    );
  });

  test("down changes nothing: the links go with their columns", async () => {
    const run: FakeRun = fakeRun();

    await new LinkCodeWorkToTheRecordsItCarries1809182710000().down(run.runner);

    expect(run.statements).toEqual([]);
  });
});
