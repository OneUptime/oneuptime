import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import { JSONObject } from "../../Types/JSON";
import OpenAPIUtil, { OpenAPISpecResponse } from "../Utils/OpenAPI";
import zlib from "zlib";

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
      // Built at boot and kept gzipped (OpenAPIUtil.getOpenAPISpecResponse).
      const spec: OpenAPISpecResponse = OpenAPIUtil.getOpenAPISpecResponse();

      // ?output-type=csv, which every JSON response takes: the document as CSV.
      if (req.query["output-type"] === "csv") {
        return Response.sendJsonObjectResponse(
          req,
          res,
          JSON.parse(zlib.gunzipSync(spec.gzip).toString("utf8")) as JSONObject,
        );
      }

      return Response.sendGzippedJsonResponse(req, res, spec);
    });

    return router;
  }
}
