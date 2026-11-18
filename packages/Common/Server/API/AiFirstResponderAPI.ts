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
import PrivateRecordWriteCheck from "../Utils/Permission/PrivateRecordWriteCheck";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import DatabaseService from "../Services/DatabaseService";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import ProductsOfRequest from "../Utils/ServerProducts/ProductsOfRequest";
import ProductKey from "../../Types/Product/ProductKey";

/*
 * PAGE NOW: a person does not want to wait for OneUptime AI.
 *
 * The pages AI holds for an alert or incident while it works
 * (OnCallPolicyAiHold) start at once, saying who asked
 * (AiFirstResponder.pageNow). It pages the people its policies would have
 * paged when the hold ran out, so it takes what paging a policy by hand
 * takes: the create permission of an on-call policy's execution log - and
 * the record, read as the person may see it, so another project's id is
 * refused like one that does not exist. On a private incident or alert, that
 * permission counts only through the teams that own it, as a person named
 * its owner, or as a Project Owner or Admin (#8913): a member whose team
 * that owns it may only view it is refused, saying why, and nobody is paged.
 *
 *   POST /ai-first-responder/page-now  { incidentId } or { alertId }
 *   -> { startedRuns: 1 }
 *
 * Paging starts On-Call's policies for the record: refused while the server
 * has On-Call, or the record's own product, switched off (#9489).
 */
const router: ExpressRouter = Express.getRouter();

export const PAGE_NOW_REFUSED_MESSAGE: string =
  "You need permission to page on-call policies to page now.";

// Completes "You do not have permission to ..." for a private record.
export const PAGE_NOW_ACTION: string = "page now";

router.post(
  "/ai-first-responder/page-now",
  UserMiddleware.getUserMiddleware,
  ServerProductRoutes.refuseWhileOff(ProductKey.OnCall),
  ServerProductRoutes.refuseWhileOffFor(ProductsOfRequest.incidentOrAlert),
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
      // The record as the person read it, whether it is private with it.
      let record: Incident | Alert | null = null;

      if (typeof incidentIdText === "string" && incidentIdText) {
        const incident: Incident | null = await IncidentService.findOneById({
          id: new ObjectID(incidentIdText),
          select: { _id: true, projectId: true, isPrivate: true },
          props: props,
        });

        if (!incident?.id || !incident.projectId) {
          throw new BadDataException(
            "Incident not found (or you do not have access to it).",
          );
        }

        incidentId = incident.id;
        projectId = incident.projectId;
        record = incident;
      } else {
        const alert: Alert | null = await AlertService.findOneById({
          id: new ObjectID(alertIdText as string),
          select: { _id: true, projectId: true, isPrivate: true },
          props: props,
        });

        if (!alert?.id || !alert.projectId) {
          throw new BadDataException(
            "Alert not found (or you do not have access to it).",
          );
        }

        alertId = alert.id;
        projectId = alert.projectId;
        record = alert;
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

      // A private record, only through the teams that own it. See the top.
      await PrivateRecordWriteCheck.assertReaches({
        modelType: OnCallDutyPolicyExecutionLog,
        type: DatabaseRequestType.Create,
        recordService: (incidentId
          ? IncidentService
          : AlertService) as unknown as DatabaseService<DatabaseBaseModel>,
        recordId: (incidentId || alertId)!,
        props: props,
        action: PAGE_NOW_ACTION,
        // Read as not private: nothing more to ask.
        readRecord: record || undefined,
      });

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
