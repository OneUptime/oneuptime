import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import { ONEUPTIME_URL } from "../Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import AIAgentAPIRequest from "../Utils/AIAgentAPIRequest";

const router: ExpressRouter = Express.getRouter();

/*
 * Metrics endpoint for Keda autoscaling
 * Returns the number of pending AI agent tasks
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
       * Get the pending task count from OneUptime API
       * This is the correct metric - the number of tasks waiting to be processed
       */
      const pendingTaskCountUrl: URL = URL.fromString(
        ONEUPTIME_URL.toString(),
      ).addRoute("/api/ai-agent-task/get-pending-task-count");

      logger.debug(
        "Fetching pending task count from OneUptime API for KEDA scaling",
      );

      // Use AI Agent authentication (AI Agent key and AI Agent ID)
      const requestBody: JSONObject = AIAgentAPIRequest.getDefaultRequestBody();

      const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.fetch<JSONObject>({
          method: HTTPMethod.POST,
          url: pendingTaskCountUrl,
          data: requestBody,
          headers: {},
        });

      if (result instanceof HTTPErrorResponse) {
        logger.error(
          "Error fetching pending task count from OneUptime API",
        );
        logger.error(result);
        throw result;
      }

      logger.debug(
        "Pending task count fetched successfully from OneUptime API",
      );
      logger.debug(result.data);

      // Extract count from the response - this is the number of tasks pending to be processed
      let queueSize: number = (result.data["count"] as number) || 0;

      // if string then convert to number
      if (typeof queueSize === "string") {
        const parsedQueueSize: number = parseInt(queueSize, 10);
        if (!isNaN(parsedQueueSize)) {
          queueSize = parsedQueueSize;
        } else {
          logger.warn(
            "Pending task count is not a valid number, defaulting to 0",
          );
          queueSize = 0;
        }
      }

      logger.debug(`Pending task count for KEDA: ${queueSize}`);

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
