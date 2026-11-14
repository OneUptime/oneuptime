import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddOnCallExecutionLogListIndexes1809166000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809166000000-AddOnCallExecutionLogListIndexes";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE ON-CALL POLICY LOGS LIST READS IN INDEX ORDER.
 *
 * The On-Call Policy Logs list (ExecutionLogsTable) reads a project's runs,
 * or a policy's, newest first. With only bare ("projectId") and
 * ("onCallDutyPolicyId") indexes, every page of it read every run of the
 * project or policy and sorted them: on an install that has paged for years,
 * hundreds of thousands of rows per page. ("projectId", "createdAt") and
 * ("onCallDutyPolicyId", "createdAt") read a page in order, and serve every
 * read by their leading column alone, so the bare indexes go.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>". The names are TypeORM's own,
 * so the drift check finds nothing to change.
 */

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

// The 13-digit timestamp a migration class is named with.
const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

const TABLE: string = "OnCallDutyPolicyExecutionLog";

const PROJECT_LIST_INDEX: string = namingStrategy.indexName(TABLE, [
  "projectId",
  "createdAt",
]);
const POLICY_LIST_INDEX: string = namingStrategy.indexName(TABLE, [
  "onCallDutyPolicyId",
  "createdAt",
]);
const PROJECT_ID_INDEX: string = namingStrategy.indexName(TABLE, ["projectId"]);
const POLICY_ID_INDEX: string = namingStrategy.indexName(TABLE, [
  "onCallDutyPolicyId",
]);

/*
 * Written by hand (TypeORM does not model statistics, so the drift check
 * cannot see them): a policy's runs are all in its project. Without it the
 * planner reads a policy's list - which filters on the project too - by
 * sorting every run of the policy.
 */
const POLICY_PROJECT_STATISTICS: string =
  "OnCallDutyPolicyExecutionLog_policy_project_dependencies";

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
  options: { isTransactionActive: boolean },
): Promise<Array<string>> {
  const statements: Array<string> = [];

  for (const step of ["createIndex", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      statements.push(`online: ${statement}`);
    }) as never);
  }

  await run({
    isTransactionActive: options.isTransactionActive,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddOnCallExecutionLogListIndexes1809166000000", () => {
  test("the indexes are named as TypeORM names them", () => {
    expect(PROJECT_LIST_INDEX).toBe("IDX_83efe1d4496704e958af6aeb43");
    expect(POLICY_LIST_INDEX).toBe("IDX_d9baeb990e2f7076f8b5189b3d");
    expect(PROJECT_ID_INDEX).toBe("IDX_00e9676d39eeb807de70443051");
    expect(POLICY_ID_INDEX).toBe("IDX_e4bb332263960531a4c9e2d425");
  });

  test("the model declares the list indexes, leading column first, and no bare ones", () => {
    const indexes: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return index.target === OnCallDutyPolicyExecutionLog;
        },
      );

    const columnLists: Array<string> = indexes.map(
      (index: IndexMetadataArgs): string => {
        return JSON.stringify(index.columns);
      },
    );

    expect(columnLists).toContain(JSON.stringify(["projectId", "createdAt"]));
    expect(columnLists).toContain(
      JSON.stringify(["onCallDutyPolicyId", "createdAt"]),
    );
    expect(columnLists).not.toContain(JSON.stringify(["projectId"]));
    // A property-level @Index() is recorded as an index of that one column.
    expect(columnLists).not.toContain(JSON.stringify(["onCallDutyPolicyId"]));
  });

  test("the statistics' name fits Postgres' 63-character identifiers", () => {
    expect(POLICY_PROJECT_STATISTICS.length).toBeLessThanOrEqual(63);
  });

  test("builds the list indexes before it drops the bare ones, all online, outside a transaction, then says a policy's runs are all in its project", async () => {
    const migration: AddOnCallExecutionLogListIndexes1809166000000 =
      new AddOnCallExecutionLogListIndexes1809166000000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return migration.up(runner);
        },
        { isTransactionActive: false },
      ),
    ).toEqual([
      `online: CREATE INDEX "${PROJECT_LIST_INDEX}" ON "${TABLE}" ("projectId", "createdAt") `,
      `online: CREATE INDEX "${POLICY_LIST_INDEX}" ON "${TABLE}" ("onCallDutyPolicyId", "createdAt") `,
      `online: DROP INDEX "public"."${PROJECT_ID_INDEX}"`,
      `online: DROP INDEX "public"."${POLICY_ID_INDEX}"`,
      `CREATE STATISTICS IF NOT EXISTS "${POLICY_PROJECT_STATISTICS}" (dependencies) ON "projectId", "onCallDutyPolicyId" FROM "${TABLE}"`,
      `ANALYZE "${TABLE}"`,
    ]);
  });

  test("OnlineDdl reads each build as one it can run concurrently, leading column first", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(
      `CREATE INDEX "${PROJECT_LIST_INDEX}" ON "${TABLE}" ("projectId", "createdAt") `,
    );

    expect(parsed.name).toBe(PROJECT_LIST_INDEX);
    expect(parsed.quotedTable).toBe(`"${TABLE}"`);
    expect(parsed.build).toBe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${PROJECT_LIST_INDEX}" ON "${TABLE}" ("projectId", "createdAt")`,
    );
  });

  test("down() drops the statistics, and puts the bare indexes back before the list indexes go", async () => {
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return new AddOnCallExecutionLogListIndexes1809166000000().down(
            runner,
          );
        },
        { isTransactionActive: true },
      ),
    ).toEqual([
      `DROP STATISTICS IF EXISTS "${POLICY_PROJECT_STATISTICS}"`,
      `CREATE INDEX "${POLICY_ID_INDEX}" ON "${TABLE}" ("onCallDutyPolicyId") `,
      `CREATE INDEX "${PROJECT_ID_INDEX}" ON "${TABLE}" ("projectId") `,
      `online: DROP INDEX "public"."${POLICY_LIST_INDEX}"`,
      `online: DROP INDEX "public"."${PROJECT_LIST_INDEX}"`,
    ]);
  });

  test("is registered once, last, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddOnCallExecutionLogListIndexes1809166000000;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddOnCallExecutionLogListIndexes1809166000000,
    );
    const timestamps: Array<number> = registered.map((migration: unknown) => {
      return Number(
        MIGRATION_TIMESTAMP.exec((migration as { name: string }).name)?.[1] || 0,
      );
    });

    // Numbered after every migration registered before it.
    expect(Math.max(...timestamps.slice(0, position))).toBeLessThan(
      1809166000000,
    );
    expect(new AddOnCallExecutionLogListIndexes1809166000000().name).toBe(
      "AddOnCallExecutionLogListIndexes1809166000000",
    );
  });
});
