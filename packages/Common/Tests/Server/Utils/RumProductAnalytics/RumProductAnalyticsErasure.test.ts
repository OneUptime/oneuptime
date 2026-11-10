import {
  PRODUCT_ANALYTICS_ERASURE_IDS_PER_MUTATION,
  ProductAnalyticsErasureFilter,
  buildProductAnalyticsDeleteStatement,
  buildProductAnalyticsErasureFilters,
  buildProductAnalyticsUserSessionLookup,
} from "../../../../Server/Utils/RumProductAnalytics/RumProductAnalyticsErasure";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import { RumSessionErasureRequestType } from "../../../../Models/DatabaseModels/RumSessionErasureRequest";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * What a session replay erasure request takes from product analytics
 * (issue #6444). The tables keep a session's summary for 13 months - longer
 * than most recordings - so these filters are how a subject the recordings
 * no longer name is still erased. Every one is pinned to the project, and
 * to the application when the request names one: a filter that lost either
 * would erase other people's rows.
 */

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const applicationId: ObjectID = new ObjectID("6600000000000000000000b1");
const userKey: string = "a".repeat(64);
const databaseName: string = "oneuptime";

function params(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function idsOf(count: number): Array<string> {
  return Array.from({ length: count }, (_unused: unknown, index: number) => {
    return index.toString(16).padStart(32, "0");
  });
}

function boundArrays(statement: Statement): Array<Array<string>> {
  return params(statement).filter((value: unknown): boolean => {
    return Array.isArray(value);
  }) as Array<Array<string>>;
}

describe("buildProductAnalyticsErasureFilters", () => {
  test("a list of sessions is removed from the session table by id, in mutations of at most 1000", () => {
    const ids: Array<string> = idsOf(2500);

    const filters: Array<ProductAnalyticsErasureFilter> =
      buildProductAnalyticsErasureFilters({
        projectId: projectId,
        requestType: RumSessionErasureRequestType.BySessionId,
        sessionIds: ids,
      });

    expect(PRODUCT_ANALYTICS_ERASURE_IDS_PER_MUTATION).toBe(1000);
    expect(filters).toHaveLength(3);

    for (const filter of filters) {
      expect(filter.tableName).toBe(
        AnalyticsTableName.RumProductAnalyticsSession,
      );
      expect(filter.where.query).toContain("projectId = ");
      expect(filter.where.query).toContain("sessionId IN ");
      expect(filter.where.query).not.toContain("rumApplicationId");
      expect(params(filter.where)).toContain(projectId.toString());
    }

    expect(
      filters.map((filter: ProductAnalyticsErasureFilter): number => {
        return boundArrays(filter.where)[0]!.length;
      }),
    ).toEqual([1000, 1000, 500]);
    expect(
      filters.flatMap((filter: ProductAnalyticsErasureFilter) => {
        return boundArrays(filter.where)[0]!;
      }),
    ).toEqual(ids);
  });

  test("a list's duplicates and empty ids are dropped, and no ids means no delete", () => {
    const filters: Array<ProductAnalyticsErasureFilter> =
      buildProductAnalyticsErasureFilters({
        projectId: projectId,
        requestType: RumSessionErasureRequestType.BySessionId,
        sessionIds: ["s1", "", "s1", "s2"],
      });

    expect(filters).toHaveLength(1);
    expect(boundArrays(filters[0]!.where)).toEqual([["s1", "s2"]]);

    expect(
      buildProductAnalyticsErasureFilters({
        projectId: projectId,
        requestType: RumSessionErasureRequestType.BySessionId,
        sessionIds: [],
      }),
    ).toEqual([]);
  });

  test("a request scoped to one application stays in it", () => {
    const filters: Array<ProductAnalyticsErasureFilter> =
      buildProductAnalyticsErasureFilters({
        projectId: projectId,
        rumApplicationId: applicationId,
        requestType: RumSessionErasureRequestType.BySessionId,
        sessionIds: ["s1"],
      });

    expect(filters[0]!.where.query).toContain("AND rumApplicationId = ");
    expect(params(filters[0]!.where)).toContain(applicationId.toString());
  });

  test("a user: the sessions found for them by id, and their monthly rows by key", () => {
    const filters: Array<ProductAnalyticsErasureFilter> =
      buildProductAnalyticsErasureFilters({
        projectId: projectId,
        requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
        targetValue: ` ${userKey} `,
        sessionIds: ["s1", "s2"],
      });

    expect(
      filters.map((filter: ProductAnalyticsErasureFilter) => {
        return filter.tableName;
      }),
    ).toEqual([
      AnalyticsTableName.RumProductAnalyticsSession,
      AnalyticsTableName.RumProductAnalyticsUser,
    ]);

    expect(boundArrays(filters[0]!.where)).toEqual([["s1", "s2"]]);

    const months: Statement = filters[1]!.where;

    expect(months.query).toContain("personKey = ");
    expect(params(months)).toContain(`u:${userKey}`);
    expect(params(months)).toContain(projectId.toString());
  });

  test("a user with no sessions left still loses their monthly rows", () => {
    const filters: Array<ProductAnalyticsErasureFilter> =
      buildProductAnalyticsErasureFilters({
        projectId: projectId,
        rumApplicationId: applicationId,
        requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
        targetValue: userKey,
      });

    expect(filters).toHaveLength(1);
    expect(filters[0]!.tableName).toBe(
      AnalyticsTableName.RumProductAnalyticsUser,
    );
    expect(filters[0]!.where.query).toContain("AND rumApplicationId = ");
    expect(params(filters[0]!.where)).toContain(applicationId.toString());
  });

  test("a user request without a key is refused, not run as every anonymous person", () => {
    for (const targetValue of [undefined, "", "   "]) {
      expect(() => {
        return buildProductAnalyticsErasureFilters({
          projectId: projectId,
          requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
          targetValue: targetValue,
        });
      }).toThrow("no user key");
    }
  });

  test("an application: every row of it, in both tables", () => {
    const filters: Array<ProductAnalyticsErasureFilter> =
      buildProductAnalyticsErasureFilters({
        projectId: projectId,
        requestType: RumSessionErasureRequestType.ByRumApplication,
        targetValue: applicationId.toString(),
      });

    expect(
      filters.map((filter: ProductAnalyticsErasureFilter) => {
        return filter.tableName;
      }),
    ).toEqual([
      AnalyticsTableName.RumProductAnalyticsSession,
      AnalyticsTableName.RumProductAnalyticsUser,
    ]);

    for (const filter of filters) {
      expect(filter.where.query).toContain("projectId = ");
      expect(filter.where.query).toContain("AND rumApplicationId = ");
      expect(params(filter.where)).toContain(applicationId.toString());
      expect(params(filter.where)).toContain(projectId.toString());
    }
  });

  test("an application request reads the id from the relation when targetValue is empty, and refuses with neither", () => {
    const filters: Array<ProductAnalyticsErasureFilter> =
      buildProductAnalyticsErasureFilters({
        projectId: projectId,
        requestType: RumSessionErasureRequestType.ByRumApplication,
        rumApplicationId: applicationId,
      });

    expect(params(filters[0]!.where)).toContain(applicationId.toString());

    expect(() => {
      return buildProductAnalyticsErasureFilters({
        projectId: projectId,
        requestType: RumSessionErasureRequestType.ByRumApplication,
      });
    }).toThrow("no application id");
  });

  test("a date range: the session table's sessions that started in it; the monthly rows stay", () => {
    const startDate: Date = new Date("2026-01-01T00:00:00.000Z");
    const endDate: Date = new Date("2026-01-31T23:59:59.000Z");

    const filters: Array<ProductAnalyticsErasureFilter> =
      buildProductAnalyticsErasureFilters({
        projectId: projectId,
        rumApplicationId: applicationId,
        requestType: RumSessionErasureRequestType.ByDateRange,
        startDate: startDate,
        endDate: endDate,
      });

    expect(filters).toHaveLength(1);
    expect(filters[0]!.tableName).toBe(
      AnalyticsTableName.RumProductAnalyticsSession,
    );

    const where: Statement = filters[0]!.where;

    expect(where.query).toContain("startTime >= ");
    expect(where.query).toContain("startTime <= ");
    expect(where.query).toContain("AND rumApplicationId = ");
    expect(params(where)).toContain(applicationId.toString());
    expect(where.query).not.toContain("personKey");
  });

  test("a date range without both ends is refused", () => {
    expect(() => {
      return buildProductAnalyticsErasureFilters({
        projectId: projectId,
        requestType: RumSessionErasureRequestType.ByDateRange,
        startDate: new Date(),
      });
    }).toThrow("no start or end date");
  });

  test("a request type it does not know is refused, never guessed at", () => {
    expect(() => {
      return buildProductAnalyticsErasureFilters({
        projectId: projectId,
        requestType: "ByEverything" as RumSessionErasureRequestType,
      });
    }).toThrow("Unsupported erasure request type");
  });

  test("ids, keys and dates are bound, never written into the SQL", () => {
    const filters: Array<ProductAnalyticsErasureFilter> =
      buildProductAnalyticsErasureFilters({
        projectId: projectId,
        requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
        targetValue: userKey,
        sessionIds: ["11111111111111111111111111111111"],
      });

    for (const filter of filters) {
      expect(filter.where.query).not.toContain(userKey);
      expect(filter.where.query).not.toContain(projectId.toString());
      expect(filter.where.query).not.toContain(
        "11111111111111111111111111111111",
      );
    }
  });
});

describe("buildProductAnalyticsUserSessionLookup", () => {
  test("reads the user's sessions across the cluster, scoped and capped", () => {
    const statement: Statement = buildProductAnalyticsUserSessionLookup({
      databaseName: databaseName,
      projectId: projectId,
      identifiedUserKey: userKey,
      rumApplicationId: applicationId,
      limit: 10000,
    });

    expect(statement.query).toContain(
      "SELECT DISTINCT sessionId AS paSessionId",
    );
    expect(statement.query).toContain("identifiedUserKey = ");
    expect(statement.query).toContain("AND rumApplicationId = ");
    expect(statement.query).toContain("LIMIT ");

    /*
     * The Distributed table, not the shard's own: the lookup has to see
     * every shard, and the deletes then go to every shard ON CLUSTER.
     */
    expect(params(statement)).toContain(
      AnalyticsTableName.RumProductAnalyticsSession,
    );
    expect(params(statement)).not.toContain(
      `${AnalyticsTableName.RumProductAnalyticsSession}Local`,
    );
    expect(params(statement)).toContain(databaseName);
    expect(params(statement)).toContain(userKey);
    expect(params(statement)).toContain(10000);
    expect(params(statement)).toContain(applicationId.toString());
  });

  test("an empty key is refused: it is every session in which nobody signed in", () => {
    for (const identifiedUserKey of ["", "  "]) {
      expect(() => {
        return buildProductAnalyticsUserSessionLookup({
          databaseName: databaseName,
          projectId: projectId,
          identifiedUserKey: identifiedUserKey,
          limit: 10,
        });
      }).toThrow("no user key");
    }
  });
});

describe("buildProductAnalyticsDeleteStatement", () => {
  test("a mutation on each table's LOCAL storage, ON CLUSTER, with the filter as its WHERE", () => {
    for (const tableName of [
      AnalyticsTableName.RumProductAnalyticsSession,
      AnalyticsTableName.RumProductAnalyticsUser,
    ]) {
      const filters: Array<ProductAnalyticsErasureFilter> =
        buildProductAnalyticsErasureFilters({
          projectId: projectId,
          requestType: RumSessionErasureRequestType.ByRumApplication,
          targetValue: applicationId.toString(),
        }).filter((filter: ProductAnalyticsErasureFilter): boolean => {
          return filter.tableName === tableName;
        });

      const statement: Statement = buildProductAnalyticsDeleteStatement({
        databaseName: databaseName,
        filter: filters[0]!,
      });

      expect(statement.query).toMatch(/^ALTER TABLE /);
      expect(statement.query).toContain(" ON CLUSTER ");
      expect(statement.query).toContain(" DELETE WHERE projectId = ");
      expect(statement.query).toContain("AND rumApplicationId = ");
      expect(params(statement)).toContain(`${tableName}Local`);
      expect(params(statement)).not.toContain(tableName);
      expect(params(statement)).toContain(databaseName);
      expect(params(statement)).toContain(projectId.toString());
      expect(params(statement)).toContain(applicationId.toString());
    }
  });
});
