import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Network Map widget's renderer is a React component, and the App suite
 * runs in a plain Node environment with no renderer — so the invariants that
 * cannot be expressed against NetworkMapWidgetData (which is pure and tested
 * directly) are pinned against the source, the same way
 * NetworkSitePageInvariants pins the Network Site pages.
 *
 * Every assertion here corresponds to something that would ship broken and
 * look fine: a widget that renders nowhere, a column that is about to be
 * dropped from the schema, an unbounded fetch, or a public dashboard that
 * silently serves data no widget on it displays.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");

const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readApp(...relativeParts: Array<string>): string {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

function readCommon(...relativeParts: Array<string>): string {
  return squash(
    fs.readFileSync(path.join(COMMON_ROOT, ...relativeParts), "utf8"),
  );
}

/*
 * The same source with its comments removed. An assertion that a piece of
 * code is ABSENT has to read the code, not the commentary — the comment
 * explaining why role="img" is wrong would otherwise fail the very test
 * that checks it is gone.
 */
function readAppCode(...relativeParts: Array<string>): string {
  const raw: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativeParts),
    "utf8",
  );
  return squash(
    raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " "),
  );
}

const WIDGET: Array<string> = [
  "Components",
  "Dashboard",
  "Components",
  "DashboardNetworkMapComponent.tsx",
];

describe("Network Map widget wiring", () => {
  /*
   * Four registries have to agree or the widget is unreachable, and NONE of
   * them is a compile error: the enum member, the settings-argument
   * registry, the "add widget" factory switch, and the render dispatch. A
   * missing render branch in particular fails silently — the widget adds
   * fine and draws a blank card.
   */
  test("the component type is declared once in the shared enum", () => {
    expect(
      readCommon("Types", "Dashboard", "DashboardComponentType.ts"),
    ).toContain("NetworkMap = `NetworkMap`");
  });

  test("the settings registry resolves the widget instead of throwing", () => {
    const source: string = readCommon(
      "Utils",
      "Dashboard",
      "Components",
      "Index.ts",
    );

    expect(source).toContain(
      "if (dashboardComponentType === DashboardComponentType.NetworkMap)",
    );
    expect(source).toContain(
      "DashboardNetworkMapComponentUtil.getComponentConfigArguments()",
    );
  });

  test("the toolbar knows how to create one", () => {
    const source: string = readApp(
      "Components",
      "Dashboard",
      "DashboardView.tsx",
    );

    expect(source).toContain(
      "if (componentType === DashboardComponentType.NetworkMap)",
    );
    expect(source).toContain(
      "DashboardNetworkMapComponentUtil.getDefaultComponent()",
    );
  });

  test("the canvas actually renders one", () => {
    const source: string = readApp(
      "Components",
      "Dashboard",
      "Components",
      "DashboardBaseComponent.tsx",
    );

    expect(source).toContain(
      "[DashboardComponentType.NetworkMap]: DashboardNetworkMapComponent,",
    );
    // The registry is only reachable if the canvas still dispatches through it.
    expect(source).toContain("WIDGET_BY_TYPE[component.componentType]");
  });

  test("the widget picker lists it under Network in Infrastructure", () => {
    const source: string = readApp(
      "Components",
      "Dashboard",
      "Toolbar",
      "WidgetCatalog.ts",
    );

    expect(source).toContain(
      'name: "Network", group: WidgetCategoryGroup.Infrastructure',
    );
    expect(source).toContain("type: DashboardComponentType.NetworkMap");
  });
});

