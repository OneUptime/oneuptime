import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import { ProjectBillingHooks } from "Common/Server/Enterprise/EnterpriseServerModule";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "../Types/EnterpriseArea";
import MarketplaceAPI from "./API/MarketplaceAPI";
import VercelMarketplaceProviderAPI from "./API/VercelMarketplaceProviderAPI";
import VercelSignInAPI from "./API/VercelSignIn";
import CloudMarketplaceProjectBillingHooks from "./ProjectBillingHooks";

/*
 * OneUptime Cloud sold on AWS Marketplace, Microsoft Marketplace (Azure),
 * Google Cloud Marketplace and Vercel Marketplace: each marketplace's
 * landing page, webhooks and event deliveries, the purchase page's routes,
 * the provider API Vercel calls and sign-in from Vercel, the hourly usage
 * reports, the daily reconciliation of purchases and the Vercel invoices.
 *
 * It runs only on the hosted oneuptime.com, where billing is enabled. With
 * billing off this area contributes nothing: no route, no job and no project
 * billing hooks, so a self-hosted installation serves none of these paths.
 * (Selling a self-hosted installation on a marketplace is the Marketplace
 * area's.)
 *
 * IsBillingEnabled is read when each hook is CALLED, never at import, so the
 * decision follows the process's configuration (and a test's pin).
 *
 *   getApiRouters()          /api/marketplace/... (MarketplaceAPI) and
 *                            /api/marketplace/vercel/...
 *                            (VercelMarketplaceProviderAPI)
 *   getIdentityRouters()     sign-in from Vercel, /identity/vercel/sso
 *                            (VercelSignIn)
 *   registerWorkerJobs()     the hourly usage report, the daily purchase
 *                            sync and the Vercel invoices
 *   getProjectBillingHooks() what a deleted project or a marketplace-billed
 *                            project's new plan means for its marketplace
 *                            (ProjectBillingHooks.ts)
 */

// The cron jobs registerWorkerJobs() registers (their RunCron names).
export const CLOUD_MARKETPLACE_JOB_NAMES: ReadonlyArray<string> = [
  "Marketplace:ReportUsage",
  "Marketplace:SyncPurchases",
  "Marketplace:VercelBilling",
];

export const getCloudMarketplaceApiRouters: () => Array<ExpressRouter> =
  (): Array<ExpressRouter> => {
    if (!IsBillingEnabled) {
      return [];
    }

    return [
      new MarketplaceAPI().getRouter(),
      new VercelMarketplaceProviderAPI().getRouter(),
    ];
  };

export const getCloudMarketplaceIdentityRouters: () => Array<ExpressRouter> =
  (): Array<ExpressRouter> => {
    if (!IsBillingEnabled) {
      return [];
    }

    return [VercelSignInAPI];
  };

/*
 * Each job module registers itself with RunCron as it is evaluated, so
 * requiring it IS the registration - and only a billing-enabled process
 * requires them. A second call is a no-op (the module cache).
 */
export const registerCloudMarketplaceWorkerJobs: () => Promise<void> =
  async (): Promise<void> => {
    if (!IsBillingEnabled) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("./Jobs/ReportMarketplaceUsage");
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("./Jobs/SyncMarketplacePurchases");
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("./Jobs/BillVercelMarketplace");
  };

export const getProjectBillingHooks: () => ProjectBillingHooks | null =
  (): ProjectBillingHooks | null => {
    if (!IsBillingEnabled) {
      return null;
    }

    return CloudMarketplaceProjectBillingHooks;
  };

const CloudMarketplaceArea: EnterpriseArea = {
  name: "CloudMarketplace",
  getApiRouters: getCloudMarketplaceApiRouters,
  getIdentityRouters: getCloudMarketplaceIdentityRouters,
  registerWorkerJobs: registerCloudMarketplaceWorkerJobs,
};

export default CloudMarketplaceArea;
