import AutoRemediationSuggestion from "../../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { RemediationActionValue } from "../../../AutoRemediation/RemediationChatMessage";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import logger from "../../../Logger";
import Response from "../../../Response";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";
import { WorkspaceAnswer } from "../../WorkspaceActionAnswers";
import WorkspaceRemediationActions, {
  RemediationApprovalDialog,
} from "../../WorkspaceRemediationActions";
import SlackActionType from "./ActionTypes";
import SlackActionAnswer, { SlackAnswerPlace } from "./Answer";
import { SlackAction, SlackRequest } from "./Auth";
import SlackActionAuthorization from "./Authorization";

/*
 * A FIX ONEUPTIME AI PROPOSES, APPROVED OR DISMISSED IN SLACK.
 *
 * The message of a fix that waits for approval carries Review and approve
 * and Dismiss (RemediationChatMessage). Review and approve opens a modal
 * with everything the fix runs and Approve and run; Dismiss dismisses it.
 * Who may press, what each does and what it answers is
 * WorkspaceRemediationActions', the same in Microsoft Teams; this reads the
 * press and answers it where it was made (SlackActionAnswer): a refusal,
 * or a press that came too late, in a message only the presser sees. An
 * approval needs no answer of its own: the record's feed says who approved
 * the fix, from Slack, in the channel.
 */
export default class SlackRemediationActions {
  public static isRemediationAction(data: { actionType: string }): boolean {
    return (
      data.actionType === SlackActionType.ViewApproveRemediation ||
      data.actionType === SlackActionType.SubmitApproveRemediation ||
      data.actionType === SlackActionType.DismissRemediation
    );
  }

