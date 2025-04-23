import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import "ejs";
import API from "Common/Utils/API";
import ObjectID from "Common/Types/ObjectID";
import { StatusPageApiClientUrl } from "Common/Server/EnvironmentConfig";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";

export const APP_NAME: string = "status-page";

const app: ExpressApplication = Express.getExpressApp();

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
        _res: ExpressResponse
      ) => {
        try {

          logger.debug("Getting variables to render index page");
          // To get the status Page id.
          // first we need to see where the request is coming from.
          // if the request is coming from the url that contains the status page id it will contain /status-page/:id/xxx
          // then id is the status page id
          // if it does not include /status-page/:id/xxx then we need to check the domain where the request is coming from
          // and pass the domain to the API to get the status page id

          let statusPageIdOrDomain: string = "";

          // Check if the URL contains /status-page/:id/xxx
          const statusPageIdMatch = req.path.match(/\/status-page\/([^/]+)\//);
          if (statusPageIdMatch && statusPageIdMatch[1]) {
            statusPageIdOrDomain = statusPageIdMatch[1];
          } else {
            // If not, check the domain from the request headers
            const host = req.hostname || req.headers["host"];
            if (host) {
              statusPageIdOrDomain = host;
            }
          }

          // now ping the API. 
          const response: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.get(URL.fromString(StatusPageApiClientUrl.toString()).addRoute(`/seo/${statusPageIdOrDomain}`));

          if(response instanceof HTTPErrorResponse) {
            throw response; 
          }

        
          // Return the variables to render the index page
          return {
            title: response?.data?.['title'] || "Status Page",
            description:
              response?.data?.['description'] || "Status Page lets you see real-time information about the status of our services.",
            faviconUrl:
               `/status-page-api/${statusPageIdOrDomain}/favicon`
          };

        } catch (err) {
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
