import { TrustedProxyHops } from "../EnvironmentConfig";
import IP from "../../Types/IP/IP";
import IpCanonicalUtil from "../../Utils/IpCanonicalUtil";
import express from "express";

/*
 * Resolving the client IP address of an inbound request.
 *
 * `X-Forwarded-For` is a list, and only its RIGHT-hand end is trustworthy.
 * Every proxy in the chain APPENDS the address of the peer it accepted the
 * connection from -- our own Nginx uses `$proxy_add_x_forwarded_for` (see
 * Nginx/default.conf.template) -- so the leftmost entries are whatever the
 * original caller chose to send, verbatim.
 *
 * Reading the header left-to-right therefore reads attacker-supplied data. A
 * caller who sends `X-Forwarded-For: <address-they-want-to-be>` arrives at the
 * app as `["<address-they-want-to-be>", "<their-real-address>"]`, and anything
 * that trusts the first entry -- or, worse, accepts a match against ANY entry
 * -- can be told any address at all. That is a straight bypass of every
 * IP-based control: dashboard and status page allowlists, and IP-keyed rate
 * limits.
 *
 * Counting in from the right instead pins the read to an entry one of OUR
 * proxies wrote. With the standard single-Nginx deployment the last entry is
 * the address Nginx saw the connection come from, which is the real client.
 * Each additional reverse proxy that we control and that appends to the header
 * shifts the client one position further left, hence the configurable hop
 * count.
 *
 * The trust boundary this relies on is the network one: the app must only be
 * reachable through the proxies counted here. A caller who can open a
 * connection to the app port directly is the peer, and no header discipline
 * can help. Keep the app ports private.
 */

export type ClientIpRequestLike = Pick<express.Request, "headers"> & {
  socket?: Partial<express.Request["socket"]> | undefined;
  ip?: string | undefined;
};

/*
 * Characters that may legitimately appear in a bare IPv4 or IPv6 literal.
 * Anything else in a candidate means it is not an address we should try to
 * interpret -- notably Nginx's `unknown` placeholder and RFC 7239's `_hidden`
 * / `unknown` obfuscated identifiers.
 */
const IP_LITERAL_CHARACTERS: RegExp = /^[0-9a-fA-F:.]+$/;

const IPV4_MAPPED_IPV6_PREFIX: RegExp = /^::ffff:(?=\d{1,3}(\.\d{1,3}){3}$)/i;

/*
 * No address is longer than this -- 45 is a full IPv4-mapped IPv6 literal,
 * plus a little room for brackets and a port. Anything longer is not an
 * address, and rejecting it up front keeps arbitrarily long header values away
 * from IP.isIPv6's alternation-heavy pattern.
 */
const MAX_IP_CANDIDATE_LENGTH: number = 64;

/*
 * Normalize one X-Forwarded-For / socket address into a bare IP literal, or
 * null when the value is not an address at all.
 *
 * Handles the shapes that legitimately reach us:
 *  - surrounding whitespace and (non-standard, but seen) double quotes
 *  - `[2001:db8::1]:443` -- bracketed IPv6 with a port
 *  - `203.0.113.7:51234` -- IPv4 with a port, which some proxies emit
 *  - `::ffff:203.0.113.7` -- the IPv4-mapped IPv6 form Node reports for
 *    `socket.remoteAddress` on a dual-stack listener. Left as-is it would
 *    never match an IPv4 allowlist entry or CIDR.
 */
export const normalizeIpCandidate: (
  candidate: string | undefined | null,
) => string | null = (candidate: string | undefined | null): string | null => {
  if (!candidate || candidate.length > MAX_IP_CANDIDATE_LENGTH) {
    return null;
  }

  let value: string = candidate.trim().replace(/^"|"$/g, "").trim();

  if (!value) {
    return null;
  }

  // `[2001:db8::1]` or `[2001:db8::1]:443`
  const bracketed: RegExpMatchArray | null = value.match(
    /^\[([^\]]+)\](:\d+)?$/,
  );
  if (bracketed && bracketed[1]) {
    value = bracketed[1];
  }

  /*
   * `203.0.113.7:51234`. Only strip when there is exactly one colon --
   * more than one means IPv6, where a trailing `:<port>` is ambiguous
   * without brackets and is not stripped.
   */
  if (value.split(":").length === 2 && value.includes(".")) {
    value = value.split(":")[0] || "";
  }

  value = value.replace(IPV4_MAPPED_IPV6_PREFIX, "");

  if (!value || !IP_LITERAL_CHARACTERS.test(value)) {
    return null;
  }

  /*
   * IP.isIP is the final arbiter, but its IPv6 pattern is unanchored, so the
   * character-class guard above is what stops a substring match from letting
   * junk through.
   */
  if (!IP.isIP(value)) {
    return null;
  }

  return value;
};

/*
 * Split X-Forwarded-For into positional entries WITHOUT dropping anything.
 *
 * Position is the whole point: entries are counted from the right, and
 * silently discarding an unparseable entry would shift every entry to its left
 * one place closer to the right-hand end. An attacker chooses the left-hand
 * entries, so filtering here would hand them a way to slide their own value
 * into the position we read.
 */
