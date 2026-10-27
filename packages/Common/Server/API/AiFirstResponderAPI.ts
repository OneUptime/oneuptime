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
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import Alert from "../../Models/DatabaseModels/Alert";
import Incident from "../../Models/DatabaseModels/Incident";
import OnCallDutyPolicyExecutionLog from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import AlertService from "../Services/AlertService";
import IncidentService from "../Services/IncidentService";
import AiFirstResponder from "../Utils/AI/FirstResponder/AiFirstResponder";
import CallerPermission from "../Utils/Permission/CallerPermission";

/*
 * PAGE NOW: a person does not want to wait for OneUptime AI.
 *
 * The pages AI holds for an alert or incident while it works
 * (OnCallPolicyAiHold) start at once, saying who asked
 * (AiFirstResponder.pageNow). It pages the people its policies would have
 * paged when the hold ran out, so it takes what paging a policy by hand
 * takes: the create permission of an on-call policy's execution log - and
 * the record, read as the person may see it, so another project's id is
 * refused like one that does not exist.
 *
 *   POST /ai-first-responder/page-now  { incidentId } or { alertId }
 *   -> { startedRuns: 1 }
 */
const router: ExpressRouter = Express.getRouter();

export const PAGE_NOW_REFUSED_MESSAGE: string =
  "You need permission to page on-call policies to page now.";

router.post(
  "/ai-first-responder/page-now",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      CommonAPI.assertAuthenticatedUser(props);

      const incidentIdText: unknown = req.body["incidentId"];
      const alertIdText: unknown = req.body["alertId"];

      if (
        (typeof incidentIdText !== "string" || !incidentIdText) ===
        (typeof alertIdText !== "string" || !alertIdText)
      ) {
        throw new BadDataException("Send one of incidentId or alertId.");
      }

      let projectId: ObjectID | undefined = undefined;
      let incidentId: ObjectID | undefined = undefined;
      let alertId: ObjectID | undefined = undefined;

      if (typeof incidentIdText === "string" && incidentIdText) {
        const incident: Incident | null = await IncidentService.findOneById({
          id: new ObjectID(incidentIdText),
          select: { _id: true, projectId: true },
          props: props,
        });

        if (!incident?.id || !incident.projectId) {
          throw new BadDataException(
            "Incident not found (or you do not have access to it).",
          );
        }

        incidentId = incident.id;
        projectId = incident.projectId;
      } else {
        const alert: Alert | null = await AlertService.findOneById({
          id: new ObjectID(alertIdText as string),
          select: { _id: true, projectId: true },
          props: props,
        });

        if (!alert?.id || !alert.projectId) {
          throw new BadDataException(
            "Alert not found (or you do not have access to it).",
          );
        }

        alertId = alert.id;
        projectId = alert.projectId;
      }

      if (
        !CallerPermission.holdsAnyOf(
          props,
          new OnCallDutyPolicyExecutionLog().getCreatePermissions(),
          { projectId: projectId },
        )
      ) {
        throw new NotAuthorizedException(PAGE_NOW_REFUSED_MESSAGE);
      }

      const startedRuns: number = await AiFirstResponder.pageNow({
        projectId: projectId,
        incidentId: incidentId,
        alertId: alertId,
        userId: props.userId,
      });

      Response.sendJsonObjectResponse(req, res, {
        startedRuns: startedRuns,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
