import UserMiddleware from "../Middleware/UserAuthorization";
import OnCallDutyPolicyUserOverrideService, {
  Service as OnCallDutyPolicyUserOverrideServiceType,
} from "../Services/OnCallDutyPolicyUserOverrideService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import OnCallDutyPolicyUserOverride from "../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import UserOverrideAddAccessUtil, {
  USER_OVERRIDE_ADD_ACCESS_ROUTE,
  UserOverrideAddAccess,
} from "../../Types/OnCallDutyPolicy/UserOverrideAddAccess";
import { USER_OVERRIDE_END_NOW_ROUTE } from "../../Types/OnCallDutyPolicy/UserOverrideEdit";

/*
 * The user override API: its table's routes, and
 *
 *   POST /on-call-duty-policy-user-override/add-access
 *
 * which says where the caller may add an override - on each on-call policy
 * the body names, and globally (Types/OnCallDutyPolicy/UserOverrideAddAccess,
 * OnCallDutyPolicyUserOverrideService.getAddAccess). A POST because the
 * policies travel in the body. And
 *
 *   POST /on-call-duty-policy-user-override/:id/end-now
 *
 * which ends an override under way now, at the server's clock (End Now).
 * The project is the request's tenant; a project API key is asked like a
 * member, its permissions deciding. A request with no session is answered
 * 401, so an idle tab refreshes it.
 */
export default class OnCallDutyPolicyUserOverrideAPI extends BaseAPI<
  OnCallDutyPolicyUserOverride,
  OnCallDutyPolicyUserOverrideServiceType
> {
  public constructor() {
    super(OnCallDutyPolicyUserOverride, OnCallDutyPolicyUserOverrideService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}${USER_OVERRIDE_ADD_ACCESS_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertTenantScoped(props);

          const onCallDutyPolicyIds: Array<ObjectID> =
            UserOverrideAddAccessUtil.parseRequest(req.body);

          const access: UserOverrideAddAccess = await this.service.getAddAccess(
            {
              onCallDutyPolicyIds: onCallDutyPolicyIds,
              props: props,
            },
          );

          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(
            req,
            res,
            UserOverrideAddAccessUtil.resultToJSON(access),
          );
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * POST /on-call-duty-policy-user-override/:id/end-now: End Now (issue
     * #7899) - the override under way ends at the server's now, as an edit
     * of its end by the caller (OnCallDutyPolicyUserOverrideService.endNow).
     * For CodeQL's missing-rate-limiting triage: an authenticated,
     * tenant-scoped write, like the table's own PUT beside it.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}${USER_OVERRIDE_END_NOW_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertTenantScoped(props);

          const overrideIdParam: string = String(req.params["id"] || "");
          ObjectID.validateUUID(overrideIdParam);

          const endsAt: Date = await this.service.endNow({
            id: new ObjectID(overrideIdParam),
            props: props,
          });

          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(req, res, {
            _id: overrideIdParam,
            endsAt: endsAt.toISOString(),
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
