import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "../WorkspaceActionAnswers";
import WorkspacePublicNoteApproval, {
  PUBLIC_NOTE_REJECT_REASON_FIELD,
  PublicNoteApprovalButtonValue,
} from "../WorkspacePublicNoteApproval";
import WorkspacePublicNoteApprovalActions, {
  PublicNoteApprovalPressAnswer,
  PublicNoteApprovalPressOutcome,
  PublicNoteRejectFormResult,
} from "../WorkspacePublicNoteApprovalActions";
import SlackActionType from "../Slack/Actions/ActionTypes";
import MattermostUtil from "./Mattermost";
import { MattermostPressedAction } from "./MattermostActionContext";
import MattermostActions, {
  MattermostDialogAnswer,
  MattermostPressAnswer,
  MattermostRequester,
} from "./MattermostActions";

/*
 * APPROVE AND REJECT ON A PUBLIC NOTE'S APPROVAL MESSAGE, IN MATTERMOST.
 *
 * An approver who chose chat for public note approval gets the note in a
 * direct message from OneUptime's bot (WorkspacePublicNoteApproval), with
 * Approve and Reject. A press there is read as every Mattermost press is
 * (MattermostActions): its context is OneUptime's - for a direct message,
 * signed for its channel (MattermostActionContext) - and the member is the
 * one the pressing Mattermost account is connected to in the note's
 * project, which must be connected to the team the message was posted
 * with. What it does is WorkspacePublicNoteApprovalActions', as in Slack
 * and Microsoft Teams:
 *
 *  - Approve decides at once, and is answered only to the presser
 *    (ephemeral_text).
 *  - Reject opens a form that asks why (an interactive dialog, held to the
 *    same channel); its submission rejects the note. A reason that is
 *    missing or too long keeps the form open, saying so under the field.
 *    Once it is sent the form closes, and what it came to is a post only
 *    the presser sees - a Mattermost form says nothing as it closes.
 *
 * An account that is not connected is asked to connect, and to press again
 * once it is, as every Mattermost press is.
 */
export default class MattermostPublicNoteApprovalActions {
  @CaptureSpan()
  public static async handlePress(data: {
    body: JSONObject;
    press: MattermostPressedAction;
  }): Promise<MattermostPressAnswer> {
    const value: PublicNoteApprovalButtonValue | null =
      WorkspacePublicNoteApproval.readValue(data.press.value);

    if (!value) {
      return {
        ephemeral_text: MattermostActions.getRefusalMarkdown(
          new BadDataException(
            WorkspacePublicNoteApprovalActions.getUnverifiedMessage(),
          ),
        ),
      };
    }

    const isApprove: boolean =
      data.press.actionId === SlackActionType.ApprovePublicNote;

    try {
      const requester: MattermostRequester =
        await MattermostActions.getRequesterInProject({
          body: data.body,
          teamId: data.press.teamId,
          projectId: value.projectId,
          purpose: isApprove
            ? WorkspacePublicNoteApprovalActions.APPROVE_ACTION
            : WorkspacePublicNoteApprovalActions.REJECT_ACTION,
          isForm: !isApprove,
        });

      if (isApprove) {
        const approved: PublicNoteApprovalPressAnswer =
          await WorkspacePublicNoteApprovalActions.approve({
            value: value,
            props: requester.props,
          });

        await MattermostPublicNoteApprovalActions.logIfDecided({
          result: approved,
          value: value,
          requester: requester,
          buttonAction: "approve_public_note",
        });

        return { ephemeral_text: approved.answer.markdown };
      }

      const reject: PublicNoteRejectFormResult =
        await WorkspacePublicNoteApprovalActions.getRejectForm({
          value: value,
          props: requester.props,
          workspaceType: WorkspaceType.Mattermost,
        });

      if (!reject.form) {
        return { ephemeral_text: reject.answer?.answer.markdown };
      }

      await MattermostUtil.showModalToUser({
        authToken: requester.authToken,
        triggerId:
          typeof data.body["trigger_id"] === "string"
            ? (data.body["trigger_id"] as string)
            : "",
        modalBlock: reject.form,
        directMessageChannelId: data.press.channelId,
        teamId: data.press.teamId,
      });

      return {};
    } catch (err) {
      return { ephemeral_text: MattermostActions.getRefusalMarkdown(err) };
    }
  }

  // Reject's form, submitted with the reason.
  @CaptureSpan()
  public static async handleDialogSubmission(data: {
    body: JSONObject;
    form: MattermostPressedAction;
    submission: JSONObject;
  }): Promise<MattermostDialogAnswer> {
    const value: PublicNoteApprovalButtonValue | null =
      data.form.actionId === SlackActionType.SubmitRejectPublicNote
        ? WorkspacePublicNoteApproval.readValue(data.form.value)
        : null;

    if (!value) {
      return {
        error: WorkspacePublicNoteApprovalActions.getUnverifiedMessage(),
      };
    }

    const reason: unknown = data.submission[PUBLIC_NOTE_REJECT_REASON_FIELD];

    // Said under the field, and the form stays open.
    const reasonError: string | null =
      WorkspacePublicNoteApprovalActions.getReasonError(reason);

    if (reasonError) {
      return { errors: { [PUBLIC_NOTE_REJECT_REASON_FIELD]: reasonError } };
    }

    try {
      const requester: MattermostRequester =
        await MattermostActions.getRequesterInProject({
          body: data.body,
          teamId: data.form.teamId,
          projectId: value.projectId,
          purpose: WorkspacePublicNoteApprovalActions.REJECT_ACTION,
          isForm: true,
        });

      const rejected: PublicNoteApprovalPressAnswer =
        await WorkspacePublicNoteApprovalActions.reject({
          value: value,
          props: requester.props,
          reason: reason,
        });

      await MattermostPublicNoteApprovalActions.logIfDecided({
        result: rejected,
        value: value,
        requester: requester,
        buttonAction: "reject_public_note",
      });

      await MattermostPublicNoteApprovalActions.postAnswer({
        requester: requester,
        answer: rejected.answer,
      });

      return {};
    } catch (err) {
      return { error: MattermostActions.getRefusalText(err) };
    }
  }

  /*
   * What a closed form came to, in a post only the presser sees, in the
   * direct message it was opened from. Best effort: the decision stands
   * whether or not Mattermost takes the post.
   */
  private static async postAnswer(data: {
    requester: MattermostRequester;
    answer: WorkspaceAnswer;
  }): Promise<void> {
    if (!data.requester.channelId) {
      return;
    }

    try {
      await MattermostUtil.postEphemeral({
        authToken: data.requester.authToken,
        userId: data.requester.mattermostUserId,
        channelId: data.requester.channelId,
        markdown: data.answer.markdown,
      });
    } catch (err) {
      logger.error(
        "Could not tell a Mattermost member what their decision on a public note came to.",
      );
      logger.error(err);
    }
  }

  private static async logIfDecided(data: {
    result: PublicNoteApprovalPressAnswer;
    value: PublicNoteApprovalButtonValue;
    requester: MattermostRequester;
    buttonAction: "approve_public_note" | "reject_public_note";
  }): Promise<void> {
    if (data.result.outcome !== PublicNoteApprovalPressOutcome.Decided) {
      return;
    }

    await WorkspacePublicNoteApprovalActions.logPress({
      value: data.value,
      workspaceType: WorkspaceType.Mattermost,
      userId: data.requester.userId,
      buttonAction: data.buttonAction,
      channelId: data.requester.channelId,
    });
  }
}
