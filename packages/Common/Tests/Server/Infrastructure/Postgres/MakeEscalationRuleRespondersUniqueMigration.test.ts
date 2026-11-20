import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import type { SpyInstance } from "jest-mock";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import Migrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  MAX_ATTEMPTS,
  MakeEscalationRuleRespondersUnique1809187100000,
  ResponderTable,
  SCHEDULE_RESPONDERS,
  TEAM_RESPONDERS,
  USER_RESPONDERS,
  softDeleteNewerCopies,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187100000-MakeEscalationRuleRespondersUnique";
import { PERMISSION_ROW_MIGRATIONS } from "../../../../Server/Infrastructure/Postgres/PermissionRowMigrations";
import logger from "../../../../Server/Utils/Logger";
import {
  ESCALATION_RULE_SCHEDULE_INDEX,
  ESCALATION_RULE_TEAM_INDEX,
  ESCALATION_RULE_USER_INDEX,
} from "../../../../Types/OnCallDutyPolicy/EscalationRuleResponderOnce";

/*
 * ONE ROW PER RESPONDER OF AN ESCALATION RULE (#10411).
 *
 * MakeEscalationRuleRespondersUnique soft-deletes the newer copies of a
 * person, team or schedule a rule has twice, then builds the partial unique
 * index each model declares. Pinned here without a database: the indexes
 * are the ones the models declare (the drift check holds the two together
 * on Postgres), built online outside a transaction, the copies found and
 * soft-deleted as described - the oldest kept, deleted rows left alone, rows
 * that name nobody no copies - a copy added during a build soft-deleted and
 * the build run again, and the migration's place in Index.ts.
 * MakeEscalationRuleRespondersUniquePostgres runs it on a database with
 * duplicates.
 */

const PREDICATE: string = '"deletedAt" IS NULL';

interface Kind {
  table: string;
  model: { new (): BaseModel };
  indexName: string;
  responders: ResponderTable;
  columns: Array<string>;
}

const KINDS: Array<Kind> = [
  {
    table: "OnCallDutyPolicyEscalationRuleUser",
    model: OnCallDutyPolicyEscalationRuleUser,
    indexName: ESCALATION_RULE_USER_INDEX,
    responders: USER_RESPONDERS,
    columns: ["onCallDutyPolicyEscalationRuleId", "userId"],
  },
  {
    table: "OnCallDutyPolicyEscalationRuleTeam",
    model: OnCallDutyPolicyEscalationRuleTeam,
    indexName: ESCALATION_RULE_TEAM_INDEX,
    responders: TEAM_RESPONDERS,
    columns: ["onCallDutyPolicyEscalationRuleId", "teamId"],
  },
  {
    table: "OnCallDutyPolicyEscalationRuleSchedule",
    model: OnCallDutyPolicyEscalationRuleSchedule,
    indexName: ESCALATION_RULE_SCHEDULE_INDEX,
    responders: SCHEDULE_RESPONDERS,
    columns: [
      "onCallDutyPolicyEscalationRuleId",
      "onCallDutyPolicyScheduleId",
      "pageNextInRotation",
    ],
  },
];

// The statement that builds a kind's index, as the generator wrote it.
function createIndexOf(kind: Kind): string {
  return `CREATE UNIQUE INDEX "${kind.indexName}" ON "${kind.table}" (${kind.columns
    .map((column: string): string => {
      return `"${column}"`;
    })
    .join(", ")}) WHERE ${PREDICATE}`;
}

const NAME: string = "MakeEscalationRuleRespondersUnique1809187100000";

type MigrationClass = { name: string };

const registered: Array<string> = (
  Migrations as unknown as Array<MigrationClass>
).map((migration: MigrationClass): string => {
  return migration.name;
});

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * A QueryRunner outside a transaction that records every statement, and
 * answers each soft delete with `deleted(table)` rows, as TypeORM answers
 * an UPDATE: [rows, count].
 */
function recordingRunner(
  deleted: (table: string) => number = (): number => {
    return 0;
  },
): { queryRunner: QueryRunner; statements: Array<string> } {
  const statements: Array<string> = [];

  return {
    statements: statements,
    queryRunner: {
      isTransactionActive: false,
      query: async (statement: string): Promise<unknown> => {
        statements.push(statement.trim());

        const table: RegExpMatchArray | null = statement.match(
          /UPDATE "([^"]+)" newer/,
        );

        return table ? [[], deleted(table[1]!)] : [];
      },
    } as unknown as QueryRunner,
  };
}

