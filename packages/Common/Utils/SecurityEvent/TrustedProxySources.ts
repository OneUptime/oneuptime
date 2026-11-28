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
 * check can say why an address is trusted - the first reason that holds,
 * the most particular first:
 *
 *   - Listed: the project's Trusted Proxies;
 *   - Edge: the published ranges of an edge the project connected
 *     (Cloudflare);
 *   - OwnLoadBalancer: the addresses of the project's own application load
 *     balancers (#10546), and the Google Cloud proxy-only subnets only its
 *     Application Load Balancers connect from (#11389);
 *   - GoogleFrontEnd: Google's front ends, which a connected Google Cloud
 *     project's global external Application Load Balancer brought
 *     (#11047);
 *   - Private: nobody's on the internet, while the project trusts those
 *     (Project.securityTrustPrivateAddresses, #11389;
 *     ClientAddressTrust.isTrustedProxy trusts them by their scope,
 *     unlisted). Last: such an address is trusted for what it is when
 *     anything above says so, and only for its scope otherwise - which is
 *     what an automatic response asks (isVouchedProxy).
 *
 * Before any of them, the ranges never trusted (untrusted, #11389): where a
 * load balancer of the project's that passes on what a client wrote
 * connects from.
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
  /*
   * Where its load balancers that pass on what a client wrote connect from
   * (#11389): never trusted, whatever above lists them.
   */
  untrusted: ReadonlyArray<NetworkAddressBlock>;
  // Whether an address that is nobody's on the internet is trusted unlisted (#11389).
  trustsPrivateAddresses: boolean;
  // Whether its access logs are read for X-Forwarded-For (#10548).
  readsAccessLogForwardedFor: boolean;
  // Its own access log format, read (#11048); null when it gave none.
  accessLogFormat: AccessLogFormat | null;
}

/*
 * Only what a project trusts that said nothing: addresses that are nobody's
 * on the internet, as every project did before it could say (#11389).
 */
export const NO_TRUSTED_PROXY_SOURCES: TrustedProxySources = {
  listed: [],
  edges: [],
  ownLoadBalancers: [],
  googleFrontEnds: [],
  untrusted: [],
  trustsPrivateAddresses: true,
  readsAccessLogForwardedFor: false,
  accessLogFormat: null,
};

/*
 * What a project whose settings could not be read trusts (#11389): nothing,
 * not even a private address, since it may have turned those off - a read
 * that fails trusts less, never more. Every address a proxy forwarded is
 * then claimed, and the next scan reads again.
 */
export const UNREAD_TRUSTED_PROXY_SOURCES: TrustedProxySources = {
  ...NO_TRUSTED_PROXY_SOURCES,
  trustsPrivateAddresses: false,
};

/*
 * What the parsers read: every block of every source, the project's own
 * list first, the ranges never trusted, whether private addresses are, and
 * what it says of its access logs.
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
    untrustedBlocks: sources.untrusted,
    trustsPrivateAddresses: sources.trustsPrivateAddresses,
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
 * private only when nothing more particular holds it - or null when it
 * trusts it for none, as for every address where a load balancer that
 * passes on what a client wrote connects from (#11389).
 */
export function findTrustedProxySource(
  address: string,
  sources: TrustedProxySources,
): TrustedProxyReason | null {
  const scope: SecurityAddressScope | null = getSecurityAddressScope(address);

  if (!scope || holds(sources.untrusted, address)) {
    return null;
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

  if (scope !== SecurityAddressScope.Public && sources.trustsPrivateAddresses) {
    return { address, source: TrustedProxySource.Private, edgeName: "" };
  }

  return null;
}
