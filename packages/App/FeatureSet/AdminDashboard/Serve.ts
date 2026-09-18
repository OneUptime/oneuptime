import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import { ensureMasterAdminPageAccess } from "Common/Server/Utils/MasterAdminPageAccess";
import { JSONObject } from "Common/Types/JSON";
import "ejs";

export const APP_NAME: string = "admin";

const app: ExpressApplication = Express.getExpressApp();

type EnsureMasterAdminAccessFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<JSONObject>;

const ensureMasterAdminAccess: EnsureMasterAdminAccessFunction = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<JSONObject> => {
  return await ensureMasterAdminPageAccess({ req, res, service: "admin" });
};

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    // init the app
    await App.init({
      appName: APP_NAME,
      port: undefined,
      isFrontendApp: true,
      statusOptions: {
        liveCheck: async () => {},
        readyCheck: async () => {},
      },
      getVariablesToRenderIndexPage: ensureMasterAdminAccess,
    });

    // add default routes
    await App.addDefaultRoutes();
  } catch (err) {
    logger.error("App Init Failed:", { service: "admin" });
    logger.error(err, { service: "admin" });
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err, { service: "admin" });
  logger.error("Exiting node process", { service: "admin" });
  process.exit(1);
});

export default app;
