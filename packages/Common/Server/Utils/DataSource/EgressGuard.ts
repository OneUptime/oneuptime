import dns from "dns";
import http from "http";
import https from "https";
import net from "net";
import BadDataException from "../../../Types/Exception/BadDataException";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../Types/Exception/EgressGuardException";
import logger from "../Logger";
import OutboundProxyAgents, {
  OUTBOUND_PROXY_VARIABLES,
  OutboundAgentOptions,
  TargetTlsOptions,
} from "../OutboundProxyAgents";

export type { TargetTlsOptions };

/*
 * SSRF egress guard for outbound connections whose target is chosen by a
 * tenant.
 *
 * It started life guarding external Data Source connections — hence the
 * file's home — but the same policy now covers every sink where a project
 * member picks the host and a self-hosted install may legitimately point at
 * something internal: LLM providers (self-hosted Ollama/vLLM), SMTP servers
 * (project SMTP settings and the workflow Send Email step), SMTP OAuth token
 * endpoints, status page / dashboard domain verification, OIDC discovery and
 * Runbook HTTP steps. Sinks that can only ever be third-party
 * SaaS (Slack, Teams, subscriber webhooks) use SSRFProtection instead, which
 * blocks private ranges unconditionally.
 *
 * Without a guard these turn the API server into an authenticated request
 * proxy into whatever network it runs in (cloud metadata endpoints, internal
 * services, sibling tenants' infrastructure). Every caller must validate its
 * target through this guard before opening a socket.
 *
 * Policy:
 *  - ALWAYS blocked, in every deployment: loopback, link-local (cloud
 *    metadata lives at 169.254.169.254), unspecified, multicast, broadcast
 *    and reserved ranges. Nothing a data source legitimately targets lives
 *    there, and the app server's own loopback is exactly what an attacker
 *    wants.
 *  - PRIVATE ranges (RFC1918, CGNAT, ULA, benchmark/documentation nets):
 *    blocked when billing is enabled (multi-tenant SaaS), allowed for
 *    self-hosted installs — a self-hosted OneUptime's databases usually ARE
 *    on 10.x/192.168.x. Self-hosted operators can force SaaS behavior with
 *    DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true. A target no tenant chose is
 *    outside that block: LLMService passes blockPrivateAddresses: false for a
 *    global LLM provider, whose Base URL the operator or a master admin set.
 *
 * Validation happens on RESOLVED ADDRESSES, not hostnames, so decimal
 * (2130706433), octal (0177.0.0.1) and DNS-based tricks all get caught at
 * the same choke point: whatever getaddrinfo would connect to is what gets
 * checked. HTTP connectors additionally PIN the validated addresses into
 * the socket lookup so the checked address is the connected address (no
 * DNS-rebind window); SQL drivers connect by hostname immediately after
 * validation, accepting a small residual rebind window in exchange for
 * intact TLS hostname verification.
 *
 * An HTTP request goes through the outbound proxy the operator configured
 * (HTTPS_PROXY, HTTP_PROXY, ALL_PROXY), apart from the hosts in NO_PROXY, as
 * every other request of the server does. Its pinned agents
 * (createPinnedAgents) carry that route themselves, through Node's own proxy
 * support (OutboundProxyAgents), and are sent with axios's proxy off: axios
 * sent a proxy's user name and password percent-encoded (#10442), and copied
 * a request's certificate settings onto an https:// proxy's connection
 * (#10277). They answer only the checked host's name from the pin, look the
 * proxy's own name up as usual, and refuse every other name
 * (createPinnedLookupForTarget), so a proxy named by host name is reached
 * at its own address. Through a proxy it is the proxy that looks the
 * target's name up and connects: the docs (self-hosted/
 * private-network-access) ask the operator to police it there. A caller
 * whose target must be the one dialled asks for agents that never go
 * through a proxy (PinnedAgentOptions.direct).
 */

export interface ResolvedAddress {
  address: string;
  family: number; // 4 | 6
}

export type EgressResolveFunction = (
  hostname: string,
) => Promise<Array<ResolvedAddress>>;

export interface EgressGuardOptions {
  /*
   * Test seam / policy override. Undefined ⇒ derive from billing flag and
   * the DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES env var. Pass false only for a
   * target no tenant can choose (a global LLM provider), or when an operator
   * switch says so (probe private-network monitors).
   */
  blockPrivateAddresses?: boolean | undefined;
  // Test seam for DNS. Undefined ⇒ dns.promises.lookup with a timeout.
  resolveFunction?: EgressResolveFunction | undefined;
  /*
   * Noun used in error messages so a rejection names the thing the user was
   * actually configuring ("LLM provider host ... is not allowed"). Defaults
   * to "Data source".
   */
  targetLabel?: string | undefined;
  /*
   * Optional operator guidance appended only when a PRIVATE-tier address is
   * refused. It is deliberately omitted for loopback/link-local/reserved
   * ranges because those cannot be opened by the private-network switch.
   */
  privateNetworkHint?: string | undefined;
  /*
   * Whether a refused HOSTNAME may say why: which address it resolved to and
   * which policy refused it, or the resolver's own error. That is exactly what
   * an operator needs, and exactly what a tenant must not get — trying names
   * like `redis` or `kubernetes.default.svc.cluster.local` and comparing
   * "resolves to 10.1.2.3" with "could not resolve" maps the internal network
   * without a socket ever being opened. With false, every resolve-path refusal
   * is one sentence ("<Label> host X could not be reached.") and the precise
   * cause goes to the debug log.
   *
   * Undefined ⇒ shouldIncludeResolutionDetail(): detail on a self-hosted
   * install, where whoever configures the target also runs the network; none
   * wherever shouldBlockPrivateAddresses() is true, i.e. multi-tenant SaaS or
   * an operator who asked for SaaS policy. Shared-probe monitor requests pass
   * false outright, whatever the deployment. Literal IPs are unaffected: their
   * refusal echoes only what the caller typed.
   */
  includeResolvedAddressInError?: boolean | undefined;
  /*
   * TOTAL wall-clock budget for name resolution, across every attempt. It is a
   * safety net against a wedged resolver, not a latency policy: callers with
   * their own deadline (probe monitors have an execution-context timeout) pass
   * a value above the resolver's own configured budget so the resolver's
   * nameserver failover is allowed to finish, and let their deadline do the
   * real bounding. Defaults to DEFAULT_DNS_RESOLVE_BUDGET_IN_MS.
   */
  resolveTimeoutInMs?: number | undefined;
  /*
   * How many getaddrinfo attempts to make inside the budget above. Retrying
   * absorbs the transient resolver failures (EAI_AGAIN, a nameserver
   * restarting) that otherwise surface as a hard "target is down".
   */
  resolveAttempts?: number | undefined;
}

