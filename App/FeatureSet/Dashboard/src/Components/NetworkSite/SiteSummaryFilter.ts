import { DeviceSummaryFilterKey } from "../NetworkDevice/DeviceSummaryFilter";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import Query from "Common/Types/BaseDatabase/Query";

/*
 * The Sites page counterpart of DeviceSummaryFilter: maps each tile in the
 * summary strip to the rows it counted.
 *
 * Three of the four tiles count sites and narrow the sites table. The fourth
 * — Unassigned Devices — counts devices, and its rows only exist on the
 * device list, so that tile navigates there instead of filtering in place.
 */

export enum SiteSummaryFilterKey {
  Unhealthy = "unhealthy",
  NoData = "no-data",
}

// The query-string parameter the selected tile is mirrored into.
export const SITE_SUMMARY_FILTER_URL_PARAM: string = "siteFilter";

export interface SiteSummaryFilterDefinition {
  key: SiteSummaryFilterKey;
  // Shown on the chip above the table while this filter is applied.
  chipLabel: string;
  // Replaces the table's generic "no items" copy while this filter is applied.
  emptyMessage: string;
}

const DEFINITIONS: Record<SiteSummaryFilterKey, SiteSummaryFilterDefinition> = {
  [SiteSummaryFilterKey.Unhealthy]: {
    key: SiteSummaryFilterKey.Unhealthy,
    chipLabel: "Unhealthy sites",
    emptyMessage: "Every site with a health rollup is operational.",
  },
  [SiteSummaryFilterKey.NoData]: {
    key: SiteSummaryFilterKey.NoData,
    chipLabel: "Sites without data",
    emptyMessage: "Every site is rolling up a status.",
  },
};

export function getSiteSummaryFilterDefinition(
  key: SiteSummaryFilterKey,
): SiteSummaryFilterDefinition {
  return DEFINITIONS[key];
}

/*
 * Anything arriving from the URL is user-editable, so an unknown value has to
 * read as "no filter" rather than reaching the query builder.
 */
export function parseSiteSummaryFilterKey(
  raw: string | null | undefined,
): SiteSummaryFilterKey | null {
  if (!raw) {
    return null;
  }

  const match: SiteSummaryFilterKey | undefined = Object.values(
    SiteSummaryFilterKey,
  ).find((key: SiteSummaryFilterKey) => {
    return key === raw;
  });

  return match || null;
}

/*
 * The query fragment for a tile, to merge into the site table's base query.
 * `null` means no tile is selected.
 *
 * The two are mutually exclusive by construction: "unhealthy" joins the
 * rolled-up status and asks for a non-operational one, which requires the FK
 * to be set; "no data" is that same FK being NULL. A site with an operational
 * rollup matches neither, which is why the two counts do not sum to the site
 * total.
 */
export function getSiteSummaryFilterQuery(
  key: SiteSummaryFilterKey | null,
): Query<NetworkSite> {
  if (!key) {
    return {};
  }

  switch (key) {
    case SiteSummaryFilterKey.Unhealthy:
      return {
        currentMonitorStatus: {
          isOperationalState: false,
        },
      };

    /*
     * Filtered on the FK rather than the relation: a site with no rollup has
     * no MonitorStatus row to match against, so there is nothing to join.
     */
    case SiteSummaryFilterKey.NoData:
      return {
        currentMonitorStatusId: new IsNull(),
      };

    default:
      return {};
  }
}

export enum SiteSummaryTileAction {
  // The total — clicking it takes the user back to the unfiltered list.
  ClearFilter = "clear-filter",
  // Narrows the sites table in place.
  FilterSites = "filter-sites",
  // Leaves for the device list, which is where these rows live.
  ShowUnassignedDevices = "show-unassigned-devices",
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
  filterKey?: SiteSummaryFilterKey | undefined;
}

export const SITE_SUMMARY_TILES: Array<SiteSummaryTile> = [
  {
    key: "total-sites",
    label: "Sites",
    countField: "totalSites",
    attentionClassName: "text-gray-900",
    caption: "Across the whole hierarchy.",
    action: SiteSummaryTileAction.ClearFilter,
  },
  {
    key: "unhealthy-sites",
    label: "Unhealthy Sites",
    countField: "unhealthySites",
    attentionClassName: "text-red-600",
    caption: "Rolling up a non-operational status.",
    action: SiteSummaryTileAction.FilterSites,
    filterKey: SiteSummaryFilterKey.Unhealthy,
  },
  {
    key: "sites-no-data",
    label: "Sites Without Data",
    countField: "sitesWithNoData",
    attentionClassName: "text-gray-500",
    caption: "No health rollup yet — no monitored devices below.",
    action: SiteSummaryTileAction.FilterSites,
    filterKey: SiteSummaryFilterKey.NoData,
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

/*
 * The device filter the Unassigned Devices tile hands over to the device
 * list. Named here so the two pages cannot disagree about which filter that
 * tile means.
 */
export const UNASSIGNED_DEVICES_FILTER_KEY: DeviceSummaryFilterKey =
  DeviceSummaryFilterKey.NoSite;
