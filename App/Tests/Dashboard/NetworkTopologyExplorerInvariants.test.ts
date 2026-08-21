import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3320 — the parts of the hierarchy-first topology explorer that
 * live in a prop, a hook dependency or a `key`, and so cannot be reached by
 * a pure unit test.
 *
 * The App suite runs in a plain Node environment with no renderer, so these
 * read the sources and assert the exact expressions — the same technique
 * NetworkSitePageInvariants.test.ts uses, and for the same reason. Every
 * assertion here corresponds to a way this feature can silently go wrong:
 * a device graph that keeps the previous site's coordinates, a poll that
 * runs over every device in the project while a graph is already polling
 * itself, chips whose counts describe rows the reader cannot see.
 *
 * Sources are whitespace-squashed first, so prettier re-wrapping a line
 * cannot turn a real regression check into a red herring.
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
 * The same source with its comments stripped. Assertions about what the
 * product DOES have to read the code, not the commentary around it.
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

const EXPLORER: string = readSource(
  "Components",
  "Topology",
  "NetworkTopologyExplorer.tsx",
);
const EXPLORER_CODE: string = readCode(
  "Components",
  "Topology",
  "NetworkTopologyExplorer.tsx",
);

describe("both topology entry points open on the explorer", () => {
  /*
   * The whole change is that these two pages no longer draw every device in
   * the project at once. If either one goes back to rendering the live view
   * directly, the fix is reverted for the users of that page only — which
   * is far harder to notice than reverting it for everybody.
   */
  test("the Topology page's Network tab renders the explorer", () => {
    const page: string = readCode("Pages", "Topology", "TopologyPage.tsx");
    expect(page).toContain("<NetworkTopologyExplorer />");
    expect(page).not.toContain("<NetworkTopologyView />");
  });

  test("the Network Devices section's topology tab renders the explorer", () => {
    const page: string = readCode("Pages", "NetworkDevice", "Topology.tsx");
    expect(page).toContain("<NetworkTopologyExplorer />");
    expect(page).not.toContain("<NetworkTopologyLiveView />");
  });

  /*
   * The Network Map page's unit view is the OTHER place a single site's
   * topology is drawn. It keeps rendering the live view directly, scoped to
   * its site — routing it through the explorer would put a second drill
   * control inside a page that is already a drill.
   */
  test("the Network Map page still renders the scoped live view itself", () => {
    const page: string = readCode("Pages", "NetworkSite", "NetworkMap.tsx");
    expect(page).toContain(
      squash("<NetworkTopologyLiveView siteId={currentSiteId}"),
    );
  });
});

describe("the device graph is scoped to what the reader drilled to", () => {
  /*
   * The point of the whole feature: a drilled site hands the graph ONE
   * site's devices. Dropping the siteId here would put every project-wide
   * device back on screen behind a breadcrumb claiming otherwise.
   */
  test("a drilled site scopes the live view, and the root does not", () => {
    expect(EXPLORER_CODE).toContain(
      squash("siteId={currentSiteId || undefined}"),
    );
  });

  /*
   * The live view owns a viewport, a saved arrangement and a selection, all
   * keyed to the node set it was handed. Without a key change on scope
   * change, drilling from one site to another frames the new site's devices
   * to the old site's coordinates and keeps a selection that no longer
   * exists.
   */
  test("changing scope remounts the live view rather than re-feeding it", () => {
    expect(EXPLORER_CODE).toContain(
      squash('key={currentSiteId || "all-devices"}'),
    );
  });

  test("a drilled site opens tiered; the project-wide map keeps force", () => {
    expect(EXPLORER_CODE).toContain(
      squash(
        'layoutMode={ currentSiteId ? props.siteLayoutMode || "tiered" : "force" }',
      ),
    );
  });
});

describe("the level poll", () => {
  /*
   * While a device graph is on screen it is already polling itself every
   * minute. A second poll of /network-site/children underneath it buys
   * nothing and — at the root, where the endpoint walks every device in the
   * project to build the rollups — costs a great deal.
   */
  test("is skipped while a device graph is on screen", () => {
    expect(EXPLORER_CODE).toContain(
      squash("if (isShowingDeviceGraphRef.current) { return; }"),
    );
  });

  /*
   * Read through a ref rather than captured in the interval's closure: the
   * interval is created once per drill level, and a captured boolean would
   * keep answering with whatever the view was at the moment it was set up.
   */
  test("reads the current view through a ref, not a captured value", () => {
    expect(EXPLORER_CODE).toContain(
      squash("isShowingDeviceGraphRef.current = isShowingDeviceGraph;"),
    );
  });

  /*
   * Cancel-stale. A slow response for the level the reader has already left
   * must not overwrite the level they are looking at now.
   */
  test("drops a response a newer request has superseded", () => {
    expect(EXPLORER_CODE).toContain(
      squash(
        'if (!isMounted.current || seq !== requestSeq.current) { return "superseded"; }',
      ),
    );
  });
});

