import BadDataException from "./BadDataException";

/*
 * Why the egress guard refused a target.
 *
 * The guard deliberately SANITIZES its message for tenant-facing callers (see
 * EgressGuardOptions.includeResolvedAddressInError): a DNS failure and an
 * address-policy rejection produce one byte-identical sentence, because a
 * tenant who can tell them apart on a shared probe can enumerate internal DNS
 * names. That is correct, and this type does not weaken it.
 *
 * What it fixes is the collateral damage. Callers downstream had nothing but
 * that sanitized string to reason about, so API.getRequestFailedDetails matched
 * none of its patterns and reported monitor failures as "Unknown" with no
 * actionable detail. Carrying the STAGE on the exception restores the one bit
 * every caller legitimately needs without reopening the oracle: when detail is
 * suppressed, both the DNS branch and the address-policy branch report
 * `Unreachable`, so nothing observable distinguishes them.
 */
export enum EgressFailureReason {
  /*
   * The target is structurally unusable: no host, an unparseable URL, or a
   * scheme other than http/https. This is the tenant's own configuration
   * echoed back and never reveals anything about the probe's network.
   */
  InvalidTarget = "InvalidTarget",

  /*
   * Detail-suppressed merge of "the resolver failed or returned nothing" and
   * "the target resolves to an address policy forbids". Deliberately ONE
   * value: these two must stay indistinguishable to tenant-facing callers.
   */
  Unreachable = "Unreachable",

  // Detail permitted: the resolver threw, or returned no addresses at all.
  ResolutionFailed = "ResolutionFailed",

  // Detail permitted: an address the target resolves to is not allowed.
  AddressBlocked = "AddressBlocked",
}

/*
 * Extends BadDataException rather than replacing it so every existing
 * `instanceof BadDataException` check — including the security-relevant
 * fail-fast paths in the probe monitors — keeps behaving exactly as before.
 */
export default class EgressGuardException extends BadDataException {
  public readonly reason: EgressFailureReason;

  public constructor(message: string, reason: EgressFailureReason) {
    super(message);
    this.reason = reason;
  }

  /*
   * True when the refusal is about REACHING the target rather than the target
   * being malformed. Monitors treat these like any other network failure — a
   * probe whose own resolver has died must not be believed when it says every
   * monitor is down — whereas InvalidTarget is a configuration error that has
   * to surface immediately and unconditionally.
   */
  public isTargetUnreachable(): boolean {
    return this.reason !== EgressFailureReason.InvalidTarget;
  }
}
