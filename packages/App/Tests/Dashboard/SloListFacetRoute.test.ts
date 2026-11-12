import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import {
  buildFacetColumnQuery,
  FacetColumnQuery,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery";
import {
  FacetSelectionState,
  isFacetSelectionActive,
  parseFacetSelectionState,
  sanitizeFacetSelectionState,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetSelectionState";
import { FacetTileSelection } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetTileSelection";
import {
  getSloListBaseQuery,
  getSlosAtRiskSelections,
  SLO_ENABLED_FACET_KEY,
  SLO_LIST_FACETS,
  SLO_STATUS_FACET_KEY,
  SLO_STATUSES_AT_RISK,
  SLOS_TABLE_ID,
  SloEnabledFacetValue,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloStatusSummaryTiles";
import Includes from "Common/Types/BaseDatabase/Includes";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";

/*
 * Home counts the SLOs at risk, and its number - and the View all under the
 * SLOs it lists - open the SLOs list (#6857). That list holds every SLO, so
 * the link sets its Status and Enabled chips to the SLOs Home counted;
 * otherwise the two that need someone are mixed in with the healthy ones.
 *
 * The chips travel in the list's own facet URL parameter, the one its bar
 * writes when a user sets a chip by hand, so three pieces have to agree: the
 * link, the percent-encoding Route needs, and the reader the bar runs on
 * mount. These drive the real Navigation, RouteMap, ProjectUtil and
 * TableFilterUrlState against a stubbed browser, the way
 * MonitorListFacetRoute.test.ts does.
 */

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const HOME_PATH: string = `/dashboard/${PROJECT_ID}/home/`;
const SLOS_PATH: string = `/dashboard/${PROJECT_ID}/slos`;

/*
 * Spelled out once: the name sits in bookmarks and pasted links, so a rename
 * has to be a conscious edit of this line too.
 */
const FACET_PARAM_NAME: string = "slos-table-facets";

const browser: {
  location: { pathname: string; search: string; hash: string };
  history: { state: unknown; replaceState: () => void };
} = {
  location: { pathname: HOME_PATH, search: "", hash: "" },
  history: {
    state: null,
    replaceState: (): void => {
      // no-op; these tests never assert on replaceState.
    },
  },
};

type RouteModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Slo/SloListFacetRoute");
type HomeRouteModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Home/HomeListRoute");
type PageMapEnum =
  (typeof import("../../FeatureSet/Dashboard/src/Utils/PageMap"))["default"];
type NavigationClass = (typeof import("Common/UI/Utils/Navigation"))["default"];
type RouteClass = (typeof import("Common/Types/API/Route"))["default"];
type TableFilterUrlStateClass =
  (typeof import("Common/UI/Utils/TableFilterUrlState"))["default"];

let routeModule: RouteModule;
let homeRouteModule: HomeRouteModule;
let PageMap: PageMapEnum;
let Navigation: NavigationClass;
let Route: RouteClass;
let TableFilterUrlState: TableFilterUrlStateClass;
let navigatedTo: Array<string> = [];

/*
 * Common/UI/Config reads `window` the moment it loads, and RouteMap pulls it
 * in, so the browser stub has to exist before any of them do - hence the
 * deferred imports. The SLO list's vocabulary above reads no `window`.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = browser;
  /*
   * Node 26 ships real sessionStorage/localStorage globals and plain
   * assignment over them throws inside jest's vm context; defining the
   * property works on every version.
   */
  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  routeModule = await import(
    "../../FeatureSet/Dashboard/src/Components/Slo/SloListFacetRoute"
  );
  homeRouteModule = await import(
    "../../FeatureSet/Dashboard/src/Components/Home/HomeListRoute"
  );
  PageMap = (await import("../../FeatureSet/Dashboard/src/Utils/PageMap"))
    .default;
  Navigation = (await import("Common/UI/Utils/Navigation")).default;
  Route = (await import("Common/Types/API/Route")).default;
  TableFilterUrlState = (await import("Common/UI/Utils/TableFilterUrlState"))
    .default;
});

function standAt(pathname: string, search: string = ""): void {
  browser.location.pathname = pathname;
  browser.location.search = search;
  Navigation.setLocation({ pathname: pathname } as unknown as Parameters<
    typeof Navigation.setLocation
  >[0]);
  navigatedTo = [];
  Navigation.setNavigateHook(((to: string): void => {
    navigatedTo.push(to);
  }) as unknown as Parameters<typeof Navigation.setNavigateHook>[0]);
}

// Follow a route the way a click does, and end up standing where it went.
function follow(route: InstanceType<RouteClass>): void {
  Navigation.navigate(route);

  expect(navigatedTo).toHaveLength(1);

  const [pathname, search] = navigatedTo[0]!.split("?") as [
    string,
    string | undefined,
  ];

  standAt(pathname, search ? `?${search}` : "");
}

// The chips the SLO list restores from the address, as useResourceOwners does.
function chipsOnTheList(): FacetSelectionState {
  return sanitizeFacetSelectionState(
    parseFacetSelectionState(TableFilterUrlState.read(SLOS_TABLE_ID, "facets")),
    SLO_LIST_FACETS,
  );
}

/*
 * What the list asks for with those chips: its base query, and each chip's
 * column, from the same per-chip builder useResourceOwners' merge runs.
 */
function listQuery(state: FacetSelectionState): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...(getSloListBaseQuery() as Record<string, unknown>),
  };

  for (const facet of SLO_LIST_FACETS) {
    const field: string = facet.queryField || facet.key;
    const columnQuery: FacetColumnQuery | null = buildFacetColumnQuery({
      facet: facet,
      operator: state.facetOperators[facet.key] || "is",
      values: state.facetSelections[facet.key] || [],
      existingValue: merged[field],
    });

    if (columnQuery) {
      merged[columnQuery.field] = columnQuery.value;
    }
  }

  return merged;
}

