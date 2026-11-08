import { TurnContext } from "../Botbuilder";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { PublicNoteApprovalMessages } from "../../../../../Types/StatusPage/PublicNoteApproval";
import {
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
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
import MicrosoftTeamsActionAnswer from "../MicrosoftTeamsActionAnswer";
import MicrosoftTeamsMessageSize from "../MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies, {
  MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
} from "../MicrosoftTeamsReplies";
import { MicrosoftTeamsPublicNoteApprovalActionType } from "./ActionTypes";

/*
 * APPROVE AND REJECT ON A PUBLIC NOTE'S APPROVAL MESSAGE, IN MICROSOFT TEAMS.
 *
 * An approver who chose chat for public note approval gets the note in a
 * personal chat with OneUptime's bot (WorkspacePublicNoteApproval): a card
 * drawn from the same blocks as the Slack message, so its buttons carry
 * Slack's ids, and the project it was sent for on each of them
 * (MicrosoftTeamsCardProject). A press is read as every card's press is
 * (MicrosoftTeamsUtil.handleBotInvokeActivity): the project, the member
 * the Teams account is connected to there, with their own props - an
 * account not connected yet is asked to connect, and its Approve is decided
 * for it once it is (MicrosoftTeamsConnectPrompt). What a press does is
 * WorkspacePublicNoteApprovalActions', as in Slack and Mattermost:
 *
 *  - Approve decides at once.
 *  - Reject answers with a card that asks why - the reason is required and
 *    Teams counts its characters as they are typed - and its own Reject
 *    rejects the note, after the reason is checked again. Once it has, the
 *    card is removed: it has done its work. A reason that cannot be sent
 *    keeps it, to be put right.
 *
 * Every answer is a reply in the chat it was pressed in. Teams has no reply
 * only one person sees, and a personal chat is theirs alone.
 */
export default class MicrosoftTeamsPublicNoteApprovalActions {
  public static isPublicNoteApprovalAction(actionType: string): boolean {
    return (
      Object.values(MicrosoftTeamsPublicNoteApprovalActionType) as Array<string>
    ).includes(actionType);
  }

