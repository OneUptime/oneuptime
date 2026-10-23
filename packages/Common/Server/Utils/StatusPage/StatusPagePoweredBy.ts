import EnterpriseEdition from "../../Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../../Enterprise/EnterpriseFeature";

/*
 * Whether a status page is served without "Powered by OneUptime".
 *
 * Removing the line is an Enterprise feature
 * (EnterpriseFeature.StatusPageBranding). The page's switch
 * (StatusPage.hidePoweredByOneUptimeBranding) takes effect only while the
 * feature is active: on the Enterprise Edition with a license that includes
 * it, or in its trial or grace period, and on OneUptime Cloud, where the
 * Scale plan sells the switch. On the Community Edition, and once a
 * self-hosted license has lapsed, every page shows the line again. The
 * switch itself is kept, so the line goes again as soon as a license is
 * activated, with nothing to set twice.
 *
 * Asked per request, because the license changes at runtime. An unknown
 * license state counts as active (EnterpriseEdition.isFeatureActive), so a
 * page never flips while the license is being read.
 */
export const isPoweredByOneUptimeHidden: (
  hidePoweredByOneUptimeBranding: boolean | null | undefined,
) => boolean = (
  hidePoweredByOneUptimeBranding: boolean | null | undefined,
): boolean => {
  if (hidePoweredByOneUptimeBranding !== true) {
    return false;
  }

  return EnterpriseEdition.isFeatureActive(
    EnterpriseFeature.StatusPageBranding,
  );
};
