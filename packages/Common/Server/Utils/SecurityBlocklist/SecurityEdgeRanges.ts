import SecurityEventConnectionService from "../../Services/SecurityEventConnectionService";
import QueryHelper from "../../Types/Database/QueryHelper";
import DataSourceHttpFetch, {
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";
import logger from "../Logger";
import ObjectID from "../../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import NetworkAddressBlockUtil from "../../../Utils/NetworkTraffic/NetworkAddressBlock";

/*
 * THE EDGE IN FRONT OF THE APP, WHOSE ADDRESSES ARE NEVER BLOCKED (#10338).
 *
 * Behind Cloudflare, every request a project's app receives comes from one
 * of Cloudflare's addresses. A block of one of them at the origin's WAF
 * takes the site down for everyone that edge serves. So while a project has
 * connected an edge, its published ranges are protected: the blocklist
 * refuses a block of any address in them, and says why.
 *
 * Each edge lists the security connections that say a project sits behind
 * it (connectorProviders): Cloudflare's is its connection (#10339). A
 * project that has one is behind Cloudflare, so the blocklist refuses to
 * block Cloudflare's addresses (#10338), and the scans trust them as the
 * proxy that forwards the client (SecurityTrustedProxies, #10416). An edge
 * that names no connection is behind no project, and nothing is read for
 * it. Its ranges are read from the addresses Cloudflare publishes them at,
 * at most once a day, and the copy below stands in when they cannot be read
 * (a server with no way out).
 *
 * Asking costs one count of the project's connections of the edge's kind
 * (SecurityEventConnectionService.countBy): each time the blocklist checks
 * a block, and each time a scan reads its trusted proxies, which it keeps
 * for a minute. A suite that reaches either stubs that count.
 */

export interface SecurityEdge {
  // As the refusal names it: "Cloudflare".
  name: string;
  // Where the edge publishes its ranges, one a line.
  rangeUrls: Array<string>;
  // The ranges as published when this was written, for when they cannot be read.
  knownRanges: Array<string>;
  // The security connections that say a project sits behind it.
  connectorProviders: Array<SecurityEventConnectorProvider>;
}

/*
 * Cloudflare's ranges, as https://www.cloudflare.com/ips-v4 and /ips-v6
 * list them (November 2026).
 */
export const CLOUDFLARE_EDGE: SecurityEdge = {
  name: "Cloudflare",
  rangeUrls: [
    "https://www.cloudflare.com/ips-v4",
    "https://www.cloudflare.com/ips-v6",
  ],
  knownRanges: [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
  ],
  // A project with a Cloudflare connection, enabled or paused, sits behind Cloudflare (#10565).
  connectorProviders: [SecurityEventConnectorProvider.Cloudflare],
};

export const SECURITY_EDGES: ReadonlyArray<SecurityEdge> = [CLOUDFLARE_EDGE];

// How long the ranges read from an edge are kept: a day.
export const EDGE_RANGES_REFRESH_IN_MS: number = 24 * 60 * 60 * 1000;

// How soon an edge whose ranges could not be read is read again: an hour.
export const EDGE_RANGES_RETRY_IN_MS: number = 60 * 60 * 1000;

// The most ranges an edge's list is read for: anything past it is not a list of ranges.
const MAX_EDGE_RANGES: number = 1000;

const EDGE_RANGES_TIMEOUT_IN_MS: number = 5000;

export type EdgeRangesFetch = (url: string) => Promise<string>;

const defaultFetch: EdgeRangesFetch = async (url: string): Promise<string> => {
  const response: DataSourceHttpResponse = await DataSourceHttpFetch.fetch({
    method: "GET",
    url,
    timeoutInMs: EDGE_RANGES_TIMEOUT_IN_MS,
  });

  return response.bodyText;
};

interface CachedRanges {
  ranges: Array<string>;
  readAt: number;
}

export default class SecurityEdgeRanges {
  private static cache: Map<string, CachedRanges> = new Map();

  private static fetch: EdgeRangesFetch = defaultFetch;

  // For tests: how an edge's ranges are read, and a cache emptied.
  public static setFetchForTests(fetch: EdgeRangesFetch | null): void {
    this.fetch = fetch || defaultFetch;
    this.cache.clear();
  }

  /*
   * The edges the project has connected: one whose security connection the
   * project has, enabled or not - a paused connection still means the app
   * sits behind the edge.
   */
  public static async findConnectedEdges(
    projectId: ObjectID,
  ): Promise<Array<SecurityEdge>> {
    const connected: Array<SecurityEdge> = [];

    for (const edge of SECURITY_EDGES) {
      if (edge.connectorProviders.length === 0) {
        continue;
      }

      const count: number = (
        await SecurityEventConnectionService.countBy({
          query: {
            projectId,
            provider: QueryHelper.any(edge.connectorProviders),
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (count > 0) {
        connected.push(edge);
      }
    }

    return connected;
  }

  /*
   * The edge's ranges: as it publishes them, read at most once a day, else
   * the copy it was written with. Every value an address or a range.
   */
  public static async getRanges(
    edge: SecurityEdge,
    now: number = Date.now(),
  ): Promise<Array<string>> {
    const cached: CachedRanges | undefined = this.cache.get(edge.name);

    if (cached && now - cached.readAt < EDGE_RANGES_REFRESH_IN_MS) {
      return cached.ranges;
    }

    const ranges: Array<string> = [];

    try {
      for (const url of edge.rangeUrls) {
        const text: string = await this.fetch(url);

        for (const line of text.split("\n")) {
          const value: string = line.trim();

          if (!value || value.startsWith("#")) {
            continue;
          }

          if (!NetworkAddressBlockUtil.parse(value)) {
            throw new Error(`${url} lists "${value.slice(0, 60)}", no range.`);
          }

          ranges.push(value);
        }
      }

      if (ranges.length === 0 || ranges.length > MAX_EDGE_RANGES) {
        throw new Error(`${edge.name} listed ${ranges.length} ranges.`);
      }
    } catch (error) {
      logger.warn(
        `SecurityEdgeRanges: could not read ${edge.name}'s ranges; the ranges it was written with protect its addresses. ${String(error)}`,
      );

      // Read again within the hour, rather than in a day.
      const known: CachedRanges = {
        ranges: [...edge.knownRanges],
        readAt: now - EDGE_RANGES_REFRESH_IN_MS + EDGE_RANGES_RETRY_IN_MS,
      };

      this.cache.set(edge.name, known);

      return known.ranges;
    }

    this.cache.set(edge.name, { ranges, readAt: now });

    return ranges;
  }
}
