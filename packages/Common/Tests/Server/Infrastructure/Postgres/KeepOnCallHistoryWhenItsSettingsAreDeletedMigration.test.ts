import File from "../../../../Models/DatabaseModels/File";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddEscalationRuleOrderAndNameToOnCallTimeline1809182500000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182500000-AddEscalationRuleOrderAndNameToOnCallTimeline";
import { KeepOnCallHistoryWhenItsSettingsAreDeleted1809182510000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182510000-KeepOnCallHistoryWhenItsSettingsAreDeleted";
import { KeepPersonWhenTheirPictureFileIsDeleted1809182520000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182520000-KeepPersonWhenTheirPictureFileIsDeleted";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * ON-CALL HISTORY STAYS WHEN THE SETTINGS IT NAMES ARE DELETED (issue
 * #9036), AND A PERSON STAYS WHEN THEIR PICTURE'S FILE IS DELETED (#9069).
 *
 * Three migrations, pinned statement by statement against a stand-in query
 * runner, OnlineDdl's own work recorded rather than run (OnlineDdl.test.ts
 * covers it; OnCallHistoryKeptPostgres.test.ts runs all of it on a real
 * Postgres):
 *
 *   - the timeline's two new columns - the level a line is about, as it
 *     was - added in an ordinary migration, nullable with no default, so
 *     nothing is rewritten;
 *   - fifteen foreign keys from the on-call history to the rules,
 *     schedules, teams and people that paged, each handed to
 *     OnlineDdl.replaceForeignKey as the generator wrote its ADD, in a
 *     migration without a transaction, and nothing else run;
 *   - the one from a person to their picture's file, the same way;
 *   - each key's name is TypeORM's own for its table and column, and the
 *     model declares it SET NULL to the same table, so the schema drift
 *     check and these migrations agree;
 *   - down() puts every cascade back.
 */

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

// The 13-digit timestamp a migration class is named with.
const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

interface HistoryKey {
  table: string;
  column: string;
  references: string;
}

// What the on-call history migration changes, in the order it changes them.
const HISTORY_KEYS: Array<HistoryKey> = [
  {
    table: "OnCallDutyPolicyExecutionLog",
    column: "lastExecutedEscalationRuleId",
    references: "OnCallDutyPolicyEscalationRule",
  },
  {
    table: "OnCallDutyPolicyExecutionLog",
    column: "acknowledgedByUserId",
    references: "User",
  },
  {
    table: "OnCallDutyPolicyExecutionLog",
    column: "acknowledgedByTeamId",
    references: "Team",
  },
  {
    table: "OnCallDutyPolicyExecutionLogTimeline",
    column: "onCallDutyPolicyEscalationRuleId",
    references: "OnCallDutyPolicyEscalationRule",
  },
  {
    table: "OnCallDutyPolicyExecutionLogTimeline",
    column: "alertSentToUserId",
    references: "User",
  },
  {
    table: "OnCallDutyPolicyExecutionLogTimeline",
    column: "userBelongsToTeamId",
    references: "Team",
  },
  {
    table: "OnCallDutyPolicyExecutionLogTimeline",
    column: "onCallDutyScheduleId",
    references: "OnCallDutyPolicySchedule",
  },
  {
    table: "OnCallDutyPolicyExecutionLogTimeline",
    column: "overridedByUserId",
    references: "User",
  },
  {
    table: "UserOnCallLog",
    column: "onCallDutyPolicyEscalationRuleId",
    references: "OnCallDutyPolicyEscalationRule",
  },
  {
    table: "UserOnCallLog",
    column: "userBelongsToTeamId",
    references: "Team",
  },
  {
    table: "UserOnCallLog",
    column: "onCallDutyScheduleId",
    references: "OnCallDutyPolicySchedule",
  },
  {
    table: "UserOnCallLog",
    column: "acknowledgedByUserId",
    references: "User",
  },
  {
    table: "UserOnCallLog",
    column: "overridedByUserId",
    references: "User",
  },
  {
    table: "UserOnCallLogTimeline",
    column: "onCallDutyPolicyEscalationRuleId",
    references: "OnCallDutyPolicyEscalationRule",
  },
  {
    table: "UserOnCallLogTimeline",
    column: "userBelongsToTeamId",
    references: "Team",
  },
];

const PICTURE_KEY: HistoryKey = {
  table: "User",
  column: "profilePictureId",
  references: "File",
};

function keyName(key: HistoryKey): string {
  return namingStrategy.foreignKeyName(key.table, [key.column]);
}

function addStatement(key: HistoryKey, onDelete: string): string {
  return `ALTER TABLE "${key.table}" ADD CONSTRAINT "${keyName(key)}" FOREIGN KEY ("${key.column}") REFERENCES "${key.references}"("_id") ON DELETE ${onDelete} ON UPDATE NO ACTION`;
}

interface Run {
  // Everything run on the query runner itself, in order.
  statements: Array<string>;
  // What went to OnlineDdl.replaceForeignKey, in order.
  replaced: Array<string>;
}

async function runOf(
  migrate: (queryRunner: QueryRunner) => Promise<void>,
  options: { isTransactionActive: boolean },
): Promise<Run> {
  const run: Run = { statements: [], replaced: [] };

  jest
    .spyOn(OnlineDdl, "replaceForeignKey")
    .mockImplementation(
      async (_queryRunner: QueryRunner, statement: string): Promise<void> => {
        run.replaced.push(statement);
      },
    );

  for (const step of ["addForeignKey", "createIndex", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async () => {
      throw new Error(`OnlineDdl.${step} is not expected here.`);
    }) as never);
  }

  await migrate({
    isTransactionActive: options.isTransactionActive,
    query: async (sql: string): Promise<unknown> => {
      run.statements.push(sql.replace(/\s+/g, " ").trim());
      return [];
    },
  } as unknown as QueryRunner);

  return run;
}

