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
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          /*
           * getUserMiddleware lets unauthenticated requests through as
           * "public", and refreshMonitorCurrentStatus reads and writes the
           * monitor as root. Require an authenticated member of the
           * monitor's own project — the caller-supplied tenant says nothing
           * about which project the monitor id in the path belongs to.
           */
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          const monitorId: ObjectID = new ObjectID(
            req.params["monitorId"] as string,
          );

          const monitor: Monitor | null = await MonitorService.findOneById({
            id: monitorId,
            select: {
              projectId: true,
            },
            props: {
              isRoot: true,
            },
          });

          CommonAPI.assertResourceBelongsToProject({
            resourceProjectId: monitor?.projectId,
            projectId: projectId,
          });

          await MonitorService.refreshMonitorCurrentStatus(monitorId);
          return Response.sendEmptySuccessResponse(req, res);
        } catch (e) {
          next(e);
        }
      },
    );
  }
}