describe("search, then health — in that order", () => {
  /*
   * The chips carry counts, and those counts are a claim about what is ON
   * SCREEN. Summarising the unfiltered level would print "Down 3" over a
   * search result holding none of them, which is worse than no count at
   * all.
   */
  test("the summary is computed from the searched rows", () => {
    expect(EXPLORER_CODE).toContain(
      squash("return summarizeSiteTopologyHealth(searchedSites);"),
    );
  });

  test("the health filter narrows the searched rows, not the raw level", () => {
    expect(EXPLORER_CODE).toContain(
      squash(
        "return filterSitesByTopologyHealth(searchedSites, healthFilterMode);",
      ),
    );
  });

  /*
   * Issue #3320's auto-zoom target is chosen from the same rows the chips
   * counted. Picking it from the unfiltered level could land the reader on
   * a card the search has already removed from the grid.
   */
  test("the jump target comes from the same rows the chips counted", () => {
    expect(EXPLORER_CODE).toContain(
      squash("return firstMatchingSiteId(searchedSites, healthFilterMode);"),
    );
  });

  /*
   * From the UNFILTERED list on purpose: the label names what the children
   * of this level ARE. Searching for one market does not turn a level of
   * Markets into a level of something else.
   */
  test("the level's noun comes from the unfiltered level", () => {
    expect(EXPLORER_CODE).toContain(
      squash(
        "const childTypeLabel: string = childTypeLabelFor(allLevelSites);",
      ),
    );
  });

  /*
   * Site types are free text the customer wrote. Every plural in this
   * component goes through the shared pluraliser, never a "+ s" — "Search
   * facilitys" over somebody's real estate is the tell that two halves of
   * the product disagree about their own vocabulary.
   */
  test("plurals of the customer's noun go through the shared pluraliser", () => {
    expect(EXPLORER_CODE).toContain(
      squash(
        "const childTypeLabelPlural: string = pluralChildLabel(childTypeLabel);",
      ),
    );
    expect(EXPLORER_CODE).not.toContain("childTypeLabel.toLowerCase()");
  });
});

describe("drilling", () => {
  /*
   * A drill is a request for a LEVEL. Carrying "show me devices" into it
   * would open the next site's device map instead of the level the reader
   * just clicked on.
   */
  test("clears the device view, the search and the filter", () => {
    expect(EXPLORER_CODE).toContain(squash("setRequestedDeviceView(false);"));
    expect(EXPLORER_CODE).toContain(squash('setSearchText("");'));
    expect(EXPLORER_CODE).toContain(squash('setHealthFilterMode("all");'));
  });

  /*
   * The loader is raised in the SAME batch as the id. The fetch effect runs
   * after paint, so setting only the id commits one frame in which the id
   * is the new level while the data is still the previous one's — which
   * renders the wrong view, and going up renders an empty state, before the
   * loader ever appears.
   */
  test("raises the loader in the same batch as the new site id", () => {
    expect(EXPLORER_CODE).toContain(
      squash('setIsLoading(true); setError(""); setCurrentSiteId(siteId);'),
    );
  });

  test("no-ops on an unchanged target, so the loader is never stranded", () => {
    expect(EXPLORER_CODE).toContain(
      squash("if (siteId === currentSiteId) { return; }"),
    );
  });

  test("mirrors the drill position into the URL", () => {
    expect(EXPLORER_CODE).toContain(
      squash("[TOPOLOGY_SITE_PARAM]: siteId, [TOPOLOGY_DEVICES_PARAM]: null,"),
    );
  });
});

