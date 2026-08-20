import APIReferenceRoutes from "./FeatureSet/APIReference/Index";
import BaseAPIRoutes from "./FeatureSet/BaseAPI/Index";
import DocsRoutes from "./FeatureSet/Docs/Index";
import FrontendRoutes from "./FeatureSet/Frontend/Index";
import IdentityRoutes from "./FeatureSet/Identity/Index";
import MCPRoutes from "./FeatureSet/MCP/Index";
import NotificationRoutes from "./FeatureSet/Notification/Index";
import WorkersRoutes from "./FeatureSet/Workers/Index";
import TelemetryRoutes from "./FeatureSet/Telemetry/Index";
import WorkflowRoutes from "./FeatureSet/Workflow/Index";
import RunbookRoutes from "./FeatureSet/Runbook/Index";
import AppMetricsAPI from "./API/Metrics";
import AdminHealthAPI from "./API/AdminHealth";
import CalWebhookAPI from "./API/CalWebhook";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
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

const APP_NAME: string = "api";

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    Telemetry.init({ serviceName: APP_NAME });
    Profiling.init({ serviceName: APP_NAME });

    const statusCheck: PromiseVoidFunction = async (): Promise<void> => {
      return await InfrastructureStatus.checkStatusWithRetry({
        checkClickhouseStatus: true,
        checkPostgresStatus: true,
        checkRedisStatus: true,
        retryCount: 3,
      });
    };
    const globalCacheCheck: PromiseVoidFunction = async (): Promise<void> => {
      return await InfrastructureStatus.checkStatusWithRetry({
        checkClickhouseStatus: false,
        checkPostgresStatus: false,
        checkRedisStatus: true,
        retryCount: 3,
      });
    };
    const analyticsDatabaseCheck: PromiseVoidFunction =
      async (): Promise<void> => {
        return await InfrastructureStatus.checkStatusWithRetry({
          checkClickhouseStatus: true,
          checkPostgresStatus: false,
          checkRedisStatus: false,
          retryCount: 3,
        });
      };
    const databaseCheck: PromiseVoidFunction = async (): Promise<void> => {
      return await InfrastructureStatus.checkStatusWithRetry({
        checkClickhouseStatus: false,
        checkPostgresStatus: true,
        checkRedisStatus: false,
        retryCount: 3,
      });
    };

    await PostgresAppInstance.connect();
    await Redis.connect();
    Queue.cleanAllQueuesOnStartup().catch((err: unknown) => {
      logger.error("Failed to clean queues on startup");
      logger.error(err);
    });

    await ClickhouseAppInstance.connect(
      ClickhouseAppInstance.getDatasourceOptions(),
    );
    await ClickhouseIngestInstance.connect(
      ClickhouseIngestInstance.getDatasourceOptions(),
    );
    if (RunDatabaseMigrationsOnBoot) {
      await ClickhouseMigrationInstance.connect(
        ClickhouseMigrationInstance.getDatasourceOptions(),
      );
    }

    await App.init({
      appName: APP_NAME,
      statusOptions: {
        liveCheck: statusCheck,
        readyCheck: statusCheck,
        globalCacheCheck,
        analyticsDatabaseCheck,
        databaseCheck,
      },
    });

    await Realtime.init();
    const expressApp: ExpressApplication = Express.getExpressApp();
    expressApp.use("/", AppMetricsAPI);
    expressApp.use("/api/admin/health", AdminHealthAPI);
    // Cal posts to /api/cal-webhook. It is verified before any ledger write.
    expressApp.use("/api", CalWebhookAPI);

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

    await App.addDefaultRoutes();
    OpenAPIUtil.generateOpenAPISpec();
  } catch (err) {
    logger.error("App Init Failed:", { service: "api" });
    logger.error(err, { service: "api" });
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err, { service: "api" });
  logger.error("Exiting node process", { service: "api" });
  process.exit(1);
});
