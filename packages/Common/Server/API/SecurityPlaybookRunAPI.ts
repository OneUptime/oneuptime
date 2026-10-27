import SecurityCase from "../../Models/DatabaseModels/SecurityCase";
import SecurityEventConnection from "../../Models/DatabaseModels/SecurityEventConnection";
import SecurityPlaybookRun from "../../Models/DatabaseModels/SecurityPlaybookRun";
import { SecurityCaseFeedEventType } from "../../Models/DatabaseModels/SecurityCaseFeed";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Green500, Red500 } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONArray, JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { securityEntityKey } from "../../Types/SecurityCase/SecurityEntity";
import {
  SecurityPlaybookActionDefinition,
  getSecurityPlaybookUndoAction,
} from "../../Types/SecurityPlaybook/SecurityPlaybookAction";
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
  SecurityPlaybookTarget,
  SecurityPlaybookTargetState,
  wasContainedByStep,
  readStepResults,
} from "../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import {
  approvalDecidedMarkdown,
  targetUndoneMarkdown,
} from "../../Utils/SecurityCase/SecurityCaseMarkdown";
import FeedMarkdown from "../../Utils/Markdown/FeedMarkdown";
import UserMiddleware from "../Middleware/UserAuthorization";
import AuditLogService from "../Services/AuditLogService";
import SecurityCaseFeedService from "../Services/SecurityCaseFeedService";
import SecurityCaseService from "../Services/SecurityCaseService";
import SecurityEventConnectionService from "../Services/SecurityEventConnectionService";
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
import SecurityPlaybookContainment, {
  ContainmentTargetOutcome,
} from "../Utils/SecurityPlaybook/SecurityPlaybookContainment";
import SecurityPlaybookEngine, {
  getStepTitle,
} from "../Utils/SecurityPlaybook/SecurityPlaybookEngine";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import PartialEntity from "../../Types/Database/PartialEntity";

// The longest comment an approval keeps.
export const APPROVAL_COMMENT_MAX_LENGTH: number = 2000;

// How often an undo's write is tried again when the run changed under it.
const UNDO_WRITE_ATTEMPTS: number = 3;

export const SELF_APPROVAL_REFUSED_MESSAGE: string =
  "You started this run, so someone else must approve its steps.";

export const RUN_NOT_FOUND_MESSAGE: string = "Playbook run not found.";

export const RUN_CHANGE_REFUSED_MESSAGE: string =
  "You do not have permission to approve, reject or undo the steps of this playbook run.";

const RUN_SELECT: {
  _id: true;
  projectId: true;
  securityCaseId: true;
  securityPlaybookId: true;
  playbookName: true;
  status: true;
  steps: true;
  stepResults: true;
  currentStepIndex: true;
  triggeredByUserId: true;
} = {
  _id: true,
  projectId: true,
  securityCaseId: true,
  securityPlaybookId: true,
  playbookName: true,
  status: true,
  steps: true,
  stepResults: true,
  currentStepIndex: true,
  triggeredByUserId: true,
};

type StoredStepResults = NonNullable<
  PartialEntity<SecurityPlaybookRun>["stepResults"]
>;