describe("Network Map widget data access", () => {
  /*
   * NetworkSite.siteType is DEPRECATED — the pre-lookup-table string kept
   * only so the BackfillNetworkSiteTypes migration can read it, and dropped
   * in a follow-up PR. Reading it here compiles and works today and goes
   * blank the day the column is removed, on BOTH the private and the public
   * path. The type NAME lives on the networkSiteType relation.
   */
  test("reads the site type from the relation, never from the deprecated column", () => {
    const widget: string = readAppCode(...WIDGET);

    expect(widget).toContain("networkSiteType: { name: true, }");
    expect(widget).toContain("row.networkSiteType?.name");
    expect(widget).not.toContain("siteType: true");
    expect(widget).not.toContain("row.siteType");
  });

  test("the public dashboard proxy reads the relation too", () => {
    const policy: string = readCommon(
      "Server",
      "Utils",
      "Dashboard",
      "PublicDashboardResourceListPolicy.ts",
    );
    const entry: string =
      policy
        .split("case DashboardComponentType.NetworkMap:")[1]
        ?.split("case DashboardComponentType.HostList:")[0] || "";

    expect(entry.length).toBeGreaterThan(0);
    expect(entry).toContain("networkSiteType: { name: true }");
    expect(entry).not.toContain("siteType: true");
  });

  /*
   * "Down" has to mean whatever THIS project marked as a non-operational
   * state. Filtering on a hardcoded status id or name would be wrong in any
   * project that renamed its statuses.
   */
  test("filters by the joined operational flag rather than a hardcoded status", () => {
    const widget: string = readApp(...WIDGET);

    expect(widget).toContain(
      '(query as Record<string, unknown>)["currentMonitorStatus"] = { isOperationalState: false, };',
    );
    expect(widget).toContain(
      '(query as Record<string, unknown>)["currentMonitorStatus"] = { isOperationalState: true, };',
    );
  });

  /*
   * A map is only readable while its markers can be told apart, and the
   * fetch is a plain list query. An unbounded limit on a large estate is a
   * slow endpoint AND an unreadable tile.
   */
  /*
   * The cap is asked for PLUS ONE and the extra row dropped before drawing.
   * Requesting exactly the cap makes "a project with exactly 250 sites"
   * indistinguishable from "a project with 2,000" — both come back full —
   * and the widget would then tell the first one that sites are hidden from
   * it.
   */
  test("caps the fetch, and can tell a full page from a truncated one", () => {
    const widget: string = readApp(...WIDGET);

    expect(widget).toContain("limit: maxSites + 1,");
    expect(widget).toContain("rows: listResult.data.slice(0, maxSites),");
    expect(widget).toContain("isTruncated: listResult.data.length > maxSites,");
  });

  /*
   * The settings form stores a number field's value as a STRING, so a
   * widget that type-tests it silently ignores whatever the user typed. The
   * coercion lives in the view model where it is unit-tested.
   */
  test("coerces the Max Sites setting instead of type-testing it", () => {
    const widget: string = readAppCode(...WIDGET);

    expect(widget).toContain("resolveNetworkMapMaxSites(");
    expect(widget).not.toContain('typeof args.maxSites === "number"');
  });

  /*
   * The widget must go through the public-dashboard proxy, and the resource
   * key it names must exist on both sides — the client union and the server
   * registry. A mismatch is a runtime "Unsupported dashboard resource type".
   */
  test("routes through the public-dashboard resource proxy under a registered key", () => {
    const widget: string = readApp(...WIDGET);

    expect(widget).toContain("DashboardResourceList.getRequestOptions(");
    expect(widget).toContain(
      '"network-site", { componentId: props.componentId, variables: props.variables, }',
    );
    expect(
      readApp("Components", "Dashboard", "Utils", "DashboardResourceList.ts"),
    ).toContain('| "network-site"');
    expect(readCommon("Server", "API", "DashboardAPI.ts")).toContain(
      '"network-site": {',
    );
  });

  test("the server pins that resource to the Network Map widget alone", () => {
    const api: string = readCommon("Server", "API", "DashboardAPI.ts");
    const entry: string =
      api.split('"network-site": {')[1]?.split("}, host:")[0] || "";

    expect(entry).toContain(
      "widgets: { [DashboardComponentType.NetworkMap]: null, }",
    );
  });

  /*
   * The server rebuilds the query from the exact stored Network Map widget.
   * The map draws a FLAT set of pins, so the tree shape (parentSiteId /
   * materializedPath / depth) must not enter that server-owned policy — it is
   * structure the map never shows.
   */
  test("the public endpoint exposes no filter the map does not use", () => {
    const policy: string = readCommon(
      "Server",
      "Utils",
      "Dashboard",
      "PublicDashboardResourceListPolicy.ts",
    );
    const entry: string =
      policy
        .split("private static buildNetworkMapPolicy(")[1]
        ?.split("private static buildHostPolicy(")[0] || "";

    expect(entry).toContain('queryKey: "networkSiteTypeId"');
    expect(entry).toContain('query["currentMonitorStatus"]');

    for (const forbidden of [
      "parentSiteId",
      "materializedPath",
      "depth",
      "address",
      "slug",
    ]) {
      expect(entry).not.toContain(`"${forbidden}"`);
    }
  });

  /*
   * Coordinates and a status are the only things a public viewer gets. An
   * address or a description on a site is business data the map never draws.
   */
  test("the public select is limited to what the map actually paints", () => {
    const policy: string = readCommon(
      "Server",
      "Utils",
      "Dashboard",
      "PublicDashboardResourceListPolicy.ts",
    );
    const entry: string =
      policy
        .split("case DashboardComponentType.NetworkMap:")[1]
        ?.split("case DashboardComponentType.HostList:")[0] || "";

    for (const forbidden of [
      "address:",
      "description:",
      "slug:",
      "materializedPath:",
    ]) {
      expect(entry).not.toContain(forbidden);
    }
  });
});

