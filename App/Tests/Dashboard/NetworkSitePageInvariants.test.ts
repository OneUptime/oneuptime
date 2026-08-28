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
      searchText: "",
    });
  });

  test("a drilled URL still reads back as that site", () => {
    // The reset must not degenerate into an unconditional "always root" read.
    standAt(DRILLED_SEARCH);

    expect(drillStateModule.readDrillStateFromUrl()).toEqual({
      siteId: DRILLED_SITE_ID,
      searchText: "",
    });
  });

  /*
   * The search box's text rides in the URL alongside the drill position, so a
   * narrowed map is a link somebody can send. An absent parameter has to read
   * as "" — no filter — and never as a filter that matches nothing, which
   * would open a map with everything hidden.
   */
  test("a shared link carries the search text, and its absence is no filter", () => {
    standAt(`?site=${DRILLED_SITE_ID}&siteSearch=kansas%20city`);

    expect(drillStateModule.readDrillStateFromUrl()).toEqual({
      siteId: DRILLED_SITE_ID,
      searchText: "kansas city",
    });

    standAt(`?site=${DRILLED_SITE_ID}`);

    expect(drillStateModule.readDrillStateFromUrl().searchText).toBe("");
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
      searchText: "",
    });
  });

  /*
   * An exact whitelist, not a "does not contain mapRegion" check: the point is
   * that a geography key cannot come back under ANY name, so every field the
   * drill state carries has to be named here deliberately.
   */
  test("the drill state no longer carries any geography", () => {
    standAt(DRILLED_SEARCH);

    expect(Object.keys(drillStateModule.readDrillStateFromUrl())).toEqual([
      "siteId",
      "searchText",
    ]);
  });
});

/*
 * The Network Map's search box narrows the level in view AND finds sites
 * anywhere in the hierarchy. The wiring below is the whole of the first half,
 * and every assertion here corresponds to a way of getting it subtly wrong
 * that produces a page which still renders and still looks plausible.
 */
describe("the Network Map search narrows the whole level at once", () => {
  const PAGE: string = readCode("Pages", "NetworkSite", "NetworkMap.tsx");

  /*
   * The map, the cards/graph and the WAN links must be fed from the SAME
   * predicate. Filtering the cards but not the markers is the exact defect
   * the grouped-marker rewrite existed to end — two halves of one page
   * describing two different networks — reintroduced through a search box.
   */
  test("markers, sites, unplaced sites and links all go through the filter", () => {
    expect(PAGE).toContain(
      squash("const pinnedSites: Array<MapSiteView> = filterSitesBySearch("),
    );
    expect(PAGE).toContain(
      squash("const levelSites: Array<SiteChildView> = filterSitesBySearch("),
    );
    expect(PAGE).toContain(
      squash(
        "const unplacedSites: Array<MapUnplacedSiteView> = filterSitesBySearch(",
      ),
    );
    /*
     * The link list is composed: the search predicate first, then the
     * health filter (issue #3261) against what survived. Asserted as the
     * whole composition rather than as the inner call alone, so dropping
     * either half is a failure.
     */
    expect(PAGE).toContain(
      squash(
        "const levelLinks: Array<SiteLinkView> = filterLinksByVisibleSites( filterLinksBySearch(allLevelLinks, normalizedSearch, siteIdSet(levelSites)),",
      ),
    );
    // The link filter has to see the SURVIVING sites, not the raw list.
    expect(PAGE).toContain(squash("siteIdSet(levelSites),"));
  });

  /*
   * The type label names what the children of this level ARE. Deriving it
   * from the filtered list makes searching for one region rewrite the map's
   * legend, its mode switch and its coverage count as you type — a level of
   * Regions becomes a level of "sites" the moment two types both match.
   */
  test("the child type label is derived from the unfiltered level", () => {
    expect(PAGE).toContain(squash("childTypeLabelFor(allLevelSites)"));
    expect(PAGE).not.toContain(squash("childTypeLabelFor(levelSites)"));
  });

  /*
   * "No network sites yet" is a claim about the PROJECT. Deciding it on the
   * filtered lists tells a customer with a thousand stores that they have
   * never created one, and offers them a "create your first network site"
   * button, because they typed a name that does not match anything.
   */
  test("the empty state is decided on the unfiltered lists", () => {
    expect(PAGE).toContain(
      squash("if (allLevelSites.length === 0 && allPinnedSites.length === 0)"),
    );
  });

  /*
   * Both levels that draw a map get the box — the root and the container. The
   * unit level deliberately does not: its device topology carries its own
   * search over devices, and a second box above it would be two search fields
   * on one screen searching different things.
   */
  test("the box renders at the root and at a container level, not on a unit", () => {
    expect(PAGE).toContain(squash("const searchBox: ReactElement = ("));
    expect(PAGE.split("{searchBox}").length - 1).toBeGreaterThanOrEqual(2);
    // The unit branch returns before searchBox is ever built.
    expect(PAGE.indexOf("<NetworkTopologyLiveView")).toBeLessThan(
      PAGE.indexOf("const searchBox: ReactElement = ("),
    );
  });

  /*
   * Both empty states have to know a filter is on. Without it, a search that
   * matches nothing at this level reads as "you have no sites here" and sends
   * the reader off to add coordinates to fix something that is not broken.
   */
  test("the map and the graph are told what the search text is", () => {
    expect(PAGE).toContain(squash("searchText={searchText}"));
    expect(readCode("Components", "NetworkSite", "SiteGeoMap.tsx")).toContain(
      "site-geo-map-no-search-match",
    );
    expect(
      readCode("Components", "NetworkSite", "SiteContainerGraph.tsx"),
    ).toContain("site-container-no-search-match");
  });

  /*
   * Drilling ends the search. Text that narrowed THIS level would hide most
   * of the next one, and the reader would arrive at a level that looks empty
   * for a reason sitting in a box they have stopped looking at.
   */
  test("drilling clears the search, in state and in the URL", () => {
    const body: string = PAGE.split(
      "const changeSite: (siteId: string | null) => void = (",
    )[1]!.split("};")[0]!;
    expect(body).toContain(squash('setSearchTextState("");'));
    expect(body).toContain(squash("[NETWORK_MAP_SEARCH_PARAM]: null,"));
  });
});

