import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import {
  LLM_LOG_PROJECT_CREATED_AT_INDEX,
  LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD,
  LLM_LOG_PROJECT_CREATED_AT_INDEX_COLUMNS,
} from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1798300000000-AddLlmLogProjectCreatedAtIndex";
import LlmLogService from "../../../Server/Services/LlmLogService";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * The project's daily AI limits read today's AI Logs through an index.
 *
 * With a daily token or spend limit set, every AI call and every check
 * before AI work starts sums the project's LlmLog rows since midnight UTC
 * (LlmLogService.getProjectUsageSince), and an incident or alert daily token
 * limit does the same on every autonomous AI call (getTotalTokensUsedSince).
 * LlmLog used to have an index on "projectId" alone, so each sum read the
 * project's whole AI Log history. Migration 1798300000000 builds
 * ("projectId", "createdAt"), and these tests hold the three things that
 * keep it serving those sums, without a database:
 *
 *   1. LlmLog declares it by name, with `synchronize: false`: the migration
 *      owns it (it may have to leave the build to the operator), so the
 *      schema builder must neither drop it nor generate a second copy.
 *   2. The declaration and the migration name the same index on the same
 *      columns, in the same order.
 *   3. Every daily sum still constrains exactly those columns the way an
 *      index can use: equality on the project, then a plain lower bound on
 *      the time - no function around "createdAt", no OR across projects.
 *
 * LlmLogDailyUsageIndexPostgres.test.ts runs the same statements on a
 * migrated Postgres and reads the plan; the migration's own behaviour is
 * Tests/Server/Infrastructure/Postgres/AddLlmLogProjectCreatedAtIndexMigration.test.ts.
 */

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SINCE: Date = new Date("2026-10-05T00:00:00.000Z");

/* "createdAt" inside a function call, or cast: either hides it from the index. */
const WRAPPED_TIME: RegExp = /\(\s*"log"\."createdAt"/;
const CAST_TIME: RegExp = /"log"\."createdAt"\s*::/;

function findDeclaration(): IndexMetadataArgs | undefined {
  return getMetadataArgsStorage().indices.find(
    (index: IndexMetadataArgs): boolean => {
      return (
        index.target === LlmLog &&
        index.name === LLM_LOG_PROJECT_CREATED_AT_INDEX
      );
    },
  );
}

function captureQueries(): Array<CapturedQuery> {
  const captured: Array<CapturedQuery> = [];

  jest.spyOn(LlmLogService, "getRepository").mockReturnValue({
    manager: {
      query: async (
        sql: string,
        params: Array<unknown>,
      ): Promise<Array<Record<string, unknown>>> => {
        captured.push({ sql, params });
        return [{ total: "0", totalTokens: "0", billedCostInUSDCents: "0" }];
      },
    },
  } as unknown as ReturnType<typeof LlmLogService.getRepository>);

  return captured;
}

/* Every daily sum the index serves, as the service sends it. */
async function captureEveryDailySum(): Promise<
  Array<{ name: string; query: CapturedQuery }>
> {
  const captured: Array<CapturedQuery> = captureQueries();
  const lane: {
    projectId: ObjectID;
    since: Date;
    features: Array<string>;
    legacyIncidentFeatures: Array<string>;
    legacyAlertFeatures: Array<string>;
  } = {
    projectId: PROJECT_ID,
    since: SINCE,
    features: ["AI Incident Investigation", "AI Alert Investigation"],
    legacyIncidentFeatures: ["AI Incident Investigation"],
    legacyAlertFeatures: ["AI Alert Investigation"],
  };

  await LlmLogService.getProjectUsageSince({
    projectId: PROJECT_ID,
    since: SINCE,
  });
  await LlmLogService.getTotalTokensUsedSince({
    ...lane,
    incidentId: ObjectID.generate(),
  });
  await LlmLogService.getTotalTokensUsedSince({
    ...lane,
    alertId: ObjectID.generate(),
  });
  await LlmLogService.getTotalTokensUsedSince(lane);

  const names: Array<string> = [
    "the project's daily limits",
    "the incident daily token limit",
    "the alert daily token limit",
    "AI work outside incidents and alerts",
  ];

  expect(captured).toHaveLength(names.length);

  return captured.map(
    (
      query: CapturedQuery,
      position: number,
    ): { name: string; query: CapturedQuery } => {
      return { name: names[position]!, query };
    },
  );
}

/* The WHERE clause of the outer query, subqueries left in. */
function whereClause(sql: string): string {
  const where: number = sql.indexOf(" WHERE ");
  expect(where).toBeGreaterThan(-1);
  return sql.slice(where + " WHERE ".length);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("1. LlmLog declares the index the migration owns", () => {
  test("by name, on the project and the time, in that order", () => {
    const declaration: IndexMetadataArgs | undefined = findDeclaration();

    expect(declaration).toBeDefined();
    expect(declaration?.columns).toEqual(
      LLM_LOG_PROJECT_CREATED_AT_INDEX_COLUMNS,
    );
    expect(declaration?.unique).not.toBe(true);
    expect(declaration?.where).toBeUndefined();
  });

  test("with schema synchronization off, so no generated migration drops it or adds a copy", () => {
    /*
     * RdbmsSchemaBuilder drops every index it cannot match by name, and
     * creates every synchronized one it cannot find. The migration may leave
     * a large install's build to its operator, so neither may happen here.
     */
    expect(findDeclaration()?.synchronize).toBe(false);
  });

  test("and no other LlmLog index claims those columns", () => {
    const sameColumns: Array<IndexMetadataArgs> = getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs): boolean => {
        return index.target === LlmLog;
      })
      .filter((index: IndexMetadataArgs): boolean => {
        return (
          JSON.stringify(index.columns) ===
          JSON.stringify(LLM_LOG_PROJECT_CREATED_AT_INDEX_COLUMNS)
        );
      });

    expect(sameColumns).toHaveLength(1);
  });

  test("the migration builds exactly the declared columns", () => {
    expect(LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD).toBe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${LLM_LOG_PROJECT_CREATED_AT_INDEX}" ON "LlmLog" ("projectId", "createdAt")`,
    );
  });
});

describe("2. every daily sum constrains what the index orders by", () => {
  test("the project and the time, bound as $1 and $2", async () => {
    for (const { name, query } of await captureEveryDailySum()) {
      expect({ name, params: query.params.slice(0, 2) }).toEqual({
        name,
        params: [PROJECT_ID.toString(), SINCE],
      });
    }
  });

  test("equality on the project, then a plain lower bound on the time", async () => {
    for (const { name, query } of await captureEveryDailySum()) {
      expect({ name, where: whereClause(query.sql) }).toEqual({
        name,
        where: expect.stringMatching(
          /^"log"\."projectId" = \$1 AND "log"\."createdAt" >= \$2 AND /,
        ),
      });
    }
  });

  test("nothing wraps the time or reaches across projects", async () => {
    for (const { name, query } of await captureEveryDailySum()) {
      const where: string = whereClause(query.sql);

      // A function or cast around the column hides it from the index.
      expect({ name, wrapped: WRAPPED_TIME.test(where) }).toEqual({
        name,
        wrapped: false,
      });
      expect({ name, cast: CAST_TIME.test(where) }).toEqual({
        name,
        cast: false,
      });
      // One project per sum: the column is compared once, to $1 only.
      expect({
        name,
        projectComparisons: where.match(/"log"\."projectId"/g)?.length,
      }).toEqual({ name, projectComparisons: 1 });
    }
  });
});