describe("nothing is hidden without saying so", () => {
  /*
   * A hierarchy that silently omits every device nobody attached to a site
   * is the same failure as a map that silently drops nodes — and the reader
   * has no way to notice.
   */
  test("unattached devices are named, with a way to see them", () => {
    expect(EXPLORER_CODE).toContain("describeUnattachedDevices");
    expect(EXPLORER).toContain(
      'data-testid="topology-hierarchy-unattached-note"',
    );
  });

  test("a truncated level says its rollups may be partial", () => {
    expect(EXPLORER_CODE).toContain("levelData?.childrenTruncated");
    expect(EXPLORER_CODE).toContain("levelData?.descendantCountsTruncated");
  });

  /*
   * The flat map is not deleted, only demoted. A reader who wants every
   * device at once must always be able to get there, and — critically —
   * back again, or "All devices" is a one-way door out of the hierarchy.
   */
  test("the flat map stays reachable, and reachable FROM", () => {
    expect(EXPLORER_CODE).toContain(
      squash(
        'data-testid={`topology-hierarchy-scope-${ option.value ? "devices" : "level" }`}',
      ),
    );
    expect(EXPLORER_CODE).toContain("const showToggleFromDeviceView: boolean");
    expect(EXPLORER_CODE).toContain(
      squash("showDeviceToggle || showToggleFromDeviceView"),
    );
  });

  test("a root that fell back to the flat map explains why", () => {
    expect(EXPLORER_CODE).toContain("flatFallbackReason(viewInput)");
    expect(EXPLORER).toContain('data-testid="topology-hierarchy-flat-note"');
  });

  /*
   * A project with no sites gets no breadcrumb chrome. An inert "All Sites"
   * crumb over a map that is not part of any hierarchy is a control that
   * looks like navigation and is not.
   */
  test("the header is only drawn when it can actually do something", () => {
    expect(EXPLORER_CODE).toContain(
      squash(
        "const showHeader: boolean = breadcrumb.length > 0 || showDeviceToggle || showToggleFromDeviceView;",
      ),
    );
    expect(EXPLORER_CODE).toContain(squash("{showHeader ? header : <></>}"));
  });

  /*
   * A failed background poll keeps the last good level on screen and says
   * so, rather than replacing a working page with an error.
   */
  test("a refresh failure keeps the level it already has", () => {
    expect(EXPLORER_CODE).toContain(
      squash("`${error} — showing the last level that loaded.`"),
    );
  });
});

describe("the card grid", () => {
  test("cards are drillable and carry the drill handler", () => {
    expect(EXPLORER_CODE).toContain(squash("onClick={changeSite}"));
  });

  /*
   * Issue #3320's auto-zoom, at this level: the card the filter landed the
   * reader on is ringed AND scrolled to, and the hint row offers to open
   * it.
   */
  test("the site the filter landed on is highlighted", () => {
    expect(EXPLORER_CODE).toContain(
      squash("isHighlighted={site.id === focusedSiteId}"),
    );
  });

  test("the highlighted card is scrolled into view", () => {
    expect(EXPLORER_CODE).toContain(
      squash('`[data-testid="site-card-${focusedSiteId}"]`'),
    );
    expect(EXPLORER_CODE).toContain("scrollIntoView");
  });

  test("and can be opened straight from the hint row", () => {
    expect(EXPLORER).toContain(
      'data-testid="topology-hierarchy-jump-to-first"',
    );
    expect(EXPLORER_CODE).toContain(squash("changeSite(focusedSite.id);"));
  });

  /*
   * scrollIntoView does not exist on every element in every environment the
   * dashboard runs in (and not at all in a test renderer). Calling it
   * unguarded would take the whole level down with a TypeError.
   */
  test("scrolling is feature-detected rather than assumed", () => {
    expect(EXPLORER_CODE).toContain(
      squash('typeof card.scrollIntoView === "function"'),
    );
  });
});

describe("the site card reports device health", () => {
  const CARD: string = readCode("Components", "NetworkSite", "SiteCard.tsx");

  /*
   * "128 devices" over a subtree holding four dark switches is a number
   * that is true and useless — it is exactly the failure the drill-down
   * exists to fix, one level up.
   */
  test("a card with something wrong leads with what is wrong", () => {
    expect(CARD).toContain("devicesNeedingAttention > 0");
    expect(CARD).toContain("describeDeviceAttention(deviceStats)");
  });

  test("the attention line is colored, and only rendered when it applies", () => {
    expect(CARD).toContain(squash('className="font-medium text-red-600"'));
  });

  /*
   * A payload from a server that predates deviceStats narrows to undefined,
   * and a card that throws would take the whole level with it.
   */
  test("a missing tally falls back rather than throwing", () => {
    expect(CARD).toContain(
      squash("site.deviceStats || emptyDeviceHealthCounts()"),
    );
  });

  /*
   * The highlight is a ring, not a colour. Colour on this card already
   * means health, and a second meaning for it would make a highlighted
   * healthy site look broken.
   */
  test("the highlight is a ring rather than a second use of colour", () => {
    expect(CARD).toContain("props.isHighlighted");
    expect(CARD).toContain("ring-2 ring-indigo-400");
  });
});
