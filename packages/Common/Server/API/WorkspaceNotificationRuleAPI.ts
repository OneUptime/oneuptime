import UserMiddleware from "../Middleware/UserAuthorization";
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

export default class WorkspaceNotificationRuleAPI extends BaseAPI<
  WorkspaceNotificationRule,
  WorkspaceNotificationRuleServiceType
> {
  public constructor() {
    super(WorkspaceNotificationRule, WorkspaceNotificationRuleService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/test/:workspaceNotifcationRuleId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          /*
           * getUserMiddleware lets unauthenticated requests through as
           * "public", and testRule loads the rule as root and then posts a
           * test message into that project's Slack / Teams channels — it can
           * even create channels. Require an authenticated member of the
           * project, and of the rule's own project at that: testRule takes
           * the project from the rule it loaded, so the caller-supplied
           * tenant alone proves nothing about the rule id in the path.
           */
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          const ruleId: ObjectID = new ObjectID(
            req.params["workspaceNotifcationRuleId"] as string,
          );

          const rule: WorkspaceNotificationRule | null =
            await this.service.findOneById({
              id: ruleId,
              select: {
                projectId: true,
              },
              props: {
                isRoot: true,
              },
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
