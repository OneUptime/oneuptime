import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The cross-page hand-off: the Sites page's "Unassigned Devices" tile counts
 * devices, and devices are only listed on the Devices page. Activating it has
 * to land the user on that page already filtered — otherwise the click drops
 * them into an unfiltered list of the whole fleet and they have to find the
 * rows themselves, which is the exact problem the tile was supposed to solve.
 *
 * These drive the real Navigation, RouteMap and ProjectUtil against a stubbed
 * browser rather than reading the source, so they fail if the link stops being
 * a live, filtered navigation however it is spelled.
 */

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const SITES_PATH: string = `/dashboard/${PROJECT_ID}/network-sites`;
const DEVICES_PATH: string = `/dashboard/${PROJECT_ID}/network-devices`;

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
  typeof import("../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryFilterRoute");
type FilterModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryFilter");
type SiteFilterModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteSummaryFilter");
type DeviceFilterKeyValue =
  FilterModule["DeviceSummaryFilterKey"][keyof FilterModule["DeviceSummaryFilterKey"]];
type NavigationClass = (typeof import("Common/UI/Utils/Navigation"))["default"];
type RouteClass = (typeof import("Common/Types/API/Route"))["default"];

let routeModule: RouteModule;
let filterModule: FilterModule;
let siteFilterModule: SiteFilterModule;
let Navigation: NavigationClass;
let Route: RouteClass;
let navigatedTo: Array<string> = [];

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
    "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryFilterRoute"
  );
  filterModule = await import(
    "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryFilter"
  );
  siteFilterModule = await import(
    "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteSummaryFilter"
  );
  Navigation = (await import("Common/UI/Utils/Navigation")).default;
  Route = (await import("Common/Types/API/Route")).default;
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

beforeEach(() => {
  standAt(SITES_PATH);
});

describe("getDeviceListRouteForFilter", () => {
  test("points at the device list for the current project", () => {
    const route: InstanceType<RouteClass> =
      routeModule.getDeviceListRouteForFilter(
        filterModule.DeviceSummaryFilterKey.NoSite,
      );

    expect(route.toString()).toBe(`${DEVICES_PATH}?deviceFilter=no-site`);
  });

  /*
   * The project id has to be substituted, not left as the `:projectId`
   * placeholder — a link to a literal ":projectId" path 404s in the router.
   */
  test("substitutes the project id rather than leaving the placeholder", () => {
    expect(
      routeModule
        .getDeviceListRouteForFilter(filterModule.DeviceSummaryFilterKey.NoSite)
        .toString(),
    ).not.toContain(":projectId");
  });

  test("lands on the device list, not the network overview or topology", () => {
    const path: string = routeModule
      .getDeviceListRouteForFilter(filterModule.DeviceSummaryFilterKey.NoSite)
      .toString()
      .split("?")[0]!;

    expect(path).toBe(DEVICES_PATH);
    expect(path.endsWith("/network-devices")).toBe(true);
  });

  test("carries every filter key it is given", () => {
    for (const key of Object.values(filterModule.DeviceSummaryFilterKey)) {
      expect(routeModule.getDeviceListRouteForFilter(key).toString()).toBe(
        `${DEVICES_PATH}?deviceFilter=${key}`,
      );
    }
  });

  test("produces a distinct route per filter", () => {
    const routes: Array<string> = Object.values(
      filterModule.DeviceSummaryFilterKey,
    ).map((key: DeviceFilterKeyValue) => {
      return routeModule.getDeviceListRouteForFilter(key).toString();
    });

    expect(new Set(routes).size).toBe(routes.length);
  });

  /*
   * The parameter name has to be the one the Devices page reads. Building it
   * from the shared constant is what guarantees that; this asserts the
   * constant actually made it into the URL.
   */
  test("names the parameter the device page reads", () => {
    expect(
      routeModule
        .getDeviceListRouteForFilter(filterModule.DeviceSummaryFilterKey.Down)
        .toString(),
    ).toContain(`${filterModule.DEVICE_SUMMARY_FILTER_URL_PARAM}=`);
  });
});

