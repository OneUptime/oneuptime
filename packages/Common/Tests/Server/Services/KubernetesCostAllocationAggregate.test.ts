import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../Server/Utils/Logger";
import "../TestingUtils/Init";
import KubernetesCostAllocation from "../../../Models/AnalyticsModels/KubernetesCostAllocation";
import AggregateBy from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  describe,
  expect,
  beforeEach,
  test,
  afterEach,
  jest,
} from "@jest/globals";

/*
 * Statement-generation regressions for the Kubernetes Costs pages.
 *
 * The project- and cluster-level Costs pages issue grouped `Total`
 * (whole-window) aggregations over KubernetesCostAllocation. Under Total
 * the timestamp is selected as `min(windowStart) as windowStart`, and
 * ClickHouse substitutes SELECT aliases into same-level unqualified
 * WHERE references — so the window filter `WHERE windowStart >= ...`
 * compiled to `WHERE min(windowStart) >= ...` and every one of these
 * queries failed with ILLEGAL_AGGREGATION ("Server Error" on the page).
 * The WHERE must therefore be table-qualified; these tests pin the
 * statement shapes the pages depend on.
 */
describe("KubernetesCostAllocation aggregate statements (Costs pages)", () => {
  const TABLE_NAME: string = "KubernetesCostAllocationV1";

  const projectId: string = "7b4157fc-c25d-41ea-aabc-972e0ee2c492";
  const startDate: Date = new Date("2026-07-18T10:00:00.000Z");
  const endDate: Date = new Date("2026-07-25T10:00:00.000Z");

  let service: AnalyticsDatabaseService<KubernetesCostAllocation>;

  beforeEach(() => {
    service = new AnalyticsDatabaseService({
      modelType: KubernetesCostAllocation,
    });
    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined!;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type BuildAggregateByFunction = (
    overrides?: Partial<AggregateBy<KubernetesCostAllocation>>,
  ) => AggregateBy<KubernetesCostAllocation>;

  /**
   * Mirrors what the Costs pages send (see
   * App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostUtils.ts
   * buildAggregateBy): a project-scoped windowStart range, sorted
   * ascending, LIMIT_PER_PROJECT.
   */
  const buildAggregateBy: BuildAggregateByFunction = (
    overrides?: Partial<AggregateBy<KubernetesCostAllocation>>,
  ): AggregateBy<KubernetesCostAllocation> => {
    return {
      query: {
        projectId: projectId,
        windowStart: new InBetween(startDate, endDate),
      } as AggregateBy<KubernetesCostAllocation>["query"],
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "totalCost",
      aggregationTimestampColumnName: "windowStart",
      startTimestamp: startDate,
      endTimestamp: endDate,
      limit: 10000,
      skip: 0,
      sort: {
        windowStart: SortOrder.Ascending,
      } as AggregateBy<KubernetesCostAllocation>["sort"],
      props: { isRoot: true },
      ...overrides,
    };
  };

  type BuildResultFunction = (
    aggregateBy: AggregateBy<KubernetesCostAllocation>,
  ) => { query: string; params: Record<string, unknown> };

  const build: BuildResultFunction = (
    aggregateBy: AggregateBy<KubernetesCostAllocation>,
  ): { query: string; params: Record<string, unknown> } => {
    const result: { statement: Statement; columns: Array<string> } =
      service.toAggregateStatement(aggregateBy);
    return {
      query: result.statement.query,
      params: result.statement.query_params,
    };
  };

  /**
   * Every WHERE column reference must be qualified with the model table
   * name — an unqualified reference would resolve to the SELECT alias.
   */
  type ExpectQualifiedWhereFunction = (
    query: string,
    params: Record<string, unknown>,
    expectedColumns: Array<string>,
  ) => void;

  const expectQualifiedWhere: ExpectQualifiedWhereFunction = (
    query: string,
    params: Record<string, unknown>,
    expectedColumns: Array<string>,
  ): void => {
    const qualifierTables: Array<unknown> = Object.entries(params)
      .filter(([key]: [string, unknown]) => {
        return key.endsWith("_t");
      })
      .map(([, value]: [string, unknown]) => {
        return value;
      });
    const qualifierColumns: Array<unknown> = Object.entries(params)
      .filter(([key]: [string, unknown]) => {
        return key.endsWith("_c");
      })
      .map(([, value]: [string, unknown]) => {
        return value;
      });

    expect(qualifierTables).toHaveLength(expectedColumns.length);
    for (const table of qualifierTables) {
      expect(table).toBe(TABLE_NAME);
    }
    expect([...qualifierColumns].sort()).toStrictEqual(
      [...expectedColumns].sort(),
    );
    // The WHERE must not contain a single bare identifier reference.
    expect(query).not.toMatch(/AND \{p\d+:Identifier\}/);
  };

  test("spend-by-cluster (grouped Total) keeps min(windowStart) and a qualified window filter", () => {
    // fetchClusterBreakdown: sum(totalCost) grouped by clusterName, Total.
    const { query, params } = build(
      buildAggregateBy({
        groupBy: {
          clusterName: true,
        } as AggregateBy<KubernetesCostAllocation>["groupBy"],
        aggregationInterval: AggregationInterval.Total,
      }),
    );

    expect(query).toContain("sum(totalCost) as totalCost");
    expect(query).toContain("min(windowStart) as windowStart");
    expect(query).not.toContain("date_trunc");

    expectQualifiedWhere(query, params, [
      "projectId",
      "windowStart",
      "windowStart",
    ]);

    // Grouped by the cluster column only — never by the Total timestamp.
    expect(query).toContain("GROUP BY {p9:Identifier}");
    expect(params["p9"]).toBe("clusterName");
    // Grouped queries never carry the empty-window phantom-row guard.
    expect(query).not.toContain("HAVING count() > 0");

    /*
     * ORDER BY / GROUP BY must stay UNqualified: they are meant to
     * resolve to the SELECT aliases (a qualified ORDER BY would hit
     * NOT_AN_AGGREGATE under GROUP BY).
     */
    expect(query).toMatch(/ORDER BY \{p\d+:Identifier\} ASC/);

    expect(Object.values(params)).toContain(TABLE_NAME);
    expect(Object.values(params)).toContain(projectId);
  });

  test("idle-spend variant adds a qualified namespace filter", () => {
    // fetchClusterBreakdown's idle query: extraQuery namespace="__idle__".
    const { query, params } = build(
      buildAggregateBy({
        query: {
          projectId: projectId,
          windowStart: new InBetween(startDate, endDate),
          namespace: "__idle__",
        } as AggregateBy<KubernetesCostAllocation>["query"],
        groupBy: {
          clusterName: true,
        } as AggregateBy<KubernetesCostAllocation>["groupBy"],
        aggregationInterval: AggregationInterval.Total,
      }),
    );

    expect(query).toContain("min(windowStart) as windowStart");
    expectQualifiedWhere(query, params, [
      "projectId",
      "windowStart",
      "windowStart",
      "namespace",
    ]);
    expect(Object.values(params)).toContain("__idle__");
  });

  test("efficiency variant (Avg over totalEfficiency) is qualified the same way", () => {
    const { query, params } = build(
      buildAggregateBy({
        aggregateColumnName: "totalEfficiency",
        aggregationType: AggregationType.Avg,
        groupBy: {
          clusterName: true,
        } as AggregateBy<KubernetesCostAllocation>["groupBy"],
        aggregationInterval: AggregationInterval.Total,
      }),
    );

    expect(query).toContain("avg(totalEfficiency) as totalEfficiency");
    expect(query).toContain("min(windowStart) as windowStart");
    expectQualifiedWhere(query, params, [
      "projectId",
      "windowStart",
      "windowStart",
    ]);
  });

  test("namespace/workload breakdowns group by multiple columns under Total", () => {
    // fetchWorkloadBreakdown groups by namespace + controllerKind + controllerName.
    const { query, params } = build(
      buildAggregateBy({
        groupBy: {
          namespace: true,
          controllerKind: true,
          controllerName: true,
        } as AggregateBy<KubernetesCostAllocation>["groupBy"],
        aggregationInterval: AggregationInterval.Total,
      }),
    );

    expect(query).toContain("min(windowStart) as windowStart");
    expectQualifiedWhere(query, params, [
      "projectId",
      "windowStart",
      "windowStart",
    ]);
    const paramValues: Array<unknown> = Object.values(params);
    expect(paramValues).toContain("namespace");
    expect(paramValues).toContain("controllerKind");
    expect(paramValues).toContain("controllerName");
  });

  test("cost-trend (bucketed) query is qualified and groups by the bucket alias", () => {
    // fetchCostTrend: no groupBy, interval derived from the 7-day window.
    const { query, params } = build(buildAggregateBy());

    // A 7-day window derives an Hour bucket.
    expect(query).toContain(
      "date_trunc('hour', toStartOfInterval(windowStart, INTERVAL 1 hour)) as windowStart",
    );
    expect(query).not.toContain("min(windowStart)");

    /*
     * The window filter must read the RAW windowStart column. Before
     * qualification the bucket alias was substituted into WHERE, which
     * silently snapped the window edges to bucket boundaries.
     */
    expectQualifiedWhere(query, params, [
      "projectId",
      "windowStart",
      "windowStart",
    ]);

    // The GROUP BY targets the bucket alias — bare, never qualified.
    expect(query).toContain("GROUP BY windowStart");
    expect(query).toMatch(/ORDER BY \{p\d+:Identifier\} ASC/);
  });

  test("cluster-scoped queries (cluster view page) qualify the kubernetesClusterId filter", () => {
    const clusterId: string = "0a1b2c3d-0000-0000-0000-000000000000";
    const { query, params } = build(
      buildAggregateBy({
        query: {
          projectId: projectId,
          windowStart: new InBetween(startDate, endDate),
          kubernetesClusterId: clusterId,
        } as AggregateBy<KubernetesCostAllocation>["query"],
        groupBy: {
          namespace: true,
        } as AggregateBy<KubernetesCostAllocation>["groupBy"],
        aggregationInterval: AggregationInterval.Total,
      }),
    );

    expectQualifiedWhere(query, params, [
      "projectId",
      "windowStart",
      "windowStart",
      "kubernetesClusterId",
    ]);
    expect(Object.values(params)).toContain(clusterId);
  });

  test("group-less Total keeps the qualified filter and the empty-window guard", () => {
    const { query, params } = build(
      buildAggregateBy({
        aggregationInterval: AggregationInterval.Total,
      }),
    );

    expect(query).toContain("min(windowStart) as windowStart");
    expect(query).not.toContain("GROUP BY");
    expect(query).toContain("HAVING count() > 0");
    expectQualifiedWhere(query, params, [
      "projectId",
      "windowStart",
      "windowStart",
    ]);
  });

  test("the retention read filter stays a raw unaliased predicate", () => {
    /*
     * `retentionDate >= now()` is appended as raw SQL. No SELECT alias
     * named retentionDate exists, so it needs no qualification — but it
     * must be present on every aggregate read.
     */
    const { query } = build(
      buildAggregateBy({
        groupBy: {
          clusterName: true,
        } as AggregateBy<KubernetesCostAllocation>["groupBy"],
        aggregationInterval: AggregationInterval.Total,
      }),
    );
    expect(query).toContain("retentionDate >= now()");
  });
});
