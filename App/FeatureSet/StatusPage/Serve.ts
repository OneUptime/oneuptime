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
import { handleLlmsTxt } from "./src/Server/API/LlmsTxt";
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

// add llms.txt route (machine-readable entry point for AI agents)
app.get("/llms.txt", handleLlmsTxt);
app.get("/status-page/:statusPageId/llms.txt", handleLlmsTxt);

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

        /*
         * RSS feed path for the autodiscovery <link> tag. Status pages are
         * hosted either on a custom domain (feed at /rss) or on a subpath
         * at /status-page/:statusPageId (feed at /status-page/:statusPageId/rss).
         */
        const isPreviewPage: boolean = req.path.includes("/status-page/");
        const previewStatusPageId: string = isPreviewPage
          ? req.path.split("/status-page/")[1]?.split("/")[0] || ""
          : "";
        const rssFeedPath: string =
          isPreviewPage && previewStatusPageId
            ? `/status-page/${previewStatusPageId}/rss`
            : "/rss";

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
            rssFeedPath: rssFeedPath,
          };
        }
        return {
          title: "Status Page",
          description:
            "Status Page lets you see real-time information about the status of our services.",
          faviconUrl:
            "/status-page-api/favicon/" + ObjectID.getZeroObjectID().toString(),
          lang: DEFAULT_STATUS_PAGE_LANGUAGE,
          rssFeedPath: rssFeedPath,
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