describe("the Unassigned Devices tile's hand-off", () => {
  /*
   * End to end: the Sites page builds the link from the shared constant, the
   * user follows it, and the Devices page reads its filter back off the URL.
   * A break anywhere along that chain shows up here as an unfiltered list.
   */
  test("round-trips from the Sites page to a filtered device list", () => {
    const route: InstanceType<RouteClass> =
      routeModule.getDeviceListRouteForFilter(
        siteFilterModule.UNASSIGNED_DEVICES_FILTER_KEY,
      );

    Navigation.navigate(route);

    expect(navigatedTo).toEqual([`${DEVICES_PATH}?deviceFilter=no-site`]);

    // The user has now landed there.
    const [pathname, search] = navigatedTo[0]!.split("?") as [string, string];
    standAt(pathname, `?${search}`);

    expect(
      filterModule.parseDeviceSummaryFilterKey(
        Navigation.getQueryStringByName(
          filterModule.DEVICE_SUMMARY_FILTER_URL_PARAM,
        ),
      ),
    ).toBe(filterModule.DeviceSummaryFilterKey.NoSite);
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
      routeModule.getDeviceListRouteForFilter(
        filterModule.DeviceSummaryFilterKey.NoSite,
      ),
    );

    expect(navigatedTo).toEqual([`${DEVICES_PATH}?deviceFilter=no-site`]);
  });

  test("every device filter survives the trip through a URL", () => {
    for (const key of Object.values(filterModule.DeviceSummaryFilterKey)) {
      const route: string = routeModule
        .getDeviceListRouteForFilter(key)
        .toString();
      const [pathname, search] = route.split("?") as [string, string];

      standAt(pathname, `?${search}`);

      expect(
        filterModule.parseDeviceSummaryFilterKey(
          Navigation.getQueryStringByName(
            filterModule.DEVICE_SUMMARY_FILTER_URL_PARAM,
          ),
        ),
      ).toBe(key);
    }
  });
});

describe("reading the filter back off a URL", () => {
  test("a bare device list URL is unfiltered", () => {
    standAt(DEVICES_PATH);

    expect(
      filterModule.parseDeviceSummaryFilterKey(
        Navigation.getQueryStringByName(
          filterModule.DEVICE_SUMMARY_FILTER_URL_PARAM,
        ),
      ),
    ).toBeNull();
  });

  /*
   * The parameter is user-editable. A hand-typed or truncated value has to
   * open the plain list rather than throw on a page the user asked for.
   */
  test("a junk parameter opens the unfiltered list", () => {
    standAt(DEVICES_PATH, "?deviceFilter=whatever");

    expect(
      filterModule.parseDeviceSummaryFilterKey(
        Navigation.getQueryStringByName(
          filterModule.DEVICE_SUMMARY_FILTER_URL_PARAM,
        ),
      ),
    ).toBeNull();
  });

  test("the filter survives alongside the table's own URL state", () => {
    /*
     * BaseModelTable mirrors its column filters, search and page into their
     * own namespaced parameters. Both sets share one query string, so the
     * tile filter has to be readable with them present.
     */
    standAt(
      DEVICES_PATH,
      "?network-devices-table_filter=%7B%7D&network-devices-table_view=%7B%22page%22%3A2%7D&deviceFilter=pending",
    );

    expect(
      filterModule.parseDeviceSummaryFilterKey(
        Navigation.getQueryStringByName(
          filterModule.DEVICE_SUMMARY_FILTER_URL_PARAM,
        ),
      ),
    ).toBe(filterModule.DeviceSummaryFilterKey.Pending);
  });

  test("the site filter parameter is not mistaken for a device filter", () => {
    standAt(DEVICES_PATH, "?siteFilter=unhealthy");

    expect(
      filterModule.parseDeviceSummaryFilterKey(
        Navigation.getQueryStringByName(
          filterModule.DEVICE_SUMMARY_FILTER_URL_PARAM,
        ),
      ),
    ).toBeNull();
  });

  test("both pages' filters can sit in one URL without colliding", () => {
    standAt(DEVICES_PATH, "?siteFilter=unhealthy&deviceFilter=down");

    expect(
      filterModule.parseDeviceSummaryFilterKey(
        Navigation.getQueryStringByName(
          filterModule.DEVICE_SUMMARY_FILTER_URL_PARAM,
        ),
      ),
    ).toBe(filterModule.DeviceSummaryFilterKey.Down);
    expect(
      siteFilterModule.parseSiteSummaryFilterKey(
        Navigation.getQueryStringByName(
          siteFilterModule.SITE_SUMMARY_FILTER_URL_PARAM,
        ),
      ),
    ).toBe(siteFilterModule.SiteSummaryFilterKey.Unhealthy);
  });
});

describe("Route construction", () => {
  test("the helper returns a Route, so callers can keep composing it", () => {
    expect(
      routeModule.getDeviceListRouteForFilter(
        filterModule.DeviceSummaryFilterKey.Up,
      ),
    ).toBeInstanceOf(Route);
  });
});
