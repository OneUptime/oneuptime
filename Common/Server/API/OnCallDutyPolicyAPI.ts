import UserMiddleware from "../Middleware/UserAuthorization";
import OnCallDutyPolicyService, {
  Service as OnCallDutyPolicyServiceType,
} from "../Services/OnCallDutyPolicyService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRuleUser from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyEscalationRuleTeam from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

export default class OnCallDutyPolicyAPI extends BaseAPI<
  OnCallDutyPolicy,
  OnCallDutyPolicyServiceType
> {
  public constructor() {
    super(OnCallDutyPolicy, OnCallDutyPolicyService);

    // CNAME verification api. THis API will be used from the dashboard to validate the CNAME MANUALLY.
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/current-on-duty-escalation-policies`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID = databaseProps.tenantId as ObjectID;

          const userId: ObjectID = databaseProps.userId as ObjectID;

          if (!projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid projectId."),
            );
          }

          if (!userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid userId."),
            );
          }

          const result: {
            escalationRulesByUser: Array<OnCallDutyPolicyEscalationRuleUser>;
            escalationRulesByTeam: Array<OnCallDutyPolicyEscalationRuleTeam>;
            escalationRulesBySchedule: Array<OnCallDutyPolicyEscalationRuleSchedule>;
          } = await this.service.getOnCallPoliciesWhereUserIsOnCallDuty({
            projectId: projectId,
            userId: userId,
          });

          return Response.sendJsonObjectResponse(req, res, {
            escalationRulesByUser: BaseModel.toJSONArray(
              result.escalationRulesByUser,
              OnCallDutyPolicyEscalationRuleUser,
            ),
            escalationRulesByTeam: BaseModel.toJSONArray(
              result.escalationRulesByTeam,
              OnCallDutyPolicyEscalationRuleTeam,
            ),
            escalationRulesBySchedule: BaseModel.toJSONArray(
              result.escalationRulesBySchedule,
              OnCallDutyPolicyEscalationRuleSchedule,
            ),
          });
        } catch (e) {
          next(e);
        }
      },
    );
  }
}
