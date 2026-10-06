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
import TestSendAccess, { TestSendCaller } from "./TestSendAccess";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import ObjectID from "../../Types/ObjectID";

export default class WorkspaceNotificationRuleAPI extends BaseAPI<
  WorkspaceNotificationRule,
  WorkspaceNotificationRuleServiceType
> {
  public constructor() {
    super(WorkspaceNotificationRule, WorkspaceNotificationRuleService);

    /*
     * "Test Rule": posts a test message for one rule into its Slack or
     * Microsoft Teams channels - and, for a rule that makes a channel per
     * event, creates one and invites the rule's people to it. It asks what
     * every test send asks (TestSendAccess): a signed-in member, on a
     * credential that may make changes, on the plan rules are sold on, who
     * could create a rule - whoever could make OneUptime post into these
     * channels anyway - and a rule they may read, in their own project.
     * testRule then reads the rule as OneUptime to send it.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/test/:workspaceNotifcationRuleId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const ruleId: ObjectID = new ObjectID(
            req.params["workspaceNotifcationRuleId"] as string,
          );

          const caller: TestSendCaller = await TestSendAccess.assertMaySendTest(
            {
              req: req,
              modelType: WorkspaceNotificationRule,
              record: {
                service: this.service,
                id: ruleId,
              },
            },
          );

          await this.service.testRule({
            ruleId: ruleId,
            props: caller.props,
            projectId: caller.projectId,
            testByUserId: caller.userId,
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (e) {
          next(e);
        }
      },
    );
  }
}
