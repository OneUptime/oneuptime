import {
  getChartGridStepSeconds,
  getCoarsestChartGridStepWithin,
} from "../../NetworkDevice/ChartGridStep";
import { parseBucketTime } from "../../NetworkDevice/FlowSeriesUtil";
import {
  formatTrafficProtocolPort,
  getBitsPerSecond,
  getPeakBitsPerSecond,
} from "../NetworkTrafficFormat";
import { fillTrafficSeriesGaps } from "../TrafficSeries";
import {
  NetworkTrafficSeriesPoint,
  NetworkTrafficSummary,
} from "Common/Types/NetFlow/NetworkTraffic";
import {
  NetworkTrafficUsageConversationRow,
  NetworkTrafficUsageFilters,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageSeriesPoint,
  NetworkTrafficUsageSummary,
  NetworkTrafficUsageUplinkInterfaceRow,
  NetworkTrafficUsageUplinkSeriesPoint,
  getUsageOctets,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import DataPoint from "Common/UI/Components/Charts/Types/DataPoint";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

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

/*
 * When the applications, destinations and clients a page reads end, if that
 * is before its range begins. Meraki sums them over two hours, so a read
 * lands every two hours and the past hour often holds no window at all: the
 * lists are empty because the next one has not landed yet, not because
 * traffic analysis is off. Null when the range holds a window, or none has
 * ever been read.
 */
export function getNewestAnalyticsBeforeRange(
  summary: Pick<
    NetworkTrafficUsageSummary,
    "lastAnalyticsAt" | "windowStartAt"
  >,
): string | null {
  const start: number = new Date(summary.windowStartAt).getTime();
  const last: number = summary.lastAnalyticsAt
    ? new Date(summary.lastAnalyticsAt).getTime()
    : NaN;

  return summary.lastAnalyticsAt &&
    Number.isFinite(start) &&
    Number.isFinite(last) &&
    last <= start
    ? summary.lastAnalyticsAt
    : null;
}

type ReadSummaryFields = Pick<
  NetworkTrafficUsageSummary,
  | "windowStartAt"
  | "windowEndAt"
  | "primaryKind"
  | "lastUplinkAt"
  | "lastAnalyticsAt"
  | "uplinksReadTo"
>;

/*
 * How far the page's range has been read, in epoch milliseconds: as far as
 * its connections' reads got, or the end of the range when that is sooner.
 * Meraki reports uplinks minutes late, so a range that ends now always has a
 * stretch at its end no read has reached. That stretch holds no traffic
 * because no one has reported any yet, not because the network went quiet.
 *
 * Never the page's newest row: a window nothing crossed stores no row, so a
 * link that went down would look like a page not read yet, and the drop to
 * zero that says it went down would never be drawn. An organization without
 * uplinks has only its newest application window to go by. Null when no part
 * of the range has been read.
 */
export function getReadEndMs(summary: ReadSummaryFields): number | null {
  const start: number = new Date(summary.windowStartAt).getTime();
  const end: number = new Date(summary.windowEndAt).getTime();
  const newest: string | null =
    summary.primaryKind === NetworkTrafficUsageKind.Application
      ? summary.lastAnalyticsAt
      : summary.uplinksReadTo || summary.lastUplinkAt;
  const newestMs: number = newest ? new Date(newest).getTime() : NaN;

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(newestMs) ||
    newestMs <= start
  ) {
    return null;
  }

  return Math.min(end, newestMs);
}

/*
 * The seconds of the range the page's traffic was read over: what an average
 * is taken over. The whole range would count the stretch no read has reached
 * as silence, and put a page's average a quarter below its own chart on the
 * default past hour.
 */
export function getReadSeconds(summary: ReadSummaryFields): number {
  const start: number = new Date(summary.windowStartAt).getTime();
  const end: number = new Date(summary.windowEndAt).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 3600;
  }

  return ((getReadEndMs(summary) ?? end) - start) / 1000;
}

/*
 * The time the page's traffic has been read up to, when that is short of the
 * end of its range by enough to say so. Null when the range is read whole.
 */
export function getReadUpTo(summary: ReadSummaryFields): string | null {
  const end: number = new Date(summary.windowEndAt).getTime();
  const readEnd: number | null = getReadEndMs(summary);

  return readEnd !== null && end - readEnd >= 60 * 1000
    ? new Date(readEnd).toISOString()
    : null;
}

/*
 * A series as a chart draws it: silent buckets put back up to where the
 * range was read and no further, so the line stops where the reads did
 * instead of falling to zero and looking like an outage at the right edge of
 * every chart. A bucket the reads stopped part way through is left out for
 * the same reason: its bytes over its whole width would draw a dip that
 * never happened.
 */
