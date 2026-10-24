import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";
import SelfHostedMarketplaceConfig, {
  SelfHostedMarketplaceConfigResult,
} from "./Reporters/SelfHostedMarketplaceConfig";
import { CloudMarketplaceUtil } from "Common/Types/Marketplace/CloudMarketplace";
import EnterpriseArea from "../Types/EnterpriseArea";
import { REPORT_MARKETPLACE_USAGE_JOB_NAME } from "./MarketplaceUsageRun";

/*
 * Billing a self-hosted installation bought on a cloud marketplace - AWS
 * Marketplace (EKS), Microsoft Marketplace (AKS) or Google Cloud Marketplace
 * (GKE) - by the user-hour, through that marketplace. The marketplace taking
 * the hourly reports is also what licenses the installation without a key
 * (License/MarketplaceLicense.ts).
 *
 * It does nothing on OneUptime Cloud or on an installation that names no
 * marketplace (ENTERPRISE_MARKETPLACE), and adds no routes.
 *
 *   init()               says in the log how this installation is billed,
 *                        and what is missing when its settings are not
 *                        complete
 *   registerWorkerJobs() the usage job, EnterpriseMarketplace:ReportUsage
 */

export const MARKETPLACE_JOB_NAMES: ReadonlyArray<string> = [
  REPORT_MARKETPLACE_USAGE_JOB_NAME,
];

// Whether this process bills through a marketplace at all. Read when asked.
export const isMarketplaceBillingWanted: (
  config?: SelfHostedMarketplaceConfigResult,
) => boolean = (config?: SelfHostedMarketplaceConfigResult): boolean => {
  if (IsBillingEnabled) {
    return false;
  }

  return (config || SelfHostedMarketplaceConfig.read()).kind !== "none";
};

const MarketplaceArea: EnterpriseArea = {
  name: "Marketplace",
  init: async (): Promise<void> => {
    const config: SelfHostedMarketplaceConfigResult =
      SelfHostedMarketplaceConfig.read();

    if (!isMarketplaceBillingWanted(config)) {
      return;
    }

    if (config.kind === "configured") {
      logger.info(
        `OneUptime Enterprise Edition: billed through ${CloudMarketplaceUtil.getDisplayName(config.settings.marketplace)}, by the user-hour. Enterprise features are licensed for as long as the marketplace accepts the hourly usage reports.`,
      );
      return;
    }

    if (config.kind === "incomplete") {
      logger.warn(
        `OneUptime Enterprise Edition: marketplace billing is not set up completely, so usage cannot be reported yet: ${config.problems.join(" ")}`,
      );
    }
  },
  registerWorkerJobs: async (): Promise<void> => {
    if (!isMarketplaceBillingWanted()) {
      return;
    }

    // RunCron registers the job when its module is first loaded.
    await import("./Jobs/ReportMarketplaceUsage");
  },
};

export default MarketplaceArea;
