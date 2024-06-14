import AcmeWriteCertificatesJob from "./Jobs/AcmeWriteCertificates";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { PostgresAppInstance } from "CommonServer/Infrastructure/PostgresDatabase";
import InfrastructureStatus from "CommonServer/Infrastructure/Status";
import logger from "CommonServer/Utils/Logger";
import App from "CommonServer/Utils/StartServer";

process.env["SERVICE_NAME"] = "ingress";

const APP_NAME: string = process.env["SERVICE_NAME"];

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    const statusCheck: PromiseVoidFunction = async (): Promise<void> => {
      return await InfrastructureStatus.checkStatus({
        checkClickhouseStatus: false,
        checkPostgresStatus: true,
        checkRedisStatus: false,
      });
    };

    // init the app
    await App.init({
      appName: APP_NAME,
      port: undefined,
      isFrontendApp: false,
      statusOptions: {
        liveCheck: statusCheck,
        readyCheck: statusCheck,
      },
    });

    // connect to the database.
    await PostgresAppInstance.connect(
      PostgresAppInstance.getDatasourceOptions(),
    );

    AcmeWriteCertificatesJob.init();

    // add default routes
    await App.addDefaultRoutes();
  } catch (err) {
    logger.error("App Init Failed:");
    logger.error(err);
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err);
  logger.error("Exiting node process");
  process.exit(1);
});