function fillReadSeries(
  series: Array<NetworkTrafficSeriesPoint>,
  summary: ReadSummaryFields &
    Pick<NetworkTrafficUsageSummary, "bucketSeconds">,
): Array<NetworkTrafficSeriesPoint> {
  const windowEnd: number = new Date(summary.windowEndAt).getTime();
  const readEnd: number | null = getReadEndMs(summary);

  if (readEnd === null || readEnd >= windowEnd) {
    return fillTrafficSeriesGaps(
      series,
      summary.bucketSeconds,
      summary.windowStartAt,
      summary.windowEndAt,
    );
  }

  const bucketMs: number = summary.bucketSeconds * 1000;

  const filled: Array<NetworkTrafficSeriesPoint> = fillTrafficSeriesGaps(
    series,
    summary.bucketSeconds,
    summary.windowStartAt,
    new Date(readEnd).toISOString(),
  );

  const whole: Array<NetworkTrafficSeriesPoint> = filled.filter(
    (point: NetworkTrafficSeriesPoint): boolean => {
      return parseBucketTime(point.time) + bucketMs <= readEnd;
    },
  );

  return whole.length > 0 ? whole : filled;
}

// The chart's series, as far as the range was read.
export function getReadSeries(
  summary: NetworkTrafficUsageSummary,
): Array<NetworkTrafficSeriesPoint> {
  return fillReadSeries(toFlowSeries(summary.series), summary);
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

/*
 * How many networks a list's rows are of. Top networks cannot say for the
 * applications and clients: an uplink's filter narrows it and leaves them
 * whole, and it knows no network that sends nothing over an uplink.
 */
export function countListedNetworks(
  rows: Array<{ controllerNetworkName: string }>,
): number {
  return new Set(
    rows
      .map((row: { controllerNetworkName: string }): string => {
        return row.controllerNetworkName;
      })
      .filter(Boolean),
  ).size;
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

// A number the page cannot give: unknown, where a 0 would say there was none.
export const UNKNOWN_VALUE: string = "\u2014";

// Latency, as the comparison's axis and rows write it: "24 ms", "1.2 ms".
export function formatLatency(milliseconds: number): string {
  const amount: string =
    milliseconds < 10
      ? milliseconds.toFixed(1)
      : String(Math.round(milliseconds));

  return `${amount}\u00a0ms`;
}

// Loss, written the same way: "0%", "0.2%", "12%".
export function formatLoss(percent: number): string {
  if (percent === 0) {
    return "0%";
  }

  if (percent < 0.1) {
    return "<0.1%";
  }

  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

// What the comparison's chart shows of each uplink.
export type MerakiUplinkChartMode = "traffic" | "latency" | "loss";

// What the comparison says of one uplink.
export interface MerakiUplinkComparisonRow {
  interfaceName: string;
  applianceCount: number;
  sentOctets: number;
  receivedOctets: number;
  octets: number;
  averageBitsPerSecond: number;
  peakBitsPerSecond: number;
  lossPercent: number | null;
  latencyMs: number | null;
  // Its traffic over time, as far as the range was read.
  series: Array<NetworkTrafficSeriesPoint>;
}

/*
 * The order uplinks are compared in: the WAN links by their number, then
 * whatever else there is (cellular). The same order on every page and every
 * range, so wan1 stays first and keeps its colour however the traffic moves.
 */
export function compareUplinkNames(a: string, b: string): number {
  const isWan: (name: string) => boolean = (name: string): boolean => {
    return name.toLowerCase().startsWith("wan");
  };

  return (
    Number(isWan(b)) - Number(isWan(a)) ||
    a.localeCompare(b, "en", { numeric: true })
  );
}

/*
 * The page's uplinks side by side: what each carried, its average and its
 * peak, and what Meraki measured on it. An uplink's average is over the same
 * read stretch as the page's, and its peak is its own busiest bucket, so the
 * numbers of wan1 and wan2 compare, and a narrowed page's tiles match them.
 */
export function getUplinkComparison(
  summary: NetworkTrafficUsageSummary,
): Array<MerakiUplinkComparisonRow> {
  const seconds: number = getReadSeconds(summary);

  return [...summary.uplinkInterfaces]
    .filter((row: NetworkTrafficUsageUplinkInterfaceRow): boolean => {
      return Boolean(row.interfaceName);
    })
    .sort(
      (
        a: NetworkTrafficUsageUplinkInterfaceRow,
        b: NetworkTrafficUsageUplinkInterfaceRow,
      ): number => {
        return compareUplinkNames(a.interfaceName, b.interfaceName);
      },
    )
    .map(
      (
        row: NetworkTrafficUsageUplinkInterfaceRow,
      ): MerakiUplinkComparisonRow => {
        const series: Array<NetworkTrafficSeriesPoint> = fillReadSeries(
          summary.uplinkSeries
            .filter((point: NetworkTrafficUsageUplinkSeriesPoint): boolean => {
              return point.interfaceName === row.interfaceName;
            })
            .map(
              (
                point: NetworkTrafficUsageUplinkSeriesPoint,
              ): NetworkTrafficSeriesPoint => {
                return {
                  time: point.time,
                  octets: getUsageOctets(point),
                  inOctets: point.receivedOctets,
                  outOctets: point.sentOctets,
                };
              },
            ),
          summary,
        );

        return {
          interfaceName: row.interfaceName,
          applianceCount: row.applianceCount,
          sentOctets: row.sentOctets,
          receivedOctets: row.receivedOctets,
          octets: getUsageOctets(row),
          averageBitsPerSecond: getBitsPerSecond(getUsageOctets(row), seconds),
          peakBitsPerSecond: getPeakBitsPerSecond(
            series,
            summary.bucketSeconds,
          ),
          lossPercent: row.lossPercent,
          latencyMs: row.latencyMs,
          series,
        };
      },
    );
}

/*
 * One line per uplink, of what the chart is showing. Traffic is each bucket's
 * rate, as on the page's own chart; a measurement is its bucket's average,
 * and a bucket with none is no point at all.
 */
export function getUplinkChartLines(data: {
  rows: Array<MerakiUplinkComparisonRow>;
  uplinkSeries: Array<NetworkTrafficUsageUplinkSeriesPoint>;
  bucketSeconds: number;
  mode: MerakiUplinkChartMode;
}): Array<SeriesPoint> {
  return data.rows.map((row: MerakiUplinkComparisonRow): SeriesPoint => {
    const points: Array<DataPoint> = [];

    if (data.mode === "traffic") {
      for (const point of row.series) {
        const bucketMs: number = parseBucketTime(point.time);

        if (Number.isFinite(bucketMs)) {
          points.push({
            x: new Date(bucketMs),
            y: getBitsPerSecond(point.octets, data.bucketSeconds) / 1_000_000,
          });
        }
      }

      return { seriesName: row.interfaceName, data: points };
    }

    for (const point of data.uplinkSeries) {
      const value: number | null =
        data.mode === "latency" ? point.latencyMs : point.lossPercent;
      const bucketMs: number = parseBucketTime(point.time);

      if (
        point.interfaceName === row.interfaceName &&
        value !== null &&
        Number.isFinite(bucketMs)
      ) {
        points.push({ x: new Date(bucketMs), y: value });
      }
    }

    return { seriesName: row.interfaceName, data: points };
  });
}

/*
 * Whether an empty slot on a chart of these buckets means a bucket with
 * nothing in it, so a line may break there to say nobody measured it. That
 * takes a slot for every bucket and nothing else. Most ranges over a few hours
 * have none: a bucket of 12 minutes sits on a grid of 10, whose slots between
 * buckets are always empty, and a line that broke at each would be in pieces
 * for no reason.
 */
export function isEveryChartSlotABucket(bucketSeconds: number): boolean {
  const step: ReturnType<typeof getCoarsestChartGridStepWithin> =
    getCoarsestChartGridStepWithin(bucketSeconds);

  return step !== undefined && getChartGridStepSeconds(step) === bucketSeconds;
}

// Whether Meraki measured any of these uplinks in the range.
export function hasUplinkHealth(
  rows: Array<MerakiUplinkComparisonRow>,
): boolean {
  return rows.some((row: MerakiUplinkComparisonRow): boolean => {
    return row.lossPercent !== null || row.latencyMs !== null;
  });
}

/*
 * Whether the page compares its uplinks: when it has two to compare, or a
 * measurement of one to show. Narrowed to an uplink it always does, so the
 * way back to the others stays on the page.
 */
export function shouldCompareUplinks(
  rows: Array<MerakiUplinkComparisonRow>,
  filters: NetworkTrafficUsageFilters,
): boolean {
  if (rows.length === 0) {
    return false;
  }

  return (
    rows.length > 1 || hasUplinkHealth(rows) || Boolean(filters.interfaceName)
  );
}

/*
 * Whether the page's numbers are held to an appliance or an uplink. Meraki
 * counts applications, destinations, clients and flows per network, so the
 * lists under them stay the network's, and the page says so.
 */
export function isNarrowerThanANetwork(
  filters: NetworkTrafficUsageFilters,
): boolean {
  return Boolean(filters.deviceSerial || filters.interfaceName);
}

// What Meraki calls the far end of a conversation: its host or address, else the application.
export function getConversationTarget(
  row: Pick<NetworkTrafficUsageConversationRow, "destination" | "application">,
): string {
  return row.destination || row.application;
}

/*
 * What else is known of a conversation, beside who it is between, kept to one
 * short line: its protocol and port, and its application when the row is not
 * already named after it.
 */
export function getConversationDetails(
  row: Pick<
    NetworkTrafficUsageConversationRow,
    "destination" | "application" | "protocol" | "port"
  >,
  translator: Translator,
): Array<string> {
  return [
    formatTrafficProtocolPort(row, translator),
    row.destination ? row.application : "",
  ].filter(Boolean);
}
