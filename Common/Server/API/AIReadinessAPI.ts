import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONArray } from "../../Types/JSON";
import { AIFixReadiness } from "../../Types/AI/AIFixReadiness";
import CodeFixReadiness from "../Utils/AI/CodeFix/CodeFixReadiness";

/*
 * Project-wide "can AI actually do anything here?" — the gates a CodeFix run
 * passes through, answered for the whole project rather than one exception.
 * The AI Tasks page renders this instead of a static prerequisites banner, so
 * what the user reads reflects what the server would actually decide.
 *
 * The per-exception equivalent lives at
 * GET /telemetry-exception/ai-fix-readiness/:id; both share the checks in
 * CodeFixReadiness, so they cannot drift apart.
 */
const router: ExpressRouter = Express.getRouter();

router.post(
  "/ai-readiness/code-fix",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!props.tenantId) {
        throw new NotAuthorizedException(
          "AI readiness requires a project context.",
        );
      }

      const readiness: AIFixReadiness =
        await CodeFixReadiness.getProjectReadiness({
          projectId: props.tenantId,
        });

      return Response.sendJsonObjectResponse(req, res, {
        ready: readiness.ready,
        checks: readiness.checks as unknown as JSONArray,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
