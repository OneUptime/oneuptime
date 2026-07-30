import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The cross-page hand-off: the Sites page's "Unassigned Devices" tile counts
 * devices, and devices are only listed on the Devices page. Activating it has
 * to land the user on that page with the equivalent chip already set — otherwise
 * the click drops them into an unfiltered list of the whole fleet and they have
 * to find the rows themselves, which is the exact problem the tile was supposed
 * to solve.
 *
 * The link carries the chip in the table's own facet URL namespace, i.e. the very
 * parameter the facet bar writes when a user sets a chip by hand. So there are
 * three independent pieces that have to agree — the serializer, the percent
 * encoding Route needs, and the reader the bar uses on mount — and none of them
 * is visible from the source of any one file.
 *
 * These therefore drive the real Navigation, RouteMap, ProjectUtil and
 * TableFilterUrlState against a stubbed browser rather than reading source: they
 * fail if the link stops being a live, chip-setting navigation however it is
 * spelled.
 */

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const SITES_PATH: string = `/dashboard/${PROJECT_ID}/network-sites`;
const DEVICES_PATH: string = `/dashboard/${PROJECT_ID}/network-devices`;

/*
 * Spelled out once. Everything below builds the name it expects from
 * TableFilterUrlState.getParamName so the link and the reader cannot drift apart,
 * but the name is also sitting in bookmarks and in links pasted into tickets — so
 * a rename has to be a conscious edit of this line too.
 */
const FACET_PARAM_NAME: string = "network-devices-table-facets";

const browser: {
  location: { pathname: string; search: string; hash: string };
  history: { state: unknown; replaceState: () => void };
} = {
  location: { pathname: SITES_PATH, search: "", hash: "" },
  history: {
    state: null,
    replaceState: (): void => {
      // no-op; these tests never assert on replaceState.
    },
  },
};

type RouteModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceListFacetRoute");
type FacetsModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceFacets");
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
 * A chip that carries ids rather than only an operator. The facet key is
 * deliberately not one the device page defines: this pins the *transport*, which
 * has to work for any chip the bar grows later.
 */
const SELECTION_WITH_VALUES: FacetTileSelection = {
  facetKey: "deviceRegion",
  values: [
    "0193c0de-1111-4aaa-8bbb-000000000001",
    "0193c0de-2222-4aaa-8bbb-000000000002",
  ],
  operator: "is",
};

/*
 * Common/UI/Config reads `window` the moment it loads, and RouteMap pulls it
 * in transitively, so the browser stub has to exist before any of them do —
 * hence the deferred imports. A static import would be hoisted above the stub
 * and throw. Same approach as NetworkSitePageInvariants.test.ts.
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
    "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceListFacetRoute"
  );
  facetsModule = await import(
    "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceFacets"
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

/** The facet state the Devices page would restore from the current URL. */
function readFacetState(): FacetSelectionState {
  return facetStateModule.parseFacetSelectionState(
    TableFilterUrlState.read(facetsModule.NETWORK_DEVICES_TABLE_ID, "facets"),
  );
}

function routeFor(selection: FacetTileSelection): string {
  return routeModule.getDeviceListRouteForFacet(selection).toString();
}

beforeEach(() => {
  standAt(SITES_PATH);
});