// What up() or down() hands OnlineDdl, and what it runs itself.
async function recordOnline(direction: "up" | "down"): Promise<{
  built: Array<string>;
  dropped: Array<string>;
  plain: Array<string>;
}> {
  const built: Array<string> = [];
  const dropped: Array<string> = [];

  jest.spyOn(OnlineDdl, "createIndex").mockImplementation((async (
    _queryRunner: unknown,
    statement: string,
  ) => {
    built.push(statement);
  }) as never);
  jest.spyOn(OnlineDdl, "dropIndex").mockImplementation((async (
    _queryRunner: unknown,
    statement: string,
  ) => {
    dropped.push(statement);
  }) as never);

  const { queryRunner, statements } = recordingRunner();

  await new MakeEscalationRuleRespondersUnique1809187100000()[direction](
    queryRunner,
  );

  return { built, dropped, plain: statements };
}

describe("the models", () => {
  test.each(KINDS)(
    "$table declares one partial unique index over its rule and responder, by the name the services recover from",
    (kind: Kind) => {
      const declared: Array<IndexMetadataArgs> =
        getMetadataArgsStorage().indices.filter(
          (index: IndexMetadataArgs): boolean => {
            return index.target === kind.model && index.name === kind.indexName;
          },
        );

      expect(declared).toHaveLength(1);
      expect(declared[0]!.unique).toBe(true);
      expect(declared[0]!.columns).toEqual(kind.columns);
      expect(declared[0]!.where).toBe(PREDICATE);
      // The migration finds copies by the same columns.
      expect(kind.responders.table).toBe(kind.table);
      expect(kind.responders.columns).toEqual(kind.columns);
    },
  );
});

describe("the indexes, online", () => {
  test("runs outside a transaction, as CREATE INDEX CONCURRENTLY must", () => {
    expect(new MakeEscalationRuleRespondersUnique1809187100000().transaction).toBe(
      false,
    );
  });

  test("hands OnlineDdl each index exactly as its model declares it", async () => {
    const { built } = await recordOnline("up");

    expect(built).toEqual([
      createIndexOf(KINDS[2]!),
      createIndexOf(KINDS[1]!),
      createIndexOf(KINDS[0]!),
    ]);

    for (const statement of built) {
      expect(() => {
        OnlineDdl.parseCreateIndex(statement);
      }).not.toThrow();
    }
  });

  test("before each build, the table's copies are soft-deleted: the only other statements it runs", async () => {
    const { plain } = await recordOnline("up");

    expect(plain).toHaveLength(3);
    expect(
      plain.map((statement: string): string | undefined => {
        return statement.match(/UPDATE "([^"]+)" newer/)?.[1];
      }),
    ).toEqual([
      "OnCallDutyPolicyEscalationRuleSchedule",
      "OnCallDutyPolicyEscalationRuleTeam",
      "OnCallDutyPolicyEscalationRuleUser",
    ]);
  });

  test("down drops the three indexes, online, and leaves the copies deleted", async () => {
    const { dropped, plain } = await recordOnline("down");

    expect(dropped).toEqual([
      `DROP INDEX "public"."${ESCALATION_RULE_USER_INDEX}"`,
      `DROP INDEX "public"."${ESCALATION_RULE_TEAM_INDEX}"`,
      `DROP INDEX "public"."${ESCALATION_RULE_SCHEDULE_INDEX}"`,
    ]);
    expect(plain).toEqual([]);
  });
});

