import { JSONValue } from "Common/Types/JSON";
import Sleep from "Common/Types/Sleep";
import Typeof from "Common/Types/Typeof";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";

const router: ExpressRouter = Express.getRouter();

router.get(
  "/",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    returnResponse(req, res, next);
  },
);

router.post(
  "/",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    returnResponse(req, res, next);
  },
);

const returnResponse: RequestHandler = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> => {
  try {
    logger.debug("Request Headers: ", { service: "test-server" });
    logger.debug(req.headers, { service: "test-server" });
    logger.debug("Request Body: ", { service: "test-server" });
    logger.debug(req.body, { service: "test-server" });

    const responseCode: number | undefined =
      LocalCache.getNumber("TestServer", "responseCode") || 200;
    const responseTime: number | undefined =
      LocalCache.getNumber("TestServer", "responseTime") || 0;
    const responseBody: string | undefined =
      LocalCache.getString("TestServer", "responseBody") || "";
    let responseHeaders: JSONValue | undefined =
      LocalCache.getJSON("TestServer", "responseHeaders") || {};

    logger.debug("Response Code: " + responseCode, { service: "test-server" });
    logger.debug("Response Time: " + responseTime, { service: "test-server" });
    logger.debug("Response Body: ", { service: "test-server" });
    logger.debug(responseBody, { service: "test-server" });
    logger.debug("Response Headers: ", { service: "test-server" });
    logger.debug(responseHeaders, { service: "test-server" });

    if (responseHeaders && typeof responseHeaders === Typeof.String) {
      responseHeaders = JSON.parse(responseHeaders.toString());
    }

    if (responseTime > 0) {
      await Sleep.sleep(responseTime);
    }

    /*
     * middleware marks the probe as alive.
     * so we don't need to do anything here.
     */
    return Response.sendCustomResponse(
      req,
      res,
      responseCode,
      responseBody,
      responseHeaders ? (responseHeaders as any) : {},
    );
  } catch (err) {
    return next(err);
  }
};

export default router;
