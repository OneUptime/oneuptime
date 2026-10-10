import BadDataException from "../Exception/BadDataException";
import IP from "../IP/IP";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import IpCanonicalUtil from "../../Utils/IpCanonicalUtil";

/*
 * The Traffic pages' one request and one answer (POST /network-flow/traffic),
 * shared by the server that builds it and the dashboard that draws it.
 *
 * One request answers a whole page: the window's totals, its traffic over
 * time, and the top sources, destinations, conversations, applications,
 * interfaces (a device's page) or devices (a site's, or the network's), plus
 * which exporters are sending. Every table filters the same way - click a
 * row, and the whole page narrows to it - so the filters are one object.
 */

// The longest window one request may cover: the flows' retention.
export const MAX_NETWORK_TRAFFIC_RANGE_DAYS: number = 31;

// Rows in each top table.
export const NETWORK_TRAFFIC_TOP_LIMIT: number = 10;

// How far back "sending now" looks, for the list of exporters.
export const NETWORK_TRAFFIC_SOURCES_LOOKBACK_MINUTES: number = 60;

// Exporters listed at most.
export const NETWORK_TRAFFIC_SOURCES_LIMIT: number = 100;

/*
 * Narrowing the page to part of its traffic. Each set field is one more
 * condition (they AND together); addresses are canonical, ports and
 * protocols whole numbers in range.
 */
export interface NetworkTrafficFilters {
  // Traffic sent by this address.
  sourceIp?: string | undefined;
  // Traffic sent to this address.
  destinationIp?: string | undefined;
  // Traffic to or from this address.
  hostIp?: string | undefined;
  /*
   * An application: an IP protocol, and with a port-carrying protocol the
   * service port (on either side - the client's side is usually folded
   * away). A protocol alone (ICMP, GRE) takes no port.
   */
  protocolNumber?: number | undefined;
  port?: number | undefined;
  // A device's page: traffic in or out through this interface (SNMP ifIndex).
  interfaceIndex?: number | undefined;
  // A site's or the network's page: one device's traffic.
  networkDeviceId?: string | undefined;
  /*
   * One exporter: on the network's page, the traffic of an address that is
   * no device yet.
   */
  exporterIp?: string | undefined;
}

export interface NetworkTrafficRequest {
  // A device's page.
  networkDeviceId?: string | undefined;
  // A site's page. Neither: the whole network.
  networkSiteId?: string | undefined;
  startTime: string;
  endTime: string;
  filters?: NetworkTrafficFilters | undefined;
}

export interface NetworkTrafficTotals {
  octets: number;
  packets: number;
  // Flow records the devices sent (before the probe summed them).
  flows: number;
}

export interface NetworkTrafficSeriesPoint {
  // Bucket start, as the database returns it (UTC).
  time: string;
  octets: number;
  // Only with an interface filter: in through it, out through it.
  inOctets?: number | undefined;
  outOctets?: number | undefined;
}

export interface NetworkTrafficAddressRow {
  ip: string;
  octets: number;
  packets: number;
}

export interface NetworkTrafficConversationRow {
  sourceIp: string;
  destinationIp: string;
  octets: number;
  packets: number;
}

export interface NetworkTrafficApplicationRow {
  protocolNumber: number;
  // The service port; 0 for protocols without ports.
  port: number;
  octets: number;
  packets: number;
}

export interface NetworkTrafficInterfaceRow {
  interfaceIndex: number;
  // From the device's last SNMP walk; absent for a device not walked.
  name?: string | undefined;
  alias?: string | undefined;
  speedInMbps?: number | undefined;
  inOctets: number;
  outOctets: number;
}

export interface NetworkTrafficDeviceRow {
  // Absent for an exporter that is no device yet.
  networkDeviceId?: string | undefined;
  name?: string | undefined;
  // The address the flows came from (for an unknown exporter, its identity).
  exporterIp: string;
  octets: number;
  packets: number;
}

// One exporter sending flows in the last NETWORK_TRAFFIC_SOURCES_LOOKBACK_MINUTES.
export interface NetworkTrafficSource {
  networkDeviceId?: string | undefined;
  name?: string | undefined;
  exporterIp: string;
  probeId?: string | undefined;
  // "NetFlow v9", "IPFIX", ...; empty from a probe older than the formats.
  flowFormat: string;
  // 1: every packet counted.
  samplingRate: number;
  lastFlowAt: string;
  flows: number;
  octets: number;
}

