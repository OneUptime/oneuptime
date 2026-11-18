import UserMiddleware from "../Middleware/UserAuthorization";
import OnCallDutyPolicyScheduleService, {
  Service as OnCallDutyPolicyScheduleServiceType,
} from "../Services/OnCallDutyPolicyScheduleService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import ScheduleLayersSave from "../Utils/OnCall/ScheduleLayersSave";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import ScheduleLayersSaveUtil, {
  SCHEDULE_LAYERS_READ_ROUTE,
  SCHEDULE_LAYERS_SAVE_ROUTE,
  ScheduleLayersSaveRequest,
  ScheduleLayersSaveResult,
} from "../../Types/OnCallDutyPolicy/ScheduleLayersSave";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import ProductKey from "../../Types/Product/ProductKey";

/*
 * The on-call schedule API: its table's routes, and
 *
 *   POST /on-call-duty-policy-schedule/:id/save-layers
 *
 * which saves the changes made on a schedule's Layers page - who takes turns
 * in each layer and in what order, the layers' priority, the layers deleted
 * - all at once, in one transaction, with one round of messages for the
 * people it reaches (Types/OnCallDutyPolicy/ScheduleLayersSave,
 * Utils/OnCall/ScheduleLayersSave). A save made to layers someone has
 * changed since is answered 409. And
 *
 *   GET /on-call-duty-policy-schedule/:id/layers
 *
 * the layers as a save that changes nothing, with the version they are at:
 * what an API caller or Terraform changes and sends back (issue #9038).
 *
 * The project is the request's tenant; a project API key is asked like a
 * member, its permissions deciding. A request with no session is answered
 * 401, so an idle tab refreshes it.
 */
export default class OnCallDutyPolicyScheduleAPI extends BaseAPI<
  OnCallDutyPolicySchedule,
  OnCallDutyPolicyScheduleServiceType
> {
  public constructor() {
    super(OnCallDutyPolicySchedule, OnCallDutyPolicyScheduleService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}${SCHEDULE_LAYERS_SAVE_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.OnCall),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertTenantScoped(props);

          const scheduleIdParam: string = String(req.params["id"] || "");
          ObjectID.validateUUID(scheduleIdParam);

          const request: ScheduleLayersSaveRequest =
            ScheduleLayersSaveUtil.parseRequest(req.body);

          const result: ScheduleLayersSaveResult =
            await ScheduleLayersSave.save({
              scheduleId: new ObjectID(scheduleIdParam),
              request: request,
              props: props,
            });

          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(
            req,
            res,
            ScheduleLayersSaveUtil.resultToJSON(result),
          );
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * GET /on-call-duty-policy-schedule/:id/layers (issue #9038): the
     * layers as a save that changes nothing, with the version they are at,
     * for an API caller or Terraform to change and send to save-layers.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}${SCHEDULE_LAYERS_READ_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertTenantScoped(props);

          const scheduleIdParam: string = String(req.params["id"] || "");
          ObjectID.validateUUID(scheduleIdParam);

          const layers: ScheduleLayersSaveRequest =
            await ScheduleLayersSave.read({
              scheduleId: new ObjectID(scheduleIdParam),
              props: props,
            });

          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(
            req,
            res,
            ScheduleLayersSaveUtil.requestToJSON(layers),
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
