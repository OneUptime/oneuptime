import Express, { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "../Types/EnterpriseArea";
import { registerHealthDashboardRoutes } from "./HealthDashboards";
import { registerQueryConsoleRoutes } from "./QueryConsole";

/*
 * The enterprise admin-health routes: the live OneUptime Health dashboards
 * (GET /overview, /queues, /queues/:queueName/failed-jobs, /redis, /logs,
 * /clickhouse-cluster, /clickhouse-telemetry-ingestion,
 * /clickhouse-telemetry-ingestion-by-project, /postgres-cluster and
 * /postgres-activity) and the query console (POST /query/postgres,
 * /query/clickhouse, /query/redis). App/Index.ts mounts this router at
 * "/api/admin/health" ahead of core's AdminHealth router, which keeps the
 * routes every edition has (ClickHouse capacity, the instance log, migration
 * status, the support bundle) and answers these paths with 402 when this
 * module is not loaded.
 *
 * ONE router with every route registered directly on it - not a parent
 * router that use()s the two - because an enterprise router may hold routes
 * only (Tests/Server/ModuleShape.test.ts).
 */
export const createAdminHealthRouter: () => ExpressRouter =
  (): ExpressRouter => {
    const router: ExpressRouter = Express.getRouter();

    registerHealthDashboardRoutes(router);
    registerQueryConsoleRoutes(router);

    return router;
  };

// Built once and reused, so every caller mounts the same router.
let adminHealthRouter: ExpressRouter | null = null;

export const getAdminHealthRouter: () => ExpressRouter | null =
  (): ExpressRouter | null => {
    if (!adminHealthRouter) {
      adminHealthRouter = createAdminHealthRouter();
    }

    return adminHealthRouter;
  };

const AdminHealthArea: EnterpriseArea = {
  name: "AdminHealth",
};

export default AdminHealthArea;
