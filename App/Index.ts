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
import AppMetricsAPI from "./API/Metrics";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import InfrastructureStatus from "Common/Server/Infrastructure/Status";
import logger from "Common/Server/Utils/Logger";
import Realtime from "Common/Server/Utils/Realtime";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import Profiling from "Common/Server/Utils/Profiling";
import "ejs";
import OpenAPIUtil from "Common/Server/Utils/OpenAPI";

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

    // Connect to Clickhouse database
    await ClickhouseAppInstance.connect(
      ClickhouseAppInstance.getDatasourceOptions(),
    );

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

    // Initialize real-time functionalities
    await Realtime.init();

    // Expose app-level combined metrics endpoint for KEDA
    const expressApp: ExpressApplication = Express.getExpressApp();
    expressApp.use("/", AppMetricsAPI);

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

    // Add default routes to the app
    await App.addDefaultRoutes();

    // Generate OpenAPI spec (this automatically saves it to cache)
    OpenAPIUtil.generateOpenAPISpec();
  } catch (err) {
    logger.error("App Init Failed:");
    logger.error(err);
    throw err;
  }
};

// Call the initialization function and handle errors
init().catch((err: Error) => {
  logger.error(err);
  logger.error("Exiting node process");
  process.exit(1);
});
