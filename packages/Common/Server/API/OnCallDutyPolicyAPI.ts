import UserMiddleware from "../Middleware/UserAuthorization";
import OnCallDutyPolicyService, {
  OnDutyPolicies,
  Service as OnCallDutyPolicyServiceType,
} from "../Services/OnCallDutyPolicyService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import CallerPermission from "../Utils/Permission/CallerPermission";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
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

    /*
     * The escalation rules the signed-in person is on duty for: in the
     * project the request names (the dashboard's header, on every page),
     * or - with the is-multi-tenant-query header - in every project they
     * may open, in one answer (My On-Call Policies, #8124).
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/current-on-duty-escalation-policies`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          /*
           * The header polls this on every dashboard page, so it is usually
           * the first request to notice an expired session. It must answer
           * 401 so the client refreshes, not "Invalid userId.".
           */
          CommonAPI.assertCredentialsPresent(databaseProps);

          if (databaseProps.isMultiTenantRequest) {
            if (!databaseProps.userId) {
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException("Invalid userId."),
              );
            }

            const projectIds: Array<ObjectID> =
              OnCallDutyPolicyAPI.getProjectsTheCallerMayOpen(databaseProps);

            const answers: Map<string, OnDutyPolicies> =
              await this.service.getOnCallPoliciesWhereUserIsOnCallDutyInProjects(
                {
                  projectIds: projectIds,
                  userId: databaseProps.userId,
                },
              );

            return Response.sendJsonObjectResponse(
              req,
              res,
              OnCallDutyPolicyAPI.toJSON(
                OnCallDutyPolicyAPI.joinAnswers(projectIds, answers),
              ),
            );
          }

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

          const result: OnDutyPolicies =
            await this.service.getOnCallPoliciesWhereUserIsOnCallDuty({
              projectId: projectId,
              userId: userId,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            OnCallDutyPolicyAPI.toJSON(result),
          );
        } catch (e) {
          next(e);
        }
      },
    );
  }

  /*
   * The projects a request across projects answers for: each one the
   * person may open, checked on its own. getUserMiddleware hands such a
   * request a permission set for every project the person is a member of
   * that is not blocked; a project whose Require SSO to Sign In they have
   * not met gets only what every signed-in user holds - not ProjectUser,
   * which every member who may open the project holds - and is left out,
   * as a request in that project is refused. Each project once.
   */
  public static getProjectsTheCallerMayOpen(
    props: DatabaseCommonInteractionProps,
  ): Array<ObjectID> {
    const projectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const id of Object.keys(props.userTenantAccessPermission || {})) {
      if (!ObjectID.isValidUUID(id)) {
        continue;
      }

      const projectId: ObjectID = new ObjectID(id);

      if (
        CallerPermission.holdsAnyOf(props, [Permission.ProjectUser], {
          projectId,
        })
      ) {
        projectIds.set(id.toLowerCase(), projectId);
      }
    }

    return Array.from(projectIds.values());
  }

  // Every project's rules in one answer, project by project: each row names its project.
  private static joinAnswers(
    projectIds: Array<ObjectID>,
    answers: Map<string, OnDutyPolicies>,
  ): OnDutyPolicies {
    const joined: OnDutyPolicies = {
      escalationRulesByUser: [],
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [],
    };

    for (const projectId of projectIds) {
      const answer: OnDutyPolicies | undefined = answers.get(
        projectId.toString().toLowerCase(),
      );

      if (!answer) {
        continue;
      }

      joined.escalationRulesByUser.push(...answer.escalationRulesByUser);
      joined.escalationRulesByTeam.push(...answer.escalationRulesByTeam);
      joined.escalationRulesBySchedule.push(
        ...answer.escalationRulesBySchedule,
      );
    }

    return joined;
  }

  private static toJSON(answer: OnDutyPolicies): JSONObject {
    return {
      escalationRulesByUser: BaseModel.toJSONArray(
        answer.escalationRulesByUser,
        OnCallDutyPolicyEscalationRuleUser,
      ),
      escalationRulesByTeam: BaseModel.toJSONArray(
        answer.escalationRulesByTeam,
        OnCallDutyPolicyEscalationRuleTeam,
      ),
      escalationRulesBySchedule: BaseModel.toJSONArray(
        answer.escalationRulesBySchedule,
        OnCallDutyPolicyEscalationRuleSchedule,
      ),
    };
  }
}
