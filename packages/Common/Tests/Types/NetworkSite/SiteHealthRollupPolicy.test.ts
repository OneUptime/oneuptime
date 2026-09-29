import SiteHealthRollupPolicy, {
  DefaultSiteHealthRollupPolicy,
  DefaultSiteOfflineThresholdPercent,
  SiteHealthRollupPolicyValues,
  getSiteHealthRollupPolicyLabel,
  parseSiteHealthRollupPolicy,
} from "../../../Types/NetworkSite/SiteHealthRollupPolicy";

/*
 * The policy column is a free-form string in Postgres, so what it means
 * when it holds something unexpected is a product decision, not an
 * accident. It means "worst-of" — the pre-policy behaviour — because a
 * rollup that threw on a bad settings string would leave a site with no
 * verdict at all.
 */
describe("parseSiteHealthRollupPolicy", () => {
  it("round-trips every declared policy", () => {
    for (const policy of SiteHealthRollupPolicyValues) {
      expect(parseSiteHealthRollupPolicy(policy)).toBe(policy);
    }
  });

  it("falls back to the default for anything it does not recognise", () => {
    expect(parseSiteHealthRollupPolicy(null)).toBe(
      DefaultSiteHealthRollupPolicy,
    );
    expect(parseSiteHealthRollupPolicy(undefined)).toBe(
      DefaultSiteHealthRollupPolicy,
    );
    expect(parseSiteHealthRollupPolicy("")).toBe(DefaultSiteHealthRollupPolicy);
    expect(parseSiteHealthRollupPolicy("worststatus")).toBe(
      DefaultSiteHealthRollupPolicy,
    );
    expect(parseSiteHealthRollupPolicy("Averaged")).toBe(
      DefaultSiteHealthRollupPolicy,
    );
  });

  it("defaults to worst-of, so upgrading changes no existing site", () => {
    expect(DefaultSiteHealthRollupPolicy).toBe(
      SiteHealthRollupPolicy.WorstStatus,
    );
  });

  it("has a distinct label for every policy", () => {
    const labels: Set<string> = new Set(
      SiteHealthRollupPolicyValues.map((policy: SiteHealthRollupPolicy) => {
        return getSiteHealthRollupPolicyLabel(policy);
      }),
    );
    expect(labels.size).toBe(SiteHealthRollupPolicyValues.length);
  });

  it("keeps the default threshold inside 0..100", () => {
    expect(DefaultSiteOfflineThresholdPercent).toBeGreaterThan(0);
    expect(DefaultSiteOfflineThresholdPercent).toBeLessThanOrEqual(100);
  });
});
