import {
  DEVICE_INTERFACES_FACET_KEY,
  DEVICE_STATUS_FACET_KEY,
  DeviceInterfacesFacetValue,
  DeviceStatusFacetValue,
} from "./DeviceFacets";
import { FacetTileSelection } from "../ResourceOwners/FacetTileSelection";
import { NETWORK_DEVICE_METRIC_DESCRIPTIONS } from "../MetricDescriptions/NetworkDeviceMetricDescriptions";

/*
 * The summary strip above the device list is a set of counts, and every one of
 * them answers a question the user immediately wants the rows for — "three
 * devices are down, which three?".
 *
 * This module is the single place that says which facet each tile stands for, so
 * the number on a tile and the rows its click produces can never drift apart.
 * The counts themselves are fetched in DeviceSummaryCards, the rows by the
 * ModelTable on the Devices page, and both are built from the definitions here.
 */

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
  /*
   * What the count means, in the (i) beside the label. The caption under the
   * number is the one-line answer; this is the whole of it — which check
   * decides, and that the count is the project's, not the filtered list's.
   */
  description: string;
  /**
   * The facet chip and value that produce exactly the rows this tile counted.
   * Every device tile has one — no tile here counts rows that live on another
   * page.
   */
  selection: FacetTileSelection;
}

export const DEVICE_SUMMARY_TILES: Array<DeviceSummaryTile> = [
  {
    key: "devices-up",
    label: "Devices Up",
    countField: "devicesUp",
    attentionClassName: "text-emerald-600",
    allClearClassName: "text-gray-900",
    caption:
      "The last poll (ping or SNMP), or the bound monitor, reached the device.",
    description: NETWORK_DEVICE_METRIC_DESCRIPTIONS.devicesUp,
    selection: {
      facetKey: DEVICE_STATUS_FACET_KEY,
      values: [DeviceStatusFacetValue.Up],
      operator: "is",
    },
  },
  {
    key: "devices-down",
    label: "Devices Down",
    countField: "devicesDown",
    attentionClassName: "text-red-600",
    allClearClassName: "text-gray-900",
    caption:
      "The last poll (ping or SNMP), or the bound monitor, could not reach the device.",
    description: NETWORK_DEVICE_METRIC_DESCRIPTIONS.devicesDown,
    selection: {
      facetKey: DEVICE_STATUS_FACET_KEY,
      values: [DeviceStatusFacetValue.Down],
      operator: "is",
    },
  },
  {
    key: "devices-pending",
    label: "Devices Pending",
    countField: "devicesPending",
    attentionClassName: "text-gray-500",
    allClearClassName: "text-gray-900",
    caption:
      "No verdict yet — never polled, no probe assigned, or no monitor bound.",
    description: NETWORK_DEVICE_METRIC_DESCRIPTIONS.devicesPending,
    selection: {
      facetKey: DEVICE_STATUS_FACET_KEY,
      values: [DeviceStatusFacetValue.Pending],
      operator: "is",
    },
  },
  {
    /*
     * The count is of interfaces, not devices, so the row count under it is
     * smaller than the number on the tile whenever one device has several
     * interfaces down. The chip reads "Interfaces is Some down" for exactly that
     * reason — it describes the devices, not the interfaces.
     */
    key: "interfaces-down",
    label: "Total Interfaces Down",
    countField: "interfacesDown",
    attentionClassName: "text-red-600",
    allClearClassName: "text-gray-900",
    caption: "Across all devices in this project.",
    description: NETWORK_DEVICE_METRIC_DESCRIPTIONS.totalInterfacesDown,
    selection: {
      facetKey: DEVICE_INTERFACES_FACET_KEY,
      values: [DeviceInterfacesFacetValue.SomeDown],
      operator: "is",
    },
  },
];
