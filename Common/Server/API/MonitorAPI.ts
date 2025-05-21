import UserMiddleware from "../Middleware/UserAuthorization";
import MonitorService, {
  Service as MonitorServiceType,
} from "../Services/MonitorService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import Monitor from "../../Models/DatabaseModels/Monitor";
import ObjectID from "../../Types/ObjectID";

export default class MonitorAPI extends BaseAPI<Monitor, MonitorServiceType> {
  public constructor() {
    super(Monitor, MonitorService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/refresh-status/:monitorId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const monitorId: ObjectID = new ObjectID(
            req.params["monitorId"] as string,
          );

          await MonitorService.refreshMonitorCurrentStatus(monitorId);
          return Response.sendEmptySuccessResponse(req, res);
        } catch (e) {
          next(e);
        }
      },
    );
  }
}
