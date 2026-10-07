import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { KeepOnCallTimelineHistory1799700000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1799700000000-KeepOnCallTimelineHistory";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { MigrationInterface, QueryRunner, getMetadataArgsStorage } from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * The migration that keeps the on-call history (UserOnCallLogTimeline) when a
 * notification rule or method a page went through is removed: its ten
 * references to the person's rules and methods go from ON DELETE CASCADE to
 * ON DELETE SET NULL.
 *
 * Pinned against a fake QueryRunner whose catalog answers what each
 * constraint's ON DELETE is (confdeltype), with OnlineDdl.addForeignKey
 * recorded rather than run (OnlineDdl.test.ts covers it):
 *
 *   - each constraint is dropped as generated and added back, SET NULL,
 *     through OnlineDdl (added NOT VALID, validated without blocking
 *     writers), in a migration without a transaction;
 *   - a run that stopped part way is safe to run again: a constraint already
 *     replaced is not dropped a second time;
 *   - the columns are exactly the ones the model declares SET NULL, so the
 *     schema drift check and this migration agree;
 *   - down puts the cascade back.
 * ProjectMembershipPostgres.test.ts shows the rebuilt keys keeping the
 * history on a real database.
 */

const TABLE: string = '"UserOnCallLogTimeline"';

// Constraint name -> the column it is on, and the table it points at.
const CONSTRAINTS: Record<string, { column: string; references: string }> = {
  FK_06a427cdcbae1ddcb1301b860f2: {
    column: "userNotificationRuleId",
    references: "UserNotificationRule",
  },
  FK_d5c3df01bbb2a9ce168b36b5234: {
    column: "userCallId",
    references: "UserCall",
  },
  FK_12ef8407b6359205df8339f8494: { column: "userSmsId", references: "UserSMS" },
  FK_0a67c82e4e093ae5c89d2d76bdf: {
    column: "userWhatsAppId",
    references: "UserWhatsApp",
  },
  FK_a61a74c006b54967cdba5e4f280: {
    column: "userTelegramId",
    references: "UserTelegram",
  },
  FK_d51ef7b2a8b813d37e94890ff77: {
    column: "userSlackId",
    references: "UserSlack",
  },
  FK_a7206c19df5cdfe02cf3215a64c: {
    column: "userMicrosoftTeamsId",
    references: "UserMicrosoftTeams",
  },
  FK_de891557845d64087311a45478d: {
    column: "userWebhookId",
    references: "UserWebhook",
  },
  FK_815c728d905c44bc440ec91308b: {
    column: "userEmailId",
    references: "UserEmail",
  },
  FK_d3e187a7828a990cdf6429a692f: {
    column: "userPushId",
    references: "UserPush",
  },
};

interface FakeRun {
  runner: QueryRunner;
  // Every statement, catalog lookups as "<lookup NAME>", in order.
  statements: Array<string>;
  // The statements handed to OnlineDdl.addForeignKey, in order.
  onlineAdds: Array<string>;
}

let addForeignKey: SpyInstance<typeof OnlineDdl.addForeignKey>;

/*
 * `onDelete` is what the catalog says each constraint does now: 'c' as the
 * generated schema left it, 'n' once replaced; missing names read as absent.
 */
function fakeRun(onDelete: Record<string, string>): FakeRun {
  const statements: Array<string> = [];
  const onlineAdds: Array<string> = [];

  const runner: QueryRunner = {
    query: async (sql: string, parameters?: Array<unknown>): Promise<unknown> => {
      const statement: string = sql.replace(/\s+/g, " ").trim();

      if (statement.includes("FROM pg_constraint")) {
        // Scoped to the history table, resolved the way the DROP resolves it.
        expect(statement).toContain(`to_regclass('${TABLE}')`);

        const name: string = String(parameters?.[0]);
        statements.push(`<lookup ${name}>`);

        return onDelete[name] ? [{ onDelete: onDelete[name] }] : [];
      }

      statements.push(statement);
      return [];
    },
  } as unknown as QueryRunner;

  addForeignKey = jest
    .spyOn(OnlineDdl, "addForeignKey")
    .mockImplementation(
      async (_queryRunner: QueryRunner, statement: string): Promise<void> => {
        onlineAdds.push(statement);
        statements.push(`<online ${statement}>`);
      },
    );

  return { runner, statements, onlineAdds };
}

function everyConstraint(onDelete: string): Record<string, string> {
  const states: Record<string, string> = {};

  for (const name of Object.keys(CONSTRAINTS)) {
    states[name] = onDelete;
  }

  return states;
}

function setNullStatement(name: string): string {
  const constraint: { column: string; references: string } =
    CONSTRAINTS[name]!;

  return `ALTER TABLE ${TABLE} ADD CONSTRAINT "${name}" FOREIGN KEY ("${constraint.column}") REFERENCES "${constraint.references}"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("KeepOnCallTimelineHistory1799700000000", () => {
  test("is registered under its own name", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(names).toContain("KeepOnCallTimelineHistory1799700000000");
    expect(new KeepOnCallTimelineHistory1799700000000().name).toBe(
      "KeepOnCallTimelineHistory1799700000000",
    );
  });

  test("runs without a transaction, as OnlineDdl requires", () => {
    const migration: MigrationInterface & { transaction?: boolean } =
      new KeepOnCallTimelineHistory1799700000000();

    expect(migration.transaction).toBe(false);
  });

  test("each reference is dropped as generated, then added back SET NULL through OnlineDdl", async () => {
    const run: FakeRun = fakeRun(everyConstraint("c"));

    await new KeepOnCallTimelineHistory1799700000000().up(run.runner);

    const expected: Array<string> = [];

    for (const name of Object.keys(CONSTRAINTS)) {
      expected.push(
        `<lookup ${name}>`,
        `ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS "${name}"`,
        `<online ${setNullStatement(name)}>`,
      );
    }

    expect(run.statements).toEqual(expected);
    expect(addForeignKey).toHaveBeenCalledTimes(10);

    for (const call of addForeignKey.mock.calls) {
      expect(call[0]).toBe(run.runner);
    }
  });

  test("nothing in it deletes or rewrites a history row: it only looks up, drops and adds constraints", async () => {
    const run: FakeRun = fakeRun(everyConstraint("c"));

    await new KeepOnCallTimelineHistory1799700000000().up(run.runner);

    for (const statement of run.statements) {
      const isConstraintWork: boolean =
        statement.startsWith("<lookup ") ||
        statement.startsWith(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS `) ||
        statement.startsWith(`<online ALTER TABLE ${TABLE} ADD CONSTRAINT `);

      expect({ statement, isConstraintWork }).toEqual({
        statement,
        isConstraintWork: true,
      });
    }
  });

  test("run again after a stop part way, a reference already replaced is not dropped again", async () => {
    const states: Record<string, string> = everyConstraint("c");
    const replaced: Array<string> = Object.keys(CONSTRAINTS).slice(0, 4);

    for (const name of replaced) {
      states[name] = "n";
    }

    const run: FakeRun = fakeRun(states);

    await new KeepOnCallTimelineHistory1799700000000().up(run.runner);

    const drops: Array<string> = run.statements.filter(
      (statement: string): boolean => {
        return statement.includes("DROP CONSTRAINT");
      },
    );

    expect(drops).toHaveLength(6);

    for (const name of replaced) {
      expect(drops.join("\n")).not.toContain(name);
    }

    // OnlineDdl still sees every one: it validates one left NOT VALID.
    expect(run.onlineAdds).toEqual(Object.keys(CONSTRAINTS).map(setNullStatement));
  });

  test("a reference that is not there at all is added", async () => {
    const run: FakeRun = fakeRun({});

    await new KeepOnCallTimelineHistory1799700000000().up(run.runner);

    // DROP IF EXISTS: nothing to drop is not an error.
    expect(run.onlineAdds).toHaveLength(10);
  });

  test("the columns are exactly the history's references the model declares SET NULL", () => {
    const declared: Array<string> = getMetadataArgsStorage()
      .relations.filter((relation: RelationMetadataArgs): boolean => {
        return (
          relation.target === UserOnCallLogTimeline &&
          relation.options?.onDelete === "SET NULL"
        );
      })
      .map((relation: RelationMetadataArgs): string => {
        return `${relation.propertyName}Id`;
      })
      .filter((column: string): boolean => {
        return Object.values(CONSTRAINTS).some(
          (constraint: { column: string }): boolean => {
            return constraint.column.toLowerCase() === column.toLowerCase();
          },
        );
      })
      .sort();

    expect(declared.map((column: string) => column.toLowerCase())).toEqual(
      Object.values(CONSTRAINTS)
        .map((constraint: { column: string }): string => {
          return constraint.column.toLowerCase();
        })
        .sort(),
    );
  });

  test("down puts the cascade back on all ten", async () => {
    const statements: Array<string> = [];
    const runner: QueryRunner = {
      query: async (sql: string): Promise<unknown> => {
        statements.push(sql.replace(/\s+/g, " ").trim());
        return [];
      },
    } as unknown as QueryRunner;

    await new KeepOnCallTimelineHistory1799700000000().down(runner);

    for (const name of Object.keys(CONSTRAINTS)) {
      const constraint: { column: string; references: string } =
        CONSTRAINTS[name]!;

      expect(statements).toContain(
        `ALTER TABLE ${TABLE} DROP CONSTRAINT "${name}"`,
      );
      expect(statements).toContain(
        `ALTER TABLE ${TABLE} ADD CONSTRAINT "${name}" FOREIGN KEY ("${constraint.column}") REFERENCES "${constraint.references}"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
    }

    expect(statements).toHaveLength(20);
  });
});
