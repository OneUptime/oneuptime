import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Clicking a summary tile narrows the table under it. The query mapping is
 * pure and unit-tested (DeviceSummaryFilter.test.ts, SiteSummaryFilter.test.ts);
 * what is left is the wiring — a prop, a hook dependency, an early return —
 * and the App suite runs in a plain Node environment with no renderer.
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
const CHIP: string = readSource(
  DASHBOARD_SRC,
  "Components",
  "Network",
  "SummaryFilterChip.tsx",
);
const INFO_CARD: string = readSource(
  COMMON_UI,
  "Components",
  "InfoCard",
  "InfoCard.tsx",
);

describe("the Devices page turns a tile click into a filtered list", () => {
  /*
   * The whole feature. Without the callback the tiles render inert and the
   * click does nothing at all — which is the bug this change fixes.
   */
  test("the summary strip is handed the selection and a way to change it", () => {
    expect(DEVICES_PAGE).toContain(
      squash(
        "<DeviceSummaryCards selectedFilterKey={summaryFilterKey} onFilterKeyChange={changeSummaryFilter} />",
      ),
    );
  });

  /*
   * The table has to read the memoised query. An inline literal here would
   * rebuild the cutoff Date on every render, and BaseModelTable decides
   * whether to refetch by JSON-comparing this prop with the previous render's
   * — so every render would look like a change and refetch forever.
   */
  test("the table reads the memoised query, not an inline literal", () => {
    expect(DEVICES_PAGE).toContain("query={tableQuery}");
    expect(DEVICES_PAGE).not.toContain(squash("query={{ isArchived: false }}"));
  });

  test("the memo is keyed on the selected tile and nothing else", () => {
    expect(DEVICES_PAGE).toContain(
      squash(
        "const tableQuery: Query<NetworkDevice> = useMemo(() => { return { isArchived: false, ...getDeviceSummaryFilterQuery(summaryFilterKey), }; }, [summaryFilterKey]);",
      ),
    );
  });

  /*
   * Archived devices are excluded from every count on the strip, so they have
   * to stay excluded from the rows a tile opens. The filter fragment is
   * spread AFTER the base, but no fragment names isArchived — pinned in
   * DeviceSummaryFilter.test.ts.
   */
  test("the base query still hides archived devices", () => {
    expect(DEVICES_PAGE).toContain("isArchived: false");
  });

  /*
   * Read synchronously in the useState initializer. Restoring in an effect
   * instead would fire the first fetch against the whole fleet and throw that
   * response away — a visible flash of the wrong rows plus a wasted request.
   */
  test("the selection is seeded from the URL during the first render", () => {
    expect(DEVICES_PAGE).toContain(
      squash(
        "useState<DeviceSummaryFilterKey | null>(() => { return parseDeviceSummaryFilterKey( Navigation.getQueryStringByName(DEVICE_SUMMARY_FILTER_URL_PARAM), ); });",
      ),
    );
  });

  // The raw parameter is user-editable; only a parsed key may reach the query.
  test("the raw parameter never reaches the query builder", () => {
    expect(DEVICES_PAGE).toContain("parseDeviceSummaryFilterKey(");
    expect(DEVICES_PAGE).not.toContain(
      squash("getDeviceSummaryFilterQuery( Navigation.getQueryStringByName("),
    );
  });

  test("changing the filter updates the state and the URL together", () => {
    const body: string = DEVICES_PAGE.split(
      "const changeSummaryFilter: ChangeSummaryFilterFunction = (",
    )[1]!.split("};")[0]!;

    expect(body).toContain("setSummaryFilterKey(filterKey);");
    expect(body).toContain(
      squash(
        "Navigation.setQueryString({ [DEVICE_SUMMARY_FILTER_URL_PARAM]: filterKey, });",
      ),
    );
  });

  /*
   * A tile filter and a column filter over the same field cannot both apply.
   * BaseModelTable builds its request as `{...props.query, ...columnFilter}`,
   * so a "Last Seen At" filter the user had already set silently replaces the
   * tile's `lastSeenAt` constraint while the chip and the lit tile carry on
   * claiming it — the table then shows Up devices under a "Devices down"
   * chip. Three things together make the two exclusive in both orders.
   */
  describe("a drill-down cannot be silently overridden by a column filter", () => {
    test("selecting a tile drops the column filter and page the table was holding", () => {
      const body: string = DEVICES_PAGE.split(
        "const changeSummaryFilter: ChangeSummaryFilterFunction = (",
      )[1]!.split("};")[0]!;

      expect(body).toContain(
        "TableFilterUrlState.clear(NETWORK_DEVICES_TABLE_ID);",
      );
    });

    /*
     * Clearing the persisted state is only half of it: the mounted table
     * keeps its own live filter state, and re-reads the URL only on mount.
     */
    test("the table is remounted on the selection so it re-reads that state", () => {
      expect(DEVICES_PAGE).toContain(
        squash(
          'key={`${NETWORK_DEVICES_TABLE_ID}-${summaryFilterKey || "all"}`}',
        ),
      );
    });

    /*
     * And the other order: while the drill-down is active the popup must not
     * offer the filter that would overwrite it. `filters` is also what
     * BaseModelTable sanitises URL-restored filter data against, so dropping
     * an entry here drops a stale value for it out of a shared link too.
     */
    test("the popup stops offering the fields the active tile owns", () => {
      expect(DEVICES_PAGE).toContain("].filter(isFilterOffered)}");
      expect(DEVICES_PAGE).toContain(
        squash(
          "const conflictingFilterFields: Array<string> = getDeviceSummaryFilterConflictingFilterFields(summaryFilterKey);",
        ),
      );
      expect(DEVICES_PAGE).toContain(
        squash("return !field || !conflictingFilterFields.includes(field);"),
      );
    });

    /*
     * The table id is the URL namespace its filter/sort/page state lives
     * under. If the literal drifted from the one passed to the table, the
     * clear above would silently wipe nothing.
     */
    test("the cleared namespace is the one the table actually uses", () => {
      expect(DEVICES_PAGE).toContain(
        squash(
          'const NETWORK_DEVICES_TABLE_ID: string = "network-devices-table";',
        ),
      );
      expect(DEVICES_PAGE).toContain("id={NETWORK_DEVICES_TABLE_ID}");
      expect(DEVICES_PAGE).toContain(
        "userPreferencesKey={NETWORK_DEVICES_TABLE_ID}",
      );
    });
  });

  /*
   * The up/down window is a snapshot: the cutoff is built when the tile is
   * activated and frozen by the memo (rebuilding it on a timer would send
   * anyone reading page 3 back to page 1 every tick and drop their bulk
   * selection). The Status column recomputes the same window live, so without
   * a label a long-lived page shows Down pills inside the "up" list with
   * nothing to explain it.
   */
  test("a time-based drill-down says when its snapshot was taken", () => {
    expect(DEVICES_PAGE).toContain("detail={summaryFilterDetail}");
    expect(DEVICES_PAGE).toContain(
      squash(
        "const summaryFilterDetail: string | undefined = useMemo(() => { if (!isDeviceSummaryFilterTimeBased(summaryFilterKey)) { return undefined; }",
      ),
    );
    // Re-taken exactly when the cutoff is, so the two can never disagree.
    expect(DEVICES_PAGE).toContain(
      squash(
        "return `as of ${OneUptimeDate.getLocalHourAndMinuteFromDate( OneUptimeDate.getCurrentDate(), )}`; }, [summaryFilterKey]);",
      ),
    );
  });

  /*
   * A short table with no explanation is the failure mode this chip exists to
   * prevent — and its clear button is the only way back out for someone who
   * cannot find the tile they clicked.
   */
  test("a filtered table says so, and offers a way out", () => {
    expect(DEVICES_PAGE).toContain(
      squash(
        'topContent={ summaryFilterDefinition ? ( <SummaryFilterChip testIdSuffix="network-devices" label={summaryFilterDefinition.chipLabel} detail={summaryFilterDetail} onClear={() => { changeSummaryFilter(null); }} /> ) : undefined }',
      ),
    );
  });

  /*
   * "No devices found" under a filter that matched nothing reads as an empty
   * project. The filter-specific copy is what tells the user their fleet is
   * fine rather than missing.
   */
  test("an empty filtered table explains itself", () => {
    expect(DEVICES_PAGE).toContain(
      "noItemsMessage={summaryFilterDefinition?.emptyMessage}",
    );
  });
});