  @CaptureSpan()
  public static async handleRemediationAction(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const actionType: string | undefined = data.action.actionType;

    if (
      !actionType ||
      !SlackRemediationActions.isRemediationAction({ actionType })
    ) {
      return Response.sendErrorResponse(
        data.req,
        data.res,
        new BadDataException("Invalid Action Type"),
      );
    }

    // Slack is answered at once; the press is acted on after.
    Response.sendJsonObjectResponse(data.req, data.res, {
      response_action: "clear",
    });

    try {
      await SlackRemediationActions.act({
        slackRequest: data.slackRequest,
        action: data.action,
        actionType: actionType as SlackActionType,
      });
    } catch (err) {
      logger.error(
        `SlackRemediationActions: could not act on ${actionType}: ${err}`,
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
    const action: string =
      actionType === SlackActionType.DismissRemediation
        ? WorkspaceRemediationActions.DISMISS_ACTION
        : WorkspaceRemediationActions.APPROVE_ACTION;

    // The fix the button names, and the fingerprint it was posted with.
    const value: RemediationActionValue | null =
      await SlackActionAuthorization.runForRequester({
        requester: slackRequest,
        action: action,
        run: async (): Promise<RemediationActionValue> => {
          return WorkspaceRemediationActions.readValue(
            data.action.actionValue,
          );
        },
      });

    if (!value || !slackRequest.projectId || !slackRequest.userId) {
      return;
    }

    const suggestion: AutoRemediationSuggestion | null =
      await WorkspaceRemediationActions.readFix({
        suggestionId: value.suggestionId,
        projectId: slackRequest.projectId,
      });

    if (!suggestion) {
      await SlackActionAuthorization.sendRefusal({
        requester: slackRequest,
        message: WorkspaceRemediationActions.getNotFoundMessage(),
      });
      return;
    }

    // Who may press it, before anything about the fix is shown or done.
    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.runForRequester({
        requester: slackRequest,
        action: action,
        run: async (): Promise<DatabaseCommonInteractionProps> => {
          return await WorkspaceRemediationActions.authorize({
            userId: slackRequest.userId!,
            projectId: slackRequest.projectId!,
            suggestion,
            action,
          });
        },
      });

    if (!props) {
      return;
    }

    // Somebody got there first: say who and when, as news.
    const late: WorkspaceAnswer | null =
      await WorkspaceRemediationActions.getLatePressAnswer(suggestion);

    if (late) {
      await SlackRemediationActions.answer(slackRequest, late);
      return;
    }

    if (actionType === SlackActionType.ViewApproveRemediation) {
      await SlackRemediationActions.showApprovalDialog({
        slackRequest,
        suggestion,
      });
      return;
    }

    if (actionType === SlackActionType.SubmitApproveRemediation) {
      const approved: boolean | null =
        await SlackActionAuthorization.runForRequester({
          requester: slackRequest,
          action: "approve the fix",
          run: async (): Promise<boolean> => {
            await WorkspaceRemediationActions.approve({
              props,
              value,
              from: WorkspaceType.Slack,
            });
            return true;
          },
        });

      if (approved) {
        await SlackRemediationActions.logPress({
          slackRequest,
          buttonAction: "approve_remediation",
          suggestion,
        });
      }

      return;
    }

    const dismissed: WorkspaceAnswer | null =
      await SlackActionAuthorization.runForRequester({
        requester: slackRequest,
        action: "dismiss the fix",
        run: async (): Promise<WorkspaceAnswer> => {
          return await WorkspaceRemediationActions.dismiss({
            props,
            value,
            from: WorkspaceType.Slack,
          });
        },
      });

    if (dismissed) {
      await SlackRemediationActions.answer(slackRequest, dismissed);
      await SlackRemediationActions.logPress({
        slackRequest,
        buttonAction: "dismiss_remediation",
        suggestion,
      });
    }
  }

  // Review and approve: the modal with everything the fix runs.
  private static async showApprovalDialog(data: {
    slackRequest: SlackRequest;
    suggestion: AutoRemediationSuggestion;
  }): Promise<void> {
    const dialog: RemediationApprovalDialog | null =
      await WorkspaceRemediationActions.getApprovalDialog(data.suggestion);

    if (!dialog) {
      await SlackActionAuthorization.sendRefusal({
        requester: data.slackRequest,
        message: WorkspaceRemediationActions.getNotFoundMessage(),
      });
      return;
    }

    const body: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: dialog.markdown,
    };

    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: dialog.title,
      submitButtonTitle: dialog.submitTitle,
      cancelButtonTitle: dialog.cancelTitle,
      actionId: SlackActionType.SubmitApproveRemediation,
      actionValue: dialog.value,
      blocks: [body],
    };

    await SlackActionAnswer.showModal({
      source: data.slackRequest,
      modalBlock: modalBlock,
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

  // The button press, in the project's workspace logs.
  private static async logPress(data: {
    slackRequest: SlackRequest;
    buttonAction: string;
    suggestion: AutoRemediationSuggestion;
  }): Promise<void> {
    if (!data.slackRequest.projectId || !data.slackRequest.userId) {
      return;
    }

    try {
      const logData: {
        projectId: ObjectID;
        workspaceType: WorkspaceType;
        channelId?: string;
        userId: ObjectID;
        buttonAction: string;
        incidentId?: ObjectID;
        alertId?: ObjectID;
      } = {
        projectId: data.slackRequest.projectId,
        workspaceType: WorkspaceType.Slack,
        userId: data.slackRequest.userId,
        buttonAction: data.buttonAction,
      };

      if (data.slackRequest.slackChannelId) {
        logData.channelId = data.slackRequest.slackChannelId;
      }

      if (data.suggestion.incidentId) {
        logData.incidentId = data.suggestion.incidentId;
      }

      if (data.suggestion.alertId) {
        logData.alertId = data.suggestion.alertId;
      }

      await WorkspaceNotificationLogService.logButtonPressed(logData, {
        isRoot: true,
      });
    } catch (err) {
      logger.error(`Could not log a fix's button press: ${err}`, {
        projectId: data.slackRequest.projectId.toString(),
      });
    }
  }
}
