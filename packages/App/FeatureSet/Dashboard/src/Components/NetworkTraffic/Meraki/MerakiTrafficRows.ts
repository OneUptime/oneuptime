import {
  NetworkTrafficSeriesPoint,
  NetworkTrafficSummary,
} from "Common/Types/NetFlow/NetworkTraffic";
import {
  NetworkTrafficUsageSeriesPoint,
  NetworkTrafficUsageSummary,
  getUsageOctets,
} from "Common/Types/NetFlow/NetworkTrafficUsage";

/*
 * The Meraki side of a Traffic page drawn with the flow side's own parts -
 * the four tiles and the chart - which read a NetworkTrafficSummary. An
 * uplink's download is "in", its upload "out", and the series is split so
 * the chart draws the two apart.
 *
 * Plain logic, free of React, so App/Tests can read it.
 */

export function toFlowSeries(
  series: Array<NetworkTrafficUsageSeriesPoint>,
): Array<NetworkTrafficSeriesPoint> {
  return series.map(
    (point: NetworkTrafficUsageSeriesPoint): NetworkTrafficSeriesPoint => {
      return {
        time: point.time,
        octets: getUsageOctets(point),
        inOctets: point.receivedOctets,
        outOctets: point.sentOctets,
      };
    },
  );
}

/*
 * A NetworkTrafficSummary of the Meraki numbers, for TrafficSummaryTiles
 * and TrafficOverTimeChart: nothing is sampled, there are no packets, and
 * the lists the flow side has are empty - the Meraki view draws its own.
 */
export function toFlowSummary(
  summary: NetworkTrafficUsageSummary,
): NetworkTrafficSummary {
  return {
    windowStartAt: summary.windowStartAt,
    windowEndAt: summary.windowEndAt,
    bucketSeconds: summary.bucketSeconds,
    totals: {
      octets: getUsageOctets(summary.totals),
      packets: 0,
      flows: summary.totals.flows,
    },
    maxSamplingRate: 1,
    series: toFlowSeries(summary.series),
    topSources: [],
    topDestinations: [],
    topConversations: [],
    topApplications: [],
    topInterfaces: [],
    topDevices: [],
    sources: [],
    lastFlowAt: null,
    addressNames: {},
  };
}

/*
 * When the newest traffic the page has ends - its newest uplink or
 * application window - if that is before the page's range begins: the
 * reads stopped before it (a failing connection, one not read lately).
 * Null when the page has traffic later than that, or none at all.
 */
export function getNewestBeforeRange(
  summary: Pick<
    NetworkTrafficUsageSummary,
    "lastUplinkAt" | "lastAnalyticsAt" | "windowStartAt"
  >,
): string | null {
  const start: number = new Date(summary.windowStartAt).getTime();
  let newest: string | null = null;
  let newestTime: number = -Infinity;

  for (const value of [summary.lastUplinkAt, summary.lastAnalyticsAt]) {
    const time: number = value ? new Date(value).getTime() : NaN;

    if (value && Number.isFinite(time) && time > newestTime) {
      newest = value;
      newestTime = time;
    }
  }

  return newest && Number.isFinite(start) && newestTime < start ? newest : null;
}

// Whether the page has any Meraki traffic in its range.
export function hasMerakiTraffic(summary: NetworkTrafficUsageSummary): boolean {
  return (
    getUsageOctets(summary.totals) > 0 ||
    getUsageOctets(summary.applicationTotals) > 0 ||
    getUsageOctets(summary.clientTotals) > 0 ||
    summary.totals.flows > 0
  );
}

/*
 * Whether the busiest list is of networks or of one network's uplinks: Top
 * networks when the traffic shown is of more than one network, the
 * uplinks otherwise - a branch's page has one network, and its uplinks
 * say more about it than a list of one.
 */
export function shouldListNetworks(
  summary: NetworkTrafficUsageSummary,
): boolean {
  return summary.topNetworks.length > 1;
}

/*
 * Whether the rows a page lists are all of one network: a branch's page, a
 * device's, or a page narrowed to a network. Its rows then never say which
 * network they are of - every one would say the same.
 */
export function isOfOneNetwork(data: {
  filters: { controllerNetworkId?: string | undefined };
  networkCount: number;
}): boolean {
  return Boolean(data.filters.controllerNetworkId) || data.networkCount <= 1;
}

// A client as a person recognises it: its name, else its address, else its MAC.
export function getClientLabel(client: {
  name: string;
  ip: string;
  mac: string;
  clientKey: string;
}): string {
  return client.name || client.ip || client.mac || client.clientKey;
}

/*
 * What else is known of a client, beside its label, kept to one short
 * line: the one other way to find it (a named client's address - or its MAC
 * when it has none - and an unnamed one's MAC), its maker, and its network
 * when the page is of several.
 */
export function getClientDetails(
  client: {
    name: string;
    ip: string;
    mac: string;
    manufacturer: string;
    controllerNetworkName: string;
  },
  options: { withNetwork: boolean },
): Array<string> {
  const otherWayToFindIt: string = client.name
    ? client.ip || client.mac
    : client.ip
      ? client.mac
      : "";

  return [
    otherWayToFindIt,
    client.manufacturer,
    options.withNetwork ? client.controllerNetworkName : "",
  ].filter(Boolean);
}

/*
 * An uplink's appliance - unless the page is that appliance's own - and
 * its network when the page is of several.
 */
export function getUplinkDetails(
  uplink: {
    deviceName: string;
    deviceSerial: string;
    controllerNetworkName: string;
  },
  options: { withAppliance: boolean; withNetwork: boolean },
): Array<string> {
  return [
    options.withAppliance ? uplink.deviceName || uplink.deviceSerial : "",
    options.withNetwork ? uplink.controllerNetworkName : "",
  ].filter(Boolean);
}

/*
 * Whether a destination is an address - IPv4 or IPv6 - drawn in the
 * monospace font addresses are drawn in everywhere on the Traffic pages,
 * rather than a host name ("teams.microsoft.com"), drawn as text. A loop,
 * not a pattern: the value is what Meraki sent.
 */
export function isNetworkAddressText(text: string): boolean {
  if (!text || text.length > 64) {
    return false;
  }

  let dots: number = 0;
  let colons: number = 0;
  let hexLetters: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    const isDigit: boolean = code >= 0x30 && code <= 0x39;
    const isHexLetter: boolean =
      (code >= 0x61 && code <= 0x66) || (code >= 0x41 && code <= 0x46);

    if (code === 0x2e) {
      dots++;
    } else if (code === 0x3a) {
      colons++;
    } else if (isHexLetter) {
      hexLetters++;
    } else if (!isDigit) {
      return false;
    }
  }

  // IPv6 - with an IPv4 tail ("::ffff:10.0.0.1") at most - or IPv4.
  return colons >= 2 || (colons === 0 && dots === 3 && hexLetters === 0);
}
