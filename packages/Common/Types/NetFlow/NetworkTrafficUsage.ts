import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import { NetworkControllerConnectionStatus } from "../NetworkController/NetworkControllerConnectionHealth";
import { getNetworkTrafficBucketSeconds } from "./NetworkTraffic";

/*
 * TRAFFIC A NETWORK'S CONTROLLER REPORTS, as the Traffic pages ask for it
 * and draw it (POST /network-traffic/usage-summary): the page of a device,
 * a site or the whole network, from a Meraki connection rather than from
 * flow records.
 *
 * Meraki's dashboard API reports traffic as totals, not as flows:
 *
 *   - uplink usage: the bytes each appliance (MX, Z) sent and received on
 *     each of its uplinks - wan1, wan2, cellular - over a window, for the
 *     whole organization in one call; read every few minutes;
 *   - application usage: per network, the bytes of each application and
 *     destination (Meraki's own names: "Microsoft Teams", "YouTube"), with
 *     the flows and clients it counted; aggregated by Meraki over two hours
 *     at least, so read every two hours;
 *   - client usage: per network, the bytes each client sent and received;
 *     read with the applications;
 *   - uplink health: the packet loss and latency Meraki measures on each
 *     appliance's uplinks, for the whole organization in one call; read
 *     with the uplink usage, in five-minute windows.
 *
 * Each read is stored as rows covering the window it read
 * (NetworkTrafficUsage). A page's numbers are those windows' share of the
 * page's time range: a window wholly inside counts whole, one that runs
 * past an edge counts for the part inside - so a range shorter than a
 * two-hour application window shows an estimate, and the page says so.
 *
 * There are no conversations between addresses: the API says what each
 * network reached, never which client talked to it. Those stay NetFlow's
 * (NetworkTraffic), and so do packet counts: no call counts an uplink's
 * packets or errors.
 */

export enum NetworkTrafficUsageKind {
  Uplink = "uplink",
  Application = "application",
  Client = "client",
  UplinkHealth = "uplinkHealth",
}

export const NETWORK_TRAFFIC_USAGE_KINDS: ReadonlyArray<NetworkTrafficUsageKind> =
  [
    NetworkTrafficUsageKind.Uplink,
    NetworkTrafficUsageKind.Application,
    NetworkTrafficUsageKind.Client,
    NetworkTrafficUsageKind.UplinkHealth,
  ];

/*
 * The kinds of an appliance's uplinks. One call reads them for the whole
 * organization, so a window of them is the organization's rather than a
 * network's, and a row of them belongs to its appliance's device.
 */
export function isUplinkUsageKind(kind: NetworkTrafficUsageKind): boolean {
  return (
    kind === NetworkTrafficUsageKind.Uplink ||
    kind === NetworkTrafficUsageKind.UplinkHealth
  );
}

// Rows in each top table.
export const NETWORK_TRAFFIC_USAGE_TOP_LIMIT: number = 10;

/*
 * The longest window one row may cover - a first read's backfill of a
 * day, ending when the read asked for it, up to a read's few minutes after
 * it began - with room to spare: what a read looks back past the page's
 * start to find windows that run into it.
 */
export const MAX_NETWORK_TRAFFIC_USAGE_WINDOW_HOURS: number = 25;

// The shortest window there is: one uplink read.
export const NETWORK_TRAFFIC_USAGE_UPLINK_WINDOW_SECONDS: number = 300;

/*
 * The chart's bucket width: what the flow pages use (about 120 points a
 * window), but never shorter than one uplink window - a bucket narrower
 * than the windows would draw each window as a spike and a gap.
 */
export function getNetworkTrafficUsageBucketSeconds(
  windowInSeconds: number,
): number {
  return Math.max(
    NETWORK_TRAFFIC_USAGE_UPLINK_WINDOW_SECONDS,
    getNetworkTrafficBucketSeconds(windowInSeconds),
  );
}