describe("the Sites page turns a tile click into a filtered list", () => {
  test("the summary strip is handed the selection and a click handler", () => {
    expect(SITES_PAGE).toContain(
      squash(
        "<SiteSummaryCards refreshToggle={refreshToggle} selectedFilterKey={summaryFilterKey} onTileClick={onSummaryTileClick} />",
      ),
    );
  });

  test("the table reads the memoised query", () => {
    expect(SITES_PAGE).toContain("query={tableQuery}");
    expect(SITES_PAGE).toContain(
      squash(
        "const tableQuery: Query<NetworkSite> = useMemo(() => { return getSiteSummaryFilterQuery(summaryFilterKey); }, [summaryFilterKey]);",
      ),
    );
  });

  /*
   * A CSV import bumps refreshToggle to refetch the table, the strip and the
   * hierarchy tree. Losing it while adding the query prop would leave the
   * user staring at a table that does not contain what they just imported.
   */
  test("the import refresh still reaches the table", () => {
    expect(SITES_PAGE).toContain("refreshToggle={refreshToggle}");
    expect(SITES_PAGE).toContain(
      "<SiteHierarchyTree refreshToggle={refreshToggle} />",
    );
  });

  test("the selection is seeded from the URL during the first render", () => {
    expect(SITES_PAGE).toContain(
      squash(
        "useState<SiteSummaryFilterKey | null>(() => { return parseSiteSummaryFilterKey( Navigation.getQueryStringByName(SITE_SUMMARY_FILTER_URL_PARAM), ); });",
      ),
    );
  });

  test("changing the filter updates the state and the URL together", () => {
    const body: string = SITES_PAGE.split(
      "const changeSummaryFilter: ChangeSummaryFilterFunction = (",
    )[1]!.split("};")[0]!;

    expect(body).toContain("setSummaryFilterKey(filterKey);");
    expect(body).toContain(
      squash(
        "Navigation.setQueryString({ [SITE_SUMMARY_FILTER_URL_PARAM]: filterKey, });",
      ),
    );
  });

  test("a filtered table says so, and offers a way out", () => {
    expect(SITES_PAGE).toContain(
      squash(
        'topContent={ summaryFilterDefinition ? ( <SummaryFilterChip testIdSuffix="network-sites" label={summaryFilterDefinition.chipLabel} onClear={() => { changeSummaryFilter(null); }} /> ) : undefined }',
      ),
    );
    expect(SITES_PAGE).toContain(
      "noItemsMessage={summaryFilterDefinition?.emptyMessage}",
    );
  });

  describe("the tile that counts devices", () => {
    const handler: string = SITES_PAGE.split(
      "const onSummaryTileClick: OnSummaryTileClickFunction = (",
    )[1]!.split("const tableQuery")[0]!;

    /*
     * "Unassigned Devices" counts devices; this page lists sites. Filtering
     * the sites table by a device predicate would empty it with no
     * explanation, so the tile leaves for the device list instead.
     */
    test("navigates to the device list rather than filtering sites", () => {
      expect(handler).toContain(
        squash(
          "if (tile.action === SiteSummaryTileAction.ShowUnassignedDevices) { Navigation.navigate( getDeviceListRouteForFilter(UNASSIGNED_DEVICES_FILTER_KEY), ); return; }",
        ),
      );
    });

    /*
     * The early return is load-bearing: without it the click would also fall
     * through to changeSummaryFilter and leave a site filter mirrored into
     * the URL of a page the user is walking away from.
     */
    test("returns before the filter branches run", () => {
      const navigateBranch: string = handler.split(
        "SiteSummaryTileAction.ShowUnassignedDevices",
      )[1]!;
      expect(navigateBranch.indexOf("return;")).toBeLessThan(
        navigateBranch.indexOf("changeSummaryFilter"),
      );
    });

    test("names the filter through the shared constant, not a literal", () => {
      expect(handler).toContain("UNASSIGNED_DEVICES_FILTER_KEY");
      expect(handler).not.toContain('"no-site"');
    });
  });

  test("the total tile clears the filter", () => {
    expect(SITES_PAGE).toContain(
      squash(
        "if (tile.action === SiteSummaryTileAction.ClearFilter) { changeSummaryFilter(null); return; }",
      ),
    );
  });

  /*
   * Clicking the tile the table is already showing has to toggle back to
   * every site. Without the equality check the click is a no-op and the tile
   * becomes a one-way door.
   */
  test("clicking the active tile toggles the filter off", () => {
    expect(SITES_PAGE).toContain(
      squash(
        "changeSummaryFilter( tile.filterKey && tile.filterKey !== summaryFilterKey ? tile.filterKey : null, );",
      ),
    );
  });

  /*
   * The Devices page has to disarm its "Last Seen At" column filter while a
   * tile filter is active, because both name `lastSeenAt` and the column
   * filter is spread over the page's query. The Sites table needs none of
   * that machinery only because it offers no filter over the columns its
   * tiles constrain — Name, Site Type and Created.
   *
   * This is the tripwire. Adding a Status filter to the sites table would
   * reintroduce exactly the collision the Devices page has to work around,
   * and would do it silently.
   */
  test("no site column filter collides with what the tiles constrain", () => {
    const filters: string =
      SITES_PAGE.split("filters={[")[1]!.split("formSteps={[")[0]!;

    expect(filters).toContain("name: true");
    expect(filters).not.toContain("currentMonitorStatus");
    expect(filters).not.toContain("currentMonitorStatusId");
  });
});