/*
 * The models, by table: imported here so their decorators have run - a
 * model nothing imports has no metadata.
 */
const MODELS: Record<string, unknown> = {
  OnCallDutyPolicyExecutionLog: OnCallDutyPolicyExecutionLog,
  OnCallDutyPolicyExecutionLogTimeline: OnCallDutyPolicyExecutionLogTimeline,
  UserOnCallLog: UserOnCallLog,
  UserOnCallLogTimeline: UserOnCallLogTimeline,
  User: User,
  OnCallDutyPolicyEscalationRule: OnCallDutyPolicyEscalationRule,
  OnCallDutyPolicySchedule: OnCallDutyPolicySchedule,
  Team: Team,
  File: File,
};

function tableOf(model: unknown): string {
  return (
    Object.keys(MODELS).find((table: string): boolean => {
      return MODELS[table] === model;
    }) || ""
  );
}

/*
 * The model's relation over a column - found by its @JoinColumn, since a
 * property need not be named for its column (User.profilePictureFile) -
 * with its target's table and its ON DELETE.
 */
function relationOf(
  key: HistoryKey,
): { target: string; onDelete: string | undefined } | null {
  const model: unknown = MODELS[key.table];

  const joinColumn: { propertyName: string } | undefined =
    getMetadataArgsStorage().joinColumns.find(
      (candidate: { target: unknown; name?: string | undefined }) => {
        return candidate.target === model && candidate.name === key.column;
      },
    );

  const relation: RelationMetadataArgs | undefined = joinColumn
    ? getMetadataArgsStorage().relations.find(
        (candidate: RelationMetadataArgs): boolean => {
          return (
            candidate.target === model &&
            candidate.propertyName === joinColumn.propertyName
          );
        },
      )
    : undefined;

  if (!relation) {
    return null;
  }

  return {
    target: tableOf((relation.type as () => unknown)()),
    onDelete: relation.options?.onDelete,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddEscalationRuleOrderAndNameToOnCallTimeline1809182500000", () => {
  test("adds the two columns - nullable, no default - in a transaction, and nothing else", async () => {
    const migration: AddEscalationRuleOrderAndNameToOnCallTimeline1809182500000 =
      new AddEscalationRuleOrderAndNameToOnCallTimeline1809182500000();

    expect(
      (migration as unknown as { transaction?: boolean }).transaction,
    ).toBeUndefined();

    const run: Run = await runOf(
      (queryRunner: QueryRunner) => {
        return migration.up(queryRunner);
      },
      { isTransactionActive: true },
    );

    expect(run.statements).toEqual([
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD "escalationRuleOrder" integer`,
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD "escalationRuleName" character varying(100)`,
    ]);
    expect(run.replaced).toEqual([]);
  });

  test("the model declares the same columns, nullable", () => {
    const columns: Array<ColumnMetadataArgs> =
      getMetadataArgsStorage().columns.filter(
        (column: ColumnMetadataArgs): boolean => {
          return (
            column.target === OnCallDutyPolicyExecutionLogTimeline &&
            ["escalationRuleOrder", "escalationRuleName"].includes(
              column.propertyName,
            )
          );
        },
      );

    expect(
      columns
        .map((column: ColumnMetadataArgs) => {
          return {
            name: column.propertyName,
            nullable: column.options.nullable,
            length: column.options.length,
          };
        })
        .sort((left: { name: string }, right: { name: string }) => {
          return left.name.localeCompare(right.name);
        }),
    ).toEqual([
      { name: "escalationRuleName", nullable: true, length: 100 },
      { name: "escalationRuleOrder", nullable: true, length: undefined },
    ]);
  });

  test("down() drops them", async () => {
    const run: Run = await runOf(
      (queryRunner: QueryRunner) => {
        return new AddEscalationRuleOrderAndNameToOnCallTimeline1809182500000().down(
          queryRunner,
        );
      },
      { isTransactionActive: true },
    );

    expect(run.statements).toEqual([
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP COLUMN "escalationRuleName"`,
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP COLUMN "escalationRuleOrder"`,
    ]);
  });
});

