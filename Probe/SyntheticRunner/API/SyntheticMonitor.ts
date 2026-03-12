import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import logger from "Common/Server/Utils/Logger";
import { JSONArray } from "Common/Types/JSON";
import SyntheticMonitorProcessRunner from "../Execution/SyntheticMonitorProcessRunner";
import { SyntheticMonitorExecutionRequest } from "../Types/SyntheticMonitorExecution";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/run",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const request: SyntheticMonitorExecutionRequest =
        req.body as SyntheticMonitorExecutionRequest;

      if (!request || typeof request.script !== "string") {
        throw new BadDataException("Synthetic monitor script is required");
      }

      const response = await SyntheticMonitorProcessRunner.execute(request);

      return Response.sendJsonObjectResponse(req, res, {
        results: response.results as unknown as JSONArray,
      });
    } catch (error: unknown) {
      logger.error(error);
      return next(error);
    }
  },
);

export default router;
