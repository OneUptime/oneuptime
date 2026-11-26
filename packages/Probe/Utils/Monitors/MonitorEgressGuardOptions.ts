import { EgressGuardOptions } from "Common/Server/Utils/DataSource/EgressGuard";

/*
 * WHERE A MONITOR'S REQUESTS MAY GO: ONE ANSWER FOR EVERY MONITOR THAT SENDS
 * THE PROJECT'S CHOICE OF REQUEST AND HANDS THE RESPONSE BACK.
 *
 * API, Website and External Status Page monitors (HttpMonitorRequest) and
 * Synthetic monitors - their browser and their script's axios
 * (SyntheticRuntime/SyntheticEgressProxy) - ask the egress guard with these
 * options, so a probe refuses the same targets whichever of them asks:
 *
 *   - loopback, link-local (the cloud metadata endpoint), unspecified,
 *     multicast and reserved addresses on every probe;
 *   - private addresses (RFC 1918, CGNAT, IPv6 unique-local) unless the
 *     probe's operator allowed them (PROBE_ALLOW_PRIVATE_NETWORK_MONITORS,
 *     resolved by PrivateNetworkMonitorPolicy; never on a global probe of a
 *     BILLING_ENABLED instance).
 *
 * Custom JavaScript Code monitors hold their sandbox's axios to the same two
 * tiers through Common's VMHttpBridge.
 *
 * Kept apart from Config.ts on purpose: the synthetic runtime's worker
 * process must not import Config (it exits without the probe's own
 * environment, which the worker is not given), so the supervisor resolves
 * the policy and hands it to the worker, which builds the same options here.
 */

/*
 * Total budget for the pre-flight name resolution of a monitor target.
 *
 * It has to sit ABOVE the resolver budget the probe itself is configured with,
 * or the guard cuts the lookup off before the resolver has finished its own
 * failover and a reachable host is reported down. The Helm chart ships
 * timeout:2 + attempts:2 over a cluster resolver plus two fallback
 * nameservers, so a single getaddrinfo can legitimately take ~12s before it
 * succeeds on a fallback — the very resilience those fallbacks exist to
 * provide. This is only a hang guard; the real per-check bound is the
 * monitor's own execution-context deadline, which reports an honest timeout.
 */
export const MONITOR_DNS_RESOLVE_BUDGET_IN_MS: number = 15000;

// How a refusal names what a monitor tried to reach.
export const MONITOR_TARGET_LABEL: string = "Monitor target";

export interface MonitorEgressPolicy {
  /*
   * Whether private network addresses may be reached: the probe's resolved
   * PROBE_ALLOW_PRIVATE_NETWORK_MONITORS. Loopback, link-local and the cloud
   * metadata endpoint stay refused either way.
   */
  allowPrivateNetworkAddresses: boolean;
  /*
   * Appended to a private-tier refusal, saying which setting would allow it
   * on this probe (PROBE_PRIVATE_NETWORK_HINT). Empty says nothing more.
   */
  privateNetworkHint: string;
}

/*
 * What a caller that was told nothing gets: public addresses only, the
 * policy of a global probe on a BILLING_ENABLED instance.
 */
export const PUBLIC_ONLY_MONITOR_EGRESS_POLICY: Readonly<MonitorEgressPolicy> =
  Object.freeze({
    allowPrivateNetworkAddresses: false,
    privateNetworkHint: "",
  });

export default class MonitorEgressGuardOptions {
  public static forPolicy(
    policy: MonitorEgressPolicy,
    targetLabel?: string | undefined,
  ): EgressGuardOptions {
    return {
      blockPrivateAddresses: !policy.allowPrivateNetworkAddresses,
      targetLabel: targetLabel || MONITOR_TARGET_LABEL,
      privateNetworkHint: policy.privateNetworkHint,
      /*
       * A project member must not learn whether a name resolved, or where
       * to: on a shared probe that maps the network the probe sits in.
       */
      includeResolvedAddressInError: false,
      resolveTimeoutInMs: MONITOR_DNS_RESOLVE_BUDGET_IN_MS,
    };
  }
}
