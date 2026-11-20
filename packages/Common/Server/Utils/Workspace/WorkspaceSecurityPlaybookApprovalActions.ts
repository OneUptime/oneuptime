import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import { SecurityPlaybookApprovalDecision } from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  SecurityPlaybookApprovalAnswerKind,
  SecurityPlaybookApprovalLine,
  SecurityPlaybookApprovalStandingKind,
  wordSecurityPlaybookApprovalAnswer,
} from "../../../Utils/SecurityPlaybook/SecurityPlaybookApprovalWords";
import SecurityPlaybookRunAPI, {
  SecurityPlaybookApprovalChangedException,
} from "../../API/SecurityPlaybookRunAPI";
import SecurityCaseService from "../../Services/SecurityCaseService";
import logger from "../Logger";
import UserLanguage from "../Notification/UserLanguage";
import CallerPermission from "../Permission/CallerPermission";
import SecurityPlaybookApprovalReader, {
  SecurityPlaybookApprovalRead,
  SecurityPlaybookApprovalRound,
} from "../SecurityPlaybook/SecurityPlaybookApprovalReader";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SlackActionType from "./Slack/Actions/ActionTypes";
import { WorkspaceAnswer } from "./WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "./WorkspaceActionAuthorization";
import WorkspaceSecurityPlaybookApproval from "./WorkspaceSecurityPlaybookApproval";

/*
 * APPROVING AND REJECTING A PLAYBOOK STEP FROM SLACK AND MICROSOFT TEAMS,
 * THE SAME WAY IN BOTH (#10341).
 *
 * An approval is containment, so a press decides only when everything about
 * it is verified, and every press that is not is answered - to the person
 * who pressed only, in plain words - with what to do instead: open the case
 * in OneUptime.
 *
 *   1. The request: signed by Slack (SlackAuthorization: its signing
 *      secret, a request no older than five minutes, never one delivered
 *      before) or by the Bot Framework for Microsoft Teams (its token,
 *      checked by the SDK's adapter; an activity delivered again is
 *      dropped, MicrosoftTeamsActivityDeduplicator) - before anything here.
 *   2. The button: a value this installation signed, for the project the
 *      press was read in (WorkspaceSecurityPlaybookApproval.readValue).
 *   3. The person: the chat account connected to a current member of the
 *      project (the chats' own auth), acting with the props the Dashboard
 *      gives them (WorkspaceActionAuthorization.getProjectMemberProps) - a
 *      project or person a master admin blocked, and a plan that cannot be
 *      read, refused there.
 *   4. What they may do, as they press: the run's update permission in
 *      the project - what the Dashboard's Approve asks (the Member tier and
 *      up, or Edit Security Playbook Run) - and a read of the case itself,
 *      under their labels and blocks. The run's own decision checks again
 *      (SecurityPlaybookRunAPI.decide: the run as they may change it).
 *   5. The approval: still waiting, on the step the message asked about,
 *      proposing what it proposed (its digest) - else nothing is decided,
 *      and they are told who decided, and when, or that it changed.
 *   6. Approving takes somebody other than whoever started the run.
 *
 * The decision is the Dashboard's own (SecurityPlaybookRunAPI.decide): one
 * compare-and-set from Waiting for Approval, so two presses at once decide
 * once - the second is told the first's - recorded on the step, the case's
 * timeline (with where it was made) and the audit log, as the member; an
 * approval queues the run, which acts through the playbook engine's
 * containment path. Every copy of the message then says who decided and
 * what came of it (WorkspaceSecurityPlaybookApprovalMessages).
 */

// What a press comes to.
export enum SecurityPlaybookApprovalPressOutcome {
  // Approved or rejected, by this press.
  Decided = "Decided",
  // Approve Some…: the form of the step's targets is to be opened.
  ShowForm = "ShowForm",
  // Nothing was done; the answer says why.
  Refused = "Refused",
}

export interface SecurityPlaybookApprovalPressAnswer {
  outcome: SecurityPlaybookApprovalPressOutcome;
  // What the person who pressed is told, in their language.
  answer: WorkspaceAnswer;
  // The language they read, for a form the press opens.
  language: string;
  // The approval as read: what a form the press opens is drawn from.
  read?: SecurityPlaybookApprovalRead | undefined;
}

export default class WorkspaceSecurityPlaybookApprovalActions {
  // Completes "You do not have permission to ...", "Could not ...".
  public static readonly APPROVE_ACTION: string = "approve this playbook step";
  public static readonly REJECT_ACTION: string = "reject this playbook step";