describe("DeviceSummaryCards", () => {
  /*
   * One source of truth for the tiles. A second, local list here is how the
   * strip and the drill-down queries would drift apart.
   */
  test("renders the shared tile definitions", () => {
    expect(DEVICE_CARDS).toContain(
      "DEVICE_SUMMARY_TILES.map((tile: DeviceSummaryTile) => {",
    );
    expect(DEVICE_CARDS).not.toContain("const tiles: Array<SummaryTile>");
  });

  test("each tile reads its own count off the shared definition", () => {
    expect(DEVICE_CARDS).toContain(
      squash("const count: number = counts?.[tile.countField] || 0;"),
    );
  });

  /*
   * Clicking a skeleton would filter the list by a number nobody has read.
   * The counts and the rows would then disagree with no way to tell why.
   */
  test("tiles are inert until the counts land", () => {
    expect(DEVICE_CARDS).toContain(
      squash(
        "onClick={ props.onFilterKeyChange && !isLoading ? () => { onTileClick(tile); } : undefined }",
      ),
    );
  });

  test("clicking the selected tile clears the filter", () => {
    expect(DEVICE_CARDS).toContain(
      squash(
        "props.onFilterKeyChange( selectedFilterKey === tile.filterKey ? null : tile.filterKey, );",
      ),
    );
  });

  test("the selected tile is marked as such", () => {
    expect(DEVICE_CARDS).toContain(
      squash(
        "const isSelected: boolean = selectedFilterKey === tile.filterKey;",
      ),
    );
    expect(DEVICE_CARDS).toContain("isSelected={isSelected}");
  });

  /*
   * The card is a div, so its label is the only thing a screen reader gets
   * beyond the number. It has to say what activating it does.
   */
  test("each tile announces what activating it does", () => {
    expect(DEVICE_CARDS).toContain("ariaLabel={");
    expect(DEVICE_CARDS).toContain("Activate to show these in the list below.");
    expect(DEVICE_CARDS).toContain("activate to clear the filter.");
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
    expect(SITE_CARDS).not.toContain("const tiles: Array<SummaryTile>");
  });

  test("each tile reads its own count off the shared definition", () => {
    expect(SITE_CARDS).toContain(
      squash("const count: number = counts?.[tile.countField] || 0;"),
    );
  });

  test("tiles are inert until the counts land", () => {
    expect(SITE_CARDS).toContain(
      squash(
        "onClick={ props.onTileClick && !isLoading ? () => { props.onTileClick?.(tile); } : undefined }",
      ),
    );
  });

  /*
   * The card reports which tile was activated and lets the page decide what
   * that means — it is the page, not the strip, that can navigate.
   */
  test("hands the whole tile to the page rather than deciding itself", () => {
    expect(SITE_CARDS).toContain(
      "onTileClick?: ((tile: SiteSummaryTile) => void) | undefined;",
    );
    expect(SITE_CARDS).not.toContain("Navigation.navigate");
  });

  /*
   * The total is the unfiltered list, so it reads as selected when nothing is
   * filtered; the device tile leaves the page and can never be the state the
   * table is in.
   */
  test("only the tiles that describe the table can look selected", () => {
    const body: string = SITE_CARDS.split(
      "const isTileSelected: IsTileSelectedFunction = (",
    )[1]!.split("type TileAriaLabelFunction")[0]!;

    expect(body).toContain(
      squash(
        "if (tile.action === SiteSummaryTileAction.FilterSites) { return Boolean(tile.filterKey) && tile.filterKey === selectedFilterKey; }",
      ),
    );
    expect(body).toContain(
      squash(
        "if (tile.action === SiteSummaryTileAction.ClearFilter) { return selectedFilterKey === null; }",
      ),
    );
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

    expect(body).toContain("return undefined;");
    expect(body).not.toContain("return false;");
    expect(SITE_CARDS).toContain(
      "const isSelected: boolean | undefined = isTileSelected(tile);",
    );
  });

  /*
   * "Activate to show these in the list below" would be a lie on the one tile
   * that navigates away.
   */
  test("the tile that leaves the page says so", () => {
    expect(SITE_CARDS).toContain("Activate to open these on the device list.");
  });

  test("keeps its test ids", () => {
    expect(SITE_CARDS).toContain('data-testid="network-site-summary-cards"');
    expect(SITE_CARDS).toContain(
      "data-testid={`network-site-stat-${tile.key}`}",
    );
  });
});