describe("the copies, soft-deleted", () => {
  test.each(KINDS)(
    "$table: one statement finds the copies by its index's columns, of the rows not deleted, and keeps the oldest",
    async (kind: Kind) => {
      const { queryRunner, statements } = recordingRunner();

      await softDeleteNewerCopies(queryRunner, kind.responders);

      expect(statements).toHaveLength(1);
      const statement: string = statements[0]!.replace(/\s+/g, " ");
      const columns: string = kind.columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ");

      // The groups that have copies, found with one read of the table.
      expect(statement).toContain(
        `SELECT ${columns} FROM "${kind.table}" WHERE "deletedAt" IS NULL AND ${kind.columns
          .map((column: string): string => {
            return `"${column}" IS NOT NULL`;
          })
          .join(" AND ")} GROUP BY ${columns} HAVING COUNT(*) > 1`,
      );
      // Ranked oldest first; the oldest stays.
      expect(statement).toContain(
        `ORDER BY responder."createdAt" ASC, responder."_id" ASC`,
      );
      expect(statement).toContain(`INNER JOIN "duplicated" USING (${columns})`);
      expect(statement).toContain(`WHERE responder."deletedAt" IS NULL`);
      // A soft delete, of the rows ranked after the first.
      expect(statement).toContain(`UPDATE "${kind.table}" newer SET "deletedAt" = now()`);
      expect(statement).toContain(`"ranked"."place" > 1`);
      expect(statement).not.toMatch(/\bDELETE\b/);
    },
  );

  test("says how many copies it deleted, and nothing when there were none", async () => {
    const info: SpyInstance<typeof logger.info> = jest
      .spyOn(logger, "info")
      .mockImplementation(() => {
        return undefined as never;
      });

    const none: number = await softDeleteNewerCopies(
      recordingRunner().queryRunner,
      USER_RESPONDERS,
    );
    expect(none).toBe(0);
    expect(info).not.toHaveBeenCalled();

    const one: number = await softDeleteNewerCopies(
      recordingRunner((): number => {
        return 1;
      }).queryRunner,
      TEAM_RESPONDERS,
    );
    expect(one).toBe(1);

    const three: number = await softDeleteNewerCopies(
      recordingRunner((): number => {
        return 3;
      }).queryRunner,
      USER_RESPONDERS,
    );
    expect(three).toBe(3);

    expect(info.mock.calls.map((call: Array<unknown>) => {
      return call[0];
    })).toEqual([
      "OnCallDutyPolicyEscalationRuleTeam: soft-deleted 1 copy of responders that escalation rules had more than once, keeping the oldest row of each.",
      "OnCallDutyPolicyEscalationRuleUser: soft-deleted 3 copies of responders that escalation rules had more than once, keeping the oldest row of each.",
    ]);
  });
});

describe("a copy added while an index is built", () => {
  function uniqueViolation(): Error {
    return Object.assign(new Error("could not create unique index"), {
      code: "23505",
    });
  }

  test("is soft-deleted, and the build run again", async () => {
    let builds: number = 0;
    jest.spyOn(OnlineDdl, "createIndex").mockImplementation((async () => {
      builds++;

      if (builds === 1) {
        throw uniqueViolation();
      }
    }) as never);
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });

    const { queryRunner, statements } = recordingRunner();

    await new MakeEscalationRuleRespondersUnique1809187100000().up(queryRunner);

    // The first table twice (a failed build, then one that built), the rest once.
    expect(builds).toBe(4);
    expect(statements).toHaveLength(4);
    expect(statements[0]).toBe(statements[1]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test("again and again: the migration fails after MAX_ATTEMPTS, leaving the database to say why", async () => {
    jest.spyOn(OnlineDdl, "createIndex").mockImplementation((async () => {
      throw uniqueViolation();
    }) as never);
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });

    const { queryRunner, statements } = recordingRunner();

    await expect(
      new MakeEscalationRuleRespondersUnique1809187100000().up(queryRunner),
    ).rejects.toMatchObject({ code: "23505" });
    expect(statements).toHaveLength(MAX_ATTEMPTS);
  });

  test("any other failure of a build fails the migration at once", async () => {
    jest.spyOn(OnlineDdl, "createIndex").mockRejectedValue(
      Object.assign(new Error("canceling statement due to lock timeout"), {
        code: "55P03",
      }) as never,
    );

    const { queryRunner, statements } = recordingRunner();

    await expect(
      new MakeEscalationRuleRespondersUnique1809187100000().up(queryRunner),
    ).rejects.toThrow("lock timeout");
    expect(statements).toHaveLength(1);
  });
});

describe("registration", () => {
  test("is registered, and named after its file's timestamp", () => {
    expect(registered).toContain(NAME);
    expect(new MakeEscalationRuleRespondersUnique1809187100000().name).toBe(NAME);
    expect(
      fs.existsSync(
        path.join(
          MIGRATIONS_DIR,
          "1809187100000-MakeEscalationRuleRespondersUnique.ts",
        ),
      ),
    ).toBe(true);
  });

  test("comes after every migration registered before it", () => {
    const position: number = registered.indexOf(NAME);

    for (const earlier of registered.slice(0, position)) {
      const stamp: RegExpMatchArray | null = earlier.match(/(\d{13})$/);

      if (stamp) {
        expect([earlier, Number(stamp[1]) < 1809187100000]).toEqual([
          earlier,
          true,
        ]);
      }
    }
  });

  test("changes no permission row, so no member's cached permissions go stale", () => {
    expect(PERMISSION_ROW_MIGRATIONS).not.toContain(NAME);
  });
});