describe("SiteGeoMap", () => {
  const source: string = readSource(
    "Components",
    "NetworkSite",
    "SiteGeoMap.tsx",
  );

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
        "const isDrawingDetail: boolean = Boolean(needsDetail && detailFeatures);",
      ),
    );
    expect(source).toContain(
      squash(
        "const features: Array<GeometryFeature> | null = isDrawingDetail ? detailFeatures : overviewFeatures;",
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

  /*
   * Markers used to be drawn straight at their projected positions, with
   * paint order as the only defence against two of them landing on the same
   * spot — which is no defence at all once they land on exactly the same
   * spot. The map now lays them out first (Geo/MarkerLayout.ts, pinned by
   * MarkerLayout.test.ts) and every marker is drawn from that result.
   *
   * A single `markers.map` left behind here would put one marker back under
   * another with nothing on screen saying so, so these pin the wiring rather
   * than the geometry.
   */
  test("markers are drawn from the collision layout, not from raw positions", () => {
    expect(source).toContain(
      squash(
        "const placedMarkers: Array<PlacedMapMarker> = useMemo(() => { return layoutMapMarkers(markers, zoom); }, [markers, zoom]);",
      ),
    );
    expect(source).toContain(
      squash("{placedMarkers.map((marker: PlacedMapMarker): ReactElement =>"),
    );
    // Nothing draws off the un-laid-out list any more.
    expect(source).not.toContain(squash("{markers.map((marker: MapMarker)"));
  });

  /*
   * The names have to follow the marker a reader can SEE. Resolving them
   * against the projected positions would drop labels for a collision that
   * the layout has already resolved, and print the survivors in the wrong
   * place.
   */
  test("labels are placed against the drawn positions", () => {
    expect(source).toContain(
      squash("return resolveMarkerLabels(placedMarkers, zoom, {"),
    );
    // Nothing draws off the un-laid-out list any more.
    expect(source).not.toContain(squash("resolveMarkerLabels(markers,"));
  });

  /*
   * Issue #3372. The thread from a name to its marker earns its ink only at
   * the unit level, where a dozen units in one retail park all need naming.
   * On an aggregated level — thirty regions over a continent — thirty
   * threads crossing each other are a web, not a set of pointers, so the map
   * asks for none and the names stay against their markers or come off.
   *
   * The level is HANDED DOWN, never guessed at from the markers on screen:
   * the page reads it off the unfiltered child list, so a search box cannot
   * turn a level of Regions into the unit level and make lines appear as
   * somebody types.
   */
  test("label threads are asked for only at the unit level", () => {
    expect(source).toContain(squash("allowLabelThreads: props.isUnitLevel,"));
    // Re-resolved when the level changes, or the names would go stale.
    expect(source).toContain(
      squash("}, [placedMarkers, zoom, props.isUnitLevel]);"),
    );
    // The map is told; it does not decide for itself.
    expect(source).toContain("isUnitLevel: boolean;");
    expect(
      readCode("Components", "NetworkSite", "SiteGeoMap.tsx"),
    ).not.toContain("isUnitLevelFor");
  });

  /*
   * The collision pass reserves a box at an exact offset and hands it back
   * on the placement. A renderer that computed its own offset instead would
   * be free to draw the name somewhere that pass never checked — which is
   * worse than having no collision pass at all, because the overlap would
   * then look deliberate. So the map must draw at marker + offset / zoom and
   * nowhere else, and there must be no second copy of the gap constant here
   * to drift away from the one the pass measured with.
   */
  test("names are drawn at the offset the collision pass reserved", () => {
    expect(source).toContain(
      squash("x={marker.x + labelPlacement.offsetX / zoom}"),
    );
    expect(source).toContain(
      squash("y={marker.y + labelPlacement.offsetY / zoom}"),
    );
    expect(source).toContain(squash("textAnchor={labelPlacement.textAnchor}"));
    // No re-derived geometry: the gap constant is not even imported.
    expect(
      readCode("Components", "NetworkSite", "SiteGeoMap.tsx"),
    ).not.toContain("LABEL_GAP");
  });

  /*
   * The other half of the reservation. The collision pass sizes each box
   * from LABEL_FONT_SIZE and a per-character width measured at weight 600;
   * painting the name lighter or smaller than that is safe, but heavier or
   * larger draws outside the box the pass approved — an overlap that then
   * looks deliberate. The widget suite pins the same two values.
   */
  test("names are painted at the size and weight their box was measured for", () => {
    const labelText: string = source
      .split("textAnchor={labelPlacement.textAnchor}")[1]!
      .split("{marker.label}")[0]!;

    expect(labelText).toContain("fontSize={LABEL_FONT_SIZE / zoom}");
    expect(labelText).toContain("fontWeight={600}");
    // The shared constant or nothing — a second literal is how they drift.
    expect(labelText).not.toContain("fontSize={10");
  });

  /*
   * A name moved off its marker without saying so is the same lie a
   * displaced marker would be. The thread is the whole licence for pushing
   * it — and a name still sitting against its marker must not get one,
   * because a thread nobody can see is ink for nothing.
   */
  test("a pushed name keeps a thread back to its marker", () => {
    /*
     * The thread is a position line like the marker's own anchor thread is,
     * so it answers to the same switch (issue #3432) — but only to that
     * switch. Nothing else here may gate it, or a pushed name goes back to
     * floating unattached.
     */
    expect(source).toContain(
      squash("{layers.positionLines && labelPlacement.leaderLine ? ("),
    );
    expect(source).toContain(
      squash("x1={ marker.x + labelPlacement.leaderLine.x1 / zoom }"),
    );
    expect(source).toContain(
      squash("y2={ marker.y + labelPlacement.leaderLine.y2 / zoom }"),
    );
  });

  /*
   * The key used to say every line on this map was a nudged marker, because
   * every line was. There are two kinds now, so a frame drawing the second
   * one has to say what it is — and a frame drawing none must not.
   */
  test("the label threads get their own key, and only when there are some", () => {
    expect(source).toContain(
      squash("const threadedLabelCount: number = Array.from("),
    );
    expect(source).toContain(squash("return placement.leaderLine !== null;"));
    expect(source).toContain(
      squash("const hasThreadedLabels: boolean = threadedLabelCount > 0;"),
    );
    /*
     * ...and not when the reader has switched off either of the two layers
     * it takes to draw one. A key for ink that is not on screen is the
     * clutter the key exists to prevent.
     */
    expect(source).toContain(
      squash("{layers.names && layers.positionLines && hasThreadedLabels ? ("),
    );
    expect(source).toContain('data-testid="site-geo-map-label-thread-key"');
  });

  /*
   * A marker moved off its coordinates without saying so is a map that
   * lies. The line back to the anchor is the whole reason the displacement
   * is allowed at all.
   */
  test("a displaced marker keeps a leader line to where it really is", () => {
    const leaders: string = source
      .split('data-testid="site-geo-map-position-lines"')[1]!
      .split("</g>")[0]!;
    expect(leaders).toContain("return marker.needsLeaderLine;");
    expect(leaders).toContain("x1={marker.anchorX}");
    expect(leaders).toContain("y1={marker.anchorY}");
    expect(leaders).toContain("x2={marker.x}");
    expect(leaders).toContain("y2={marker.y}");
  });

  test("the leader lines are explained, and only when there are some", () => {
    expect(source).toContain(
      squash("const nudgedMarkerCount: number = placedMarkers.filter("),
    );
    expect(source).toContain(
      squash("const hasNudgedMarkers: boolean = nudgedMarkerCount > 0;"),
    );
    expect(source).toContain(
      squash("{layers.positionLines && hasNudgedMarkers ? ("),
    );
    expect(source).toContain('data-testid="site-geo-map-nudged-key"');
  });

  /*
   * The square, the box a label has to clear and the circle the layout keeps
   * clear around a container are three views of ONE shape. A second literal
   * here is how they drift apart.
   */
  test("the container square is drawn from the shared factor", () => {
    expect(source).toContain(
      "const side: number = radius * CONTAINER_SIDE_FACTOR;",
    );
    expect(
      readCode("Components", "NetworkSite", "SiteGeoMap.tsx"),
    ).not.toContain("* 1.78");
  });
});

