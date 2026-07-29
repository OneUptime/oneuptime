import { DEVICE_FRESH_WINDOW_MINUTES } from "./DeviceStatusUtil";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import Query from "Common/Types/BaseDatabase/Query";
import OneUptimeDate from "Common/Types/Date";

/*
 * The summary strip above the device list is a set of counts, and every one
 * of them answers a question the user immediately wants the rows for — "three
 * devices are down, which three?". This module is the single place that maps
 * a tile to the query that produces exactly the rows it counted, so the tile
 * and the list can never drift apart.
 *
 * It is deliberately free of React: the counts are fetched in
 * DeviceSummaryCards, the rows are fetched by the ModelTable on the Devices
 * page, and both build their query from here.
 */

export enum DeviceSummaryFilterKey {
  Up = "up",
  Down = "down",
  Pending = "pending",
  InterfacesDown = "interfaces-down",
  /*
   * Not one of the device tiles — this is where the Sites page's "Unassigned
   * Devices" tile lands, because the rows behind that count are devices, and
   * the device list is the only page that shows them.
   */
  NoSite = "no-site",
}

// The query-string parameter the selected tile is mirrored into.
export const DEVICE_SUMMARY_FILTER_URL_PARAM: string = "deviceFilter";

export interface DeviceSummaryFilterDefinition {
  key: DeviceSummaryFilterKey;
  // Shown on the chip above the table while this filter is applied.
  chipLabel: string;
  // Replaces the table's generic "no items" copy while this filter is applied.
  emptyMessage: string;
}

const DEFINITIONS: Record<
  DeviceSummaryFilterKey,
  DeviceSummaryFilterDefinition
> = {
  [DeviceSummaryFilterKey.Up]: {
    key: DeviceSummaryFilterKey.Up,
    chipLabel: "Devices up",
    emptyMessage: `No device has been polled successfully in the last ${DEVICE_FRESH_WINDOW_MINUTES} minutes.`,
  },
  [DeviceSummaryFilterKey.Down]: {
    key: DeviceSummaryFilterKey.Down,
    chipLabel: "Devices down / stale",
    emptyMessage: `Every device has been polled successfully in the last ${DEVICE_FRESH_WINDOW_MINUTES} minutes.`,
  },
  [DeviceSummaryFilterKey.Pending]: {
    key: DeviceSummaryFilterKey.Pending,
    chipLabel: "Devices pending",
    emptyMessage: "Every device has been polled successfully at least once.",
  },
  [DeviceSummaryFilterKey.InterfacesDown]: {
    key: DeviceSummaryFilterKey.InterfacesDown,
    chipLabel: "Devices with interfaces down",
    emptyMessage: "No device in this project has an interface down.",
  },
  [DeviceSummaryFilterKey.NoSite]: {
    key: DeviceSummaryFilterKey.NoSite,
    chipLabel: "Devices not assigned to a site",
    emptyMessage: "Every device is assigned to a site.",
  },
};

export function getDeviceSummaryFilterDefinition(
  key: DeviceSummaryFilterKey,
): DeviceSummaryFilterDefinition {
  return DEFINITIONS[key];
}

/*
 * Anything arriving from the URL is user-editable, so an unknown value has to
 * read as "no filter" rather than reaching the query builder.
 */
export function parseDeviceSummaryFilterKey(
  raw: string | null | undefined,
): DeviceSummaryFilterKey | null {
  if (!raw) {
    return null;
  }

  const match: DeviceSummaryFilterKey | undefined = Object.values(
    DeviceSummaryFilterKey,
  ).find((key: DeviceSummaryFilterKey) => {
    return key === raw;
  });

  return match || null;
}

/*
 * The instant that separates "up" from "stale". Shared with
 * DeviceSummaryCards so the tile's count and the rows behind it are computed
 * against the same window — mirrors DeviceStatusUtil.getStatus, which is what
 * decides the pill in the Status column.
 */
export function getDeviceFreshCutoff(): Date {
  return OneUptimeDate.getSomeMinutesAgo(DEVICE_FRESH_WINDOW_MINUTES);
}

/*
 * The query fragment for a tile, to merge into the device table's base query.
 * `null` means no tile is selected, which is an empty fragment rather than a
 * special case at every call site.
 *
 * Up / Down / Pending partition the fleet exactly: >= cutoff, < cutoff, and
 * NULL. SQL drops NULLs from both comparisons, so a never-polled device lands
 * in Pending only, and the three counts always sum to the fleet size.
 */
