import { EnterpriseLicenseSnapshot } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import { EnterpriseMarketplaceBillingState } from "Common/Types/EnterpriseLicense/EnterpriseMarketplaceBilling";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";
import SelfHostedMarketplaceConfig from "../Marketplace/Reporters/SelfHostedMarketplaceConfig";
import LicenseRanking from "./LicenseRanking";
import { LicenseTokenClassification } from "./LicenseToken";

/*
 * The license of a self-hosted installation bought on a cloud marketplace
 * (AWS Marketplace, Microsoft Marketplace, Google Cloud Marketplace): no
 * license key, but the marketplace's own word. Every hour the installation
 * reports its users to the marketplace (ee/Server/Marketplace); a report the
 * marketplace accepts says the buyer is subscribed and paying, and renews the
 * license for MARKETPLACE_LICENSE_RENEWAL_IN_MS.
 *
 *   valid    a report was accepted within the renewal window. Every feature,
 *            no seat limit (the marketplace bills every user).
 *   grace    reports have not been accepted for longer than that (an outage,
 *            a setup problem): the usual grace period after an expiry, so an
 *            outage never takes features away.
 *   expired  after the grace period - or at once when the marketplace's
 *            latest word is that the buyer is NOT subscribed (a cancelled
 *            or suspended purchase).
 *
 * Nothing here comes from configuration: ENTERPRISE_MARKETPLACE only says
 * which marketplace to ask, and the license follows what that marketplace
 * answered. An installation that names no marketplace has no marketplace
 * license, whatever an earlier run recorded.
 *
 * The marketplace license only ever adds to a license key: the installation
 * runs on whichever of the two classifies better (LicenseRanking), so a
 * refused purchase never takes away a valid key, and an expired key never
 * hides a paying marketplace subscription.
 */

/*
 * How long one accepted report keeps the installation licensed. Reports go
 * hourly; three days rides out a long outage of the marketplace or of the
 * installation's way out to it before the grace period even starts.
 */
export const MARKETPLACE_LICENSE_RENEWAL_IN_MS: number = 72 * 60 * 60 * 1000;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

/*
 * The marketplace ENTERPRISE_MARKETPLACE names, or null when it names none
 * (or one this build does not know). Read at call time, so a test or a
 * config reload is seen at once.
 */
export const getConfiguredMarketplace: (
  env?: Record<string, string | undefined>,
) => CloudMarketplace | null = (
  env: Record<string, string | undefined> = process.env,
): CloudMarketplace | null => {
  const value: string | undefined = env["ENTERPRISE_MARKETPLACE"];

  if (!value || !value.trim()) {
    return null;
  }

  return SelfHostedMarketplaceConfig.parseMarketplace(value);
};

export default class MarketplaceLicense {
  /*
   * The marketplace license, or null when there is none to speak of: the
   * installation names no marketplace, the record is another marketplace's,
   * or the marketplace has neither accepted nor refused anything yet.
   */
  public static classify(data: {
    state: EnterpriseMarketplaceBillingState | null;
    configuredMarketplace: CloudMarketplace | null;
    now: Date;
    graceDays: number;
  }): LicenseTokenClassification | null {
    const state: EnterpriseMarketplaceBillingState | null = data.state;

    if (
      !data.configuredMarketplace ||
      !state ||
      state.marketplace !== data.configuredMarketplace
    ) {
      return null;
    }

    const marketplaceName: string = CloudMarketplaceUtil.getDisplayName(
      state.marketplace,
    );
    const verifiedAt: Date | null = state.verifiedAt
      ? new Date(state.verifiedAt)
      : null;
    const refusedAt: Date | null = state.refusedAt
      ? new Date(state.refusedAt)
      : null;

    if (refusedAt && (!verifiedAt || refusedAt.getTime() >= verifiedAt.getTime())) {
      return {
        status: "expired",
        verification: "none",
        userLimit: null,
        isEvaluation: false,
        features: [],
        expiresAt: refusedAt,
        graceEndsAt: refusedAt,
        marketplace: state.marketplace,
        reason: "marketplace-refused",
        message: `${marketplaceName} says this installation is not subscribed to OneUptime Enterprise${state.refusal ? ` (${state.refusal})` : ""}. Subscribe again on ${marketplaceName}, or activate a license key.`,
      };
    }

    if (!verifiedAt) {
      return null;
    }

    const expiresAt: Date = new Date(
      verifiedAt.getTime() + MARKETPLACE_LICENSE_RENEWAL_IN_MS,
    );
    const graceEndsAt: Date = new Date(
      expiresAt.getTime() + data.graceDays * DAY_IN_MS,
    );
    const base: Pick<
      LicenseTokenClassification,
      | "verification"
      | "userLimit"
      | "isEvaluation"
      | "marketplace"
      | "reason"
      | "expiresAt"
    > = {
      verification: "none",
      userLimit: null,
      isEvaluation: false,
      marketplace: state.marketplace,
      reason: "marketplace",
      expiresAt,
    };

    if (data.now.getTime() < expiresAt.getTime()) {
      return {
        ...base,
        status: "valid",
        features: "all",
        message: `Licensed through ${marketplaceName}: every user is billed by the hour on your ${marketplaceName} account.`,
      };
    }

    if (data.now.getTime() <= graceEndsAt.getTime()) {
      return {
        ...base,
        status: "grace",
        graceReason: "expired",
        graceEndsAt,
        features: "all",
        message: `${marketplaceName} has not accepted this installation's usage reports since ${verifiedAt.toISOString()}. Enterprise features keep working until ${graceEndsAt.toISOString()}; fix the reporting (see the server logs) before then.`,
      };
    }

    return {
      ...base,
      status: "expired",
      graceEndsAt,
      features: [],
      message: `${marketplaceName} has not accepted this installation's usage reports since ${verifiedAt.toISOString()}, and the grace period is over.`,
    };
  }

  /*
   * The license the installation runs on: the token's classification, or
   * the marketplace's when it classifies strictly better. On a tie the token
   * stays - it carries terms the marketplace license does not (a verified
   * token's white-label right, for one).
   */
  public static pickBetter(
    token: LicenseTokenClassification,
    marketplace: LicenseTokenClassification | null,
  ): LicenseTokenClassification {
    if (!marketplace) {
      return token;
    }

    return LicenseRanking.compare(
      marketplace as EnterpriseLicenseSnapshot,
      token as EnterpriseLicenseSnapshot,
    ) > 0
      ? marketplace
      : token;
  }
}
