import { beforeEach, describe, expect, test } from "@jest/globals";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import Search from "Common/Types/BaseDatabase/Search";
import { JSONObject } from "Common/Types/JSON";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import {
  INVENTORY_ITEMS_TABLE_ID,
  INVENTORY_LAST_SEEN_FACET_KEY,
  INVENTORY_SOURCE_FACET_KEY,
  INVENTORY_STATUS_FACET_KEY,
  INVENTORY_TYPE_FACET_KEY,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryFacets";
import { normalizeInventoryListFacetSearch } from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryListFacetRoute";
import { buildInventoryScopeQueryString } from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryScope";
import {
  FacetSelectionState,
  parseFacetSelectionState,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetSelectionState";

const FACET_PARAM: string = TableFilterUrlState.getParamName(
  INVENTORY_ITEMS_TABLE_ID,
  "facets",
);
const VIEW_PARAM: string = TableFilterUrlState.getParamName(
  INVENTORY_ITEMS_TABLE_ID,
  "view",
);
const FILTER_PARAM: string = TableFilterUrlState.getParamName(
  INVENTORY_ITEMS_TABLE_ID,
  "filter",
);

const browser: {
  location: { pathname: string; search: string; hash: string };
  history: {
    state: null;
    replaceState: (state: unknown, unused: string, url: string) => void;
  };
} = {
  location: {
    pathname: "/dashboard/project-id/inventory/items",
    search: "",
    hash: "#inventory",
  },
  history: {
    state: null,
    replaceState: (_state: unknown, _unused: string, url: string): void => {
      const target: URL = new URL(url, "http://localhost");
      browser.location.pathname = target.pathname;
      browser.location.search = target.search;
      browser.location.hash = target.hash;
    },
  },
};

beforeEach(() => {
  (globalThis as Record<string, unknown>)["window"] = browser;
  browser.location.search = "";
});

function arrive(search: string): FacetSelectionState {
  browser.location.search = normalizeInventoryListFacetSearch(search);
  return readFacets();
}

function readFacets(): FacetSelectionState {
  return parseFacetSelectionState(
    TableFilterUrlState.read(INVENTORY_ITEMS_TABLE_ID, "facets"),
  );
}

function withSnapshots(
  search: string,
  snapshots: Record<string, JSONObject>,
): string {
  const params: URLSearchParams = new URLSearchParams(search);

  for (const [key, state] of Object.entries(snapshots)) {
    params.set(key, TableFilterUrlState.serializeState(state)!);
  }

  return `?${params.toString()}`;
}

describe("Inventory links restore visible facets", () => {
  test("the sidebar's service link selects the Type chip", () => {
    const state: FacetSelectionState = arrive("?type=service");

    expect(state.facetSelections).toEqual({ inventoryType: ["service"] });
    expect(state.facetOperators).toEqual({ inventoryType: "is" });
    expect(FACET_PARAM).toBe("inventory-items-table-facets");
  });

  test.each(Object.values(EntityType))(
    "the Overview link for %s selects its corresponding type",
    (entityType: EntityType) => {
      const state: FacetSelectionState = arrive(
        buildInventoryScopeQueryString({ entityType }),
      );

      expect(state.facetSelections[INVENTORY_TYPE_FACET_KEY]).toEqual([
        entityType,
      ]);
      expect(state.facetOperators[INVENTORY_TYPE_FACET_KEY]).toBe("is");
    },
  );

  test.each(Object.values(EntitySource))(
    "a %s source link selects the Source chip",
    (source: EntitySource) => {
      const state: FacetSelectionState = arrive(
        buildInventoryScopeQueryString({ source }),
      );

      expect(state.facetSelections[INVENTORY_SOURCE_FACET_KEY]).toEqual([
        source,
      ]);
      expect(state.facetOperators[INVENTORY_SOURCE_FACET_KEY]).toBe("is");
    },
  );

  test("Gone Quiet selects Stale status and preserves its discovered scope", () => {
    const state: FacetSelectionState = arrive(
      buildInventoryScopeQueryString({
        source: EntitySource.Discovered,
        staleOnly: true,
      }),
    );

    expect(state.facetSelections).toEqual({
      inventorySource: ["discovered"],
      inventoryStatus: ["stale"],
    });
    expect(state.facetOperators).toEqual({
      inventorySource: "is",
      inventoryStatus: "is",
    });
    expect(
      state.facetSelections[INVENTORY_LAST_SEEN_FACET_KEY],
    ).toBeUndefined();
  });

  test("a combined scope selects all three chips and consumes legacy params", () => {
    const state: FacetSelectionState = arrive(
      "?type=k8s.pod&source=discovered&stale=true",
    );

    expect(state.facetSelections).toEqual({
      inventoryType: ["k8s.pod"],
      inventorySource: ["discovered"],
      inventoryStatus: ["stale"],
    });

    const params: URLSearchParams = new URLSearchParams(
      browser.location.search,
    );
    for (const key of ["type", "source", "stale"]) {
      expect(params.has(key)).toBe(false);
    }
  });
});

describe("existing list state survives scope normalization", () => {
  test("keeps unrelated, repeated and encoded URL parameters", () => {
    arrive("?type=service&tab=all&tag=a&tag=b&note=ops%20%26%20infra");

    const params: URLSearchParams = new URLSearchParams(
      browser.location.search,
    );
    expect(params.get("tab")).toBe("all");
    expect(params.getAll("tag")).toEqual(["a", "b"]);
    expect(params.get("note")).toBe("ops & infra");
  });

  test("overrides only the scope's dimension, preserving custom and date facets", () => {
    const state: FacetSelectionState = arrive(
      withSnapshots("?type=service", {
        [FACET_PARAM]: {
          facetSelections: {
            inventoryType: ["host", "container"],
            inventorySource: ["discovered"],
            inventoryStatus: ["live", "recent"],
            inventoryLastSeen: ["2026-09-01T00:00:00.000Z"],
            customFieldRegion: ["europe", "north-america"],
            customFieldCost: ["100"],
          },
          facetOperators: {
            inventoryType: "is_not",
            inventorySource: "is",
            inventoryStatus: "is_not",
            inventoryLastSeen: "after",
            customFieldRegion: "is_not",
            customFieldCost: "greater_than",
          },
        },
      }),
    );

    expect(state.facetSelections).toEqual({
      inventoryType: ["service"],
      inventorySource: ["discovered"],
      inventoryStatus: ["live", "recent"],
      inventoryLastSeen: ["2026-09-01T00:00:00.000Z"],
      customFieldRegion: ["europe", "north-america"],
      customFieldCost: ["100"],
    });
    expect(state.facetOperators).toEqual({
      inventoryType: "is",
      inventorySource: "is",
      inventoryStatus: "is_not",
      inventoryLastSeen: "after",
      customFieldRegion: "is_not",
      customFieldCost: "greater_than",
    });
  });

  test("stale scope replaces a previous status without clearing Last Seen", () => {
    const state: FacetSelectionState = arrive(
      withSnapshots("?stale=true", {
        [FACET_PARAM]: {
          facetSelections: {
            inventoryStatus: ["never"],
            inventoryLastSeen: ["2026-08-01T00:00:00.000Z"],
          },
          facetOperators: {
            inventoryStatus: "is_not",
            inventoryLastSeen: "before",
          },
        },
      }),
    );

    expect(state.facetSelections[INVENTORY_STATUS_FACET_KEY]).toEqual([
      "stale",
    ]);
    expect(state.facetOperators[INVENTORY_STATUS_FACET_KEY]).toBe("is");
    expect(state.facetSelections[INVENTORY_LAST_SEEN_FACET_KEY]).toEqual([
      "2026-08-01T00:00:00.000Z",
    ]);
    expect(state.facetOperators[INVENTORY_LAST_SEEN_FACET_KEY]).toBe("before");
  });

  test("narrowing resets pagination while retaining search, sort and other tables", () => {
    arrive(
      withSnapshots("?type=service", {
        [VIEW_PARAM]: {
          page: 8,
          search: "checkout",
          sortBy: "displayName",
          sortOrder: "ASC",
          itemsOnPage: 25,
        },
        [FILTER_PARAM]: { displayName: new Search<string>("gateway") },
        "inventory-archived-table-view": { page: 4 },
      }),
    );

    expect(TableFilterUrlState.read(INVENTORY_ITEMS_TABLE_ID, "view")).toEqual({
      page: 1,
      search: "checkout",
      sortBy: "displayName",
      sortOrder: "ASC",
      itemsOnPage: 25,
    });
    expect(
      TableFilterUrlState.read(INVENTORY_ITEMS_TABLE_ID, "filter")![
        "displayName"
      ],
    ).toEqual(new Search<string>("gateway"));
    expect(
      TableFilterUrlState.read("inventory-archived-table", "view"),
    ).toEqual({ page: 4 });
  });

  test("a link without a previous view explicitly starts at page one", () => {
    arrive("?source=manual");

    expect(TableFilterUrlState.read(INVENTORY_ITEMS_TABLE_ID, "view")).toEqual({
      page: 1,
    });
  });
});

describe("clearing and editing a scope use ordinary table URL persistence", () => {
  test("normalization is idempotent", () => {
    const normalized: string = normalizeInventoryListFacetSearch(
      "?type=service&source=discovered&stale=true",
    );

    expect(normalizeInventoryListFacetSearch(normalized)).toBe(normalized);
  });

  test("an edited type and its operator survive a reload without the old scope", () => {
    arrive("?type=service");
    TableFilterUrlState.write(INVENTORY_ITEMS_TABLE_ID, "facets", {
      facetSelections: { inventoryType: ["host", "container"] },
      facetOperators: { inventoryType: "is_not" },
    });
    TableFilterUrlState.write(INVENTORY_ITEMS_TABLE_ID, "view", { page: 3 });
    const editedSearch: string = browser.location.search;

    const restored: FacetSelectionState = arrive(editedSearch);

    expect(browser.location.search).toBe(editedSearch);
    expect(restored.facetSelections[INVENTORY_TYPE_FACET_KEY]).toEqual([
      "host",
      "container",
    ]);
    expect(restored.facetOperators[INVENTORY_TYPE_FACET_KEY]).toBe("is_not");
    expect(TableFilterUrlState.read(INVENTORY_ITEMS_TABLE_ID, "view")).toEqual({
      page: 3,
    });
  });

  test("clearing facets and reloading does not reinstate the scope", () => {
    arrive("?type=service&source=discovered&stale=true");
    TableFilterUrlState.write(INVENTORY_ITEMS_TABLE_ID, "facets", null);

    const restored: FacetSelectionState = arrive(browser.location.search);

    expect(restored.facetSelections).toEqual({});
    expect(restored.facetOperators).toEqual({});
  });

  test("clearing all table state returns a clean list URL", () => {
    arrive("?type=service");
    TableFilterUrlState.clear(INVENTORY_ITEMS_TABLE_ID);

    expect(browser.location.search).toBe("");
    expect(arrive(browser.location.search).facetSelections).toEqual({});
  });
});

describe("invalid or absent legacy scope parameters", () => {
  test.each([
    "",
    "?tab=all&note=two%20words",
    "?inventory-items-table-view=%7B%22page%22%3A3%7D",
  ])(
    "an unscoped URL remains byte-for-byte unchanged: %s",
    (search: string) => {
      expect(normalizeInventoryListFacetSearch(search)).toBe(search);
    },
  );

  test.each(["false", "1", "yes", "TRUE", ""])(
    "stale=%s does not select Stale",
    (value: string) => {
      expect(arrive(`?stale=${value}`).facetSelections).toEqual({});
      expect(browser.location.search).toBe("");
    },
  );

  test("invalid scope values are removed without changing valid facet or page state", () => {
    const state: FacetSelectionState = arrive(
      withSnapshots("?type=unknown&source=other&stale=false", {
        [FACET_PARAM]: {
          facetSelections: { inventoryType: ["host"] },
          facetOperators: { inventoryType: "is_not" },
        },
        [VIEW_PARAM]: { page: 3 },
      }),
    );

    expect(state.facetSelections[INVENTORY_TYPE_FACET_KEY]).toEqual(["host"]);
    expect(state.facetOperators[INVENTORY_TYPE_FACET_KEY]).toBe("is_not");
    expect(TableFilterUrlState.read(INVENTORY_ITEMS_TABLE_ID, "view")).toEqual({
      page: 3,
    });
  });

  test("a valid source survives alongside invalid type and stale values", () => {
    expect(
      arrive("?type=invalid&source=manual&stale=yes").facetSelections,
    ).toEqual({ inventorySource: ["manual"] });
  });

  test("duplicate legacy parameters are consumed without resurfacing on refresh", () => {
    const state: FacetSelectionState = arrive("?type=service&type=host");

    expect(state.facetSelections[INVENTORY_TYPE_FACET_KEY]).toEqual([
      "service",
    ]);
    expect(new URLSearchParams(browser.location.search).getAll("type")).toEqual(
      [],
    );
  });

  test.each(["not-json", '{"facetSelections":', "[]", "null", "42"])(
    "a malformed existing facet/view snapshot still applies the scope: %s",
    (raw: string) => {
      const params: URLSearchParams = new URLSearchParams("type=service");
      params.set(FACET_PARAM, raw);
      params.set(VIEW_PARAM, raw);

      expect(arrive(`?${params.toString()}`).facetSelections).toEqual({
        inventoryType: ["service"],
      });
      expect(
        TableFilterUrlState.read(INVENTORY_ITEMS_TABLE_ID, "view"),
      ).toEqual({
        page: 1,
      });
    },
  );
});
