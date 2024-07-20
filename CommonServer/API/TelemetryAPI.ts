import UserMiddleware from "../Middleware/UserAuthorization";
import NotificationService from "../Services/NotificationService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import PositiveNumber from "Common/Types/PositiveNumber";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import AnalyticsDatabaseService from "../Services/AnalyticsDatabaseService";
import MetricService from "../Services/MetricService";
import { JSONArray } from "Common/Types/JSON";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/telemetry/get-attributes",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      
        const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

        if(!databaseProps) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid Session Token"),
          );
        }

        // Metric Query
    
        const arrayOfAttributeKeysAsString: string = await MetricService.executeQuery(`SELECT groupUniqArrayArray(JSONExtractKeys(attributes)) AS keys FROM Metric WHERE projectId = '${databaseProps.tenantId?.toString()}'`);

        const arrayOfAttributeKeys: JSONArray = JSONFunctions.parseJSONArray(arrayOfAttributeKeysAsString);

        return Response.sendJsonObjectResponse(req, res, {
            "attributes": arrayOfAttributeKeys
        });
        
    } catch (err: any) {
      return Response.sendErrorResponse(req, res, err as Exception);
    }

    return Response.sendEmptySuccessResponse(req, res);
  },
);

export default router;
