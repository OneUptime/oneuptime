import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3261: the health filter is a chain — a pure module decides what
 * is unhealthy, a view model removes and dims accordingly, a shared chip
 * group offers the choice, and two pages hold the state. Every link of it
 * is unit-tested except the wiring, and a filter that is computed
 * perfectly and never passed to the graph is a feature that does nothing.
 *
 * None of this is expressible as a type — a page can hold the state and
 * simply not hand it down — and the App suite runs in a plain Node
 * environment (App/jest.config.json sets testEnvironment: "node"), so
 * there is no renderer to ask. The wiring is therefore pinned against the
 * sources, the same way NetworkTopologyPanelLayering pins the panel's
 * z-index relationships.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Comments are stripped before anything is matched: several of these files
 * explain the filter in prose, and an assertion about the code has to read
 * the code rather than the commentary describing it.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

/*
 * Collapse runs of whitespace so an assertion survives prettier deciding
 * an import or a call fits on one line this week and three the next. The
 * claims below are about what the code DOES, and none of them is a claim
 * about where the line breaks fall.
 */
function flatten(source: string): string {
  return source.replace(/\s+/g, " ");
}

const LIVE_VIEW: string = readSource(
  "Components",
  "Topology",
  "NetworkTopologyLiveView.tsx",
);
const GRAPH: string = readSource(
  "Components",
  "Topology",
  "NetworkDeviceGraph.tsx",
);
const VIEW_MODEL: string = readSource(
  "Components",
  "Topology",
  "NetworkTopologyViewModel.ts",
);
const NETWORK_MAP: string = readSource(
  "Pages",
  "NetworkSite",
  "NetworkMap.tsx",
);
const SITE_GRAPH: string = readSource(
  "Components",
  "NetworkSite",
  "SiteContainerGraph.tsx",
);
const GEO_MAP: string = readSource(
  "Components",
  "NetworkSite",
  "SiteGeoMap.tsx",
);
const CHIP_GROUP: string = readSource(
  "Components",
  "Filters",
  "StatusChipGroup.tsx",
);

describe("the device topology's health filter is wired end to end", () => {
  test("the live view owns the filter state", () => {
    expect(LIVE_VIEW).toContain("useState<TopologyHealthFilterMode>");
  });

  test("it opens unfiltered", () => {
    /*
     * A map that hid two thirds of the network before anybody asked it to
     * would be a different feature.
     */
    expect(flatten(LIVE_VIEW)).toContain(
      'useState<TopologyHealthFilterMode>("all")',
    );
  });

  test("the live view renders the shared chip group for it", () => {
    expect(flatten(LIVE_VIEW)).toContain(
      'import StatusChipGroup, { StatusChipOption } from "../Filters/StatusChipGroup";',
    );
    expect(LIVE_VIEW).toContain('dataTestId="network-topology-health-filter"');
  });

  test("the chips are built from the pure options builder, not hand-rolled", () => {
    expect(LIVE_VIEW).toContain("buildHealthFilterOptions(healthSummary)");
  });

  test("the counts are summarised AFTER the VLAN and kind filters", () => {
    /*
     * A chip claiming "3 down" over a map showing none of them is worse
     * than no chip at all, so the summary reads visibleTopology (post
     * VLAN) narrowed by the kind filter — never topology.nodes.
     */
    expect(LIVE_VIEW).toContain("summarizeTopologyHealth(");
    expect(flatten(LIVE_VIEW)).toContain(
      "summarizeTopologyHealth( visibleTopology.nodes.filter(",
    );
    expect(LIVE_VIEW).toContain("effectiveVisibleKinds.has(kindOfNode(node))");
  });

  test("the mode reaches the graph", () => {
    expect(LIVE_VIEW).toContain("healthFilterMode={healthFilterMode}");
  });

  test("the graph reaches the view model", () => {
    expect(flatten(GRAPH)).toContain(
      "healthFilterMode: props.healthFilterMode",
    );
  });

  test("the graph re-renders when the mode changes", () => {
    /*
     * The view model is memoised. Leaving the mode out of the dependency
     * list would mean pressing a chip changed nothing until something
     * else happened to invalidate the memo.
     */
    const memoDeps: RegExpMatchArray | null = flatten(GRAPH).match(
      /const viewModel: TopologyViewModel = useMemo\(\(\) => \{.*?\}, \[(.*?)\]\);/,
    );
    expect(memoDeps).not.toBeNull();
    expect(memoDeps![1]).toContain("props.healthFilterMode");
  });

  test("the view model asks the pure module rather than deciding itself", () => {
    expect(VIEW_MODEL).toContain("resolveHealthVisibility({");
    expect(VIEW_MODEL).toContain("isHealthFilterActive(");
  });

  test("the kind filter constrains the health filter, not the other way round", () => {
    /*
     * eligibleNodeIds is built from the KIND-filtered set, which is what
     * stops a health filter resurrecting a node type the user switched
     * off.
     */
    expect(flatten(VIEW_MODEL)).toContain(
      "eligibleNodeIds: Set<string> = new Set<string>( visibleNodes.map(",
    );
    expect(VIEW_MODEL).toContain("eligibleNodeIds: eligibleNodeIds");
  });

  test("the graph rings the matches only while a filter is on", () => {
    /*
     * A permanent ring around every unhealthy device would be a second
     * status encoding competing with the node's fill colour.
     */
    expect(flatten(GRAPH)).toContain(
      "viewModel.isHealthFilterActive && nodeView.isHealthMatch",
    );
    expect(GRAPH).toContain("HEALTH_STATE_COLORS[nodeView.health]");
  });

  test("asking what is broken re-frames the map onto the answer", () => {
    /*
     * The coordinates deliberately do not move when the filter changes —
     * that is what stops a toggle reshuffling the map — so the only thing
     * that CAN move is the camera. Without both halves of this (dropping
     * the user-framed flag, and the mode being a fit dependency in its own
     * right) a reader zoomed into one rack presses "Needs attention" and
     * is shown an empty corner.
     */
    const flatGraph: string = flatten(GRAPH);
    expect(flatGraph).toContain(
      "hasUserAdjustedView.current = false; }, [props.healthFilterMode]);",
    );
    const fitDeps: RegExpMatchArray | null = flatGraph.match(
      /if \(hasUserAdjustedView\.current \|\| viewModel\.nodes\.length === 0\) \{ return; \} fitToGraph\(\); \}, \[(.*?)\]\);/,
    );
    expect(fitDeps).not.toBeNull();
    expect(fitDeps![1]).toContain("props.healthFilterMode");
  });

  test("an empty canvas under a health filter reads as good news", () => {
    expect(GRAPH).toContain("Nothing needs attention right now");
    // ...and the old wording survives for the filters that are not health.
    expect(GRAPH).toContain("No devices match your filters");
  });

  test("but only when health is genuinely what emptied it", () => {
    /*
     * Switching every node type off also empties the canvas. Congratulating
     * somebody on a healthy network then, over an instruction to press
     * "All" on a control that is not the one they touched, is worse than
     * the generic message.
     */
    expect(flatten(GRAPH)).toContain(
      "viewModel.isHealthFilterActive && viewModel.kindFilteredNodeCount > 0",
    );
  });
});

