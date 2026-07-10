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
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { JSONArray, JSONObject } from "../../Types/JSON";
import AIRunType from "../../Types/AI/AIRunType";
import AIRun from "../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../Models/DatabaseModels/AIRunEvent";
import Incident from "../../Models/DatabaseModels/Incident";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentService from "../Services/IncidentService";
import AIRunService from "../Services/AIRunService";
import AIRunEventService from "../Services/AIRunEventService";

const router: ExpressRouter = Express.getRouter();

const MAX_EVENTS: number = 500;

/*
 * Returns the latest Sentinel investigation (the AIRun + its ordered
 * AIRunEvents) for an incident, so the dashboard can render a live "watch it
 * think" panel.
 *
 * Investigation runs are system-authored (userId = null) and are therefore
 * hidden by the per-user privacy pin on the generic AIRun / AIRunEvent CRUD. So
 * we gate access explicitly here: first confirm the caller can read the incident
 * under THEIR permissions, then read the run + events as root.
 */
router.post(
  "/ai-investigation/incident",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!props.userId) {
        throw new NotAuthorizedException(
          "A logged-in user session is required.",
        );
      }

      const incidentIdString: string | undefined = req.body["incidentId"] as
        | string
        | undefined;

      if (!incidentIdString) {
        throw new BadDataException("incidentId is required.");
      }

      const incidentId: ObjectID = new ObjectID(incidentIdString);

      // Access check under the USER's permissions (null when not allowed).
      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentId,
        select: { _id: true },
        props,
      });

      if (!incident) {
        throw new BadDataException(
          "Incident not found (or you do not have access to it).",
        );
      }

      // Read the latest investigation run as root (bypasses the per-user pin).
      const runs: Array<AIRun> = await AIRunService.findBy({
        query: {
          triggeredByIncidentId: incidentId,
          runType: AIRunType.Investigation,
        },
        select: {
          _id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          errorMessage: true,
          llmCallCount: true,
          toolCallCount: true,
          totalTokens: true,
          createdAt: true,
        },
        sort: { createdAt: SortOrder.Descending },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });

      const run: AIRun | undefined = runs[0];

      if (!run) {
        Response.sendJsonObjectResponse(req, res, {
          run: null,
          events: [],
        });
        return;
      }

      const events: Array<AIRunEvent> = await AIRunEventService.findBy({
        query: { aiRunId: run.id! },
        select: {
          _id: true,
          sequence: true,
          eventType: true,
          toolName: true,
          resultSummary: true,
          createdAt: true,
        },
        sort: { sequence: SortOrder.Ascending },
        limit: MAX_EVENTS,
        skip: 0,
        props: { isRoot: true },
      });

      const runJson: JSONObject | undefined = BaseModel.toJSONArray(
        [run],
        AIRun,
      )[0];

      const eventsJson: JSONArray = BaseModel.toJSONArray(events, AIRunEvent);

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
