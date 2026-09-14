import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The cross-page hand-off behind issue #3491's third ask: the template page's
 * Linked Monitors card counts monitors, and monitors are worked with on the
 * monitor list — bulk actions, saved views, every other chip. "Open in Monitors
 * List" has to land the user there with the Template chip already set,
 * otherwise the click drops them into the whole project's monitors and they
 * have to find the rows themselves, which is the exact problem the link exists
 * to solve.
 *
 * The link carries the chip in the table's own facet URL namespace, i.e. the
 * very parameter the facet bar writes when a user sets a chip by hand. So there
 * are three independent pieces that have to agree — the serializer, the percent
 * encoding Route needs, and the reader the bar uses on mount — and none of them
 * is visible from the source of any one file.
 *
 * These therefore drive the real Navigation, RouteMap, ProjectUtil and
 * TableFilterUrlState against a stubbed browser rather than reading source:
 * they fail if the link stops being a live, chip-setting navigation however it
 * is spelled.
 */

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const TEMPLATE_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const OTHER_TEMPLATE_ID: string = "0193c0de-2222-4aaa-8bbb-000000000002";
const TEMPLATE_PATH: string = `/dashboard/${PROJECT_ID}/monitors/settings/templates/${TEMPLATE_ID}`;
const MONITORS_PATH: string = `/dashboard/${PROJECT_ID}/monitors`;

/*
 * Spelled out once. Everything below builds the name it expects from
 * TableFilterUrlState.getParamName so the link and the reader cannot drift
 * apart, but the name is also sitting in bookmarks and in links pasted into
 * tickets — so a rename has to be a conscious edit of this line too.
 */
const FACET_PARAM_NAME: string = "all-monitors-table-facets";

const browser: {
  location: { pathname: string; search: string; hash: string };
  history: { state: unknown; replaceState: () => void };
} = {
  location: { pathname: TEMPLATE_PATH, search: "", hash: "" },
  history: {
    state: null,
    replaceState: (): void => {
      // no-op; these tests never assert on replaceState.
    },
  },
};

type RouteModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Monitor/MonitorListFacetRoute");
type FacetsModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Monitor/MonitorFacets");
type FacetStateModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetSelectionState");
type FacetSelectionState =
  import("../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetSelectionState").FacetSelectionState;
type FacetTileSelection =
  import("../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetTileSelection").FacetTileSelection;
type NavigationClass = (typeof import("Common/UI/Utils/Navigation"))["default"];
type RouteClass = (typeof import("Common/Types/API/Route"))["default"];
type TableFilterUrlStateClass =
  (typeof import("Common/UI/Utils/TableFilterUrlState"))["default"];

let routeModule: RouteModule;
let facetsModule: FacetsModule;
let facetStateModule: FacetStateModule;
let Navigation: NavigationClass;
let Route: RouteClass;
let TableFilterUrlState: TableFilterUrlStateClass;
let navigatedTo: Array<string> = [];

/*
 * Common/UI/Config reads `window` the moment it loads, and RouteMap pulls it
 * in transitively, so the browser stub has to exist before any of them do —
 * hence the deferred imports. A static import would be hoisted above the stub
 * and throw. Same approach as DeviceListFacetRoute.test.ts.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = browser;
  /*
   * Node 26 ships real sessionStorage/localStorage globals and plain
   * assignment over them throws inside jest's vm context; defining the
   * property works on every version. ProjectUtil falls through to these when
   * the URL carries no project id.
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
    "../../FeatureSet/Dashboard/src/Components/Monitor/MonitorListFacetRoute"
  );
  facetsModule = await import(
    "../../FeatureSet/Dashboard/src/Components/Monitor/MonitorFacets"
  );
  facetStateModule = await import(
    "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetSelectionState"
  );
  Navigation = (await import("Common/UI/Utils/Navigation")).default;
  Route = (await import("Common/Types/API/Route")).default;
  TableFilterUrlState = (await import("Common/UI/Utils/TableFilterUrlState"))
    .default;
});

function standAt(pathname: string, search: string = ""): void {
  browser.location.pathname = pathname;
  browser.location.search = search;
  /*
   * react-router's types are not resolvable from the App suite, so the
   * router's Location and NavigateFunction are supplied structurally —
   * pathname and the call signature are all Navigation reads off them.
   */
  Navigation.setLocation({ pathname: pathname } as unknown as Parameters<
    typeof Navigation.setLocation
  >[0]);
  navigatedTo = [];
  Navigation.setNavigateHook(((to: string): void => {
    navigatedTo.push(to);
  }) as unknown as Parameters<typeof Navigation.setNavigateHook>[0]);
}

