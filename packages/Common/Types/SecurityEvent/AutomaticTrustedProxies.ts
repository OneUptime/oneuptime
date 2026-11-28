import { JSONObject, JSONValue } from "../JSON";
import {
  OwnLoadBalancerKind,
  isOwnLoadBalancerKind,
} from "../../Utils/SecurityEvent/OwnLoadBalancers";

/*
 * WHAT SECURITY EVENTS TRUSTS AS A PROXY WITHOUT BEING TOLD (#10546), as
 * Trusted Proxies shows it beside the list a person writes:
 *
 *   - the addresses that are nobody's on the internet, always
 *     (ALWAYS_TRUSTED_PROXY_RANGES: what ClientAddressTrust.isTrustedProxy
 *     trusts by an address's scope);
 *   - the published ranges of an edge the project connected, while it is
 *     connected (Cloudflare);
 *   - the project's own application load balancers, unless it turned that
 *     off (Project.securityTrustOwnLoadBalancers), and with them Google's
 *     front ends, which its Google Cloud Application Load Balancers reach
 *     its apps from (#11047).
 *
 * POST /security-trusted-proxies/automatic answers with the last two
 * (Server/API/SecurityTrustedProxiesAPI); the first needs no asking. Its
 * JSON is written and read here, so the server and the page agree on it.
 */

export const AUTOMATIC_TRUSTED_PROXIES_PATH: string =
  "/security-trusted-proxies/automatic";

/*
 * The ranges every project trusts, as Trusted Proxies lists them: private,
 * shared (carrier-grade NAT), loopback and link-local, IPv4 and IPv6. Each
 * is trusted by its scope (SecurityConnectionMatch.getSecurityAddressScope),
 * whatever this list says; a test holds the two in step.
 */
export const ALWAYS_TRUSTED_PROXY_RANGES: ReadonlyArray<string> = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "fc00::/7",
  "fe80::/10",
  "::1/128",
];

// A connected edge, by name, with how many ranges it publishes.
export interface AutomaticTrustedEdge {
  name: string;
  rangeCount: number;
}

// One of the project's own load balancers, as the reader may be told of it.
export interface AutomaticTrustedLoadBalancer {
  kind: OwnLoadBalancerKind;
  name: string;
  // The cloud account it is in, by its connection's name: '' when not known.
  where: string;
  addresses: Array<string>;
}

// A load balancer named where Google's front ends are said.
export interface AutomaticTrustedGoogleFrontEndLoadBalancer {
  name: string;
  // The cloud account it is in, by its connection's name: '' when not known.
  where: string;
}

/*
 * Google's front ends (#11047): the ranges the project's Google Cloud
 * Application Load Balancers reach its apps from, with the load balancers
 * that bring them, and what keeps them untrusted - a TCP or SSL proxy load
 * balancer of the project's, which passes on what a client writes from the
 * same ranges, or a read that may have left one out.
 */
export interface AutomaticTrustedGoogleFrontEnds {
  ranges: Array<string>;
  broughtBy: Array<AutomaticTrustedGoogleFrontEndLoadBalancer>;
  withheldBy: Array<AutomaticTrustedGoogleFrontEndLoadBalancer>;
  isWithheldForIncompleteRead: boolean;
  // Trusted while Your Load Balancers is on: brought by one, withheld by none.
  isTrusted: boolean;
}

export interface AutomaticTrustedProxies {
  edges: Array<AutomaticTrustedEdge>;
  loadBalancers: Array<AutomaticTrustedLoadBalancer>;
  // Null when none of the project's load balancers reaches its apps from them.
  googleFrontEnds: AutomaticTrustedGoogleFrontEnds | null;
  /*
   * False when the project's load balancers could not be listed: the reader
   * may not read cloud resources, or the read failed. Whatever the switch
   * says, the list is then not what is trusted.
   */
  areLoadBalancersRead: boolean;
  // False when some may be left out: more than one read takes, or a name that did not resolve.
  areLoadBalancersComplete: boolean;
}

export const NO_AUTOMATIC_TRUSTED_PROXIES: AutomaticTrustedProxies = {
  edges: [],
  loadBalancers: [],
  googleFrontEnds: null,
  areLoadBalancersRead: true,
  areLoadBalancersComplete: true,
};

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function readObject(value: JSONValue | undefined): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function readArray(value: JSONValue | undefined): Array<JSONValue> {
  return Array.isArray(value) ? value : [];
}

