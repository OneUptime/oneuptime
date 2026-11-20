import { TurnContext } from "../Botbuilder";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import FeedMarkdown from "../../../../../Utils/Markdown/FeedMarkdown";
import {
  SecurityPlaybookApprovalAnswerKind,
  SecurityPlaybookApprovalFormWords,
  SecurityPlaybookApprovalTarget,
  SecurityPlaybookApprovalWording,
  getProposedTargets,
  getSecurityPlaybookApprovalFormWords,
  wordSecurityPlaybookApproval,
} from "../../../../../Utils/SecurityPlaybook/SecurityPlaybookApprovalWords";
import {
  SecurityPlaybookApprovalRead,
  SecurityPlaybookApprovalRound,
} from "../../../SecurityPlaybook/SecurityPlaybookApprovalReader";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceProductRefusal from "../../WorkspaceProductRefusal";
import WorkspaceSecurityPlaybookApproval from "../../WorkspaceSecurityPlaybookApproval";
import WorkspaceSecurityPlaybookApprovalActions, {
  SecurityPlaybookApprovalPressAnswer,
  SecurityPlaybookApprovalPressOutcome,
} from "../../WorkspaceSecurityPlaybookApprovalActions";
import MicrosoftTeamsActionAnswer from "../MicrosoftTeamsActionAnswer";
import MicrosoftTeamsMessageSize from "../MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies, {
  MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
} from "../MicrosoftTeamsReplies";
import { MicrosoftTeamsSecurityPlaybookApprovalActionType } from "./ActionTypes";

/*
 * A PLAYBOOK STEP WAITING FOR APPROVAL, DECIDED IN MICROSOFT TEAMS (#10341).
 *
 * The step's card - in a channel or chat a Security Case rule names, or an
 * approver's personal chat with the bot - is drawn from the same blocks as
 * its Slack message, so its buttons carry Slack's ids
 * (WorkspaceSecurityPlaybookApproval). By the time a press reaches here the
 * Bot Framework's token on the request was checked by the SDK's adapter,
 * an activity delivered before was dropped (MicrosoftTeamsActivityDeduplicator),
 * and the Teams account is connected to a current member of the project,
 * whose props were read (MicrosoftTeamsUtil.handleBotInvokeActivity) - an
 * account not connected is asked to connect, and presses again.
 *
 * What a press may do, and what it does, is
 * WorkspaceSecurityPlaybookApprovalActions', as in Slack:
 *
 *  - Approve and Reject decide at once.
 *  - Approve Some… answers with a card of the step's targets, every one
 *    ticked; its own Approve approves the ones left ticked, and the card is
 *    removed once it has.
 *
 * Every answer is a reply that mentions the person who pressed, in the
 * conversation they pressed in (MicrosoftTeamsActionAnswer): Teams has no
 * reply only one person sees, and a personal chat is theirs alone. A
 * refusal of who they are or what they may do is thrown, and answered so by
 * the bot's own catch, as every press's is. Every copy of the card then says
 * who decided (WorkspaceSecurityPlaybookApprovalMessages).
 */
export default class MicrosoftTeamsSecurityPlaybookApprovalActions {
  public static isSecurityPlaybookApprovalAction(actionType: string): boolean {
    return (
      Object.values(
        MicrosoftTeamsSecurityPlaybookApprovalActionType,
      ) as Array<string>
    ).includes(actionType);
  }

