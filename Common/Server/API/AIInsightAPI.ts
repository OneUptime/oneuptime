import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONArray, JSONObject } from "../../Types/JSON";
import AIInsightStatus from "../../Types/AI/AIInsightStatus";
import AIInsightHumanVerdict from "../../Types/AI/AIInsightHumanVerdict";
import AIInsight from "../../Models/DatabaseModels/AIInsight";
import AIRun from "../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../Models/DatabaseModels/AIRunEvent";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIInsightService from "../Services/AIInsightService";

const router: ExpressRouter = Express.getRouter();

/*
 * Human-action endpoints for the AI insights inbox. Insight rows are
 * server-authored (empty create/update table permissions) — humans act on
 * them only through these routes: a one-click Confirm / Dismiss verdict
 * (the G11 precision measurement), Resolve, and the live triage panel
 * read. Each route access-checks the insight under the USER's permissions
 * first (project membership + the AIInsight read ACL), then the
 * service performs the root read/write — the AIInvestigationAPI idiom.
 */

async function getLoggedInProps(
  req: ExpressRequest,
): Promise<DatabaseCommonInteractionProps> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  if (!props.userId) {
    throw new NotAuthorizedException("A logged-in user session is required.");
  }

  return props;
}

/*
 * Access check under the USER's permissions: the user props enforce project
 * membership and the model's read ACL, so a null result means "does not
 * exist or is not yours" — reported identically so the route never leaks
 * whether an insight id exists in another project.
 */
async function findAccessibleInsight(
  req: ExpressRequest,
  props: DatabaseCommonInteractionProps,
): Promise<AIInsight> {
  const insightIdString: string | undefined = req.body["insightId"] as
    | string
    | undefined;

  if (!insightIdString) {
    throw new BadDataException("insightId is required.");
  }

  const insight: AIInsight | null = await AIInsightService.findOneById({
    id: new ObjectID(insightIdString),
    select: { _id: true },
    props,
  });

  if (!insight || !insight.id) {
    throw new BadDataException(
      "AI insight not found (or you do not have access to it).",
    );
  }

  return insight;
}

/*
 * One-click human verdict (the G11 precision measurement — confirm/dismiss
 * rates per insight type gate future automation). Overwriting an existing
 * verdict is allowed: the latest verdict wins. Dismissed also closes the
 * insight; Confirmed leaves its status untouched.
 * Body: { insightId, verdict: "Confirmed" | "Dismissed" }.
 * Response: { insightId, verdict }.
 */
router.post(
  "/ai-insight/verdict",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const verdict: string | undefined = req.body["verdict"] as
        | string
        | undefined;

      if (
        verdict !== AIInsightHumanVerdict.Confirmed &&
        verdict !== AIInsightHumanVerdict.Dismissed
      ) {
        throw new BadDataException(
          'verdict must be "Confirmed" or "Dismissed".',
        );
      }

      const insight: AIInsight = await findAccessibleInsight(req, props);

      const result: {
        insightId: ObjectID;
        verdict: AIInsightHumanVerdict;
      } = await AIInsightService.applyHumanVerdict({
        insightId: insight.id!,
        verdict: verdict as AIInsightHumanVerdict,
        byUserId: props.userId!,
      });

      Response.sendJsonObjectResponse(req, res, {
        insightId: result.insightId.toString(),
        verdict: result.verdict,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * Marks the insight handled. Resolving implies the finding was real: when
 * no verdict was recorded yet, the service also stamps Confirmed.
 * Body: { insightId }. Response: { insightId, status }.
 */
router.post(
  "/ai-insight/resolve",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const insight: AIInsight = await findAccessibleInsight(req, props);

      const result: { insightId: ObjectID; status: AIInsightStatus } =
        await AIInsightService.resolveInsight({
          insightId: insight.id!,
          byUserId: props.userId!,
        });

      Response.sendJsonObjectResponse(req, res, {
        insightId: result.insightId.toString(),
        status: result.status,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * Live triage panel data: the insight's triage AIRun + its ordered event
 * trail (capped — see MAX_TRIAGE_RUN_EVENTS on the service). Triage runs
 * are system-authored and hidden by the per-user pin on the generic AIRun
 * CRUD, so after the access check the service reads them as root — the
 * sendLatestInvestigation idiom. An insight without a triage run responds
 * { run: null, events: [] }, not an error.
 * Body: { insightId }. Response: { run, events }.
 */
router.post(
  "/ai-insight/triage-run",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const insight: AIInsight = await findAccessibleInsight(req, props);

      const result: { run: AIRun | null; events: Array<AIRunEvent> } =
        await AIInsightService.getLatestTriageRunWithEvents({
          insightId: insight.id!,
        });

      const runJson: JSONObject | undefined = result.run
        ? BaseModel.toJSONArray([result.run], AIRun)[0]
        : undefined;

      const eventsJson: JSONArray = BaseModel.toJSONArray(
        result.events,
        AIRunEvent,
      );

      Response.sendJsonObjectResponse(req, res, {
        run: runJson || null,
        events: eventsJson,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
