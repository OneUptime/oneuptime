import net from "net";

/*
 * Instance-level configuration for the private-network webhook exception.
 *
 * SSRFProtection blocks every outbound webhook whose target resolves into a
 * private, loopback or link-local range. That is the only correct default for
 * multi-tenant SaaS, but it also breaks the most ordinary self-hosted setup
 * there is: an on-call workflow posting to an internal Mattermost, Jira or
 * ticketing system that only exists on 10.x / 192.168.x (issue #3424).
 *
 * This module owns the two instance knobs that can widen that policy. It is
 * deliberately dependency-free apart from node's `net` - SSRFProtection is
 * reachable from the Probe bundle, which has no database - so the *project*
 * half of the opt-in lives in ProjectService instead
 * (`isPrivateNetworkWebhookAllowed`).
 *
 *   ALLOW_PRIVATE_NETWORK_WEBHOOKS=true
 *     Permits the PRIVATE tier - RFC-1918, CGNAT, IPv6 unique-local and
 *     site-local. Loopback, link-local (169.254.169.254 lives there),
 *     unspecified, multicast and reserved stay blocked: nothing a self-hosted
 *     install legitimately webhooks to is there, and the app server's own
 *     loopback is exactly what an SSRF wants.
 *
 *   PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=mattermost.internal,10.20.0.0/16,...
 *     An exact, operator-authored list of hosts and CIDRs that are allowed
 *     REGARDLESS of tier - including loopback and link-local, because
 *     "host.docker.internal" and a host-networked service on 127.0.0.1 are
 *     both real self-hosted targets and an operator naming one has made an
 *     explicit decision. Never put 169.254.169.254 (or any range containing
 *     it) in here: on a cloud VM that hands every project member the
 *     instance's IAM credentials.
 *
 * BOTH are off by default, so an instance that sets neither behaves exactly as
 * it did before this existed. Neither one is enough on its own either: the
 * project must also opt in (Project.allowPrivateNetworkWebhooks), and sinks
 * whose URL can be chosen by an unauthenticated visitor - status page
 * subscriber webhooks - never consult any of this.
 */

const ALLOW_PRIVATE_NETWORK_ENV_VAR: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const ALLOWLIST_ENV_VAR: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";

