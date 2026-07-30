import { describe, expect, test } from "@jest/globals";
import {
  DEVICE_FACET_QUERY_FIELDS,
  NETWORK_DEVICES_TABLE_ID,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceFacets";
import {
  NETWORK_SITES_TABLE_ID,
  SITE_FACET_QUERY_FIELDS,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteFacets";
import fs from "fs";
import path from "path";

/*
 * Clicking a summary tile moves a chip on the facet bar under it, and the chips
 * are what narrow the table. The tile-to-chip mapping is pure and unit-tested
 * (DeviceSummaryTiles, SiteSummaryTiles, FacetTileSelection); what is left is
 * the wiring — a prop, a memo dependency, a ref, an early return — and the App
 * suite runs in a plain Node environment with no renderer.
 *
 * So these read the sources and assert the exact expressions, the same way
 * NetworkSitePageInvariants.test.ts pins the Network Site pages. Every
 * assertion here corresponds to a way the feature can be broken while every
 * other test in the repo stays green. Sources are whitespace-squashed first so
 * prettier re-wrapping a line cannot turn a real regression check into a red
 * herring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_UI: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readSource(root: string, ...relativeParts: Array<string>): string {
  return squash(fs.readFileSync(path.join(root, ...relativeParts), "utf8"));
}

/**
 * Every way a chip's column can be spelled in a `filters` entry: the query
 * field itself, plus the relation the foreign key points at (`siteId` →
 * `site`), which is the spelling a column filter would naturally use. The
 * trailing colon keeps this matching a field key rather than any prose that
 * happens to contain the word.
 *
 * Derived from the facet modules so adding a chip extends the check for free.
 */
function chipOwnedFieldSpellings(queryFields: Array<string>): Array<string> {
  const spellings: Set<string> = new Set<string>();

  for (const field of queryFields) {
    spellings.add(`${field}:`);

    if (field.endsWith("Id")) {
      spellings.add(`${field.slice(0, -2)}:`);
    }
  }

  return Array.from(spellings);
}

const DEVICES_PAGE: string = readSource(
  DASHBOARD_SRC,
  "Pages",
  "NetworkDevice",
  "Devices.tsx",
);
const SITES_PAGE: string = readSource(
  DASHBOARD_SRC,
  "Pages",
  "NetworkSite",
  "Sites.tsx",
);
const DEVICE_CARDS: string = readSource(
  DASHBOARD_SRC,
  "Components",
  "NetworkDevice",
  "DeviceSummaryCards.tsx",
);
const SITE_CARDS: string = readSource(
  DASHBOARD_SRC,
  "Components",
  "NetworkSite",
  "SiteSummaryCards.tsx",
);
const SNAPSHOT_NOTE: string = readSource(
  DASHBOARD_SRC,
  "Components",
  "Network",
  "FacetSnapshotNote.tsx",
);
const HOOK: string = readSource(
  DASHBOARD_SRC,
  "Components",
  "ResourceOwners",
  "useResourceOwners.tsx",
);
const INFO_CARD: string = readSource(
  COMMON_UI,
  "Components",
  "InfoCard",
  "InfoCard.tsx",
);

/**
 * The names a page destructures off useResourceOwners. Everything the facet bar
 * and the tiles need has to come from the hook — a locally re-declared
 * `facetSelections` would leave the strip reading state the bar never writes.
 */
function hookDestructuring(page: string, modelName: string): string {
  return page
    .split(`} = useResourceOwners<${modelName}>({`)[0]!
    .split("const {")
    .pop()!;
}

describe("the Devices page wires its table to the facet bar", () => {
  const destructured: string = hookDestructuring(DEVICES_PAGE, "NetworkDevice");

  /*
   * The bar is the only visible record of why the list is short, and the only
   * control that widens it again. Rendering it anywhere but inside the table
   * card, or building it locally instead of taking the hook's, decouples the
   * chips from the query the hook merges.
   */
  test("the bar comes from the hook and is rendered as the table's topContent", () => {
    expect(destructured).toContain("filterBar,");
    expect(DEVICES_PAGE).toContain(
      squash(
        'topContent={ <Fragment> {filterBar} {statusSnapshotDetail ? ( <FacetSnapshotNote testIdSuffix="network-devices" detail={statusSnapshotDetail} /> ) : ( <></> )} </Fragment> }',
      ),
    );
  });

  /*
   * The whole point: the chips have to reach the request. A query prop that
   * skipped the merge would leave the bar decorative — chips set, list
   * unchanged.
   */
  test("the table's query is the merged one", () => {
    expect(destructured).toContain("mergeFiltersIntoQuery,");
    expect(DEVICES_PAGE).toContain(
      "query={mergeFiltersIntoQuery(BASE_DEVICE_QUERY)}",
    );
  });

  /*
   * ModelTable decides whether to refetch by comparing this prop against the
   * previous render's, so the base has to be one stable object. An inline
   * literal would be a new object every render — an endless refetch loop.
   */
  test("the base query is a module-level constant, not an inline literal", () => {
    expect(DEVICES_PAGE).toContain(
      "const BASE_DEVICE_QUERY: Query<NetworkDevice> =",
    );
    expect(DEVICES_PAGE.indexOf("const BASE_DEVICE_QUERY")).toBeLessThan(
      DEVICES_PAGE.indexOf("const NetworkDevices: FunctionComponent<"),
    );
    expect(DEVICES_PAGE).not.toContain("mergeFiltersIntoQuery({");
  });

  /*
   * Every count on the strip excludes archived devices, so the rows a tile opens
   * have to exclude them too — otherwise the tile says 3 and opens 5. No chip
   * writes isArchived, so the base query is the only place it can live.
   */
  test("the base query hides archived devices, as every count does", () => {
    expect(DEVICES_PAGE).toContain("isArchived: false");

    const countQueries: number = DEVICE_CARDS.split("query: {").length - 1;
    expect(countQueries).toBeGreaterThan(0);
    expect(DEVICE_CARDS.split("isArchived: false").length - 1).toBe(
      countQueries,
    );
  });

  /*
   * A saved table view that captured the column filters but not the chips would
   * reopen showing different rows than the ones that were saved, with the bar
   * claiming otherwise.
   *
   * Wired but dormant on this page: BaseModelTable only offers saved views when
   * the page passes `saveFilterProps`, which neither network table does yet (same
   * as several other pages that adopted this bar). These stay so the chips are
   * captured the day it is turned on rather than being silently dropped from every
   * view saved before then.
   */
  test("a saved view is wired to capture and restore the chips", () => {
    expect(destructured).toContain("facetSaveState,");
    expect(destructured).toContain("restoreFacetState,");
    expect(DEVICES_PAGE).toContain("currentFacetState={facetSaveState}");
    expect(DEVICES_PAGE).toContain("onFacetStateRestored={restoreFacetState}");
  });

  /*
   * One constant for the table id, its user-preferences key and the facet URL
   * namespace. A drifting literal would have the bar write chips into a
   * namespace the table never reads back — and it is the same namespace a link
   * built elsewhere in the product addresses (DeviceListFacetRoute).
   */
  test("the persisted namespace is the one the table uses", () => {
    expect(DEVICES_PAGE).toContain("id={NETWORK_DEVICES_TABLE_ID}");
    expect(DEVICES_PAGE).toContain(
      "userPreferencesKey={NETWORK_DEVICES_TABLE_ID}",
    );
    expect(DEVICES_PAGE).toContain("persistKey: NETWORK_DEVICES_TABLE_ID,");
    // Named through the shared constant, never re-spelled as a literal.
    expect(DEVICES_PAGE).not.toContain(`"${NETWORK_DEVICES_TABLE_ID}"`);
  });

  /*
   * "No network device" under a filter that matched nothing reads as an empty
   * project. The gate is what makes the copy honest in both states.
   */
  test("an empty filtered table explains itself", () => {
    expect(destructured).toContain("hasActiveFilters,");
    expect(DEVICES_PAGE).toContain(
      squash(
        'noItemsMessage={ hasActiveFilters ? "No network device matches the filters above." : undefined }',
      ),
    );
  });
});

describe("the Devices page turns a tile click into a moved chip", () => {
  /*
   * Without the click handler the tiles render inert — which is the bug this
   * whole change exists to fix — and without the live selections the strip
   * cannot tell which tile is the one the table is showing.
   */
  test("the strip is handed the live chips and a click handler", () => {
    expect(DEVICES_PAGE).toContain(
      squash(
        "<DeviceSummaryCards facetSelections={facetSelections} facetOperators={facetOperators} onTileClick={onSummaryTileClick} />",
      ),
    );
  });

  /*
   * The shared helper is what makes a tile a toggle (click the lit tile and the
   * chip clears) and what routes the "everything" tile to clearAllFacets. Doing
   * it by hand here would fork that behaviour away from its own unit tests, and
   * the setters have to be the hook's real ones or the click updates nothing.
   */
  test("the click goes through applyFacetTileSelection with the hook's setters", () => {
    const destructured: string = hookDestructuring(
      DEVICES_PAGE,
      "NetworkDevice",
    );
    expect(destructured).toContain("setFacetSelection,");
    expect(destructured).toContain("clearAllFacets,");

    expect(DEVICES_PAGE).toContain(
      squash(
        "applyFacetTileSelection({ selection: tile.selection, facetSelections: facetSelections, facetOperators: facetOperators, setFacetSelection: setFacetSelection, clearAllFacets: clearAllFacets, });",
      ),
    );
  });
});

/*
 * A chip and a column filter cannot both own a field. BaseModelTable builds its
 * request as `{...props.query, ...columnFilterQuery}`, so a popup filter on a
 * chip's field replaces the chip's constraint silently while the chip — and the
 * lit tile above it — carry on claiming it applies. Where the two spell one
 * column differently (`site` vs `siteId`) they instead survive as an AND that
 * can never match, emptying the table.
 *
 * `filters` is also what BaseModelTable sanitises URL-restored filter data
 * against, so an entry here is a value a shared link can carry too.
 */
describe("no Devices column filter collides with a chip", () => {
  const filters: string =
    DEVICES_PAGE.split("filters={[")[1]!.split("cardProps={")[0]!;

  test("the popup offers none of the fields the chips own", () => {
    const forbidden: Array<string> = [
      ...chipOwnedFieldSpellings(Object.values(DEVICE_FACET_QUERY_FIELDS)),
      // The Labels chip is the hook's, so its column is not in the map above.
      "labels:",
    ];

    expect(
      forbidden.filter((spelling: string) => {
        return filters.includes(spelling);
      }),
    ).toEqual([]);
  });

  /*
   * ...and the popup is still the only home for what no chip can express, so
   * emptying it in the name of the rule above would cost the user free-text
   * search over the columns nothing else filters.
   */
  test("the popup still offers the free-text filters it alone provides", () => {
    expect(filters).toContain("name: true");
    expect(filters).toContain("hostname: true");
    expect(filters).toContain("vendor: true");
  });
});

describe("the Devices page dates its status window", () => {
  /*
   * The Status chip's cutoff is a snapshot taken when the value was picked,
   * while the Status column recomputes the same window on every render — leave
   * the page open long enough and a row inside the "Up" list paints a Down
   * pill. This note is the only thing on screen that could explain that.
   */
  test("the note renders only when a time-based status is selected", () => {
    expect(DEVICES_PAGE).toContain(
      squash(
        "const selectedDeviceStatus: string | null = facetSelections[DEVICE_STATUS_FACET_KEY]?.[0] || null;",
      ),
    );
    expect(DEVICES_PAGE).toContain(
      squash(
        "const statusSnapshotDetail: string | undefined = useMemo(() => { if (!isTimeBasedDeviceStatus(selectedDeviceStatus)) { return undefined; }",
      ),
    );
    expect(DEVICES_PAGE).toContain("{statusSnapshotDetail ? (");
  });

  /*
   * The note names the cutoff the QUERY was built against, not "now".
   *
   * Deriving it from the current time instead is how the two come to name
   * different moments: the memo re-runs on any selection change, while the
   * snapshot only moves when the window is actually re-taken. Reading the same
   * Date the chip filters on makes them unable to disagree — and puts
   * `statusWindowCutoff` in the dependency list, which is the observable trace of
   * that.
   */
  test("the note is derived from the cutoff the query uses", () => {
    const memoDeps: string = DEVICES_PAGE.split(
      "const statusSnapshotDetail: string | undefined = useMemo(() => {",
    )[1]!
      .split("}, [")[1]!
      .split("]);")[0]!;

    /*
     * Both names, in whatever order prettier leaves them — React does not care
     * about the order, so neither should this.
     */
    expect(memoDeps).toContain("selectedDeviceStatus");
    expect(memoDeps).toContain("statusWindowCutoff");

    const noteBody: string = DEVICES_PAGE.split(
      "const statusSnapshotDetail: string | undefined = useMemo(() => {",
    )[1]!.split("}, [")[0]!;

    expect(noteBody).toContain("statusWindowCutoff");
    // Never from the clock — that is the bug this shape prevents.
    expect(noteBody).not.toContain("OneUptimeDate.getCurrentDate()");

    /*
     * And it says which side of the boundary is down. Inverting the sentence would
     * tell the user the opposite of what the query does, and nothing else here
     * reads the copy.
     */
    expect(noteBody).toContain("count as down");
  });

  /*
   * The cutoff lives in a ref-held DeviceStatusCutoff, not in a fresh
   * getDeviceFreshCutoff() per render: the merged query goes to ModelTable,
   * which refetches when it differs from the previous render's, so a new Date
   * every render is an endless refetch loop.
   */
  test("the cutoff is snapshotted in a ref, not rebuilt per render", () => {
    expect(DEVICES_PAGE).toContain(
      squash(
        "const statusCutoff: React.MutableRefObject<DeviceStatusCutoff> = useRef<DeviceStatusCutoff>(new DeviceStatusCutoff());",
      ),
    );
    expect(DEVICES_PAGE).toContain(
      'statusCutoff.current.getCutoffFor(values[0] || "")',
    );
    expect(DEVICES_PAGE).not.toContain("getDeviceFreshCutoff()");
  });

  /*
   * Synced with the live selection every render, `null` included.
   *
   * Without being told about the clear, the snapshot stays keyed on "down", so
   * "pick Down, clear the chip, pick Down an hour later" reuses the first hour's
   * window: a device that went stale in between is missing from the Down list
   * while its own Status pill says Down.
   */
  test("the snapshot is told when the chip is cleared", () => {
    expect(DEVICES_PAGE).toContain(
      squash(
        "const statusWindowCutoff: Date = statusCutoff.current.getCutoffFor(selectedDeviceStatus);",
      ),
    );

    /*
     * And it happens before the render reads it: the merged query is built in the
     * JSX below, so a sync placed after that would be a render behind.
     */
    expect(
      DEVICES_PAGE.indexOf("const statusWindowCutoff: Date ="),
    ).toBeLessThan(DEVICES_PAGE.indexOf("query={mergeFiltersIntoQuery("));
  });
});

describe("the Sites page wires its table to the facet bar", () => {
  const destructured: string = hookDestructuring(SITES_PAGE, "NetworkSite");

  test("the bar comes from the hook and is rendered as the table's topContent", () => {
    expect(destructured).toContain("filterBar,");
    expect(SITES_PAGE).toContain("topContent={filterBar}");
  });

  test("the table's query is the merged one", () => {
    expect(destructured).toContain("mergeFiltersIntoQuery,");
    expect(SITES_PAGE).toContain(
      "query={mergeFiltersIntoQuery(BASE_SITE_QUERY)}",
    );
  });

  test("the base query is a module-level constant, not an inline literal", () => {
    expect(SITES_PAGE).toContain(
      "const BASE_SITE_QUERY: Query<NetworkSite> = {};",
    );
    expect(SITES_PAGE.indexOf("const BASE_SITE_QUERY")).toBeLessThan(
      SITES_PAGE.indexOf("const NetworkSites: FunctionComponent<"),
    );
    expect(SITES_PAGE).not.toContain("mergeFiltersIntoQuery({");
  });

  test("a saved view captures and restores the chips", () => {
    expect(destructured).toContain("facetSaveState,");
    expect(destructured).toContain("restoreFacetState,");
    expect(SITES_PAGE).toContain("currentFacetState={facetSaveState}");
    expect(SITES_PAGE).toContain("onFacetStateRestored={restoreFacetState}");
  });

  test("the persisted namespace is the one the table uses", () => {
    expect(SITES_PAGE).toContain("id={NETWORK_SITES_TABLE_ID}");
    expect(SITES_PAGE).toContain("userPreferencesKey={NETWORK_SITES_TABLE_ID}");
    expect(SITES_PAGE).toContain("persistKey: NETWORK_SITES_TABLE_ID,");
    expect(SITES_PAGE).not.toContain(`"${NETWORK_SITES_TABLE_ID}"`);
  });

  test("an empty filtered table explains itself", () => {
    expect(destructured).toContain("hasActiveFilters,");
    expect(SITES_PAGE).toContain(
      squash(
        'noItemsMessage={ hasActiveFilters ? "No network site matches the filters above." : undefined }',
      ),
    );
  });

  /*
   * A CSV import bumps refreshToggle to refetch the table, the strip and the
   * hierarchy tree. Losing it while reworking the query prop would leave the
   * user staring at a table that does not contain what they just imported.
   */
  test("the import refresh still reaches the table", () => {
    expect(SITES_PAGE).toContain(
      squash(
        "<ModelTable<NetworkSite> refreshToggle={refreshToggle} query={mergeFiltersIntoQuery(BASE_SITE_QUERY)}",
      ),
    );
  });
});

describe("the Sites page turns a tile click into a moved chip", () => {
  const handler: string = SITES_PAGE.split(
    "const onSummaryTileClick: OnSummaryTileClickFunction = (",
  )[1]!.split("return (")[0]!;

  test("the strip is handed the live chips and a click handler", () => {
    expect(SITES_PAGE).toContain(
      squash(
        "<SiteSummaryCards refreshToggle={refreshToggle} facetSelections={facetSelections} facetOperators={facetOperators} onTileClick={onSummaryTileClick} />",
      ),
    );
  });

  test("the click goes through applyFacetTileSelection with the hook's setters", () => {
    const destructured: string = hookDestructuring(SITES_PAGE, "NetworkSite");
    expect(destructured).toContain("setFacetSelection,");
    expect(destructured).toContain("clearAllFacets,");

    expect(handler).toContain(
      squash(
        "applyFacetTileSelection({ selection: selection, facetSelections: facetSelections, facetOperators: facetOperators, setFacetSelection: setFacetSelection, clearAllFacets: clearAllFacets, });",
      ),
    );
  });

  /*
   * A tile with no chip to move and nowhere to go — the Unhealthy tile before
   * its status ids are known — must not fall through: applying an empty
   * selection would clear the chip and show every site under a lit tile.
   */
  test("a tile with no chip does nothing", () => {
    expect(handler).toContain(squash("if (!selection) { return; }"));
  });

  describe("the tile that counts devices", () => {
    /*
     * "Unassigned Devices" counts devices; this page lists sites. Narrowing the
     * sites table by a device predicate would empty it with no explanation, so
     * the tile leaves for the device list with the equivalent chip already set.
     */
    test("navigates to the device list rather than moving a site chip", () => {
      expect(handler).toContain(
        squash(
          "if (tile.action === SiteSummaryTileAction.ShowUnassignedDevices) { Navigation.navigate( getDeviceListRouteForFacet(UNASSIGNED_DEVICES_FACET_SELECTION), ); return; }",
        ),
      );
    });

    /*
     * The early return is load-bearing: without it the click would also move a
     * chip — and mirror it into the URL — on a page the user is walking away
     * from.
     */
    test("returns before the facet branches run", () => {
      const navigateBranch: string = handler.split(
        "SiteSummaryTileAction.ShowUnassignedDevices",
      )[1]!;

      expect(navigateBranch.indexOf("return;")).toBeLessThan(
        navigateBranch.indexOf("applyFacetTileSelection"),
      );
    });

    /*
     * Named through the shared constant, because the device page has to come up
     * showing exactly the rows behind the count on this tile — a chip spelled
     * out again here is a second definition of "unassigned" free to drift.
     */
    test("names the selection through the shared constant, not a literal", () => {
      expect(handler).toContain("UNASSIGNED_DEVICES_FACET_SELECTION");
      // The two halves an inline selection would have to spell out.
      expect(handler).not.toContain("facetKey:");
      expect(handler).not.toContain('"is_empty"');
    });
  });
});

describe("no Sites column filter collides with a chip", () => {
  const filters: string =
    SITES_PAGE.split("filters={[")[1]!.split("formSteps={[")[0]!;

  /*
   * Same collision as on the device list, and the site chips make the AND case
   * concrete: the popup would spell the column `networkSiteType` while the chip
   * writes `networkSiteTypeId`, and a row cannot satisfy both.
   */
  test("the popup offers none of the fields the chips own", () => {
    const forbidden: Array<string> = chipOwnedFieldSpellings(
      Object.values(SITE_FACET_QUERY_FIELDS),
    );

    expect(
      forbidden.filter((spelling: string) => {
        return filters.includes(spelling);
      }),
    ).toEqual([]);
  });

  test("the popup still offers the filters it alone provides", () => {
    expect(filters).toContain("name: true");
    expect(filters).toContain("address: true");
    expect(filters).toContain("createdAt: true");
  });
});

describe("DeviceSummaryCards", () => {
  /*
   * One source of truth for the tiles. A second, local list here is how the
   * numbers on the strip and the chips their clicks set would drift apart.
   */
  test("renders the shared tile definitions", () => {
    expect(DEVICE_CARDS).toContain(
      "DEVICE_SUMMARY_TILES.map((tile: DeviceSummaryTile) => {",
    );
    expect(DEVICE_CARDS).not.toContain("const tiles");
  });

  test("each tile reads its own count off the shared definition", () => {
    expect(DEVICE_CARDS).toContain(
      squash("const count: number = counts?.[tile.countField] || 0;"),
    );
  });

  /*
   * Clicking a skeleton would filter the list by a number nobody has read. The
   * counts and the rows would then disagree with no way to tell why.
   */
  test("tiles are inert until the counts land", () => {
    expect(DEVICE_CARDS).toContain(
      squash(
        "onClick={ props.onTileClick && !isLoading ? () => { props.onTileClick?.(tile); } : undefined }",
      ),
    );
  });

  /*
   * The pressed state is computed from the bar's own state, not from a copy the
   * strip keeps: the tiles and the chips must not be able to disagree about
   * which rows are on screen. It is also what makes the second click a toggle
   * off, since applyFacetTileSelection asks the same question.
   */
  test("the pressed state is the bar's state, asked through the shared helper", () => {
    expect(DEVICE_CARDS).toContain(
      squash(
        "const isSelected: boolean = isFacetTileSelectionApplied( tile.selection, props.facetSelections, props.facetOperators, );",
      ),
    );
    expect(DEVICE_CARDS).toContain("isSelected={isSelected}");
  });

  /*
   * The card is a div, so its label is the only thing a screen reader gets
   * beyond the number. It has to say what activating it does — and say
   * something different once it is the tile being shown.
   *
   * And it must claim only that the tile *contributes* a filter: chips layer, so
   * two tiles can be lit at once and the rows are then the intersection — a number
   * neither tile shows. "Showing these in the list below" would be false there.
   */
  test("each tile announces what activating it does", () => {
    expect(DEVICE_CARDS).toContain("ariaLabel={");
    expect(DEVICE_CARDS).toContain(
      "Activate to filter the list below by this.",
    );
    expect(DEVICE_CARDS).toContain(
      "Filtering the list below — activate to remove this filter.",
    );
    expect(DEVICE_CARDS).not.toContain("Showing these in the list below");
  });

  // Existing selectors in the wild.
  test("keeps its test ids", () => {
    expect(DEVICE_CARDS).toContain(
      'data-testid="network-device-summary-cards"',
    );
    expect(DEVICE_CARDS).toContain(
      "data-testid={`network-device-stat-${tile.key}`}",
    );
  });
});

describe("SiteSummaryCards", () => {
  test("renders the shared tile definitions", () => {
    expect(SITE_CARDS).toContain(
      "SITE_SUMMARY_TILES.map((tile: SiteSummaryTile) => {",
    );
    expect(SITE_CARDS).not.toContain("const tiles");
  });

  test("each tile reads its own count off the shared definition", () => {
    expect(SITE_CARDS).toContain(
      squash("const count: number = counts?.[tile.countField] || 0;"),
    );
  });

  /*
   * Inert until the counts land, and inert for a tile with no chip to move and
   * nowhere to go — the Unhealthy tile before its status ids are known.
   * Activating that one would clear the chip and show every site under a lit
   * "Unhealthy" tile.
   */
  test("tiles are inert until they have a count and somewhere to go", () => {
    expect(SITE_CARDS).toContain(
      squash(
        "const isActivatable: boolean = Boolean( props.onTileClick && !isLoading && (selection || tile.action === SiteSummaryTileAction.ShowUnassignedDevices), );",
      ),
    );
    expect(SITE_CARDS).toContain(
      squash(
        "onClick={ isActivatable ? () => { props.onTileClick?.(tile, selection); } : undefined }",
      ),
    );
  });

  /*
   * The strip reports which tile was activated and the chip it stands for, and
   * lets the page decide what that means — it is the page, not the strip, that
   * can navigate.
   */
  test("hands the tile and its selection to the page rather than deciding itself", () => {
    expect(SITE_CARDS).toContain(
      squash(
        "onTileClick?: | ((tile: SiteSummaryTile, selection: FacetTileSelection | null) => void) | undefined;",
      ),
    );
    expect(SITE_CARDS).not.toContain("Navigation.navigate");
  });

  test("the pressed state is the bar's state, asked through the shared helper", () => {
    expect(SITE_CARDS).toContain(
      squash(
        "return isFacetTileSelectionApplied( selection, props.facetSelections, props.facetOperators, );",
      ),
    );
    expect(SITE_CARDS).toContain("isSelected={isSelected}");
  });

  /*
   * Undefined, not false. The Unassigned Devices tile navigates away rather
   * than toggling, and `false` would have InfoCard announce it as a toggle
   * button that is currently off — a state it can never reach.
   */
  test("the tile that navigates is not announced as an unpressed toggle", () => {
    const body: string = SITE_CARDS.split(
      "const isTileSelected: IsTileSelectedFunction = (",
    )[1]!.split("type TileAriaLabelFunction")[0]!;

    expect(body).toContain(
      squash(
        "if (tile.action === SiteSummaryTileAction.ShowUnassignedDevices) { return undefined; }",
      ),
    );
    // The `| undefined` is what lets that answer through to InfoCard.
    expect(SITE_CARDS).toContain(
      "const isSelected: boolean | undefined = isTileSelected(tile, selection);",
    );
  });

  /*
   * "Activate to show these in the list below" would be a lie on the one tile
   * that navigates away.
   */
  test("the tile that leaves the page says so", () => {
    expect(SITE_CARDS).toContain("Activate to open these on the device list.");
    expect(SITE_CARDS).toContain(
      "ariaLabel={getTileAriaLabel(tile, count, isSelected)}",
    );
  });

  /*
   * The unhealthy chip selects exactly the statuses behind the number on the
   * tile, because both come out of the same response: the count is incremented
   * and the status id collected in one branch. Deriving the ids from "every
   * non-operational status the project defines" instead would open rows the
   * tile never counted.
   */
  test("the unhealthy chip is built from the response the count came from", () => {
    expect(SITE_CARDS).toContain("for (const site of siteResult.data) {");
    expect(SITE_CARDS).toContain(
      squash(
        "if (!site.currentMonitorStatus.isOperationalState) { unhealthySites++; const statusId: string | null = getMonitorStatusId(site); if (statusId) { unhealthyIds.add(statusId); } }",
      ),
    );
    expect(SITE_CARDS).toContain(
      "setUnhealthyStatusIds(Array.from(unhealthyIds));",
    );
    expect(SITE_CARDS).toContain(
      squash(
        "const selection: FacetTileSelection | null = getSiteFacetSelectionForTile(tile, { unhealthyStatusIds: unhealthyStatusIds, });",
      ),
    );
  });

  test("keeps its test ids", () => {
    expect(SITE_CARDS).toContain('data-testid="network-site-summary-cards"');
    expect(SITE_CARDS).toContain(
      "data-testid={`network-site-stat-${tile.key}`}",
    );
  });
});

describe("useResourceOwners exposes the chips a tile moves", () => {
  /*
   * Values and operator are written together, always both. A caller that moved
   * the values but left a stale "is empty" behind would produce a query that
   * ignores the values it just chose, under a chip claiming otherwise —
   * mergeFiltersIntoQuery returns on the empty operators before it ever reads
   * the selection.
   */
  test("setFacetSelection writes the values and the operator together", () => {
    const body: string = HOOK.split("const setFacetSelection: (")[1]!.split(
      "const clearAllFacets",
    )[0]!;

    expect(body).toContain(
      squash(
        "const nextOperator: FilterOperator = resolveFacetOperator(operator);",
      ),
    );
    /*
     * One call carrying both. Two calls, one per piece, would leave a render in
     * which the chip's values and its operator disagree — and that render is
     * the one the merged query is built from.
     */
    expect(body).toContain(
      squash("applyFacetChange(facetKey, nextValues, nextOperator);"),
    );
    expect(body).not.toContain("setFacetSelections(");
    expect(body).not.toContain("setFacetOperators(");
  });

  /*
   * Every facet change goes through one function, so the rules below are
   * enforced for the chips, the summary tiles and deep links alike rather than
   * in whichever of them was written first.
   */
  test("the chips and the tiles write through the same function", () => {
    for (const caller of [
      // The tiles and deep links, via setFacetSelection.
      squash("applyFacetChange(facetKey, nextValues, nextOperator);"),
      // The date chip.
      squash("applyFacetChange(facet.key, nextValues, nextOperator);"),
      // The option chip's operator switcher and its option list.
      squash("applyFacetChange(facet.key, selected, op);"),
      squash(
        'applyFacetChange( facet.key, nextValues, facetOperators[facet.key] || "is", );',
      ),
    ]) {
      expect(HOOK).toContain(caller);
    }
  });

  /*
   * Spreading the previous map is what makes chips layer: drilling into a
   * status must not throw away the site the user had already picked.
   *
   * The one exception is deliberate and declared. Two chips over the same
   * column cannot both apply — the merged query has room for one constraint per
   * field, so the later one silently replaces the earlier while both stay lit —
   * so an activating chip clears the ones it names in `exclusiveWith`.
   */
  test("it writes only its own facet's entry, and the ones declared exclusive with it", () => {
    const body: string = HOOK.split("const applyFacetChange: (")[1]!.split(
      "const setFacetSelection: (",
    )[0]!;

    expect(body).toContain("...prev,");
    expect(body).toContain("[facetKey]: values,");
    expect(body).toContain("[facetKey]: operator,");

    // Never a wholesale replacement — that would clear every other chip.
    expect(body).not.toContain("setFacetSelections({");
    expect(body).not.toContain("setFacetOperators({");

    /*
     * Other entries are touched only under `displaces`, and only for the keys
     * the conflict map names — never for the whole selection.
     */
    expect(body).toContain("if (displaces) {");
    expect(body).toContain("for (const other of conflicting) {");
    expect(body).toContain("next[other] = [];");
    expect(body).toContain('next[other] = "is";');
  });

  /*
   * Clearing a chip, or leaving one mid-range, must not displace anything: the
   * user backing out of one filter cannot silently discard another they set
   * first.
   */
  test("only an active chip displaces the one it conflicts with", () => {
    const body: string = HOOK.split("const applyFacetChange: (")[1]!.split(
      "const setFacetSelection: (",
    )[0]!;

    expect(body).toContain(
      squash(
        "const displaces: boolean = conflicting.length > 0 && isFacetActive(facet, values, operator);",
      ),
    );
  });

  /*
   * The conflict map is the shared, tested rule rather than something the hook
   * works out inline — see FacetDateRange.test.ts for its behaviour. What has to
   * hold here is that the hook uses it, over the facets the page passed.
   */
  test("the exclusion comes from the shared conflict map", () => {
    expect(HOOK).toContain(
      squash(
        "const facetConflicts: FacetConflictMap = useMemo((): FacetConflictMap => { return buildFacetConflictMap(extraFacets); }, [extraFacets]);",
      ),
    );
  });

  /*
   * "Clear everything" has to mean everything: a leftover operator map keeps
   * an is_empty constraint on the query with no chip left showing it, and a
   * leftover resolver cache keeps narrowing on `_id`.
   */
  test("clearAllFacets resets every piece of chip state", () => {
    const body: string = HOOK.split(
      "const clearAllFacets: () => void = useCallback((): void => {",
    )[1]!.split("}, []);")[0]!;

    // Order is irrelevant to React; the set of resets is what matters.
    for (const reset of [
      "setSelectedOwnerKeys([]);",
      "setSelectedLabelIds([]);",
      "setFacetSelections({});",
      'setOwnerOperator("is");',
      'setLabelOperator("is");',
      "setFacetOperators({});",
      "setFacetMatchingIds({});",
    ]) {
      expect(body).toContain(reset);
    }
  });

  /*
   * The bar's own "Clear all" is the same function the total tile reaches
   * through applyFacetTileSelection, so the two cannot drift into clearing
   * different things.
   */
  test("the bar's Clear all button calls that same function", () => {
    expect(HOOK).toContain(
      squash(
        '{hasActiveFilters && ( <button type="button" onClick={clearAllFacets}',
      ),
    );
  });

  test("the hook returns what the tiles and the strip read", () => {
    const returned: string = HOOK.split(
      "return { ownersByResourceId,",
    )[1]!.split("};")[0]!;

    expect(returned).toContain("facetSelections,");
    expect(returned).toContain("facetOperators,");
    expect(returned).toContain("setFacetSelection,");
    expect(returned).toContain("clearAllFacets,");
  });
});

describe("FacetSnapshotNote", () => {
  /*
   * It says nothing of its own — the page that knows what its chip means
   * supplies the sentence. A note that composed its own copy would have to know
   * about the device status window, which is the one thing keeping this shared.
   */
  test("renders the detail it is given", () => {
    expect(SNAPSHOT_NOTE).toContain("detail: string;");
    expect(SNAPSHOT_NOTE).toContain("<span>{props.detail}</span>");
  });

  // Several tables can show a note; the tests in the wild have to tell them apart.
  test("keeps a per-table test id", () => {
    expect(SNAPSHOT_NOTE).toContain("testIdSuffix: string;");
    expect(SNAPSHOT_NOTE).toContain(
      "data-testid={`facet-snapshot-note-${props.testIdSuffix}`}",
    );
  });
});

describe("InfoCard as a toggle", () => {
  /*
   * InfoCard is shared. Everything the tiles need is gated on the card
   * actually having a click handler, so the many cards that are plain
   * containers keep rendering as plain containers — no bogus button role, no
   * tab stop, no aria-pressed on something that does not toggle.
   */
  test("only a clickable card becomes a button", () => {
    expect(INFO_CARD).toContain(
      "const isClickable: boolean = Boolean(props.onClick);",
    );
    expect(INFO_CARD).toContain('role={isClickable ? "button" : undefined}');
    expect(INFO_CARD).toContain("tabIndex={isClickable ? 0 : undefined}");
  });

  /*
   * Every InfoCard that was clickable before this change — the Home overview
   * stats, the Kubernetes and Proxmox summaries, the monitor summary views —
   * navigates rather than toggling. `aria-pressed="false"` on those announces
   * a toggle button that is currently off, promising a state that activating
   * it never reaches. So the attribute is gated on the caller having actually
   * opted in, not on the card merely being clickable.
   */
  test("only a card that opted into toggle semantics announces them", () => {
    expect(INFO_CARD).toContain(
      squash(
        "aria-pressed={ isClickable && props.isSelected !== undefined ? Boolean(props.isSelected) : undefined }",
      ),
    );
    expect(INFO_CARD).not.toContain(
      "aria-pressed={isClickable ? Boolean(props.isSelected) : undefined}",
    );
  });

  /*
   * A div with an onClick is unreachable by keyboard. Enter and Space are
   * what a real button responds to, and Space has to have its default taken
   * away or the page scrolls instead.
   */
  test("Enter and Space activate it, and Space does not scroll the page", () => {
    const handler: string =
      INFO_CARD.split("onKeyDown={")[1]!.split("className={")[0]!;

    expect(handler).toContain(
      squash('if (event.key !== "Enter" && event.key !== " ") { return; }'),
    );
    expect(handler).toContain("event.preventDefault();");
    expect(handler).toContain("props.onClick?.();");
  });

  /*
   * Tailwind emits both border-colour utilities at the same specificity, so
   * appending a selected border to the default one leaves the winner up to
   * stylesheet order. The class has to be swapped, not stacked.
   */
  test("the selected border replaces the default rather than stacking on it", () => {
    expect(INFO_CARD).toContain(
      squash(
        'const borderClassName: string = isClickable && props.isSelected ? "border-indigo-500 ring-1 ring-indigo-500" : "border-gray-200";',
      ),
    );
    expect(INFO_CARD).toContain("border ${borderClassName}");
  });

  test("a keyboard user can see where they are", () => {
    expect(INFO_CARD).toContain("focus-visible:ring-2");
  });

  /*
   * The cards that were already clickable before this change (the Home
   * overview stats, the Kubernetes and Proxmox detail pages) pass no
   * isSelected, so Boolean(undefined) leaves them announced as un-pressed
   * buttons — which is what they are.
   */
  test("isSelected is optional, so existing clickable cards are unaffected", () => {
    expect(INFO_CARD).toContain("isSelected?: boolean | undefined;");
    expect(INFO_CARD).toContain("ariaLabel?: string | undefined;");
  });
});