  @CaptureSpan()
  public static async handle(data: {
    actionType: string;
    actionValue: string | undefined;
    // What the card sent: its button's data, and the boxes of Approve Some's card.
    value: JSONObject;
    projectId: ObjectID;
    oneUptimeUserId: ObjectID;
    turnContext: TurnContext;
  }): Promise<void> {
    // A value this bot never signed, or another project's: refused before anything is read.
    const round: SecurityPlaybookApprovalRound | null =
      WorkspaceSecurityPlaybookApprovalActions.readPressValue({
        actionValue: data.actionValue,
        projectId: data.projectId,
      });

    if (!round) {
      await MicrosoftTeamsActionAnswer.reply({
        turnContext: data.turnContext,
        answer: WorkspaceSecurityPlaybookApprovalActions.getNotReadableAnswer(),
      });
      return;
    }

    let pressed: SecurityPlaybookApprovalPressAnswer;

    try {
      pressed = await WorkspaceSecurityPlaybookApprovalActions.press({
        actionType: data.actionType,
        round,
        userId: data.oneUptimeUserId,
        projectId: data.projectId,
        from: WorkspaceType.MicrosoftTeams,
        isTicked: (field: string): boolean => {
          return MicrosoftTeamsSecurityPlaybookApprovalActions.isTicked(
            data.value[field],
          );
        },
      });
    } catch (err) {
      // Who they are, or what they may do: the bot's catch answers it.
      if (
        err instanceof NotAuthorizedException ||
        err instanceof PaymentRequiredException ||
        WorkspaceProductRefusal.isRefusal(err)
      ) {
        throw err;
      }

      logger.error(
        `MicrosoftTeamsSecurityPlaybookApprovalActions: could not act on ${data.actionType}: ${err}`,
        { projectId: data.projectId.toString() },
      );

      // Nothing was decided: they are told so, and where to decide instead.
      await MicrosoftTeamsActionAnswer.reply({
        turnContext: data.turnContext,
        answer: WorkspaceSecurityPlaybookApprovalActions.getAnswer({
          kind: SecurityPlaybookApprovalAnswerKind.CouldNotCheck,
        }),
      });
      return;
    }

    if (pressed.outcome === SecurityPlaybookApprovalPressOutcome.ShowForm) {
      if (!pressed.read) {
        return;
      }

      const card: JSONObject =
        MicrosoftTeamsSecurityPlaybookApprovalActions.buildApproveSomeCard({
          read: pressed.read,
          language: pressed.language,
        });

      await MicrosoftTeamsReplies.sendBestEffort(data.turnContext, {
        attachments: [
          {
            contentType: MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
            content: card,
          },
        ],
        summary: getSecurityPlaybookApprovalFormWords(
          WorkspaceSecurityPlaybookApproval.getContext(pressed.language)
            .translator,
        ).title,
      });
      return;
    }

    await MicrosoftTeamsActionAnswer.reply({
      turnContext: data.turnContext,
      answer: pressed.answer,
    });

    /*
     * Approve Some's card, once it approved: removed - best-effort, as
     * every submitted form is - since it has done its work, and left on
     * screen it would invite another press. One that was refused stays, to
     * be put right.
     */
    if (
      pressed.outcome === SecurityPlaybookApprovalPressOutcome.Decided &&
      data.actionType ===
        MicrosoftTeamsSecurityPlaybookApprovalActionType.SubmitApproveSomeSecurityPlaybookStep
    ) {
      await MicrosoftTeamsReplies.deleteBestEffort(
        data.turnContext,
        data.turnContext.activity.replyToId,
      );
    }
  }

  // Whether a card's box came back ticked: Teams sends a toggle's value as text.
  public static isTicked(value: unknown): boolean {
    return value === true || value === "true";
  }

  /*
   * Approve Some's card: its title, what the step does and what the card
   * asks, a box for each target the step proposes - every one ticked,
   * named by the target and why it is one - and Approve, which carries the
   * button's value. A card over what Teams takes has its longest text cut
   * (fitAdaptiveCard).
   */
  public static buildApproveSomeCard(data: {
    read: SecurityPlaybookApprovalRead;
    language: string;
  }): JSONObject {
    const context: ReturnType<
      typeof WorkspaceSecurityPlaybookApproval.getContext
    > = WorkspaceSecurityPlaybookApproval.getContext(data.language);
    const words: SecurityPlaybookApprovalFormWords =
      getSecurityPlaybookApprovalFormWords(context.translator);
    const wording: SecurityPlaybookApprovalWording =
      wordSecurityPlaybookApproval({ ask: data.read.ask, context });
    const proposed: Array<SecurityPlaybookApprovalTarget> = getProposedTargets(
      data.read.ask,
    );

    const boxes: Array<JSONObject> = proposed.map(
      (target: SecurityPlaybookApprovalTarget, index: number): JSONObject => {
        const line: string =
          wording.targets[data.read.ask.targets.indexOf(target)]?.text ||
          target.value;

        return {
          type: "Input.Toggle",
          id: WorkspaceSecurityPlaybookApproval.getTargetField(index),
          title: line,
          value: "true",
          valueOn: "true",
          valueOff: "false",
          wrap: true,
        };
      },
    );

    return MicrosoftTeamsMessageSize.fitAdaptiveCard({
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: words.title,
          size: "Large",
          weight: "Bolder",
          wrap: true,
        },
        {
          type: "TextBlock",
          text: MicrosoftTeamsMessageSize.fitMarkdownText(
            wording.action.markdown.toString(),
          ),
          wrap: true,
          spacing: "Medium",
        },
        {
          type: "TextBlock",
          text: FeedMarkdown.templateText(words.intro),
          wrap: true,
          spacing: "Small",
        },
        ...boxes,
      ],
      actions: [
        {
          type: "Action.Submit",
          title: words.submit,
          style: "positive",
          data: {
            action:
              MicrosoftTeamsSecurityPlaybookApprovalActionType.SubmitApproveSomeSecurityPlaybookStep,
            actionValue: WorkspaceSecurityPlaybookApproval.encodeValue(
              data.read.round,
            ),
          },
        },
      ],
    });
  }
}
