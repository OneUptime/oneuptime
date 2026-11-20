import SecurityPlaybookRun from "../../Models/DatabaseModels/SecurityPlaybookRun";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { SecurityPlaybookApprovalDecision, SecurityPlaybookTarget } from "../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import ProductKey from "../../Types/Product/ProductKey";
import UserMiddleware from "../Middleware/UserAuthorization";
import SecurityPlaybookRunService, {
  Service as SecurityPlaybookRunServiceType,
} from "../Services/SecurityPlaybookRunService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecurityPlaybookRunDecision, {
  APPROVAL_CHANGED_MESSAGE,
  RUN_CHANGE_REFUSED_MESSAGE,
  RUN_NOT_FOUND_MESSAGE,
  SELF_APPROVAL_REFUSED_MESSAGE,
  SecurityPlaybookApprovalChangedException,
} from "../Utils/SecurityPlaybook/SecurityPlaybookRunDecision";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

// The longest comment an approval keeps.
export const APPROVAL_COMMENT_MAX_LENGTH: number = 2000;

/*
 * What a decision or an undo is refused with, and the decision a chat's
 * stale message refuses (SecurityPlaybookRunDecision), as callers of these
 * routes read them.
 */
export {
  APPROVAL_CHANGED_MESSAGE,
  RUN_CHANGE_REFUSED_MESSAGE,
  RUN_NOT_FOUND_MESSAGE,
  SELF_APPROVAL_REFUSED_MESSAGE,
  SecurityPlaybookApprovalChangedException,
};

function readBody(req: ExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

/*
 * What a person does to a run besides cancelling it, beside its CRUD:
 *
 *   POST /security-playbook-run/:runId/approve   { comment?, targets? }
 *   POST /security-playbook-run/:runId/reject    { comment? }
 *   POST /security-playbook-run/:runId/undo      { stepId, value }
 *
 * A step marked "needs approval" - every containment step, unless a
 * Security Admin let it run without - holds its run in Waiting for Approval
 * until a person decides. Deciding is moving a run along, so it takes the
 * run's update permission (the Member tier and up, or Approve Security
 * Playbook Steps), held to this run as an update of it is (readRun), and
 * approving takes someone other than the person who started the run: a run
 * a person started is approved by a second one. An approver of a step that
 * acts on users or hosts sees its targets and may leave any out (`targets`:
 * the values kept); they cannot add one.
 *
 * The decision is recorded on the step - who, when, what they said and
 * which targets they kept - on the case's timeline and in the project's
 * audit log, and the run moves on in one compare-and-set from Waiting for
 * Approval, so two people clicking at once decide once. Approving queues
 * the run, which carries on from that step; rejecting ends it.
 *
 * Undo releases one target a containment step contained - unsuspends the
 * account, lifts the containment, releases the device - through the step's
 * own connection, and marks it Undone on the step, once the run is not
 * running, for someone who may change the run as a decision takes. Recorded
 * the same way.
 */
export default class SecurityPlaybookRunAPI extends BaseAPI<
  SecurityPlaybookRun,
  SecurityPlaybookRunServiceType
> {
  public constructor() {
    super(SecurityPlaybookRun, SecurityPlaybookRunService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    for (const decision of [
      SecurityPlaybookApprovalDecision.Approved,
      SecurityPlaybookApprovalDecision.Rejected,
    ]) {
      this.router.post(
        `${basePath}/:runId/${decision === SecurityPlaybookApprovalDecision.Approved ? "approve" : "reject"}`,
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
        ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
        async (
          req: ExpressRequest,
          res: ExpressResponse,
          next: NextFunction,
        ) => {
          try {
            const { props, projectId, runId } =
              await SecurityPlaybookRunAPI.readCaller(req, {
                errorMessage:
                  "Approving or rejecting a playbook step takes a role that can run playbooks.",
              });

            const body: JSONObject = readBody(req);
            const commentValue: JSONValue | undefined = body["comment"];
            const comment: string =
              typeof commentValue === "string"
                ? commentValue.trim().slice(0, APPROVAL_COMMENT_MAX_LENGTH)
                : "";

            await SecurityPlaybookRunAPI.decide({
              projectId,
              runId,
              decision,
              props,
              comment,
              targets: SecurityPlaybookRunAPI.readTargetsBody(body["targets"]),
            });

            return Response.sendJsonObjectResponse(req, res, {
              runId: runId.toString(),
              decision,
            });
          } catch (error) {
            next(error);
          }
        },
      );
    }

    this.router.post(
      `${basePath}/:runId/undo`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const { props, projectId, runId } =
            await SecurityPlaybookRunAPI.readCaller(req, {
              errorMessage:
                "Undoing a containment step takes a role that can run playbooks.",
            });

          const body: JSONObject = readBody(req);

          const target: SecurityPlaybookTarget =
            await SecurityPlaybookRunAPI.undoTarget({
              projectId,
              runId,
              stepId: typeof body["stepId"] === "string" ? body["stepId"] : "",
              value: typeof body["value"] === "string" ? body["value"] : "",
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            runId: runId.toString(),
            value: target.value,
            state: target.state,
            detail: target.detail || "",
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  private static async readCaller(
    req: ExpressRequest,
    options: { errorMessage: string },
  ): Promise<{
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    runId: ObjectID;
  }> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID =
      CommonAPI.assertAuthenticatedProjectMember(props);

    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: new SecurityPlaybookRun().getUpdatePermissions(),
      errorMessage: options.errorMessage,
    });

    const runId: string | undefined = req.params["runId"];

    if (!runId || !ObjectID.isValidUUID(runId)) {
      throw new BadDataException("A valid run ID is required.");
    }

    return { props, projectId, runId: new ObjectID(runId) };
  }

  // The targets an approval keeps: undefined when the request names none.
  public static readTargetsBody(
    value: JSONValue | undefined,
  ): Array<string> | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (
      !Array.isArray(value) ||
      value.some((item: JSONValue): boolean => {
        return typeof item !== "string";
      })
    ) {
      throw new BadDataException(
        "targets must be a list of the step's targets to act on.",
      );
    }

    return value as Array<string>;
  }

  /*
   * Decides on the step a run waits on, as `props` (SecurityPlaybookRunDecision).
   */
  public static async decide(
    data: Parameters<typeof SecurityPlaybookRunDecision.decide>[0],
  ): Promise<void> {
    await SecurityPlaybookRunDecision.decide(data);
  }

  // Undoes one target a containment step contained (SecurityPlaybookRunDecision).
  public static async undoTarget(
    data: Parameters<typeof SecurityPlaybookRunDecision.undoTarget>[0],
  ): Promise<SecurityPlaybookTarget> {
    return await SecurityPlaybookRunDecision.undoTarget(data);
  }
}