// "10.0.0.0/8" — a host followed by a bare prefix length, i.e. a CIDR and not a path.
const BARE_CIDR: RegExp = /^[^/?#]+\/\d{1,3}$/;
// The "/8" that can follow a bracketed IPv6 literal: "[fd00::]/8".
const BRACKETED_CIDR_SUFFIX: RegExp = /^\/(\d{1,3})$/;
const CIDR_PREFIX_LENGTH: RegExp = /^\d{1,3}$/;
/*
 * One DNS label: 1-63 characters of letters, digits, hyphen or underscore,
 * with at least one alphanumeric among them (a label of only "-" is never a
 * host). Applied label-by-label rather than as one nested quantifier over the
 * whole name, which would backtrack exponentially on a near-miss.
 */
const HOSTNAME_LABEL: RegExp = /^(?=.*[a-z0-9])[a-z0-9_-]{1,63}$/;
/*
 * An entry of digits and dots only was meant to be an IPv4 address. If
 * net.isIPv4 already turned it down it is a typo, not a hostname.
 */
const DIGITS_AND_DOTS_ONLY: RegExp = /^[0-9.]+$/;

interface HostnamePattern {
  type: "hostname";
  // Lowercased, trailing dot removed.
  hostname: string;
}

interface SubdomainPattern {
  type: "subdomain";
  /*
   * The suffix a host must end with, INCLUDING the leading dot, so that
   * "*.internal" matches "mattermost.internal" but not "evil-internal".
   */
  dottedSuffix: string;
}

interface CidrPattern {
  type: "cidr";
  // Big-endian bytes of the network address: 4 for IPv4, 16 for IPv6.
  networkBytes: Array<number>;
  prefixLength: number;
}

export type AllowlistPattern = HostnamePattern | SubdomainPattern | CidrPattern;

export interface ParsedAllowlist {
  patterns: Array<AllowlistPattern>;
  // Entries that could not be understood, kept so callers can log them once.
  invalidEntries: Array<string>;
}

export default class PrivateNetworkWebhookConfig {
  /*
   * The parsed form of the last raw allowlist string seen. Parsing is cheap
   * but this runs per outbound webhook, and the env cannot change without a
   * restart in a real deployment - the key is the raw string only so tests can
   * flip the variable between cases.
   */
  private static cachedRawAllowlist: string | null = null;
  private static cachedAllowlist: ParsedAllowlist = {
    patterns: [],
    invalidEntries: [],
  };

  /*
   * Read the env at call time rather than at import time. Modules here are
   * imported at process boot from a dozen entry points, and a boot-time const
   * cannot be exercised deterministically from a test that needs both
   * policies. In a running deployment the env is fixed at boot, so this is
   * behaviourally identical.
   */
  public static isPrivateNetworkAllowed(): boolean {
    return process.env[ALLOW_PRIVATE_NETWORK_ENV_VAR] === "true";
  }

  public static getRawAllowlist(): string {
    return process.env[ALLOWLIST_ENV_VAR] || "";
  }

  /*
   * True when the operator has configured EITHER knob. Callers use this to
   * skip work (a database read for the project flag, a settings card in the
   * dashboard) on instances where the exception can never apply.
   */
  public static isConfiguredOnInstance(): boolean {
    return (
      PrivateNetworkWebhookConfig.isPrivateNetworkAllowed() ||
      PrivateNetworkWebhookConfig.getAllowlist().patterns.length > 0
    );
  }

  public static getAllowlist(): ParsedAllowlist {
    const raw: string = PrivateNetworkWebhookConfig.getRawAllowlist();

    if (PrivateNetworkWebhookConfig.cachedRawAllowlist === raw) {
      return PrivateNetworkWebhookConfig.cachedAllowlist;
    }

    const parsed: ParsedAllowlist =
      PrivateNetworkWebhookConfig.parseAllowlist(raw);

    PrivateNetworkWebhookConfig.cachedRawAllowlist = raw;
    PrivateNetworkWebhookConfig.cachedAllowlist = parsed;

    return parsed;
  }

  public static parseAllowlist(raw: string): ParsedAllowlist {
    const patterns: Array<AllowlistPattern> = [];
    const invalidEntries: Array<string> = [];

    /*
     * Commas, whitespace and newlines all separate entries: the same value has
     * to be typed into a .env line, a compose file and a Helm value, and each
     * of those makes a different separator convenient.
     */
    const entries: Array<string> = raw
      .split(/[\s,]+/)
      .map((entry: string) => {
        return entry.trim();
      })
      .filter((entry: string) => {
        return entry.length > 0;
      });

    for (const entry of entries) {
      const pattern: AllowlistPattern | null =
        PrivateNetworkWebhookConfig.parseEntry(entry);

      if (pattern) {
        patterns.push(pattern);
      } else {
        invalidEntries.push(entry);
      }
    }

    return { patterns, invalidEntries };
  }

  private static parseEntry(rawEntry: string): AllowlistPattern | null {
    const entry: string = PrivateNetworkWebhookConfig.normalizeEntry(rawEntry);

    if (!entry) {
      return null;
    }

    if (entry.includes("/")) {
      return PrivateNetworkWebhookConfig.parseCidr(entry);
    }

    const bareIp: string = PrivateNetworkWebhookConfig.stripBrackets(entry);

    if (net.isIPv4(bareIp)) {
      return {
        type: "cidr",
        networkBytes: PrivateNetworkWebhookConfig.ipv4ToBytes(bareIp),
        prefixLength: 32,
      };
    }

    if (net.isIPv6(bareIp)) {
      const bytes: Array<number> | null =
        PrivateNetworkWebhookConfig.ipv6ToBytes(bareIp);
      return bytes
        ? { type: "cidr", networkBytes: bytes, prefixLength: 128 }
        : null;
    }

    if (entry.startsWith("*.")) {
      const suffix: string = entry.substring(2);
      return PrivateNetworkWebhookConfig.isPlausibleHostname(suffix)
        ? { type: "subdomain", dottedSuffix: `.${suffix}` }
        : null;
    }

    /*
     * Digits and dots only means an IPv4 address was intended and the
     * net.isIPv4 check above already turned it down - "10.0.0.256", say.
     * Registering it as a HOSTNAME would leave an entry that can never match
     * anything, which reads as an allowlist that covers a host it does not.
     */
    if (DIGITS_AND_DOTS_ONLY.test(entry)) {
      return null;
    }

    if (!PrivateNetworkWebhookConfig.isPlausibleHostname(entry)) {
      return null;
    }

    return { type: "hostname", hostname: entry };
  }

  /*
   * An operator writing this into a .env file will sooner or later paste the
   * whole webhook URL, or add the port they use. Both are unambiguous to
   * recover, and silently ignoring the entry would be a footgun that only
   * shows up as "I allowlisted it and it still fails".
   */
  private static normalizeEntry(rawEntry: string): string {
    let entry: string = rawEntry.trim().toLowerCase();

    if (!entry) {
      return "";
    }

    // Strip a scheme and anything from the first path separator onwards.
    entry = entry.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    const pathIndex: number = entry.search(/[/?#]/);
    /*
     * A "/" that is part of a CIDR prefix must survive; only a "/" followed by
     * something that is not a bare prefix length is a path.
     */
    if (pathIndex !== -1 && !BARE_CIDR.test(entry)) {
      entry = entry.substring(0, pathIndex);
    }

    // Strip userinfo — the host is everything after the last "@".
    const atIndex: number = entry.lastIndexOf("@");
    if (atIndex !== -1) {
      entry = entry.substring(atIndex + 1);
    }

    // Strip a port from "[::1]:8080" / "mattermost.internal:8065".
    if (entry.startsWith("[")) {
      const closing: number = entry.indexOf("]");
      if (closing !== -1) {
        const inner: string = entry.slice(1, closing);
        /*
         * Keep a "/nn" that followed the bracket - "[fd00::]/8" is a CIDR, and
         * dropping the prefix would silently narrow it to a single host.
         */
        const remainder: RegExpMatchArray | null = entry
          .slice(closing + 1)
          .match(BRACKETED_CIDR_SUFFIX);
        entry = remainder ? `${inner}/${remainder[1]}` : inner;
      }
    } else if (!entry.includes("/")) {
      const colonCount: number = (entry.match(/:/g) || []).length;
      if (colonCount === 1) {
        entry = entry.split(":")[0] || "";
      }
    }

    // A trailing dot is the same name ("mattermost.internal." === "...").
    while (entry.endsWith(".") && entry.length > 1) {
      entry = entry.substring(0, entry.length - 1);
    }

    return entry;
  }

  private static stripBrackets(value: string): string {
    return value.replace(/^\[|\]$/g, "");
  }

  /*
   * Letters, digits, hyphens, dots and underscores, in labels of 1-63
   * characters. Anything else is a typo or a pasted fragment, and an allowlist
   * entry that matches nothing is worse than an error: it reads as protection
   * that is not there. Checked label-by-label rather than with one nested
   * quantifier, which would backtrack exponentially on a near-miss.
   */
  private static isPlausibleHostname(entry: string): boolean {
    if (!entry || entry.length > 253) {
      return false;
    }

    return entry.split(".").every((label: string) => {
      // At least one alphanumeric: a label of only "-" or "_" is never a host.
      return HOSTNAME_LABEL.test(label);
    });
  }

  private static parseCidr(entry: string): CidrPattern | null {
    const slashIndex: number = entry.lastIndexOf("/");
    const base: string = PrivateNetworkWebhookConfig.stripBrackets(
      entry.substring(0, slashIndex),
    );
    const prefixText: string = entry.substring(slashIndex + 1);

    if (!CIDR_PREFIX_LENGTH.test(prefixText)) {
      return null;
    }

    const prefixLength: number = parseInt(prefixText, 10);

    if (net.isIPv4(base)) {
      if (prefixLength > 32) {
        return null;
      }
      return {
        type: "cidr",
        networkBytes: PrivateNetworkWebhookConfig.ipv4ToBytes(base),
        prefixLength,
      };
    }

    if (net.isIPv6(base)) {
      if (prefixLength > 128) {
        return null;
      }
      const bytes: Array<number> | null =
        PrivateNetworkWebhookConfig.ipv6ToBytes(base);
      return bytes ? { type: "cidr", networkBytes: bytes, prefixLength } : null;
    }

    return null;
  }

  private static ipv4ToBytes(address: string): Array<number> {
    return address.split(".").map((octet: string) => {
      return parseInt(octet, 10);
    });
  }

  /*
   * Expands an IPv6 literal (any spelling, including a dotted-quad tail and a
   * zone id) into its 16 bytes. Returns null when it is not a valid IPv6
   * address.
   */
  private static ipv6ToBytes(address: string): Array<number> | null {
    let ip: string = address.toLowerCase();

    const zoneIndex: number = ip.indexOf("%");
    if (zoneIndex !== -1) {
      ip = ip.substring(0, zoneIndex);
    }

    if (!net.isIPv6(ip)) {
      return null;
    }

    // Fold a trailing "::ffff:10.0.0.1" style dotted quad into two hex groups.
    const lastColonIndex: number = ip.lastIndexOf(":");
    const tail: string = ip.substring(lastColonIndex + 1);
    if (tail.includes(".")) {
      if (!net.isIPv4(tail)) {
        return null;
      }
      const octets: Array<number> =
        PrivateNetworkWebhookConfig.ipv4ToBytes(tail);
      const high: string = (
        ((octets[0] as number) << 8) |
        (octets[1] as number)
      ).toString(16);
      const low: string = (
        ((octets[2] as number) << 8) |
        (octets[3] as number)
      ).toString(16);
      ip = `${ip.substring(0, lastColonIndex)}:${high}:${low}`;
    }

    const halves: Array<string> = ip.split("::");
    if (halves.length > 2) {
      return null;
    }

    const head: Array<string> =
      halves[0] === undefined || halves[0] === "" ? [] : halves[0].split(":");
    const rear: Array<string> =
      halves.length === 2 && halves[1] !== undefined && halves[1] !== ""
        ? halves[1].split(":")
        : [];

    let groups: Array<string>;
    if (halves.length === 2) {
      const zeroFill: number = 8 - head.length - rear.length;
      if (zeroFill < 0) {
        return null;
      }
      groups = [...head, ...new Array(zeroFill).fill("0"), ...rear];
    } else {
      groups = head;
    }

    if (groups.length !== 8) {
      return null;
    }

    const bytes: Array<number> = [];
    for (const group of groups) {
      const value: number = parseInt(group || "0", 16);
      if (Number.isNaN(value) || value < 0 || value > 0xffff) {
        return null;
      }
      bytes.push((value >> 8) & 0xff, value & 0xff);
    }

    return bytes;
  }

  /*
   * True when a hostname (never an IP literal — those go through
   * `isAddressAllowed`) is named by the allowlist.
   *
   * A hostname match short-circuits DNS resolution entirely: the operator said
   * "trust this name", and the whole point of naming `mattermost.internal` is
   * that it resolves into a range the blocklist would otherwise refuse.
   */
  public static isHostnameAllowed(hostname: string): boolean {
    const host: string = PrivateNetworkWebhookConfig.normalizeEntry(hostname);

    if (!host) {
      return false;
    }

    return PrivateNetworkWebhookConfig.getAllowlist().patterns.some(
      (pattern: AllowlistPattern) => {
        if (pattern.type === "hostname") {
          return pattern.hostname === host;
        }
        if (pattern.type === "subdomain") {
          return host.endsWith(pattern.dottedSuffix);
        }
        return false;
      },
    );
  }

  /*
   * True when a literal IP address — written into the URL, or returned by DNS
   * — falls inside an allowlisted CIDR.
   */
  public static isAddressAllowed(address: string): boolean {
    const candidates: Array<Array<number>> = [];

    const bare: string = PrivateNetworkWebhookConfig.stripBrackets(
      address.trim().toLowerCase(),
    );

    if (net.isIPv4(bare)) {
      candidates.push(PrivateNetworkWebhookConfig.ipv4ToBytes(bare));
    } else {
      const bytes: Array<number> | null =
        PrivateNetworkWebhookConfig.ipv6ToBytes(bare);

      if (!bytes) {
        return false;
      }

      candidates.push(bytes);

      /*
       * An IPv4-mapped address (::ffff:10.0.0.5) reaches the same host as the
       * bare IPv4, so an operator who allowlisted 10.0.0.0/8 means it to match
       * — otherwise a dual-stack resolver answering with the mapped form would
       * silently fall outside the list.
       */
      const isIpv4Mapped: boolean =
        bytes.slice(0, 10).every((byte: number) => {
          return byte === 0;
        }) &&
        bytes[10] === 0xff &&
        bytes[11] === 0xff;

      if (isIpv4Mapped) {
        candidates.push(bytes.slice(12));
      }
    }

    return PrivateNetworkWebhookConfig.getAllowlist().patterns.some(
      (pattern: AllowlistPattern) => {
        if (pattern.type !== "cidr") {
          return false;
        }

        return candidates.some((candidate: Array<number>) => {
          return PrivateNetworkWebhookConfig.isInCidr(candidate, pattern);
        });
      },
    );
  }

  private static isInCidr(
    addressBytes: Array<number>,
    pattern: CidrPattern,
  ): boolean {
    if (addressBytes.length !== pattern.networkBytes.length) {
      return false;
    }

    let bitsLeft: number = pattern.prefixLength;

    for (let index: number = 0; index < addressBytes.length; index++) {
      if (bitsLeft <= 0) {
        return true;
      }

      const bitsInThisByte: number = Math.min(8, bitsLeft);
      // bitsInThisByte is 1..8 here, so the shift never hits the 32-bit edge.
      const mask: number = (0xff << (8 - bitsInThisByte)) & 0xff;

      if (
        ((addressBytes[index] as number) & mask) !==
        ((pattern.networkBytes[index] as number) & mask)
      ) {
        return false;
      }

      bitsLeft -= bitsInThisByte;
    }

    return true;
  }
}