/** Follow a route the way a click does, and end up standing where it went. */
function follow(route: InstanceType<RouteClass>): void {
  Navigation.navigate(route);

  expect(navigatedTo).toHaveLength(1);

  const [pathname, search] = navigatedTo[0]!.split("?") as [
    string,
    string | undefined,
  ];

  standAt(pathname, search ? `?${search}` : "");
}

/** The facet state the monitor list would restore from the current URL. */
function readFacetState(): FacetSelectionState {
  return facetStateModule.parseFacetSelectionState(
    TableFilterUrlState.read(facetsModule.ALL_MONITORS_TABLE_ID, "facets"),
  );
}

function templateSelection(templateId: string): FacetTileSelection {
  return facetsModule.getMonitorTemplateFacetSelection(templateId);
}

function routeFor(selection: FacetTileSelection): string {
  return routeModule.getMonitorListRouteForFacet(selection).toString();
}

beforeEach(() => {
  standAt(TEMPLATE_PATH);
});

describe("getMonitorListRouteForFacet", () => {
  test("points at the monitor list for the current project", () => {
    expect(routeFor(templateSelection(TEMPLATE_ID)).split("?")[0]).toBe(
      MONITORS_PATH,
    );
  });

  /*
   * The project id has to be substituted, not left as the `:projectId`
   * placeholder — a link to a literal ":projectId" path 404s in the router.
   */
  test("substitutes the project id rather than leaving the placeholder", () => {
    expect(routeFor(templateSelection(TEMPLATE_ID))).not.toContain(
      ":projectId",
    );
  });

  /*
   * The monitor list, not the disabled / not-operational / probe sub-lists,
   * each of which is a different route under the same prefix and would arrive
   * carrying a chip it does not show.
   */
  test("lands on the monitor list itself, not one of its sub-lists", () => {
    const path: string = routeFor(templateSelection(TEMPLATE_ID)).split(
      "?",
    )[0]!;

    expect(path).toBe(MONITORS_PATH);
    expect(path.endsWith("/monitors")).toBe(true);
  });

  /*
   * The chip travels in the table's own facet namespace rather than a private
   * parameter of this link's own. That is what makes the arriving list show a
   * real, editable chip: there is nothing to keep in sync between "arrived by
   * link" and "clicked the chip".
   */
  test("carries the param the facet bar itself reads", () => {
    const paramName: string = TableFilterUrlState.getParamName(
      facetsModule.ALL_MONITORS_TABLE_ID,
      "facets",
    );

    expect(routeFor(templateSelection(TEMPLATE_ID))).toContain(`${paramName}=`);
  });

  test("and that param is the name already sitting in shared links", () => {
    expect(
      TableFilterUrlState.getParamName(
        facetsModule.ALL_MONITORS_TABLE_ID,
        "facets",
      ),
    ).toBe(FACET_PARAM_NAME);
    expect(facetsModule.ALL_MONITORS_TABLE_ID).toBe("all-monitors-table");
  });

  /*
   * `Route.addQueryParams` concatenates values into the route verbatim, while
   * the reader pulls them back out through `URLSearchParams`, which decodes.
   * The facet snapshot is JSON, so a raw blob would either be rejected outright
   * by Route's character whitelist or arrive as something URLSearchParams
   * cannot parse — a link that silently opens an unfiltered list.
   */
  test("percent-encodes the serialized snapshot", () => {
    const route: string = routeFor(templateSelection(TEMPLATE_ID));

    expect(route).not.toContain("{");
    expect(route).not.toContain('"');
    expect(route).toContain("%7B");
    expect(route).toContain("%22");
  });

  /*
   * A selection with no chip to move has nothing to hand over, so the link is
   * the plain monitor list. An empty param instead would be read back as a
   * snapshot, and a snapshot is what the bar restores over its defaults.
   */
  test("a selection with no facet yields a bare route", () => {
    const route: string = routeFor({
      facetKey: null,
      values: [],
      operator: "is",
    });

    expect(route).toBe(MONITORS_PATH);
    expect(route).not.toContain("?");
    expect(route).not.toContain(FACET_PARAM_NAME);
  });

  test("different templates produce different links", () => {
    const routes: Array<string> = [
      routeFor(templateSelection(TEMPLATE_ID)),
      routeFor(templateSelection(OTHER_TEMPLATE_ID)),
      routeFor({ facetKey: null, values: [], operator: "is" }),
    ];

    expect(new Set(routes).size).toBe(routes.length);
  });

  test("returns a Route, so callers can keep composing it", () => {
    expect(
      routeModule.getMonitorListRouteForFacet(templateSelection(TEMPLATE_ID)),
    ).toBeInstanceOf(Route);
  });
});

