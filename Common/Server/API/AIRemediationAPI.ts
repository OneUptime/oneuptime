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
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import AIRemediationActionStatus from "../../Types/AI/AIRemediationActionStatus";
import AIRemediationAction from "../../Models/DatabaseModels/AIRemediationAction";
import Incident from "../../Models/DatabaseModels/Incident";
import Alert from "../../Models/DatabaseModels/Alert";
import IncidentService from "../Services/IncidentService";
import AlertService from "../Services/AlertService";
import AIRemediationActionService from "../Services/AIRemediationActionService";
import RemediationExecutor, {
  RemediationExecutionResult,
} from "../Utils/AI/SRE/RemediationExecutor";

const router: ExpressRouter = Express.getRouter();

/*
 * Approve / reject endpoints for AI-proposed remediation actions.
 *
 * The action rows are server-authored (empty create/update table
 * permissions), so the ONLY write paths for the human decision are these two
 * endpoints. Both follow the AIInvestigationAPI idiom: a logged-in session
 * is required, the action row is loaded as root (it carries no user pin),
 * and then the linked incident/alert is ACCESS-CHECKED under the USER's
 * permissions — a user who cannot read the subject cannot act on its
 * remediations. Approve funnels into RemediationExecutor.approveAndExecute
 * (the single execute path with its CAS transitions and budget checks);
 * reject is a CAS Proposed→Rejected so it can never race an execution.
 */

// rejectionReason is LongText (500 chars) — trim and cap what we store.
const MAX_REJECTION_REASON_CHARS: number = 500;

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
 * Load the action as root and access-check its subject under the USER's
 * permissions. Returns the action; throws when it is missing or the caller
 * may not see the linked incident/alert.
 */
async function loadActionWithSubjectAccessCheck(
  req: ExpressRequest,
  props: DatabaseCommonInteractionProps,
): Promise<AIRemediationAction> {
  const actionIdString: string | undefined = req.body[
    "aiRemediationActionId"
  ] as string | undefined;

  if (!actionIdString) {
    throw new BadDataException("aiRemediationActionId is required.");
  }

  const actionId: ObjectID = new ObjectID(actionIdString);

  const action: AIRemediationAction | null =
    await AIRemediationActionService.findOneById({
      id: actionId,
      select: {
        _id: true,
        projectId: true,
        incidentId: true,
        alertId: true,
      },
      props: { isRoot: true },
    });

  if (!action) {
    throw new NotFoundException("Remediation action not found.");
  }

  // Access check under the USER's permissions (null when not allowed).
  if (action.incidentId) {
    const incident: Incident | null = await IncidentService.findOneById({
      id: action.incidentId,
      select: { _id: true },
      props,
    });

    if (!incident) {
      throw new BadDataException(
        "Incident not found (or you do not have access to it).",
      );
    }
  } else if (action.alertId) {
    const alert: Alert | null = await AlertService.findOneById({
      id: action.alertId,
      select: { _id: true },
      props,
    });

    if (!alert) {
      throw new BadDataException(
        "Alert not found (or you do not have access to it).",
      );
    }
  } else {
    // An action with no subject is malformed — nobody can act on it.
    throw new BadDataException(
      "This remediation action is not linked to an incident or alert.",
    );
  }

  return action;
}

/*
 * Approve: funnel into the executor's single execute path. Refusals (lost
 * CAS, expired, budget exhausted, lane disabled) surface as 400 with the
 * executor's human-readable reason.
 * Body: { aiRemediationActionId }. Response: { ok: true }.
 */
router.post(
  "/ai-remediation/approve",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const action: AIRemediationAction =
        await loadActionWithSubjectAccessCheck(req, props);

      const result: RemediationExecutionResult =
        await RemediationExecutor.approveAndExecute({
          actionId: new ObjectID(action._id!),
          byUserId: props.userId!,
        });

      if (!result.ok) {
        throw new BadDataException(
          result.refusalReason || "This action could not be executed.",
        );
      }

      Response.sendJsonObjectResponse(req, res, { ok: true });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * Reject: CAS Proposed→Rejected with the decider's identity and optional
 * reason. Losing the CAS means the action was already decided (approved,
 * expired, or rejected by someone else) — surfaced as 400.
 * Body: { aiRemediationActionId, reason? }. Response: { ok: true }.
 */
router.post(
  "/ai-remediation/reject",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const action: AIRemediationAction =
        await loadActionWithSubjectAccessCheck(req, props);

      const rawReason: string | undefined = req.body["reason"] as
        | string
        | undefined;

      const rejectionReason: string | undefined =
        typeof rawReason === "string" && rawReason.trim()
          ? rawReason.trim().substring(0, MAX_REJECTION_REASON_CHARS)
          : undefined;

      const rejectedCount: number =
        await AIRemediationActionService.attemptStatusTransition({
          actionId: new ObjectID(action._id!),
          fromStatus: AIRemediationActionStatus.Proposed,
          set: {
            status: AIRemediationActionStatus.Rejected,
            rejectedByUserId: props.userId!,
            rejectedAt: OneUptimeDate.getCurrentDate(),
            ...(rejectionReason ? { rejectionReason } : {}),
          },
        });

      if (rejectedCount === 0) {
        throw new BadDataException(
          "This action is no longer pending — it was already approved, rejected, or expired.",
        );
      }

      Response.sendJsonObjectResponse(req, res, { ok: true });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
