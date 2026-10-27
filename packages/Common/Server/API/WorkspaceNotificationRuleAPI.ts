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
import TestSendAccess, { TestSendCaller } from "./TestSendAccess";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import { WorkspaceChannelNumberPrefixes } from "../../Utils/Workspace/WorkspaceChannelName";

/*
 * What a caller who may not read the project's notification rules is told
 * when asking for its number prefixes.
 */
export const RULE_NUMBER_PREFIXES_PERMISSION_MESSAGE: string =
  "You do not have permission to read this project's notification rules.";

export default class WorkspaceNotificationRuleAPI extends BaseAPI<
  WorkspaceNotificationRule,
  WorkspaceNotificationRuleServiceType
> {
  public constructor() {
    super(WorkspaceNotificationRule, WorkspaceNotificationRuleService);

    /*
     * GET /workspace-notification-rule/number-prefixes
     *
     * The project's number prefixes by the kind of record a rule is for -
     * { "Incident": "INC-", "Alert": "ALT-", ... }, null for none - so the
     * rule form can show the name of the channel a rule creates as it is
     * typed: incident INC-42's channel is inc-42, or prod-inc-42 with a
     * prefix (WorkspaceChannelName). The form shows it to everyone who may
     * edit rules, and a Settings Member may without reading the project's
     * settings, so the prefixes are read as OneUptime - they are no secret:
     * every incident's number and every channel a rule creates carries one.
     *
     * For a member of the project who may read its notification rules.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/number-prefixes`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          CommonAPI.assertCanReadTable({
            modelType: WorkspaceNotificationRule,
            props: databaseProps,
            errorMessage: RULE_NUMBER_PREFIXES_PERMISSION_MESSAGE,
          });

          const numberPrefixes: WorkspaceChannelNumberPrefixes =
            await this.service.getRecordNumberPrefixes(projectId);

          // A prefix changed a moment later changes the answer.
          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(req, res, {
            numberPrefixes: numberPrefixes,
          });
        } catch (e) {
          next(e);
        }
      },
    );

    /*
     * "Test Rule": posts a test message for one rule into its Slack or
     * Microsoft Teams channels - and, for a rule that makes a channel per
     * event, creates one and invites the rule's people to it. It asks what
     * every test send asks (TestSendAccess): a signed-in member, on a
     * credential that may make changes, on the plan rules are sold on, who
     * could create a rule - whoever could make OneUptime post into these
     * channels anyway - and a rule they may read, in their own project.
     * testRule then reads the rule as OneUptime to send it.
     *
     * A POST: it posts into chat channels. The session cookie is
     * SameSite=Lax, which a link on another site still carries on a GET,
     * and the project can be named in the query string - so as a GET, a
     * link someone with the rule's access followed sent the test as them.
     */
    this.router.post(
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