describe("the Linked Monitors card's hand-off", () => {
  /*
   * The whole feature in one test: the template page builds the link from the
   * shared selection, the user follows it, and the monitor list's facet bar
   * restores the Template chip on the template that was open — which is what
   * produces the rows the Linked Monitors count described. A break anywhere
   * along that chain shows up here, and shows up in the product as the whole
   * project's monitors.
   */
  test("round-trips from the template page to the Template chip", () => {
    follow(
      routeModule.getMonitorListRouteForFacet(templateSelection(TEMPLATE_ID)),
    );

    expect(browser.location.pathname).toBe(MONITORS_PATH);
    expect(
      TableFilterUrlState.read(facetsModule.ALL_MONITORS_TABLE_ID, "facets"),
    ).not.toBeNull();

    const state: FacetSelectionState = readFacetState();

    expect(
      state.facetSelections[facetsModule.MONITOR_TEMPLATE_FACET_KEY],
    ).toEqual([TEMPLATE_ID]);
    expect(state.facetOperators[facetsModule.MONITOR_TEMPLATE_FACET_KEY]).toBe(
      "is",
    );
    expect(facetStateModule.isFacetSelectionActive(state)).toBe(true);
  });

  /*
   * The decoding half of the encoding test above: `getQueryStringByName` goes
   * through URLSearchParams, so this is the reader confirming it gets the JSON
   * the link encoded rather than a truncated fragment of it.
   */
  test("the landed URL decodes back to the snapshot that was written", () => {
    follow(
      routeModule.getMonitorListRouteForFacet(templateSelection(TEMPLATE_ID)),
    );

    const raw: string | null =
      Navigation.getQueryStringByName(FACET_PARAM_NAME);

    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      facetSelections: {
        [facetsModule.MONITOR_TEMPLATE_FACET_KEY]: [TEMPLATE_ID],
      },
      facetOperators: {
        [facetsModule.MONITOR_TEMPLATE_FACET_KEY]: "is",
      },
    });
  });

  /*
   * Navigation.navigate() drops any navigation whose target it judges to be
   * the current page, and it judges that on the pathname alone. The query
   * string is what keeps this a live navigation even from the monitor list
   * itself — otherwise a link followed while already on the list would do
   * nothing at all.
   */
  test("is still a live navigation from the monitor list itself", () => {
    standAt(MONITORS_PATH);

    Navigation.navigate(
      routeModule.getMonitorListRouteForFacet(templateSelection(TEMPLATE_ID)),
    );

    expect(navigatedTo).toHaveLength(1);
    expect(navigatedTo[0]!.startsWith(`${MONITORS_PATH}?`)).toBe(true);
    expect(navigatedTo[0]!).toContain(`${FACET_PARAM_NAME}=`);
  });

  /*
   * Following one template's link and then another's has to end on the second
   * template, not on both — the snapshot replaces the chip rather than adding
   * to it.
   */
  test("a second hand-off replaces the first template", () => {
    follow(
      routeModule.getMonitorListRouteForFacet(templateSelection(TEMPLATE_ID)),
    );
    follow(
      routeModule.getMonitorListRouteForFacet(
        templateSelection(OTHER_TEMPLATE_ID),
      ),
    );

    expect(
      readFacetState().facetSelections[facetsModule.MONITOR_TEMPLATE_FACET_KEY],
    ).toEqual([OTHER_TEMPLATE_ID]);
  });

  /*
   * The three URL namespaces — `-filter` (the column popup), `-facets` (the
   * chips) and `-view` (search, sort, page) — share one query string, and a
   * link can be followed from a page that already has the other two set.
   * Reading one must not depend on the others being absent.
   */
  test("the facet param survives alongside the table's other URL params", () => {
    const tableId: string = facetsModule.ALL_MONITORS_TABLE_ID;
    const facetParam: string = routeFor(templateSelection(TEMPLATE_ID)).split(
      "?",
    )[1]!;

    standAt(
      MONITORS_PATH,
      `?${TableFilterUrlState.getParamName(tableId, "filter")}=` +
        `%7B%22name%22%3A%22core%22%7D&${facetParam}&` +
        `${TableFilterUrlState.getParamName(tableId, "view")}=%7B%22page%22%3A2%7D`,
    );

    expect(
      readFacetState().facetSelections[facetsModule.MONITOR_TEMPLATE_FACET_KEY],
    ).toEqual([TEMPLATE_ID]);
    expect(TableFilterUrlState.read(tableId, "filter")).toEqual({
      name: "core",
    });
    expect(TableFilterUrlState.read(tableId, "view")).toEqual({ page: 2 });
  });
});

