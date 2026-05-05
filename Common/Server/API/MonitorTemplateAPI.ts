import UserMiddleware from "../Middleware/UserAuthorization";
import MonitorTemplateService, {
  Service as MonitorTemplateServiceType,
  SyncLinkedMonitorsResult,
} from "../Services/MonitorTemplateService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import MonitorTemplate from "../../Models/DatabaseModels/MonitorTemplate";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";

export default class MonitorTemplateAPI extends BaseAPI<
  MonitorTemplate,
  MonitorTemplateServiceType
> {
  public constructor() {
    super(MonitorTemplate, MonitorTemplateService);

    // Count monitors created from this template (used by the sync UI).
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:monitorTemplateId/linked-monitor-count`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const monitorTemplateId: ObjectID = new ObjectID(
            req.params["monitorTemplateId"] as string,
          );

          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          if (!props.tenantId) {
            throw new BadDataException("Project ID is required");
          }

          // Verify the user can read this template before exposing the count.
          await MonitorTemplateService.findOneById({
            id: monitorTemplateId,
            select: { _id: true },
            props,
          });

          const count: number =
            await MonitorTemplateService.countLinkedMonitors({
              monitorTemplateId,
              projectId: props.tenantId as ObjectID,
            });

          return Response.sendJsonObjectResponse(req, res, {
            count,
          });
        } catch (e) {
          next(e);
        }
        return;
      },
    );

    // Push the template's current configuration onto every linked monitor.
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:monitorTemplateId/sync-to-linked-monitors`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const monitorTemplateId: ObjectID = new ObjectID(
            req.params["monitorTemplateId"] as string,
          );

          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const result: SyncLinkedMonitorsResult =
            await MonitorTemplateService.syncLinkedMonitors({
              monitorTemplateId,
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            ...result,
          });
        } catch (e) {
          next(e);
        }
        return;
      },
    );

    // Push the template's current configuration onto a single linked monitor.
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:monitorTemplateId/sync-to-monitor/:monitorId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const monitorTemplateId: ObjectID = new ObjectID(
            req.params["monitorTemplateId"] as string,
          );
          const monitorId: ObjectID = new ObjectID(
            req.params["monitorId"] as string,
          );

          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          await MonitorTemplateService.syncToMonitor({
            monitorTemplateId,
            monitorId,
            props,
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (e) {
          next(e);
        }
        return;
      },
    );
  }
}
