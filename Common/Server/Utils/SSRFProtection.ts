import URL from "../../Types/API/URL";
import BadDataException from "../../Types/Exception/BadDataException";
import PrivateNetworkWebhookConfig from "./PrivateNetworkWebhookConfig";
import dns from "dns";
import net from "net";

/*
 * Guards outbound HTTP(S) requests whose target is (fully or partly)
 * attacker-controlled — status page subscriber webhooks, project webhook
 * notifications, etc. — against Server-Side Request Forgery. It rejects URLs
 * that point at loopback, RFC-1918 private ranges, link-local (including the
 * 169.254.169.254 cloud metadata endpoint), CGNAT, and IPv6 loopback /
 * link-local / unique-local addresses, resolving DNS hostnames first so a
 * public-looking name that maps to an internal address is still blocked.
 *
 * This is a best-effort, TOCTOU-susceptible check: a hostname can resolve to a
 * different address between validation and the actual request (DNS rebinding).
 * Callers should therefore ALSO disable redirect-following on the request so a
 * validated public host cannot 3xx-redirect the server to an internal target.
 *
 * Blocked targets fall into two tiers, because a self-hosted install has a
 * legitimate reason to reach one of them and none at all to reach the other:
 *
 *   FORBIDDEN — loopback, unspecified, link-local (the 169.254.169.254 cloud
 *     metadata endpoint lives here), multicast, reserved, broadcast, and the
 *     hostnames that name them. Refused in every deployment. The only way past
 *     is an exact entry in the instance's PRIVATE_NETWORK_WEBHOOK_ALLOWLIST.
 *
 *   PRIVATE — RFC-1918, CGNAT, IPv6 unique-local and site-local. Refused by
 *     default, which is the only correct answer for multi-tenant SaaS, but a
 *     self-hosted operator can permit it with ALLOW_PRIVATE_NETWORK_WEBHOOKS
 *     (see PrivateNetworkWebhookConfig).
 *
 * The same guard runs on the sandboxed axios bridge (VMRunner), which is
 * shared with the Probe's custom code monitor. That caller reads its policy
 * from the PROBE's environment, not the API server's, and overrides
 * `targetLabel` and `privateNetworkHint` so its refusals name the right noun
 * and the right machine.
 *
 * The tier only widens for callers that pass
 * `allowPrivateNetworkTargets: true`, which means "this URL was authored by an
 * authenticated member of a project". Sinks whose target can be chosen by an
 * unauthenticated visitor — status page subscriber webhooks — pass nothing and
 * get the strict policy, so the exception can never be reached from outside
 * the tenant however the instance is configured.
 */

export enum WebhookAddressTier {
  Public = "Public",
  Private = "Private",
  Forbidden = "Forbidden",
}

export interface WebhookTargetValidationOptions {
  /*
   * A statement about the CALLER, not a permission: "this URL was written by
   * an authenticated member of a project, not by a passing visitor". It is
   * therefore a constant at each call site, never derived from request data.
   *
   * On its own it grants nothing — the instance configuration decides what, if
   * anything, it unlocks (PrivateNetworkWebhookConfig), and an instance that
   * configured neither knob is unaffected by it entirely. Its job is to keep
   * the exception out of reach of the one sink whose target an unauthenticated
   * visitor chooses.
   *
   * Absent means strict, so a new call site that says nothing is safe by
   * default.
   */
  allowPrivateNetworkTargets?: boolean | undefined;

  /*
   * What to call the thing in error messages. Defaults to "Webhook URL",
   * which is what most callers guard — but the same guard also sits on the
   * sandboxed axios bridge, and telling the author of a monitor that their
   * "webhook" was refused is simply wrong.
   */
  targetLabel?: string | undefined;

  /*
   * The sentence appended to a PRIVATE-tier refusal saying how to permit it.
   * It has to be per-caller: the setting that would allow a workflow webhook
   * lives on the API server, and the setting that would allow a probe's
   * monitor lives on the probe — usually a different machine, often owned by
   * a different person. Naming the wrong one is how an operator ends up
   * filing the bug this feature came from.
   */
  privateNetworkHint?: string | undefined;
}

