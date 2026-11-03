import Dictionary from "Common/Types/Dictionary";
import Route from "Common/Types/API/Route";
import { getRouteToPageAnchor } from "Common/UI/Utils/PageAnchor";
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

export const MERAKI_URL_PARAMS: Array<string> = [
  "source",
  "mnet",
  "mdev",
  "mup",
];

/*
 * The id of the network's Meraki connections (MerakiConnectionsCard): a
 * line over the traffic that needs acting on links to it.
 */
export const MERAKI_CONNECTIONS_ANCHOR: string = "traffic-meraki-connections";

/*
 * The network's Traffic page (its route, filled in), on its Meraki side,
 * at its Meraki connections: where a line elsewhere that says a connection
 * needs looking at - "Review" on a device's or a site's Traffic page, a
 * device Meraki has not read again - leads. The card brings itself into
 * view when the page opens there (MerakiConnectionsCard).
 */
export function getMerakiConnectionsRoute(trafficRoute: Route): Route {
  const page: string = trafficRoute.toString().split("#")[0] || "";
  const separator: string = page.includes("?") ? "&" : "?";

  return getRouteToPageAnchor(
    new Route(`${page}${separator}source=${TrafficSide.Meraki}`),
    MERAKI_CONNECTIONS_ANCHOR,
  );
}

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
    ["interfaceName", "mup"],
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
    mup: data.filters.interfaceName || null,
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

export type MerakiFilterKind = "network" | "appliance" | "uplink";

export const FILTER_NETWORK_LABEL: string = translationKey(
  "Network {{network}}",
);
export const FILTER_APPLIANCE_LABEL: string = translationKey(
  "Appliance {{appliance}}",
);
export const FILTER_UPLINK_LABEL: string = translationKey("Uplink {{uplink}}");

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

  if (filters.interfaceName) {
    chips.push({
      kind: "uplink",
      template: FILTER_UPLINK_LABEL,
      values: { uplink: filters.interfaceName },
    });
  }

  return chips;
}

/*
 * The filters without one kind (a chip's x). An appliance is of its network:
 * both go. An uplink's name is no one network's: wan1 stays, of them all.
 */
export function withoutMerakiFilter(
  filters: NetworkTrafficUsageFilters,
  kind: MerakiFilterKind,
): NetworkTrafficUsageFilters {
  const next: NetworkTrafficUsageFilters = { ...filters };

  if (kind === "network") {
    delete next.controllerNetworkId;
    delete next.deviceSerial;
  } else if (kind === "appliance") {
    delete next.deviceSerial;
  } else {
    delete next.interfaceName;
  }

  return next;
}

// The filters narrowed to one network, whichever uplink they were held to.
export function withMerakiNetwork(
  filters: NetworkTrafficUsageFilters,
  controllerNetworkId: string,
): NetworkTrafficUsageFilters {
  return {
    controllerNetworkId,
    ...(filters.interfaceName ? { interfaceName: filters.interfaceName } : {}),
  };
}

/*
 * A click on an uplink in the comparison: the page's uplink by that name
 * across whatever else it is narrowed to, or back when it was narrowed to it.
 */
export function withMerakiUplinkToggled(
  filters: NetworkTrafficUsageFilters,
  interfaceName: string,
): NetworkTrafficUsageFilters {
  return filters.interfaceName === interfaceName
    ? withoutMerakiFilter(filters, "uplink")
    : { ...filters, interfaceName };
}

/*
 * Whether an uplink in the Uplinks list is the one the page is narrowed to:
 * that appliance's uplink of that name. A device's page is of one appliance,
 * so the name alone says.
 */
export function isMerakiApplianceUplinkActive(
  filters: NetworkTrafficUsageFilters,
  uplink: { deviceSerial: string; interfaceName: string },
  options: { isPageOfOneAppliance: boolean },
): boolean {
  return (
    filters.interfaceName === uplink.interfaceName &&
    (options.isPageOfOneAppliance ||
      filters.deviceSerial === uplink.deviceSerial)
  );
}

/*
 * A click on a row of the Uplinks list: that one uplink of that one
 * appliance, the row the reader meant - never the appliance with both of its
 * uplinks, which is what made wan1 and wan2 inseparable. A click on the row
 * the page is narrowed to widens it again.
 */
export function withMerakiApplianceUplinkToggled(
  filters: NetworkTrafficUsageFilters,
  uplink: {
    deviceSerial: string;
    interfaceName: string;
    controllerNetworkId: string;
  },
  options: { isPageOfOneAppliance: boolean },
): NetworkTrafficUsageFilters {
  if (isMerakiApplianceUplinkActive(filters, uplink, options)) {
    return withoutMerakiFilter(
      withoutMerakiFilter(filters, "uplink"),
      "appliance",
    );
  }

  return options.isPageOfOneAppliance
    ? { interfaceName: uplink.interfaceName }
    : {
        controllerNetworkId: uplink.controllerNetworkId,
        deviceSerial: uplink.deviceSerial,
        interfaceName: uplink.interfaceName,
      };
}