  // The action a press asks for, as a refusal names it.
  public static getAction(actionType: string | undefined): string {
    return actionType === SlackActionType.RejectSecurityPlaybookStep
      ? WorkspaceSecurityPlaybookApprovalActions.REJECT_ACTION
      : WorkspaceSecurityPlaybookApprovalActions.APPROVE_ACTION;
  }

  /*
   * A button's value, for the project the press was read in: null for one
   * this installation did not sign, and for one signed for another project -
   * a message forwarded out of the project it was sent in decides nothing.
   */
  public static readPressValue(data: {
    actionValue: unknown;
    projectId: ObjectID | undefined;
  }): SecurityPlaybookApprovalRound | null {
    const round: SecurityPlaybookApprovalRound | null =
      WorkspaceSecurityPlaybookApproval.readValue(data.actionValue);

    if (
      !round ||
      !data.projectId ||
      round.projectId.toString().toLowerCase() !==
        data.projectId.toString().toLowerCase()
    ) {
      return null;
    }

    return round;
  }

  // What a press whose value cannot be read is told: in English, the presser unknown.
  public static getNotReadableAnswer(
    language?: string | null | undefined,
  ): WorkspaceAnswer {
    return WorkspaceSecurityPlaybookApprovalActions.toAnswer(
      wordSecurityPlaybookApprovalAnswer({
        kind: SecurityPlaybookApprovalAnswerKind.NotReadable,
        context: WorkspaceSecurityPlaybookApproval.getContext(language),
      }),
    );
  }