describe("KeepOnCallHistoryWhenItsSettingsAreDeleted1809182510000", () => {
  test("runs without a transaction, as OnlineDdl requires", () => {
    expect(
      new KeepOnCallHistoryWhenItsSettingsAreDeleted1809182510000().transaction,
    ).toBe(false);
  });

  test("hands each key, its ADD as generated, to OnlineDdl.replaceForeignKey - and runs nothing else", async () => {
    const run: Run = await runOf(
      (queryRunner: QueryRunner) => {
        return new KeepOnCallHistoryWhenItsSettingsAreDeleted1809182510000().up(
          queryRunner,
        );
      },
      { isTransactionActive: false },
    );

    expect(run.replaced).toEqual(
      HISTORY_KEYS.map((key: HistoryKey): string => {
        return addStatement(key, "SET NULL");
      }),
    );
    // No DROP of its own: a key is never dropped apart from its replacement.
    expect(run.statements).toEqual([]);
  });

  test("each key's name is TypeORM's own for its table and column", () => {
    expect(keyName(HISTORY_KEYS[0]!)).toBe("FK_d4a0ffc5e9e698bb2612ba0e55f");
    expect(
      new Set(
        HISTORY_KEYS.map((key: HistoryKey): string => {
          return keyName(key);
        }),
      ).size,
    ).toBe(15);
  });

  test.each(HISTORY_KEYS)(
    "the model declares $column of $table SET NULL, to $references",
    (key: HistoryKey) => {
      expect(relationOf(key)).toEqual({
        target: key.references,
        onDelete: "SET NULL",
      });
    },
  );

  test("down() puts the cascade back on all fifteen", async () => {
    const run: Run = await runOf(
      (queryRunner: QueryRunner) => {
        return new KeepOnCallHistoryWhenItsSettingsAreDeleted1809182510000().down(
          queryRunner,
        );
      },
      { isTransactionActive: true },
    );

    for (const key of HISTORY_KEYS) {
      expect(run.statements).toContain(
        `ALTER TABLE "${key.table}" DROP CONSTRAINT "${keyName(key)}"`,
      );
      expect(run.statements).toContain(addStatement(key, "CASCADE"));
    }

    expect(run.statements).toHaveLength(30);
    expect(run.replaced).toEqual([]);
  });
});

describe("KeepPersonWhenTheirPictureFileIsDeleted1809182520000", () => {
  test("runs without a transaction, and hands its one key to OnlineDdl.replaceForeignKey", async () => {
    const migration: KeepPersonWhenTheirPictureFileIsDeleted1809182520000 =
      new KeepPersonWhenTheirPictureFileIsDeleted1809182520000();

    expect(migration.transaction).toBe(false);

    const run: Run = await runOf(
      (queryRunner: QueryRunner) => {
        return migration.up(queryRunner);
      },
      { isTransactionActive: false },
    );

    expect(run.replaced).toEqual([addStatement(PICTURE_KEY, "SET NULL")]);
    expect(run.statements).toEqual([]);
    expect(keyName(PICTURE_KEY)).toBe("FK_1f25f5fc0032f7014482d9c195e");
  });

  test("the model declares the picture SET NULL, to File", () => {
    expect(relationOf(PICTURE_KEY)).toEqual({
      target: "File",
      onDelete: "SET NULL",
    });
  });

  test("down() puts the cascade back", async () => {
    const run: Run = await runOf(
      (queryRunner: QueryRunner) => {
        return new KeepPersonWhenTheirPictureFileIsDeleted1809182520000().down(
          queryRunner,
        );
      },
      { isTransactionActive: true },
    );

    expect(run.statements).toEqual([
      `ALTER TABLE "User" DROP CONSTRAINT "${keyName(PICTURE_KEY)}"`,
      addStatement(PICTURE_KEY, "CASCADE"),
    ]);
  });
});

describe("registration", () => {
  test("each is registered once, in order, after every migration before them, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const ours: Array<unknown> = [
      AddEscalationRuleOrderAndNameToOnCallTimeline1809182500000,
      KeepOnCallHistoryWhenItsSettingsAreDeleted1809182510000,
      KeepPersonWhenTheirPictureFileIsDeleted1809182520000,
    ];

    for (const migration of ours) {
      expect(
        registered.filter((candidate: unknown): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);
    }

    const first: number = registered.indexOf(ours[0]);

    expect(registered.indexOf(ours[1])).toBe(first + 1);
    expect(registered.indexOf(ours[2])).toBe(first + 2);

    const timestamps: Array<number> = registered.map((migration: unknown) => {
      return Number(
        MIGRATION_TIMESTAMP.exec((migration as { name: string }).name)?.[1] ||
          0,
      );
    });

    expect(Math.max(...timestamps.slice(0, first))).toBeLessThan(1809182500000);

    expect(
      new AddEscalationRuleOrderAndNameToOnCallTimeline1809182500000().name,
    ).toBe("AddEscalationRuleOrderAndNameToOnCallTimeline1809182500000");
    expect(
      new KeepOnCallHistoryWhenItsSettingsAreDeleted1809182510000().name,
    ).toBe("KeepOnCallHistoryWhenItsSettingsAreDeleted1809182510000");
    expect(
      new KeepPersonWhenTheirPictureFileIsDeleted1809182520000().name,
    ).toBe("KeepPersonWhenTheirPictureFileIsDeleted1809182520000");
  });
});