interface SloRow {
  isArchived: boolean;
  isEnabled: boolean;
  sloStatus: SloStatus | null;
}

function everyRow(): Array<SloRow> {
  const rows: Array<SloRow> = [];

  for (const isArchived of [false, true]) {
    for (const isEnabled of [true, false]) {
      for (const sloStatus of [...Object.values(SloStatus), null]) {
        rows.push({ isArchived, isEnabled, sloStatus });
      }
    }
  }

  return rows;
}

// Whether a row is one the query asks for: equality, or one of Includes' values.
function asksFor(query: Record<string, unknown>, row: SloRow): boolean {
  return Object.keys(query).every((key: string): boolean => {
    const wanted: unknown = query[key];
    const actual: unknown = (row as unknown as Record<string, unknown>)[key];

    if (wanted instanceof Includes) {
      return (wanted.values as Array<unknown>).includes(actual);
    }

    return actual === wanted;
  });
}

function atRiskRoute(): string {
  return routeModule.getSlosAtRiskListRoute().toString();
}

beforeEach(() => {
  standAt(HOME_PATH);
});

describe("the statuses Home counts as at risk", () => {
  test("are At Risk and Budget Exhausted, never a setup problem", () => {
    expect(SLO_STATUSES_AT_RISK).toEqual([
      SloStatus.AtRisk,
      SloStatus.BudgetExhausted,
    ]);
    expect(SLO_STATUSES_AT_RISK).not.toContain(SloStatus.Misconfigured);
    expect(SLO_STATUSES_AT_RISK).not.toContain(SloStatus.Paused);
  });

  test("set the Status chip on both and the Enabled chip on turned-on SLOs", () => {
    expect(getSlosAtRiskSelections()).toEqual([
      {
        facetKey: SLO_ENABLED_FACET_KEY,
        values: [SloEnabledFacetValue.Enabled],
        operator: "is",
      },
      {
        facetKey: SLO_STATUS_FACET_KEY,
        values: [SloStatus.AtRisk, SloStatus.BudgetExhausted],
        operator: "is",
      },
    ]);
  });

  test("are built fresh on every call, so no caller can change another's", () => {
    const first: Array<FacetTileSelection> = getSlosAtRiskSelections();
    first[1]!.values.push(SloStatus.Paused);

    expect(getSlosAtRiskSelections()[1]!.values).toEqual([
      SloStatus.AtRisk,
      SloStatus.BudgetExhausted,
    ]);
    expect(SLO_STATUSES_AT_RISK).toEqual([
      SloStatus.AtRisk,
      SloStatus.BudgetExhausted,
    ]);
  });
});