export function getDeviceSummaryFilterQuery(
  key: DeviceSummaryFilterKey | null,
): Query<NetworkDevice> {
  if (!key) {
    return {};
  }

  switch (key) {
    case DeviceSummaryFilterKey.Up:
      return {
        lastSeenAt: new GreaterThanOrEqual(getDeviceFreshCutoff()),
      };

    case DeviceSummaryFilterKey.Down:
      return {
        lastSeenAt: new LessThan(getDeviceFreshCutoff()),
      };

    case DeviceSummaryFilterKey.Pending:
      return {
        lastSeenAt: new IsNull(),
      };

    /*
     * The tile counts interfaces, not devices, so the row count under it will
     * be smaller than the number on the tile whenever a device has more than
     * one interface down. The chip says "devices with interfaces down" for
     * exactly that reason.
     */
    case DeviceSummaryFilterKey.InterfacesDown:
      return {
        interfacesDown: new GreaterThan(0),
      };

    case DeviceSummaryFilterKey.NoSite:
      return {
        siteId: new IsNull(),
      };

    default:
      return {};
  }
}

/*
 * The table-column filters a tile filter would end up fighting with, named by
 * the field key the ModelTable declares them under.
 *
 * BaseModelTable builds its request as `{...props.query, ...columnFilterQuery}`
 * — the user's column filters are spread OVER the page's query. A column
 * filter on the same field therefore replaces the tile's constraint outright,
 * silently, while the chip and the lit-up tile keep claiming it applies. And
 * where the two use different keys for the same relation (`siteId` vs `site`)
 * they survive as an AND that can never match, emptying the table.
 *
 * So the page drops these from the filter set for as long as a tile filter is
 * active: the drill-down and the column filter are alternatives, not layers.
 */
export function getDeviceSummaryFilterConflictingFilterFields(
  key: DeviceSummaryFilterKey | null,
): Array<string> {
  if (!key) {
    return [];
  }

  switch (key) {
    case DeviceSummaryFilterKey.Up:
    case DeviceSummaryFilterKey.Down:
    case DeviceSummaryFilterKey.Pending:
      return ["lastSeenAt"];

    /*
     * The device list filters sites through the relation ("Site"), while the
     * count and this filter use the foreign key — different keys, same column.
     */
    case DeviceSummaryFilterKey.NoSite:
      return ["site", "siteId"];

    // No column filter is offered over interface counts.
    case DeviceSummaryFilterKey.InterfacesDown:
      return [];

    default:
      return [];
  }
}

/*
 * Whether this filter is defined against the freshness window, and so against
 * a cutoff taken at the moment the tile was activated. The page tells the user
 * when that was, because the Status column recomputes the same window on every
 * render — leave the page open long enough and an "up" row paints a Down pill
 * unless the snapshot is labelled.
 */
export function isDeviceSummaryFilterTimeBased(
  key: DeviceSummaryFilterKey | null,
): boolean {
  return (
    key === DeviceSummaryFilterKey.Up || key === DeviceSummaryFilterKey.Down
  );
}

export interface DeviceSummaryTile {
  // Also the `data-testid` suffix and the React key.
  key: string;
  label: string;
  // Which count from the summary fetch this tile displays.
  countField: "devicesUp" | "devicesDown" | "devicesPending" | "interfacesDown";
  // css class for the count when it needs attention (count > 0).
  attentionClassName: string;
  // css class for the count when everything is fine (count === 0).
  allClearClassName: string;
  caption: string;
  // The rows behind this count. Every device tile has one.
  filterKey: DeviceSummaryFilterKey;
}

export const DEVICE_SUMMARY_TILES: Array<DeviceSummaryTile> = [
  {
    key: "devices-up",
    label: "Devices Up",
    countField: "devicesUp",
    attentionClassName: "text-emerald-600",
    allClearClassName: "text-gray-900",
    caption: `Polled within the last ${DEVICE_FRESH_WINDOW_MINUTES} minutes.`,
    filterKey: DeviceSummaryFilterKey.Up,
  },
  {
    key: "devices-down",
    label: "Devices Down / Stale",
    countField: "devicesDown",
    attentionClassName: "text-red-600",
    allClearClassName: "text-gray-900",
    caption: `No successful poll in the last ${DEVICE_FRESH_WINDOW_MINUTES} minutes.`,
    filterKey: DeviceSummaryFilterKey.Down,
  },
  {
    key: "devices-pending",
    label: "Devices Pending",
    countField: "devicesPending",
    attentionClassName: "text-gray-500",
    allClearClassName: "text-gray-900",
    caption: "Never polled successfully yet.",
    filterKey: DeviceSummaryFilterKey.Pending,
  },
  {
    key: "interfaces-down",
    label: "Total Interfaces Down",
    countField: "interfacesDown",
    attentionClassName: "text-red-600",
    allClearClassName: "text-gray-900",
    caption: "Across all devices in this project.",
    filterKey: DeviceSummaryFilterKey.InterfacesDown,
  },
];
