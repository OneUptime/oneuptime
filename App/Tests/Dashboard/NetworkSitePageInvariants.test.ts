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
 * The same source with its comments removed. Assertions about what the
 * product SAYS have to read the code, not the commentary — a comment
 * explaining why a piece of copy was removed would otherwise fail the very
 * test that checks it is gone.
 */
function readCode(...relativeParts: Array<string>): string {
  const raw: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativeParts),
    "utf8",
  );
  return squash(
    raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " "),
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
 *
 * (The import moved out of its own page and into a modal on the Sites
 * table's ⋯ menu; the defect below moved with it.)
 */
describe("Import Sites modal disarms a stale parse", () => {
  const source: string = readSource(
    "Components",
    "NetworkSite",
    "ImportSitesFromCsvModal.tsx",
  );

  test("typing in the textarea drops the previous parse", () => {
    const onChangeBody: string = source
      .split("onChange={(value: string) => {")[1]!
      .split("}}")[0]!;
    expect(onChangeBody).toContain("setCsvText(value);");
    expect(onChangeBody).toContain("setParseResult(null);");
    expect(onChangeBody).toContain("setRowResults([]);");
  });

  test("the Import button is still gated on a live parse", () => {
    /*
     * Clearing the parse only disarms the footer's submit button because
     * canImport is computed from parseResult rather than from csvText.
     */
    expect(source).toContain(
      squash(
        "const canImport: boolean = Boolean( parseResult && rows.length > 0 && parseErrors.length === 0, );",
      ),
    );
    expect(source).toContain("(!hasImported && !canImport)");
  });

  /*
   * A second press of a still-armed Import would replay the whole file
   * against a project that already contains most of it — every created row
   * coming back as a duplicate-name failure.
   */
  test("a finished run turns the submit button into Done", () => {
    expect(source).toContain("setHasImported(true);");
    expect(source).toContain(squash('hasImported ? "Done"'));
    expect(source).toContain(
      squash("if (hasImported) { props.onClose(); return; }"),
    );
  });

  // Closing mid-run would leave the create loop writing into an unmounted tree.
  test("the modal cannot be dismissed while the import is running", () => {
    expect(source).toContain(
      squash(
        "onClose={() => { if (isImporting) { return; } props.onClose(); }}",
      ),
    );
  });
});

/*
 * The import used to be a standalone page under a "Discovery & Import"
 * section of the Network side menu — the one action that creates sites,
 * parked in a different corner of the product from the table that lists
 * them. It is now a bulk action in the Sites table's ⋯ overflow menu, the
 * same place every other table-wide action lives.
 */
describe("Sites table owns the CSV import", () => {
  const source: string = readSource("Pages", "NetworkSite", "Sites.tsx");

  test("the table offers an Import from CSV card button", () => {
    expect(source).toContain(squash('title: "Import from CSV",'));
    expect(source).toContain("setShowImportModal(true);");
  });

  /*
   * BaseModelTable promotes the first NORMAL/PRIMARY-styled button to the
   * header slot and hides the rest behind the ⋯ menu. An OUTLINE style is
   * what keeps this one in the overflow, next to Refresh and Filter,
   * instead of competing with "Create Network Site".
   */
  test("it is styled so it stays in the overflow menu", () => {
    const buttonBlock: string = source
      .split('title: "Import from CSV",')[1]!
      .split("} as CardButtonSchema")[0]!;
    expect(buttonBlock).toContain("buttonStyle: ButtonStyleType.OUTLINE,");
    expect(buttonBlock).not.toContain("ButtonStyleType.NORMAL");
    expect(buttonBlock).not.toContain("ButtonStyleType.PRIMARY");
  });

  test("the modal is rendered from the page", () => {
    expect(source).toContain("<ImportSitesFromCsvModal");
    expect(source).toContain("setShowImportModal(false);");
  });

  /*
   * An import creates rows the table is already showing a page of, plus it
   * moves every number in the summary strip and the hierarchy tree. Without
   * the toggle reaching all three the user closes the modal onto stale data.
   */
  test("a completed import refreshes the table and the rollups above it", () => {
    expect(source).toContain(squash("onImportComplete={() => {"));
    const completeBody: string = source
      .split("onImportComplete={() => {")[1]!
      .split("}}")[0]!;
    expect(completeBody).toContain("setRefreshToggle(Date.now().toString());");

    /*
     * The same toggle has to be wired into all three consumers. The summary
     * strip carries the tile drill-down props too, so match the opening tag
     * and its toggle rather than the whole (now longer) prop list.
     */
    expect(source).toContain(
      squash("<SiteSummaryCards refreshToggle={refreshToggle}"),
    );
    expect(source).toContain(
      "<SiteHierarchyTree refreshToggle={refreshToggle} />",
    );
    expect(source).toContain(
      squash("<ModelTable<NetworkSite> refreshToggle={refreshToggle}"),
    );
  });
});

describe("the standalone Import Sites page is gone", () => {
  test("the page file no longer exists", () => {
    expect(
      fs.existsSync(
        path.join(DASHBOARD_SRC, "Pages", "NetworkSite", "Import.tsx"),
      ),
    ).toBe(false);
  });

  test.each([
    ["Routes/NetworkSiteRoutes.tsx"],
    ["Utils/PageMap.ts"],
    ["Utils/RouteMap.ts"],
    ["Components/Network/NetworkSideMenu.tsx"],
    ["Pages/NetworkSite/Utils/Breadcrumbs.ts"],
  ])("%s carries no route to it", (relativePath: string) => {
    expect(readSource(...relativePath.split("/"))).not.toContain(
      "NETWORK_SITE_IMPORT",
    );
  });

  test("the side menu no longer advertises it", () => {
    const source: string = readSource(
      "Components",
      "Network",
      "NetworkSideMenu.tsx",
    );
    expect(source).not.toContain('title: "Import Sites"');
    // The section it lived in was named for it; only discovery is left.
    expect(source).not.toContain('title: "Discovery & Import"');
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
      .split("/*")[0]!;
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
});

/*
 * The map used to open behind a "United States / World" segmented control:
 * a hardcoded geography preference in a product sold everywhere, where one
 * of the two options is dead weight for any customer outside the US and
 * "add more countries" only moves the arbitrariness around.
 *
 * It is gone, and the map frames itself to wherever the project's sites are
 * instead (Geo/GeoViewport.ts). These pin the removal rather than the
 * mechanism — the point is that no country may be named in this UI again.
 */
describe("the Network Map names no country", () => {
  const PAGE: string = readSource("Pages", "NetworkSite", "NetworkMap.tsx");
  const MAP: string = readSource("Components", "NetworkSite", "SiteGeoMap.tsx");
  const VIEW_MODEL: string = readSource(
    "Components",
    "NetworkSite",
    "SiteMapViewModel.ts",
  );

  test("the region segmented control is gone from the page", () => {
    expect(PAGE).not.toContain('aria-label="Map region"');
    expect(PAGE).not.toContain("network-map-region-");
    expect(PAGE).not.toContain("changeRegion");
    expect(PAGE).not.toContain("setMapRegion");
  });

  test("no MapRegion type survives anywhere in the map's code", () => {
    for (const source of [
      readCode("Pages", "NetworkSite", "NetworkMap.tsx"),
      readCode("Components", "NetworkSite", "SiteGeoMap.tsx"),
      readCode("Components", "NetworkSite", "SiteMapViewModel.ts"),
    ]) {
      expect(source).not.toContain("MapRegion");
    }
    // The type itself is gone, not merely unused.
    expect(VIEW_MODEL).not.toContain("export type MapRegion");
  });

  /*
   * The user-facing strings are the actual product surface. "United States"
   * appearing in any of them is the regression. Comments are stripped first
   * — the code is allowed to explain why the control was removed.
   */
  test("no country name appears in the map's rendered copy", () => {
    for (const source of [
      readCode("Pages", "NetworkSite", "NetworkMap.tsx"),
      readCode("Components", "NetworkSite", "SiteGeoMap.tsx"),
    ]) {
      expect(source).not.toContain("United States");
      expect(source).not.toContain("US map");
    }
  });

  test("the map component takes sites and a click handler, and no region", () => {
    expect(PAGE).toContain(squash("sites={pinnedSites}"));
    expect(PAGE).toContain(squash("onSiteClick={changeSite}"));
    expect(MAP).not.toContain("region: MapRegion;");
  });

  /*
   * Links carrying the old parameter are still in inboxes. Nothing reads it
   * any more, so the page has to clear it rather than leave a dead control
   * name in a URL the user may copy again.
   */
  test("the stale mapRegion parameter is cleared from the URL", () => {
    expect(PAGE).toContain(
      squash(
        "queueQueryStringUpdate({ [LEGACY_NETWORK_MAP_REGION_PARAM]: null });",
      ),
    );
  });
});

/*
 * The map used to answer with every coordinate-bearing site in the project,
 * flat, however deep the user had drilled — and it was only fetched at the
 * root at all. So the map showed proximity blobs whose counts matched
 * nothing the customer had named, while the cards directly underneath
 * showed the real hierarchy, and drilling replaced the map with a diagram.
 * Two halves of one page describing two different networks.
 *
 * These pin the three things that fixed it. Each one fails if its line is
 * reverted.
 */
describe("the Network Map follows the drill", () => {
  const PAGE: string = readSource("Pages", "NetworkSite", "NetworkMap.tsx");

  test("the map endpoint is asked about the level in view", () => {
    expect(PAGE).toContain(
      squash(
        "data: siteId ? { siteId: siteId, mode: mapMode } : { mode: mapMode },",
      ),
    );
  });

  /*
   * The map is fetched at every level now. The old code skipped it whenever
   * a siteId was set, which is what made a drilled view mapless.
   */
  test("the map is no longer skipped once you drill in", () => {
    const code: string = readCode("Pages", "NetworkSite", "NetworkMap.tsx");
    expect(code).not.toContain(
      squash(
        "const mapPromise: Promise< HTTPResponse<JSONObject> | HTTPErrorResponse > | null = siteId ? null",
      ),
    );
    expect(code).toContain(
      squash("await Promise.all([childrenPromise, mapPromise]);"),
    );
  });

  /*
   * One map element, rendered by BOTH the container branch and the root
   * branch — drilling re-frames the same map instead of swapping it for
   * something else.
   */
  test("the same map is rendered at the container level and at the root", () => {
    const code: string = readCode("Pages", "NetworkSite", "NetworkMap.tsx");
    expect(code).toContain("const geoMap: ReactElement = (");
    expect(code.split("{geoMap}").length - 1).toBeGreaterThanOrEqual(2);
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
  /*
   * Two levels deep: a franchisee inside a region. The stale "mapRegion" is
   * deliberately still here — it is what a link shared before the region
   * toggle was removed looks like, and such a link must still open on the
   * site it names.
   */
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
    });
  });

  test("a drilled URL still reads back as that site", () => {
    // The reset must not degenerate into an unconditional "always root" read.
    standAt(DRILLED_SEARCH);

    expect(drillStateModule.readDrillStateFromUrl()).toEqual({
      siteId: DRILLED_SITE_ID,
    });
  });

  /*
   * A link shared before the region toggle was removed still names a site.
   * Dropping the user at the root because the URL carries a parameter that
   * no longer exists would break every bookmark in the wild.
   */
  test("a pre-existing link carrying the removed region parameter still opens its site", () => {
    standAt(`?mapRegion=us&site=${DRILLED_SITE_ID}`);

    expect(drillStateModule.readDrillStateFromUrl()).toEqual({
      siteId: DRILLED_SITE_ID,
    });
  });

  test("the drill state no longer carries any geography", () => {
    standAt(DRILLED_SEARCH);

    expect(Object.keys(drillStateModule.readDrillStateFromUrl())).toEqual([
      "siteId",
    ]);
  });
});

describe("SiteGeoMap", () => {
  const source: string = readSource(
    "Components",
    "NetworkSite",
    "SiteGeoMap.tsx",
  );

  /*
   * The geometry is ~600 KB across both tiers. Every route module lands in
   * one shared esbuild chunk, so a static import here is downloaded and
   * parsed by every dashboard page — Incidents, a monitor, Settings — none
   * of which draw a map. They must be loaded on demand, and they must stay
   * .json: esbuild base64-inlines an imported .svg straight back into the
   * shared chunk.
   */
  test("map geometry is not statically imported", () => {
    expect(source).not.toMatch(
      /import \S+ from "\.\/Geo\/WorldCountries\w*Geometry\.json";/,
    );
  });

  test("both tiers are loaded lazily, by literal specifier", () => {
    // Literal specifiers so esbuild can see both targets and split them out.
    expect(source).toContain(
      'await import("./Geo/WorldCountriesGeometry.json")',
    );
    expect(source).toContain(
      'await import("./Geo/WorldCountriesDetailGeometry.json")',
    );
  });

  test("the async load has a rendered pending state", () => {
    expect(source).toContain("overviewFeatures === null ?");
    expect(source).toContain('data-testid="site-geo-map-skeleton"');
  });

  /*
   * The detail tier is the expensive one. Fetching it before somebody has
   * zoomed in would hand the whole cost to every viewer of the page,
   * including the many who never zoom — which is the entire reason the
   * geometry is split into tiers at all.
   */
  test("the detail tier is fetched only once the map is zoomed in", () => {
    expect(source).toContain(
      "const needsDetail: boolean = shouldUseDetailGeometry(viewport);",
    );
    expect(source).toContain(
      squash("if (!needsDetail || detailFeatures) { return; }"),
    );
  });

  test("the overview stays on screen while the detail tier loads", () => {
    // An upgrade in place — never a blank map waiting on a 500 KB fetch.
    expect(source).toContain(
      squash(
        "const features: Array<GeometryFeature> | null = needsDetail && detailFeatures ? detailFeatures : overviewFeatures;",
      ),
    );
  });

  /*
   * The reset used to depend on props.sites by identity. The page's
   * 60-second poll rebuilds that array every minute even when nothing
   * changed, so an open site-picker popover was closed out from under
   * anyone scrolling it — and now the map would also be re-framed under
   * anyone who had zoomed in.
   */
  test("the re-frame and popover reset are keyed on pin geometry, not array identity", () => {
    /*
     * The chain that has to hold, link by link: fingerprint -> pins ->
     * fitted frame -> the effect that applies it. Break any link and the
     * 60-second poll re-frames the map, because it hands over a new array
     * every minute whether or not a single site moved.
     */
    expect(source).toContain("return mapPinFingerprint(props.sites);");
    expect(source).toContain(
      squash("return buildPins(sitesRef.current); }, [pinFingerprint]);"),
    );
    expect(source).toContain(
      squash("return fitViewportToPoints(pins); }, [pins]);"),
    );

    const reframe: string = source
      .split("setViewport(fittedViewport);")[1]!
      .split("]);")[0]!;
    expect(reframe).toContain("setOpenCluster(null);");
    expect(reframe).toContain("}, [fittedViewport");
  });

  /*
   * Pointer capture retargets the click that follows a drag, so taking it on
   * pointerdown stops every marker from ever being clickable. It has to be
   * taken only once the pointer has actually moved — the same threshold that
   * suppresses the click.
   */
  test("pointer capture is taken on move, not on down", () => {
    const downHandler: string = source
      .split("const onPointerDown:")[1]!
      .split("const onPointerMove:")[0]!;
    expect(downHandler).not.toContain("setPointerCapture");

    const moveHandler: string = source
      .split("const onPointerMove:")[1]!
      .split("const onKeyDown:")[0]!;
    expect(moveHandler).toContain("setPointerCapture");
    expect(moveHandler).toContain("suppressClick.current = true;");
  });

  test("a drag that ends on a marker does not drill into it", () => {
    expect(source).toContain(squash("if (suppressClick.current) { return; }"));
  });

  /*
   * Markers, strokes and labels are UI, not geography. If they scaled with
   * the map, zooming in to separate two sites would produce two bigger
   * overlapping blobs instead of two markers.
   */
  /*
   * A marker's colour, its count and its tooltip are all computed inside
   * buildMapMarkers from the rollup fields. The pin fingerprint next door is
   * deliberately geometry-only — a site going down must not re-frame the map
   * — so keying the MARKER memo on it froze the markers: a region could go
   * entirely dark and its square stayed green until the page was reloaded,
   * while the card right underneath turned red. That disagreement between
   * the two halves of the page is the whole defect this feature exists to
   * fix, so the memo has to watch the sites themselves.
   */
  test("markers are rebuilt when the sites change, not only when they move", () => {
    const memo: string = source
      .split("const markers: Array<MapMarker> = useMemo(() => {")[1]!
      .split("]);")[0]!;
    expect(memo).toContain("sites: props.sites,");
    expect(memo).toContain(squash("}, [props.sites, props.mode, cellSize"));
    expect(memo).not.toContain("sitesRef.current");
    expect(memo).not.toContain("pinFingerprint");
  });

  /*
   * ...while the FIT stays keyed on geometry alone, or the 60-second poll
   * re-frames the map under someone who has zoomed in.
   */
  test("the fit still ignores everything but where the sites are", () => {
    expect(source).toContain("return mapPinFingerprint(props.sites);");
    expect(source).toContain(
      squash("return buildPins(sitesRef.current); }, [pinFingerprint]);"),
    );
  });

  test("marker geometry is divided by the zoom", () => {
    /*
     * Marker sizing moved into the view model when markers stopped being
     * only proximity clusters, but the conversion still has to happen: a
     * radius chosen in SCREEN units is meaningless until it is expressed in
     * the viewBox units the SVG actually draws in.
     */
    expect(source).toContain(
      squash("screenLengthToViewportLength( marker.screenRadius, viewport, )"),
    );
    expect(source).toContain("strokeWidth={0.6 / zoom}");
    expect(source).toContain("strokeWidth={(hasCount ? 2.5 : 2) / zoom}");
    // The name labels are UI too — they must not grow with the map.
    expect(source).toContain("fontSize={LABEL_FONT_SIZE / zoom}");
  });

  /*
   * React's synthetic wheel handler cannot preventDefault, so a wheel-zoom
   * wired through onWheel scrolls the page underneath the map.
   */
  test("wheel zoom uses a native non-passive listener", () => {
    expect(source).toContain(
      'element.addEventListener("wheel", onWheel, { passive: false });',
    );
    expect(source).toContain("event.preventDefault();");
  });
});

/*
 * The monitor step form is the alerting layer and nothing else: it picks a
 * device, and the criteria below it decide what to alert on. Every collection
 * knob — polling schedule, interface walks, endpoint discovery, health OIDs —
 * belongs to the NetworkDevice, which its probe walks on its own schedule
 * whether or not a monitor exists. If a collection control ever reappears
 * here, the same setting exists in two places and the two silently disagree:
 * the device keeps polling to its own configuration and the monitor form
 * shows something else.
 *
 * (The endpoint-collection toggle this file used to pin lived on this form
 * until devices took ownership of polling. It now lives in
 * Pages/NetworkDevice/DevicePollingFormFields.ts, pinned by
 * Tests/Dashboard/DevicePollingFormFields.test.ts.)
 */
describe("NetworkDeviceMonitorStepForm carries no data-collection controls", () => {
  const source: string = readSource(
    "Components",
    "Form",
    "Monitor",
    "NetworkDeviceMonitor",
    "NetworkDeviceMonitorStepForm.tsx",
  );

  test("picks a device", () => {
    expect(source).toContain("modelType={NetworkDevice}");
  });

  test.each([
    ["collectEndpoints"],
    ["walkInterfaces"],
    ["isPollingEnabled"],
    ["pollingIntervalInMinutes"],
    ["snmpOids"],
  ])("does not configure %s", (collectionField: string) => {
    expect(source).not.toContain(collectionField);
  });
});
