import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import { PROBE_INGEST_URL } from "../Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import ProbeAPIRequest from "../Utils/ProbeAPIRequest";
import ProxyConfig from "../Utils/ProxyConfig";

const router: ExpressRouter = Express.getRouter();

/*
 * Metrics endpoint for Keda autoscaling
 * Returns the number of monitors pending to be probed by this probe
 */
router.get(
  "/queue-size",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      /*
       * Get the pending monitor count for this specific probe from ProbeIngest API
       * This is the correct metric - the number of monitors waiting to be probed
       */
      const pendingMonitorsUrl: URL = URL.fromString(
        PROBE_INGEST_URL.toString(),
      ).addRoute("/monitor/pending-count");

      logger.debug(
        "Fetching pending monitor count from ProbeIngest API for KEDA scaling",
      );

      // Use probe authentication (probe key and probe ID)
      const requestBody: JSONObject = ProbeAPIRequest.getDefaultRequestBody();

      const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.fetch<JSONObject>({
          method: HTTPMethod.POST,
          url: pendingMonitorsUrl,
          data: requestBody,
          headers: {},
          options: { ...ProxyConfig.getRequestProxyAgents(pendingMonitorsUrl) },
        });

      if (result instanceof HTTPErrorResponse) {
        logger.error(
          "Error fetching pending monitor count from ProbeIngest API",
        );
        logger.error(result);
        throw result;
      }

      logger.debug(
        "Pending monitor count fetched successfully from ProbeIngest API",
      );
      logger.debug(result.data);

      // Extract count from the response - this is the number of monitors pending to be probed
      let queueSize: number = (result.data["count"] as number) || 0;

      // if string then convert to number
      if (typeof queueSize === "string") {
        const parsedQueueSize: number = parseInt(queueSize, 10);
        if (!isNaN(parsedQueueSize)) {
          queueSize = parsedQueueSize;
        } else {
          logger.warn(
            "Pending monitor count is not a valid number, defaulting to 0",
          );
          queueSize = 0;
        }
      }

      logger.debug(`Pending monitor count for KEDA: ${queueSize}`);

      return Response.sendJsonObjectResponse(req, res, {
        queueSize: queueSize,
      });
    } catch (err) {
      logger.error("Error in metrics queue-size endpoint");
      logger.error(err);
      return next(err);
    }
  },
);

export default router;