  @CaptureSpan()
  public static async handle(data: {
    actionType: string;
    actionValue: string | undefined;
    // What the card sent: its button's data, and the reason typed in it.
    value: JSONObject;
    projectId: ObjectID;
    oneUptimeUserId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> {
    const value: PublicNoteApprovalButtonValue | null =
      WorkspacePublicNoteApproval.readValue(data.actionValue);

    /*
     * A value this installation did not sign - one a client made up - or
     * one signed for a project the press was not read in decides nothing.
     */
    if (
      !value ||
      value.projectId.toString().toLowerCase() !==
        data.projectId.toString().toLowerCase()
    ) {
      await MicrosoftTeamsPublicNoteApprovalActions.reply(
        data.turnContext,
        WorkspacePublicNoteApprovalActions.getUnverifiedMessage(),
      );
      return;
    }

    if (
      data.actionType ===
      MicrosoftTeamsPublicNoteApprovalActionType.ApprovePublicNote
    ) {
      const approved: PublicNoteApprovalPressAnswer =
        await WorkspacePublicNoteApprovalActions.approve({
          value: value,
          props: data.databaseProps,
        });

      await MicrosoftTeamsActionAnswer.reply({
        turnContext: data.turnContext,
        answer: approved.answer,
      });
      await MicrosoftTeamsPublicNoteApprovalActions.logIfDecided({
        result: approved,
        value: value,
        userId: data.oneUptimeUserId,
        turnContext: data.turnContext,
        buttonAction: "approve_public_note",
      });
      return;
    }

    if (
      data.actionType ===
      MicrosoftTeamsPublicNoteApprovalActionType.ViewRejectPublicNote
    ) {
      const reject: PublicNoteRejectFormResult =
        await WorkspacePublicNoteApprovalActions.getRejectForm({
          value: value,
          props: data.databaseProps,
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

      if (!reject.form) {
        if (reject.answer) {
          await MicrosoftTeamsActionAnswer.reply({
            turnContext: data.turnContext,
            answer: reject.answer.answer,
          });
        }

        return;
      }

      await MicrosoftTeamsReplies.sendBestEffort(data.turnContext, {
        attachments: [
          {
            contentType: MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
            content: MicrosoftTeamsPublicNoteApprovalActions.buildRejectCard(
              reject.form,
            ),
          },
        ],
        summary: reject.form.title,
      });
      return;
    }

    // The card that asks why, sent: its reason checked again first.
    const reason: unknown = data.value[PUBLIC_NOTE_REJECT_REASON_FIELD];
    const reasonError: string | null =
      WorkspacePublicNoteApprovalActions.getReasonError(reason);

    if (reasonError) {
      await MicrosoftTeamsPublicNoteApprovalActions.reply(
        data.turnContext,
        reasonError,
      );
      return;
    }

    const rejected: PublicNoteApprovalPressAnswer =
      await WorkspacePublicNoteApprovalActions.reject({
        value: value,
        props: data.databaseProps,
        reason: reason,
      });

    await MicrosoftTeamsActionAnswer.reply({
      turnContext: data.turnContext,
      answer: rejected.answer,
    });
    await MicrosoftTeamsPublicNoteApprovalActions.logIfDecided({
      result: rejected,
      value: value,
      userId: data.oneUptimeUserId,
      turnContext: data.turnContext,
      buttonAction: "reject_public_note",
    });

    /*
     * The card has done its work - the note is rejected, or the answer says
     * why it no longer can be - so it is removed, best effort: left there,
     * it would invite a second press.
     */
    await MicrosoftTeamsReplies.deleteBestEffort(
      data.turnContext,
      data.turnContext.activity.replyToId,
    );
  }

  /*
   * The card Reject answers with: the form's title and words, the reason -
   * required, and counted as it is typed - and its Reject, which carries the
   * button's value. A card over what Teams takes has its longest text cut
   * (fitAdaptiveCard).
   */
  public static buildRejectCard(form: WorkspaceModalBlock): JSONObject {
    const description: WorkspacePayloadMarkdown | undefined = form.blocks.find(
      (block: WorkspaceMessageBlock): boolean => {
        return block._type === "WorkspacePayloadMarkdown";
      },
    ) as WorkspacePayloadMarkdown | undefined;

    const reason: WorkspaceTextAreaBlock | undefined = form.blocks.find(
      (block: WorkspaceMessageBlock): boolean => {
        return block._type === "WorkspaceTextAreaBlock";
      },
    ) as WorkspaceTextAreaBlock | undefined;

    const body: Array<JSONObject> = [
      {
        type: "TextBlock",
        text: form.title,
        size: "Large",
        weight: "Bolder",
        wrap: true,
      },
    ];

    if (description?.text) {
      body.push({
        type: "TextBlock",
        text: MicrosoftTeamsMessageSize.fitMarkdownText(description.text),
        wrap: true,
      });
    }

    if (reason) {
      const input: JSONObject = {
        type: "Input.Text",
        id: reason.blockId,
        label: reason.label,
        placeholder: reason.placeholder,
        isMultiline: true,
        isRequired: true,
        errorMessage: PublicNoteApprovalMessages.reasonRequired,
      };

      if (reason.maxLength) {
        input["maxLength"] = reason.maxLength;
      }

      body.push(input);

      if (reason.description) {
        body.push({
          type: "TextBlock",
          text: reason.description,
          isSubtle: true,
          size: "Small",
          wrap: true,
        });
      }
    }

    return MicrosoftTeamsMessageSize.fitAdaptiveCard({
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: body,
      actions: [
        {
          type: "Action.Submit",
          title: form.submitButtonTitle,
          style: "destructive",
          data: {
            action: form.actionId,
            actionValue: form.actionValue,
          },
        },
      ],
    });
  }

  // A refusal or a check that failed, told in the chat it was pressed in.
  private static async reply(
    turnContext: TurnContext,
    message: string,
  ): Promise<void> {
    const answer: WorkspaceAnswer = {
      markdown: mdText`${message}`.toString(),
      text: message,
    };

    await MicrosoftTeamsActionAnswer.reply({ turnContext, answer });
  }

  private static async logIfDecided(data: {
    result: PublicNoteApprovalPressAnswer;
    value: PublicNoteApprovalButtonValue;
    userId: ObjectID;
    turnContext: TurnContext;
    buttonAction: "approve_public_note" | "reject_public_note";
  }): Promise<void> {
    if (data.result.outcome !== PublicNoteApprovalPressOutcome.Decided) {
      return;
    }

    const conversationId: unknown = (
      data.turnContext.activity as unknown as JSONObject
    )?.["conversation"]
      ? ((data.turnContext.activity as unknown as JSONObject)[
          "conversation"
        ] as JSONObject)["id"]
      : undefined;

    await WorkspacePublicNoteApprovalActions.logPress({
      value: data.value,
      workspaceType: WorkspaceType.MicrosoftTeams,
      userId: data.userId,
      buttonAction: data.buttonAction,
      channelId: typeof conversationId === "string" ? conversationId : undefined,
    });
  }
}
