import type { ExpressRouter } from "Common/Server/Utils/Express";
import type { EnterpriseLicensingProvider } from "Common/Server/Enterprise/EnterpriseServerModule";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseSnapshotUtil,
  SeatUsage,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import EnterpriseArea from "../Types/EnterpriseArea";

/*
 * The license client: reads the stored license, classifies it
 * (LicenseToken.classifyLicenseToken), serves activation and refresh under
 * "/api", enforces the seat limit and reports usage daily.
 *
 * Skeleton: every install reads as "no license" and nothing is enforced. The
 * real provider (cached inputs, unlicensed grace from
 * GlobalConfig.enterpriseEditionFirstSeenAt, activation routes, seat checks,
 * the ReportUserCount job) replaces this.
 */
const createSkeletonSnapshot: () => EnterpriseLicenseSnapshot =
  (): EnterpriseLicenseSnapshot => {
    return EnterpriseLicenseSnapshotUtil.createMissing();
  };

export const licensing: EnterpriseLicensingProvider = {
  getSnapshot: async (): Promise<EnterpriseLicenseSnapshot> => {
    return createSkeletonSnapshot();
  },
  getCachedSnapshot: (): EnterpriseLicenseSnapshot | null => {
    return createSkeletonSnapshot();
  },
  refresh: async (): Promise<void> => {
    return undefined;
  },
  invalidate: (): void => {
    return undefined;
  },
  getSeatUsage: async (): Promise<SeatUsage | null> => {
    return null;
  },
  assertSeatAvailableForNewUser: async (): Promise<void> => {
    return undefined;
  },
};

const LicenseArea: EnterpriseArea = {
  name: "License",
  init: async (): Promise<void> => {
    return undefined;
  },
  getApiRouters: (): Array<ExpressRouter> => {
    return [];
  },
  registerWorkerJobs: async (): Promise<void> => {
    return undefined;
  },
};

export default LicenseArea;
