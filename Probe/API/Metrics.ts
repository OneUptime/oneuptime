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

const router: ExpressRouter = Express.getRouter();

// Metrics endpoint for Keda autoscaling
router.get(
  "/queue-size",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // Get the pending monitor count for this specific probe from ProbeIngest API
      const queueSizeUrl: URL = URL.fromString(
        PROBE_INGEST_URL.toString(),
      ).addRoute("/metrics/queue-size");

      logger.debug("Fetching queue size from ProbeIngest API");

      // Use probe authentication (probe key and probe ID)
      const requestBody: JSONObject = ProbeAPIRequest.getDefaultRequestBody();

      const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.fetch<JSONObject>(
          HTTPMethod.POST,
          queueSizeUrl,
          requestBody,
          {},
        );

      if (result instanceof HTTPErrorResponse) {
        logger.error("Error fetching queue size from ProbeIngest API");
        logger.error(result);
        throw result;
      }

      logger.debug("Queue size fetched successfully from ProbeIngest API");
      logger.debug(result.data);

      // Extract queueSize from the response
      let queueSize: number = (result.data["queueSize"] as number) || 0;

      // if string then convert to number

      if (typeof queueSize === "string") {
        const parsedQueueSize: number = parseInt(queueSize, 10);
        if (!isNaN(parsedQueueSize)) {
          queueSize = parsedQueueSize;
        } else {
          logger.warn("Queue size is not a valid number, defaulting to 0");
          queueSize = 0;
        }
      }

      logger.debug(`Queue size fetched: ${queueSize}`);

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