/*
 * A map of where the sites are is only half a network. The links between
 * them — the WAN links, the fibre pairs — were drawn on the child graph and
 * listed as chips under the map, and nowhere on the map itself, so the one
 * view that shows the whole estate showed none of its connections.
 *
 * The rule that has to survive every future edit is the negative one: a
 * link with NO monitor attached is still a line. The monitor decides the
 * line's color, never whether the connection exists. Everything pinned here
 * is one half of that.
 */
describe("SiteGeoMap draws the site links", () => {
  const source: string = readSource(
    "Components",
    "NetworkSite",
    "SiteGeoMap.tsx",
  );
  const code: string = readCode("Components", "NetworkSite", "SiteGeoMap.tsx");

  test("the map takes links and turns them into lines", () => {
    expect(source).toContain("links: Array<MapLinkView>;");
    expect(source).toContain(
      squash("buildMapLinks({ links: props.links, markers: placedMarkers,"),
    );
    expect(source).toContain('data-testid="site-geo-map-links"');
    expect(source).toContain("const path: string = mapLinkPath(link);");
  });

  /*
   * Lines are built from the PLACED markers, at the drawn positions. A line
   * to a marker's projected position ends in empty space next to the marker
   * it names, because layoutMapMarkers pushes overlapping markers off each
   * other and leaves an anchor behind.
   */
  test("the lines are built from the drawn marker positions", () => {
    expect(source).toContain("markers: placedMarkers,");
    expect(source).not.toContain(
      squash("buildMapLinks({ links: props.links, markers: markers,"),
    );
  });

  /*
   * Bows keep parallel links apart by a SCREEN distance, so the zoom is an
   * input. Drop it from the memo dependencies and two links between the
   * same pair drift together (or apart) as the map is zoomed.
   */
  test("the lines are rebuilt with the zoom", () => {
    const memo: string = source
      .split("const linkLines: Array<DrawableMapLink> = useMemo(")[1]!
      .split("]);")[0]!;
    expect(memo).toContain("zoom: zoom,");
    expect(memo).toContain("[props.links, placedMarkers, zoom");
  });

  /*
   * THE requirement, in the renderer: nothing here may condition a line on
   * a monitor being attached. An unmonitored link is dashed and neutral —
   * present, and honest about why it has no color.
   */
  test("a link with no monitor is dashed, never dropped", () => {
    expect(source).toContain(
      squash("link.hasMonitor ? undefined : `${5 / zoom} ${4 / zoom}`"),
    );
    // No filter, anywhere, on whether a link carries a status.
    expect(code).not.toContain("link.monitorStatus ?");
    expect(code).not.toContain("linkLines.filter(");
  });

  test("every line is colored by its own link", () => {
    expect(source).toContain("stroke={link.color}");
  });

  /*
   * Under the markers, in paint order. A line crossing over the marker it
   * ends at reads as a line passing THROUGH that site rather than
   * terminating there.
   */
  test("the lines are painted under the markers", () => {
    expect(source.indexOf('data-testid="site-geo-map-links"')).toBeLessThan(
      source.indexOf("placedMarkers.map((marker: PlacedMapMarker)"),
    );
  });

  /*
   * A 2px line is unhoverable in practice, and the name of a link is the
   * whole reason to hover one.
   */
  test("each line carries a hit area and a name", () => {
    expect(source).toContain('stroke="transparent"');
    expect(source).toContain("<title>{link.tooltip}</title>");
    expect(source).toContain("tooltip: link.tooltip,");
    /*
     * And it names the line it belongs to. Without the key the hover card
     * would appear and nothing on the map would light up — the emphasis is
     * keyed on what is under the pointer, not on where it is.
     */
    expect(source).toContain("linkKey: link.key,");
  });

  test("the lines are explained, and only when there are some", () => {
    expect(source).toContain(
      squash(
        "const hasDrawnLinks: boolean = layers.links && linkLines.length > 0;",
      ),
    );
    expect(source).toContain(squash("{hasDrawnLinks ? ("));
    expect(source).toContain('data-testid="site-geo-map-link-key"');
    expect(source).toContain(
      "Site link — colored by its monitor; dashed when it has none",
    );
  });

  /*
   * Issue #3025: "site links only visible when zoomed out, disappear when
   * zoomed in". What that reported was the marker LEADER THREADS, which
   * correctly melt away as zoom pulls the markers apart — there were no
   * link lines on the map at all. Now that there are, they must never
   * acquire a zoom condition of their own.
   *
   * The ONE gate they are allowed is the reader's own layer switch (issue
   * #3432), which is a choice rather than a rule the map made up. Weight is
   * not a gate: a line the map has calmed down is still drawn, and still
   * hoverable — that is the whole difference between an ink hierarchy and
   * hiding things.
   */
  test("the lines are drawn at every zoom, gated only on the reader's switch", () => {
    expect(code).toContain(
      '</g> { } {layers.links ? ( <g data-testid="site-geo-map-links"> {linkLines.map(',
    );
    // Up to the position-line group, which is the next layer on the map.
    const group: string = code
      .split('data-testid="site-geo-map-links"')[1]!
      .split("{ } {layers.positionLines ? (")[0]!;
    expect(group).not.toMatch(/zoom\s*[<>]/);
    expect(group).not.toContain("MAX_ZOOM");
    expect(group).not.toContain("needsDetail");
    expect(group).not.toContain("needsLeaderLine");
    // The hit area is never quietened — a calm line is still a target.
    expect(group).toContain('stroke="transparent" strokeWidth={12 / zoom}');
  });

  /*
   * And the set of lines is decided by the markers, never by the frame: a
   * viewport dependency here would drop links as the reader panned.
   */
  test("which lines exist does not depend on the viewport", () => {
    const memo: string = code
      .split("const linkLines: Array<DrawableMapLink> = useMemo(")[1]!
      .split("]);")[0]!;
    expect(memo).not.toContain("viewport");
    expect(memo).not.toContain("countPointsInViewport");
  });
});

