import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import "ejs";
import ObjectID from "Common/Types/ObjectID";
import { handleRSS } from "./src/Server/API/RSS";
import { getStatusPageData } from "./src/Server/Utils/StatusPage";

export const APP_NAME: string = "status-page";

const app: ExpressApplication = Express.getExpressApp();

// add RSS route
app.get("/rss", handleRSS);
app.get("/status-page/:statusPageId/rss", handleRSS);

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
      getVariablesToRenderIndexPage: async (
        req: ExpressRequest,
        _res: ExpressResponse,
      ) => {
        const statusPageData = await getStatusPageData(req);

        if (statusPageData) {
          return {
            title: statusPageData.title,
            description: statusPageData.description,
            faviconUrl: statusPageData.faviconUrl,
          };
        } else {
          return {
            title: "Status Page",
            description:
              "Status Page lets you see real-time information about the status of our services.",
            faviconUrl:
              "/status-page-api/favicon/" +
              ObjectID.getZeroObjectID().toString(),
          };
        }
      },
    });

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

export default app;
