import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Network Site pages are React components with no pure logic left to
 * extract — the defects pinned below all live in a prop, a hook dependency,
 * or an import form, and the App suite runs in a plain Node environment
 * with no renderer. So these read the sources and assert the exact
 * expressions, the same way SnmpConfigFormFields.test.ts pins that every
 * SNMP form routes through the shared field helper.
 *
 * Every assertion here corresponds to a bug that shipped; each one fails if
 * its line is reverted. Sources are whitespace-squashed first so prettier
 * re-wrapping a line cannot turn a real regression check into a red herring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

/*
 * ModelDetail builds the API `select` purely from the keys each field
 * declares. The Coordinates row declares only latitude but renders both, so
 * without selectMoreFields longitude comes back undefined and every pinned
 * site reads "Not pinned on the map".
 */
describe("NetworkSite View page selects every column it renders", () => {
  // The site detail page moved to View/Index.tsx when it grew sub-pages.
  const source: string = readSource(
    "Pages",
    "NetworkSite",
    "View",
    "Index.tsx",
  );

  test("asks the API for longitude", () => {
    expect(source).toContain(squash("selectMoreFields: { longitude: true, },"));
  });

  test("the Coordinates row still reads both columns", () => {
    // If this stops being true, the select above is no longer needed.
    expect(source).toContain("item.longitude === undefined");
    expect(source).toContain(squash("{item.latitude}, {item.longitude}"));
  });
});

/*
 * importSites() runs off parseResult, never off the textarea's current
 * text. Editing the CSV after previewing therefore used to import the
 * pre-edit rows — a typo "fixed" in the box was still persisted.
 */
describe("NetworkSite Import page disarms a stale parse", () => {
  const source: string = readSource("Pages", "NetworkSite", "Import.tsx");

  test("typing in the textarea drops the previous parse", () => {
    const onChangeBody: string = source
      .split("onChange={(value: string) => {")[1]!
      .split("}}")[0]!;
    expect(onChangeBody).toContain("setCsvText(value);");
    expect(onChangeBody).toContain("setParseResult(null);");
    expect(onChangeBody).toContain("setRowResults([]);");
  });

  test("the Import button is still gated on parseResult", () => {
    // Clearing the parse only disarms the button because of this predicate.
    expect(source).toContain("!parseResult ||");
  });
});

/*
 * Because the fetch effect runs after paint, raising the loader only inside
 * fetchData left one committed frame at the new site id holding the previous
 * level's data — visible going up as a flash of the "no sites on the map yet"
 * empty state over already-cleared map data.
 */
describe("Network Map page drill transitions", () => {
  const source: string = readSource("Pages", "NetworkSite", "NetworkMap.tsx");

  test("changeSite raises the loader in the same batch as the site id", () => {
    const body: string = source
      .split("const changeSite: (siteId: string | null) => void = (")[1]!
      .split("const changeRegion")[0]!;
    /*
     * No-op on an unchanged target, or the fetch effect never re-runs and
     * the loader is never lowered again.
     */
    expect(body).toContain(squash("if (siteId === currentSiteId) { return; }"));
    // The loader must be raised BEFORE the id, in the same synchronous batch.
    expect(body.indexOf("setIsLoading(true);")).toBeGreaterThan(-1);
    expect(body.indexOf("setIsLoading(true);")).toBeLessThan(
      body.indexOf("setCurrentSiteId(siteId);"),
    );
  });

  test("changeRegion does the same and no-ops on the active region", () => {
    const body: string = source
      .split("const changeRegion: (region: MapRegion) => void = (")[1]!
      .split("/*")[0]!;
    expect(body).toContain(squash("if (region === mapRegion) { return; }"));
    expect(body.indexOf("setIsLoading(true);")).toBeGreaterThan(-1);
    expect(body.indexOf("setIsLoading(true);")).toBeLessThan(
      body.indexOf("setMapRegion(region);"),
    );
  });
});

/*
 * The sidebar's "Network Map" entry has to take the user back to the top of
 * the map from any drill depth. The drill position lives in the query string,
 * and Navigation.navigate() swallows any navigation whose target is already
 * the current page — a judgement it makes on the pathname alone. So a bare
 * route to the map page is, from the map page, a dead link: the click produces
 * no navigation, no location change, and no re-seed, and the user is stranded.
 *
 * These drive the real Navigation with a stubbed browser rather than reading
 * the source: they fail if the sidebar's link stops being a live navigation,
 * whatever it is spelled like.
 */
