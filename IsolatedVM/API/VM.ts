import BadDataException from "Common/Types/Exception/BadDataException";
import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";
import JSONFunctions from "Common/Types/JSONFunctions";
import ClusterKeyAuthorization from "CommonServer/Middleware/ClusterKeyAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "CommonServer/Utils/Express";
import logger from "CommonServer/Utils/Logger";
import Response from "CommonServer/Utils/Response";
import VMRunner from "CommonServer/Utils/VM/VMRunner";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/run-code",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.body.code) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Code is missing"),
        );
      }

      logger.debug("Running code in sandbox");
      logger.debug(req.body.code);

      let result: ReturnResult | null = null;

      try {
        result = await VMRunner.runCodeInSandbox({
          code: req.body.code,
          options: {
            timeout: req.body?.["options"]?.["timeout"] || 5000,
            args: req.body?.["options"]?.["args"] || {},
          },
        });
      } catch (err) {
        logger.error(err);
        throw new BadDataException((err as Error).message);
      }

      logger.debug("Code execution completed");
      logger.debug(result.returnValue);

      logger.debug("Code Logs ");
      logger.debug(result.logMessages);

      if (typeof result.returnValue === "object") {
        result.returnValue = JSONFunctions.removeCircularReferences(
          result.returnValue,
        );
      }

      return Response.sendJsonObjectResponse(req, res, {
        returnValue: result.returnValue,
        logMessages: result.logMessages,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
