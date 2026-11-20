import ObjectID from "../../../../../Types/ObjectID";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { SecurityPlaybookApprovalAnswerKind } from "../../../../../Utils/SecurityPlaybook/SecurityPlaybookApprovalWords";
import WorkspaceNotificationLogService from "../../../../Services/WorkspaceNotificationLogService";
import { SecurityPlaybookApprovalRound } from "../../../SecurityPlaybook/SecurityPlaybookApprovalReader";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import logger from "../../../Logger";
import Response from "../../../Response";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "../../WorkspaceActionAnswers";
import WorkspaceProductRefusal from "../../WorkspaceProductRefusal";
import WorkspaceSecurityPlaybookApproval from "../../WorkspaceSecurityPlaybookApproval";
import WorkspaceSecurityPlaybookApprovalActions, {
  SecurityPlaybookApprovalPressAnswer,
  SecurityPlaybookApprovalPressOutcome,
} from "../../WorkspaceSecurityPlaybookApprovalActions";
import SlackActionType from "./ActionTypes";
import SlackActionAnswer, { SlackAnswerPlace } from "./Answer";
import { SlackAction, SlackRequest } from "./Auth";
import SlackActionAuthorization from "./Authorization";

/*
 * A PLAYBOOK STEP WAITING FOR APPROVAL, DECIDED IN SLACK (#10341).
 *
 * The step's message - in a channel a Security Case rule names, or in an
 * approver's direct messages with the app - carries Approve, Approve Some…,
 * Reject and Open Case (WorkspaceSecurityPlaybookApproval). By the time a
 * press reaches here Slack signed the request, no older than five minutes
 * and never delivered before (SlackAuthorization), and the Slack account is
 * connected to a current member of the project - else they were asked to
 * connect, or told they are no longer a member (SlackAuthAction).
 *
 * What a press may do, and what it does, is
 * WorkspaceSecurityPlaybookApprovalActions', the same in Microsoft Teams;
 * this reads the press and answers it where it was made, only to the person
 * who pressed (SlackActionAnswer): a value this installation never signed,
 * a refusal, a press that came too late, or the decision. Approve Some…
 * opens a modal of the step's targets; its submission approves the ones
 * left ticked. Every copy of the message then says who decided
 * (WorkspaceSecurityPlaybookApprovalMessages).
 */
export default class SlackSecurityPlaybookApprovalActions {
  public static isSecurityPlaybookApprovalAction(data: {
    actionType: string;
  }): boolean {
    return WorkspaceSecurityPlaybookApproval.isApprovalAction(data.actionType);
  }

  @CaptureSpan()
  public static async handleSecurityPlaybookApprovalAction(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const actionType: string | undefined = data.action.actionType;

    if (
      !actionType ||
      !SlackSecurityPlaybookApprovalActions.isSecurityPlaybookApprovalAction({
        actionType,
      })
    ) {
      return Response.sendErrorResponse(
        data.req,
        data.res,
        new BadDataException("Invalid Action Type"),
      );
    }

    // Slack is answered at once - a modal's submission closes it - and the press is acted on after.
    Response.sendJsonObjectResponse(data.req, data.res, {
      response_action: "clear",
    });

    try {
      await SlackSecurityPlaybookApprovalActions.act({
        slackRequest: data.slackRequest,
        action: data.action,
        actionType,
      });
    } catch (err) {
      logger.error(
        `SlackSecurityPlaybookApprovalActions: could not act on ${actionType}: ${err}`,
        { projectId: data.slackRequest.projectId?.toString() },
      );

      // Nothing was decided: they are told so, and where to decide instead.
      await SlackSecurityPlaybookApprovalActions.answer(
        data.slackRequest,
        WorkspaceSecurityPlaybookApprovalActions.getAnswer({
          kind: SecurityPlaybookApprovalAnswerKind.CouldNotCheck,
        }),
      );
    }
  }