describe("reading the facet state back off a URL", () => {
  test("a bare monitor list URL restores no chips", () => {
    standAt(MONITORS_PATH);

    expect(
      TableFilterUrlState.read(facetsModule.ALL_MONITORS_TABLE_ID, "facets"),
    ).toBeNull();
    expect(facetStateModule.isFacetSelectionActive(readFacetState())).toBe(
      false,
    );
  });

  /*
   * The parameter is in the address bar, so its value is whatever anyone
   * chooses to type — or whatever survives a mail client wrapping the link. A
   * hand-edited or truncated snapshot has to open the plain list rather than
   * throw on a page the user asked for.
   */
  describe("junk snapshots open the unfiltered list", () => {
    test.each([
      ["not JSON at all", "whatever"],
      ["a truncated snapshot", "%7B%22facetSelections%22%3A%7B"],
      ["an array rather than an object", "%5B%5D"],
      ["an empty object", "%7B%7D"],
      ["a prototype-pollution attempt", "%7B%22__proto__%22%3A%7B%7D%7D"],
    ])("%s", (_label: string, raw: string) => {
      standAt(MONITORS_PATH, `?${FACET_PARAM_NAME}=${raw}`);

      const state: FacetSelectionState = readFacetState();

      expect(facetStateModule.isFacetSelectionActive(state)).toBe(false);
      expect(state.facetSelections).toEqual({});
      expect(state.facetOperators).toEqual({});
    });
  });

  /*
   * A link built before the template id was known is inert, not broken: it
   * still carries the namespace, and reading it back constrains nothing. The
   * arriving list is every monitor, which is what the link describes.
   */
  test("a link for a template-less selection constrains nothing", () => {
    follow(routeModule.getMonitorListRouteForFacet(templateSelection("")));

    const state: FacetSelectionState = readFacetState();

    expect(
      state.facetSelections[facetsModule.MONITOR_TEMPLATE_FACET_KEY],
    ).toEqual([]);
    expect(facetStateModule.isFacetSelectionActive(state)).toBe(false);
  });
});