describe("the link to the SLOs at risk", () => {
  test("is the SLOs list of the current project", () => {
    expect(atRiskRoute().split("?")[0]).toBe(SLOS_PATH);
    expect(atRiskRoute()).not.toContain(":projectId");
  });

  test("carries the parameter the list's own chips are kept in", () => {
    expect(TableFilterUrlState.getParamName(SLOS_TABLE_ID, "facets")).toBe(
      FACET_PARAM_NAME,
    );
    expect(atRiskRoute()).toContain(`?${FACET_PARAM_NAME}=`);
  });

  /*
   * Route.addQueryParams writes values verbatim while the reader decodes them
   * through URLSearchParams, so the JSON has to be percent-encoded or it
   * opens a list with no chips set.
   */
  test("percent-encodes the chips", () => {
    expect(atRiskRoute()).not.toContain("{");
    expect(atRiskRoute()).not.toContain('"');
    expect(atRiskRoute()).toContain("%7B");
  });

  test("is a Route, so callers can keep composing it", () => {
    expect(routeModule.getSlosAtRiskListRoute()).toBeInstanceOf(Route);
  });

  test("is the same address Home's number and View all link to", () => {
    expect(
      homeRouteModule
        .getHomeListRoute(PageMap.SLOS, routeModule.getSlosAtRiskQueryParams())
        .toString(),
    ).toBe(atRiskRoute());
  });

  test("a selection with no chip in it gives the whole list", () => {
    expect(routeModule.getSloListQueryParams([])).toEqual({});
    expect(
      routeModule.getSloListQueryParams([
        { facetKey: null, values: [], operator: "is" },
      ]),
    ).toEqual({});
    expect(homeRouteModule.getHomeListRoute(PageMap.SLOS, {}).toString()).toBe(
      SLOS_PATH,
    );
    expect(homeRouteModule.getHomeListRoute(PageMap.SLOS).toString()).toBe(
      SLOS_PATH,
    );
  });
});

describe("following it from Home", () => {
  test("lands on the SLOs list with the Status and Enabled chips set", () => {
    follow(routeModule.getSlosAtRiskListRoute());

    const chips: FacetSelectionState = chipsOnTheList();

    expect(browser.location.pathname).toBe(SLOS_PATH);
    expect(chips.facetSelections[SLO_STATUS_FACET_KEY]).toEqual([
      SloStatus.AtRisk,
      SloStatus.BudgetExhausted,
    ]);
    expect(chips.facetSelections[SLO_ENABLED_FACET_KEY]).toEqual([
      SloEnabledFacetValue.Enabled,
    ]);
    expect(chips.facetOperators[SLO_STATUS_FACET_KEY]).toBe("is");
    expect(chips.facetOperators[SLO_ENABLED_FACET_KEY]).toBe("is");
    expect(isFacetSelectionActive(chips, SLO_LIST_FACETS)).toBe(true);
  });

  // The address is in bookmarks and the E2E suite: its exact shape is pinned.
  test("the address decodes back to exactly the chips that were written", () => {
    follow(routeModule.getSlosAtRiskListRoute());

    expect(
      JSON.parse(Navigation.getQueryStringByName(FACET_PARAM_NAME) as string),
    ).toEqual({
      facetSelections: {
        sloEnabled: ["true"],
        sloStatus: ["At Risk", "Budget Exhausted"],
      },
      facetOperators: { sloEnabled: "is", sloStatus: "is" },
    });
  });

  test("the list then asks for the SLOs Home counted, and no others", () => {
    follow(routeModule.getSlosAtRiskListRoute());

    const query: Record<string, unknown> = listQuery(chipsOnTheList());

    // Home's own query: turned on, not archived, at risk or out of budget.
    expect(query["isArchived"]).toBe(false);
    expect(query["isEnabled"]).toBe(true);
    expect(query["sloStatus"]).toBeInstanceOf(Includes);
    expect((query["sloStatus"] as Includes).values).toEqual([
      ...SLO_STATUSES_AT_RISK,
    ]);

    for (const row of everyRow()) {
      expect({ row, listed: asksFor(query, row) }).toEqual({
        row,
        listed:
          !row.isArchived &&
          row.isEnabled &&
          SLO_STATUSES_AT_RISK.includes(row.sloStatus as SloStatus),
      });
    }
  });

  test("a bare SLOs address restores no chips", () => {
    standAt(SLOS_PATH);

    expect(TableFilterUrlState.read(SLOS_TABLE_ID, "facets")).toBeNull();
    expect(isFacetSelectionActive(chipsOnTheList(), SLO_LIST_FACETS)).toBe(
      false,
    );
  });
});
