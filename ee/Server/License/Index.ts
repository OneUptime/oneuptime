import type { ExpressRouter } from "Common/Server/Utils/Express";
import type { EnterpriseLicensingProvider } from "Common/Server/Enterprise/EnterpriseServerModule";
import logger from "Common/Server/Utils/Logger";
import { IsDevelopment, IsTest } from "Common/Server/EnvironmentConfig";
import EnterpriseArea from "../Types/EnterpriseArea";
import { createLicenseClientRouter } from "./API/LicenseClientAPI";
import LicenseClient from "./LicenseClient";
import { LicenseInputs } from "./LicenseInputs";
import licenseProvider from "./LicenseProvider";
import { describeIgnoredLicenseServerUrl } from "./LicenseServerUrl";

/*
 * The license client of a self-hosted Enterprise installation:
 *
 *   - licensing   what core's EnterpriseEdition asks: the license snapshot
 *                 (cached inputs, classified against the current time), seat
 *                 usage and the seat check (LicenseProvider);
 *   - init        loads the license before any router is mounted, recording
 *                 the first run of the Enterprise Edition on the way (the
 *                 unlicensed trial counts from it), and refreshes an
 *                 unverified legacy license from oneuptime.com in the
 *                 background;
 *   - api         POST /global-config/license (activate online or offline) and
 *                 POST /global-config/license/refresh;
 *   - jobs        EnterpriseLicense:ReportUserCount, the daily usage report.
 */
export const licensing: EnterpriseLicensingProvider = licenseProvider;

/*
 * The boot refresh started by the last init(), if any. Exposed for tests; the
 * boot itself never waits for it.
 */
let lastBootRefresh: Promise<void> | null = null;

export const getLastBootRefresh: () => Promise<void> | null = ():
  | Promise<void>
  | null => {
  return lastBootRefresh;
};

const LicenseArea: EnterpriseArea = {
  name: "License",
  /*
   * Never throws and never waits on the network: a database blip leaves the
   * license unread (enterprise configuration read-only until it loads, the
   * provider retries on the next read) rather than stopping the boot.
   */
  init: async (): Promise<void> => {
    const ignoredServerUrl: string | null = describeIgnoredLicenseServerUrl({
      rawValue: process.env["ENTERPRISE_LICENSE_SERVER_URL"],
      allowInsecure: IsDevelopment || IsTest,
    });

    if (ignoredServerUrl) {
      logger.warn(`OneUptime Enterprise Edition: ${ignoredServerUrl}`);
    }

    // Never throws: a failed read is logged and retried on the next read.
    await licenseProvider.refresh();

    const inputs: LicenseInputs | null = licenseProvider.getCachedInputs();

    try {
      lastBootRefresh = LicenseClient.startBootRefreshIfUnverified(inputs);
    } catch (err) {
      lastBootRefresh = null;
      logger.warn(err);
    }
  },
  getApiRouters: (): Array<ExpressRouter> => {
    return [createLicenseClientRouter()];
  },
  registerWorkerJobs: async (): Promise<void> => {
    // RunCron registers the job when its module is first loaded.
    await import("./Jobs/ReportUserCount");
  },
};

export default LicenseArea;
