import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import JSONFunctions from "Common/Types/JSONFunctions";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import MetricService from "../Services/MetricService";
import { JSONArray } from "Common/Types/JSON";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/telemetry/metrics/get-attributes",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryTableName.Metric);
  },
);

router.post(
  "/telemetry/logs/get-attributes",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryTableName.Log);
  },
);

router.post(
  "/telemetry/traces/get-attributes",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryTableName.Span);
  },
);

enum TelemetryTableName {
  Metric = "Metric",
  Span = "Span",
  Log = "Log",
}

type GetAttributesFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
  telemetryTableName: TelemetryTableName,
) => Promise<void>;

const getAttributes: GetAttributesFunction = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
  telemetryTableName: TelemetryTableName,
) => {
  try {
    const databaseProps: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    if (!databaseProps) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid User Sesssion"),
      );
    }

    // Metric Query

    const arrayOfAttributeKeysAsString: string =
      await MetricService.executeQuery(
        `SELECT groupUniqArrayArray(JSONExtractKeys(attributes)) AS keys FROM ${telemetryTableName} WHERE projectId = '${databaseProps.tenantId?.toString()}'`,
      );

    const arrayOfAttributeKeys: JSONArray = JSONFunctions.parseJSONArray(
      arrayOfAttributeKeysAsString,
    );

    return Response.sendJsonObjectResponse(req, res, {
      attributes: arrayOfAttributeKeys.sort(),
    });
  } catch (err: any) {
    next(err);
  }
};

export default router;