  private static async act(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    actionType: string;
  }): Promise<void> {
    const { slackRequest, actionType } = data;

    // A value this installation did not sign, or another project's: refused before anything is read.
    const round: SecurityPlaybookApprovalRound | null =
      WorkspaceSecurityPlaybookApprovalActions.readPressValue({
        actionValue: data.action.actionValue,
        projectId: slackRequest.projectId,
      });

    if (!round) {
      await SlackSecurityPlaybookApprovalActions.answer(
        slackRequest,
        WorkspaceSecurityPlaybookApprovalActions.getNotReadableAnswer(),
      );
      return;
    }

    const userId: ObjectID | undefined = slackRequest.userId;
    const projectId: ObjectID | undefined = slackRequest.projectId;

    // Never here without them: a press of these takes a connected account (SlackAuthAction).
    if (!userId || !projectId) {
      return;
    }

    const action: string =
      WorkspaceSecurityPlaybookApprovalActions.getAction(actionType);

    let pressed: SecurityPlaybookApprovalPressAnswer;

    try {
      pressed = await WorkspaceSecurityPlaybookApprovalActions.press({
        actionType,
        round,
        userId,
        projectId,
        from: WorkspaceType.Slack,
        isTicked: (field: string): boolean => {
          return WorkspaceSecurityPlaybookApproval.isSlackBoxTicked(
            slackRequest.viewValues?.[field],
          );
        },
      });
    } catch (err) {
      if (
        err instanceof NotAuthorizedException ||
        err instanceof PaymentRequiredException ||
        WorkspaceProductRefusal.isRefusal(err)
      ) {
        // Who they are, or what they may do, refused: told only them.
        await SlackActionAuthorization.sendRefusal({
          requester: slackRequest,
          message:
            err instanceof PaymentRequiredException
              ? `Could not ${action}: ${err.message}`
              : (err as Error).message,
        });
        return;
      }

      throw err;
    }

    if (pressed.outcome === SecurityPlaybookApprovalPressOutcome.ShowForm) {
      if (!pressed.read) {
        return;
      }

      await SlackActionAnswer.showModal({
        source: slackRequest,
        modalBlock: WorkspaceSecurityPlaybookApproval.getApproveSomeForm({
          ask: pressed.read.ask,
          round: pressed.read.round,
          language: pressed.language,
        }),
      });
      return;
    }

    await SlackSecurityPlaybookApprovalActions.answer(
      slackRequest,
      pressed.answer,
    );

    if (pressed.outcome === SecurityPlaybookApprovalPressOutcome.Decided) {
      await SlackSecurityPlaybookApprovalActions.logPress({
        slackRequest,
        userId,
        projectId,
        buttonAction:
          actionType === SlackActionType.RejectSecurityPlaybookStep
            ? "reject_security_playbook_step"
            : "approve_security_playbook_step",
      });
    }
  }

  // An answer only the presser sees, where they pressed.
  private static async answer(
    slackRequest: SlackRequest,
    answer: WorkspaceAnswer,
  ): Promise<void> {
    const place: SlackAnswerPlace | null =
      SlackActionAnswer.getPlace(slackRequest);

    if (!place || !answer.text) {
      return;
    }

    await SlackActionAnswer.answer({ place, answer });
  }

  // The press, in the project's workspace logs.
  private static async logPress(data: {
    slackRequest: SlackRequest;
    userId: ObjectID;
    projectId: ObjectID;
    buttonAction: string;
  }): Promise<void> {
    try {
      await WorkspaceNotificationLogService.logButtonPressed(
        {
          projectId: data.projectId,
          workspaceType: WorkspaceType.Slack,
          userId: data.userId,
          buttonAction: data.buttonAction,
          ...(data.slackRequest.slackChannelId
            ? { channelId: data.slackRequest.slackChannelId }
            : {}),
        },
        { isRoot: true },
      );
    } catch (err) {
      logger.error(`Could not log a playbook step's button press: ${err}`, {
        projectId: data.projectId.toString(),
      });
    }
  }
}
