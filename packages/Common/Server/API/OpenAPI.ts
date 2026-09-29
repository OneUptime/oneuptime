import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import { JSONObject } from "../../Types/JSON";
import OpenAPIUtil from "../Utils/OpenAPI";

export interface StatusAPIOptions {
  readyCheck: () => Promise<void>;
  liveCheck: () => Promise<void>;
  globalCacheCheck?: (() => Promise<void>) | undefined;
  analyticsDatabaseCheck?: (() => Promise<void>) | undefined;
  databaseCheck?: (() => Promise<void>) | undefined;
}

export default class OpenAPI {
  public static getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.get("/openapi/spec", (req: ExpressRequest, res: ExpressResponse) => {
      const openAPISpec: JSONObject = OpenAPIUtil.generateOpenAPISpec();
      return Response.sendJsonObjectResponse(req, res, openAPISpec);
    });

    return router;
  }
}
