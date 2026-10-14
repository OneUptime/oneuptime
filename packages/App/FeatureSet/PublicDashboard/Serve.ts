import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import "ejs";
import { handleLlmsTxt } from "./src/Server/API/LlmsTxt";
import {
  getPublicDashboardData,
  PublicDashboardData,
} from "./src/Server/Utils/PublicDashboard";
import applyPublicPageNotFound, {
  PUBLIC_PAGE_NOT_FOUND,
  PublicPageNotFound,
} from "Common/Server/Utils/PublicPageNotFound";

export const APP_NAME: string = "public-dashboard";

const app: ExpressApplication = Express.getExpressApp();

// add llms.txt route (machine-readable entry point for AI agents)
app.get("/llms.txt", handleLlmsTxt);
app.get("/public-dashboard/:dashboardId/llms.txt", handleLlmsTxt);

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
        const dashboardData: PublicDashboardData | PublicPageNotFound | null =
          await getPublicDashboardData(req);

        if (dashboardData === PUBLIC_PAGE_NOT_FOUND) {
          /*
           * No dashboard answers on this link: none was made, it is archived
           * or shared only with its project, or a master admin blocked its
           * project. The app still loads and says so, from the placeholder
           * below, as a 404 kept out of search results (PublicPageNotFound).
           */
          applyPublicPageNotFound(res);

          return {
            title: "Dashboard",
            description: "View dashboard metrics and insights.",
            isSearchEngineIndexingEnabled: false,
          };
        }

        if (dashboardData) {
          return {
            title: dashboardData.title,
            description: dashboardData.description,
          };
        }
        return {
          title: "Dashboard",
          description: "View dashboard metrics and insights.",
        };
      },
    });

    // add default routes
    await App.addDefaultRoutes();
  } catch (err) {
    logger.error("App Init Failed:", { service: "public-dashboard" });
    logger.error(err, { service: "public-dashboard" });
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err, { service: "public-dashboard" });
  logger.error("Exiting node process", { service: "public-dashboard" });
  process.exit(1);
});

export default app;