/*
 * State and province lines. A country outline is the whole map when you are
 * looking at the world and an empty field once you have zoomed into one
 * country — a marker in the middle of the United States or India has nothing
 * to be located against. These are that missing reference frame.
 *
 * Everything below is about keeping them a BACKDROP. The failure modes are
 * all quiet ones: lines that swallow a click meant for a marker, lines as
 * heavy as the borders they sit inside, lines drawn over the coarse outlines
 * they do not match, or 111 KB fetched by every viewer who never zooms.
 */
describe("SiteGeoMap draws the state and province lines", () => {
  const source: string = readSource(
    "Components",
    "NetworkSite",
    "SiteGeoMap.tsx",
  );
  const code: string = readCode("Components", "NetworkSite", "SiteGeoMap.tsx");

  test("the lines are fetched only once the map is zoomed in", () => {
    expect(source).toContain(
      "const needsSubdivisions: boolean = shouldUseSubdivisionGeometry(viewport);",
    );
    expect(source).toContain(
      squash("if (!needsSubdivisions || subdivisionFeatures) { return; }"),
    );
    expect(source).toContain('loadGeometryFeatures("subdivisions")');
  });

  /*
   * The lines come from the same 1:50m source as the DETAIL outlines. Drawn
   * over the coarse overview outlines — the window while the detail tier is
   * still in flight — a state line ends up crossing the coastline it is
   * supposed to stop on.
   */
  test("the lines wait for the outlines they belong inside", () => {
    expect(source).toContain(
      squash(
        "const subdivisions: Array<GeometryFeature> = needsSubdivisions && isDrawingDetail && subdivisionFeatures ? subdivisionFeatures : [];",
      ),
    );
  });

  /*
   * These paths are the boundaries INTERIOR to a country: open polylines
   * between junctions, not closed shapes. Fill them and the map floods with
   * wedges.
   */
  test("the lines are stroked, never filled", () => {
    const layer: string = source
      .split('data-testid="site-geo-map-subdivisions"')[1]!
      .split("</g>")[0]!;
    expect(layer).toContain('fill="none"');
  });

  /*
   * Second level of a reference frame, not a second set of countries: below
   * the country outline's own stroke weight and opacity, or the borders that
   * matter stop being the ones that read.
   */
  test("the lines are quieter than the country borders they sit inside", () => {
    expect(source).toContain("strokeWidth={0.4 / zoom}");
    expect(source).toContain("strokeOpacity={0.55}");

    const outlineWidth: number = 0.6;
    const outlineOpacity: number = 0.8;
    expect(0.4).toBeLessThan(outlineWidth);
    expect(0.55).toBeLessThan(outlineOpacity);
  });

  /*
   * Divided by the zoom, like every other stroke on this map. A line that
   * scaled with the map would be a hairline at the zoom it appears at and a
   * grey band at the zoom somebody uses to tell two sites apart.
   */
  test("the lines stay the same weight on screen at every zoom", () => {
    const layer: string = code
      .split('data-testid="site-geo-map-subdivisions"')[1]!
      .split("</g>")[0]!;
    expect(layer).toContain("/ zoom");
    expect(layer).not.toMatch(/strokeWidth=\{[\d.]+\}/);
  });

  /*
   * Paint order: over the land, under the links and the markers. A border
   * drawn on top of a marker reads as a line through that site.
   */
  test("the lines are painted over the land and under everything else", () => {
    const land: number = source.indexOf("{(features || []).map(");
    const lines: number = source.indexOf(
      'data-testid="site-geo-map-subdivisions"',
    );
    const links: number = source.indexOf('data-testid="site-geo-map-links"');
    const markers: number = source.indexOf(
      "placedMarkers.map((marker: PlacedMapMarker)",
    );

    expect(land).toBeGreaterThan(-1);
    expect(lines).toBeGreaterThan(land);
    expect(links).toBeGreaterThan(lines);
    expect(markers).toBeGreaterThan(links);
  });

  /*
   * Decoration, and inert. A state line that took a click would swallow the
   * drill-in on the marker under the pointer, and a <title> on it would put
   * "India" in front of somebody hovering their own site.
   */
  test("the lines cannot be hovered, clicked or read out", () => {
    const layer: string = source
      .split('data-testid="site-geo-map-subdivisions"')[1]!
      .split("</g>")[0]!;
    expect(layer).toContain('aria-hidden="true"');
    expect(layer).toContain('pointerEvents: "none"');
    expect(layer).not.toContain("<title>");
    expect(layer).not.toContain("onClick");
  });

  /*
   * Backdrop, not data — the same call the outlines make. A failed chunk
   * fetch must leave the markers on the map rather than take the map down
   * with it.
   */
  test("a failed fetch still leaves a map", () => {
    const effect: string = code
      .split('loadGeometryFeatures("subdivisions")')[1]!
      .split("}, [needsSubdivisions")[0]!;
    expect(effect).toContain(".catch(() => {");
    expect(effect).not.toContain("setError");
    expect(effect).not.toContain("throw");
  });
});

