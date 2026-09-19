import APIReferenceRoutes from "./FeatureSet/APIReference/Index";
import BaseAPIRoutes from "./FeatureSet/BaseAPI/Index";
import DocsRoutes from "./FeatureSet/Docs/Index";
import FrontendRoutes from "./FeatureSet/Frontend/Index";
// import FeatureSets.
import IdentityRoutes from "./FeatureSet/Identity/Index";
import MCPRoutes from "./FeatureSet/MCP/Index";
import NotificationRoutes from "./FeatureSet/Notification/Index";
import WorkersRoutes from "./FeatureSet/Workers/Index";
import TelemetryRoutes from "./FeatureSet/Telemetry/Index";
import WorkflowRoutes from "./FeatureSet/Workflow/Index";
import RunbookRoutes from "./FeatureSet/Runbook/Index";
import AppMetricsAPI from "./API/Metrics";
import AdminHealthAPI from "./API/AdminHealth";
import EnterpriseLoader from "./Utils/EnterpriseLoader";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import CommunityEditionSsoReport from "Common/Server/Utils/CommunityEditionSsoReport";
import Express, {
  ExpressApplication,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import {
  ClickhouseAppInstance,
  ClickhouseIngestInstance,
  ClickhouseMigrationInstance,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Queue from "Common/Server/Infrastructure/Queue";
import Redis from "Common/Server/Infrastructure/Redis";
import InfrastructureStatus from "Common/Server/Infrastructure/Status";
import logger from "Common/Server/Utils/Logger";
import Realtime from "Common/Server/Utils/Realtime";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import Profiling from "Common/Server/Utils/Profiling";
import { RunDatabaseMigrationsOnBoot } from "Common/Server/EnvironmentConfig";
import "ejs";
import OpenAPIUtil from "Common/Server/Utils/OpenAPI";
/*
 * Registers the on-call shift-reminder change pass with
 * OnCallShiftChangeListeners. The on-call configuration hooks that publish
 * those events run in whichever process serves the CRUD request, so the
 * listener must be present in the api role too, not only in the worker.
 */
import "Common/Server/Utils/OnCall/OnCallShiftReminderListener";

const APP_NAME: string = "api";

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    // Initialize telemetry
    Telemetry.init({
      serviceName: APP_NAME,
    });

    // Initialize profiling (opt-in via ENABLE_PROFILING env var)
    Profiling.init({
      serviceName: APP_NAME,
    });

    const statusCheck: PromiseVoidFunction = async (): Promise<void> => {
      // Check the status of infrastructure components
      return await InfrastructureStatus.checkStatusWithRetry({
        checkClickhouseStatus: true,
        checkPostgresStatus: true,
        checkRedisStatus: true,
        retryCount: 3,
      });
    };

    const globalCacheCheck: PromiseVoidFunction = async (): Promise<void> => {
      // Check the status of cache
      return await InfrastructureStatus.checkStatusWithRetry({
        checkClickhouseStatus: false,
        checkPostgresStatus: false,
        checkRedisStatus: true,
        retryCount: 3,
      });
    };

    const analyticsDatabaseCheck: PromiseVoidFunction =
      async (): Promise<void> => {
        // Check the status of analytics database
        return await InfrastructureStatus.checkStatusWithRetry({
          checkClickhouseStatus: true,
          checkPostgresStatus: false,
          checkRedisStatus: false,
          retryCount: 3,
        });
      };

    const databaseCheck: PromiseVoidFunction = async (): Promise<void> => {
      // Check the status of database
      return await InfrastructureStatus.checkStatusWithRetry({
        checkClickhouseStatus: false,
        checkPostgresStatus: true,
        checkRedisStatus: false,
        retryCount: 3,
      });
    };

    // Connect to Postgres database
    await PostgresAppInstance.connect();

    // Connect to Redis
    await Redis.connect();

    /*
     * Reset stale completed/failed job counts left over from prior runs. Sweeps
     * every BullMQ queue once at startup so the admin Health page's Completed/
     * Failed counts don't linger across a pod (re)start, regardless of when each
     * queue next produces a job. Fire-and-forget: a large backlog shouldn't
     * delay readiness, and the sweep self-gates to run at most once per queue.
     */
    Queue.cleanAllQueuesOnStartup().catch((err: unknown) => {
      logger.error("Failed to clean queues on startup");
      logger.error(err);
    });

    // Connect to Clickhouse database
    await ClickhouseAppInstance.connect(
      ClickhouseAppInstance.getDatasourceOptions(),
    );
    await ClickhouseIngestInstance.connect(
      ClickhouseIngestInstance.getDatasourceOptions(),
    );
    /*
     * Migration pool (higher socket-idle timeout) — only connect it where it
     * is actually used: the boot schema sync + data migrations run here only
     * when RunDatabaseMigrationsOnBoot is set (same gate as Workers/Index.ts).
     * When migrations are handled by the dedicated migrate Job
     * (RUN_DATABASE_MIGRATIONS_ON_BOOT=false), runtime pods never touch this
     * pool, so connecting it would just waste an HTTP socket pool + a
     * CREATE DATABASE/ping on every boot.
     */
    if (RunDatabaseMigrationsOnBoot) {
      await ClickhouseMigrationInstance.connect(
        ClickhouseMigrationInstance.getDatasourceOptions(),
      );
    }

    // Initialize the app with service name and status checks
    await App.init({
      appName: APP_NAME,
      statusOptions: {
        liveCheck: statusCheck,
        readyCheck: statusCheck,
        globalCacheCheck: globalCacheCheck,
        analyticsDatabaseCheck: analyticsDatabaseCheck,
        databaseCheck: databaseCheck,
      },
    });

    /*
     * Load the OneUptime Enterprise Edition module from ee/ when it is present
     * (the Enterprise image); without it this process is the Community
     * Edition. It runs before any router below is mounted, because the
     * feature sets ask EnterpriseEdition which enterprise routers to mount and
     * permission checks read the license snapshot this loads. It also applies
     * the boot guards: billing without ee, and IS_ENTERPRISE_EDITION=true
     * without ee (unless ONEUPTIME_EDITION=community), stop the boot.
     * Tests/Utils/EnterpriseBootWiring.test.ts pins this order.
     */
    await EnterpriseLoader.load();

    /*
     * On the Community Edition, log once which SSO requirements and SCIM team
     * locks left over from an Enterprise install are no longer enforced (the
     * SSO login routes are part of ee/). Fire-and-forget; no-op on EE.
     */
    void CommunityEditionSsoReport.logRelaxedEnforcementOnce();

    // Initialize real-time functionalities
    await Realtime.init();

    // Expose app-level combined metrics endpoint for KEDA
    const expressApp: ExpressApplication = Express.getExpressApp();
    expressApp.use("/", AppMetricsAPI);

    /*
     * The enterprise admin-health routes (the live Health dashboards and the
     * query console) are mounted ahead of core's router, which answers the
     * same paths with 402 on the Community Edition and serves everything else.
     */
    const enterpriseAdminHealthRouter: ExpressRouter | null =
      EnterpriseEdition.getModule()?.getAdminHealthRouter() || null;

    if (enterpriseAdminHealthRouter) {
      expressApp.use("/api/admin/health", enterpriseAdminHealthRouter);
    }

    // Admin OneUptime Health overview (master-admin only).
    expressApp.use("/api/admin/health", AdminHealthAPI);

    // Initialize feature sets
    await IdentityRoutes.init();
    await NotificationRoutes.init();
    await BaseAPIRoutes.init();
    await MCPRoutes.init();
    await FrontendRoutes.init();
    await DocsRoutes.init();
    await APIReferenceRoutes.init();
    await WorkersRoutes.init();
    await TelemetryRoutes.init();
    await WorkflowRoutes.init();
    await RunbookRoutes.init();

    // Add default routes to the app
    await App.addDefaultRoutes();

    // Generate OpenAPI spec (this automatically saves it to cache)
    OpenAPIUtil.generateOpenAPISpec();
  } catch (err) {
    logger.error("App Init Failed:", { service: "api" });
    logger.error(err, { service: "api" });
    throw err;
  }
};

// Call the initialization function and handle errors
init().catch((err: Error) => {
  logger.error(err, { service: "api" });
  logger.error("Exiting node process", { service: "api" });
  process.exit(1);
});