export interface NetworkTrafficUsageFilters {
  // One of the controller's networks (a Meraki network's ID, "L_123...").
  controllerNetworkId?: string | undefined;
  // One appliance, by its serial ("Q2XX-XXXX-XXXX").
  deviceSerial?: string | undefined;
  /*
   * One uplink, by its name ("wan1"): the appliance's when one is picked,
   * every appliance's on the page otherwise.
   */
  interfaceName?: string | undefined;
}

export interface NetworkTrafficUsageRequest {
  // A device's page.
  networkDeviceId?: string | undefined;
  // A site's page. Neither: the whole network.
  networkSiteId?: string | undefined;
  startTime: string;
  endTime: string;
  filters?: NetworkTrafficUsageFilters | undefined;
}

export interface NetworkTrafficUsageTotals {
  /*
   * Through the appliances' uplinks - sent is upload, received download -
   * or, for an organization without appliances, the applications' bytes.
   */
  sentOctets: number;
  receivedOctets: number;
  // Flows Meraki's traffic analytics counted.
  flows: number;
}

// One kind's bytes in the range: what a top list's shares are of.
export interface NetworkTrafficUsageKindTotals {
  sentOctets: number;
  receivedOctets: number;
}

export interface NetworkTrafficUsageSeriesPoint {
  // Bucket start, as the database returns it (UTC).
  time: string;
  sentOctets: number;
  receivedOctets: number;
}

export interface NetworkTrafficUsageNetworkRow {
  controllerNetworkId: string;
  name: string;
  sentOctets: number;
  receivedOctets: number;
}

// One uplink of one appliance: wan1 of the branch's MX.
export interface NetworkTrafficUsageUplinkRow {
  deviceSerial: string;
  deviceName: string;
  controllerNetworkId: string;
  controllerNetworkName: string;
  interfaceName: string;
  sentOctets: number;
  receivedOctets: number;
  // The OneUptime device the appliance is, when it is one.
  networkDeviceId?: string | undefined;
}

/*
 * One uplink across the page, by its name: wan1 of every appliance the page
 * is of, beside wan2 and cellular. What the page compares its uplinks by. An
 * uplink that carried nothing and was still measured is listed too: the
 * standby line of a pair, ready and healthy.
 */
export interface NetworkTrafficUsageUplinkInterfaceRow {
  interfaceName: string;
  // How many appliances carried traffic on it in the range.
  applianceCount: number;
  sentOctets: number;
  receivedOctets: number;
  // The averages of what Meraki measured on it; null when it measured nothing.
  lossPercent: number | null;
  latencyMs: number | null;
}

// One bucket of one uplink, for the chart that compares them.
export interface NetworkTrafficUsageUplinkSeriesPoint {
  // Bucket start, as the database returns it (UTC).
  time: string;
  interfaceName: string;
  sentOctets: number;
  receivedOctets: number;
  // Null when Meraki measured nothing in the bucket: unknown, never zero.
  lossPercent: number | null;
  latencyMs: number | null;
}

export interface NetworkTrafficUsageApplicationRow {
  application: string;
  // The protocol and port most of its bytes were ("" and 0 when Meraki gave none).
  protocol: string;
  port: number;
  sentOctets: number;
  receivedOctets: number;
  flows: number;
}

export interface NetworkTrafficUsageDestinationRow {
  destination: string;
  // The application, protocol and port most of its bytes were.
  application: string;
  protocol: string;
  port: number;
  sentOctets: number;
  receivedOctets: number;
}

/*
 * What Meraki says of who talks to whom: one network's traffic with one
 * destination over one protocol and port. The closest the dashboard API
 * comes to a conversation, since it never names the client behind it.
 */
