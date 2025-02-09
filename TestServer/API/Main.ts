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
    logger.debug("Request Headers: ");
    logger.debug(req.headers);
    logger.debug("Request Body: ");
    logger.debug(req.body);

    const responseCode: number | undefined =
      LocalCache.getNumber("TestServer", "responseCode") || 200;
    const responseTime: number | undefined =
      LocalCache.getNumber("TestServer", "responseTime") || 0;
    const responseBody: string | undefined =
      LocalCache.getString("TestServer", "responseBody") || "";
    let responseHeaders: JSONValue | undefined =
      LocalCache.getJSON("TestServer", "responseHeaders") || {};

    logger.debug("Response Code: " + responseCode);
    logger.debug("Response Time: " + responseTime);
    logger.debug("Response Body: ");
    logger.debug(responseBody);
    logger.debug("Response Headers: ");
    logger.debug(responseHeaders);

    if (responseHeaders && typeof responseHeaders === Typeof.String) {
      responseHeaders = JSON.parse(responseHeaders.toString());
    }

    if (responseTime > 0) {
      await Sleep.sleep(responseTime);
    }

    // middleware marks the probe as alive.
    // so we don't need to do anything here.
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