// A run's step results as read, for a compare-and-set to expect them unchanged.
function storedStepResults(
  value: JSONArray | undefined,
): StoredStepResults | null {
  return (value || null) as unknown as StoredStepResults | null;
}

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
   * The run as the caller may change it. Approving, rejecting and undoing
   * are changes of the run that OneUptime writes once they are allowed, so
   * they are held to what an update of this run would be held to
   * (DatabaseService.findOneUpdatableById): the run's update permissions in
   * the caller's project, a team's block on them, the Owned scope through
   * its case, and a credential that may make changes. A run the caller may
   * not read is not found; one they may read but not change is refused, and
   * nothing is decided, undone or written.
   */
  private static async readRun(data: {
    projectId: ObjectID;
    runId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityPlaybookRun> {
    const run: SecurityPlaybookRun | null =
      await SecurityPlaybookRunService.findOneUpdatableById({
        id: data.runId,
        select: RUN_SELECT,
        props: data.props,
      });

    if (!run) {
      const refusal: Exception =
        await SecurityPlaybookRunService.getUnwrittenByIdError({
          id: data.runId,
          props: data.props,
          type: DatabaseRequestType.Update,
        });

      if (refusal instanceof NotFoundException) {
        throw new NotFoundException(RUN_NOT_FOUND_MESSAGE);
      }

      throw new NotAuthorizedException(RUN_CHANGE_REFUSED_MESSAGE);
    }

    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: run.projectId,
      projectId: data.projectId,
    });

    return run;
  }

  public static async decide(data: {
    projectId: ObjectID;
    runId: ObjectID;
    decision: SecurityPlaybookApprovalDecision;
    props: DatabaseCommonInteractionProps;
    comment?: string | undefined;
    /*
     * For a step that acts on users or hosts, approved: the targets kept
     * ticked. Every target of the step when the request names none.
     */
    targets?: Array<string> | undefined;
  }): Promise<void> {
    const run: SecurityPlaybookRun = await this.readRun(data);

    if (run.status !== SecurityPlaybookRunStatus.WaitingForApproval) {
      throw new BadDataException(
        "This run is not waiting for an approval: somebody may have decided already.",
      );
    }

    const isApproved: boolean =
      data.decision === SecurityPlaybookApprovalDecision.Approved;

    if (
      isApproved &&
      run.triggeredByUserId &&
      (!data.props.userId ||
        data.props.userId.toString() === run.triggeredByUserId.toString())
    ) {
      throw new BadDataException(SELF_APPROVAL_REFUSED_MESSAGE);
    }

    const steps: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps(
      run.steps,
    );
    const results: Array<SecurityPlaybookStepResult> = readStepResults(
      run.stepResults,
      steps,
    );
    const index: number = run.currentStepIndex || 0;
    const step: SecurityPlaybookStep | undefined = steps[index];

    if (!step || !results[index]) {
      throw new BadDataException("The step waiting for approval is missing.");
    }

    const targets: Array<SecurityPlaybookTarget> | undefined = isApproved
      ? this.keepTargets({
          targets: results[index]!.targets,
          kept: data.targets,
        })
      : results[index]!.targets;
    const kept: Array<string> = this.valuesIn(
      targets,
      SecurityPlaybookTargetState.Proposed,
    );
    const leftOut: Array<string> = this.valuesIn(
      targets,
      SecurityPlaybookTargetState.LeftOut,
    );
    const now: Date = OneUptimeDate.getCurrentDate();

    results[index] = {
      ...results[index]!,
      status: isApproved
        ? SecurityPlaybookStepStatus.Pending
        : SecurityPlaybookStepStatus.Rejected,
      ...(isApproved ? {} : { completedAt: now.toISOString() }),
      ...(targets ? { targets } : {}),
      approval: {
        decision: data.decision,
        decidedByUserId: data.props.userId?.toString() || "",
        decidedAt: now.toISOString(),
        ...(data.comment ? { comment: data.comment } : {}),
        ...(isApproved && targets ? { targets: kept } : {}),
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

    /*
     * The step results are part of the compare: an undo written while the
     * run waited is never written over with the copy read here.
     */
    const isDecided: boolean =
      await SecurityPlaybookRunService.compareAndSetColumnsByIdWithoutHooks({
        id: data.runId,
        data: update,
        expectedData: {
          status: SecurityPlaybookRunStatus.WaitingForApproval,
          stepResults: storedStepResults(run.stepResults),
        },
      });

    if (!isDecided) {
      throw new BadDataException(
        "Somebody decided on this step a moment ago. Refresh to see what they chose.",
      );
    }

    await this.recordInAuditLog({
      run,
      updatedFields: {
        status: update.status as string,
        stepResults: results as unknown as JSONArray,
      },
      props: data.props,
    });

    if (run.securityCaseId) {
      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: data.projectId,
        securityCaseId: run.securityCaseId,
        feedInfoInMarkdown: approvalDecidedMarkdown({
          playbookName: run.playbookName || "",
          stepNumber: index + 1,
          stepTitle: getStepTitle(step),
          isApproved,
          targets: isApproved ? kept : undefined,
          leftOut: isApproved ? leftOut : undefined,
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

  /*
   * The step's targets as the approver left them: a target not kept is
   * Left Out. An approver only leaves targets out - one the rule did not
   * pick, or a protected one, is refused - and keeps at least one.
   */
  private static keepTargets(data: {
    targets: Array<SecurityPlaybookTarget> | undefined;
    kept: Array<string> | undefined;
  }): Array<SecurityPlaybookTarget> | undefined {
    if (!data.targets || data.kept === undefined) {
      return data.targets;
    }

    const proposed: Array<SecurityPlaybookTarget> = data.targets.filter(
      (target: SecurityPlaybookTarget): boolean => {
        return target.state === SecurityPlaybookTargetState.Proposed;
      },
    );

    if (proposed.length === 0) {
      return data.targets;
    }

    const wanted: Set<string> = new Set(
      data.kept
        .map((value: string): string => {
          return value.trim().toLowerCase();
        })
        .filter((value: string): boolean => {
          return Boolean(value);
        }),
    );

    for (const value of wanted) {
      const isProposed: boolean = proposed.some(
        (target: SecurityPlaybookTarget): boolean => {
          return securityEntityKey(target) === value;
        },
      );

      if (!isProposed) {
        throw new BadDataException(
          `"${value}" is not one of this step's targets. An approver can leave targets out, never add one.`,
        );
      }
    }

    if (wanted.size === 0) {
      throw new BadDataException(
        "Keep at least one target to approve the step, or reject it.",
      );
    }

    return data.targets.map(
      (target: SecurityPlaybookTarget): SecurityPlaybookTarget => {
        return target.state === SecurityPlaybookTargetState.Proposed &&
          !wanted.has(securityEntityKey(target))
          ? { ...target, state: SecurityPlaybookTargetState.LeftOut }
          : target;
      },
    );
  }

  private static valuesIn(
    targets: Array<SecurityPlaybookTarget> | undefined,
    state: SecurityPlaybookTargetState,
  ): Array<string> {
    return (targets || [])
      .filter((target: SecurityPlaybookTarget): boolean => {
        return target.state === state;
      })
      .map((target: SecurityPlaybookTarget): string => {
        return target.value;
      });
  }

  public static async undoTarget(data: {
    projectId: ObjectID;
    runId: ObjectID;
    stepId: string;
    value: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityPlaybookTarget> {
    const run: SecurityPlaybookRun = await this.readRun(data);

    if (
      run.status === SecurityPlaybookRunStatus.Queued ||
      run.status === SecurityPlaybookRunStatus.Running
    ) {
      throw new BadDataException(
        "This run is still running. Undo a step once it has stopped.",
      );
    }

    const steps: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps(
      run.steps,
    );
    const index: number = steps.findIndex(
      (candidate: SecurityPlaybookStep): boolean => {
        return candidate.id === data.stepId;
      },
    );
    const step: SecurityPlaybookStep | undefined = steps[index];

    if (!step) {
      throw new BadDataException("That step is not part of this run.");
    }

    const undo: SecurityPlaybookActionDefinition | undefined =
      getSecurityPlaybookUndoAction(step.action);

    if (!undo) {
      throw new BadDataException(
        `Nothing undoes "${getStepTitle(step)}": what it did cannot be taken back.`,
      );
    }

    const wanted: string = data.value.trim().toLowerCase();
    const target: SecurityPlaybookTarget | undefined = readStepResults(
      run.stepResults,
      steps,
    )[index]?.targets?.find((candidate: SecurityPlaybookTarget): boolean => {
      return securityEntityKey(candidate) === wanted;
    });

    if (!wanted || !target) {
      throw new BadDataException(
        "That user or host is not a target of this step.",
      );
    }

    if (target.state === SecurityPlaybookTargetState.Undone) {
      throw new BadDataException(
        `${target.value} was already released: ${target.detail || "undone"}.`,
      );
    }

    if (!wasContainedByStep(target)) {
      throw new BadDataException(
        `The step did not contain ${target.value}, so there is nothing of its to undo.`,
      );
    }

    const connectionId: JSONValue | undefined = step.config["connectionId"];
    const connection: SecurityEventConnection | null =
      typeof connectionId === "string"
        ? await SecurityEventConnectionService.findOneBy({
            query: {
              _id: connectionId,
              projectId: data.projectId,
            },
            select: {
              _id: true,
              name: true,
              provider: true,
              config: true,
              secrets: true,
              alertingOnly: true,
            },
            props: { isRoot: true },
          })
        : null;

    if (!connection) {
      throw new BadDataException(
        "The connection this step acted through no longer exists. Release it in the product itself.",
      );
    }

    const securityCase: SecurityCase | null = run.securityCaseId
      ? await SecurityCaseService.findOneById({
          id: run.securityCaseId,
          select: { caseNumberWithPrefix: true },
          props: { isRoot: true },
        })
      : null;

    let outcome: ContainmentTargetOutcome;

    try {
      outcome = await SecurityPlaybookContainment.undo({
        action: step.action,
        connection,
        settings:
          await SecurityEventConnectionService.getConnectorSettings(connection),
        value: target.value,
        caseNumber: securityCase?.caseNumberWithPrefix || "",
      });
    } catch (error) {
      throw new BadDataException(
        `${undo.title} did not work: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (
      outcome.state !== SecurityPlaybookTargetState.Done &&
      outcome.state !== SecurityPlaybookTargetState.AlreadyDone
    ) {
      throw new BadDataException(
        `${undo.title} did not work for ${target.value}: ${outcome.detail}.`,
      );
    }

    const undone: SecurityPlaybookTarget = {
      ...target,
      state: SecurityPlaybookTargetState.Undone,
      detail: outcome.detail,
      undoneAt: OneUptimeDate.getCurrentDate().toISOString(),
      ...(data.props.userId
        ? { undoneByUserId: data.props.userId.toString() }
        : {}),
    };

    await this.writeUndone({
      run,
      stepIndex: index,
      steps,
      target: undone,
      props: data.props,
    });

    if (run.securityCaseId) {
      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: data.projectId,
        securityCaseId: run.securityCaseId,
        feedInfoInMarkdown: targetUndoneMarkdown({
          playbookName: run.playbookName || "",
          stepNumber: index + 1,
          stepTitle: getStepTitle(step),
          undoTitle: undo.title,
          value: target.value,
          detail: outcome.detail,
        }).toString(),
        eventType: SecurityCaseFeedEventType.ResponseAction,
        displayColor: Green500,
        userId: data.props.userId,
      });
    }

    return undone;
  }

  /*
   * Marks the target Undone on its step, in a compare-and-set on the run's
   * status and step results: read again and tried again when another write
   * landed in between, and given up on - saying so - once the run runs again.
   */
  private static async writeUndone(data: {
    run: SecurityPlaybookRun;
    stepIndex: number;
    steps: Array<SecurityPlaybookStep>;
    target: SecurityPlaybookTarget;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    let current: SecurityPlaybookRun = data.run;

    for (let attempt: number = 0; attempt < UNDO_WRITE_ATTEMPTS; attempt++) {
      const status: SecurityPlaybookRunStatus | undefined = current.status;

      if (
        !status ||
        status === SecurityPlaybookRunStatus.Queued ||
        status === SecurityPlaybookRunStatus.Running
      ) {
        break;
      }

      const results: Array<SecurityPlaybookStepResult> = readStepResults(
        current.stepResults,
        data.steps,
      );
      const result: SecurityPlaybookStepResult | undefined =
        results[data.stepIndex];

      results[data.stepIndex] = {
        ...result!,
        targets: (result?.targets || []).map(
          (target: SecurityPlaybookTarget): SecurityPlaybookTarget => {
            return securityEntityKey(target) === securityEntityKey(data.target)
              ? data.target
              : target;
          },
        ),
      };

      const isWritten: boolean =
        await SecurityPlaybookRunService.compareAndSetColumnsByIdWithoutHooks({
          id: data.run.id!,
          data: {
            stepResults: results as unknown as NonNullable<
              PartialEntity<SecurityPlaybookRun>["stepResults"]
            >,
          },
          expectedData: {
            status,
            stepResults: storedStepResults(current.stepResults),
          },
        });

      if (isWritten) {
        await this.recordInAuditLog({
          run: current,
          updatedFields: {
            stepResults: results as unknown as JSONArray,
          },
          props: data.props,
        });
        return;
      }

      const fresh: SecurityPlaybookRun | null =
        await SecurityPlaybookRunService.findOneById({
          id: data.run.id!,
          select: RUN_SELECT,
          props: { isRoot: true },
        });

      if (!fresh) {
        break;
      }

      current = fresh;
    }

    throw new BadDataException(
      `${data.target.value} was released in the product, but the run changed while it was: refresh to see the run, and check the product.`,
    );
  }

  // A decision or an undo, in the project's audit log, as the change it made to the run.
  private static async recordInAuditLog(data: {
    run: SecurityPlaybookRun;
    updatedFields: JSONObject;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const before: SecurityPlaybookRun = new SecurityPlaybookRun(data.run.id!);

    if (data.run.projectId) {
      before.projectId = data.run.projectId;
    }

    if (data.run.securityCaseId) {
      before.securityCaseId = data.run.securityCaseId;
    }

    if (data.run.securityPlaybookId) {
      before.securityPlaybookId = data.run.securityPlaybookId;
    }

    if (data.run.status) {
      before.status = data.run.status;
    }

    before.stepResults = data.run.stepResults || [];

    await AuditLogService.recordUpdate({
      model: new SecurityPlaybookRun(),
      before,
      updatedFields: data.updatedFields,
      itemId: data.run.id!,
      props: data.props,
    });
  }
}
