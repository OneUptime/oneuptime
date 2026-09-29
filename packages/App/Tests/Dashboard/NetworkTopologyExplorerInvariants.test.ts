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

/*
 * Issue #3981 — the explorer's search box finds a site at ANY level of the
 * hierarchy, not only on the level in view.
 *
 * These are the wiring facts a rendered test cannot see from the outside:
 * which component is mounted, under which test-id prefix, and what the
 * server matches the text against. Each one is a way the fix can be undone
 * quietly — a box that goes back to a plain Input still filters the cards,
 * so every local test keeps passing while the customer is back to opening
 * every level above a unit to find it.
 */
describe("the explorer's search reaches every level of the hierarchy", () => {
  const FEATURE_SET: string = path.join(__dirname, "..", "..", "FeatureSet");

  function readFeatureCode(...relativeParts: Array<string>): string {
    const raw: string = fs.readFileSync(
      path.join(FEATURE_SET, ...relativeParts),
      "utf8",
    );
    return squash(
      raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " "),
    );
  }

  /*
   * Whitespace-free, for the expressions prettier is free to wrap either
   * way ("searchAllWords(\n  x,\n)" and "searchAllWords(x)" are the same
   * code).
   */
  function compact(text: string): string {
    return text.replace(/\s+/g, "");
  }

  // The JSX element starting at `<Tag`, up to its self-closing `/>`.
  function jsxElement(code: string, tag: string): string {
    const start: number = code.indexOf(`<${tag}`);
    if (start < 0) {
      return "";
    }
    const end: number = code.indexOf("/>", start);
    return code.slice(start, end < 0 ? undefined : end + 2);
  }

  const EXPLORER_SEARCH_BOX: string = jsxElement(
    EXPLORER_CODE,
    "SiteSearchBox",
  );

  /*
   * The box itself. A plain Input can only narrow the level on screen —
   * the dropdown of hierarchy-wide hits, and the drill it offers, only
   * exist in SiteSearchBox.
   */
  test("the explorer mounts SiteSearchBox, not a plain Input", () => {
    expect(EXPLORER_CODE).toContain(
      squash('import SiteSearchBox from "../NetworkSite/SiteSearchBox";'),
    );
    expect(EXPLORER_SEARCH_BOX).not.toBe("");
    expect(EXPLORER_CODE).not.toContain(
      'from "Common/UI/Components/Input/Input"',
    );
    expect(EXPLORER_CODE).not.toContain("<Input ");
  });

  /*
   * Picking a hit is a drill, and the explorer has exactly one: changeSite,
   * which resets the search, the health filter and the device view, and
   * mirrors the new site into the URL. A second, hand-rolled drill here
   * would skip some of that.
   */
  test("a picked hit drills through changeSite", () => {
    expect(EXPLORER_SEARCH_BOX).toContain("onSelectSite={changeSite}");
  });

  test("the box keeps driving the level's local filter", () => {
    expect(EXPLORER_SEARCH_BOX).toContain("value={searchText}");
    expect(EXPLORER_SEARCH_BOX).toContain("onChange={setSearchText}");
    expect(EXPLORER_SEARCH_BOX).toContain(
      "localMatchCount={searchedSites.length}",
    );
    expect(EXPLORER_SEARCH_BOX).toContain(
      "localTotalCount={allLevelSites.length}",
    );
    expect(EXPLORER_SEARCH_BOX).toContain("childTypeLabel={childTypeLabel}");
  });

  /*
   * Its own test-id prefix. Without one the explorer would render under
   * the Network Map's "network-map-search" ids, and the two pages' tests
   * would be reading each other's elements.
   */
  test("the box renders under the explorer's own test-id prefix", () => {
    expect(EXPLORER_SEARCH_BOX).toContain(
      'dataTestId="topology-hierarchy-search"',
    );
  });

  /*
   * The explorer already prints "x of y regions" beside the box. The box's
   * own "Showing x of y at this level" line would say it twice.
   */
  test("the box's own local count is switched off", () => {
    expect(EXPLORER_SEARCH_BOX).toContain("showLocalCount={false}");
  });

  test("the placeholder says the search reaches the whole network, translated", () => {
    expect(EXPLORER_CODE).toContain(
      squash(
        'const SEARCH_PLACEHOLDER: string = "Search sites by name — anywhere in your network";',
      ),
    );
    expect(EXPLORER_SEARCH_BOX).toContain(
      squash("translateString(SEARCH_PLACEHOLDER) || SEARCH_PLACEHOLDER"),
    );
    // The old level-only wording is gone.
    expect(EXPLORER_CODE).not.toContain("`Search ${childTypeLabelPlural}`");
  });

  /*
   * The empty level points at the dropdown only when the dropdown can have
   * an answer. The box asks the server from MIN_SITE_SEARCH_CHARS, and the
   * copy has to use the same test — a sentence promising matches "anywhere
   * in your network" over a one-letter search the box never sends would
   * send the reader to an empty panel.
   */
  test("the empty-state copy uses the box's own remote-search threshold", () => {
    expect(EXPLORER_CODE).toContain("isRemoteSearchable,");
    expect(EXPLORER_CODE).toContain(
      squash('} from "../NetworkSite/SiteSearchUtil";'),
    );
    expect(EXPLORER_CODE).toContain(
      squash(
        "isRemoteSearchable(normalizedSearch) ? `No ${childTypeLabelPlural}",
      ),
    );
    expect(EXPLORER_CODE).toContain(
      "Click the search box to see matching sites from anywhere in your network",
    );
  });

  /*
   * The Network Map is the page the box came from, and it keeps its ids:
   * no dataTestId prop means the default "network-map-search" prefix, and
   * no showLocalCount means the map still prints its own count (it has no
   * "x of y" line of its own beside the box).
   */
  test("the Network Map keeps the default prefix and its local count", () => {
    const mapCode: string = readCode("Pages", "NetworkSite", "NetworkMap.tsx");
    const mapBox: string = jsxElement(mapCode, "SiteSearchBox");
    expect(mapBox).not.toBe("");
    expect(mapBox).toContain("onSelectSite={changeSite}");
    expect(mapBox).not.toContain("dataTestId");
    expect(mapBox).not.toContain("showLocalCount");

    const boxCode: string = readCode(
      "Components",
      "NetworkSite",
      "SiteSearchBox.tsx",
    );
    expect(boxCode).toContain(
      squash('const DEFAULT_TEST_ID: string = "network-map-search";'),
    );
    expect(boxCode).toContain(
      squash("const testId: string = props.dataTestId || DEFAULT_TEST_ID;"),
    );
  });

  /*
   * The server half. The box's local filter requires every typed word, in
   * any order; the search route used to match the whole string as one
   * substring, so "michigan 104822" narrowed the cards to "Unit 104822 -
   * Michigan Ave" while the dropdown under the same box said nothing
   * matched. Both halves now apply the same rule.
   */
  describe("POST /network-site/search", () => {
    const ROUTES: string = readFeatureCode(
      "BaseAPI",
      "API",
      "NetworkSiteHierarchy.ts",
    );
    const routeStart: number = ROUTES.indexOf('"/network-site/search"');
    const routeEnd: number = ROUTES.indexOf("router.post(", routeStart);
    const SEARCH_ROUTE: string = ROUTES.slice(
      routeStart,
      routeEnd < 0 ? undefined : routeEnd,
    );

    test("the route exists", () => {
      expect(routeStart).toBeGreaterThan(-1);
      expect(SEARCH_ROUTE).toContain("NetworkSiteService.findBy(");
    });

    test("matches every word of the text, anywhere in the name", () => {
      expect(compact(SEARCH_ROUTE)).toContain(
        compact(
          "name: QueryHelper.searchAllWords( NetworkSiteHierarchyUtil.splitSearchWords(searchText)",
        ),
      );
    });

    test("no longer matches the whole text as one substring", () => {
      expect(compact(ROUTES)).not.toContain(
        compact("name: QueryHelper.search(searchText)"),
      );
    });

    /*
     * An empty box is no results, never a query for every site in the
     * project. searchAllWords already turns zero words into a predicate
     * that matches nothing; this early return means the query never runs.
     */
    test("an empty text short-circuits before the query", () => {
      expect(SEARCH_ROUTE).toContain(
        squash(
          'NetworkSiteHierarchyUtil.normalizeSearchText(body["searchText"]);',
        ),
      );
      const emptyReturn: number = SEARCH_ROUTE.indexOf(
        squash("if (!searchText) { return Response.sendJsonObjectResponse("),
      );
      expect(emptyReturn).toBeGreaterThan(-1);
      expect(emptyReturn).toBeLessThan(
        SEARCH_ROUTE.indexOf("NetworkSiteService.findBy("),
      );
    });

    // Still scoped to the caller's project, and to what they may read.
    test("stays project- and permission-scoped", () => {
      expect(SEARCH_ROUTE).toContain(squash("projectId: projectId,"));
      expect(SEARCH_ROUTE).toContain(squash("props: props,"));
    });
  });
});