export interface NetworkTrafficSummary {
  windowStartAt: string;
  windowEndAt: string;
  bucketSeconds: number;
  totals: NetworkTrafficTotals;
  // The highest sampling rate in the window (1: every count is exact).
  maxSamplingRate: number;
  series: Array<NetworkTrafficSeriesPoint>;
  topSources: Array<NetworkTrafficAddressRow>;
  topDestinations: Array<NetworkTrafficAddressRow>;
  topConversations: Array<NetworkTrafficConversationRow>;
  topApplications: Array<NetworkTrafficApplicationRow>;
  // A device's page only.
  topInterfaces: Array<NetworkTrafficInterfaceRow>;
  // A site's and the network's page only.
  topDevices: Array<NetworkTrafficDeviceRow>;
  sources: Array<NetworkTrafficSource>;
  /*
   * A device's page: when the device's newest flow started, within the
   * flows' retention; null when it has never sent one.
   */
  lastFlowAt: string | null;
}

/*
 * Bucket width for traffic over time: whole minutes, about 120 points a
 * window. An hour is 1-minute buckets, a day 12-minute, 31 days ~6-hour.
 */
export function getNetworkTrafficBucketSeconds(
  windowInSeconds: number,
): number {
  const targetPoints: number = 120;
  const rawSeconds: number = Math.ceil(windowInSeconds / targetPoints);
  return Math.max(60, Math.ceil(rawSeconds / 60) * 60);
}

export class NetworkTrafficFiltersUtil {
  /*
   * The filters a request carries, checked: an address must be an IP
   * address (stored canonical, as flows are), a port 0-65535, a protocol
   * 0-255, an interface index a non-negative whole number, a device ID an
   * ID. Anything else is refused - never ignored, which would widen what the
   * page shows without saying so.
   */
  public static sanitize(value: unknown): NetworkTrafficFilters {
    if (value === undefined || value === null) {
      return {};
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException("filters must be an object");
    }

    const raw: JSONObject = value as JSONObject;
    const filters: NetworkTrafficFilters = {};

    for (const key of ["sourceIp", "destinationIp", "hostIp", "exporterIp"]) {
      const address: string | null = NetworkTrafficFiltersUtil.readAddress(
        raw[key],
        key,
      );

      if (address) {
        (filters as Record<string, unknown>)[key] = address;
      }
    }

    const protocolNumber: number | null = NetworkTrafficFiltersUtil.readInteger(
      raw["protocolNumber"],
      255,
      "protocolNumber",
    );

    if (protocolNumber !== null) {
      filters.protocolNumber = protocolNumber;
    }

    const port: number | null = NetworkTrafficFiltersUtil.readInteger(
      raw["port"],
      65535,
      "port",
    );

    if (port !== null) {
      filters.port = port;
    }

    const interfaceIndex: number | null =
      NetworkTrafficFiltersUtil.readInteger(
        raw["interfaceIndex"],
        0xffffffff,
        "interfaceIndex",
      );

    if (interfaceIndex !== null) {
      filters.interfaceIndex = interfaceIndex;
    }

    const networkDeviceId: unknown = raw["networkDeviceId"];

    if (networkDeviceId !== undefined && networkDeviceId !== null) {
      if (
        typeof networkDeviceId !== "string" ||
        !ObjectID.isValidUUID(networkDeviceId)
      ) {
        throw new BadDataException("networkDeviceId is not a valid ID");
      }

      filters.networkDeviceId = networkDeviceId.toLowerCase();
    }

    return filters;
  }

  // Whether any filter is set.
  public static isFiltered(filters: NetworkTrafficFilters): boolean {
    return Object.values(filters).some((value: unknown): boolean => {
      return value !== undefined && value !== null && value !== "";
    });
  }

  private static readAddress(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value !== "string" || !IP.isIP(value.trim())) {
      throw new BadDataException(`${field} is not an IP address`);
    }

    return IpCanonicalUtil.canonicalize(value.trim()).toLowerCase();
  }

  private static readInteger(
    value: unknown,
    max: number,
    field: string,
  ): number | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const parsed: number = Number(value);

    if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
      throw new BadDataException(`${field} must be a whole number from 0 to ${max}`);
    }

    return parsed;
  }
}
