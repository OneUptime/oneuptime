import UserMiddleware from "../Middleware/UserAuthorization";
import WorkspaceNotificationSummaryService, {
  Service as WorkspaceNotificationSummaryServiceType,
} from "../Services/WorkspaceNotificationSummaryService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import WorkspaceNotificationSummary from "../../Models/DatabaseModels/WorkspaceNotificationSummary";
import ObjectID from "../../Types/ObjectID";

export default class WorkspaceNotificationSummaryAPI extends BaseAPI<
  WorkspaceNotificationSummary,
  WorkspaceNotificationSummaryServiceType
> {
  public constructor() {
    super(WorkspaceNotificationSummary, WorkspaceNotificationSummaryService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/test/:workspaceNotificationSummaryId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          await this.service.testSummary({
            summaryId: new ObjectID(
              req.params["workspaceNotificationSummaryId"] as string,
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
