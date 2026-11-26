import {
  SecurityAddressScope,
  canonicalAddress,
  getSecurityAddressScope,
} from "./SecurityConnectionMatch";

/*
 * THE ADDRESSES A REQUEST REACHES AN APP FROM WHEN SOMETHING STANDS IN FRONT
 * OF IT. Behind Cloudflare, every request an app receives comes from one of
 * Cloudflare's addresses; behind a load balancer, from the load balancer's
 * private one. An app's traces then carry those as the client's address, and
 * no visitor's: OneUptime cannot see one address's requests in them, and
 * says so (the Response Plan's step checks, #10340).
 *
 * Cloudflare's ranges are the ones it publishes (www.cloudflare.com/ips-v4
 * and /ips-v6, November 2026). The blocklist (#10338) protects the same
 * ranges from a block.
 */

export enum ProxyKind {
  // A CDN or edge in front of the app: Cloudflare.
  Cloudflare = "Cloudflare",
  // A private address: the load balancer or reverse proxy in front of the app.
  LoadBalancer = "LoadBalancer",
}

export const CLOUDFLARE_RANGES: ReadonlyArray<string> = [
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
];

// An address as bits, most significant first: 32 of them for IPv4, 128 for IPv6.
function toBits(address: string): Array<number> | null {
  const canonical: string | null = canonicalAddress(address);

  if (!canonical) {
    return null;
  }

  if (canonical.includes(".")) {
    const octets: Array<number> = canonical.split(".").map(Number);

    return octets.flatMap((octet: number): Array<number> => {
      return Array.from({ length: 8 }, (_: unknown, bit: number): number => {
        return (octet >> (7 - bit)) & 1;
      });
    });
  }

  return canonical
    .split(":")
    .map((group: string): number => {
      return parseInt(group, 16);
    })
    .flatMap((group: number): Array<number> => {
      return Array.from({ length: 16 }, (_: unknown, bit: number): number => {
        return (group >> (15 - bit)) & 1;
      });
    });
}

// Whether an address is in a range written as an address and a prefix length.
export function isAddressInRange(address: string, range: string): boolean {
  const [base, prefixText] = range.split("/");
  const addressBits: Array<number> | null = toBits(address);
  const baseBits: Array<number> | null = toBits(base || "");
  const prefix: number = Number(prefixText);

  if (
    !addressBits ||
    !baseBits ||
    addressBits.length !== baseBits.length ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > baseBits.length
  ) {
    return false;
  }

  for (let bit: number = 0; bit < prefix; bit++) {
    if (addressBits[bit] !== baseBits[bit]) {
      return false;
    }
  }

  return true;
}

// What stands in front of an app that requests come from this address through; null for a visitor's.
export function getProxyKind(address: string): ProxyKind | null {
  if (
    CLOUDFLARE_RANGES.some((range: string): boolean => {
      return isAddressInRange(address, range);
    })
  ) {
    return ProxyKind.Cloudflare;
  }

  const scope: SecurityAddressScope | null = getSecurityAddressScope(address);

  return scope === SecurityAddressScope.Private ||
    scope === SecurityAddressScope.Local
    ? ProxyKind.LoadBalancer
    : null;
}

/*
 * What the client addresses an app's traces carry say about what stands in
 * front of it: a proxy of one kind when every one of them is that kind's,
 * else null - the traces carry visitors' addresses, or a mix OneUptime
 * cannot read as one proxy.
 */
export function getProxyOfAddresses(
  addresses: ReadonlyArray<string>,
): ProxyKind | null {
  const kinds: Set<ProxyKind | null> = new Set(
    addresses
      .filter((address: string): boolean => {
        return Boolean(canonicalAddress(address));
      })
      .map((address: string): ProxyKind | null => {
        return getProxyKind(address);
      }),
  );

  if (kinds.size !== 1) {
    return null;
  }

  return Array.from(kinds)[0] || null;
}
