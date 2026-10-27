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
  getStatusPageLanguageHead,
  StatusPageLanguageHead,
} from "Common/Types/StatusPage/StatusPageLanguage";
import applyStatusPageContentSecurityPolicy from "Common/Server/Utils/StatusPageContentSecurityPolicy";
import applyStatusPageRobotsHeader from "Common/Server/Utils/StatusPageSearchEngineIndexing";
import applyPublicPageNotFound, {
  PUBLIC_PAGE_NOT_FOUND,
  PublicPageNotFound,
} from "Common/Server/Utils/PublicPageNotFound";
import {
  isSearchEngineIndexingAllowed,
  isStatusPagePreviewPath,
} from "Common/Types/StatusPage/SearchEngineIndexing";
import {
  getStatusPageThemeHead,
  STATUS_PAGE_THEME_FALLBACK,
} from "Common/Types/StatusPage/StatusPageTheme";

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
        res: ExpressResponse,
      ) => {
        applyStatusPageContentSecurityPolicy(req, res);

        const statusPageData: StatusPageData | PublicPageNotFound | null =
          await getStatusPageData(req);

        /*
         * RSS feed path for the autodiscovery <link> tag. Status pages are
         * hosted either on a custom domain (feed at /rss) or on a subpath
         * at /status-page/:statusPageId (feed at /status-page/:statusPageId/rss).
         */
        const isPreviewPage: boolean = isStatusPagePreviewPath(req.path);
        const previewStatusPageId: string = isPreviewPage
          ? req.path.split("/status-page/")[1]?.split("/")[0] || ""
          : "";
        const rssFeedPath: string =
          isPreviewPage && previewStatusPageId
            ? `/status-page/${previewStatusPageId}/rss`
            : "/rss";

        if (statusPageData === PUBLIC_PAGE_NOT_FOUND) {
          /*
           * There is no such page: none was made, it is archived, or a
           * master admin blocked its project. The app still loads and says
           * so, from the placeholder below, which carries nothing of the
           * page - but as a 404 kept out of search results, so search
           * engines drop the URL rather than keep what it served before
           * (PublicPageNotFound).
           */
          applyPublicPageNotFound(res);
        } else if (statusPageData) {
          // The page's default language, and the way it is read.
          const languageHead: StatusPageLanguageHead =
            getStatusPageLanguageHead(statusPageData.defaultLanguage);

          /*
           * Belt and braces with the <meta name="robots"> the template
           * renders from isSearchEngineIndexingEnabled below: the header is
           * honoured even if a crawler gives up on the HTML.
           */
          applyStatusPageRobotsHeader(
            res,
            statusPageData.isSearchEngineIndexingEnabled,
          );

          return {
            title: statusPageData.title,
            description: statusPageData.description,
            faviconUrl: statusPageData.faviconUrl,
            lang: languageHead.lang,
            dir: languageHead.dir,
            rssFeedPath: rssFeedPath,
            isSearchEngineIndexingEnabled:
              statusPageData.isSearchEngineIndexingEnabled,
            // The page's theme, applied before its first paint.
            statusPageTheme: getStatusPageThemeHead(statusPageData.theme),
          };
        }

        /*
         * No page data: the page does not exist, the lookup failed, or the
         * URL named no page. A page that does not exist is never indexed,
         * and a preview URL is kept out of search results all the same;
         * otherwise a custom domain fails open, as it does whenever the
         * owner's setting cannot be read.
         */
        const isSearchEngineIndexingEnabled: boolean =
          statusPageData !== PUBLIC_PAGE_NOT_FOUND &&
          isSearchEngineIndexingAllowed({
            path: req.path,
            indexingFlag: undefined,
          });

        applyStatusPageRobotsHeader(res, isSearchEngineIndexingEnabled);

        return {
          title: "Status Page",
          description:
            "Status Page lets you see real-time information about the status of our services.",
          faviconUrl:
            "/status-page-api/favicon/" + ObjectID.getZeroObjectID().toString(),
          lang: getStatusPageLanguageHead(null).lang,
          dir: getStatusPageLanguageHead(null).dir,
          rssFeedPath: rssFeedPath,
          isSearchEngineIndexingEnabled: isSearchEngineIndexingEnabled,
          /*
           * No page to read a theme from: the light page every status page
           * starts from. The app reads the page's own theme once it loads.
           */
          statusPageTheme: getStatusPageThemeHead(STATUS_PAGE_THEME_FALLBACK),
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
