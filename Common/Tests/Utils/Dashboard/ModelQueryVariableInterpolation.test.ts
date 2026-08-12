import Includes from "../../../Types/BaseDatabase/Includes";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardModelQueryInterpolation, {
  AttributeToColumnMap,
} from "../../../Utils/Dashboard/ModelQueryVariableInterpolation";
import { describe, expect, test } from "@jest/globals";

/*
 * DashboardModelQueryInterpolation rewrites a Postgres model query so a list
 * widget honours the dashboard's telemetry-attribute variables — mapping the
 * OTel attribute key (host.name) to the model column (hostname) and writing
 * the predicate. Key behaviors under test: it only touches mapped
 * TelemetryAttribute variables, single vs multi select produce scalar vs
 * Includes predicates, an empty selection clears a prior filter, and the input
 * query object is never mutated (a fresh object is returned only on change).
 */

function attrVariable(
  attributeKey: string,
  overrides: Partial<DashboardVariable>,
): DashboardVariable {
  return {
    id: attributeKey,
    name: attributeKey,
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey,
    ...overrides,
  };
}

const MAP: AttributeToColumnMap = {
  "host.name": "hostname",
  "k8s.namespace.name": "namespace",
};

describe("DashboardModelQueryInterpolation.applyToQuery - no-ops", () => {
  test("returns the same query object when there are no variables", () => {
    const query: Record<string, unknown> = { foo: "bar" };
    expect(
      DashboardModelQueryInterpolation.applyToQuery(query, undefined, MAP),
    ).toBe(query);
    expect(DashboardModelQueryInterpolation.applyToQuery(query, [], MAP)).toBe(
      query,
    );
  });

  test("returns the same query object when the attribute map is empty", () => {
    const query: Record<string, unknown> = { foo: "bar" };
    const variables: Array<DashboardVariable> = [
      attrVariable("host.name", { selectedValue: "web1" }),
    ];
    expect(
      DashboardModelQueryInterpolation.applyToQuery(query, variables, {}),
    ).toBe(query);
  });

  test("ignores non-TelemetryAttribute variables and unmapped keys", () => {
    const query: Record<string, unknown> = { foo: "bar" };
    const variables: Array<DashboardVariable> = [
      {
        id: "t",
        name: "t",
        type: DashboardVariableType.TextInput,
        selectedValue: "x",
      },
      attrVariable("unmapped.key", { selectedValue: "y" }),
    ];
    expect(
      DashboardModelQueryInterpolation.applyToQuery(query, variables, MAP),
    ).toBe(query);
  });
});

describe("DashboardModelQueryInterpolation.applyToQuery - writing predicates", () => {
  test("writes a scalar predicate for a single-select variable", () => {
    const query: Record<string, unknown> = {};
    const result: Record<string, unknown> =
      DashboardModelQueryInterpolation.applyToQuery(
        query,
        [attrVariable("host.name", { selectedValue: "web1" })],
        MAP,
      );

    expect(result).not.toBe(query); // fresh object
    expect(query).toEqual({}); // input untouched
    expect(result["hostname"]).toBe("web1");
  });

  test("writes an Includes predicate for a multi-select variable", () => {
    const result: Record<string, unknown> =
      DashboardModelQueryInterpolation.applyToQuery(
        {},
        [
          attrVariable("host.name", {
            isMultiSelect: true,
            selectedValues: ["web1", "web2"],
          }),
        ],
        MAP,
      );

    expect(result["hostname"]).toBeInstanceOf(Includes);
    expect((result["hostname"] as Includes).values).toEqual(["web1", "web2"]);
  });

  /*
   * Resource list widgets share DashboardVariableInterpolation.resolveValue
   * with the metric widgets, so they inherit the "All" rule: an empty
   * multi-select filters nothing, and the variable's single-select Default
   * does not stand in for the picks the user did not make.
   */
  test("an empty multi-select writes no predicate, Default or not", () => {
    const query: Record<string, unknown> = { kind: "Container" };
    const result: Record<string, unknown> =
      DashboardModelQueryInterpolation.applyToQuery(
        query,
        [
          attrVariable("host.name", {
            isMultiSelect: true,
            selectedValues: [],
            defaultValue: "web1",
          }),
        ],
        MAP,
      );

    expect(result).toBe(query);
    expect(result["hostname"]).toBeUndefined();
  });

  test("a cleared multi-select removes a prior filter on that column", () => {
    const query: Record<string, unknown> = { hostname: "web1", kind: "Pod" };
    const result: Record<string, unknown> =
      DashboardModelQueryInterpolation.applyToQuery(
        query,
        [
          attrVariable("host.name", {
            isMultiSelect: true,
            selectedValues: [],
            defaultValue: "web1",
          }),
        ],
        MAP,
      );

    expect(result).toEqual({ kind: "Pod" });
    expect(query).toEqual({ hostname: "web1", kind: "Pod" }); // input untouched
  });

  test("maps two variables onto their respective columns", () => {
    const result: Record<string, unknown> =
      DashboardModelQueryInterpolation.applyToQuery(
        {},
        [
          attrVariable("host.name", { selectedValue: "web1" }),
          attrVariable("k8s.namespace.name", { selectedValue: "prod" }),
        ],
        MAP,
      );

    expect(result["hostname"]).toBe("web1");
    expect(result["namespace"]).toBe("prod");
  });
});

describe("DashboardModelQueryInterpolation.applyToQuery - clearing predicates", () => {
  test("an empty selection removes a prior filter on that column", () => {
    const query: Record<string, unknown> = { hostname: "old" };
    const result: Record<string, unknown> =
      DashboardModelQueryInterpolation.applyToQuery(
        query,
        [attrVariable("host.name", { selectedValue: "" })],
        MAP,
      );

    expect(result).not.toBe(query);
    expect(result).not.toHaveProperty("hostname");
    // input query left intact
    expect(query["hostname"]).toBe("old");
  });

  test("an empty selection with no prior filter is a no-op (same object)", () => {
    const query: Record<string, unknown> = { other: "x" };
    const result: Record<string, unknown> =
      DashboardModelQueryInterpolation.applyToQuery(
        query,
        [attrVariable("host.name", { selectedValue: "" })],
        MAP,
      );

    expect(result).toBe(query);
  });

  test("falls back to defaultValue when nothing is selected", () => {
    const result: Record<string, unknown> =
      DashboardModelQueryInterpolation.applyToQuery(
        {},
        [attrVariable("host.name", { defaultValue: "default-host" })],
        MAP,
      );

    expect(result["hostname"]).toBe("default-host");
  });
});
