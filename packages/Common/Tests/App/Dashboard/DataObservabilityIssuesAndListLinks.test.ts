import { beforeEach, describe, expect, test } from "@jest/globals";
import Route from "../../../Types/API/Route";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import {
  DATA_ATTENTION_KIND_ORDER,
  DataAttentionKind,
  DataCheckHealth,
} from "../../../Types/DataObservability/DataObservabilityAttention";
import {
  DATA_OBSERVABILITY_NO_OWNER_FILTER,
  DataObservabilityIssueAlertFilter,
  DataObservabilityIssuesResponse,
  DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import {
  CHECKS_LIST_ID,
  FRESHNESS_FACET_KEY,
  STORE_TABLES_LIST_ID,
  TABLES_LIST_ID,
  TableFreshnessFilter,
  getChecksOfHealthRoute,
  getFreshnessNow,
  getFreshnessQueryValue,
  getLateTablesRoute,
  getTableFreshnessFacet,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityListRoutes";
import {
  ANY_ALERT_FILTER,
  DATA_OBSERVABILITY_ISSUES_LIST_ID,
  ISSUE_ALERT_CHOICES,
  ISSUE_KIND_CHOICES,
  ISSUE_KIND_LABELS,
  IssuesFilter,
  getIssuesRoute,
  hasIssuesFilter,
  normalizeDataObservabilityIssues,
  readIssuesFilter,
  toIssuesFilterState,
  toIssuesRequest,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/IssuesCopy";
import { ResourceFacet } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

/*
 * THE LISTS A COUNT OPENS, AND THE ISSUES PAGE'S FILTERS (#6549, #6550,
 * #6554).
 *
 * The Overview's Late Tables open Tables with Freshness: Late set, a
 * database's open its own Tables tab the same way, and Failing Checks open
 * Checks filtered to failing - each in the list's own URL namespace, so the
 * chip or filter is visibly set and can be cleared. The Issues page carries
 * its filters in the address the same way, keeps only filters it could have
 * set itself, and asks the server for one page of what they keep.
 */

const STORE: string = "77777777-7777-4777-8777-000000000001";
const USER: string = "77777777-7777-4777-8777-000000000002";

// The state a link puts in a list's namespace, as the list reads it back.
function stateOf(
  route: Route,
  tableId: string,
  kind: "filter" | "facets",
): JSONObject | null {
  const query: string = route.toString().split("?")[1] || "";
  const raw: string | null = new URLSearchParams(query).get(
    `${tableId}-${kind}`,
  );

  return raw ? (JSON.parse(raw) as JSONObject) : null;
}

function pathOf(route: Route): string {
  return route.toString().split("?")[0]!;
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/data-observability`);
});

describe("Late Tables opens Tables with Freshness: Late set", () => {
  test("of the project: the Tables page, its Freshness chip on Late", () => {
    const route: Route = getLateTablesRoute();

    expect(pathOf(route)).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_OBSERVABILITY_TABLES] as Route,
      ).toString(),
    );
    expect(stateOf(route, TABLES_LIST_ID, "facets")).toEqual({
      facetSelections: { [FRESHNESS_FACET_KEY]: [TableFreshnessFilter.Late] },
      facetOperators: { [FRESHNESS_FACET_KEY]: "is" },
    });
    // Nothing else is set: the person sees exactly the late tables.
    expect(stateOf(route, TABLES_LIST_ID, "filter")).toBeNull();
  });

  test("of a database: its own Tables tab, in that list's namespace", () => {
    const route: Route = getLateTablesRoute(STORE);

    expect(pathOf(route)).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_OBSERVABILITY_STORE_VIEW_TABLES] as Route,
        { modelId: new ObjectID(STORE) },
      ).toString(),
    );
    expect(pathOf(route)).toContain(STORE);
    expect(stateOf(route, STORE_TABLES_LIST_ID, "facets")).toEqual({
      facetSelections: { [FRESHNESS_FACET_KEY]: [TableFreshnessFilter.Late] },
      facetOperators: { [FRESHNESS_FACET_KEY]: "is" },
    });
    expect(stateOf(route, TABLES_LIST_ID, "facets")).toBeNull();
  });

  test("the address is the one the list's own state writes: Back and a reload keep the chip", () => {
    const params: Record<string, string> =
      TableFilterUrlState.getLinkQueryParams(TABLES_LIST_ID, {
        facets: {
          facetSelections: {
            [FRESHNESS_FACET_KEY]: [TableFreshnessFilter.Late],
          },
          facetOperators: { [FRESHNESS_FACET_KEY]: "is" },
        },
      });

    expect(getLateTablesRoute().toString()).toContain(
      `${TABLES_LIST_ID}-facets=${params[`${TABLES_LIST_ID}-facets`]}`,
    );
  });
});

describe("the Freshness chip", () => {
  const NOW: Date = new Date("2026-11-03T12:00:00.000Z");

  test("Late asks for the tables whose lateAt has passed; Fresh, the ones still to come", () => {
    const late: unknown = getFreshnessQueryValue(
      [TableFreshnessFilter.Late],
      "is",
      NOW,
    );
    const fresh: unknown = getFreshnessQueryValue(
      [TableFreshnessFilter.Fresh],
      "is",
      NOW,
    );

    expect(late).toBeInstanceOf(LessThanOrEqual);
    expect((late as LessThanOrEqual<Date>).value).toEqual(NOW);
    expect(fresh).toBeInstanceOf(GreaterThan);
    expect((fresh as GreaterThan<Date>).value).toEqual(NOW);
  });

  test("both, neither, another operator or a hand-edited value ask nothing", () => {
    expect(
      getFreshnessQueryValue(
        [TableFreshnessFilter.Late, TableFreshnessFilter.Fresh],
        "is",
        NOW,
      ),
    ).toBeUndefined();
    expect(getFreshnessQueryValue([], "is", NOW)).toBeUndefined();
    expect(
      getFreshnessQueryValue([TableFreshnessFilter.Late], "is_not", NOW),
    ).toBeUndefined();
    expect(getFreshnessQueryValue(["overdue"], "is", NOW)).toBeUndefined();
  });

  test("is asked of lateAt, offers Late and Fresh, and only says is", () => {
    const facet: ResourceFacet = getTableFreshnessFacet(() => {
      return NOW;
    });

    expect(facet.key).toBe(FRESHNESS_FACET_KEY);
    expect(facet.label).toBe("Freshness");
    expect(facet.queryField).toBe("lateAt");
    expect(facet.options).toEqual([
      { value: TableFreshnessFilter.Late, label: "Late" },
      { value: TableFreshnessFilter.Fresh, label: "Fresh" },
    ]);
    expect(facet.supportedOperators).toEqual(["is"]);
    expect(
      (
        facet.toQueryValue!(
          [TableFreshnessFilter.Late],
          "is",
        ) as LessThanOrEqual<Date>
      ).value,
    ).toEqual(NOW);
  });

  test("now is taken to the minute, so a list redrawn in the same minute asks the same", () => {
    expect(getFreshnessNow(new Date("2026-11-03T12:34:56.789Z"))).toEqual(
      new Date("2026-11-03T12:34:00.000Z"),
    );
    expect(
      getFreshnessNow(new Date("2026-11-03T12:34:00.000Z")).getTime(),
    ).toBe(getFreshnessNow(new Date("2026-11-03T12:34:59.999Z")).getTime());
  });
});

describe("Failing Checks opens Checks filtered to failing", () => {
  test("the Checks page, its Status filter on Failing", () => {
    const route: Route = getChecksOfHealthRoute();

    expect(pathOf(route)).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_OBSERVABILITY_CHECKS] as Route,
      ).toString(),
    );
    expect(stateOf(route, CHECKS_LIST_ID, "filter")).toEqual({
      health: DataCheckHealth.Failing,
    });
  });

  test("any other health, the same way", () => {
    expect(
      stateOf(
        getChecksOfHealthRoute(DataCheckHealth.CouldNotRun),
        CHECKS_LIST_ID,
        "filter",
      ),
    ).toEqual({ health: DataCheckHealth.CouldNotRun });
  });
});

describe("the Issues page's filters", () => {
  test("its kinds are the Overview's, worst first, each by a name", () => {
    expect(
      ISSUE_KIND_CHOICES.map((choice: { value: string }): string => {
        return choice.value;
      }),
    ).toEqual([...DATA_ATTENTION_KIND_ORDER]);

    for (const kind of Object.values(DataAttentionKind)) {
      expect(ISSUE_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  test("whether anyone was told: all, an alert open, or none", () => {
    expect(ISSUE_ALERT_CHOICES).toEqual([
      // All, as a filter left open says: the bare Any is a Match Condition's.
      { value: ANY_ALERT_FILTER, label: "All" },
      { value: DataObservabilityIssueAlertFilter.Open, label: "Alert open" },
      {
        value: DataObservabilityIssueAlertFilter.None,
        label: "No alert open",
      },
    ]);
  });

  test("read from the address, only what the page could have set is kept", () => {
    expect(
      readIssuesFilter({
        kind: DataAttentionKind.TableLate,
        dataStoreId: STORE,
        owner: `user:${USER}`,
        alert: DataObservabilityIssueAlertFilter.None,
      }),
    ).toEqual({
      kind: DataAttentionKind.TableLate,
      dataStoreId: STORE,
      owner: `user:${USER}`,
      alert: DataObservabilityIssueAlertFilter.None,
    });
    expect(
      readIssuesFilter({ owner: DATA_OBSERVABILITY_NO_OWNER_FILTER }),
    ).toEqual({ owner: DATA_OBSERVABILITY_NO_OWNER_FILTER });
    expect(
      readIssuesFilter({
        kind: "Everything",
        dataStoreId: "orders-db",
        owner: `robot:${USER}`,
        alert: "maybe",
      }),
    ).toEqual({});
    expect(readIssuesFilter({ owner: "user:not-an-id" })).toEqual({});
    expect(readIssuesFilter(null)).toEqual({});
    expect(readIssuesFilter([DataAttentionKind.TableLate])).toEqual({});
  });

  test("a filter is set when any of its four is", () => {
    expect(hasIssuesFilter({})).toBe(false);
    expect(hasIssuesFilter({ kind: DataAttentionKind.CheckFailing })).toBe(
      true,
    );
    expect(hasIssuesFilter({ owner: DATA_OBSERVABILITY_NO_OWNER_FILTER })).toBe(
      true,
    );
    expect(
      hasIssuesFilter({ alert: DataObservabilityIssueAlertFilter.Open }),
    ).toBe(true);
  });

  test("the address carries only what is set, and nothing when nothing is", () => {
    expect(toIssuesFilterState({})).toBeNull();
    expect(
      toIssuesFilterState({
        kind: DataAttentionKind.PipelineFailed,
        alert: DataObservabilityIssueAlertFilter.Open,
      }),
    ).toEqual({
      kind: DataAttentionKind.PipelineFailed,
      alert: DataObservabilityIssueAlertFilter.Open,
    });
  });

  test("a filter written to the address reads back the same", () => {
    const filter: IssuesFilter = {
      kind: DataAttentionKind.CheckCouldNotRun,
      dataStoreId: STORE,
      owner: DATA_OBSERVABILITY_NO_OWNER_FILTER,
      alert: DataObservabilityIssueAlertFilter.None,
    };

    expect(readIssuesFilter(toIssuesFilterState(filter))).toEqual(filter);
  });
});

describe("what the Issues page asks the server for", () => {
  test("a page of what its filters keep, one kind as a list of one", () => {
    expect(
      toIssuesRequest({
        filter: {
          kind: DataAttentionKind.TableLate,
          dataStoreId: STORE,
          owner: `team:${USER}`,
          alert: DataObservabilityIssueAlertFilter.Open,
        },
        page: 3,
        itemsOnPage: 10,
      }),
    ).toEqual({
      kinds: [DataAttentionKind.TableLate],
      dataStoreId: STORE,
      owner: `team:${USER}`,
      alert: DataObservabilityIssueAlertFilter.Open,
      skip: 20,
      limit: 10,
    });
  });

  test("no filter: every issue, from the first page", () => {
    expect(toIssuesRequest({ filter: {}, page: 1, itemsOnPage: 25 })).toEqual({
      skip: 0,
      limit: 25,
    });
  });

  test("a page or a size that makes no sense is the first page, of the usual size", () => {
    expect(toIssuesRequest({ filter: {}, page: 0, itemsOnPage: 0 })).toEqual({
      skip: 0,
      limit: DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE,
    });
  });
});

describe("the way to the Issues page", () => {
  test("unfiltered, the page itself", () => {
    expect(getIssuesRoute().toString()).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_OBSERVABILITY_ISSUES] as Route,
      ).toString(),
    );
  });

  test("filtered, in the page's own namespace", () => {
    const route: Route = getIssuesRoute({
      owner: DATA_OBSERVABILITY_NO_OWNER_FILTER,
    });

    expect(stateOf(route, DATA_OBSERVABILITY_ISSUES_LIST_ID, "filter")).toEqual(
      { owner: DATA_OBSERVABILITY_NO_OWNER_FILTER },
    );
  });
});

describe("the answer as the page reads it", () => {
  test("whatever came back, never a reason to fail", () => {
    expect(normalizeDataObservabilityIssues(null)).toEqual({
      items: [],
      count: 0,
      totalCount: 0,
      skip: 0,
      limit: DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE,
      stores: [],
      owners: [],
    });
    expect(
      normalizeDataObservabilityIssues({
        items: "not a list",
        count: "many",
        skip: Number.NaN,
      } as unknown as JSONObject).items,
    ).toEqual([]);
  });

  test("a full answer is kept as it is", () => {
    const answer: DataObservabilityIssuesResponse = {
      items: [],
      count: 30,
      totalCount: 41,
      skip: 25,
      limit: 25,
      stores: [],
      owners: [{ key: `user:${USER}`, kind: "user", id: USER, name: "Ada" }],
    };

    expect(normalizeDataObservabilityIssues(answer)).toEqual(answer);
  });
});
