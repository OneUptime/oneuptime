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
import TestSendAccess, { TestSendCaller } from "./TestSendAccess";
import WorkspaceNotificationSummary from "../../Models/DatabaseModels/WorkspaceNotificationSummary";
import ObjectID from "../../Types/ObjectID";

export default class WorkspaceNotificationSummaryAPI extends BaseAPI<
  WorkspaceNotificationSummary,
  WorkspaceNotificationSummaryServiceType
> {
  public constructor() {
    super(WorkspaceNotificationSummary, WorkspaceNotificationSummaryService);

    /*
     * "Send Test Now": posts one summary into its Slack or Microsoft Teams
     * channels right away. It asks what every test send asks
     * (TestSendAccess): a signed-in member, on a credential that may make
     * changes, on the plan summaries are sold on - asked here, since a
     * project below it may still read the summaries it has, to switch them
     * off or delete them - who could create a summary, and a summary they
     * may read, in their own project. testSummary then reads the summary as
     * OneUptime to send it.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/test/:workspaceNotificationSummaryId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const summaryId: ObjectID = new ObjectID(
            req.params["workspaceNotificationSummaryId"] as string,
          );

          const caller: TestSendCaller = await TestSendAccess.assertMaySendTest(
            {
              req: req,
              modelType: WorkspaceNotificationSummary,
              record: {
                service: this.service,
                id: summaryId,
              },
            },
          );

          await this.service.testSummary({
            summaryId: summaryId,
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
