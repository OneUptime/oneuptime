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
  };
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

// A client as a person recognises it: its name, else its address, else its MAC.
export function getClientLabel(client: {
  name: string;
  ip: string;
  mac: string;
  clientKey: string;
}): string {
  return client.name || client.ip || client.mac || client.clientKey;
}

// What else is known of a client, beside its label: address, maker, network.
export function getClientDetails(client: {
  name: string;
  ip: string;
  mac: string;
  manufacturer: string;
  controllerNetworkName: string;
}): Array<string> {
  const label: string = client.name || client.ip || client.mac;

  return [
    client.ip !== label ? client.ip : "",
    client.mac !== label ? client.mac : "",
    client.manufacturer,
    client.controllerNetworkName,
  ].filter(Boolean);
}
