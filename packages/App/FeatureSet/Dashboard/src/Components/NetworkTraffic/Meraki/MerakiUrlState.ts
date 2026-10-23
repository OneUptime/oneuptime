import Dictionary from "Common/Types/Dictionary";
import {
  NetworkTrafficUsageFilters,
  NetworkTrafficUsageFiltersUtil,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Which side of a Traffic page is shown - its flow records, or its traffic
 * as a Meraki connection read it - and what the Meraki side is narrowed
 * to, kept in the URL beside the page's range and flow filters
 * (NetworkTrafficUrlState), so a link lands on the same view.
 *
 * The query string is untrusted input: anything unreadable drops to its
 * default (the side the page picks, no filter) rather than failing.
 *
 * Plain logic, free of React, so App/Tests can read it.
 */

export enum TrafficSide {
  Flows = "flows",
  Meraki = "meraki",
}

export const MERAKI_URL_PARAMS: Array<string> = ["source", "mnet", "mdev"];

// The side the URL asks for, or null to let the page pick.
export function readTrafficSide(
  read: (name: string) => string | null,
): TrafficSide | null {
  const value: string | null = read("source");

  if (value === TrafficSide.Flows) {
    return TrafficSide.Flows;
  }

  if (value === TrafficSide.Meraki) {
    return TrafficSide.Meraki;
  }

  return null;
}

export function readNetworkTrafficUsageFilters(
  read: (name: string) => string | null,
): NetworkTrafficUsageFilters {
  const filters: NetworkTrafficUsageFilters = {};

  for (const [field, param] of [
    ["controllerNetworkId", "mnet"],
    ["deviceSerial", "mdev"],
  ] as Array<[keyof NetworkTrafficUsageFilters, string]>) {
    const raw: string | null = read(param);

    if (!raw) {
      continue;
    }

    try {
      Object.assign(
        filters,
        NetworkTrafficUsageFiltersUtil.sanitize({ [field]: raw }),
      );
    } catch {
      // Not a value the server would take: left out.
    }
  }

  return filters;
}

/*
 * The params to write: the side only when it was picked, the filters only
 * while they are set - a default leaves the URL.
 */
export function toMerakiUrlParams(data: {
  source: TrafficSide | null;
  filters: NetworkTrafficUsageFilters;
}): Dictionary<string | null> {
  return {
    source: data.source,
    mnet: data.filters.controllerNetworkId || null,
    mdev: data.filters.deviceSerial || null,
  };
}

/*
 * The side a page shows: the one picked, when the page has it; else Meraki
 * when the page has nothing from flow records yet but has Meraki traffic,
 * and flow records otherwise - so a page that worked before a connection
 * was made opens as it did.
 */
export function pickTrafficSide(data: {
  picked: TrafficSide | null;
  isMerakiAvailable: boolean;
  hasFlows: boolean;
}): TrafficSide {
  if (!data.isMerakiAvailable) {
    return TrafficSide.Flows;
  }

  if (data.picked) {
    return data.picked;
  }

  return data.hasFlows ? TrafficSide.Flows : TrafficSide.Meraki;
}

export type MerakiFilterKind = "network" | "appliance";

export const FILTER_NETWORK_LABEL: string = translationKey(
  "Network {{network}}",
);
export const FILTER_APPLIANCE_LABEL: string = translationKey(
  "Appliance {{appliance}}",
);

export interface MerakiFilterChip {
  kind: MerakiFilterKind;
  template: string;
  values: Dictionary<string>;
}

export function getMerakiFilterChips(
  filters: NetworkTrafficUsageFilters,
  names: {
    networkName?: string | undefined;
    applianceName?: string | undefined;
  },
): Array<MerakiFilterChip> {
  const chips: Array<MerakiFilterChip> = [];

  if (filters.controllerNetworkId) {
    chips.push({
      kind: "network",
      template: FILTER_NETWORK_LABEL,
      values: { network: names.networkName || filters.controllerNetworkId },
    });
  }

  if (filters.deviceSerial) {
    chips.push({
      kind: "appliance",
      template: FILTER_APPLIANCE_LABEL,
      values: { appliance: names.applianceName || filters.deviceSerial },
    });
  }

  return chips;
}

// The filters without one kind (a chip's x). An appliance is of its network: both go.
export function withoutMerakiFilter(
  filters: NetworkTrafficUsageFilters,
  kind: MerakiFilterKind,
): NetworkTrafficUsageFilters {
  const next: NetworkTrafficUsageFilters = { ...filters };

  if (kind === "network") {
    delete next.controllerNetworkId;
    delete next.deviceSerial;
  } else {
    delete next.deviceSerial;
  }

  return next;
}
