import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import Response from "Common/Server/Utils/Response";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import "ejs";
import JSONWebTokenData from "Common/Types/JsonWebTokenData";

export const APP_NAME: string = "admin";

const app: ExpressApplication = Express.getExpressApp();

type EnsureMasterAdminAccessFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<JSONObject>;

const ensureMasterAdminAccess: EnsureMasterAdminAccessFunction = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<JSONObject> => {
  try {
    const accessToken: string | undefined =
      UserMiddleware.getAccessTokenFromExpressRequest(req);

    if (!accessToken) {
      Response.sendErrorResponse(
        req,
        res,
        new NotAuthorizedException(
          "Unauthorized: Only master admins can access the admin dashboard.",
        ),
      );
      return {};
    }

    const authData: JSONWebTokenData = JSONWebToken.decode(accessToken);

    if (!authData.isMasterAdmin) {
      Response.sendErrorResponse(
        req,
        res,
        new NotAuthorizedException(
          "Unauthorized: Only master admins can access the admin dashboard.",
        ),
      );
      return {};
    }

    return {};
  } catch (error) {
    logger.error(error);
    Response.sendErrorResponse(
      req,
      res,
      new NotAuthorizedException(
        "Unauthorized: Only master admins can access the admin dashboard.",
      ),
    );
    return {};
  }
};

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
      getVariablesToRenderIndexPage: ensureMasterAdminAccess,
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