describe("the site map's health filter is wired end to end", () => {
  test("the page owns the filter state and opens unfiltered", () => {
    expect(flatten(NETWORK_MAP)).toContain(
      'useState<SiteHealthFilterMode>("all")',
    );
  });

  test("drilling into a level clears it", () => {
    /*
     * Arriving inside a region with the filter still on would show a
     * level that is mostly empty, with the reason two rows up and easy to
     * miss — and drilling INTO a problem is the normal way it gets used.
     */
    const changeSite: RegExpMatchArray | null = flatten(NETWORK_MAP).match(
      /const changeSite: \(siteId: string \| null\) => void = .*?queueQueryStringUpdate\(/,
    );
    expect(changeSite).not.toBeNull();
    expect(changeSite![0]).toContain('setHealthFilterMode("all")');
  });

  test("it renders the same shared chip group the device map uses", () => {
    expect(NETWORK_MAP).toContain(
      'from "../../Components/Filters/StatusChipGroup"',
    );
    expect(NETWORK_MAP).toContain('dataTestId="network-map-health-filter"');
  });

  test("every list on the level is narrowed by it — cards, markers and unplaced", () => {
    /*
     * The halves of this page must not disagree about what is being
     * looked at. Missing one list would leave a marker on the map with no
     * card under it, or the reverse.
     */
    const flatMap: string = flatten(NETWORK_MAP);
    expect(flatMap).toContain("filterSitesByHealth( allLevelSites,");
    expect(flatMap).toContain("filterSitesByHealth( allPinnedSites,");
    expect(flatMap).toContain("filterSitesByHealthLookup(");
  });

  test("links are narrowed to the sites that survived", () => {
    expect(NETWORK_MAP).toContain("filterLinksByVisibleSites(");
  });

  test("the health filter runs BEFORE the search", () => {
    /*
     * The chip counts are a claim about the level, not about the level as
     * it stands after somebody typed three letters. Ordering it the other
     * way would make the numbers move on every keystroke.
     */
    const healthIndex: number = NETWORK_MAP.indexOf(
      "const healthySites: Array<SiteChildView>",
    );
    const searchIndex: number = NETWORK_MAP.indexOf(
      "const levelSites: Array<SiteChildView>",
    );
    expect(healthIndex).toBeGreaterThan(-1);
    expect(searchIndex).toBeGreaterThan(healthIndex);
    expect(flatten(NETWORK_MAP)).toContain(
      "filterSitesBySearch( healthySites,",
    );
  });

  test("the summary is built from the child rows, not from the map markers", () => {
    /*
     * In grouped mode one marker can stand for a whole region, so
     * counting markers would count regions and stores as the same unit.
     */
    expect(NETWORK_MAP).toContain("summarizeSiteHealth(allLevelSites)");
  });

  test("both graphs are told a filter is on, so an empty level reads as good news", () => {
    expect(NETWORK_MAP).toContain("isHealthFiltered={isHealthFiltered}");
    expect(SITE_GRAPH).toContain("props.isHealthFiltered ? (");
    expect(SITE_GRAPH).toContain("Nothing here needs attention");
    expect(GEO_MAP).toContain("props.isHealthFiltered && !hasSites");
    expect(GEO_MAP).toContain("Nothing on this map needs attention");
  });

  test("the root level says so too rather than silently dropping its cards", () => {
    expect(NETWORK_MAP).toContain(
      'data-testid="network-map-nothing-needs-attention"',
    );
  });
});

describe("the shared chip group", () => {
  test("is a real segmented control for a screen reader", () => {
    expect(CHIP_GROUP).toContain('role="group"');
    expect(CHIP_GROUP).toContain("aria-pressed={isActive}");
  });

  test("carries the count and the status dot on every chip", () => {
    expect(CHIP_GROUP).toContain("{option.count}");
    expect(CHIP_GROUP).toContain("backgroundColor: option.color");
  });

  test("hides the dot on an option that stands for no state", () => {
    expect(CHIP_GROUP).toContain("{option.color ? (");
  });

  test("keeps the focus ring both pages' other pills use", () => {
    expect(CHIP_GROUP).toContain("focus-visible:ring-indigo-500");
  });
});