describe("SummaryFilterChip", () => {
  test("names what the table is narrowed to", () => {
    expect(CHIP).toContain("{props.label}");
    expect(CHIP).toContain("Filtered by");
  });

  /*
   * A real <button>, not another click handler on a div — this is the escape
   * hatch from a filtered view and has to be reachable by keyboard.
   */
  test("the clear control is a labelled button", () => {
    expect(CHIP).toContain('<button type="button"');
    expect(CHIP).toContain("aria-label={`Clear the ${props.label} filter`}");
    expect(CHIP).toContain("onClick={props.onClear}");
  });

  test("both pages can be told apart in the DOM", () => {
    expect(CHIP).toContain(
      "data-testid={`summary-filter-chip-${props.testIdSuffix}`}",
    );
    expect(CHIP).toContain(
      "data-testid={`summary-filter-chip-clear-${props.testIdSuffix}`}",
    );
  });

  /*
   * The qualifier is what lets the Devices page say its up/down window is a
   * snapshot. It has to stay optional — the Sites page passes none, and an
   * empty span next to every chip would read as a missing value.
   */
  test("the snapshot qualifier is optional and rendered only when given", () => {
    expect(CHIP).toContain("detail?: string | undefined;");
    expect(CHIP).toContain("{props.detail ? (");
    expect(CHIP).toContain(
      "data-testid={`summary-filter-chip-detail-${props.testIdSuffix}`}",
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