describe("Network Map sidebar entry escapes a drilled view", () => {
  const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
  const MAP_PATH: string = `/dashboard/${PROJECT_ID}/network-sites/map`;
  const DRILLED_SITE_ID: string = "8f1c9d24-5b7e-4a30-9c62-1d0e5f2a7b48";
  // Two levels deep: a franchisee inside a region, on the world map.
  const DRILLED_SEARCH: string = `?site=${DRILLED_SITE_ID}&mapRegion=world`;

  const browser: { location: { pathname: string; search: string } } = {
    location: { pathname: MAP_PATH, search: "" },
  };

  type DrillStateModule =
    typeof import("../../FeatureSet/Dashboard/src/Components/NetworkSite/NetworkMapDrillState");
  type RouteMapModule =
    typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");
  type PageMapModule =
    typeof import("../../FeatureSet/Dashboard/src/Utils/PageMap");
  type NavigationClass =
    (typeof import("Common/UI/Utils/Navigation"))["default"];

  let drillStateModule: DrillStateModule;
  let routeMapModule: RouteMapModule;
  let pageMapModule: PageMapModule;
  let Navigation: NavigationClass;
  let navigatedTo: Array<string> = [];

  /*
   * Common/UI/Config reads `window` the moment it loads, and the Dashboard
   * route modules pull it in transitively, so the browser stub has to exist
   * before any of them do — hence the deferred imports. A static import would
   * be hoisted above the stub and throw.
   */
  beforeAll(async () => {
    (globalThis as Record<string, unknown>)["window"] = browser;
    /*
     * Node 26 ships a real `sessionStorage` global, and plain assignment over
     * it throws "Cannot redefine property" inside jest's vm context (Node 24,
     * which has no such global, accepts the assignment — so this only fails on
     * CI). Defining the property works on both, and is the same route
     * Common/Tests/UI/Utils/Theme.test.ts already takes for localStorage.
     */
    Object.defineProperty(globalThis, "sessionStorage", {
      value: {
        getItem: (): null => {
          return null;
        },
      },
      configurable: true,
      writable: true,
    });

    drillStateModule = await import(
      "../../FeatureSet/Dashboard/src/Components/NetworkSite/NetworkMapDrillState"
    );
    routeMapModule = await import(
      "../../FeatureSet/Dashboard/src/Utils/RouteMap"
    );
    pageMapModule = await import(
      "../../FeatureSet/Dashboard/src/Utils/PageMap"
    );
    Navigation = (await import("Common/UI/Utils/Navigation")).default;
  });

  function standAt(search: string): void {
    browser.location.search = search;
    /*
     * react-router's types are not resolvable from the App suite, so the
     * router's Location and NavigateFunction are supplied structurally —
     * pathname and the call signature are all Navigation reads off them.
     */
    Navigation.setLocation({ pathname: MAP_PATH } as unknown as Parameters<
      typeof Navigation.setLocation
    >[0]);
    navigatedTo = [];
    Navigation.setNavigateHook(((to: string): void => {
      navigatedTo.push(to);
    }) as unknown as Parameters<typeof Navigation.setNavigateHook>[0]);
  }

  test("the bare map route is a dead link from the map page", () => {
    // The defect: this is what the sidebar entry used to point at.
    standAt(DRILLED_SEARCH);

    Navigation.navigate(
      routeMapModule.RouteUtil.populateRouteParams(
        routeMapModule.default[pageMapModule.default.NETWORK_SITE_MAP]!,
      ),
    );

    expect(navigatedTo).toEqual([]);
  });

  test("the sidebar's route does navigate from a drilled view", () => {
    standAt(DRILLED_SEARCH);

    Navigation.navigate(drillStateModule.getNetworkMapRootRoute());

    expect(navigatedTo).toEqual([`${MAP_PATH}?site=`]);
  });

  /*
   * The two tests above prove the helper produces a live navigation, but they
   * say nothing about what the menu actually points at — the wiring is the
   * whole fix, so pin it here. Without this, "simplifying" the menu back to the
   * bare route restores the dead link with the suite still green.
   */
  test("the Network Map menu entry is wired to that route, not the bare one", () => {
    /*
     * The map entry now lives in the shared Network side menu (both the
     * Devices and Sites sections render it), so that is where the wiring
     * must hold.
     */
    const source: string = readSource(
      "Components",
      "Network",
      "NetworkSideMenu.tsx",
    );

    const mapEntry: RegExpMatchArray | null = source.match(
      /title: "Network Map", to: ([^,]+?),/,
    );

    expect(mapEntry).not.toBeNull();
    expect(mapEntry![1]).toBe("getNetworkMapRootRoute()");
  });

  test("and navigates from the top level too, harmlessly", () => {
    standAt("");

    Navigation.navigate(drillStateModule.getNetworkMapRootRoute());

    expect(navigatedTo).toEqual([`${MAP_PATH}?site=`]);
  });

  test("landing on that route reads back as the top level", () => {
    standAt(
      `?${drillStateModule.getNetworkMapRootRoute().toString().split("?")[1]}`,
    );

    expect(drillStateModule.readDrillStateFromUrl()).toEqual({
      siteId: null,
      mapRegion: "us",
    });
  });

  test("a drilled URL still reads back as that site", () => {
    // The reset must not degenerate into an unconditional "always root" read.
    standAt(DRILLED_SEARCH);

    expect(drillStateModule.readDrillStateFromUrl()).toEqual({
      siteId: DRILLED_SITE_ID,
      mapRegion: "world",
    });
  });
});