export function automaticTrustedProxiesToJSON(
  proxies: AutomaticTrustedProxies,
): JSONObject {
  return {
    edges: proxies.edges.map((edge: AutomaticTrustedEdge): JSONObject => {
      return { name: edge.name, rangeCount: edge.rangeCount };
    }),
    loadBalancers: proxies.loadBalancers.map(
      (loadBalancer: AutomaticTrustedLoadBalancer): JSONObject => {
        return {
          kind: loadBalancer.kind,
          name: loadBalancer.name,
          where: loadBalancer.where,
          addresses: [...loadBalancer.addresses],
        };
      },
    ),
    googleFrontEnds: proxies.googleFrontEnds
      ? {
          ranges: [...proxies.googleFrontEnds.ranges],
          broughtBy: proxies.googleFrontEnds.broughtBy.map(
            googleFrontEndLoadBalancerToJSON,
          ),
          withheldBy: proxies.googleFrontEnds.withheldBy.map(
            googleFrontEndLoadBalancerToJSON,
          ),
          isWithheldForIncompleteRead:
            proxies.googleFrontEnds.isWithheldForIncompleteRead,
          isTrusted: proxies.googleFrontEnds.isTrusted,
        }
      : null,
    areLoadBalancersRead: proxies.areLoadBalancersRead,
    areLoadBalancersComplete: proxies.areLoadBalancersComplete,
  };
}

function googleFrontEndLoadBalancerToJSON(
  loadBalancer: AutomaticTrustedGoogleFrontEndLoadBalancer,
): JSONObject {
  return { name: loadBalancer.name, where: loadBalancer.where };
}

function readGoogleFrontEndLoadBalancers(
  value: JSONValue | undefined,
): Array<AutomaticTrustedGoogleFrontEndLoadBalancer> {
  const loadBalancers: Array<AutomaticTrustedGoogleFrontEndLoadBalancer> = [];

  for (const item of readArray(value)) {
    const loadBalancer: JSONObject | null = readObject(item);

    if (loadBalancer) {
      loadBalancers.push({
        name: readText(loadBalancer["name"]),
        where: readText(loadBalancer["where"]),
      });
    }
  }

  return loadBalancers;
}

/*
 * Google's front ends as the server said them, or null: none brought, no
 * range, or nothing readable. Trusted only when the answer says so, and
 * never while anything withholds them.
 */
function readGoogleFrontEnds(
  value: JSONValue | undefined,
): AutomaticTrustedGoogleFrontEnds | null {
  const data: JSONObject | null = readObject(value);

  if (!data) {
    return null;
  }

  const ranges: Array<string> = readArray(data["ranges"])
    .map((range: JSONValue): string => {
      return readText(range);
    })
    .filter(Boolean);
  const broughtBy: Array<AutomaticTrustedGoogleFrontEndLoadBalancer> =
    readGoogleFrontEndLoadBalancers(data["broughtBy"]);
  const withheldBy: Array<AutomaticTrustedGoogleFrontEndLoadBalancer> =
    readGoogleFrontEndLoadBalancers(data["withheldBy"]);
  const isWithheldForIncompleteRead: boolean =
    data["isWithheldForIncompleteRead"] === true;

  if (ranges.length === 0 || broughtBy.length === 0) {
    return null;
  }

  return {
    ranges,
    broughtBy,
    withheldBy,
    isWithheldForIncompleteRead,
    isTrusted:
      data["isTrusted"] === true &&
      withheldBy.length === 0 &&
      !isWithheldForIncompleteRead,
  };
}

/*
 * What the server answered, read: an entry it cannot read is left out,
 * never guessed at. An answer that says nothing of whether the load
 * balancers were read says they were not: the page never claims a list it
 * was not given.
 */
export function readAutomaticTrustedProxies(
  value: JSONValue | undefined,
): AutomaticTrustedProxies {
  const data: JSONObject = readObject(value) || {};
  const edges: Array<AutomaticTrustedEdge> = [];
  const loadBalancers: Array<AutomaticTrustedLoadBalancer> = [];

  for (const item of readArray(data["edges"])) {
    const edge: JSONObject | null = readObject(item);
    const name: string = readText(edge?.["name"]);
    const rangeCount: number = Number(edge?.["rangeCount"]);

    if (name) {
      edges.push({
        name,
        rangeCount:
          Number.isInteger(rangeCount) && rangeCount > 0 ? rangeCount : 0,
      });
    }
  }

  for (const item of readArray(data["loadBalancers"])) {
    const loadBalancer: JSONObject | null = readObject(item);
    const kind: JSONValue | undefined = loadBalancer?.["kind"];
    const addresses: Array<string> = readArray(loadBalancer?.["addresses"])
      .map((address: JSONValue): string => {
        return readText(address);
      })
      .filter(Boolean);

    if (!isOwnLoadBalancerKind(kind) || addresses.length === 0) {
      continue;
    }

    loadBalancers.push({
      kind,
      name: readText(loadBalancer?.["name"]),
      where: readText(loadBalancer?.["where"]),
      addresses,
    });
  }

  return {
    edges,
    loadBalancers,
    googleFrontEnds: readGoogleFrontEnds(data["googleFrontEnds"]),
    areLoadBalancersRead: data["areLoadBalancersRead"] === true,
    areLoadBalancersComplete: data["areLoadBalancersComplete"] !== false,
  };
}
