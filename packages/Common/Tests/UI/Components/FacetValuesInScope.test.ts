import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_FACET_EMPTY_STATE_TEXT,
  getFacetValuesInScope,
  getScopedHiddenFacetEmptyStateText,
  getSidebarFacetEmptyStateText,
  hasLockedTelemetryScope,
} from "../../../UI/Components/TelemetryViewer/FacetVisibility";
import {
  ActiveFilter,
  FacetData,
} from "../../../UI/Components/TelemetryViewer/types";

/*
 * A viewer pinned to one scope — a database's Logs tab — listed the
 * project's WHOLE catalog in its sidebar: fifty databases and thirty
 * services at count 0 beside the one database the page is about. Resource
 * facets arrive as the Postgres list with ClickHouse counts merged in, so on
 * a scoped page every other resource shows up at 0 and picking it can only
 * empty the list. These pin the pure rules the two sidebars share:
 *
 *  - a locked chip means "scoped"; nothing else does;
 *  - under a scope, a value with count 0 is dropped unless it is selected;
 *  - a facet emptied that way keeps its key (the sidebar folds it), and a
 *    facet with nothing to drop keeps its very array;
 *  - an empty resource facet under a scope says "in this time range", never
 *    "in this project" (the project may well have such resources).
 */

function locked(value: string): ActiveFilter {
  return {
    facetKey: "entityKeys",
    value: value,
    displayKey: "Database",
    displayValue: "orders-db",
    readOnly: true,
  };
}

function removable(value: string): ActiveFilter {
  return {
    facetKey: "severityText",
    value: value,
    displayKey: "Severity",
    displayValue: value,
  };
}

describe("hasLockedTelemetryScope", () => {
  test("no chips, or only removable ones, is not a scope", () => {
    expect(hasLockedTelemetryScope(undefined)).toBe(false);
    expect(hasLockedTelemetryScope(null)).toBe(false);
    expect(hasLockedTelemetryScope([])).toBe(false);
    expect(hasLockedTelemetryScope([removable("Error")])).toBe(false);
    expect(
      hasLockedTelemetryScope([{ ...removable("Error"), readOnly: false }]),
    ).toBe(false);
  });

  test("any locked chip is a scope", () => {
    expect(hasLockedTelemetryScope([locked("database:1")])).toBe(true);
    expect(
      hasLockedTelemetryScope([removable("Error"), locked("database:1")]),
    ).toBe(true);
  });

  test("tolerates junk entries rather than throwing inside a render", () => {
    expect(
      hasLockedTelemetryScope([
        null as unknown as ActiveFilter,
        undefined as unknown as ActiveFilter,
        locked("database:1"),
      ]),
    ).toBe(true);
    expect(
      hasLockedTelemetryScope("chips" as unknown as Array<ActiveFilter>),
    ).toBe(false);
  });
});