export interface PinnedAgents {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
}

/*
 * How a pinned request's agents are built, beside the pin itself:
 *
 *   - tls (TargetTlsOptions): how the target's certificate is checked, for
 *     that request alone - a Runbook HTTP step's settings
 *     (Types/Runbook/HttpStepCertificates), a workflow API step's or a
 *     playbook's Send Webhook's (Types/Webhook/WebhookCertificates). They go
 *     on the https agent built for that request, so they reach the TLS
 *     connection to the target and nothing else - never another request,
 *     never the global agent, never NODE_TLS_REJECT_UNAUTHORIZED, and never
 *     the connection to an https:// outbound proxy, which keeps the CAs the
 *     process trusts. Unset, the target is checked as every request's is;
 *   - direct: never through an outbound proxy, whatever the environment
 *     says - a Git server, a Mattermost server, an MCP client's metadata
 *     document, where a proxy would connect somewhere the check never saw.
 */
export type PinnedAgentOptions = Omit<OutboundAgentOptions, "lookup">;

/*
 * The agents of a client sent with Node's own http client that learns its
 * hosts as it goes (createGuardedAgentsForNodeHttp).
 */
export interface GuardedNodeHttpAgents {
  // The agent a request to `url` goes out on, through a proxy or directly.
  agentFor(url: URL): http.Agent;
  destroy(): void;
}

/*
 * http.Agent's createSocket, which every new socket of an agent is made
 * by, the request's options in hand. Not in @types/node; agent-base, which
 * https-proxy-agent is built on, takes the same hook.
 */
type AgentCreateSocket = (
  request: http.ClientRequest,
  options: http.ClientRequestArgs,
  callback: (error: Error | null, socket?: net.Socket) => void,
) => void;

/*
 * What an HTTP request's agents are pinned to: the URL that was checked,
 * whose host name is the one name they connect to, and the addresses its
 * check approved for it.
 */
export interface PinnedTarget {
  url: URL;
  addresses: Array<ResolvedAddress>;
}

/*
 * The environment variables an outbound proxy is read from, by axios
 * (proxy-from-env) and by OutboundProxy, in either case.
 */
export const OUTBOUND_PROXY_ENVIRONMENT_VARIABLES: ReadonlyArray<string> =
  OUTBOUND_PROXY_VARIABLES;

// What a pinned HTTP agent's lookup answers when it is asked for any other name.
export const UNAPPROVED_LOOKUP_MESSAGE: string =
  "A request connects only to the address its URL check approved.";

/*
 * dns.lookup's shape, as http.Agent / net.Socket call it. Declared locally
 * rather than pulled from @types/node because the real declaration is a heavy
 * overload set and every consumer here uses exactly this one shape.
 */
export type EgressLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

export type EgressLookupFunction = (
  hostname: string,
  options: { all?: boolean | undefined; family?: number | undefined },
  callback: EgressLookupCallback,
) => void;

const DEFAULT_TARGET_LABEL: string = "Data source";

export interface AddressVerdict {
  blocked: boolean;
  reason?: string | undefined;
  isPrivateNetwork?: boolean | undefined;
}

/*
 * Total resolution budget. Chosen so existing callers see no change in
 * worst-case latency versus the single 5s lookup this replaced — the retries
 * below fit INSIDE the same budget rather than extending it.
 */
export const DEFAULT_DNS_RESOLVE_BUDGET_IN_MS: number = 5000;

/*
 * getaddrinfo fails transiently far more often than a host actually
 * disappears — EAI_AGAIN under resolver load is the classic case, and it is
 * why the Helm chart ships fallback nameservers. One shot at it turned every
 * such blip into a monitor-down incident.
 */
export const DEFAULT_DNS_RESOLVE_ATTEMPTS: number = 3;

// Short enough that three attempts still fit comfortably in a 5s budget.
const DNS_RESOLVE_RETRY_DELAY_IN_MS: number = 150;

interface Ipv4Range {
  base: number;
  maskBits: number;
  reason: string;
}

type RangeSpec = [string, number, string];

const ALWAYS_BLOCKED_IPV4_RANGE_SPECS: Array<RangeSpec> = [
  ["127.0.0.0", 8, "loopback address"],
  ["169.254.0.0", 16, "link-local address (cloud metadata range)"],
  ["100.100.100.200", 32, "cloud metadata address"],
  ["168.63.129.16", 32, "cloud platform metadata address"],
  ["192.0.0.192", 32, "cloud metadata address"],
  ["0.0.0.0", 8, "unspecified address"],
  ["224.0.0.0", 4, "multicast address"],
  ["240.0.0.0", 4, "reserved address"],
];