export interface NetworkTrafficUsageConversationRow {
  controllerNetworkId: string;
  controllerNetworkName: string;
  // The host or address, or "" when Meraki names only the application.
  destination: string;
  application: string;
  protocol: string;
  port: number;
  sentOctets: number;
  receivedOctets: number;
  flows: number;
  // The most clients Meraki counted for it over one window.
  clients: number;
}

export interface NetworkTrafficUsageClientRow {
  clientKey: string;
  // What Meraki calls it: the name its owner gave it, else its hostname.
  name: string;
  ip: string;
  mac: string;
  manufacturer: string;
  controllerNetworkName: string;
  sentOctets: number;
  receivedOctets: number;
}

// A connection, as a Traffic page says how it is doing.
export interface NetworkTrafficUsageConnection {
  id: string;
  name: string;
  provider: string;
  organizationName: string;
  status: NetworkControllerConnectionStatus;
  readIntervalInMinutes: number;
  lastPulledAt?: string | undefined;
  lastSuccessfulPullAt?: string | undefined;
  lastError?: string | undefined;
  // The first warning of the last read, when it worked in part.
  warning?: string | undefined;
}

export interface NetworkTrafficUsageSummary {
  /*
   * Whether the page has this source at all: the whole network's page when
   * the project has a connection; a device's or a site's when the
   * connection read traffic of it. When false, nothing else is filled in.
   */
  isAvailable: boolean;
  windowStartAt: string;
  windowEndAt: string;
  bucketSeconds: number;
  totals: NetworkTrafficUsageTotals;
  // What the totals, the chart and Top networks are of.
  primaryKind: NetworkTrafficUsageKind;
  applicationTotals: NetworkTrafficUsageKindTotals;
  clientTotals: NetworkTrafficUsageKindTotals;
  series: Array<NetworkTrafficUsageSeriesPoint>;
  topNetworks: Array<NetworkTrafficUsageNetworkRow>;
  topUplinks: Array<NetworkTrafficUsageUplinkRow>;
  /*
   * The page's uplinks side by side: held to the network and the appliance
   * but not to an uplink filter, so narrowing to wan2 still shows wan1 to
   * compare it with and to switch to.
   */
  uplinkInterfaces: Array<NetworkTrafficUsageUplinkInterfaceRow>;
  uplinkSeries: Array<NetworkTrafficUsageUplinkSeriesPoint>;
  topApplications: Array<NetworkTrafficUsageApplicationRow>;
  topDestinations: Array<NetworkTrafficUsageDestinationRow>;
  topClients: Array<NetworkTrafficUsageClientRow>;
  topConversations: Array<NetworkTrafficUsageConversationRow>;
  /*
   * The end of the newest uplink window and of the newest application
   * window this page has (within retention, whatever the range): how fresh
   * the page is. Null when there is none.
   */
  lastUplinkAt: string | null;
  lastAnalyticsAt: string | null;
  /*
   * How far the page's uplinks have been read: the end of the newest window
   * its connections read, traffic or none. A window nothing crossed stores no
   * row, so lastUplinkAt says when the page's traffic stopped, which is not
   * how far it was read: an uplink that went down would read as a page not
   * read yet, with no drop to show for it. Null when no uplink is on the page.
   */
  uplinksReadTo: string | null;
  connections: Array<NetworkTrafficUsageConnection>;
}

// The longest ID or serial a filter takes.
const MAX_FILTER_VALUE_LENGTH: number = 64;

/*
 * Letters, digits, "_" and "-": every Meraki network ID and serial is
 * these. A loop: the value is untrusted text.
 */
function isIdentifierText(text: string): boolean {
  if (!text || text.length > MAX_FILTER_VALUE_LENGTH) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    const isDigit: boolean = code >= 0x30 && code <= 0x39;
    const isUpper: boolean = code >= 0x41 && code <= 0x5a;
    const isLower: boolean = code >= 0x61 && code <= 0x7a;

    if (!isDigit && !isUpper && !isLower && code !== 0x5f && code !== 0x2d) {
      return false;
    }
  }

  return true;
}

