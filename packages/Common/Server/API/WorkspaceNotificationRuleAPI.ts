import UserMiddleware from "../Middleware/UserAuthorization";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../Types/Database/Permissions/BillingPermission";
import WorkspaceNotificationRuleService, {
  Service as WorkspaceNotificationRuleServiceType,
} from "../Services/WorkspaceNotificationRuleService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import ObjectID from "../../Types/ObjectID";

/*
 * What a refused test send says to someone who may not post into the
 * project's workspace: the same words as a channel's own Send Test (SlackAPI,
 * MicrosoftTeamsAPI), which asks the same permission.
 */
export const TEST_NOTIFICATION_PERMISSION_MESSAGE: string =
  "You do not have permission to send test notifications in this project.";

export default class WorkspaceNotificationRuleAPI extends BaseAPI<
  WorkspaceNotificationRule,
  WorkspaceNotificationRuleServiceType
> {
  public constructor() {
    super(WorkspaceNotificationRule, WorkspaceNotificationRuleService);

    /*
     * "Test Rule": posts a test message for one rule into its Slack or
     * Microsoft Teams channels - and, for a rule that makes a channel per
     * event, creates one and invites the rule's people to it. So, in this
     * order, it asks:
     *
     *  1. an authenticated member of the project - getUserMiddleware lets
     *     unauthenticated requests through as "public";
     *  2. the plan: posting through a rule is what the Growth plan sells. A
     *     project below it may still read the rules it has - to find, switch
     *     off and delete them (Types/Billing/PlanGatedTable) - so the read in
     *     step 4 does not stand in for the plan: it is asked here, as a
     *     summary's test send asks it;
     *  3. someone who may post into the workspace: posting is a side effect,
     *     so seeing the rule is not enough. Whoever could create a rule could
     *     make OneUptime post into these channels anyway, so that is the
     *     permission asked, team blocks included - the one a channel's own
     *     Send Test asks (assertCanCreateTable);
     *  4. a rule the caller may read, in the project they are a member of:
     *     read with their own permissions, never as root. A rule of another
     *     project, one they may not see and one that does not exist all
     *     answer the same, so the route tells nobody which ids exist.
     *
     * testRule then reads the rule as OneUptime to send it.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/test/:workspaceNotifcationRuleId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          /*
           * One rule in one project: every check below is made for that
           * project alone, so the request is never read as multi-tenant.
           */
          const databaseProps: DatabaseCommonInteractionProps = {
            ...(await CommonAPI.getDatabaseCommonInteractionProps(req)),
            isMultiTenantRequest: false,
          };

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          BillingPermissions.checkFeatureIsOnPlan(
            WorkspaceNotificationRule,
            databaseProps,
            DatabaseRequestType.Read,
          );

          CommonAPI.assertCanCreateTable({
            modelType: WorkspaceNotificationRule,
            props: databaseProps,
            errorMessage: TEST_NOTIFICATION_PERMISSION_MESSAGE,
          });

          const ruleId: ObjectID = new ObjectID(
            req.params["workspaceNotifcationRuleId"] as string,
          );

          const rule: WorkspaceNotificationRule | null =
            await this.service.findOneById({
              id: ruleId,
              select: {
                projectId: true,
              },
              props: databaseProps,
            });

          CommonAPI.assertResourceBelongsToProject({
            resourceProjectId: rule?.projectId,
            projectId: projectId,
          });

          await this.service.testRule({
            ruleId: ruleId,
            props: databaseProps,
            projectId: projectId,
            testByUserId: databaseProps.userId!,
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (e) {
          next(e);
        }
      },
    );
  }
}
