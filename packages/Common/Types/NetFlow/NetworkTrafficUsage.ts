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
 * EVERY ROW OF A TOP LIST, NOT ITS TEN (issue #5762).
 *
 * Top networks, Top applications and Top clients show the ten busiest; an
 * estate of a thousand branches has a thousand networks, and the one being
 * looked into is rarely among the ten. Each of the three says how many
 * there are (the summary's networkCount, applicationCount, clientCount) and
 * opens all of them on request: POST /network-traffic/usage-list, a page of
 * rows at a time, searched and sorted by the database - never the whole
 * list in the browser.
 *
 * The other lists stay ten: the uplinks are an appliance's two or three
 * lines, and the destinations and Who talks to whom say the same as the
 * applications, once more per host.
 */
export enum NetworkTrafficUsageListKind {
  Networks = "networks",
  Applications = "applications",
  Clients = "clients",
}

export const NETWORK_TRAFFIC_USAGE_LIST_KINDS: ReadonlyArray<NetworkTrafficUsageListKind> =
  [
    NetworkTrafficUsageListKind.Networks,
    NetworkTrafficUsageListKind.Applications,
    NetworkTrafficUsageListKind.Clients,
  ];

/*
 * How a list is sorted, busiest first: by both directions, by what came in
 * (received, download) or by what went out (sent, upload) - the "In" and
 * "out" every row of the lists says.
 */
export enum NetworkTrafficUsageListSort {
  Total = "total",
  In = "in",
  Out = "out",
}

export const NETWORK_TRAFFIC_USAGE_LIST_SORTS: ReadonlyArray<NetworkTrafficUsageListSort> =
  [
    NetworkTrafficUsageListSort.Total,
    NetworkTrafficUsageListSort.In,
    NetworkTrafficUsageListSort.Out,
  ];

// Rows a page of a list holds unless asked otherwise, and at most.
export const NETWORK_TRAFFIC_USAGE_LIST_PAGE_SIZE: number = 25;
export const MAX_NETWORK_TRAFFIC_USAGE_LIST_PAGE_SIZE: number = 100;
// How far in a list may be paged: past this, search instead.
export const MAX_NETWORK_TRAFFIC_USAGE_LIST_SKIP: number = 100000;
// The longest text a list is searched for.
export const MAX_NETWORK_TRAFFIC_USAGE_SEARCH_LENGTH: number = 100;

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

/*
 * One page of a whole list (POST /network-traffic/usage-list): the page's
 * request - its device or site, range and filters, as the summary's - and
 * which list, searched for what, sorted how and from which row.
 */
export interface NetworkTrafficUsageListRequest
  extends NetworkTrafficUsageRequest {
  list: NetworkTrafficUsageListKind;
  /*
   * What Top networks is of on the page the list opened from: the
   * summary's primaryKind, so the whole list adds up as its ten did.
   */
  primaryKind?: NetworkTrafficUsageKind | undefined;
  // Part of a name (a network's, an application's, a client's), its IP or MAC address.
  search?: string | undefined;
  sortBy?: NetworkTrafficUsageListSort | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
}

export interface NetworkTrafficUsageListResult {
  list: NetworkTrafficUsageListKind;
  // Every row the search matches, of which this is a page.
  count: number;
  // The page's rows: only the list's own kind is filled.
  networks: Array<NetworkTrafficUsageNetworkRow>;
  applications: Array<NetworkTrafficUsageApplicationRow>;
  clients: Array<NetworkTrafficUsageClientRow>;
}

/*
 * Whether a device's page has a Meraki appliance behind it (issue #5762).
 *
 * An appliance's traffic belongs to the device it is: one with its serial
 * number or MAC address, or one Meraki's own record of it was matched to
 * (NetworkControllerDeviceMatcher). A router added by hand at its WAN
 * address has none of them, so its page had no Meraki side and said
 * nothing of why. Now the page says which it is:
 *
 *   linked    the appliance it is: its serial number, its Meraki name and
 *             its network's - and whether that is by the serial number on
 *             the device, which Unlink takes off again;
 *   unlinked  the project reads Meraki and nothing ties this device to an
 *             appliance: the page offers to link it to one.
 *
 * A device Meraki says is another kind of box - a switch, an access point -
 * gets neither: Meraki reports its traffic with its network's appliance.
 * Nor does a device with a serial number of its own that no connection
 * reported: a link, which writes the appliance's, would be refused there.
 */
export enum NetworkTrafficUsageApplianceLinkStatus {
  Linked = "linked",
  Unlinked = "unlinked",
}

export interface NetworkTrafficUsageDeviceAppliance {
  status: NetworkTrafficUsageApplianceLinkStatus;
  serial?: string | undefined;
  name?: string | undefined;
  controllerNetworkName?: string | undefined;
  isLinkedBySerialNumber?: boolean | undefined;
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
   * How many networks, applications and clients the page's lists are of -
   * all of them, where Top networks, Top applications and Top clients show
   * the busiest ten: what each list's "View all" says and opens.
   */
  networkCount: number;
  applicationCount: number;
  clientCount: number;
  // A device's page in a project that reads Meraki: the appliance it is, or none yet.
  deviceAppliance?: NetworkTrafficUsageDeviceAppliance | undefined;
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
    networkCount: 0,
    applicationCount: 0,
    clientCount: 0,
    lastUplinkAt: null,
    lastAnalyticsAt: null,
    uplinksReadTo: null,
    connections: [],
  };
}

/*
 * A list request's own parts, checked: which list, the search text (one
 * line, at most MAX_NETWORK_TRAFFIC_USAGE_SEARCH_LENGTH characters, cut
 * there), the sort and the page. Anything unknown is refused - a list that
 * quietly showed something else would say what it is not.
 */
export class NetworkTrafficUsageListRequestUtil {
  public static readList(value: unknown): NetworkTrafficUsageListKind {
    if (
      typeof value !== "string" ||
      !NETWORK_TRAFFIC_USAGE_LIST_KINDS.includes(
        value as NetworkTrafficUsageListKind,
      )
    ) {
      throw new BadDataException(
        `list must be one of ${NETWORK_TRAFFIC_USAGE_LIST_KINDS.join(", ")}`,
      );
    }

    return value as NetworkTrafficUsageListKind;
  }

  public static readSort(value: unknown): NetworkTrafficUsageListSort {
    if (value === undefined || value === null || value === "") {
      return NetworkTrafficUsageListSort.Total;
    }

    if (
      typeof value !== "string" ||
      !NETWORK_TRAFFIC_USAGE_LIST_SORTS.includes(
        value as NetworkTrafficUsageListSort,
      )
    ) {
      throw new BadDataException(
        `sortBy must be one of ${NETWORK_TRAFFIC_USAGE_LIST_SORTS.join(", ")}`,
      );
    }

    return value as NetworkTrafficUsageListSort;
  }

  public static readPrimaryKind(value: unknown): NetworkTrafficUsageKind {
    if (value === undefined || value === null || value === "") {
      return NetworkTrafficUsageKind.Uplink;
    }

    if (
      value !== NetworkTrafficUsageKind.Uplink &&
      value !== NetworkTrafficUsageKind.Application
    ) {
      throw new BadDataException("primaryKind must be uplink or application");
    }

    return value;
  }

  /*
   * The search as the database is asked for it: trimmed, one line, cut to
   * its longest. Control characters are dropped, never matched.
   */
  public static readSearch(value: unknown): string {
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value !== "string") {
      throw new BadDataException("search must be text");
    }

    let search: string = "";

    for (const character of value) {
      const code: number = character.codePointAt(0) || 0;

      if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
        continue;
      }

      search += character;

      if (search.length >= MAX_NETWORK_TRAFFIC_USAGE_SEARCH_LENGTH) {
        break;
      }
    }

    return search.trim();
  }

  public static readSkip(value: unknown): number {
    return NetworkTrafficUsageListRequestUtil.readWhole(value, {
      field: "skip",
      fallback: 0,
      min: 0,
      max: MAX_NETWORK_TRAFFIC_USAGE_LIST_SKIP,
    });
  }

  public static readLimit(value: unknown): number {
    return NetworkTrafficUsageListRequestUtil.readWhole(value, {
      field: "limit",
      fallback: NETWORK_TRAFFIC_USAGE_LIST_PAGE_SIZE,
      min: 1,
      max: MAX_NETWORK_TRAFFIC_USAGE_LIST_PAGE_SIZE,
    });
  }

  private static readWhole(
    value: unknown,
    options: { field: string; fallback: number; min: number; max: number },
  ): number {
    if (value === undefined || value === null || value === "") {
      return options.fallback;
    }

    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < options.min ||
      value > options.max
    ) {
      throw new BadDataException(
        `${options.field} must be a whole number from ${options.min} to ${options.max}`,
      );
    }

    return value;
  }
}

// An empty page of a list: a page without this source.
export function getEmptyNetworkTrafficUsageListResult(
  list: NetworkTrafficUsageListKind,
): NetworkTrafficUsageListResult {
  return { list, count: 0, networks: [], applications: [], clients: [] };
}

// Whether an ID is one OneUptime made (a device's, a connection's).
export function isUsageObjectId(value: unknown): value is string {
  return typeof value === "string" && ObjectID.isValidUUID(value);
}
