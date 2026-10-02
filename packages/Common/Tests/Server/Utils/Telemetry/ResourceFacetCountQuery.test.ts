import {
  buildResourceFacetCountStatement,
  readResourceFacetCounts,
} from "../../../../Server/Utils/Telemetry/ResourceFacetCountQuery";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import ResourceEntityFilter, {
  ResourceEntityScope,
} from "../../../../Server/Utils/Telemetry/ResourceEntityFilter";
import LogAggregationService from "../../../../Server/Services/LogAggregationService";
import TraceAggregationService from "../../../../Server/Services/TraceAggregationService";
import LogDatabaseService from "../../../../Server/Services/LogService";
import SpanService from "../../../../Server/Services/SpanService";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * The projection behind per-resource facet counts (issue #3251).
 *
 * Selection matches a resource by `primaryEntityId IN (...) OR
 * hasAny(entityKeys, [...]) OR attributes['resource.x'] IN (...)`, so the
 * count has to use the same membership test or the sidebar reports 0 for
 * every resource that is only mentioned in `entityKeys` (pure-OTLP clusters
 * and hosts) while clicking the value returns all of them.
 *
 * The shape pinned here: one `countIf(...)` column per resource, branches
 * OR-ed inside one predicate so a row matching several of them counts once.
 * When a scope has a scalar key column, a main pass (id OR scalar key) runs
 * over every row and a disjoint legacy pass (`NOT main AND full`) runs only
 * on rows without scalar keys (`serviceEntityKey = ''`).
 */

function render(
  ids: Array<string>,
  scopes: Map<string, ResourceEntityScope>,
): Statement {
  return buildResourceFacetCountStatement({
    ids,
    scopes,
    appendFromWhere: (statement: Statement): void => {
      statement.append(" FROM T WHERE w");
    },
  });
}

describe("buildResourceFacetCountStatement", () => {
  test("emits one countIf column per resource, in the order given", () => {
    const ids: Array<string> = ["k8s-1", "k8s-2"];
    const scopes: Map<string, ResourceEntityScope> = new Map<
      string,
      ResourceEntityScope
    >([
      ["k8s-1", { entityIds: ["k8s-1"], entityKeys: [] }],
      ["k8s-2", { entityIds: ["k8s-2"], entityKeys: [] }],
    ]);

    const statement: Statement = render(ids, scopes);

    expect(statement.query).toBe(
      "SELECT countIf((primaryEntityId IN ({p0:Array(String)}))) AS cnt_0, countIf((primaryEntityId IN ({p1:Array(String)}))) AS cnt_1 FROM T WHERE w",
    );
    expect(statement.query_params).toEqual({
      p0: ["k8s-1"],
      p1: ["k8s-2"],
    });
  });

  test("one pass when the scope has no attribute or scalar column to split off", () => {
    const scopes: Map<string, ResourceEntityScope> = new Map<
      string,
      ResourceEntityScope
    >([["db-1", { entityIds: ["db-1"], entityKeys: ["k1", "k2"] }]]);

    expect(render(["db-1"], scopes).query).toBe(
      "SELECT countIf((primaryEntityId IN ({p0:Array(String)}) OR hasAny(entityKeys, {p1:Array(String)}))) AS cnt_0 FROM T WHERE w",
    );
  });

  test("attribute-only types keep the attribute in the main pass", () => {
    const scopes: Map<string, ResourceEntityScope> = new Map<
      string,
      ResourceEntityScope
    >([
      [
        "fn-1",
        {
          entityIds: ["fn-1"],
          entityKeys: [],
          attributeKey: "resource.faas.name",
          attributeValues: ["checkout-fn"],
        },
      ],
    ]);

    expect(render(["fn-1"], scopes).query).toBe(
      "SELECT countIf((primaryEntityId IN ({p0:Array(String)}) OR attributes[{p1:String}] IN ({p2:Array(String)}))) AS cnt_0 FROM T WHERE w",
    );
  });

  test("keyed types: scalar column on every row, full predicate only on pre-scalar rows", () => {
    const scopes: Map<string, ResourceEntityScope> = new Map<
      string,
      ResourceEntityScope
    >([
      [
        "k8s-1",
        {
          entityIds: ["k8s-1"],
          entityKeys: ["8efdcd74d7e22ba0"],
          entityKeyColumn: "k8sClusterEntityKey",
          attributeKey: "resource.k8s.cluster.name",
          attributeValues: ["audit-prod-cluster"],
        },
      ],
      ["k8s-2", { entityIds: ["k8s-2"], entityKeys: [] }],
    ]);

    const statement: Statement = render(["k8s-1", "k8s-2"], scopes);

    expect(statement.query).toBe(
      "SELECT sum(cnt_0) AS cnt_0, sum(cnt_1) AS cnt_1 FROM (" +
        "SELECT countIf((primaryEntityId IN ({p0:Array(String)}) OR k8sClusterEntityKey IN ({p1:Array(String)}))) AS cnt_0, " +
        "countIf((primaryEntityId IN ({p2:Array(String)}))) AS cnt_1 FROM T WHERE w" +
        " UNION ALL " +
        "SELECT countIf((NOT (primaryEntityId IN ({p3:Array(String)}) OR k8sClusterEntityKey IN ({p4:Array(String)})) AND " +
        "(primaryEntityId IN ({p5:Array(String)}) OR hasAny(entityKeys, {p6:Array(String)}) OR attributes[{p7:String}] IN ({p8:Array(String)})))) AS cnt_0, " +
        "countIf(0) AS cnt_1 FROM T WHERE w AND serviceEntityKey = '')",
    );
    expect(statement.query_params["p7"]).toBe("resource.k8s.cluster.name");
    expect(statement.query_params["p8"]).toEqual(["audit-prod-cluster"]);
  });

  test("array-keyed types drop only the attribute from the main pass", () => {
    const scopes: Map<string, ResourceEntityScope> = new Map<
      string,
      ResourceEntityScope
    >([
      [
        "swarm-1",
        {
          entityIds: ["swarm-1"],
          entityKeys: ["abc"],
          attributeKey: "resource.docker.swarm.cluster.name",
          attributeValues: ["swarm"],
        },
      ],
    ]);

    expect(render(["swarm-1"], scopes).query).toContain(
      "FROM (SELECT countIf((primaryEntityId IN ({p0:Array(String)}) OR hasAny(entityKeys, {p1:Array(String)}))) AS cnt_0 FROM T WHERE w UNION ALL",
    );
  });

  test("counts nothing, not everything, for an id with no usable branch", () => {
    const ids: Array<string> = ["missing"];
    const scopes: Map<string, ResourceEntityScope> = new Map<
      string,
      ResourceEntityScope
    >([["missing", { entityIds: [], entityKeys: [] }]]);

    expect(render(ids, scopes).query).toBe(
      "SELECT countIf(0) AS cnt_0 FROM T WHERE w",
    );
  });

  test("an id with no scope at all also counts nothing", () => {
    expect(render(["missing"], new Map()).query).toBe(
      "SELECT countIf(0) AS cnt_0 FROM T WHERE w",
    );
  });
});

describe("readResourceFacetCounts", () => {
  test("maps columns back to their ids by position", () => {
    expect(
      readResourceFacetCounts({ cnt_0: 25, cnt_1: 0, cnt_2: 7 }, [
        "a",
        "b",
        "c",
      ]),
    ).toEqual([
      { value: "a", count: 25 },
      { value: "b", count: 0 },
      { value: "c", count: 7 },
    ]);
  });

  test("numeric strings are read as numbers (ClickHouse JSON)", () => {
    expect(readResourceFacetCounts({ cnt_0: "25" }, ["a"])).toEqual([
      { value: "a", count: 25 },
    ]);
  });

  test("a missing row or column reads as 0 rather than shifting the mapping", () => {
    expect(readResourceFacetCounts(undefined, ["a", "b"])).toEqual([
      { value: "a", count: 0 },
      { value: "b", count: 0 },
    ]);
    expect(readResourceFacetCounts({ cnt_0: 5 }, ["a", "b"])).toEqual([
      { value: "a", count: 5 },
      { value: "b", count: 0 },
    ]);
  });

  test("an unparseable value reads as 0", () => {
    expect(readResourceFacetCounts({ cnt_0: "not-a-number" }, ["a"])).toEqual([
      { value: "a", count: 0 },
    ]);
  });
});

/*
 * Both services run the count with timeout_overflow_mode = 'throw': 'break'
 * returns zero rows on timeout, which readResourceFacetCounts would report
 * as an exact 0 for every listed resource.
 */
describe("resource facet count query settings", () => {
  test.each([
    ["logs", LogAggregationService, LogDatabaseService],
    ["traces", TraceAggregationService, SpanService],
  ] as const)(
    "%s count throws on timeout instead of truncating to zero",
    async (_name: string, service: unknown, database: unknown) => {
      jest
        .spyOn(ResourceEntityFilter, "resolveCountScopes")
        .mockResolvedValue(
          new Map([["c1", { entityIds: ["c1"], entityKeys: [] }]]),
        );
      const executeQuery: jest.SpiedFunction<() => Promise<unknown>> = jest
        .spyOn(database as never, "executeQuery" as never)
        .mockResolvedValue({
          json: async () => {
            return { data: [{ cnt_0: "7" }] };
          },
        } as never);

      const counts: Array<{ value: string; count: number }> = await (
        service as typeof LogAggregationService
      ).getResourceFacetValueCounts({
        projectId: ObjectID.generate(),
        startTime: new Date(0),
        endTime: new Date(),
        facetKey: "kubernetesClusterId",
        entityIds: ["c1"],
      });

      const statement: Statement = executeQuery.mock.calls[0]![
        0 as never
      ] as Statement;
      expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
      expect(statement.query).not.toContain("'break'");
      expect(counts).toEqual([{ value: "c1", count: 7 }]);
      jest.restoreAllMocks();
    },
  );
});
