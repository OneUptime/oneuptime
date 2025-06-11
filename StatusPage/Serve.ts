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
        _res: ExpressResponse,
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
          logger.debug("Checking if the URL contains /status-page/:id/xxx");

          const path: string = req.path;

          logger.debug(`Request path: ${path}`);

          if (path && path.includes("/status-page/")) {
            statusPageIdOrDomain =
              path.split("/status-page/")[1]?.split("/")[0] || "";
            logger.debug(
              `Found status page ID in URL: ${statusPageIdOrDomain}`,
            );
          } else {
            // If not, check the domain from the request headers
            logger.debug(
              "Status page ID not found in URL, checking request headers for domain",
            );
            const host: string =
              req.hostname?.toString() || req.headers["host"]?.toString() || "";
            if (host) {
              statusPageIdOrDomain = host;
              logger.debug(
                `Found domain in request headers: ${statusPageIdOrDomain}`,
              );
            }
          }

          // now ping the API.
          logger.debug(
            `Pinging the API with statusPageIdOrDomain: ${statusPageIdOrDomain}`,
          );
          const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
            await API.get(
              URL.fromString(StatusPageApiClientUrl.toString()).addRoute(
                `/seo/${statusPageIdOrDomain}`,
              ),
            );

          if (response instanceof HTTPErrorResponse) {
            logger.debug(`Received error response from API: ${response}`);
            throw response;
          }

          logger.debug("Successfully received response from API");

          // Return the variables to render the index page
          return {
            title: response?.data?.["title"] || "Status Page",
            description:
              response?.data?.["description"] ||
              "Status Page lets you see real-time information about the status of our services.",
            faviconUrl: `/status-page-api/favicon/${statusPageIdOrDomain}`,
          };
        } catch {
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
