import Alert from "../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../Models/DatabaseModels/Incident";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import AlertService from "../../Services/AlertService";
import AutoRemediationSuggestionService from "../../Services/AutoRemediationSuggestionService";
import IncidentService from "../../Services/IncidentService";
import UserService from "../../Services/UserService";
import RemediationApproval from "../AutoRemediation/RemediationApproval";
import RemediationChatMessage, {
  RemediationActionValue,
  RemediationChatFix,
} from "../AutoRemediation/RemediationChatMessage";
import { REMEDIATION_CHAT_WORDS } from "../AutoRemediation/RemediationChatWords";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "./WorkspaceActionAnswers";
import WorkspaceActionAuthorization, {
  WorkspaceActionResource,
} from "./WorkspaceActionAuthorization";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WorkspaceMessageTime from "./WorkspaceMessageTime";
import ProductBrandingText from "../ProductBrandingText";

/*
 * APPROVING AND DISMISSING ONEUPTIME AI'S FIXES FROM SLACK AND MICROSOFT
 * TEAMS, IN THE SAME WAY IN BOTH.
 *
 * A fix that waits for approval is posted to its incident's or alert's
 * channels with Review and approve and Dismiss (RemediationChatMessage).
 * Both chats ask here, so they decide and answer alike:
 *
 *   - who may press: a member of the project, connected to their chat
 *     account, who may run fixes - the permission the Dashboard's Approve
 *     asks for (creating a runbook execution) - and may read the incident or
 *     alert, private ones included (WorkspaceActionAuthorization). Dismiss
 *     asks the same as Approve: it decides as much about the fix.
 *   - what Approve and run does: RemediationApproval.approve, as that
 *     member, so every check of the Dashboard's Approve is made - Enable AI,
 *     the agents and clusters as they are now, the member's right to change
 *     each of them - and nothing runs when one fails. The fix must still be
 *     the one the message showed (its plan fingerprint).
 *   - a press that comes too late is told who got there first, and when,
 *     as news (getLatePressAnswer).
 *
 * Approving, dismissing and refusals are worded once, here, in English, as
 * the chats' other answers are.
 */

// What a fix's approval dialog shows: in Slack a modal, in Teams a card.
export interface RemediationApprovalDialog {
  title: string;
  // Chat Markdown: the record, everything the fix runs, what approving does.
  markdown: string;
  /*
   * The same, a part a text block, each line a paragraph: Microsoft Teams'
   * card, where a single newline is a space (getChatLineBreak).
   */
  teamsParts: Array<string>;
  submitTitle: string;
  cancelTitle: string;
  // The value Approve and run carries: the fix and its fingerprint now.
  value: string;
}

/*
 * What a fix is for, as an answer names it: "the incident", "the alert" -
 * or both, for a fix that names neither.
 */
export function getFixSubjectWords(
  suggestion: Pick<AutoRemediationSuggestion, "incidentId" | "alertId">,
): string {
  if (suggestion.incidentId) {
    return "the incident";
  }

  if (suggestion.alertId) {
    return "the alert";
  }

  return "its incident or alert";
}

export default class WorkspaceRemediationActions {
  // Completes "You do not have permission to ...", "Could not ...".
  public static readonly APPROVE_ACTION: string = "approve this fix";
  public static readonly DISMISS_ACTION: string = "dismiss this fix";

  // A fix that is gone: deleted with its incident or alert, say.
  public static getNotFoundMessage(): string {
    return `This fix is no longer in ${ProductBrandingText.getProductName()}. It may have been deleted.`;
  }

  // The same, as an answer: its words placed as text.
  public static getNotFoundAnswer(): WorkspaceAnswer {
    const message: string = WorkspaceRemediationActions.getNotFoundMessage();

    return { markdown: mdText`${message}`.toString(), text: message };
  }

  /*
   * The fix a press names, read as OneUptime, in the press's project only:
   * null when it is not there (gone, or another project's).
   */
  @CaptureSpan()
  public static async readFix(data: {
    suggestionId: ObjectID;
    projectId: ObjectID;
  }): Promise<AutoRemediationSuggestion | null> {
    const suggestion: AutoRemediationSuggestion | null =
      await AutoRemediationSuggestionService.findOneBy({
        query: {
          _id: data.suggestionId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          projectId: true,
          incidentId: true,
          alertId: true,
          status: true,
          suggestionType: true,
          commandPlan: true,
          mcpToolCallPlan: true,
          runbookId: true,
          runbookNameSnapshot: true,
          verificationWindowMinutes: true,
          approvedByUserId: true,
          approvedAt: true,
          dismissedByUserId: true,
          dismissedAt: true,
        },
        props: { isRoot: true },
      });

    return suggestion && suggestion.id ? suggestion : null;
  }

