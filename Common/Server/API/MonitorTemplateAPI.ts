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

/**
 * Pull a `fields` whitelist out of the request body for a sync endpoint.
 * Returns undefined when the caller didn't ask to scope the sync — the
 * service treats that as "sync everything syncable".
 */
function readSyncFields(req: ExpressRequest): Array<string> | undefined {
  const raw: unknown = (req.body as Record<string, unknown> | undefined)?.[
    "fields"
  ];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new BadDataException("`fields` must be an array of strings");
  }
  for (const entry of raw) {
    if (typeof entry !== "string") {
      throw new BadDataException("`fields` must be an array of strings");
    }
  }
  return raw as Array<string>;
}

export default class MonitorTemplateAPI extends BaseAPI<
  MonitorTemplate,
  MonitorTemplateServiceType
> {
  public constructor() {
    super(MonitorTemplate, MonitorTemplateService);

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

          const fields: Array<string> | undefined = readSyncFields(req);

          const result: SyncLinkedMonitorsResult =
            await MonitorTemplateService.syncLinkedMonitors({
              monitorTemplateId,
              props,
              ...(fields !== undefined ? { fields } : {}),
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

          const fields: Array<string> | undefined = readSyncFields(req);

          await MonitorTemplateService.syncToMonitor({
            monitorTemplateId,
            monitorId,
            props,
            ...(fields !== undefined ? { fields } : {}),
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (e) {
          next(e);
        }
        return;
      },
    );

    // Link an existing monitor to this template.
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:monitorTemplateId/link-monitor/:monitorId`,
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

          await MonitorTemplateService.linkMonitor({
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

    // Detach a monitor from this template.
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:monitorTemplateId/unlink-monitor/:monitorId`,
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

          await MonitorTemplateService.unlinkMonitor({
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