/*
 * An uplink's name is whatever the controller calls it, kept as it came
 * (wan1, cellular) with its control characters cleaned away, so a filter
 * takes any such text: a row it lists can always be narrowed to. A loop: the
 * value is untrusted text.
 */
function isUplinkNameText(text: string): boolean {
  if (!text || text.length > MAX_FILTER_VALUE_LENGTH) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return false;
    }
  }

  return true;
}

export class NetworkTrafficUsageFiltersUtil {
  /*
   * The filters a request carries, checked: a network ID and a serial are
   * letters, digits, "_" and "-", an uplink's name is one line of text.
   * Anything else is refused - never ignored, which would widen what the
   * page shows without saying so.
   */
  public static sanitize(value: unknown): NetworkTrafficUsageFilters {
    if (value === undefined || value === null) {
      return {};
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException("filters must be an object");
    }

    const raw: JSONObject = value as JSONObject;
    const filters: NetworkTrafficUsageFilters = {};

    const networkId: unknown = raw["controllerNetworkId"];

    if (networkId !== undefined && networkId !== null && networkId !== "") {
      if (typeof networkId !== "string" || !isIdentifierText(networkId)) {
        throw new BadDataException("controllerNetworkId is not a network ID");
      }

      filters.controllerNetworkId = networkId;
    }

    const serial: unknown = raw["deviceSerial"];

    if (serial !== undefined && serial !== null && serial !== "") {
      if (typeof serial !== "string" || !isIdentifierText(serial)) {
        throw new BadDataException("deviceSerial is not a serial number");
      }

      filters.deviceSerial = serial.toUpperCase();
    }

    const interfaceName: unknown = raw["interfaceName"];

    if (
      interfaceName !== undefined &&
      interfaceName !== null &&
      interfaceName !== ""
    ) {
      if (
        typeof interfaceName !== "string" ||
        !isUplinkNameText(interfaceName)
      ) {
        throw new BadDataException("interfaceName is not an uplink's name");
      }

      filters.interfaceName = interfaceName;
    }

    return filters;
  }

  public static isFiltered(filters: NetworkTrafficUsageFilters): boolean {
    return Boolean(
      filters.controllerNetworkId ||
        filters.deviceSerial ||
        filters.interfaceName,
    );
  }
}

// The total of a row: both directions.
export function getUsageOctets(row: {
  sentOctets: number;
  receivedOctets: number;
}): number {
  return row.sentOctets + row.receivedOctets;
}

// An empty summary: a page without this source.
export function getUnavailableNetworkTrafficUsageSummary(data: {
  startTime: Date;
  endTime: Date;
}): NetworkTrafficUsageSummary {
  return {
    isAvailable: false,
    windowStartAt: data.startTime.toISOString(),
    windowEndAt: data.endTime.toISOString(),
    bucketSeconds: getNetworkTrafficUsageBucketSeconds(
      Math.max(
        1,
        Math.floor((data.endTime.getTime() - data.startTime.getTime()) / 1000),
      ),
    ),
    totals: { sentOctets: 0, receivedOctets: 0, flows: 0 },
    primaryKind: NetworkTrafficUsageKind.Uplink,
    applicationTotals: { sentOctets: 0, receivedOctets: 0 },
    clientTotals: { sentOctets: 0, receivedOctets: 0 },
    series: [],
    topNetworks: [],
    topUplinks: [],
    uplinkInterfaces: [],
    uplinkSeries: [],
    topApplications: [],
    topDestinations: [],
    topClients: [],
    topConversations: [],
    lastUplinkAt: null,
    lastAnalyticsAt: null,
    uplinksReadTo: null,
    connections: [],
  };
}

// Whether an ID is one OneUptime made (a device's, a connection's).
export function isUsageObjectId(value: unknown): value is string {
  return typeof value === "string" && ObjectID.isValidUUID(value);
}
