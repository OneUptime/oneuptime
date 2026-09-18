import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "../Types/EnterpriseArea";

/*
 * The license server self-hosted Enterprise installs activate against. It runs
 * only on the hosted oneuptime.com (billing enabled): its routers and its
 * cron jobs (license notification emails, instance usage reconciliation) must
 * be contributed only when billing is on.
 *
 * Skeleton: no routers or jobs yet. EnterpriseLicenseAPI and the
 * EnterpriseLicense/{ReconcileInstanceUsage,SendLicenseNotificationEmails}
 * jobs move here.
 */
const LicenseServerArea: EnterpriseArea = {
  name: "LicenseServer",
  getApiRouters: (): Array<ExpressRouter> => {
    return [];
  },
  registerWorkerJobs: async (): Promise<void> => {
    return undefined;
  },
};

export default LicenseServerArea;