describe("getDeviceListRouteForFacet", () => {
  test("points at the device list for the current project", () => {
    expect(
      routeFor(facetsModule.UNASSIGNED_DEVICES_FACET_SELECTION).split("?")[0],
    ).toBe(DEVICES_PATH);
  });

  /*
   * The project id has to be substituted, not left as the `:projectId`
   * placeholder — a link to a literal ":projectId" path 404s in the router.
   */
  test("substitutes the project id rather than leaving the placeholder", () => {
    expect(
      routeFor(facetsModule.UNASSIGNED_DEVICES_FACET_SELECTION),
    ).not.toContain(":projectId");
  });

  test("lands on the device list, not the network overview or topology", () => {
    const path: string = routeFor(
      facetsModule.UNASSIGNED_DEVICES_FACET_SELECTION,
    ).split("?")[0]!;

    expect(path).toBe(DEVICES_PATH);
    expect(path.endsWith("/network-devices")).toBe(true);
  });

  /*
   * The chip travels in the table's own facet namespace rather than a private
   * parameter of this link's own. That is what makes the arriving list show a
   * real, editable chip: there is nothing to keep in sync between "arrived by
   * link" and "clicked the chip".
   */
  test("carries the param the facet bar itself reads", () => {
    const paramName: string = TableFilterUrlState.getParamName(
      facetsModule.NETWORK_DEVICES_TABLE_ID,
      "facets",
    );

    expect(routeFor(facetsModule.UNASSIGNED_DEVICES_FACET_SELECTION)).toContain(
      `${paramName}=`,
    );
  });

  test("and that param is the name already sitting in shared links", () => {
    expect(
      TableFilterUrlState.getParamName(
        facetsModule.NETWORK_DEVICES_TABLE_ID,
        "facets",
      ),
    ).toBe(FACET_PARAM_NAME);
    expect(facetsModule.NETWORK_DEVICES_TABLE_ID).toBe("network-devices-table");
  });

  /*
   * `Route.addQueryParams` concatenates values into the route verbatim, while
   * the reader pulls them back out through `URLSearchParams`, which decodes. The
   * facet snapshot is JSON, so a raw blob would either be rejected outright by
   * Route's character whitelist or arrive as something URLSearchParams cannot
   * parse — a link that silently opens an unfiltered list. The round-trip tests
   * below are what prove the encoding matches the reader; this pins the symptom
   * so the cause is obvious when it regresses.
   */
  test("percent-encodes the serialized snapshot", () => {
    const route: string = routeFor(
      facetsModule.UNASSIGNED_DEVICES_FACET_SELECTION,
    );

    expect(route).not.toContain("{");
    expect(route).not.toContain('"');
    expect(route).toContain("%7B");
    expect(route).toContain("%22");
  });

  /*
   * A tile with no chip to move on the device list has nothing to hand over, so
   * the link is the plain device list. An empty param instead would be read back
   * as a snapshot, and a snapshot is what the bar restores over its defaults.
   */
  test("a selection with no facet yields a bare route", () => {
    const route: string = routeFor({
      facetKey: null,
      values: [],
      operator: "is",
    });

    expect(route).toBe(DEVICES_PATH);
    expect(route).not.toContain("?");
    expect(route).not.toContain(FACET_PARAM_NAME);
  });

  test("distinct selections produce distinct links", () => {
    const routes: Array<string> = [
      routeFor(facetsModule.UNASSIGNED_DEVICES_FACET_SELECTION),
      routeFor(SELECTION_WITH_VALUES),
      routeFor({ facetKey: null, values: [], operator: "is" }),
    ];

    expect(new Set(routes).size).toBe(routes.length);
  });

  test("returns a Route, so callers can keep composing it", () => {
    expect(
      routeModule.getDeviceListRouteForFacet(
        facetsModule.UNASSIGNED_DEVICES_FACET_SELECTION,
      ),
    ).toBeInstanceOf(Route);
  });
});

