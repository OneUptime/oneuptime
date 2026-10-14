import SecurityPlaybookRun from "../../Models/DatabaseModels/SecurityPlaybookRun";
import { SecurityCaseFeedEventType } from "../../Models/DatabaseModels/SecurityCaseFeed";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Green500, Red500 } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
  readStepResults,
} from "../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { approvalDecidedMarkdown } from "../../Utils/SecurityCase/SecurityCaseMarkdown";
import FeedMarkdown from "../../Utils/Markdown/FeedMarkdown";
import UserMiddleware from "../Middleware/UserAuthorization";
import SecurityCaseFeedService from "../Services/SecurityCaseFeedService";
import SecurityPlaybookRunService, {
  Service as SecurityPlaybookRunServiceType,
} from "../Services/SecurityPlaybookRunService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import Response from "../Utils/Response";
import SecurityPlaybookEngine, {
  getStepTitle,
} from "../Utils/SecurityPlaybook/SecurityPlaybookEngine";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import PartialEntity from "../../Types/Database/PartialEntity";

// The longest comment an approval keeps.
export const APPROVAL_COMMENT_MAX_LENGTH: number = 2000;

/*
 * A step marked "needs approval" holds its run in Waiting for Approval until
 * a person decides, here:
 *
 *   POST /security-playbook-run/:runId/approve   { comment? }
 *   POST /security-playbook-run/:runId/reject    { comment? }
 *
 * Deciding is moving a run along, so it takes the run's update permission
 * (the Member tier and up, or Approve Security Playbook Steps). The decision
 * is recorded on the step - who, when, and what they said - and the run
 * moves on in one compare-and-set from Waiting for Approval, so two people
 * clicking at once decide once. Approving queues the run, which carries on
 * from that step; rejecting ends it.
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
        async (
          req: ExpressRequest,
          res: ExpressResponse,
          next: NextFunction,
        ) => {
          try {
            const props: DatabaseCommonInteractionProps =
              await CommonAPI.getDatabaseCommonInteractionProps(req);
            const projectId: ObjectID =
              CommonAPI.assertAuthenticatedProjectMember(props);

            CommonAPI.assertPermittedInProject({
              databaseProps: props,
              allowedPermissions:
                new SecurityPlaybookRun().getUpdatePermissions(),
              errorMessage:
                "Approving or rejecting a playbook step takes a role that can run playbooks.",
            });

            const runId: string | undefined = req.params["runId"];

            if (!runId || !ObjectID.isValidUUID(runId)) {
              throw new BadDataException("A valid run ID is required.");
            }

            const body: JSONObject =
              req.body &&
              typeof req.body === "object" &&
              !Array.isArray(req.body)
                ? (req.body as JSONObject)
                : {};
            const commentValue: JSONValue | undefined = body["comment"];
            const comment: string =
              typeof commentValue === "string"
                ? commentValue.trim().slice(0, APPROVAL_COMMENT_MAX_LENGTH)
                : "";

            await SecurityPlaybookRunAPI.decide({
              projectId,
              runId: new ObjectID(runId),
              decision,
              props,
              comment,
            });

            return Response.sendJsonObjectResponse(req, res, {
              runId,
              decision,
            });
          } catch (error) {
            next(error);
          }
        },
      );
    }
  }

  public static async decide(data: {
    projectId: ObjectID;
    runId: ObjectID;
    decision: SecurityPlaybookApprovalDecision;
    props: DatabaseCommonInteractionProps;
    comment?: string | undefined;
  }): Promise<void> {
    // Read with the caller's props: a run on a case they cannot read is not found.
    const run: SecurityPlaybookRun | null =
      await SecurityPlaybookRunService.findOneBy({
        query: {
          _id: data.runId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          projectId: true,
          securityCaseId: true,
          playbookName: true,
          status: true,
          steps: true,
          stepResults: true,
          currentStepIndex: true,
        },
        props: data.props,
      });

    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: run?.projectId,
      projectId: data.projectId,
    });

    if (run!.status !== SecurityPlaybookRunStatus.WaitingForApproval) {
      throw new BadDataException(
        "This run is not waiting for an approval: somebody may have decided already.",
      );
    }

    const steps: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps(
      run!.steps,
    );
    const results: Array<SecurityPlaybookStepResult> = readStepResults(
      run!.stepResults,
      steps,
    );
    const index: number = run!.currentStepIndex || 0;
    const step: SecurityPlaybookStep | undefined = steps[index];

    if (!step || !results[index]) {
      throw new BadDataException("The step waiting for approval is missing.");
    }

    const isApproved: boolean =
      data.decision === SecurityPlaybookApprovalDecision.Approved;
    const now: Date = OneUptimeDate.getCurrentDate();

    results[index] = {
      ...results[index]!,
      status: isApproved
        ? SecurityPlaybookStepStatus.Pending
        : SecurityPlaybookStepStatus.Rejected,
      ...(isApproved ? {} : { completedAt: now.toISOString() }),
      approval: {
        decision: data.decision,
        decidedByUserId: data.props.userId?.toString() || "",
        decidedAt: now.toISOString(),
        ...(data.comment ? { comment: data.comment } : {}),
      },
    };

    const update: PartialEntity<SecurityPlaybookRun> = {
      status: isApproved
        ? SecurityPlaybookRunStatus.Queued
        : SecurityPlaybookRunStatus.Cancelled,
      stepResults: results as unknown as NonNullable<
        PartialEntity<SecurityPlaybookRun>["stepResults"]
      >,
    };

    if (!isApproved) {
      update.completedAt = now;
    }

    const isDecided: boolean =
      await SecurityPlaybookRunService.compareAndSetColumnsByIdWithoutHooks({
        id: data.runId,
        data: update,
        expectedData: {
          status: SecurityPlaybookRunStatus.WaitingForApproval,
        },
      });

    if (!isDecided) {
      throw new BadDataException(
        "Somebody decided on this step a moment ago. Refresh to see what they chose.",
      );
    }

    if (run!.securityCaseId) {
      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: data.projectId,
        securityCaseId: run!.securityCaseId,
        feedInfoInMarkdown: approvalDecidedMarkdown({
          playbookName: run!.playbookName || "",
          stepNumber: index + 1,
          stepTitle: getStepTitle(step),
          isApproved,
        }).toString(),
        moreInformationInMarkdown: data.comment
          ? FeedMarkdown.multilineText(data.comment).toString()
          : undefined,
        eventType: SecurityCaseFeedEventType.ApprovalDecided,
        displayColor: isApproved ? Green500 : Red500,
        userId: data.props.userId,
      });
    }

    if (isApproved) {
      try {
        await SecurityPlaybookEngine.enqueueRun(data.runId);
      } catch (error) {
        // The recovery sweep queues it again within a couple of minutes.
        logger.error(
          `SecurityPlaybookRunAPI: could not queue run ${data.runId.toString()} after its approval:`,
        );
        logger.error(error);
      }
    }
  }
}
