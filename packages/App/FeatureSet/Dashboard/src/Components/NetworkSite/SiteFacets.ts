/*
 * The vocabulary of the site list's facet bar.
 *
 * The Sites-page counterpart of DeviceFacets, and the same idea: a tile in the
 * summary strip drills in by moving a chip, so the bar is the visible record of
 * why the list is short.
 *
 * Free of React and of the API client so the mapping can be pinned in tests; the
 * chips themselves are assembled on the page, which can call the API for their
 * option lists.
 */

/*
 * Shared by the table's `id`, its `userPreferencesKey` and the URL namespace its
 * filter/facet/view state is persisted under.
 */
export const NETWORK_SITES_TABLE_ID: string = "network-sites-table";

export const SITE_STATUS_FACET_KEY: string = "siteStatus";
export const SITE_TYPE_FACET_KEY: string = "siteType";
export const SITE_PARENT_FACET_KEY: string = "siteParent";

/*
 * The column each chip owns, and so the columns the table's filter popup must
 * not also offer: BaseModelTable spreads the popup's query OVER the page's, so a
 * popup filter on a chip's field replaces the chip's constraint silently, and
 * where the two spell the same column differently (`networkSiteType` vs
 * `networkSiteTypeId`) they survive as an AND that can never match.
 *
 * Every one of these is a foreign key rather than the relation it points at. The
 * "is empty" operator is why: a site with no rolled-up status has no MonitorStatus
 * row to join against, so only the column can be asked for NULL — and that is
 * exactly the row set behind the "Sites Without Data" tile.
 */
export const SITE_FACET_QUERY_FIELDS: {
  status: string;
  siteType: string;
  parentSite: string;
} = {
  status: "currentMonitorStatusId",
  siteType: "networkSiteTypeId",
  parentSite: "parentSiteId",
};