describe("the Unassigned Devices tile's hand-off", () => {
  /*
   * The whole feature in one test: the Sites page builds the link from the
   * shared selection, the user follows it, and the Devices page's facet bar
   * restores the Site chip on its "is empty" operator — which is what produces
   * the rows the count on the tile described. A break anywhere along that chain
   * shows up here, and shows up in the product as an unfiltered fleet.
   */
  test("round-trips from the Sites page to the Site chip set to is-empty", () => {
    follow(
      routeModule.getDeviceListRouteForFacet(
        facetsModule.UNASSIGNED_DEVICES_FACET_SELECTION,
      ),
    );

    expect(browser.location.pathname).toBe(DEVICES_PATH);
    expect(
      TableFilterUrlState.read(facetsModule.NETWORK_DEVICES_TABLE_ID, "facets"),
    ).not.toBeNull();

    const state: FacetSelectionState = readFacetState();

    expect(state.facetOperators[facetsModule.DEVICE_SITE_FACET_KEY]).toBe(
      "is_empty",
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
      routeModule.getDeviceListRouteForFacet(
        facetsModule.UNASSIGNED_DEVICES_FACET_SELECTION,
      ),
    );

    const raw: string | null =
      Navigation.getQueryStringByName(FACET_PARAM_NAME);

    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      facetSelections: { [facetsModule.DEVICE_SITE_FACET_KEY]: [] },
      facetOperators: { [facetsModule.DEVICE_SITE_FACET_KEY]: "is_empty" },
    });
  });

  /*
   * Navigation.navigate() drops any navigation whose target it judges to be
   * the current page, and it judges that on the pathname alone. The query
   * string is what keeps this a live navigation even from the device page
   * itself — otherwise a link followed from a bookmark bar while already on
   * the device list would do nothing at all.
   */
  test("is still a live navigation from the device page itself", () => {
    standAt(DEVICES_PATH);

    Navigation.navigate(
      routeModule.getDeviceListRouteForFacet(
        facetsModule.UNASSIGNED_DEVICES_FACET_SELECTION,
      ),
    );

    expect(navigatedTo).toHaveLength(1);
    expect(navigatedTo[0]!.startsWith(`${DEVICES_PATH}?`)).toBe(true);
    expect(navigatedTo[0]!).toContain(`${FACET_PARAM_NAME}=`);
  });

  /*
   * The Site chip travels as an operator with no values. A chip that carries
   * ids — every chip whose options are project data rather than a fixed
   * vocabulary — has to survive the same trip, and all of its ids have to, not
   * just the first.
   */
  test("a selection with values round-trips every id", () => {
    follow(routeModule.getDeviceListRouteForFacet(SELECTION_WITH_VALUES));

    const state: FacetSelectionState = readFacetState();

    expect(state.facetSelections["deviceRegion"]).toEqual(
      SELECTION_WITH_VALUES.values,
    );
    expect(state.facetOperators["deviceRegion"]).toBe("is");
  });

  /*
   * The three URL namespaces — `-filter` (the column popup), `-facets` (the
   * chips) and `-view` (search, sort, page) — share one query string, and a link
   * can be followed from a page that already has the other two set. Reading one
   * must not depend on the others being absent.
   */
  test("the facet param survives alongside the table's other URL params", () => {
    const tableId: string = facetsModule.NETWORK_DEVICES_TABLE_ID;
    const facetParam: string = routeFor(
      facetsModule.UNASSIGNED_DEVICES_FACET_SELECTION,
    ).split("?")[1]!;

    standAt(
      DEVICES_PATH,
      `?${TableFilterUrlState.getParamName(tableId, "filter")}=` +
        `%7B%22name%22%3A%22core%22%7D&${facetParam}&` +
        `${TableFilterUrlState.getParamName(tableId, "view")}=%7B%22page%22%3A2%7D`,
    );

    expect(
      readFacetState().facetOperators[facetsModule.DEVICE_SITE_FACET_KEY],
    ).toBe("is_empty");
    expect(TableFilterUrlState.read(tableId, "filter")).toEqual({
      name: "core",
    });
    expect(TableFilterUrlState.read(tableId, "view")).toEqual({ page: 2 });
  });
});

describe("reading the facet state back off a URL", () => {
  test("a bare device list URL restores no chips", () => {
    standAt(DEVICES_PATH);

    expect(
      TableFilterUrlState.read(facetsModule.NETWORK_DEVICES_TABLE_ID, "facets"),
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
      standAt(DEVICES_PATH, `?${FACET_PARAM_NAME}=${raw}`);

      const state: FacetSelectionState = readFacetState();

      expect(facetStateModule.isFacetSelectionActive(state)).toBe(false);
      expect(state.facetSelections).toEqual({});
      expect(state.facetOperators).toEqual({});
    });
  });

  /*
   * A link built for a chip the user then cleared is inert, not broken: it
   * still carries the namespace, and reading it back constrains nothing. The
   * arriving list is the whole fleet, which is what the link describes.
   */
  test("a link for a cleared chip constrains nothing", () => {
    follow(
      routeModule.getDeviceListRouteForFacet({
        facetKey: facetsModule.DEVICE_STATUS_FACET_KEY,
        values: [],
        operator: "is",
      }),
    );

    const state: FacetSelectionState = readFacetState();

    expect(state.facetSelections[facetsModule.DEVICE_STATUS_FACET_KEY]).toEqual(
      [],
    );
    expect(facetStateModule.isFacetSelectionActive(state)).toBe(false);
  });
});
