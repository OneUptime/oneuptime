import BaseAPI from "Common/Server/API/BaseAPI";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import EnterpriseLicenseInstanceService, {
  Service as EnterpriseLicenseInstanceServiceType,
} from "Common/Server/Services/EnterpriseLicenseInstanceService";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import EnterpriseLicenseInstance from "Common/Models/DatabaseModels/EnterpriseLicenseInstance";
import EnterpriseArea from "../Types/EnterpriseArea";
import EnterpriseLicenseAPI from "./EnterpriseLicenseAPI";
import EnterpriseLicenseOfflineTokenAPI from "./EnterpriseLicenseOfflineTokenAPI";
import LicenseSigner, {
  ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV,
} from "./LicenseSigner";

/*
 * The license server self-hosted Enterprise installations activate against
 * and report to. It runs only on the hosted oneuptime.com, where billing is
 * enabled; everywhere else this area contributes nothing, so a self-hosted
 * install no longer serves these unauthenticated endpoints at all.
 *
 * IsBillingEnabled is read when each hook is CALLED, never at import, so the
 * decision follows the process's configuration (and a test's pin).
 *
 *   init()               parses the license signing key (EdDSA or legacy)
 *   getApiRouters()      the license API + its generic CRUD for the Admin
 *                        Dashboard, the EnterpriseLicenseInstance CRUD the
 *                        license view lists, and the offline-token route
 *   registerWorkerJobs() license notification emails and the hourly
 *                        instance-usage reconciliation
 */

// The cron jobs registerWorkerJobs() registers (their RunCron names).
export const LICENSE_SERVER_JOB_NAMES: ReadonlyArray<string> = [
  "EnterpriseLicense:ReconcileInstanceUsage",
  "EnterpriseLicense:SendLicenseNotificationEmails",
];

export const initLicenseServer: () => Promise<void> =
  async (): Promise<void> => {
    if (!IsBillingEnabled) {
      /*
       * The signing key belongs to OneUptime Cloud alone. If it reached a
       * process that is not the license server, drop it from the environment
       * anyway so no child process inherits it.
       */
      if (
        process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV] !== undefined
      ) {
        delete process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV];
        logger.warn(
          `Enterprise license server: ${ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV} is set but this is not OneUptime Cloud (billing is disabled); it was ignored and removed from the environment.`,
        );
      }

      return;
    }

    LicenseSigner.init();
  };

export const getLicenseServerApiRouters: () => Array<ExpressRouter> =
  (): Array<ExpressRouter> => {
    if (!IsBillingEnabled) {
      return [];
    }

    return [
      new EnterpriseLicenseAPI().getRouter(),
      /*
       * Read/list/delete for the license view's instance table (empty table
       * access control - master admins only).
       */
      new BaseAPI<
        EnterpriseLicenseInstance,
        EnterpriseLicenseInstanceServiceType
      >(
        EnterpriseLicenseInstance,
        EnterpriseLicenseInstanceService,
      ).getRouter(),
      new EnterpriseLicenseOfflineTokenAPI().getRouter(),
    ];
  };

/*
 * Each job module registers itself with RunCron as it is evaluated, so
 * requiring it IS the registration - and only a billing-enabled process
 * requires them. A second call is a no-op (the module cache).
 */
export const registerLicenseServerWorkerJobs: () => Promise<void> =
  async (): Promise<void> => {
    if (!IsBillingEnabled) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("./Jobs/ReconcileInstanceUsage");
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("./Jobs/SendLicenseNotificationEmails");
  };

const LicenseServerArea: EnterpriseArea = {
  name: "LicenseServer",
  init: initLicenseServer,
  getApiRouters: getLicenseServerApiRouters,
  registerWorkerJobs: registerLicenseServerWorkerJobs,
};

export default LicenseServerArea;