/*
 * The map's links come from the MAP endpoint, not from the child graph's:
 * in "all" mode the markers are individual sites rather than this level's
 * children, so the two endpoints answer with different link sets. Handing
 * the graph's list to the map would silently draw nothing in that mode.
 */
describe("NetworkMap hands the map its own links", () => {
  const source: string = readSource("Pages", "NetworkSite", "NetworkMap.tsx");

  test("the map's links come from the map payload", () => {
    expect(source).toContain(
      squash(
        "const mapLinks: Array<MapLinkView> = filterLinksByVisibleSites( filterLinksBySearch( mapData?.links || [], normalizedSearch, siteIdSet(pinnedSites), ), siteIdSet(pinnedSites), healthFilterMode, );",
      ),
    );
    expect(source).toContain("links={mapLinks}");
  });

  /*
   * Narrowed through the same predicate as the markers, against the sites
   * still ON the map: the halves of this page must never disagree about
   * what is being looked at, and a line to a site a search has hidden
   * points at nothing.
   */
  test("the lines are narrowed by the same search as everything else", () => {
    expect(source).toContain("siteIdSet(pinnedSites)");
    expect(source).not.toContain("links={mapData?.links");
  });
});

/*
 * Issue #3372. The threads from a name to its marker are drawn only on the
 * deepest level the map reaches — the one whose children are units. Above it
 * they are a web nobody can trace a line through.
 *
 * The page owns that decision because only the page holds the level's
 * UNFILTERED child list. Deriving it inside the map from the markers it was
 * handed would key it off a filtered set: search for the one unit sitting in
 * a level of regions and the lines would appear as you type.
 */
