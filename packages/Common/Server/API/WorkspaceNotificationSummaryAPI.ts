import UserMiddleware from "../Middleware/UserAuthorization";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../Types/Database/Permissions/BillingPermission";
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
import BadDataException from "../../Types/Exception/BadDataException";

export default class WorkspaceNotificationSummaryAPI extends BaseAPI<
  WorkspaceNotificationSummary,
  WorkspaceNotificationSummaryServiceType
> {
  public constructor() {
    super(WorkspaceNotificationSummary, WorkspaceNotificationSummaryService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/test/:workspaceNotificationSummaryId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const summaryId: ObjectID = new ObjectID(
            req.params["workspaceNotificationSummaryId"] as string,
          );

          /*
           * Sending a summary is what the Growth plan sells. A project below
           * it may still read the summaries it has - to find, switch off and
           * delete them (Types/Billing/PlanGatedTable) - so the read below
           * no longer stands in for the plan: it is asked here.
           */
          BillingPermissions.checkFeatureIsOnPlan(
            WorkspaceNotificationSummary,
            databaseProps,
            DatabaseRequestType.Read,
          );

          // Verify the summary belongs to the user's project
          const summary: WorkspaceNotificationSummary | null =
            await this.service.findOneById({
              id: summaryId,
              select: { projectId: true },
              props: databaseProps,
            });

          if (!summary) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Summary not found or access denied"),
            );
          }

          await this.service.testSummary({
            summaryId: summaryId,
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