describe("Network Map widget rendering", () => {
  /*
   * Every decision the map makes about geometry, clustering and color lives
   * in the react-free view model, which is where it can be tested. A
   * renderer that starts projecting or clustering inline is a renderer whose
   * behaviour nothing covers.
   */
  test("keeps every geometry and color decision in the pure view model", () => {
    const widget: string = readApp(...WIDGET);

    expect(widget).toContain("./NetworkMapWidgetData");
    expect(widget).toContain("buildNetworkMapMarkers");
    expect(widget).toContain("fitNetworkMapViewport");
    // No projection, clustering or palette arithmetic in the component.
    expect(widget).not.toContain("projectRobinson");
    expect(widget).not.toContain("clusterPoints");
    expect(widget).not.toContain("decideClusterColorKey");
  });

  /*
   * A red dot two pixels across on a map of two hundred green ones is not
   * information anybody reads. The count above the map is what makes an
   * outage legible at dashboard distance.
   */
  test("prints the number of sites down above the map, not just colors them", () => {
    const widget: string = readApp(...WIDGET);

    expect(widget).toContain("networkMapStatusSummary");
    expect(widget).toContain("summary.down > 0");
    expect(widget).toContain('data-testid="network-map-widget-summary"');
  });

  test("prints a coverage line that admits what the map is not showing", () => {
    const widget: string = readApp(...WIDGET);

    expect(widget).toContain("describeNetworkMapCoverage");
    expect(widget).toContain("unplacedCount: parsed.unplacedCount");
    expect(widget).toContain("isTruncated: fetched.isTruncated");
    expect(widget).toContain('data-testid="network-map-widget-coverage"');
  });

  /*
   * `role="img"` on an SVG hides its whole subtree from assistive
   * technology. The markers inside are focusable buttons, so it would make
   * every one of them unreachable.
   */
  test("does not hide its focusable markers behind role=img", () => {
    const widget: string = readAppCode(...WIDGET);

    expect(widget).not.toContain('role="img"');
    expect(widget).toContain('role="group"');
  });

  test("makes a single-site marker keyboard-activatable, and a cluster not", () => {
    const widget: string = readApp(...WIDGET);

    expect(widget).toContain(
      "if (marker.ids.length !== 1) { return undefined; }",
    );
    expect(widget).toContain('event.key === "Enter" || event.key === " "');
    expect(widget).toContain('role={route ? "button" : undefined}');
  });

  /*
   * Markers, strokes and label text are UI, not geography: sized in screen
   * units so zooming the frame does not just produce bigger blobs.
   */
  test("sizes markers and strokes against the zoom, not the world", () => {
    const widget: string = readApp(...WIDGET);

    expect(widget).toContain("const zoom: number = zoomOfViewport(viewport);");
    expect(widget).toContain("marker.screenRadius / zoom");
    expect(widget).toContain("strokeWidth={0.6 / zoom}");
  });

  /*
   * The collision pass reserves a box for each name at an exact offset and
   * hands it back on the placement. A renderer that re-derived that offset
   * would be free to paint the name somewhere the pass never checked, and
   * the overlap it produced would look deliberate. So the widget draws at
   * marker + offset / zoom, and it no longer carries a gap constant of its
   * own to drift from the one the pass measured with.
   */
  test("names are drawn at the offset the collision pass reserved", () => {
    const widget: string = readApp(...WIDGET);

    expect(widget).toContain(
      squash("x={marker.x + marker.labelPlacement.offsetX / zoom}"),
    );
    expect(widget).toContain(
      squash("y={marker.y + marker.labelPlacement.offsetY / zoom}"),
    );
    expect(widget).toContain(
      squash("textAnchor={marker.labelPlacement.textAnchor}"),
    );
    expect(readAppCode(...WIDGET)).not.toContain("LABEL_GAP");
  });

  /*
   * The collision pass reserves each name a box built from LABEL_FONT_SIZE
   * and a per-character width measured at weight 600. Painting the name
   * LIGHTER or SMALLER than that is safe — the box was simply bigger than it
   * needed to be. Painting it heavier or larger draws outside the box the
   * pass approved, and an overlap the pass approved reads as deliberate
   * rather than crowded. So this pins the two values that are not free.
   *
   * The widget ran at the browser default of 400 for a while. That was safe,
   * but it also meant the same element rendered differently on the two maps,
   * and this map paints BELOW LABEL_FONT_SIZE — it squeezes the world into a
   * tile — which is exactly where a 400 greys out.
   */
  test("names are painted at the size and weight their box was measured for", () => {
    const labelText: string = readApp(...WIDGET)
      .split("textAnchor={marker.labelPlacement.textAnchor}")[1]!
      .split("{marker.label}")[0]!;

    expect(labelText).toContain(
      "fontSize={NETWORK_MAP_LABEL_FONT_SIZE / zoom}",
    );
    expect(labelText).toContain("fontWeight={600}");
    // The shared constant or nothing — a second literal is how they drift.
    expect(labelText).not.toContain("fontSize={10");
  });

  /*
   * Sites on near-identical coordinates used to lose every name but the
   * first: there was nowhere to put the others that was clear of the
   * neighbours. They are now pushed off their marker instead, which is only
   * honest while each one keeps a thread back to the marker it names.
   */
  test("a name pushed off its marker keeps a thread back to it", () => {
    const widget: string = readApp(...WIDGET);

    expect(widget).toContain(squash("{marker.labelPlacement.leaderLine ? ("));
    expect(widget).toContain(
      squash("x1={ marker.x + marker.labelPlacement.leaderLine.x1 / zoom }"),
    );
    expect(widget).toContain(
      squash("y2={ marker.y + marker.labelPlacement.leaderLine.y2 / zoom }"),
    );
  });

  /*
   * The outlines are the backdrop; the markers are the subject. A failed
   * geometry fetch must cost the reader a coastline, not the whole widget.
   */
  test("still draws the pins when the outlines fail to load", () => {
    const widget: string = readApp(...WIDGET);

    expect(widget).toContain("setFeatures([]);");
    expect(widget).toContain("(features || []).map(");
  });

  test("offers the same empty-state copy in both view modes", () => {
    const widget: string = readApp(...WIDGET);

    expect(widget).toContain("const EMPTY_MESSAGE: string =");
    // Once as the list widget's prop, once in the map's own empty panel.
    expect(widget.split("EMPTY_MESSAGE").length - 1).toBeGreaterThanOrEqual(3);
  });
});