const getForwardedForEntries: (req: ClientIpRequestLike) => Array<string> = (
  req: ClientIpRequestLike,
): Array<string> => {
  const header: string | Array<string> | undefined = req.headers?.[
    "x-forwarded-for"
  ] as string | Array<string> | undefined;

  if (header === undefined || header === null) {
    return [];
  }

  /*
   * Node exposes a repeated header as an array. Repeated X-Forwarded-For
   * headers are equivalent to one comma-joined header (RFC 7230 3.2.2), and
   * they join in wire order -- so the rightmost entry of the last header is
   * still the entry our proxy appended.
   */
  const raw: string = Array.isArray(header) ? header.join(",") : header;

  if (!raw.trim()) {
    return [];
  }

  return raw.split(",");
};

export interface ResolveClientIpOptions {
  /*
   * How many proxies that we control sit in front of this process and append
   * to X-Forwarded-For. Defaults to the TRUSTED_PROXY_HOPS environment
   * variable. 0 disables the header entirely and uses only the transport peer.
   */
  trustedProxyHops?: number | undefined;
}

/*
 * The address to attribute a request to for SECURITY decisions -- allowlists,
 * blocklists, IP-keyed rate limits.
 *
 * Returns undefined when no address can be established. Callers making a
 * security decision must treat undefined as "deny": there is no safe default
 * address.
 */
export const resolveClientIp: (
  req: ClientIpRequestLike,
  options?: ResolveClientIpOptions,
) => string | undefined = (
  req: ClientIpRequestLike,
  options?: ResolveClientIpOptions,
): string | undefined => {
  const configuredHops: number =
    options?.trustedProxyHops === undefined
      ? TrustedProxyHops
      : options.trustedProxyHops;

  const hops: number =
    Number.isFinite(configuredHops) && configuredHops > 0
      ? Math.floor(configuredHops)
      : 0;

  /*
   * The transport peer. Never forgeable, but it is the closest proxy rather
   * than the client whenever the request actually came through one.
   */
  const peer: string | null =
    normalizeIpCandidate(req.socket?.remoteAddress) ||
    normalizeIpCandidate(req.ip);

  if (hops === 0) {
    return peer || undefined;
  }

  const entries: Array<string> = getForwardedForEntries(req);

  if (entries.length >= hops) {
    /*
     * Count in from the right: with one trusted proxy this is the last entry,
     * the one Nginx appended from $remote_addr.
     *
     * Fail closed on an unparseable entry rather than walking further left --
     * everything to the left of this position is caller-supplied.
     */
    return normalizeIpCandidate(entries[entries.length - hops]) || undefined;
  }

  /*
   * Fewer entries than there are trusted proxies: this request did not
   * traverse the expected chain (a direct call to the app port, an internal
   * health check, a misconfigured deployment). Nothing in the header is
   * corroborated, so use only the peer.
   */
  return peer || undefined;
};

/*
 * Who a rate limit counts a request as, given the address resolveClientIp
 * attributed it to.
 *
 * `address` is that address, written one way however it was spelled
 * ("2001:DB8::1" and "2001:db8:0:0:0:0:0:1" are one address). Anything
 * that is not an address ("unknown", the bucket of callers that cannot be
 * placed) is counted as itself.
 *
 * `ipv6Network64` is the /64 an IPv6 address is in ("2001:db8:0:1::/64"),
 * and null for anything else. One host is commonly given a whole /64
 * (RFC 7934) and can send from any address in it, so a limit counted per
 * address alone does not hold that host to anything. Some hosting
 * providers put the servers of many customers in one shared /64, though,
 * so a limit counted per /64 alone would hold unrelated servers to one
 * allowance. A rate limit counts both: each address, and each /64 with
 * room for several servers.
 */
export interface RateLimitClient {
  address: string;
  ipv6Network64: string | null;
}

export const getRateLimitClient: (clientIp: string) => RateLimitClient = (
  clientIp: string,
): RateLimitClient => {
  return {
    /*
     * An IPv4 address handed over IPv4-mapped ("::ffff:203.0.113.7") is
     * that IPv4 address, as resolveClientIp already reads it.
     */
    address:
      IpCanonicalUtil.getMappedIpv4(clientIp) ||
      IpCanonicalUtil.canonicalize(clientIp),
    ipv6Network64: IpCanonicalUtil.getIpv6Network64(clientIp),
  };
};

/*
 * How many addresses' worth of requests the addresses of one IPv6 /64 may
 * make together, under a rate limit that counts both. A /64 is often one
 * host's, and a host that sends from address after address of it is held
 * to ten addresses' worth. It is as often an office's or a university's
 * network, or a hosting provider's for many customers' servers, and ten
 * addresses' worth is room for them: each address there is still held to
 * its own allowance, and one that goes over it never spends the /64's.
 */
export const IPV6_NETWORK_RATE_LIMIT_ROOM_IN_ADDRESSES: number = 10;

// What the addresses of one IPv6 /64 may make together, for a per-address limit.
export const getIpv6NetworkRateLimit: (perAddressLimit: number) => number = (
  perAddressLimit: number,
): number => {
  return perAddressLimit * IPV6_NETWORK_RATE_LIMIT_ROOM_IN_ADDRESSES;
};

export default resolveClientIp;
