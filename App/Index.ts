import BaseAPIRoutes from "./FeatureSet/BaseAPI/Index";
// import FeatureSets.
import IdentityRoutes from "./FeatureSet/Identity/Index";
import NotificationRoutes from "./FeatureSet/Notification/Index";
import AIAgentIngestRoutes from "./FeatureSet/AIAgentIngest/Index";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import InfrastructureStatus from "Common/Server/Infrastructure/Status";
import logger from "Common/Server/Utils/Logger";
import Realtime from "Common/Server/Utils/Realtime";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import "ejs";
import OpenAPIUtil from "Common/Server/Utils/OpenAPI";

const APP_NAME: string = "api";

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    // Initialize telemetry
    Telemetry.init({
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

    // Connect to Postgres database
    await PostgresAppInstance.connect();

    // Connect to Redis
    await Redis.connect();

    // Connect to Clickhouse database
    await ClickhouseAppInstance.connect(
      ClickhouseAppInstance.getDatasourceOptions(),
    );

    // Initialize real-time functionalities
    await Realtime.init();

    // Initialize feature sets
    await IdentityRoutes.init();
    await NotificationRoutes.init();
    await BaseAPIRoutes.init();
    await AIAgentIngestRoutes.init();

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
