import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import AIService from "../Services/AIService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import LlmLog from "../../Models/DatabaseModels/LlmLog";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import {
  ProjectAiDailyLimit,
  ProjectAiDailyLimitValues,
  ProjectAiDailyUsage,
} from "../../Types/AI/ProjectAiDailyLimits";

/*
 * What a project's AI has used today, against its own daily AI limits -
 * the line under Project Settings → AI Features → More settings ("At most
 * 200,000 tokens a day. Used today: 45,210 tokens."). Somebody choosing a
 * limit needs to know what a day of their AI costs, and somebody whose AI
 * stopped needs to see why, so usage is answered whether or not a limit is
 * set.
 *
 * The figures are sums of the project's AI Logs, so the caller must be able
 * to read those: an authenticated member of the project (or a project API
 * key) whose permissions include LlmLog's own read list, the same rule as
 * GET /llm-log. Spend is answered only where AI is billed.
 */
const router: ExpressRouter = Express.getRouter();

router.post(
  "/ai/daily-usage",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      /*
       * getUserMiddleware admits anonymous callers and takes the project
       * from a caller-supplied header, so membership is checked here, then
       * read access to the AI Logs these figures are made of.
       */
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);

      CommonAPI.assertCanReadTable({
        modelType: LlmLog,
        props,
        errorMessage:
          "You do not have permission to read this project's AI usage.",
      });

      const today: {
        limits: ProjectAiDailyLimitValues;
        usage: ProjectAiDailyUsage;
        reachedLimit: ProjectAiDailyLimit | null;
        dayStartedAt: Date;
        resetsAt: Date;
      } = await AIService.getProjectDailyUsage(projectId);

      Response.sendJsonObjectResponse(req, res, {
        usedTokensToday: today.usage.usedTokensToday,
        spentTodayInUSDCents: IsBillingEnabled
          ? today.usage.spentTodayInUSDCents
          : null,
        tokenLimit: today.limits.tokenLimit,
        spendLimitInUSD: today.limits.spendLimitInUSD,
        reachedLimit: today.reachedLimit,
        dayStartedAt: today.dayStartedAt.toISOString(),
        resetsAt: today.resetsAt.toISOString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