describe("SiteGeoMap", () => {
  const source: string = readSource(
    "Components",
    "NetworkSite",
    "SiteGeoMap.tsx",
  );

  /*
   * The two geometry files are ~281 KB. Every route module lands in one
   * shared esbuild chunk, so a static import here is downloaded and parsed
   * by every dashboard page — Incidents, a monitor, Settings — none of
   * which draw a map. They must be loaded on demand, and they must stay
   * .json: esbuild base64-inlines an imported .svg straight back into the
   * shared chunk.
   */
  test("map geometry is not statically imported", () => {
    expect(source).not.toMatch(
      /import \S+ from "\.\/Geo\/(UsStates|WorldCountries)Geometry\.json";/,
    );
  });

  test("both geometry files are loaded lazily, by literal specifier", () => {
    // Literal specifiers so esbuild can see both targets and split them out.
    expect(source).toContain('await import("./Geo/UsStatesGeometry.json")');
    expect(source).toContain(
      'await import("./Geo/WorldCountriesGeometry.json")',
    );
  });

  test("the async load has a rendered pending state", () => {
    expect(source).toContain("features === null ?");
    expect(source).toContain('data-testid="site-geo-map-skeleton"');
  });

  /*
   * The reset used to depend on props.sites by identity. The page's
   * 60-second poll rebuilds that array every minute even when nothing
   * changed, so an open site-picker popover was closed out from under
   * anyone scrolling it.
   */
  test("the popover reset is keyed on pin geometry, not array identity", () => {
    expect(source).toContain("}, [props.region, pinFingerprint]);");
    expect(source).toContain("return mapPinFingerprint(props.sites);");
    expect(source).not.toContain("}, [props.region, props.sites]);");
  });
});

/*
 * The probe collects endpoints only for an explicit `true`, so a step saved
 * before the field existed (undefined) must paint OFF — and must keep
 * painting OFF for every other non-true value. `=== true` is what keeps the
 * switch showing exactly what the probe will do, for every monitor ever
 * saved, rather than a default the two sides could drift apart on.
 */
describe("NetworkDeviceMonitorStepForm endpoint collection toggle", () => {
  const source: string = readSource(
    "Components",
    "Form",
    "Monitor",
    "NetworkDeviceMonitor",
    "NetworkDeviceMonitorStepForm.tsx",
  );

  test("renders the probe's own strictly-opt-in predicate", () => {
    expect(source).toContain(
      squash(
        "value={ props.monitorStepNetworkDeviceMonitor.collectEndpoints === true }",
      ),
    );
  });

  test("does not pass the raw optional value", () => {
    expect(source).not.toContain(
      "value={props.monitorStepNetworkDeviceMonitor.collectEndpoints}",
    );
  });

  test("tells the operator it is off by default", () => {
    expect(source).toContain("Off by default.");
  });
});