  /*
   * The member's props, once they may approve or dismiss the fix: they are
   * in the project, may run fixes and may read the incident or alert the fix
   * is for. Throws NotAuthorizedException worded for the chat otherwise.
   */
  @CaptureSpan()
  public static async authorize(data: {
    userId: ObjectID;
    projectId: ObjectID;
    suggestion: AutoRemediationSuggestion;
    action: string;
  }): Promise<DatabaseCommonInteractionProps> {
    return await WorkspaceActionAuthorization.authorize({
      userId: data.userId,
      projectId: data.projectId,
      action: data.action,
      ...WorkspaceRemediationActions.getAuthorizationScope(data.suggestion),
    });
  }

  /*
   * What pressing a fix's button asks of the member (authorize): to create
   * a runbook execution - the Dashboard's Approve asks the same
   * (assertCanExecuteRunbooks) - and to read the incident or alert the fix
   * is for. Slack asks it through its own refusal-in-place
   * (SlackActionAuthorization).
   */
  public static getAuthorizationScope(suggestion: AutoRemediationSuggestion): {
    modelType: DatabaseBaseModelType;
    resources: Array<WorkspaceActionResource>;
  } {
    return {
      modelType: RunbookExecution,
      resources: suggestion.incidentId
        ? [{ service: IncidentService, id: suggestion.incidentId }]
        : suggestion.alertId
          ? [{ service: AlertService, id: suggestion.alertId }]
          : [],
    };
  }

  /*
   * What a press on a fix that no longer waits for approval answers: who
   * approved or dismissed it, and when, or that OneUptime AI no longer asks
   * about it. Null while it waits.
   */
  @CaptureSpan()
  public static async getLatePressAnswer(
    suggestion: AutoRemediationSuggestion,
  ): Promise<WorkspaceAnswer | null> {
    switch (suggestion.status) {
      case AutoRemediationSuggestionStatus.Suggested:
        return null;
      case AutoRemediationSuggestionStatus.Approved:
        return await this.getDecidedAnswer({
          verb: "approved",
          userId: suggestion.approvedByUserId,
          at: suggestion.approvedAt,
        });
      case AutoRemediationSuggestionStatus.Dismissed:
        return await this.getDecidedAnswer({
          verb: "dismissed",
          userId: suggestion.dismissedByUserId,
          at: suggestion.dismissedAt,
        });
      case AutoRemediationSuggestionStatus.AutoExecuted:
        return {
          markdown:
            mdText`✅ ${ProductBrandingText.getProductName()} AI already made this fix on its own.`.toString(),
          text: `${ProductBrandingText.getProductName()} AI already made this fix on its own`,
        };
      default: {
        const subject: string = getFixSubjectWords(suggestion);
        const sentenceStart: string = `${subject.charAt(0).toUpperCase()}${subject.slice(1)}`;

        return {
          markdown:
            mdText`This fix no longer waits for approval, so nothing was done. ${sentenceStart} in ${ProductBrandingText.getProductName()} says what came of it.`.toString(),
          text: "This fix no longer waits for approval",
        };
      }
    }
  }

  private static async getDecidedAnswer(data: {
    verb: "approved" | "dismissed";
    userId?: ObjectID | undefined;
    at?: Date | undefined;
  }): Promise<WorkspaceAnswer> {
    const name: string | null = data.userId
      ? await this.getUserName(data.userId)
      : null;
    const mark: string = data.verb === "approved" ? "✅ " : "";

    let markdown: MarkdownText;

    if (name && data.at) {
      markdown = mdText`${mark}This fix was already ${data.verb} by **${name}** at ${WorkspaceMessageTime.time(data.at)}.`;
    } else if (name) {
      markdown = mdText`${mark}This fix was already ${data.verb} by **${name}**.`;
    } else {
      markdown = mdText`${mark}This fix was already ${data.verb}.`;
    }

    return {
      markdown: markdown.toString(),
      text: name
        ? `This fix was already ${data.verb} by ${name}`
        : `This fix was already ${data.verb}`,
    };
  }

  /*
   * The dialog Review and approve opens: the incident or alert, everything
   * the fix runs - each change's reason, undo, dry run and track record -
   * and that approving runs exactly that, as the person, watched.
   */
  @CaptureSpan()
  public static async getApprovalDialog(
    suggestion: AutoRemediationSuggestion,
  ): Promise<RemediationApprovalDialog | null> {
    const fix: RemediationChatFix | null =
      RemediationChatMessage.fromSuggestion(suggestion);

    if (!fix) {
      return null;
    }

    const subject: { name: string; title?: string | undefined } =
      await this.getSubject(suggestion);

    return {
      title: REMEDIATION_CHAT_WORDS.dialogTitle,
      markdown: RemediationChatMessage.describeApproval({
        fix,
        subjectName: subject.name,
        subjectTitle: subject.title,
      }).toString(),
      teamsParts: RemediationChatMessage.describeApprovalParts({
        fix,
        subjectName: subject.name,
        subjectTitle: subject.title,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }).map((part: MarkdownText): string => {
        return part.toString();
      }),
      submitTitle: REMEDIATION_CHAT_WORDS.approveAndRun,
      cancelTitle: REMEDIATION_CHAT_WORDS.cancel,
      value: RemediationChatMessage.encodeActionValue({
        suggestionId: fix.suggestionId,
        fingerprint: RemediationChatMessage.getFingerprint(fix),
      }),
    };
  }

