import { SITE_STATUS_FACET_KEY } from "./SiteFacets";
import { UNASSIGNED_DEVICES_FACET_SELECTION } from "../NetworkDevice/DeviceFacets";
import { FacetTileSelection } from "../ResourceOwners/FacetTileSelection";

/*
 * The Sites-page counterpart of DeviceSummaryTiles: which facet each tile in the
 * summary strip stands for.
 *
 * Three of the four tiles count sites and move a chip on the sites table. The
 * fourth — Unassigned Devices — counts devices, and its rows only exist on the
 * device list, so that tile navigates there with the equivalent chip already set
 * instead of narrowing the sites table to something the count never described.
 */

export enum SiteSummaryTileAction {
  // The total — activating it clears every chip.
  ClearFilters = "clear-filters",
  // Moves a chip on the sites table.
  FilterSites = "filter-sites",
  // Leaves for the device list, which is where these rows live.
  ShowUnassignedDevices = "show-unassigned-devices",
}

/**
 * How a FilterSites tile turns its count into a chip.
 *
 * `Unhealthy` needs the ids of the project's non-operational statuses, which are
 * only known once the counts have been fetched — the strip resolves them from the
 * same response it counted, so the chip selects exactly the statuses behind the
 * number on the tile. `NoData` needs no ids at all: it is the chip's "is empty"
 * operator, i.e. sites with no rolled-up status to select.
 */
export enum SiteSummaryStatusFilter {
  Unhealthy = "unhealthy",
  NoData = "no-data",
}

export interface SiteSummaryTile {
  // Also the `data-testid` suffix and the React key.
  key: string;
  label: string;
  // Which count from the summary fetch this tile displays.
  countField:
    | "totalSites"
    | "unhealthySites"
    | "sitesWithNoData"
    | "devicesWithoutSite";
  attentionClassName: string;
  caption: string;
  action: SiteSummaryTileAction;
  // Set only when the action is FilterSites.
  statusFilter?: SiteSummaryStatusFilter | undefined;
}

export const SITE_SUMMARY_TILES: Array<SiteSummaryTile> = [
  {
    key: "total-sites",
    label: "Sites",
    countField: "totalSites",
    attentionClassName: "text-gray-900",
    caption: "Across the whole hierarchy.",
    action: SiteSummaryTileAction.ClearFilters,
  },
  {
    key: "unhealthy-sites",
    label: "Unhealthy Sites",
    countField: "unhealthySites",
    attentionClassName: "text-red-600",
    caption: "Rolling up a non-operational status.",
    action: SiteSummaryTileAction.FilterSites,
    statusFilter: SiteSummaryStatusFilter.Unhealthy,
  },
  {
    key: "sites-no-data",
    label: "Sites Without Data",
    countField: "sitesWithNoData",
    attentionClassName: "text-gray-500",
    caption: "No health rollup yet — no monitored devices below.",
    action: SiteSummaryTileAction.FilterSites,
    statusFilter: SiteSummaryStatusFilter.NoData,
  },
  {
    key: "devices-without-site",
    label: "Unassigned Devices",
    countField: "devicesWithoutSite",
    attentionClassName: "text-amber-600",
    caption: "Devices not assigned to any site.",
    action: SiteSummaryTileAction.ShowUnassignedDevices,
  },
];

export interface SiteSummaryTileContext {
  /**
   * Ids of the MonitorStatuses the counted sites are rolling up that are not
   * operational. Empty until the counts land, and empty for a fleet that is
   * entirely healthy.
   */
  unhealthyStatusIds: Array<string>;
}

export type GetSiteFacetSelectionForTileFunction = (
  tile: SiteSummaryTile,
  context: SiteSummaryTileContext,
) => FacetTileSelection | null;

/**
 * The chip a tile stands for, or `null` when the tile has no chip on this page
 * to move — the Unassigned Devices tile, whose rows are devices.
 *
 * The Unhealthy tile also returns `null` while its status ids are still unknown:
 * selecting nothing there would clear the chip and show every site under a lit
 * "Unhealthy" tile, which is worse than the click doing nothing.
 */
export const getSiteFacetSelectionForTile: GetSiteFacetSelectionForTileFunction =
  (
    tile: SiteSummaryTile,
    context: SiteSummaryTileContext,
  ): FacetTileSelection | null => {
    if (tile.action === SiteSummaryTileAction.ClearFilters) {
      return { facetKey: null, values: [], operator: "is" };
    }

    if (tile.action !== SiteSummaryTileAction.FilterSites) {
      return null;
    }

    if (tile.statusFilter === SiteSummaryStatusFilter.NoData) {
      return {
        facetKey: SITE_STATUS_FACET_KEY,
        values: [],
        operator: "is_empty",
      };
    }

    if (tile.statusFilter === SiteSummaryStatusFilter.Unhealthy) {
      const unhealthyStatusIds: Array<string> =
        context.unhealthyStatusIds || [];

      if (unhealthyStatusIds.length === 0) {
        return null;
      }

      return {
        facetKey: SITE_STATUS_FACET_KEY,
        // Copied: the caller's array is React state the chip must not alias.
        values: [...unhealthyStatusIds],
        operator: "is",
      };
    }

    return null;
  };

/*
 * The device chip the Unassigned Devices tile hands over to the device list.
 * Re-exported here so the Sites page names it through this module rather than
 * reaching across into the device components for it.
 */
export { UNASSIGNED_DEVICES_FACET_SELECTION };