const DEFAULT_TARGET_LABEL: string = "Webhook URL";

const DEFAULT_PRIVATE_NETWORK_HINT: string =
  " Self-hosted instances can allow this by setting ALLOW_PRIVATE_NETWORK_WEBHOOKS or PRIVATE_NETWORK_WEBHOOK_ALLOWLIST.";

export default class SSRFProtection {
  /*
   * Returns the bare, lowercased host of a URL — no port, no brackets — or an
   * empty string if it cannot be parsed. Host-pinning allowlists (Slack, Teams)
   * must compare against THIS, never against the whole URL string: a substring
   * check on the full URL is satisfied by an attacker-controlled path or query
   * (`http://169.254.169.254/?x=office.com`) and pins nothing.
   */
  public static getBareHostname(rawUrl: string | URL): string {
    /*
     * WHATWG, not URL.fromString. OneUptime's parser takes everything before
     * the first "/" as the authority and never terminates at "?" or "#", so it
     * reads "https://169.254.169.254#.office.com" as the host
     * "169.254.169.254#.office.com" - which ends with ".office.com" and
     * satisfied the allowlist, while axios re-parsed the same string per WHATWG
     * and dialled 169.254.169.254. A pin is only worth anything if it parses
     * the host the same way the HTTP client will.
     */
    let parsed: globalThis.URL;
    try {
      parsed = new globalThis.URL(rawUrl.toString());
    } catch {
      return "";
    }

    return SSRFProtection.extractHost(parsed.hostname.toLowerCase());
  }

  /*
   * True when the URL's host is exactly one of `allowedDomains` or a subdomain
   * of one, and the scheme is https. Suffix matching is anchored on a leading
   * dot so `office.com.attacker.tld` and `evil-office.com` are both rejected.
   */
  public static isUrlOnAllowedDomain(
    rawUrl: string | URL,
    allowedDomains: Array<string>,
  ): boolean {
    let parsed: globalThis.URL;
    try {
      parsed = new globalThis.URL(rawUrl.toString());
    } catch {
      return false;
    }

    // Scheme and host must come from the SAME parser, or they can disagree.
    if (parsed.protocol.toLowerCase() !== "https:") {
      return false;
    }

    const hostname: string = SSRFProtection.getBareHostname(rawUrl);

    if (!hostname) {
      return false;
    }

    return allowedDomains.some((domain: string) => {
      const allowed: string = domain.toLowerCase();
      return hostname === allowed || hostname.endsWith(`.${allowed}`);
    });
  }

