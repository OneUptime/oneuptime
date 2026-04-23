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
import {
  getStatusPageData,
  StatusPageData,
} from "./src/Server/Utils/StatusPage";
import {
  DEFAULT_STATUS_PAGE_LANGUAGE,
  SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
} from "Common/Types/StatusPage/StatusPageLanguage";

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
        const statusPageData: StatusPageData | null =
          await getStatusPageData(req);

        if (statusPageData) {
          const resolvedLang: string =
            statusPageData.defaultLanguage &&
            SUPPORTED_STATUS_PAGE_LANGUAGE_CODES.includes(
              statusPageData.defaultLanguage,
            )
              ? statusPageData.defaultLanguage
              : DEFAULT_STATUS_PAGE_LANGUAGE;

          return {
            title: statusPageData.title,
            description: statusPageData.description,
            faviconUrl: statusPageData.faviconUrl,
            lang: resolvedLang,
          };
        }
        return {
          title: "Status Page",
          description:
            "Status Page lets you see real-time information about the status of our services.",
          faviconUrl:
            "/status-page-api/favicon/" + ObjectID.getZeroObjectID().toString(),
          lang: DEFAULT_STATUS_PAGE_LANGUAGE,
        };
      },
    });

    // add default routes
    await App.addDefaultRoutes();
  } catch (err) {
    logger.error("App Init Failed:", { service: "status-page" });
    logger.error(err, { service: "status-page" });
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err, { service: "status-page" });
  logger.error("Exiting node process", { service: "status-page" });
  process.exit(1);
});

export default app;
