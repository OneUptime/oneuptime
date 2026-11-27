import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../NetworkTraffic/NetworkAddressBlock";
import {
  SecurityAddressScope,
  getSecurityAddressScope,
} from "../SecurityCase/SecurityConnectionMatch";
import { TrustedProxies } from "./ClientAddressTrust";
import { AccessLogFormat } from "./LogParsers/AccessLogFormat";

/*
 * WHERE EACH PROXY A PROJECT TRUSTS COMES FROM (#11046), kept apart so the
 * scans and Check a log line read one set of them the same way, and the
 * check can say why an address is trusted:
 *
 *   - Private: nobody's on the internet (ClientAddressTrust.isTrustedProxy
 *     trusts these by their scope, unlisted);
 *   - Listed: the project's Trusted Proxies;
 *   - Edge: the published ranges of an edge the project connected
 *     (Cloudflare);
 *   - OwnLoadBalancer: the public addresses of the project's own
 *     application load balancers (#10546);
 *   - GoogleFrontEnd: Google's front ends, which a connected Google Cloud
 *     project's global external Application Load Balancer brought
 *     (#11047).
 *
 * The server reads them (Server/Utils/SecurityEvent/SecurityTrustedProxies);
 * trustedProxiesOf is the one way they become what the parsers read. Pure.
 */

export enum TrustedProxySource {
  Private = "private",
  Listed = "listed",
  Edge = "edge",
  OwnLoadBalancer = "own-load-balancer",
  GoogleFrontEnd = "google-front-end",
}

export const TRUSTED_PROXY_SOURCES: ReadonlyArray<TrustedProxySource> =
  Object.values(TrustedProxySource);

export function isTrustedProxySource(
  value: unknown,
): value is TrustedProxySource {
  return (
    typeof value === "string" &&
    (TRUSTED_PROXY_SOURCES as ReadonlyArray<string>).includes(value)
  );
}

// A connected edge's published ranges, by its name.
export interface TrustedEdgeRanges {
  name: string;
  blocks: ReadonlyArray<NetworkAddressBlock>;
}

export interface TrustedProxySources {
  // The project's Trusted Proxies.
  listed: ReadonlyArray<NetworkAddressBlock>;
  // Each connected edge's published ranges.
  edges: ReadonlyArray<TrustedEdgeRanges>;
  // The public addresses of its own application load balancers, while trusted.
  ownLoadBalancers: ReadonlyArray<NetworkAddressBlock>;
  // Google's front ends, while a global external Application Load Balancer brings them.
  googleFrontEnds: ReadonlyArray<NetworkAddressBlock>;
  // Whether its access logs are read for X-Forwarded-For (#10548).
  readsAccessLogForwardedFor: boolean;
  // Its own access log format, read (#11048); null when it gave none.
  accessLogFormat: AccessLogFormat | null;
}

// Only what every project trusts: addresses that are nobody's on the internet.
export const NO_TRUSTED_PROXY_SOURCES: TrustedProxySources = {
  listed: [],
  edges: [],
  ownLoadBalancers: [],
  googleFrontEnds: [],
  readsAccessLogForwardedFor: false,
  accessLogFormat: null,
};

/*
 * What the parsers read: every block of every source, the project's own
 * list first, and what it says of its access logs.
 */
export function trustedProxiesOf(sources: TrustedProxySources): TrustedProxies {
  return {
    blocks: [
      ...sources.listed,
      ...sources.edges.flatMap(
        (edge: TrustedEdgeRanges): ReadonlyArray<NetworkAddressBlock> => {
          return edge.blocks;
        },
      ),
      ...sources.ownLoadBalancers,
      ...sources.googleFrontEnds,
    ],
    readsAccessLogForwardedFor: sources.readsAccessLogForwardedFor,
    accessLogFormat: sources.accessLogFormat,
  };
}

// Why an address is trusted as a proxy.
export interface TrustedProxyReason {
  address: string;
  source: TrustedProxySource;
  // The edge whose range holds it, for Edge: "Cloudflare". '' otherwise.
  edgeName: string;
}

function holds(
  blocks: ReadonlyArray<NetworkAddressBlock>,
  address: string,
): boolean {
  return blocks.some((block: NetworkAddressBlock): boolean => {
    return NetworkAddressBlockUtil.contains(block, address);
  });
}

/*
 * Why the project trusts `address` as a proxy, the first reason that holds
 * in the order above - an address that is nobody's on the internet is
 * private whatever else lists it - or null when it trusts it for none.
 */
export function findTrustedProxySource(
  address: string,
  sources: TrustedProxySources,
): TrustedProxyReason | null {
  const scope: SecurityAddressScope | null = getSecurityAddressScope(address);

  if (!scope) {
    return null;
  }

  if (scope !== SecurityAddressScope.Public) {
    return { address, source: TrustedProxySource.Private, edgeName: "" };
  }

  if (holds(sources.listed, address)) {
    return { address, source: TrustedProxySource.Listed, edgeName: "" };
  }

  for (const edge of sources.edges) {
    if (holds(edge.blocks, address)) {
      return { address, source: TrustedProxySource.Edge, edgeName: edge.name };
    }
  }

  if (holds(sources.ownLoadBalancers, address)) {
    return {
      address,
      source: TrustedProxySource.OwnLoadBalancer,
      edgeName: "",
    };
  }

  if (holds(sources.googleFrontEnds, address)) {
    return {
      address,
      source: TrustedProxySource.GoogleFrontEnd,
      edgeName: "",
    };
  }

  return null;
}
