import { ClusterKey as ONEUPTIME_SECRET } from "../EnvironmentConfig";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";

export default class ClusterKeyAuthorization {
  public static getClusterKeyHeaders(): Dictionary<string> {
    return {
      clusterkey: ClusterKeyAuthorization.getClusterKey(),
    };
  }

  public static getClusterKey(): string {
    return encodeURIComponent(ONEUPTIME_SECRET.toString());
  }

  public static async isAuthorizedServiceMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    let clusterKey: string;

    if (req.params && req.params["clusterKey"]) {
      clusterKey = req.params["clusterKey"];
    } else if (req.query && req.query["clusterKey"]) {
      clusterKey = req.query["clusterKey"] as string;
    } else if (req.headers && req.headers["clusterkey"]) {
      // Header keys are automatically transformed to lowercase
      clusterKey = req.headers["clusterkey"] as string;
    } else if (req.body && req.body.clusterKey) {
      clusterKey = req.body.clusterKey;
    } else {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Cluster key not found."),
      );
    }

    const isAuthorized: boolean =
      clusterKey.toString() === ClusterKeyAuthorization.getClusterKey();

    if (!isAuthorized) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid cluster key provided"),
      );
    }

    return next();
  }
}