describe("NetworkMap tells the map which level it is on", () => {
  const source: string = readSource("Pages", "NetworkSite", "NetworkMap.tsx");
  const code: string = readCode("Pages", "NetworkSite", "NetworkMap.tsx");

  test("the level's depth is read off the unfiltered child list", () => {
    expect(source).toContain(
      squash("const isUnitLevel: boolean = isUnitLevelFor(allLevelSites);"),
    );
    expect(source).toContain("isUnitLevel={isUnitLevel}");
  });

  /*
   * The same list childTypeLabel comes from, and for the same reason. Both
   * are claims about what a level IS, and neither may move under a filter.
   */
  test("it is the same list the type label comes from", () => {
    expect(source).toContain(
      squash(
        "const childTypeLabel: string = childTypeLabelFor(allLevelSites);",
      ),
    );
    expect(code).not.toContain("isUnitLevelFor(pinnedSites");
    expect(code).not.toContain("isUnitLevelFor(healthyPinnedSites");
    expect(code).not.toContain("isUnitLevelFor(allPinnedSites");
  });

  /*
   * The flag on the type row, never the type's NAME — site types are
   * per-project rows a customer renames at will, and the whole page already
   * decides its unit view the same way.
   */
  test("nothing branches on what the level is called", () => {
    expect(code).not.toContain('=== "Unit"');
    expect(code).not.toContain("siteType === ");
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

/*
 * Issue #3432: "the lines on the Network Map are clutter — give me a switch
 * to hide them."
 *
 * The switch shipped, and it is pinned at the bottom of this block. What is
 * pinned above it is the reason a switch alone would have been the wrong
 * answer.
 *
 * A marker is pushed off its coordinates only because it would otherwise be
 * invisible under another marker, and the thread back to its real spot is
 * the entire licence for that move. A map that hid the threads by default
 * would draw a store twenty pixels from where the customer pinned it with
 * nothing on screen admitting so — decluttered and quietly wrong.
 *
 * So the map got an ink HIERARCHY instead (SiteMapInk.ts, pinned by
 * SiteMapInk.test.ts): a crowded frame draws its threads as hairlines
 * rather than at the same weight as the markers, a frame with two of them
 * is left exactly as it was, and pointing at anything hands its weight
 * straight back while everything unrelated fades. Every assertion here is
 * one wire in that, and each one fails if its line is reverted.
 */
describe("SiteGeoMap calms its ink rather than hiding it", () => {
  const source: string = readSource(
    "Components",
    "NetworkSite",
    "SiteGeoMap.tsx",
  );
  const code: string = readCode("Components", "NetworkSite", "SiteGeoMap.tsx");

  /*
   * The decisions live in the react-free module so they can be unit-tested
   * in a plain Node environment — the same split as the projection, the
   * viewport and the collision layout. A threshold re-derived here would be
   * a threshold nothing tests.
   */
  test("the ink decisions come from the pure module, not from the renderer", () => {
    expect(source).toContain('} from "./SiteMapInk";');
    for (const helper of [
      "planMapInk",
      "markerRole",
      "linkRole",
      "opacityForRole",
      "positionLineInk",
      "labelThreadInk",
      "linkInk",
      "positionAnchorDot",
      "buildMapAdjacency",
    ]) {
      expect([helper, source.includes(helper)]).toEqual([helper, true]);
    }
  });

  /*
   * The plan is fed the counts the map is ACTUALLY drawing. Counting a
   * layer the reader has switched off would let hidden ink calm down the
   * layers still on screen — a map with its links off would draw its two
   * remaining threads as hairlines for no reason anybody could see.
   */
  test("the plan counts what is drawn, not what exists", () => {
    expect(source).toContain(
      squash(
        "const inkPlan: MapInkPlan = planMapInk({ positionLineCount: layers.positionLines ? nudgedMarkerCount : 0, labelThreadCount: layers.positionLines && layers.names ? threadedLabelCount : 0, linkCount: layers.links ? linkLines.length : 0, });",
      ),
    );
  });

  /*
   * Every stroke on the three line layers reads its weight off the ink, and
   * every one of them still divides by the zoom. A literal left behind here
   * is a line that ignores the hierarchy — and the failure is invisible on
   * the calm maps everybody develops against, because there the plan hands
   * back exactly the old numbers.
   */
  test("no line layer carries a hard-coded stroke weight any more", () => {
    const positionLines: string = code
      .split('data-testid="site-geo-map-position-lines"')[1]!
      .split("</g>")[0]!;
    expect(positionLines).toContain("strokeWidth={ink.haloWidth / zoom}");
    expect(positionLines).toContain("strokeWidth={ink.width / zoom}");
    expect(positionLines).not.toMatch(/strokeWidth=\{[\d.]+ \/ zoom\}/);

    const links: string = code
      .split('data-testid="site-geo-map-links"')[1]!
      .split("{ } {layers.positionLines ? (")[0]!;
    expect(links).toContain("strokeWidth={ink.haloWidth / zoom}");
    expect(links).toContain("strokeWidth={ink.width / zoom}");

    // The label thread reads the same way, off its own ink.
    expect(source).toContain("strokeWidth={threadInk.haloWidth / zoom}");
    expect(source).toContain("strokeWidth={threadInk.width / zoom}");
  });

  /*
   * The pip on the end of a position thread is sized from that thread, so
   * it fades with it. A constant here draws a full-strength full stop on
   * the end of a hairline, which reads as a marker of its own.
   */
  test("the anchor dot is sized from its own thread", () => {
    expect(source).toContain(
      squash(
        "const dot: { radius: number; haloRadius: number } = positionAnchorDot(ink);",
      ),
    );
    expect(source).toContain("r={dot.haloRadius / zoom}");
    expect(source).toContain("r={dot.radius / zoom}");
  });

  /*
   * A quiet thread gives up its colour with its weight and takes it back
   * when it is pointed at — decided by the ink, never re-derived here.
   */
  test("a thread's colour follows its ink", () => {
    expect(source).toContain(
      squash(
        "const color: string = ink.isColored ? CLUSTER_COLORS[marker.colorKey] : QUIET_LINE_COLOR;",
      ),
    );
  });

  /*
   * The emphasis is keyed on WHAT is under the pointer, not on where it is.
   * Without the keys on the hover state the card would appear and nothing
   * on the map would light up.
   */
  test("the hover state names the thing it is describing", () => {
    expect(source).toContain("interface HoveredTarget {");
    expect(source).toContain("markerKey: string | null;");
    expect(source).toContain("linkKey: string | null;");
    expect(source).toContain(squash("markerKey: key, linkKey: null,"));
  });

  /*
   * The pointer wins over keyboard focus: a mouse that has moved onto a
   * marker is a more recent statement of intent than a focus ring a tab
   * left behind. Reading focusedKey first would leave the whole map
   * emphasising something nobody is looking at.
   */
  test("the pointer outranks a focus ring left behind by a tab", () => {
    const memo: string = source
      .split("const focus: MapFocus = useMemo(() => {")[1]!
      .split("]);")[0]!;
    expect(memo).toContain(
      squash(
        "if (hovered) { return { markerKey: hovered.markerKey, linkKey: hovered.linkKey }; }",
      ),
    );
    expect(memo.indexOf("hovered")).toBeLessThan(memo.indexOf("focusedKey"));
    // Re-derived when either changes — the split above eats the closing.
    expect(memo).toContain("}, [hovered, focusedKey");
  });

  /*
   * Adjacency is rebuilt with the LINES. Rebuilt with the pointer instead,
   * it would walk every link on the level on every frame of a hover — on
   * the dense estates this feature is for, that is the hover being laggy
   * exactly where it matters most.
   */
  test("who-is-wired-to-whom is computed once per frame, not per pointer move", () => {
    expect(source).toContain(
      squash(
        "const adjacency: MapAdjacency = useMemo(() => { return layers.links ? buildMapAdjacency(linkLines) : EMPTY_MAP_ADJACENCY; }, [linkLines, layers.links]);",
      ),
    );
  });

  /*
   * Fading is how the map answers a question, never a way of taking half of
   * it away. A muted marker keeps its hit area, its tab stop and its
   * accessible name — anything else would make the emphasis a trap for a
   * reader using a keyboard or a screen reader.
   */
  test("the emphasis is opacity and nothing else", () => {
    const markerGroup: string = code
      .split(
        "{placedMarkers.map((marker: PlacedMapMarker): ReactElement => {",
      )[1]!
      .split("onClick=")[0]!;
    expect(markerGroup).toContain('role="button"');
    expect(markerGroup).toContain("tabIndex={0}");
    expect(markerGroup).toContain("aria-label={marker.tooltip}");
    expect(markerGroup).toContain("opacity={opacityForRole(emphasis)}");
    // No display/visibility gate, and no pointer-events opt-out.
    expect(markerGroup).not.toContain("display:");
    expect(markerGroup).not.toContain("visibility");
    expect(markerGroup).not.toContain('pointerEvents: "none"');
  });

  test("every layer that fades also transitions, so a crossed pointer does not flash", () => {
    expect(
      source.split("transition: `opacity ${EMPHASIS_TRANSITION_MS}ms ease`")
        .length - 1,
    ).toBeGreaterThanOrEqual(3);
  });

  /*
   * A thread drawn at a hairline is easy to miss, so somebody who cannot
   * see where a marker really sits has to be told the answer is a hover
   * away rather than gone.
   */
  test("the map says when it has calmed something down", () => {
    expect(source).toContain(
      squash(
        'const isInkCalmed: boolean = inkPlan.positionLines === "quiet" || inkPlan.labelThreads === "quiet" || inkPlan.links === "quiet";',
      ),
    );
    expect(source).toContain('" Hover one to trace what it connects to."');
    expect(source).toContain('" Hover one to see exactly where it sits."');
    expect(source).toContain('data-testid="site-geo-map-hint"');
  });

  /*
   * The tooltip is one " · "-joined line because that is exactly right for
   * the marker's accessible name and exactly wrong for a card, where a
   * twelve-word grey sentence hides the one thing the reader was pointing
   * at the marker to find out.
   */
  test("the hover card leads with the name", () => {
    expect(source).toContain(
      squash(
        'const hoverText: MapTooltipText = splitMapTooltip(hovered?.tooltip || "");',
      ),
    );
    expect(source).toContain('data-testid="site-geo-map-hover-card"');
    expect(source).toContain(squash("{hoverText.title}"));
    expect(source).toContain(squash('{hoverText.detail.join(" · ")}'));
  });
});

/*
 * The switch issue #3432 actually asked for. It is the escape hatch rather
 * than the design — the hierarchy above is what makes the default map
 * readable — but a customer who wants a bare map of dots should have one,
 * and it has to survive a reload and a drill-down or it reads as a control
 * that does not work.
 */
describe("SiteGeoMap lets the reader switch layers off", () => {
  const source: string = readSource(
    "Components",
    "NetworkSite",
    "SiteGeoMap.tsx",
  );

  test("there is a control, and it lists every layer from the shared table", () => {
    expect(source).toContain('data-testid="site-geo-map-layers-toggle"');
    expect(source).toContain('data-testid="site-geo-map-layers-panel"');
    expect(source).toContain(squash("{MAP_LAYER_OPTIONS.map("));
    expect(source).toContain(
      squash("data-testid={`site-geo-map-layer-${option.key}`}"),
    );
    // A switch, so a screen reader is told it is one and which way it is.
    expect(source).toContain(squash('role="switch" aria-checked={isVisible}'));
  });

  /*
   * The choice is about how a reader wants maps to look, not about which
   * level they happen to be on. Held in component state alone it would
   * reset on every drill-down and every reload.
   */
  test("the choice is read from storage on the first render and written back", () => {
    expect(source).toContain(
      squash(
        "const [layers, setLayers] = useState<MapLayerSettings>(readStoredMapLayers);",
      ),
    );
    expect(source).toContain(
      squash(
        "return normalizeMapLayers(LocalStorage.getItem(MAP_LAYERS_STORAGE_KEY));",
      ),
    );
    expect(source).toContain(squash("setLayers(next); storeMapLayers(next);"));
  });

  /*
   * Storage can be unavailable outright — a locked-down browser, a private
   * window with its quota at zero. A map is not worth an exception.
   */
  test("neither the read nor the write can take the map down", () => {
    const read: string = source
      .split("const readStoredMapLayers:")[1]!
      .split("const storeMapLayers:")[0]!;
    expect(read).toContain("try {");
    expect(read).toContain("} catch {");
    const write: string = source
      .split("const storeMapLayers:")[1]!
      .split("const dotColorForSite:")[0]!;
    expect(write).toContain("try {");
    expect(write).toContain("} catch {");
  });

  /*
   * THE thing switching the position lines off must not do. The
   * displacement does not go away with the lines that explain it, so the
   * map says it in words instead — and says how to get the lines back.
   */
  test("hiding the position lines still admits the markers were moved", () => {
    expect(source).toContain(
      squash("{!layers.positionLines && hasNudgedMarkers ? ("),
    );
    expect(source).toContain('data-testid="site-geo-map-nudged-hidden-key"');
    expect(source).toContain("nudged apart to stay visible");
  });

  /*
   * A layer switched off last month and forgotten is a support ticket about
   * missing data. The control carries a dot while anything is hidden, so
   * the map says so without being opened.
   */
  test("the control says when something is hidden", () => {
    expect(source).toContain(
      squash("const hiddenLayerCount: number = countHiddenMapLayers(layers);"),
    );
    expect(source).toContain(squash("{hiddenLayerCount > 0 ? ("));
    expect(source).toContain('data-testid="site-geo-map-layers-hidden-dot"');
  });

  /*
   * The panel floats over the map it is about, so touching the map has to
   * dismiss it — otherwise it sits over the markers somebody just dragged
   * into view and they have to go back and close it.
   */
  test("touching the map dismisses the panel", () => {
    const down: string = source
      .split("const onPointerDown:")[1]!
      .split("const onPointerMove:")[0]!;
    expect(down).toContain("setIsLayerPanelOpen(false);");
    const change: string = source
      .split(
        "const changeViewport: (next: MapViewport) => void = useCallback(",
      )[1]!
      .split("[],")[0]!;
    expect(change).toContain("setIsLayerPanelOpen(false);");
  });
});
