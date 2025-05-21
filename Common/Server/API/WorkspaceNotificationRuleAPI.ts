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

          await this.service.testRule({
            ruleId: new ObjectID(
              req.params["workspaceNotifcationRuleId"] as string,
            ),
            props: databaseProps,
            projectId: databaseProps.tenantId!,
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