  /*
   * Approve and run, as the member: RemediationApproval, with the
   * fingerprint the dialog carried and where it was pressed. Throws what it
   * throws - a refusal the chat tells them.
   */
  @CaptureSpan()
  public static async approve(data: {
    props: DatabaseCommonInteractionProps;
    value: RemediationActionValue;
    from: WorkspaceType;
    // The fix as the press read it: what the answer names it for.
    suggestion?: AutoRemediationSuggestion | undefined;
  }): Promise<WorkspaceAnswer> {
    await RemediationApproval.approve({
      props: data.props,
      suggestionId: data.value.suggestionId.toString(),
      expectedPlanFingerprint: data.value.fingerprint,
      from: data.from,
    });

    return WorkspaceRemediationActions.getApprovedAnswer(data.suggestion);
  }

  /*
   * What the person who approved a fix is told where they pressed: it is
   * being made, and where to follow it - the incident or the alert it is
   * for. The record's feed says the rest - who approved it, from which
   * chat - in its channels.
   */
  public static getApprovedAnswer(
    suggestion?: Pick<AutoRemediationSuggestion, "incidentId" | "alertId">,
  ): WorkspaceAnswer {
    const product: string = ProductBrandingText.getProductName();
    const subject: string = getFixSubjectWords(suggestion || {});

    return {
      markdown:
        mdText`✅ You approved this fix. ${product} AI is making it now, and ${subject} in ${product} shows how it goes.`.toString(),
      text: "You approved this fix",
    };
  }

  /*
   * Dismiss, as the member, and what to tell them: a dismissal is said in
   * the record's feed, but not in its channels unless something had run.
   */
  @CaptureSpan()
  public static async dismiss(data: {
    props: DatabaseCommonInteractionProps;
    value: RemediationActionValue;
    from: WorkspaceType;
    // The fix as the press read it: what the answer names it for.
    suggestion?: AutoRemediationSuggestion | undefined;
  }): Promise<WorkspaceAnswer> {
    await RemediationApproval.dismiss({
      props: data.props,
      suggestionId: data.value.suggestionId.toString(),
      expectedPlanFingerprint: data.value.fingerprint,
      from: data.from,
    });

    const product: string = ProductBrandingText.getProductName();
    const subject: string = getFixSubjectWords(data.suggestion || {});

    return {
      markdown:
        mdText`You dismissed this fix. ${product} AI will not run it, and ${subject} in ${product} keeps what it proposed.`.toString(),
      text: "You dismissed this fix",
    };
  }

  // A value a button carried, or a refusal the chat tells.
  public static readValue(value: unknown): RemediationActionValue {
    const read: RemediationActionValue | null =
      RemediationChatMessage.decodeActionValue(value);

    if (!read) {
      const product: string = ProductBrandingText.getProductName();

      throw new BadDataException(
        `This button does not name a fix ${product} knows. Open the incident or alert in ${product} instead.`,
      );
    }

    return read;
  }

  // "Incident INC-42" and its title, as the dialog names what the fix is for.
  private static async getSubject(
    suggestion: AutoRemediationSuggestion,
  ): Promise<{ name: string; title?: string | undefined }> {
    try {
      if (suggestion.incidentId) {
        const incident: Incident | null = await IncidentService.findOneById({
          id: suggestion.incidentId,
          select: {
            title: true,
            incidentNumber: true,
            incidentNumberWithPrefix: true,
          },
          props: { isRoot: true },
        });

        const number: string =
          incident?.incidentNumberWithPrefix ||
          (incident?.incidentNumber !== undefined &&
          incident?.incidentNumber !== null
            ? `#${incident.incidentNumber}`
            : "");

        return {
          name: number ? `Incident ${number}` : "Incident",
          title: incident?.title || undefined,
        };
      }

      if (suggestion.alertId) {
        const alert: Alert | null = await AlertService.findOneById({
          id: suggestion.alertId,
          select: {
            title: true,
            alertNumber: true,
            alertNumberWithPrefix: true,
          },
          props: { isRoot: true },
        });

        const number: string =
          alert?.alertNumberWithPrefix ||
          (alert?.alertNumber !== undefined && alert?.alertNumber !== null
            ? `#${alert.alertNumber}`
            : "");

        return {
          name: number ? `Alert ${number}` : "Alert",
          title: alert?.title || undefined,
        };
      }
    } catch (error) {
      logger.error(
        `WorkspaceRemediationActions: could not read what a fix is for: ${error}`,
      );
    }

    return { name: "The fix" };
  }

  private static async getUserName(userId: ObjectID): Promise<string | null> {
    try {
      const user: User | null = await UserService.findOneById({
        id: userId,
        select: { name: true, email: true },
        props: { isRoot: true },
      });

      const name: string =
        user?.name?.toString().trim() || user?.email?.toString().trim() || "";

      return name || null;
    } catch (error) {
      logger.debug(`Could not read the name of who decided a fix: ${error}`);
      return null;
    }
  }
}
