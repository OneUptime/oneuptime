/*
 * How a NetworkSite turns the health of the devices in its subtree into ONE
 * status for itself.
 *
 * The two policies answer different questions, and which one a site should
 * use depends entirely on what the site represents:
 *
 *   - A Unit (one store, one branch) wants WorstStatus. Four switches and a
 *     firewall in one building are not independent - one of them dark is a
 *     problem at that address, and averaging it away hides the outage.
 *
 *   - A Region above four hundred stores wants PercentThreshold. Under
 *     WorstStatus a single dark switch in store 12,000 paints the whole
 *     region Offline, which is true in the narrowest sense and useless in
 *     every practical one: the region card can never be green, so it stops
 *     carrying information.
 *
 * WorstStatus is the default so that upgrading changes nothing about how any
 * existing site rolls up.
 */
export enum SiteHealthRollupPolicy {
  /*
   * The worst status any device in the subtree reports wins, where "worst"
   * is the highest MonitorStatus.priority. One offline device makes the site
   * offline, however many healthy devices sit beside it.
   */
  WorstStatus = "WorstStatus",

  /*
   * The site's status is decided by what SHARE of the subtree's devices are
   * non-operational:
   *
   *   share >= offlineThresholdPercent -> the project's offline status
   *   share > 0                        -> the project's degraded status
   *                                       (its offline status when the
   *                                       project has no degraded row)
   *   share == 0                       -> the project's operational status
   *
   * Devices that have never reported are not counted in either the numerator
   * or the denominator - the same rule WorstStatus uses when it skips a
   * pending device rather than reading it as an outage.
   */
  PercentThreshold = "PercentThreshold",
}

/*
 * Every policy value, for the settings dropdown and for validation. Kept
 * next to the enum so a new policy cannot be added without the picker
 * learning about it.
 */
export const SiteHealthRollupPolicyValues: Array<SiteHealthRollupPolicy> = [
  SiteHealthRollupPolicy.WorstStatus,
  SiteHealthRollupPolicy.PercentThreshold,
];

// Applied to any site that has never been given an explicit policy.
export const DefaultSiteHealthRollupPolicy: SiteHealthRollupPolicy =
  SiteHealthRollupPolicy.WorstStatus;

/*
 * Share of a subtree's reporting devices that must be non-operational before
 * a PercentThreshold site calls itself offline. Half is a deliberately
 * unopinionated starting point: it is the one value where "most of this
 * region is down" and "most of this region is up" swap places.
 */
export const DefaultSiteOfflineThresholdPercent: number = 50;

// Human-readable label for one policy, shared by the settings UI.
export function getSiteHealthRollupPolicyLabel(
  policy: SiteHealthRollupPolicy,
): string {
  if (policy === SiteHealthRollupPolicy.PercentThreshold) {
    return "Percentage of devices down";
  }
  return "Worst status of any device";
}

/*
 * Narrows an arbitrary stored string to a policy. A row written before the
 * column existed, or by a client that invented a value, falls back to the
 * default rather than throwing - a rollup must never fail because of one bad
 * settings string.
 */
export function parseSiteHealthRollupPolicy(
  value: string | null | undefined,
): SiteHealthRollupPolicy {
  if (
    value &&
    SiteHealthRollupPolicyValues.includes(value as SiteHealthRollupPolicy)
  ) {
    return value as SiteHealthRollupPolicy;
  }
  return DefaultSiteHealthRollupPolicy;
}

export default SiteHealthRollupPolicy;
