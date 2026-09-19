import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "../Types/EnterpriseArea";
import { createQueryConsoleRouter } from "./QueryConsole";

/*
 * The enterprise admin-health routes: the OneUptime Health query console
 * (POST /query/postgres, /query/clickhouse, /query/redis). App/Index.ts mounts
 * this router at "/api/admin/health" ahead of core's AdminHealth router, which
 * keeps every read-only health route (gated by the license through
 * EnterpriseEdition) and answers these three paths with 402 when this module
 * is not loaded.
 *
 * Built once and reused, so every caller mounts the same router.
 */
let adminHealthRouter: ExpressRouter | null = null;

export const getAdminHealthRouter: () => ExpressRouter | null =
  (): ExpressRouter | null => {
    if (!adminHealthRouter) {
      adminHealthRouter = createQueryConsoleRouter();
    }

    return adminHealthRouter;
  };

const AdminHealthArea: EnterpriseArea = {
  name: "AdminHealth",
};

export default AdminHealthArea;
