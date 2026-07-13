import AIAgentTaskPullRequestService, {
  AIFixOutcomeStats,
  Service as AIAgentTaskPullRequestServiceType,
} from "../Services/AIAgentTaskPullRequestService";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import UserMiddleware from "../Middleware/UserAuthorization";
import Response from "../Utils/Response";
import AIAgentTaskPullRequest from "../../Models/DatabaseModels/AIAgentTaskPullRequest";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";

export default class AIAgentTaskPullRequestAPI extends BaseAPI<
  AIAgentTaskPullRequest,
  AIAgentTaskPullRequestServiceType
> {
  public constructor() {
    super(AIAgentTaskPullRequest, AIAgentTaskPullRequestService);

    /*
     * Outcome counts for the project's AI-authored fix PRs (merged /
     * closed-unmerged / open + acceptance rate) — the G11 baseline surface.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/outcome-stats`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const stats: AIFixOutcomeStats =
            await this.service.getOutcomeStats(props);

          return Response.sendJsonObjectResponse(req, res, {
            total: stats.total,
            open: stats.open,
            merged: stats.merged,
            closedUnmerged: stats.closedUnmerged,
            acceptanceRatePercent: stats.acceptanceRatePercent,
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
