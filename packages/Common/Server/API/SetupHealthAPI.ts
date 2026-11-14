import UserMiddleware from "../Middleware/UserAuthorization";
import SetupHealthService from "../Services/SetupHealthService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import { isRefreshRequested } from "./WhoIsToldAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SetupHealthAnswer,
  SetupHealthSummary,
} from "../../Types/SetupHealth/SetupHealth";

/*
 * SETUP HEALTH (Types/SetupHealth/SetupHealth, #6812): what is misconfigured
 * in the project, each finding with its fix.
 *
 *   GET /setup-health[?refresh=true]   the findings, and the dismissed ones
 *   GET /setup-health/summary          the counts, for Home's line
 *
 * A signed-in member of the project (or a key of it); each is handed the
 * findings about records they may read (SetupHealthService.getForCaller).
 * Reads only: a finding is dismissed and restored through the
 * RecommendationDismissal CRUD routes. `refresh` works the findings out
 * again instead of using the minute-old ones, as Readiness's Recheck does.
 *
 * A bare router, as OnCallReadinessAPI is: it reads no single model's CRUD
 * routes.
 */

export const SETUP_HEALTH_API_PATH: string = "/setup-health";

const router: ExpressRouter = Express.getRouter();

router.get(
  SETUP_HEALTH_API_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
        projectId: projectId,
        props: props,
        refresh: isRefreshRequested(req),
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        answer as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  `${SETUP_HEALTH_API_PATH}/summary`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      const summary: SetupHealthSummary =
        await SetupHealthService.getSummaryForCaller({
          projectId: projectId,
          props: props,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        summary as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
