import LogFilterConfig from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/LogFilterConfig";
import TraceFilterConfig from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/TraceFilterConfig";
import {
  buildFilterQuery,
  parseFilterQuery,
} from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/FilterQueryParser";

describe("FilterQueryParser", () => {
  test("round-trips custom attribute IN filters", () => {
    const query: string = buildFilterQuery(
      [
        {
          field: "attributes.k8s.object.kind",
          operator: "IN",
          value: "Pod, Deployment, ReplicaSet",
        },
      ],
      "AND",
      LogFilterConfig,
    );

    expect(query).toBe(
      "attributes.k8s.object.kind IN ('Pod', 'Deployment', 'ReplicaSet')",
    );

    expect(parseFilterQuery(query, LogFilterConfig)).toEqual({
      connector: "AND",
      conditions: [
        {
          field: "attributes.k8s.object.kind",
          operator: "IN",
          value: "Pod, Deployment, ReplicaSet",
        },
      ],
    });
  });

  test("keeps IN filters when wrapped in grouping parentheses", () => {
    const query: string =
      "(attributes.k8s.namespace.name IN ('prod', 'staging'))";

    expect(parseFilterQuery(query, LogFilterConfig)).toEqual({
      connector: "AND",
      conditions: [
        {
          field: "attributes.k8s.namespace.name",
          operator: "IN",
          value: "prod, staging",
        },
      ],
    });
  });

  test("round-trips a multi-condition AND query across =, !=, LIKE and IN", () => {
    /*
     * Exercises the per-part split-then-strip path with more than one
     * condition and an IN clause in the LAST position. A regression that
     * stripped the IN clause's own trailing ')' (the original bug) would
     * drop that condition and fail this test.
     */
    const query: string = buildFilterQuery(
      [
        { field: "severityText", operator: "=", value: "ERROR" },
        { field: "body", operator: "LIKE", value: "%timeout%" },
        { field: "primaryEntityId", operator: "!=", value: "svc-123" },
        {
          field: "attributes.k8s.object.kind",
          operator: "IN",
          value: "Pod, Deployment",
        },
      ],
      "AND",
      LogFilterConfig,
    );

    expect(query).toBe(
      "severityText = 'ERROR' AND body LIKE '%timeout%' AND " +
        "primaryEntityId != 'svc-123' AND " +
        "attributes.k8s.object.kind IN ('Pod', 'Deployment')",
    );

    expect(parseFilterQuery(query, LogFilterConfig)).toEqual({
      connector: "AND",
      conditions: [
        { field: "severityText", operator: "=", value: "ERROR" },
        { field: "body", operator: "LIKE", value: "%timeout%" },
        { field: "primaryEntityId", operator: "!=", value: "svc-123" },
        {
          field: "attributes.k8s.object.kind",
          operator: "IN",
          value: "Pod, Deployment",
        },
      ],
    });
  });

  test("round-trips a multi-condition OR query with an IN clause", () => {
    const query: string = buildFilterQuery(
      [
        { field: "severityText", operator: "=", value: "ERROR" },
        {
          field: "attributes.k8s.namespace.name",
          operator: "IN",
          value: "prod, staging",
        },
      ],
      "OR",
      LogFilterConfig,
    );

    expect(query).toBe(
      "severityText = 'ERROR' OR " +
        "attributes.k8s.namespace.name IN ('prod', 'staging')",
    );

    expect(parseFilterQuery(query, LogFilterConfig)).toEqual({
      connector: "OR",
      conditions: [
        { field: "severityText", operator: "=", value: "ERROR" },
        {
          field: "attributes.k8s.namespace.name",
          operator: "IN",
          value: "prod, staging",
        },
      ],
    });
  });

  test("round-trips IN filters for the trace filter config", () => {
    const query: string = buildFilterQuery(
      [
        {
          field: "attributes.http.request.method",
          operator: "IN",
          value: "GET, POST",
        },
      ],
      "AND",
      TraceFilterConfig,
    );

    expect(query).toBe("attributes.http.request.method IN ('GET', 'POST')");

    expect(parseFilterQuery(query, TraceFilterConfig)).toEqual({
      connector: "AND",
      conditions: [
        {
          field: "attributes.http.request.method",
          operator: "IN",
          value: "GET, POST",
        },
      ],
    });
  });

  test("returns the default condition for an empty query", () => {
    expect(parseFilterQuery("", LogFilterConfig)).toEqual({
      connector: "AND",
      conditions: [{ field: "severityText", operator: "=", value: "" }],
    });
  });
});
