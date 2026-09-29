import EnterpriseServerModule, {
  AuditLogRecorder,
  ENTERPRISE_SERVER_MODULE_NAME,
} from "Common/Server/Enterprise/EnterpriseServerModule";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "./Types/EnterpriseArea";
import AdminHealthArea, { getAdminHealthRouter } from "./AdminHealth/Index";
import AuditLogArea, { getAuditLogRecorder } from "./AuditLog/Index";
import IdentityArea from "./Identity/Index";
import LicenseArea, { licensing } from "./License/Index";
import LicenseServerArea from "./LicenseServer/Index";
import TeamComplianceArea from "./TeamCompliance/Index";
import WorkersArea from "./Workers/Index";
import packageJson from "../package.json";

/*
 * The OneUptime Enterprise Edition server module. packages/App/Utils/
 * EnterpriseLoader.ts require()s this file at boot, checks the default export
 * against EnterpriseServerModule and registers it with EnterpriseEdition.
 *
 * It is assembled from one module per area so each area is owned and edited
 * on its own; this file only decides the order they run in.
 */

/*
 * License first: its init loads the license snapshot the other areas' checks
 * read. This order is also the router mount order.
 */
export const ENTERPRISE_AREAS: ReadonlyArray<EnterpriseArea> = [
  LicenseArea,
  IdentityArea,
  TeamComplianceArea,
  AuditLogArea,
  LicenseServerArea,
  AdminHealthArea,
  WorkersArea,
];

type RouterHook = (area: EnterpriseArea) => Array<ExpressRouter> | undefined;

type AsyncHook = (area: EnterpriseArea) => Promise<void> | undefined;

const collectRouters: (hook: RouterHook) => Array<ExpressRouter> = (
  hook: RouterHook,
): Array<ExpressRouter> => {
  const routers: Array<ExpressRouter> = [];

  for (const area of ENTERPRISE_AREAS) {
    routers.push(...(hook(area) || []));
  }

  return routers;
};

/*
 * Runs one async hook of every area, in order. One area failing does not stop
 * the others; the failures are reported together afterwards, and the loader
 * logs them without stopping the boot.
 */
const runForEveryArea: (
  hookName: string,
  hook: AsyncHook,
) => Promise<void> = async (
  hookName: string,
  hook: AsyncHook,
): Promise<void> => {
  const failures: Array<string> = [];

  for (const area of ENTERPRISE_AREAS) {
    try {
      await hook(area);
    } catch (err) {
      failures.push(
        `${area.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Enterprise ${hookName} failed in ${failures.length} area(s): ${failures.join("; ")}`,
    );
  }
};

const EnterpriseModule: EnterpriseServerModule = {
  name: ENTERPRISE_SERVER_MODULE_NAME,
  version: packageJson.version,
  init: async (): Promise<void> => {
    await runForEveryArea("init", (area: EnterpriseArea) => {
      return area.init?.();
    });
  },
  licensing,
  getIdentityRouters: (): Array<ExpressRouter> => {
    return collectRouters((area: EnterpriseArea) => {
      return area.getIdentityRouters?.();
    });
  },
  getApiRouters: (): Array<ExpressRouter> => {
    return collectRouters((area: EnterpriseArea) => {
      return area.getApiRouters?.();
    });
  },
  getAdminHealthRouter: (): ExpressRouter | null => {
    return getAdminHealthRouter();
  },
  registerWorkerJobs: async (): Promise<void> => {
    await runForEveryArea("worker job registration", (area: EnterpriseArea) => {
      return area.registerWorkerJobs?.();
    });
  },
  getAuditLogRecorder: (): AuditLogRecorder | null => {
    return getAuditLogRecorder();
  },
};

export default EnterpriseModule;