  /*
   * The member's props, once they may decide on this approval: a current
   * member (getProjectMemberProps) holding the run's update permission,
   * who may read the case. Throws NotAuthorizedException worded for the
   * chat otherwise - which each chat tells only them, where they pressed.
   */
  @CaptureSpan()
  public static async authorize(data: {
    userId: ObjectID;
    projectId: ObjectID;
    securityCaseId: ObjectID;
    action: string;
  }): Promise<DatabaseCommonInteractionProps> {
    const props: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: data.userId,
        projectId: data.projectId,
      });

    if (
      !props.isMasterAdmin &&
      !CallerPermission.holdsAnyOf(
        props,
        new SecurityPlaybookRun().getUpdatePermissions(),
        { projectId: data.projectId },
      )
    ) {
      throw new NotAuthorizedException(
        `You do not have permission to ${data.action}. It takes a role that can run security playbooks: Project Owner, Project Admin, Security Admin, Security Member, or a role that can edit playbook runs.`,
      );
    }

    let found: SecurityCase | null = null;
    let readError: unknown = undefined;

    try {
      found = await SecurityCaseService.findOneBy({
        query: {
          _id: data.securityCaseId.toString(),
          projectId: data.projectId,
        },
        select: { _id: true },
        props,
      });
    } catch (err) {
      if (!WorkspaceActionAuthorization.isReadRefusal(err)) {
        throw err;
      }

      readError = err;
    }

    if (!found) {
      throw await WorkspaceActionAuthorization.getUnreadableRefusal({
        action: data.action,
        service: SecurityCaseService,
        id: data.securityCaseId,
        props,
        readError,
      });
    }

    return props;
  }

  /*
   * A press of Approve, Approve Some… (its button, or its form's
   * submission, whose boxes `isTicked` reads) or Reject, by the member
   * `userId` the chat account is connected to, read in `projectId`. The
   * request and the value are verified already (readPressValue). Throws
   * NotAuthorizedException for a member who may not decide (authorize),
   * which the chat answers in place; everything else is answered here.
   */
  @CaptureSpan()
  public static async press(data: {
    actionType: string;
    round: SecurityPlaybookApprovalRound;
    userId: ObjectID;
    projectId: ObjectID;
    from: WorkspaceType;
    // Approve Some's submission: whether the box of a field is ticked.
    isTicked?: ((field: string) => boolean) | undefined;
  }): Promise<SecurityPlaybookApprovalPressAnswer> {
    const language: string = await UserLanguage.getLanguage(data.userId);
    const refuse: (
      kind: SecurityPlaybookApprovalAnswerKind,
      read?: SecurityPlaybookApprovalRead | null,
    ) => SecurityPlaybookApprovalPressAnswer = (
      kind: SecurityPlaybookApprovalAnswerKind,
      read?: SecurityPlaybookApprovalRead | null,
    ): SecurityPlaybookApprovalPressAnswer => {
      return {
        outcome: SecurityPlaybookApprovalPressOutcome.Refused,
        language,
        answer: WorkspaceSecurityPlaybookApprovalActions.getAnswer({
          kind,
          language,
          read: read || undefined,
        }),
      };
    };

    const read: SecurityPlaybookApprovalRead | null =
      await SecurityPlaybookApprovalReader.read({
        projectId: data.projectId,
        runId: data.round.runId,
        stepIndex: data.round.stepIndex,
        withEvidence: false,
      });

    // The run, its step or its case is gone: nothing to decide on.
    if (
      !read ||
      read.round.securityCaseId.toString().toLowerCase() !==
        data.round.securityCaseId.toString().toLowerCase()
    ) {
      return refuse(SecurityPlaybookApprovalAnswerKind.NoLongerWaiting);
    }

    const action: string = WorkspaceSecurityPlaybookApprovalActions.getAction(
      data.actionType,
    );

    // Who may press, before anything about the approval is told them.
    const props: DatabaseCommonInteractionProps =
      await WorkspaceSecurityPlaybookApprovalActions.authorize({
        userId: data.userId,
        projectId: data.projectId,
        securityCaseId: read.round.securityCaseId,
        action,
      });

    // Somebody got there first, or the run stopped waiting.
    if (read.ask.standing.kind !== SecurityPlaybookApprovalStandingKind.Waiting) {
      return refuse(
        WorkspaceSecurityPlaybookApprovalActions.getLateKind(read),
        read,
      );
    }

    // Still waiting - but not on what the message showed.
    if (
      read.round.stepId !== data.round.stepId ||
      read.round.targetsDigest !== data.round.targetsDigest
    ) {
      return refuse(SecurityPlaybookApprovalAnswerKind.Changed, read);
    }

    const isReject: boolean =
      data.actionType === SlackActionType.RejectSecurityPlaybookStep;

    // A run a person started is approved by somebody else.
    if (
      !isReject &&
      WorkspaceSecurityPlaybookApprovalActions.didStartRun(
        read.run,
        data.userId,
      )
    ) {
      return refuse(SecurityPlaybookApprovalAnswerKind.StartedTheRun, read);
    }

    if (data.actionType === SlackActionType.ViewApproveSomeSecurityPlaybookStep) {
      return {
        outcome: SecurityPlaybookApprovalPressOutcome.ShowForm,
        language,
        read,
        answer: { markdown: "", text: "" },
      };
    }

    const isApproveSome: boolean =
      data.actionType === SlackActionType.SubmitApproveSomeSecurityPlaybookStep;

    /*
     * The boxes left ticked, of the targets the step proposes now - the
     * ones the form listed, which its digest just held to.
     */
    const keptTargets: Array<string> | undefined = isApproveSome
      ? WorkspaceSecurityPlaybookApproval.readKeptTargets({
          ask: read.ask,
          isTicked: (field: string): boolean => {
            return Boolean(data.isTicked && data.isTicked(field));
          },
        })
      : undefined;

    if (isApproveSome && (!keptTargets || keptTargets.length === 0)) {
      return refuse(SecurityPlaybookApprovalAnswerKind.KeepAtLeastOne, read);
    }

    try {
      await SecurityPlaybookRunAPI.decide({
        projectId: data.projectId,
        runId: read.round.runId,
        decision: isReject
          ? SecurityPlaybookApprovalDecision.Rejected
          : SecurityPlaybookApprovalDecision.Approved,
        props,
        targets: keptTargets,
        from: data.from,
        expected: {
          stepId: data.round.stepId,
          targetsDigest: data.round.targetsDigest,
        },
      });
    } catch (err) {
      return await WorkspaceSecurityPlaybookApprovalActions.answerRefusedDecision({
        err,
        round: data.round,
        projectId: data.projectId,
        language,
      });
    }

    return {
      outcome: SecurityPlaybookApprovalPressOutcome.Decided,
      language,
      read,
      answer: WorkspaceSecurityPlaybookApprovalActions.getAnswer({
        kind: isReject
          ? SecurityPlaybookApprovalAnswerKind.Rejected
          : SecurityPlaybookApprovalAnswerKind.Approved,
        language,
      }),
    };
  }

  /*
   * A decision the run refused: somebody decided a moment before (the
   * compare-and-set lost), the step changed under the press, the member may
   * not change this run, or it is gone. Read again, and answered with who
   * decided and when where somebody did. Anything else is OneUptime's to
   * log: the press is answered that it could not be checked, and nothing
   * was done.
   */
  private static async answerRefusedDecision(data: {
    err: unknown;
    round: SecurityPlaybookApprovalRound;
    projectId: ObjectID;
    language: string;
  }): Promise<SecurityPlaybookApprovalPressAnswer> {
    const refused: (
      kind: SecurityPlaybookApprovalAnswerKind,
      read?: SecurityPlaybookApprovalRead | null,
    ) => SecurityPlaybookApprovalPressAnswer = (
      kind: SecurityPlaybookApprovalAnswerKind,
      read?: SecurityPlaybookApprovalRead | null,
    ): SecurityPlaybookApprovalPressAnswer => {
      return {
        outcome: SecurityPlaybookApprovalPressOutcome.Refused,
        language: data.language,
        answer: WorkspaceSecurityPlaybookApprovalActions.getAnswer({
          kind,
          language: data.language,
          read: read || undefined,
        }),
      };
    };

    if (data.err instanceof NotAuthorizedException) {
      throw data.err;
    }

    if (data.err instanceof SecurityPlaybookApprovalChangedException) {
      return refused(SecurityPlaybookApprovalAnswerKind.Changed);
    }

    if (data.err instanceof NotFoundException) {
      return refused(SecurityPlaybookApprovalAnswerKind.NoLongerWaiting);
    }

    if (data.err instanceof BadDataException) {
      const now: SecurityPlaybookApprovalRead | null =
        await SecurityPlaybookApprovalReader.read({
          projectId: data.projectId,
          runId: data.round.runId,
          stepIndex: data.round.stepIndex,
        });

      if (
        now &&
        now.ask.standing.kind !== SecurityPlaybookApprovalStandingKind.Waiting
      ) {
        return refused(
          WorkspaceSecurityPlaybookApprovalActions.getLateKind(now),
          now,
        );
      }

      // The run's own word for what it refused, as the Dashboard shows it.
      logger.debug(
        `A chat press on a playbook step was refused: ${data.err.message}`,
        { projectId: data.projectId.toString() },
      );

      return {
        outcome: SecurityPlaybookApprovalPressOutcome.Refused,
        language: data.language,
        answer: {
          markdown: mdText`${data.err.message}`.toString(),
          text: data.err.message,
        },
      };
    }

    logger.error(
      `Could not decide on a playbook step from a chat: ${data.err instanceof Error ? data.err.message : String(data.err)}`,
      { projectId: data.projectId.toString() },
    );

    return refused(SecurityPlaybookApprovalAnswerKind.CouldNotCheck);
  }

  // What a late press is told: who decided, or that the run stopped waiting.
  public static getLateKind(
    read: SecurityPlaybookApprovalRead,
  ): SecurityPlaybookApprovalAnswerKind {
    switch (read.ask.standing.kind) {
      case SecurityPlaybookApprovalStandingKind.Approved:
        return SecurityPlaybookApprovalAnswerKind.AlreadyApproved;
      case SecurityPlaybookApprovalStandingKind.Rejected:
        return SecurityPlaybookApprovalAnswerKind.AlreadyRejected;
      default:
        return SecurityPlaybookApprovalAnswerKind.NoLongerWaiting;
    }
  }

  // An answer of `kind`, in `language`: who decided, from `read`.
  public static getAnswer(data: {
    kind: SecurityPlaybookApprovalAnswerKind;
    language?: string | null | undefined;
    read?: SecurityPlaybookApprovalRead | undefined;
  }): WorkspaceAnswer {
    return WorkspaceSecurityPlaybookApprovalActions.toAnswer(
      wordSecurityPlaybookApprovalAnswer({
        kind: data.kind,
        context: WorkspaceSecurityPlaybookApproval.getContext(data.language),
        deciderName: data.read?.ask.standing.deciderName,
        decidedAt: data.read?.ask.standing.decidedAt,
      }),
    );
  }

  // Whether `userId` started the run: they may reject it, never approve it.
  public static didStartRun(
    run: Pick<SecurityPlaybookRun, "triggeredByUserId">,
    userId: ObjectID,
  ): boolean {
    return Boolean(
      run.triggeredByUserId &&
        run.triggeredByUserId.toString().toLowerCase() ===
          userId.toString().toLowerCase(),
    );
  }

  private static toAnswer(line: SecurityPlaybookApprovalLine): WorkspaceAnswer {
    return { markdown: line.markdown.toString(), text: line.text };
  }
}
