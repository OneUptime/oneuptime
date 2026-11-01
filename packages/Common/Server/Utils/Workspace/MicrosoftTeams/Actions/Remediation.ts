import { TurnContext } from "../Botbuilder";
import AutoRemediationSuggestion from "../../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { RemediationActionValue } from "../../../AutoRemediation/RemediationChatMessage";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "../../WorkspaceActionAnswers";
import WorkspaceRemediationActions, {
  RemediationApprovalDialog,
} from "../../WorkspaceRemediationActions";
import MicrosoftTeamsActionAnswer from "../MicrosoftTeamsActionAnswer";
import MicrosoftTeamsMessageSize from "../MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies from "../MicrosoftTeamsReplies";
import { MicrosoftTeamsRemediationActionType } from "./ActionTypes";

/*
 * A FIX ONEUPTIME AI PROPOSES, APPROVED OR DISMISSED IN MICROSOFT TEAMS.
 *
 * The card of a fix that waits for approval is drawn from the same blocks
 * as its Slack message (RemediationChatMessage), so its buttons carry
 * Slack's ids. Review and approve answers with a card of everything the fix
 * runs and Approve and run; Dismiss dismisses it. Who may press, what each
 * does and what it answers is WorkspaceRemediationActions', as in Slack;
 * a refusal (NotAuthorizedException) or a fix that changed
 * (BadDataException) is answered by the bot's own catch, where every other
 * press's refusal is. An approval needs no answer of its own: the record's
 * feed says who approved the fix, from Microsoft Teams, in the channel.
 */

// A card's content type, as every card the bot sends names it.
const ADAPTIVE_CARD_CONTENT_TYPE: string =
  "application/vnd.microsoft.card.adaptive";

export default class MicrosoftTeamsRemediationActions {
  public static isRemediationAction(actionType: string): boolean {
    return (
      Object.values(MicrosoftTeamsRemediationActionType) as Array<string>
    ).includes(actionType);
  }

  @CaptureSpan()
  public static async handle(data: {
    actionType: string;
    actionValue: string | undefined;
    projectId: ObjectID;
    oneUptimeUserId: ObjectID;
    turnContext: TurnContext;
  }): Promise<void> {
    const action: string =
      data.actionType === MicrosoftTeamsRemediationActionType.DismissRemediation
        ? WorkspaceRemediationActions.DISMISS_ACTION
        : WorkspaceRemediationActions.APPROVE_ACTION;

    // A value this bot never wrote is refused before anything is read.
    const value: RemediationActionValue =
      WorkspaceRemediationActions.readValue(data.actionValue);

    const suggestion: AutoRemediationSuggestion | null =
      await WorkspaceRemediationActions.readFix({
        suggestionId: value.suggestionId,
        projectId: data.projectId,
      });

    if (!suggestion) {
      await MicrosoftTeamsActionAnswer.reply({
        turnContext: data.turnContext,
        answer: {
          markdown: WorkspaceRemediationActions.getNotFoundMessage(),
          text: WorkspaceRemediationActions.getNotFoundMessage(),
        },
      });
      return;
    }

    // Throws NotAuthorizedException, which the bot answers in their words.
    const props: DatabaseCommonInteractionProps =
      await WorkspaceRemediationActions.authorize({
        userId: data.oneUptimeUserId,
        projectId: data.projectId,
        suggestion,
        action,
      });

    const late: WorkspaceAnswer | null =
      await WorkspaceRemediationActions.getLatePressAnswer(suggestion);

    if (late) {
      await MicrosoftTeamsActionAnswer.reply({
        turnContext: data.turnContext,
        answer: late,
      });
      return;
    }

    if (
      data.actionType ===
      MicrosoftTeamsRemediationActionType.ViewApproveRemediation
    ) {
      const dialog: RemediationApprovalDialog | null =
        await WorkspaceRemediationActions.getApprovalDialog(suggestion);

      if (!dialog) {
        await MicrosoftTeamsActionAnswer.reply({
          turnContext: data.turnContext,
          answer: {
            markdown: WorkspaceRemediationActions.getNotFoundMessage(),
            text: WorkspaceRemediationActions.getNotFoundMessage(),
          },
        });
        return;
      }

      await MicrosoftTeamsReplies.sendBestEffort(data.turnContext, {
        attachments: [
          {
            contentType: ADAPTIVE_CARD_CONTENT_TYPE,
            content: MicrosoftTeamsRemediationActions.buildApprovalCard(dialog),
          },
        ],
        summary: dialog.title,
      });
      return;
    }

    if (
      data.actionType ===
      MicrosoftTeamsRemediationActionType.SubmitApproveRemediation
    ) {
      await WorkspaceRemediationActions.approve({
        props,
        value,
        from: WorkspaceType.MicrosoftTeams,
      });

      // The approval card has done its work; the feed says the rest.
      await MicrosoftTeamsReplies.deleteBestEffort(
        data.turnContext,
        data.turnContext.activity.replyToId,
      );
      return;
    }

    const answer: WorkspaceAnswer = await WorkspaceRemediationActions.dismiss({
      props,
      value,
      from: WorkspaceType.MicrosoftTeams,
    });

    await MicrosoftTeamsActionAnswer.reply({
      turnContext: data.turnContext,
      answer,
    });
  }

  /*
   * The approval card: the dialog's title and everything the fix runs, and
   * Approve and run, which carries the fix and its fingerprint.
   */
  public static buildApprovalCard(dialog: RemediationApprovalDialog): JSONObject {
    return {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: dialog.title,
          size: "Large",
          weight: "Bolder",
          wrap: true,
        },
        {
          type: "TextBlock",
          text: MicrosoftTeamsMessageSize.fitMarkdownText(dialog.markdown),
          wrap: true,
        },
      ],
      actions: [
        {
          type: "Action.Submit",
          title: dialog.submitTitle,
          style: "positive",
          data: {
            action: MicrosoftTeamsRemediationActionType.SubmitApproveRemediation,
            actionValue: dialog.value,
          },
        },
      ],
    };
  }
}
