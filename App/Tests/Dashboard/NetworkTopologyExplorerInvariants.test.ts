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
    /*
     * The aria-label on the jump button is the one place a bare
     * .toLowerCase() is correct: it names ONE site, so the noun is singular
     * there by construction. Every other use must be the plural helper.
     */
    expect(EXPLORER_CODE.split("childTypeLabel.toLowerCase()").length - 1).toBe(
      1,
    );
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
   * A stale error must not survive the drill. `hasCurrentLevel` is false for
   * the whole round trip, so an error left over from the level being LEFT
   * would route the incoming one straight to the failed-level card instead
   * of the loader.
   */
  test("clears the previous level's error in the same batch as the new id", () => {
    expect(EXPLORER_CODE).toContain(
      squash('setError(""); setCurrentSiteId(siteId);'),
    );
  });

  /*
   * There is no loading flag any more, and there must not be one: the
   * loader is derived from whether the level in view has its own data.
   * A boolean written in five places and read in none was how the previous
   * revision convinced itself the drill was covered when it was not.
   */
  test("no separate loading flag can drift from the freshness check", () => {
    expect(EXPLORER_CODE).not.toContain("isLoading");
    expect(EXPLORER_CODE).not.toContain("setIsLoading");
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
    expect(EXPLORER_CODE).toContain("level?.childrenTruncated");
    expect(EXPLORER_CODE).toContain("level?.descendantCountsTruncated");
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

/*
 * The defect an adversarial review round found, and the guard that closes
 * it. Worth its own block because it is the most expensive way this feature
 * can fail: it put the project-wide device graph on screen.
 */
describe("a level in flight never renders another level's data", () => {
  /*
   * `changeSite` commits the new site id a whole round trip before the
   * response for it lands. With the view derived straight from `levelData`,
   * that window paired the NEW id with the PREVIOUS level's children —
   * and going back to All Sites from a store (isAtRoot + the store's empty
   * child list) resolved to "flat", mounting NetworkTopologyLiveView with
   * no siteId and firing the unscoped all-device fetch this whole change
   * exists to avoid, under a note claiming the project has no sites.
   */
  test("the loaded level is stamped with the site it belongs to", () => {
    expect(EXPLORER_CODE).toContain(
      squash(
        "const [loadedSiteId, setLoadedSiteId] = useState<string | null | undefined>( undefined, );",
      ),
    );
    expect(EXPLORER_CODE).toContain(squash("setLoadedSiteId(siteId);"));
  });

  test("freshness is what the view is derived from, not raw state", () => {
    expect(EXPLORER_CODE).toContain(
      squash(
        "const hasCurrentLevel: boolean = levelData !== null && loadedSiteId === currentSiteId;",
      ),
    );
    expect(EXPLORER_CODE).toContain(
      squash(
        "const level: SiteChildrenResponse | null = hasCurrentLevel ? levelData : null;",
      ),
    );
  });

  /*
   * Every input to the view resolution has to come from `level`. One
   * leftover `levelData?.` here is the whole bug back again.
   */
  test("every view input reads the fresh level", () => {
    expect(EXPLORER_CODE).toContain(
      squash("childCount: allLevelSites.length,"),
    );
    expect(EXPLORER_CODE).toContain(
      squash(
        "const allLevelSites: Array<SiteChildView> = level?.children || [];",
      ),
    );
    expect(EXPLORER_CODE).toContain(
      squash(
        "attachedDeviceCount: level?.deviceScope.attachedDeviceCount ?? 0,",
      ),
    );
    expect(EXPLORER_CODE).toContain(
      squash(
        "const breadcrumb: Array<SiteBreadcrumbEntry> = level?.breadcrumb || [];",
      ),
    );
  });

  /*
   * The loader has to cover the drill, not just the first load. The old
   * guard was `isLoading && !levelData`, and levelData is only ever null
   * once — so after the first load the loader was unreachable.
   */
  test("the loader covers every level with no data of its own", () => {
    expect(EXPLORER_CODE).toContain(
      squash("if (!hasCurrentLevel && !error) {"),
    );
    expect(EXPLORER_CODE).not.toContain(
      squash("if (isLoading && !levelData) {"),
    );
  });

  /*
   * A failed drill must not be a dead end: the breadcrumb is built from the
   * level that failed to load, and clicking the same card again no-ops.
   */
  test("a failed level offers a way out that does not need that level", () => {
    expect(EXPLORER).toContain('data-testid="topology-hierarchy-error-back"');
    expect(EXPLORER_CODE).toContain(squash("changeSite(null);"));
  });
});

describe('"Show every device" means every device', () => {
  /*
   * The note is rendered at every level, and its sentence is about the
   * devices attached to NO site. Toggling the device view where the reader
   * happens to be standing opened that one site's own handful instead —
   * never the unattached ones the sentence is actually about.
   */
  test("it drops to the root and asks for devices in one commit", () => {
    expect(EXPLORER_CODE).toContain(
      squash("const showEveryDevice: () => void = (): void => {"),
    );
    expect(EXPLORER_CODE).toContain(squash("setCurrentSiteId(null);"));
    expect(EXPLORER_CODE).toContain(squash("setRequestedDeviceView(true);"));
    expect(EXPLORER_CODE).toContain(
      squash('[TOPOLOGY_SITE_PARAM]: null, [TOPOLOGY_DEVICES_PARAM]: "1",'),
    );
  });

  test("the note's button calls it rather than the level-local toggle", () => {
    expect(EXPLORER).toContain(
      'data-testid="topology-hierarchy-show-every-device"',
    );
    const noteBlock: string = EXPLORER_CODE.slice(
      EXPLORER_CODE.indexOf("topology-hierarchy-show-every-device"),
      EXPLORER_CODE.indexOf("topology-hierarchy-show-every-device") + 400,
    );
    expect(noteBlock).toContain("showEveryDevice()");
    expect(noteBlock).not.toContain("changeDeviceView(true)");
  });
});

describe("the filter's effect reaches a screen reader", () => {
  /*
   * A ring and a smooth scroll are both invisible to assistive tech. The
   * hint line is the only thing that can carry "12 of 949 need a look, and
   * I have taken you to the first one", so it has to be a live region.
   */
  test("the hint is a polite live region", () => {
    expect(EXPLORER_CODE).toContain(squash('role="status"'));
    expect(EXPLORER_CODE).toContain(squash('aria-live="polite"'));
  });

  test("the jump button names the site it opens", () => {
    expect(EXPLORER_CODE).toContain(
      squash("aria-label={`Open ${focusedSite.name}"),
    );
  });

  test("the highlighted card says so in words, not only in colour", () => {
    const CARD: string = readCode("Components", "NetworkSite", "SiteCard.tsx");
    expect(CARD).toContain(
      squash(
        'props.isHighlighted ? ", first match for the current filter" : ""',
      ),
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
