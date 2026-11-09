import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import logger from "../../../Logger";
import Response from "../../../Response";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "../../WorkspaceActionAnswers";
import WorkspacePublicNoteApproval, {
  PUBLIC_NOTE_REJECT_REASON_FIELD,
  PublicNoteApprovalButtonValue,
} from "../../WorkspacePublicNoteApproval";
import WorkspacePublicNoteApprovalActions, {
  PublicNoteApprovalPressAnswer,
  PublicNoteApprovalPressOutcome,
  PublicNoteRejectFormResult,
} from "../../WorkspacePublicNoteApprovalActions";
import SlackActionType from "./ActionTypes";
import SlackActionAnswer, { SlackAnswerPlace } from "./Answer";
import { SlackAction, SlackRequest } from "./Auth";
import SlackActionAuthorization from "./Authorization";

/*
 * APPROVE AND REJECT ON A PUBLIC NOTE'S APPROVAL MESSAGE, IN SLACK.
 *
 * An approver who chose chat for public note approval gets the note in a
 * direct message from OneUptime's app (WorkspacePublicNoteApproval), with
 * Approve and Reject. A press there is read as every press is
 * (SlackAuthAction): the project - the one the button was signed for, in a
 * workspace connected to several - and the member the Slack account is
 * connected to there; an account not connected yet is asked to connect,
 * and its Approve is decided for it once it is (SlackConnectPrompt). What a
 * press does is WorkspacePublicNoteApprovalActions', as in Microsoft Teams
 * and Mattermost:
 *
 *  - Approve decides at once.
 *  - Reject opens a modal that asks why; its submission rejects the note. A
 *    reason that is missing or too long keeps the modal open, saying so
 *    under the field - Slack counts the characters as they are typed, and
 *    the submission is checked again.
 *
 * Slack is answered at once, and the press is acted on after. What it came
 * to - decided, news of a note that changed or was decided already, or a
 * refusal in the engine's words - is answered where it was made, only to
 * the presser (SlackActionAnswer).
 */
export default class SlackPublicNoteApprovalActions {
  public static isPublicNoteApprovalAction(data: {
    actionType: string;
  }): boolean {
    return WorkspacePublicNoteApproval.isApprovalAction(data.actionType);
  }

  @CaptureSpan()
  public static async handlePublicNoteApprovalAction(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const actionType: string | undefined = data.action.actionType;

    if (
      !actionType ||
      !SlackPublicNoteApprovalActions.isPublicNoteApprovalAction({
        actionType,
      })
    ) {
      return Response.sendErrorResponse(
        data.req,
        data.res,
        new BadDataException("Invalid Action Type"),
      );
    }

    /*
     * Reject's modal, submitted: a reason that cannot be sent is said under
     * its field, and the modal stays open.
     */
    if (actionType === SlackActionType.SubmitRejectPublicNote) {
      const reasonError: string | null =
        WorkspacePublicNoteApprovalActions.getReasonError(
          data.slackRequest.viewValues?.[PUBLIC_NOTE_REJECT_REASON_FIELD],
        );

      if (reasonError) {
        return Response.sendJsonObjectResponse(data.req, data.res, {
          response_action: "errors",
          errors: {
            [PUBLIC_NOTE_REJECT_REASON_FIELD]: reasonError,
          },
        });
      }
    }

    // Slack is answered at once; the press is acted on after.
    Response.sendJsonObjectResponse(data.req, data.res, {
      response_action: "clear",
    });

    try {
      await SlackPublicNoteApprovalActions.act({
        slackRequest: data.slackRequest,
        action: data.action,
        actionType: actionType as SlackActionType,
      });
    } catch (err) {
      logger.error(
        `SlackPublicNoteApprovalActions: could not act on ${actionType}: ${err}`,
        { projectId: data.slackRequest.projectId?.toString() },
      );
    }
  }

  private static async act(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    actionType: SlackActionType;
  }): Promise<void> {
    const { slackRequest, actionType } = data;
    const isApprove: boolean = actionType === SlackActionType.ApprovePublicNote;

    const value: PublicNoteApprovalButtonValue | null =
      WorkspacePublicNoteApproval.readValue(data.action.actionValue);

    /*
     * A value this installation did not sign, or one signed for a project
     * the press was not read in, decides nothing.
     */
    if (
      !value ||
      !slackRequest.projectId ||
      value.projectId.toString().toLowerCase() !==
        slackRequest.projectId.toString().toLowerCase()
    ) {
      await SlackActionAuthorization.sendRefusal({
        requester: slackRequest,
        message: WorkspacePublicNoteApprovalActions.getUnverifiedMessage(),
      });
      return;
    }

    // Who pressed, as the member, refused where they pressed when they are not.
    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.getMemberProps({
        requester: slackRequest,
        action: isApprove
          ? WorkspacePublicNoteApprovalActions.APPROVE_ACTION
          : WorkspacePublicNoteApprovalActions.REJECT_ACTION,
      });

    if (!props || !slackRequest.userId) {
      return;
    }

    if (isApprove) {
      const approved: PublicNoteApprovalPressAnswer =
        await WorkspacePublicNoteApprovalActions.approve({
          value: value,
          props: props,
        });

      await SlackPublicNoteApprovalActions.answer(
        slackRequest,
        approved.answer,
      );
      await SlackPublicNoteApprovalActions.logIfDecided({
        result: approved,
        slackRequest: slackRequest,
        value: value,
        buttonAction: "approve_public_note",
      });
      return;
    }

    if (actionType === SlackActionType.ViewRejectPublicNote) {
      const reject: PublicNoteRejectFormResult =
        await WorkspacePublicNoteApprovalActions.getRejectForm({
          value: value,
          props: props,
          workspaceType: WorkspaceType.Slack,
        });

      if (!reject.form) {
        if (reject.answer) {
          await SlackPublicNoteApprovalActions.answer(
            slackRequest,
            reject.answer.answer,
          );
        }

        return;
      }

      await SlackActionAnswer.showModal({
        source: slackRequest,
        modalBlock: reject.form,
      });
      return;
    }

    const rejected: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.reject({
        value: value,
        props: props,
        reason: slackRequest.viewValues?.[PUBLIC_NOTE_REJECT_REASON_FIELD],
      });

    await SlackPublicNoteApprovalActions.answer(slackRequest, rejected.answer);
    await SlackPublicNoteApprovalActions.logIfDecided({
      result: rejected,
      slackRequest: slackRequest,
      value: value,
      buttonAction: "reject_public_note",
    });
  }

  // An answer only the presser sees, where they pressed.
  private static async answer(
    slackRequest: SlackRequest,
    answer: WorkspaceAnswer,
  ): Promise<void> {
    const place: SlackAnswerPlace | null =
      SlackActionAnswer.getPlace(slackRequest);

    if (!place) {
      return;
    }

    await SlackActionAnswer.answer({ place, answer });
  }

  private static async logIfDecided(data: {
    result: PublicNoteApprovalPressAnswer;
    slackRequest: SlackRequest;
    value: PublicNoteApprovalButtonValue;
    buttonAction: "approve_public_note" | "reject_public_note";
  }): Promise<void> {
    if (
      data.result.outcome !== PublicNoteApprovalPressOutcome.Decided ||
      !data.slackRequest.userId
    ) {
      return;
    }

    await WorkspacePublicNoteApprovalActions.logPress({
      value: data.value,
      workspaceType: WorkspaceType.Slack,
      userId: data.slackRequest.userId,
      buttonAction: data.buttonAction,
      channelId: data.slackRequest.slackChannelId,
    });
  }
}