  public static async validateWebhookTargetIsSafe(
    rawUrl: string | URL,
    options?: WebhookTargetValidationOptions,
  ): Promise<void> {
    const label: string = options?.targetLabel || DEFAULT_TARGET_LABEL;
    const privateNetworkHint: string =
      options?.privateNetworkHint ?? DEFAULT_PRIVATE_NETWORK_HINT;

    /*
     * URL.fromString only knows http/https/ws/wss/mongodb/mailto/tel/sms and
     * silently DEFAULTS anything else to https - "file:///etc/passwd" comes
     * back as host "file", not as a file: URL - so the protocol check below
     * never sees the scheme the caller actually wrote. Read it off the raw
     * string first.
     *
     * The ":" must be followed by "/" or this would treat the host in a
     * scheme-less "example.com:8080/hook" as a scheme and reject it.
     */
    const schemeMatch: RegExpMatchArray | null = rawUrl
      .toString()
      .trim()
      .match(/^([a-z][a-z0-9+.-]*):\//i);

    if (
      schemeMatch &&
      schemeMatch[1] &&
      !["http", "https"].includes(schemeMatch[1].toLowerCase())
    ) {
      throw new BadDataException(`${label} must use http or https protocol.`);
    }

    let parsed: URL;
    try {
      parsed = URL.fromString(rawUrl.toString());
    } catch {
      throw new BadDataException(`${label} is not a valid URL`);
    }

    const protocolValue: string = parsed.protocol.toString().toLowerCase();
    if (protocolValue !== "http://" && protocolValue !== "https://") {
      throw new BadDataException(`${label} must use http or https protocol.`);
    }

    const rawHost: string = parsed.hostname.hostname.toLowerCase();

    if (!rawHost) {
      throw new BadDataException(`${label} must include a host.`);
    }

    /*
     * OneUptime's URL parser hands back the whole authority — userinfo, host
     * and port glued together ("user:pw@169.254.169.254:80"). Reduce it to the
     * bare host before the checks below: a literal-with-port otherwise slips
     * past the IPv4 blocklist and, because it contains a ":", is mistaken for
     * an IP literal and skips DNS resolution entirely, and userinfo otherwise
     * gets to nominate the host outright.
     */
    const hostname: string = SSRFProtection.extractHost(rawHost);

    if (!hostname) {
      throw new BadDataException(`${label} must include a host.`);
    }

    /*
     * Check the host BOTH parsers see, not just ours.
     *
     * A guard is only worth something if it reasons about the host the HTTP
     * client will actually dial, and OneUptime's parser and WHATWG do not
     * always agree on which substring that is — userinfo was one such
     * disagreement, and treating it as the only one would be optimistic. So
     * whenever the two answers differ, both are held to the blocklist and a
     * verdict of "internal" from either one is enough to refuse. A legitimate
     * public URL parses to a public host under both, and pays only a string
     * comparison for the privilege.
     */
    const whatwgHostname: string = SSRFProtection.getBareHostname(rawUrl);

    const hostnames: Array<string> =
      whatwgHostname && whatwgHostname !== hostname
        ? [hostname, whatwgHostname]
        : [hostname];

    /*
     * The caller's declaration only ever reaches the instance configuration
     * through here. With it false — the default, and every sink whose URL an
     * unauthenticated visitor can choose — `isPrivateTierAllowed` and every
     * allowlist lookup below are false too, and the policy is bit-for-bit what
     * it was before the exception existed.
     */
    const isOptedIn: boolean = options?.allowPrivateNetworkTargets === true;
    const isPrivateTierAllowed: boolean =
      isOptedIn && PrivateNetworkWebhookConfig.isPrivateNetworkAllowed();

    /*
     * A host the operator named outright needs no further inspection — not the
     * tier check, and not DNS. That is the whole point of naming
     * "mattermost.internal": it resolves into a range the blocklist refuses,
     * and the operator has said to trust it anyway.
     */
    const isHostAllowlisted: (host: string) => boolean = (
      host: string,
    ): boolean => {
      if (!isOptedIn) {
        return false;
      }

      return SSRFProtection.isIpLiteral(host)
        ? PrivateNetworkWebhookConfig.isAddressAllowed(host)
        : PrivateNetworkWebhookConfig.isHostnameAllowed(host);
    };

    for (const host of hostnames) {
      if (isHostAllowlisted(host)) {
        continue;
      }

      const tier: WebhookAddressTier =
        SSRFProtection.classifyHostnameLiteral(host);

      if (tier === WebhookAddressTier.Forbidden) {
        throw new BadDataException(
          `${label} points to a private, loopback, or link-local address and is not allowed.`,
        );
      }

      if (tier === WebhookAddressTier.Private && !isPrivateTierAllowed) {
        throw new BadDataException(
          `${label} points to a private network address and is not allowed.${privateNetworkHint}`,
        );
      }
    }

    for (const host of hostnames) {
      if (SSRFProtection.isIpLiteral(host) || isHostAllowlisted(host)) {
        continue;
      }

      let resolved: Array<{ address: string }> = [];
      try {
        resolved = await dns.promises.lookup(host, { all: true });
      } catch {
        throw new BadDataException(
          `${label} hostname could not be resolved via DNS.`,
        );
      }

      for (const entry of resolved) {
        const address: string = entry.address.toLowerCase();

        if (
          isOptedIn &&
          PrivateNetworkWebhookConfig.isAddressAllowed(address)
        ) {
          continue;
        }

        const tier: WebhookAddressTier =
          SSRFProtection.classifyHostnameLiteral(address);

        if (tier === WebhookAddressTier.Forbidden) {
          throw new BadDataException(
            `${label} resolves to a private, loopback, or link-local address and is not allowed.`,
          );
        }

        if (tier === WebhookAddressTier.Private && !isPrivateTierAllowed) {
          throw new BadDataException(
            `${label} resolves to a private network address and is not allowed.${privateNetworkHint}`,
          );
        }
      }
    }
  }

  /*
   * Everything up to and including the LAST "@" is userinfo, never the host.
   *
   * This matters because OneUptime's Hostname deliberately KEEPS userinfo in
   * the string it stores, and a "host:port" split over that string reads the
   * USERNAME as the host: "example.com:pass@169.254.169.254" holds exactly one
   * colon, so splitting on it answers "example.com" — which resolves publicly
   * and sails through the blocklist — while every RFC 3986 client (axios, and
   * WHATWG before it) dials 169.254.169.254.
   *
   * The LAST "@" is the delimiter, which is how WHATWG resolves an authority
   * carrying more than one and therefore where the HTTP client will split it.
   * Hostname's own validation happens to reject a second "@" before this runs,
   * so the choice only shows up on hosts reaching us by another route — but
   * splitting on the first "@" would be a bypass the day that changes.
   */
  private static stripUserInfo(authority: string): string {
    const atIndex: number = authority.lastIndexOf("@");
    return atIndex === -1 ? authority : authority.substring(atIndex + 1);
  }

  /*
   * Extracts the bare host (IPv4, IPv6, or hostname) from a
   * "[userinfo@]host[:port]" string, handling bracketed IPv6 (`[::1]`,
   * `[::1]:8080`) and unbracketed IPv6 literals (which contain multiple colons
   * and carry no port).
   */
  private static extractHost(hostWithPort: string): string {
    const host: string = SSRFProtection.stripUserInfo(hostWithPort.trim());

    if (host.startsWith("[")) {
      const closingBracketIndex: number = host.indexOf("]");
      if (closingBracketIndex !== -1) {
        return host.slice(1, closingBracketIndex);
      }
      return host.replace(/^\[|\]$/g, "");
    }

    const colonCount: number = (host.match(/:/g) || []).length;

    if (colonCount > 1) {
      // Unbracketed IPv6 literal — colons are part of the address, not a port.
      return host;
    }

    if (colonCount === 1) {
      // host:port — keep only the host part.
      return host.split(":")[0] || "";
    }

    return host;
  }

  /*
   * An IP literal needs no DNS lookup - but "looks like it has a colon" is not
   * the same question, and getting it wrong is a bypass in both directions.
   * net.isIP is the authority: it rejects "2852039166" and "0177.0.0.1"
   * (which then go to DNS, where getaddrinfo decodes them and the resolved
   * address gets checked) and accepts every real IPv6 spelling.
   */
  private static isIpLiteral(hostname: string): boolean {
    return net.isIP(SSRFProtection.stripZoneId(hostname)) !== 0;
  }

  private static stripZoneId(address: string): string {
    const zoneIndex: number = address.indexOf("%");
    return zoneIndex === -1 ? address : address.substring(0, zoneIndex);
  }

  /*
   * Expands an IPv6 address into its eight 16-bit groups, folding an embedded
   * IPv4 tail ("::ffff:127.0.0.1") into two hex groups on the way, so that
   * every spelling of one address produces one canonical answer. Returns null
   * if the address is not parseable as IPv6.
   *
   * This exists because the checks below CANNOT be string prefix matches:
   * "::1", "0:0:0:0:0:0:0:1" and "0000:...:0001" are the same host, and
   * "::ffff:169.254.169.254" is the cloud metadata endpoint wearing a hat.
   */
  private static expandIpv6(address: string): Array<number> | null {
    let ip: string = SSRFProtection.stripZoneId(address.toLowerCase());

    if (net.isIPv6(ip) === false) {
      return null;
    }

    // Fold a dotted-quad tail into the two hex groups it stands for.
    const lastColonIndex: number = ip.lastIndexOf(":");
    const tail: string = ip.substring(lastColonIndex + 1);
    if (tail.includes(".")) {
      if (net.isIPv4(tail) === false) {
        return null;
      }
      const octets: Array<number> = tail.split(".").map((part: string) => {
        return parseInt(part, 10);
      });
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

    const parsed: Array<number> = groups.map((group: string) => {
      return parseInt(group || "0", 16);
    });

    if (
      parsed.some((group: number) => {
        return Number.isNaN(group) || group < 0 || group > 0xffff;
      })
    ) {
      return null;
    }

    return parsed;
  }

  /*
   * Tier of an IPv6 literal. Ranges, not spellings: loopback, unspecified,
   * link-local (fe80::/10) and multicast (ff00::/8) are FORBIDDEN;
   * unique-local (fc00::/7) and site-local (fec0::/10) are PRIVATE. The ways
   * IPv6 can embed IPv4 routing endpoints - IPv4-mapped (::ffff:0:0/96),
   * IPv4-compatible (::/96), NAT64 (64:ff9b::/96), 6to4 (2002::/16), and
   * Teredo (2001:0000::/32) - are handed to the IPv4 classifier, so an
   * embedded 10.0.0.1 is PRIVATE and an embedded 169.254.169.254 is FORBIDDEN
   * exactly as the bare forms are.
   */
  private static classifyIpv6(address: string): WebhookAddressTier {
    const groups: Array<number> | null = SSRFProtection.expandIpv6(address);

    if (!groups) {
      // Not parseable as IPv6; the caller's other checks decide.
      return WebhookAddressTier.Public;
    }

    const isZeroThrough: (endExclusive: number) => boolean = (
      endExclusive: number,
    ): boolean => {
      return groups.slice(0, endExclusive).every((group: number) => {
        return group === 0;
      });
    };

    const embeddedIpv4: (highGroupIndex: number, invert?: boolean) => string = (
      highGroupIndex: number,
      invert: boolean = false,
    ): string => {
      let high: number = groups[highGroupIndex] as number;
      let low: number = groups[highGroupIndex + 1] as number;

      // Teredo conceals the client IPv4 address by flipping all 32 bits.
      if (invert) {
        high ^= 0xffff;
        low ^= 0xffff;
      }

      return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    };

    // ::  — unspecified. Connecting here lands on the local host.
    if (isZeroThrough(8)) {
      return WebhookAddressTier.Forbidden;
    }

    // ::1 — loopback.
    if (isZeroThrough(7) && groups[7] === 1) {
      return WebhookAddressTier.Forbidden;
    }

    // ::ffff:0:0/96 — IPv4-mapped.
    if (isZeroThrough(5) && groups[5] === 0xffff) {
      return SSRFProtection.classifyIpv4(embeddedIpv4(6));
    }

    // 64:ff9b::/96 — NAT64 well-known prefix.
    if (
      groups[0] === 0x0064 &&
      groups[1] === 0xff9b &&
      groups[2] === 0 &&
      groups[3] === 0 &&
      groups[4] === 0 &&
      groups[5] === 0
    ) {
      return SSRFProtection.classifyIpv4(embeddedIpv4(6));
    }

    // ::/96 — IPv4-compatible (deprecated, still routable by some stacks).
    if (isZeroThrough(6)) {
      return SSRFProtection.classifyIpv4(embeddedIpv4(6));
    }

    // 2002::/16 — 6to4 stores the IPv4 gateway in bits 16-48.
    if (groups[0] === 0x2002) {
      return SSRFProtection.classifyIpv4(embeddedIpv4(1));
    }

    /*
     * 2001:0000::/32 — Teredo stores its server IPv4 in bits 32-64 and
     * an inverted client IPv4 in the last 32 bits. Either one landing
     * somewhere blocked condemns the address, so take the stricter verdict.
     */
    if (groups[0] === 0x2001 && groups[1] === 0) {
      return SSRFProtection.strictestTier(
        SSRFProtection.classifyIpv4(embeddedIpv4(2)),
        SSRFProtection.classifyIpv4(embeddedIpv4(6, true)),
      );
    }

    const first: number = groups[0] as number;

    // fe80::/10 — link-local.
    if ((first & 0xffc0) === 0xfe80) {
      return WebhookAddressTier.Forbidden;
    }

    // ff00::/8 — multicast.
    if ((first & 0xff00) === 0xff00) {
      return WebhookAddressTier.Forbidden;
    }

    // fc00::/7 — unique-local. A self-hosted install's own internal network.
    if ((first & 0xfe00) === 0xfc00) {
      return WebhookAddressTier.Private;
    }

    // fec0::/10 — site-local. Deprecated by RFC 3879, still routed on some networks.
    if ((first & 0xffc0) === 0xfec0) {
      return WebhookAddressTier.Private;
    }

    return WebhookAddressTier.Public;
  }

  private static strictestTier(
    left: WebhookAddressTier,
    right: WebhookAddressTier,
  ): WebhookAddressTier {
    if (
      left === WebhookAddressTier.Forbidden ||
      right === WebhookAddressTier.Forbidden
    ) {
      return WebhookAddressTier.Forbidden;
    }

    if (
      left === WebhookAddressTier.Private ||
      right === WebhookAddressTier.Private
    ) {
      return WebhookAddressTier.Private;
    }

    return WebhookAddressTier.Public;
  }

  private static classifyIpv4(address: string): WebhookAddressTier {
    const octets: Array<number> = address.split(".").map((part: string) => {
      return Number(part);
    });

    if (
      octets.length !== 4 ||
      octets.some((octet: number) => {
        return Number.isNaN(octet) || octet < 0 || octet > 255;
      })
    ) {
      /*
       * Unparseable. Refuse outright rather than fall through to "public":
       * whatever produced this is not something to hand to an HTTP client, and
       * it must not become reachable by opting in to the private tier either.
       */
      return WebhookAddressTier.Forbidden;
    }

    const [first, second] = octets as [number, number, number, number];

    if (first === 0) {
      return WebhookAddressTier.Forbidden; // 0.0.0.0/8 — "this host".
    }
    if (first === 127) {
      return WebhookAddressTier.Forbidden; // loopback
    }
    if (first === 169 && second === 254) {
      // link-local, incl. the 169.254.169.254 metadata endpoint
      return WebhookAddressTier.Forbidden;
    }
    if (first >= 224) {
      // multicast, reserved, and 255.255.255.255
      return WebhookAddressTier.Forbidden;
    }
    if (first === 10) {
      return WebhookAddressTier.Private; // RFC-1918
    }
    if (first === 172 && (second & 0xf0) === 16) {
      return WebhookAddressTier.Private; // RFC-1918 172.16/12
    }
    if (first === 192 && second === 168) {
      return WebhookAddressTier.Private; // RFC-1918
    }
    if (first === 100 && (second & 0xc0) === 64) {
      return WebhookAddressTier.Private; // CGNAT 100.64/10
    }

    return WebhookAddressTier.Public;
  }

  /*
   * Tier of a bare host — an IP literal in either family, or a hostname that
   * names the local machine on its own. Anything else is Public here and is
   * decided later on what DNS answers for it.
   */
  private static classifyHostnameLiteral(hostname: string): WebhookAddressTier {
    if (
      hostname === "localhost" ||
      hostname === "localhost." ||
      hostname.endsWith(".localhost") ||
      hostname === "metadata.google.internal"
    ) {
      return WebhookAddressTier.Forbidden;
    }

    const address: string = SSRFProtection.stripZoneId(
      hostname.replace(/^\[|\]$/g, ""),
    );

    if (net.isIPv4(address)) {
      return SSRFProtection.classifyIpv4(address);
    }

    if (net.isIPv6(address)) {
      return SSRFProtection.classifyIpv6(address);
    }

    return WebhookAddressTier.Public;
  }
}