const PRIVATE_IPV4_RANGE_SPECS: Array<RangeSpec> = [
  ["10.0.0.0", 8, "private network address"],
  ["172.16.0.0", 12, "private network address"],
  ["192.168.0.0", 16, "private network address"],
  ["100.64.0.0", 10, "carrier-grade NAT address"],
  ["192.0.0.0", 24, "IETF protocol assignment address"],
  ["198.18.0.0", 15, "benchmarking address"],
  ["192.0.2.0", 24, "documentation address"],
  ["198.51.100.0", 24, "documentation address"],
  ["203.0.113.0", 24, "documentation address"],
];

export default class DataSourceEgressGuard {
  public static shouldBlockPrivateAddresses(): boolean {
    if (process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] === "true") {
      return true;
    }
    /*
     * Read BILLING_ENABLED at call time rather than the boot-time
     * IsBillingEnabled const, so this policy is consistent with the env
     * override checked above and can be exercised deterministically in tests
     * (a self-hosted install with billing off must still be able to reach its
     * own private ranges). In a running deployment the env is fixed at boot,
     * so this is behaviourally identical to the const.
     */
    return process.env["BILLING_ENABLED"] === "true";
  }

  /*
   * Default for EgressGuardOptions.includeResolvedAddressInError, and for the
   * equivalent switch on SSRFProtection. It keys off the private-address
   * POLICY of the deployment, not off any per-call override of it: the oracle
   * exists because the person choosing the target is not trusted with the
   * network's layout, and that is a property of the deployment. So a caller
   * that loosens blockPrivateAddresses on SaaS still gets no detail unless it
   * asks for it explicitly.
   */
  public static shouldIncludeResolutionDetail(
    includeResolvedAddressInError?: boolean | undefined,
  ): boolean {
    return includeResolvedAddressInError ?? !this.shouldBlockPrivateAddresses();
  }

  private static ipv4ToInt(ip: string): number {
    const parts: Array<string> = ip.split(".");
    let value: number = 0;
    for (const part of parts) {
      value = value * 256 + parseInt(part, 10);
    }
    // >>> 0 keeps the value an unsigned 32-bit int.
    return value >>> 0;
  }

  private static buildRanges(specs: Array<RangeSpec>): Array<Ipv4Range> {
    return specs.map((spec: RangeSpec) => {
      return {
        base: this.ipv4ToInt(spec[0]),
        maskBits: spec[1],
        reason: spec[2],
      };
    });
  }

  private static isInRange(ipAsInt: number, range: Ipv4Range): boolean {
    /*
     * maskBits 0 would shift by 32 (undefined behavior in JS bitwise ops);
     * no range here uses it, but guard anyway.
     */
    if (range.maskBits <= 0) {
      return true;
    }
    const mask: number = (0xffffffff << (32 - range.maskBits)) >>> 0;
    return (ipAsInt & mask) >>> 0 === (range.base & mask) >>> 0;
  }

  private static checkIpv4(
    ip: string,
    blockPrivateAddresses: boolean,
  ): AddressVerdict {
    const ipAsInt: number = this.ipv4ToInt(ip);

    if (ip === "255.255.255.255") {
      return { blocked: true, reason: "broadcast address" };
    }

    for (const range of this.buildRanges(ALWAYS_BLOCKED_IPV4_RANGE_SPECS)) {
      if (this.isInRange(ipAsInt, range)) {
        return { blocked: true, reason: range.reason };
      }
    }

    if (blockPrivateAddresses) {
      for (const range of this.buildRanges(PRIVATE_IPV4_RANGE_SPECS)) {
        if (this.isInRange(ipAsInt, range)) {
          return {
            blocked: true,
            reason: range.reason,
            isPrivateNetwork: true,
          };
        }
      }
    }

    return { blocked: false };
  }

  /*
   * Expand an IPv6 address to its full 8-group lowercase form so prefix
   * checks are string-safe ("fe80::1" -> "fe80:0000:...:0001"). Zone ids
   * (%eth0) are stripped first.
   */
  private static expandIpv6(ip: string): string | null {
    let address: string = ip.toLowerCase();
    const zoneIndex: number = address.indexOf("%");
    if (zoneIndex !== -1) {
      address = address.substring(0, zoneIndex);
    }

    /*
     * Convert a trailing embedded IPv4 (::ffff:127.0.0.1) into two hex
     * groups so the group math below is uniform.
     */
    const lastColon: number = address.lastIndexOf(":");
    const tail: string = address.substring(lastColon + 1);
    if (tail.includes(".")) {
      if (net.isIPv4(tail) === false) {
        return null;
      }
      const octets: Array<number> = tail.split(".").map((part: string) => {
        return parseInt(part, 10);
      });
      const groupA: string = ((octets[0]! << 8) | octets[1]!).toString(16);
      const groupB: string = ((octets[2]! << 8) | octets[3]!).toString(16);
      address = `${address.substring(0, lastColon)}:${groupA}:${groupB}`;
    }

    const doubleColonParts: Array<string> = address.split("::");
    if (doubleColonParts.length > 2) {
      return null;
    }

    let groups: Array<string>;
    if (doubleColonParts.length === 2) {
      const head: Array<string> = doubleColonParts[0]
        ? doubleColonParts[0].split(":")
        : [];
      const tailGroups: Array<string> = doubleColonParts[1]
        ? doubleColonParts[1].split(":")
        : [];
      const missing: number = 8 - head.length - tailGroups.length;
      if (missing < 0) {
        return null;
      }
      groups = [...head, ...Array(missing).fill("0"), ...tailGroups];
    } else {
      groups = address.split(":");
    }

    if (groups.length !== 8) {
      return null;
    }

    return groups
      .map((group: string) => {
        return group.padStart(4, "0");
      })
      .join(":");
  }

  private static checkIpv6(
    ip: string,
    blockPrivateAddresses: boolean,
  ): AddressVerdict {
    const expanded: string | null = this.expandIpv6(ip);
    if (!expanded) {
      return { blocked: true, reason: "unparseable IPv6 address" };
    }

    /*
     * IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96) addresses
     * reach IPv4 targets — extract the embedded IPv4 and apply the IPv4
     * policy so mapping can't be used to smuggle a blocked v4 address.
     */
    const embeddedV4Prefixes: Array<string> = [
      "0000:0000:0000:0000:0000:ffff:",
      "0064:ff9b:0000:0000:0000:0000:",
    ];
    for (const prefix of embeddedV4Prefixes) {
      if (expanded.startsWith(prefix)) {
        const hexGroups: Array<string> = expanded
          .substring(prefix.length)
          .split(":");
        const high: number = parseInt(hexGroups[0]!, 16);
        const low: number = parseInt(hexGroups[1]!, 16);
        const embedded: string = [
          (high >> 8) & 0xff,
          high & 0xff,
          (low >> 8) & 0xff,
          low & 0xff,
        ].join(".");
        return this.checkIpv4(embedded, blockPrivateAddresses);
      }
    }

    const allZero: boolean = expanded === "0000:".repeat(7) + "0000";
    if (allZero) {
      return { blocked: true, reason: "unspecified address" };
    }
    if (expanded === "0000:".repeat(7) + "0001") {
      return { blocked: true, reason: "loopback address" };
    }

    const groups: Array<number> = expanded.split(":").map((group: string) => {
      return parseInt(group, 16);
    });

    /*
     * These cloud-local IPv6 endpoints expose instance metadata or workload
     * credentials. They remain forbidden even when a self-hosted operator
     * explicitly enables ordinary private-network monitor targets.
     */
    if (groups[0] === 0xfd00 && groups[1] === 0x0ec2) {
      return { blocked: true, reason: "cloud metadata address" };
    }
    if (expanded === "fd20:00ce:0000:0000:0000:0000:0000:0254") {
      return { blocked: true, reason: "cloud metadata address" };
    }

    /*
     * RFC 8215 reserves 64:ff9b:1::/48 for locally assigned IPv4/IPv6
     * translation. Its IPv4 layout is operator-defined, so it cannot be
     * decoded safely here and the special-use prefix is refused wholesale.
     * RFC 2765's legacy IPv4-translated prefix receives the same treatment.
     */
    if (
      expanded.startsWith("0064:ff9b:0001:") ||
      expanded.startsWith("0000:0000:0000:0000:ffff:0000:")
    ) {
      return { blocked: true, reason: "IPv4 translation address" };
    }

    const embeddedIpv4: (highGroupIndex: number, invert?: boolean) => string = (
      highGroupIndex: number,
      invert: boolean = false,
    ): string => {
      let high: number = groups[highGroupIndex]!;
      let low: number = groups[highGroupIndex + 1]!;

      if (invert) {
        high ^= 0xffff;
        low ^= 0xffff;
      }

      return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    };

    /*
     * Deprecated IPv4-compatible ::/96 addresses are still understood by
     * network stacks. Classify the IPv4 destination they carry rather than
     * accepting the globally-looking IPv6 wrapper.
     */
    if (
      groups.slice(0, 6).every((group: number) => {
        return group === 0;
      })
    ) {
      return this.checkIpv4(embeddedIpv4(6), blockPrivateAddresses);
    }

    // 6to4 (2002::/16) stores its IPv4 gateway in the next 32 bits.
    if (groups[0] === 0x2002) {
      return this.checkIpv4(embeddedIpv4(1), blockPrivateAddresses);
    }

    /*
     * Teredo (2001:0000::/32) carries both a server IPv4 address and a
     * bitwise-inverted client IPv4 address. Either endpoint being forbidden
     * is enough to reject the route.
     */
    if (groups[0] === 0x2001 && groups[1] === 0) {
      return this.getStrictestVerdict(
        this.checkIpv4(embeddedIpv4(2), blockPrivateAddresses),
        this.checkIpv4(embeddedIpv4(6, true), blockPrivateAddresses),
      );
    }

    const firstGroup: number = parseInt(expanded.substring(0, 4), 16);
    // fe80::/10 link-local.
    if ((firstGroup & 0xffc0) === 0xfe80) {
      return { blocked: true, reason: "link-local address" };
    }
    // ff00::/8 multicast.
    if ((firstGroup & 0xff00) === 0xff00) {
      return { blocked: true, reason: "multicast address" };
    }

    if (blockPrivateAddresses) {
      // fc00::/7 unique-local.
      if ((firstGroup & 0xfe00) === 0xfc00) {
        return {
          blocked: true,
          reason: "private network address",
          isPrivateNetwork: true,
        };
      }
      // fec0::/10 deprecated site-local addresses are still routed in places.
      if ((firstGroup & 0xffc0) === 0xfec0) {
        return {
          blocked: true,
          reason: "private network address",
          isPrivateNetwork: true,
        };
      }
      // 2001:db8::/32 documentation.
      if (expanded.startsWith("2001:0db8:")) {
        return {
          blocked: true,
          reason: "documentation address",
          isPrivateNetwork: true,
        };
      }
    }

    return { blocked: false };
  }

  private static getStrictestVerdict(
    left: AddressVerdict,
    right: AddressVerdict,
  ): AddressVerdict {
    if (left.blocked && !left.isPrivateNetwork) {
      return left;
    }
    if (right.blocked && !right.isPrivateNetwork) {
      return right;
    }
    if (left.blocked) {
      return left;
    }
    if (right.blocked) {
      return right;
    }
    return { blocked: false };
  }

  /*
   * Verdict for a single literal IP address under the given (or derived)
   * policy. Exposed for tests and for connectors that receive addresses
   * from somewhere other than the standard resolve path.
   */
  public static checkAddress(
    address: string,
    options?: EgressGuardOptions,
  ): AddressVerdict {
    const blockPrivateAddresses: boolean =
      options?.blockPrivateAddresses ?? this.shouldBlockPrivateAddresses();

    const family: number = net.isIP(address);
    if (family === 4) {
      return this.checkIpv4(address, blockPrivateAddresses);
    }
    if (family === 6) {
      return this.checkIpv6(address, blockPrivateAddresses);
    }
    return { blocked: true, reason: "not a valid IP address" };
  }

  private static async lookupOnce(
    hostname: string,
    timeoutInMs: number,
  ): Promise<Array<ResolvedAddress>> {
    /*
     * dns.lookup (getaddrinfo) rather than dns.resolve so /etc/hosts and
     * container DNS behave exactly as the eventual socket connect would —
     * we must validate what would actually be dialed.
     */
    const lookupPromise: Promise<Array<ResolvedAddress>> = dns.promises
      .lookup(hostname, { all: true })
      .then((results: Array<{ address: string; family: number }>) => {
        return results.map((result: { address: string; family: number }) => {
          return { address: result.address, family: result.family };
        });
      });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined = undefined;
    const timeoutPromise: Promise<never> = new Promise(
      (_resolve: (value: never) => void, reject: (error: Error) => void) => {
        timeoutHandle = setTimeout(() => {
          reject(new BadDataException(`DNS lookup timed out for ${hostname}`));
        }, timeoutInMs);
      },
    );

    try {
      return await Promise.race([lookupPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /*
   * Resolve with a bounded number of retries inside ONE total budget.
   *
   * A resolver that answers "no" instantly (NXDOMAIN, SERVFAIL, EAI_AGAIN) is
   * retried within milliseconds, which is exactly the case that used to turn a
   * momentary blip into an incident. A resolver that HANGS consumes the budget
   * on its first attempt and is not retried, so the worst case is unchanged
   * from the single lookup this replaced.
   */
  private static async defaultResolve(
    hostname: string,
    options?: EgressGuardOptions,
  ): Promise<Array<ResolvedAddress>> {
    const budgetInMs: number = Math.max(
      1,
      options?.resolveTimeoutInMs ?? DEFAULT_DNS_RESOLVE_BUDGET_IN_MS,
    );
    const maxAttempts: number = Math.max(
      1,
      options?.resolveAttempts ?? DEFAULT_DNS_RESOLVE_ATTEMPTS,
    );

    const startedAt: number = Date.now();

    /*
     * Keep the FIRST failure, not the last. Attempt one gets the whole budget,
     * so its error is either the real resolver errno or a genuine full-budget
     * timeout; a later attempt runs on whatever is left and can time out
     * generically, burying the diagnosis. That errno is the entire value here
     * — for detail-permitted callers it IS the user-facing message, and for a
     * probe it is all the operator log has to go on.
     */
    let firstError: unknown = undefined;

    for (let attempt: number = 1; attempt <= maxAttempts; attempt++) {
      const remainingInMs: number = budgetInMs - (Date.now() - startedAt);

      if (remainingInMs <= 0) {
        break;
      }

      try {
        return await this.lookupOnce(hostname, remainingInMs);
      } catch (error) {
        if (firstError === undefined) {
          firstError = error;
        }
      }

      /*
       * Only sleep when another attempt can still start AND finish inside the
       * budget; otherwise the delay is pure added latency on a failure.
       */
      const budgetLeftInMs: number = budgetInMs - (Date.now() - startedAt);
      if (
        attempt >= maxAttempts ||
        budgetLeftInMs <= DNS_RESOLVE_RETRY_DELAY_IN_MS
      ) {
        break;
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, DNS_RESOLVE_RETRY_DELAY_IN_MS);
      });
    }

    throw (
      firstError ?? new BadDataException(`DNS lookup timed out for ${hostname}`)
    );
  }

  /*
   * Resolve a hostname (or accept a literal IP) and assert every address it
   * can reach is allowed. Returns the validated addresses so HTTP callers
   * can pin them into the socket lookup. Throws BadDataException when any
   * address is blocked — ALL must pass, otherwise a multi-record DNS answer
   * could mix one public decoy with a private target.
   */
  public static async assertHostnameAllowed(
    hostname: string,
    options?: EgressGuardOptions,
  ): Promise<Array<ResolvedAddress>> {
    const label: string = options?.targetLabel || DEFAULT_TARGET_LABEL;

    if (!hostname) {
      throw new EgressGuardException(
        `${label} host is required.`,
        EgressFailureReason.InvalidTarget,
      );
    }

    // Literal [::1] style hosts arrive with brackets from URL parsing.
    const bareHostname: string = hostname.replace(/^\[|\]$/g, "");

    if (net.isIP(bareHostname) !== 0) {
      const verdict: AddressVerdict = this.checkAddress(bareHostname, options);
      if (verdict.blocked) {
        /*
         * A literal IP is echoed back with full detail on purpose: it tells
         * the caller only what the caller itself typed.
         */
        throw new EgressGuardException(
          `${label} host ${bareHostname} is not allowed: ${verdict.reason}.${
            verdict.isPrivateNetwork ? options?.privateNetworkHint || "" : ""
          }`,
          EgressFailureReason.AddressBlocked,
        );
      }
      return [{ address: bareHostname, family: net.isIP(bareHostname) }];
    }

    const resolveFunction: EgressResolveFunction =
      options?.resolveFunction ||
      ((host: string) => {
        return this.defaultResolve(host, options);
      });

    const includeDetail: boolean = this.shouldIncludeResolutionDetail(
      options?.includeResolvedAddressInError,
    );

    let addresses: Array<ResolvedAddress> = [];
    try {
      addresses = await resolveFunction(bareHostname);
    } catch (error) {
      if (!includeDetail) {
        /*
         * The cause is destroyed for the caller by design, so log it here:
         * this is the only place an operator can still learn whether the
         * target failed on DNS or on address policy.
         */
        logger.debug(
          `EgressGuard: could not resolve ${bareHostname} - ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw new EgressGuardException(
          `${label} host ${bareHostname} could not be reached.`,
          EgressFailureReason.Unreachable,
        );
      }
      throw new EgressGuardException(
        `Could not resolve ${label.toLowerCase()} host ${bareHostname}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        EgressFailureReason.ResolutionFailed,
      );
    }

    if (addresses.length === 0) {
      if (!includeDetail) {
        logger.debug(`EgressGuard: ${bareHostname} resolved to no addresses.`);
        throw new EgressGuardException(
          `${label} host ${bareHostname} could not be reached.`,
          EgressFailureReason.Unreachable,
        );
      }
      throw new EgressGuardException(
        `Could not resolve ${label.toLowerCase()} host ${bareHostname}.`,
        EgressFailureReason.ResolutionFailed,
      );
    }

    for (const resolved of addresses) {
      const verdict: AddressVerdict = this.checkAddress(
        resolved.address,
        options,
      );
      if (verdict.blocked) {
        if (!includeDetail) {
          logger.debug(
            `EgressGuard: ${bareHostname} resolved to a blocked address ${resolved.address} - ${verdict.reason}.`,
          );
          /*
           * Reported as Unreachable, NOT AddressBlocked. Sharing one reason
           * with the DNS branches above is what stops a tenant from using the
           * difference to enumerate internal names.
           */
          throw new EgressGuardException(
            `${label} host ${bareHostname} could not be reached.`,
            EgressFailureReason.Unreachable,
          );
        }
        throw new EgressGuardException(
          `${label} host ${bareHostname} resolves to ${resolved.address}, which is not allowed: ${verdict.reason}.${
            verdict.isPrivateNetwork ? options?.privateNetworkHint || "" : ""
          }`,
          EgressFailureReason.AddressBlocked,
        );
      }
    }

    return addresses;
  }

  /*
   * Validate a full HTTP(S) URL: scheme must be http/https and the host
   * must pass address validation. Returns the parsed URL plus the pinned
   * addresses for the HTTP client.
   */
  public static async assertUrlAllowed(
    urlString: string,
    options?: EgressGuardOptions,
  ): Promise<{ url: URL; addresses: Array<ResolvedAddress> }> {
    const label: string = options?.targetLabel || DEFAULT_TARGET_LABEL;

    if (!urlString) {
      throw new EgressGuardException(
        `${label} URL is required.`,
        EgressFailureReason.InvalidTarget,
      );
    }

    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      throw new EgressGuardException(
        `Invalid ${label.toLowerCase()} URL: ${urlString}`,
        EgressFailureReason.InvalidTarget,
      );
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new EgressGuardException(
        `${label} URL must use http or https (got ${url.protocol.replace(
          ":",
          "",
        )}).`,
        EgressFailureReason.InvalidTarget,
      );
    }

    const addresses: Array<ResolvedAddress> = await this.assertHostnameAllowed(
      url.hostname,
      options,
    );

    return { url, addresses };
  }

  /*
   * A dns.lookup-shaped function that always answers with the already
   * validated addresses, whatever name it is asked about: for a socket that
   * dials one host and nothing else (an SMTP, IRC, syslog or Kafka
   * connection), where the checked address becomes the address that gets
   * dialed, closing the DNS-rebind window between validation and connect.
   * TLS still verifies against the original hostname because SNI is taken
   * from the URL, not from here. An HTTP agent, which may go through an
   * outbound proxy, takes createPinnedLookupForTarget instead.
   *
   * It always answers asynchronously, the way dns.lookup does. Node's
   * net/tls connect can fail every pinned address synchronously (a probe
   * with no IPv6 gets EADDRNOTAVAIL or ENETUNREACH from connect() itself),
   * and when the lookup has answered synchronously that destroys the
   * TLSSocket before tls.connect calls setServername on it. The request then
   * throws "Cannot read properties of null (reading 'setServername')" in
   * place of the real connect error, and that error escapes as an unhandled
   * 'error' event on the socket.
   */
  public static createPinnedLookup(
    addresses: Array<ResolvedAddress>,
  ): EgressLookupFunction {
    return (
      _hostname: string,
      lookupOptions: {
        all?: boolean | undefined;
        family?: number | undefined;
      },
      callback: EgressLookupCallback,
    ): void => {
      const wantedFamily: number | undefined = lookupOptions?.family;
      const usableAddresses: Array<ResolvedAddress> =
        wantedFamily === 4 || wantedFamily === 6
          ? addresses.filter((resolved: ResolvedAddress) => {
              return resolved.family === wantedFamily;
            })
          : addresses;

      if (usableAddresses.length === 0) {
        const error: NodeJS.ErrnoException = new Error(
          `No IPv${wantedFamily} address is available for the validated host.`,
        );
        error.code = "ENOTFOUND";
        process.nextTick(() => {
          callback(error, "");
        });
        return;
      }

      if (lookupOptions && lookupOptions.all) {
        const allAddresses: Array<{ address: string; family: number }> =
          usableAddresses.map((resolved: ResolvedAddress) => {
            return { address: resolved.address, family: resolved.family };
          });
        process.nextTick(() => {
          callback(null, allAddresses);
        });
        return;
      }

      const first: ResolvedAddress = usableAddresses[0]!;
      process.nextTick(() => {
        callback(null, first.address, first.family);
      });
    };
  }

  /*
   * A dns.lookup-shaped function for the agents of an HTTP request to one
   * URL, the one every pinned HTTP agent uses (createPinnedAgents, and
   * SafeWebhookRequest's through it):
   *
   *   - the URL's host name answers with the addresses its check approved,
   *     always: no second lookup, so a name that resolves somewhere else a
   *     moment later (DNS rebinding) is never dialled;
   *   - the host name of an outbound proxy the operator configured is
   *     looked up as any other request's would be. A request goes through
   *     HTTPS_PROXY, HTTP_PROXY or ALL_PROXY, unless NO_PROXY names its
   *     host, and these agents connect to the proxy: a forward proxy for
   *     http, and for https a CONNECT tunnel. Answering the proxy's name
   *     from the pin dialled the target's address on the proxy's port
   *     (issue #8873);
   *   - any other name is refused.
   *
   * A host written as an IP address is never looked up at all: Node dials
   * the literal, which is what the check approved.
   */
  public static createPinnedLookupForTarget(
    target: PinnedTarget,
  ): EgressLookupFunction {
    const pinnedLookup: EgressLookupFunction = this.createPinnedLookup(
      target.addresses,
    );
    const targetHostname: string = this.normalizeHostname(target.url.hostname);

    return (
      hostname: string,
      lookupOptions: { all?: boolean | undefined; family?: number | undefined },
      callback: EgressLookupCallback,
    ): void => {
      const name: string = this.normalizeHostname(hostname);

      if (name === targetHostname) {
        pinnedLookup(hostname, lookupOptions, callback);
        return;
      }

      if (this.getOutboundProxyHostnames().has(name)) {
        dns.lookup(
          hostname,
          (lookupOptions || {}) as dns.LookupAllOptions,
          callback as never,
        );
        return;
      }

      const error: NodeJS.ErrnoException = new Error(UNAPPROVED_LOOKUP_MESSAGE);
      error.code = "ENOTFOUND";

      process.nextTick(() => {
        callback(error, "");
      });
    };
  }

  /*
   * The hosts of the outbound proxies the environment names, read when they
   * are needed, as axios reads them: a value without a scheme is a host and
   * port.
   */
  public static getOutboundProxyHostnames(): Set<string> {
    const hostnames: Set<string> = new Set<string>();

    for (const variable of OUTBOUND_PROXY_ENVIRONMENT_VARIABLES) {
      const value: string = (process.env[variable] || "").trim();

      if (!value) {
        continue;
      }

      try {
        const proxyUrl: URL = new URL(
          value.includes("://") ? value : `http://${value}`,
        );
        const hostname: string = this.normalizeHostname(proxyUrl.hostname);

        if (hostname) {
          hostnames.add(hostname);
        }
      } catch {
        // Not a URL: axios cannot send through it either.
      }
    }

    return hostnames;
  }

  /*
   * An http and an https agent for a request to the target's URL: they dial
   * only the addresses its check approved, and an outbound proxy the
   * operator configured (createPinnedLookupForTarget). Every pinned request
   * goes out on these - with axios (`proxy: false`) or with Node's own http
   * client, which reads no proxy setting by itself (#8932) - and they go
   * through the outbound proxy themselves, decided as axios decides
   * (OutboundProxy.getProxyFor), through Node's own proxy support
   * (OutboundProxyAgents):
   *
   *   - through a proxy, the agent of the URL's scheme hands the request to
   *     the proxy: a CONNECT tunnel for https, naming the host the URL
   *     names, and for http the whole URL. The proxy's user name and
   *     password are sent decoded (#10442). The proxy's own name is looked
   *     up as usual, and never checked against the egress policy (a proxy
   *     on 10.x is the operator's, whatever the policy says of 10.x); it is
   *     the proxy that looks the target's name up and connects;
   *   - with no proxy, NO_PROXY naming the host, or `direct`, the agents
   *     dial the approved addresses only.
   *
   * Both agents carry their route, so axios, which reads the environment
   * only for an agent that carries none, never adds a proxy of its own on
   * top. Axios's own tunnel would also hand the https agent's options to
   * its connection to an https:// proxy, so a request's certificate
   * settings would reach the proxy's connection as well; Node's tunnel
   * keeps them to the target's (PinnedAgentOptions.tls).
   *
   * Destroy both once the request is over.
   */
  public static createPinnedAgents(
    target: PinnedTarget,
    options?: PinnedAgentOptions | undefined,
  ): PinnedAgents {
    const lookup: EgressLookupFunction =
      this.createPinnedLookupForTarget(target);

    return OutboundProxyAgents.createAgents(target.url, {
      tls: options?.tls,
      direct: options?.direct,
      lookup: lookup as never,
    });
  }

  /*
   * Agents for a client that learns its hosts as it goes and sends with
   * Node's own http client: openid-client, which adopts the token, userinfo
   * and JWKS URLs a discovery document names, and the backup storage
   * clients. agentFor(url) answers the agent a request to `url` goes out on:
   *
   *   - with no outbound proxy for it (OutboundProxy.getProxyFor, as axios
   *     decides), a direct agent whose lookup checks every name it is asked
   *     for and dials the addresses it approved (createGuardedLookup). An
   *     IP address, which Node never looks up, is checked before its socket
   *     opens;
   *   - through a proxy, an agent of that proxy that checks the host -
   *     looked up, every address it has held to the policy - before it hands
   *     the request to the proxy, as an axios request is checked before it
   *     goes through one. The proxy's own name is looked up as usual and
   *     never held to the policy.
   *
   * keepAlive keeps a connection open between requests to one host.
   */
  public static createGuardedAgentsForNodeHttp(
    options: EgressGuardOptions,
    agentOptions?: { keepAlive?: boolean | undefined },
  ): GuardedNodeHttpAgents {
    const keepAlive: boolean = agentOptions?.keepAlive === true;
    const lookup: EgressLookupFunction = this.createGuardedLookup(options);

    const checkAddressOnly: (host: string) => Promise<void> = async (
      host: string,
    ): Promise<void> => {
      if (net.isIP(this.normalizeHostname(host)) !== 0) {
        await this.assertHostnameAllowed(host, options);
      }
    };

    const checkHost: (host: string) => Promise<void> = async (
      host: string,
    ): Promise<void> => {
      await this.assertHostnameAllowed(host, options);
    };

    const directHttp: http.Agent = this.checkingEachSocket(
      new http.Agent({ keepAlive, lookup: lookup as never }),
      checkAddressOnly,
    );
    const directHttps: https.Agent = this.checkingEachSocket(
      new https.Agent({ keepAlive, lookup: lookup as never }),
      checkAddressOnly,
    );
    const proxied: Map<string, http.Agent> = new Map<string, http.Agent>();

    return {
      agentFor: (url: URL): http.Agent => {
        const isHttps: boolean = url.protocol === "https:";
        const proxy: URL | null = OutboundProxyAgents.getProxyFor(url);

        if (!proxy) {
          return isHttps ? directHttps : directHttp;
        }

        const key: string = `${url.protocol}${proxy.href}`;
        let agent: http.Agent | undefined = proxied.get(key);

        if (!agent) {
          agent = this.checkingEachSocket(
            isHttps
              ? new https.Agent({
                  keepAlive,
                  proxyEnv: { https_proxy: proxy.href },
                })
              : new http.Agent({
                  keepAlive,
                  proxyEnv: { http_proxy: proxy.href },
                }),
            checkHost,
          );
          proxied.set(key, agent);
        }

        return agent;
      },
      destroy: (): void => {
        directHttp.destroy();
        directHttps.destroy();

        for (const agent of proxied.values()) {
          agent.destroy();
        }

        proxied.clear();
      },
    };
  }

  /*
   * `agent`, with `check` run on the host of every socket it opens before
   * the socket is made; a refusal fails the request with the guard's error.
   * A socket kept alive for a host is reused unchecked, as it was checked
   * when it opened.
   */
  private static checkingEachSocket<T extends http.Agent>(
    agent: T,
    check: (host: string) => Promise<void>,
  ): T {
    const hooks: { createSocket: AgentCreateSocket } = agent as unknown as {
      createSocket: AgentCreateSocket;
    };
    const createSocket: AgentCreateSocket = hooks.createSocket.bind(agent);

    hooks.createSocket = (
      request: http.ClientRequest,
      options: http.ClientRequestArgs,
      callback: (error: Error | null, socket?: net.Socket) => void,
    ): void => {
      check(String(options.host || options.hostname || "")).then(
        () => {
          createSocket(request, options, callback);
        },
        (error: Error) => {
          callback(error);
        },
      );
    };

    return agent;
  }

  /*
   * Validate a URL and return agents pinned to what it resolved to — the
   * one-call form for HTTP callers. Pair with maxRedirects 0 /
   * doNotFollowRedirects: pinning only covers the host that was validated, so
   * a 3xx to an unvalidated host would otherwise walk straight around it.
   * Send the URL it returns, whose host name is the one the agents dial,
   * with axios's proxy off (`proxy: false`, API's disableProxy): the agents
   * go through the outbound proxy themselves (createPinnedAgents), checking
   * the target's certificate as `pin.tls` says.
   */
  public static async assertUrlAllowedAndPin(
    urlString: string,
    options?: EgressGuardOptions,
    pin?: PinnedAgentOptions | undefined,
  ): Promise<{ url: URL; addresses: Array<ResolvedAddress> } & PinnedAgents> {
    const { url, addresses } = await this.assertUrlAllowed(urlString, options);

    return {
      url,
      addresses,
      ...this.createPinnedAgents({ url, addresses }, pin),
    };
  }

  // A host name as a lookup compares it: no case, no IPv6 brackets.
  private static normalizeHostname(hostname: string): string {
    return (hostname || "")
      .trim()
      .toLowerCase()
      .replace(/^\[|\]$/g, "");
  }

  /*
   * A dns.lookup-shaped function that validates every hostname it is asked
   * about and then answers with the addresses it just checked.
   *
   * For libraries that build their own request URLs from documents they
   * fetched (openid-client adopts token_endpoint/userinfo_endpoint/jwks_uri
   * from the discovery document), pre-validating the one URL we know about
   * fixes nothing. Installing this as the library's lookup puts the guard on
   * every socket the library opens, whichever URL it decided to call.
   */
  public static createGuardedLookup(
    options?: EgressGuardOptions,
  ): EgressLookupFunction {
    return (
      hostname: string,
      lookupOptions: { all?: boolean | undefined; family?: number | undefined },
      callback: EgressLookupCallback,
    ): void => {
      this.assertHostnameAllowed(hostname, options)
        .then((addresses: Array<ResolvedAddress>) => {
          const wantedFamily: number | undefined =
            lookupOptions && lookupOptions.family
              ? lookupOptions.family
              : undefined;

          const usable: Array<ResolvedAddress> =
            wantedFamily === 4 || wantedFamily === 6
              ? addresses.filter((resolved: ResolvedAddress) => {
                  return resolved.family === wantedFamily;
                })
              : addresses;

          if (usable.length === 0) {
            const error: NodeJS.ErrnoException = new Error(
              `No IPv${wantedFamily} address for ${hostname}`,
            );
            error.code = "ENOTFOUND";
            callback(error, "");
            return;
          }

          this.createPinnedLookup(usable)(hostname, lookupOptions, callback);
        })
        .catch((error: Error) => {
          callback(error as NodeJS.ErrnoException, "");
        });
    };
  }
}