describe("getFacetValuesInScope", () => {
  const CATALOG: FacetData = {
    primaryEntityId: [
      { value: "svc-agent", count: 24, displayName: "kubernetes-agent" },
      { value: "svc-collector", count: 0, displayName: "collector" },
      { value: "svc-fluentbit", count: 0, displayName: "fluentbit-gke" },
    ],
    databaseServerId: [
      { value: "db-clickhouse", count: 0, displayName: "ClickHouse" },
      { value: "db-redis", count: 0, displayName: "Redis" },
    ],
    severityText: [{ value: "Information", count: 24 }],
  };

  test("keeps only values with rows in the scope", () => {
    expect(
      getFacetValuesInScope({ facetData: CATALOG, activeValuesByKey: {} }),
    ).toEqual({
      primaryEntityId: [
        { value: "svc-agent", count: 24, displayName: "kubernetes-agent" },
      ],
      databaseServerId: [],
      severityText: [{ value: "Information", count: 24 }],
    });
  });

  test("a facet with nothing to drop keeps its very array", () => {
    const result: FacetData = getFacetValuesInScope({
      facetData: CATALOG,
      activeValuesByKey: {},
    });

    expect(result["severityText"]).toBe(CATALOG["severityText"]);
    expect(result["primaryEntityId"]).not.toBe(CATALOG["primaryEntityId"]);
  });

  test("a selected value survives at 0, so it can be cleared", () => {
    const result: FacetData = getFacetValuesInScope({
      facetData: CATALOG,
      activeValuesByKey: {
        databaseServerId: new Set<string>(["db-redis"]),
      },
    });

    expect(result["databaseServerId"]).toEqual([
      { value: "db-redis", count: 0, displayName: "Redis" },
    ]);
  });

  test("a selection only protects values of its own facet", () => {
    const result: FacetData = getFacetValuesInScope({
      facetData: CATALOG,
      activeValuesByKey: {
        primaryEntityId: new Set<string>(["db-redis"]),
      },
    });

    expect(result["databaseServerId"]).toEqual([]);
  });

  test("counts that are not positive numbers are not rows", () => {
    const facetData: FacetData = {
      hostId: [
        { value: "negative", count: -1 },
        { value: "nan", count: Number.NaN },
        { value: "infinite", count: Number.POSITIVE_INFINITY },
        { value: "missing", count: undefined as unknown as number },
        { value: "string-zero", count: "0" as unknown as number },
        { value: "string-three", count: "3" as unknown as number },
        { value: "fraction", count: 0.5 },
      ],
    };

    expect(
      getFacetValuesInScope({ facetData: facetData, activeValuesByKey: {} })[
        "hostId"
      ]!.map((value: { value: string }): string => {
        return value.value;
      }),
    ).toEqual(["string-three", "fraction"]);
  });

  test("keeps the order the server sent", () => {
    const facetData: FacetData = {
      hostId: [
        { value: "c", count: 1 },
        { value: "x", count: 0 },
        { value: "a", count: 9 },
        { value: "b", count: 3 },
      ],
    };

    expect(
      getFacetValuesInScope({ facetData: facetData, activeValuesByKey: {} })[
        "hostId"
      ]!.map((value: { value: string }): string => {
        return value.value;
      }),
    ).toEqual(["c", "a", "b"]);
  });

  test("leaves the input untouched", () => {
    const snapshot: string = JSON.stringify(CATALOG);

    getFacetValuesInScope({ facetData: CATALOG, activeValuesByKey: {} });

    expect(JSON.stringify(CATALOG)).toBe(snapshot);
    expect(CATALOG["databaseServerId"]).toHaveLength(2);
  });

  test("an empty response stays empty, and junk entries pass through", () => {
    expect(
      getFacetValuesInScope({ facetData: {}, activeValuesByKey: {} }),
    ).toEqual({});

    const facetData: FacetData = {
      broken: undefined as unknown as FacetData[string],
      hostId: [
        null as unknown as FacetData[string][number],
        { value: "h-1", count: 2 },
      ],
    };

    const result: FacetData = getFacetValuesInScope({
      facetData: facetData,
      activeValuesByKey: {},
    });

    expect(result["broken"]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, "broken")).toBe(true);
    expect(result["hostId"]).toEqual([{ value: "h-1", count: 2 }]);
  });
});

describe("empty-state wording under a scope", () => {
  test("a resource facet says 'in this time range', not 'in this project'", () => {
    expect(getScopedHiddenFacetEmptyStateText("Databases")).toBe(
      "No Databases in this time range",
    );
    expect(
      getSidebarFacetEmptyStateText({
        isHideable: true,
        emptyStateNoun: "Databases",
        isScoped: true,
      }),
    ).toBe("No Databases in this time range");
  });

  test("without a noun it falls back to the default sentence", () => {
    expect(getScopedHiddenFacetEmptyStateText(undefined)).toBe(
      DEFAULT_FACET_EMPTY_STATE_TEXT,
    );
    expect(getScopedHiddenFacetEmptyStateText("   ")).toBe(
      DEFAULT_FACET_EMPTY_STATE_TEXT,
    );
  });

  test("unscoped wording is unchanged", () => {
    expect(
      getSidebarFacetEmptyStateText({
        isHideable: true,
        emptyStateNoun: "Databases",
      }),
    ).toBe("No Databases in this project");
    expect(
      getSidebarFacetEmptyStateText({
        isHideable: true,
        emptyStateNoun: "Databases",
        isScoped: false,
      }),
    ).toBe("No Databases in this project");
  });

  test("a non-resource facet keeps the section's default either way", () => {
    expect(
      getSidebarFacetEmptyStateText({ isHideable: false, isScoped: true }),
    ).toBeUndefined();
  });

  test("a search result still reads as one, scope or not", () => {
    expect(
      getSidebarFacetEmptyStateText({
        isHideable: true,
        emptyStateNoun: "Databases",
        isScoped: true,
        searchedAtArrivalText: "redis",
      }),
    ).toBe("No matches for “redis”");
  });
});
