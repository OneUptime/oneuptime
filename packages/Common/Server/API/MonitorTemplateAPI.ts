import UserMiddleware from "../Middleware/UserAuthorization";
import MonitorTemplateService, {
  Service as MonitorTemplateServiceType,
  SyncLinkedMonitorsResult,
  SyncToMonitorResult,
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
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import ProductKey from "../../Types/Product/ProductKey";
import { MonitorTemplateLinkResult } from "../../Types/Monitor/MonitorTemplateChange";

/*
 * A sync's `fields` that is not a list of setting names (#7711): an API
 * client's mistake, said with what to send.
 */
const SYNC_FIELDS_NOT_A_LIST_REFUSAL: string =
  'The sync did not run: "fields" must be a list of setting names, such as ["monitorDestination"]. Send it as a list, or leave it out to sync every setting.';

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
    throw new BadDataException(SYNC_FIELDS_NOT_A_LIST_REFUSAL);
  }
  for (const entry of raw) {
    if (typeof entry !== "string") {
      throw new BadDataException(SYNC_FIELDS_NOT_A_LIST_REFUSAL);
    }
  }
  return raw as Array<string>;
}

/*
 * A yes or no a link or an unlink is asked with (issues #11260, #11266):
 * Link's "bring the template's settings", Unlink's "clear the template's
 * criteria". Only `true` says yes; anything else - left out, as every client
 * before sent it - keeps what the route always did.
 */
function readSwitch(req: ExpressRequest, name: string): boolean {
  return (req.body as Record<string, unknown> | undefined)?.[name] === true;
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
      ServerProductRoutes.refuseWhileOff(ProductKey.Monitors),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const monitorTemplateId: ObjectID = new ObjectID(
            req.params["monitorTemplateId"] as string,
          );

          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertTenantScoped(props);

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
      ServerProductRoutes.refuseWhileOff(ProductKey.Monitors),
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

          CommonAPI.assertTenantScoped(props);

          const fields: Array<string> | undefined = readSyncFields(req);

          // What the sync resolved, said only when it resolved any (#11453).
          const result: SyncToMonitorResult =
            await MonitorTemplateService.syncToMonitor({
              monitorTemplateId,
              monitorId,
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

    // Link an existing monitor to this template.
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:monitorTemplateId/link-monitor/:monitorId`,
      UserMiddleware.getUserMiddleware,
      ServerProductRoutes.refuseWhileOff(ProductKey.Monitors),
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

          CommonAPI.assertTenantScoped(props);

          const result: MonitorTemplateLinkResult =
            await MonitorTemplateService.linkMonitor({
              monitorTemplateId,
              monitorId,
              props,
              applyTemplateSettings: readSwitch(req, "applyTemplateSettings"),
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

    // Detach a monitor from this template.
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:monitorTemplateId/unlink-monitor/:monitorId`,
      UserMiddleware.getUserMiddleware,
      ServerProductRoutes.refuseWhileOff(ProductKey.Monitors),
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

          CommonAPI.assertTenantScoped(props);

          const result: MonitorTemplateLinkResult =
            await MonitorTemplateService.unlinkMonitor({
              monitorTemplateId,
              monitorId,
              props,
              clearTemplateSettings: readSwitch(req, "clearTemplateSettings"),
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
  }
}
