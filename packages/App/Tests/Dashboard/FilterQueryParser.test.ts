import LogFilterConfig from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/LogFilterConfig";
import TraceFilterConfig from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/TraceFilterConfig";
import {
  buildFilterQuery,
  getValueForOperator,
  joinListValue,
  parseFilterQuery,
  splitListValue,
} from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/FilterQueryParser";
import { FilterFieldDefinition } from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/Types";

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

const fieldOf: (key: string) => FilterFieldDefinition = (
  key: string,
): FilterFieldDefinition => {
  return [...TraceFilterConfig.fields, ...LogFilterConfig.fields].find(
    (field: FilterFieldDefinition): boolean => {
      return field.key === key;
    },
  )!;
};

// "Is one of" on Status, Span Kind or Severity is picked from labels (#9214).
describe("an is-one-of condition's list of values", () => {
  test("splits a stored list into its values, trimmed, without blanks or repeats", () => {
    expect(splitListValue("0, 2")).toEqual(["0", "2"]);
    expect(splitListValue(" 0,2 ,, 2 ")).toEqual(["0", "2"]);
    expect(splitListValue("")).toEqual([]);
  });

  test("joins picked values the way the parser reads them back", () => {
    expect(joinListValue(["0", "2"])).toBe("0, 2");
    expect(joinListValue([])).toBe("");
    expect(joinListValue(["SPAN_KIND_CLIENT", "SPAN_KIND_CLIENT"])).toBe(
      "SPAN_KIND_CLIENT",
    );
  });

  test.each([
    ["statusCode", ["0", "2"], "statusCode IN ('0', '2')"],
    [
      "kind",
      ["SPAN_KIND_CLIENT", "SPAN_KIND_SERVER"],
      "kind IN ('SPAN_KIND_CLIENT', 'SPAN_KIND_SERVER')",
    ],
  ])(
    "a %s list picked from labels saves its codes and reads back into the same picks",
    (field: string, picked: Array<string>, expected: string) => {
      const query: string = buildFilterQuery(
        [{ field: field, operator: "IN", value: joinListValue(picked) }],
        "AND",
        TraceFilterConfig,
      );

      expect(query).toBe(expected);

      const parsed: string = parseFilterQuery(query, TraceFilterConfig)
        .conditions[0]!.value;
      expect(splitListValue(parsed)).toEqual(picked);
    },
  );

  test("a saved Severity list reads back into the same picks", () => {
    const query: string = "severityText IN ('Error', 'Fatal')";

    expect(
      splitListValue(
        parseFilterQuery(query, LogFilterConfig).conditions[0]!.value,
      ),
    ).toEqual(["Error", "Fatal"]);
  });

  test("equals on a dropdown field keeps only the first of a list's values", () => {
    expect(getValueForOperator("0, 2", "=", fieldOf("statusCode"))).toBe("0");
    expect(getValueForOperator("0, 2", "!=", fieldOf("statusCode"))).toBe("0");
    expect(getValueForOperator("0, 2", "IN", fieldOf("statusCode"))).toBe(
      "0, 2",
    );
  });

  test("a text field's value is left as typed whatever the operator", () => {
    expect(getValueForOperator("a, b", "=", fieldOf("name"))).toBe("a, b");
    expect(getValueForOperator("a, b", "=", undefined)).toBe("a, b");
  });
});
