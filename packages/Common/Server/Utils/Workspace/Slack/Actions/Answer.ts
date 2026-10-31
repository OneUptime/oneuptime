import URL from "../../../../../Types/API/URL";
import ObjectID from "../../../../../Types/ObjectID";
import { JSONObject } from "../../../../../Types/JSON";
import {
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import ProductBrandingText from "../../../ProductBrandingText";
import WorkspaceActionAnswers, {
  WorkspaceAnswer,
  WorkspaceLatePress,
} from "../../WorkspaceActionAnswers";
import { WorkspaceEventRecord } from "../../WorkspaceMemberActions";
import SlackUtil from "../Slack";
import SlackModalMetadata from "../SlackModalMetadata";
import SlackActionType from "./ActionTypes";

/*
 * WHERE A PRESS IN SLACK IS ANSWERED: WHERE IT WAS MADE.
 *
 * Every answer to a button, a form or a command used to go to the person's
 * direct messages with the app ("Unfortunately your slack account is not
 * connected...", "unfortunately you cannot acknowledge..."). Nothing showed
 * in the channel they pressed in, so they missed it, pressed again, and got
 * a second direct message they missed too.
 *
 * Now an answer is a message only the person who pressed sees, in the
 * channel - and thread - they pressed in: Slack shows it right under the
 * message, marked "Only visible to you". In order, as each is possible:
 *
 *   1. the press's response_url (buttons, slash commands): it reaches the
 *      channel whether or not OneUptime is in it;
 *   2. chat.postEphemeral in the channel and thread the press was made in -
 *      for a form's submission, the ones it was opened from (the form
 *      carries them: SlackModalMetadata);
 *   3. a modal, for a press that has no channel: a global shortcut;
 *   4. the direct message, last, when none of these can be sent - so an
 *      answer always goes somewhere.
 */

// Where the person pressed, and how Slack lets OneUptime answer there.
export interface SlackAnswerPlace {
  // The project's bot token.
  projectAuthToken: string;
  // The Slack account that pressed.
  slackUserId: string;
  slackChannelId?: string | undefined;
  slackThreadTs?: string | undefined;
  responseUrl?: string | undefined;
  // A shortcut's: opens a modal, for three seconds.
  triggerId?: string | undefined;
  /*
   * The modal the person chose the press's project in (SlackProjectChoice):
   * an answer in a modal takes its place, where none could open over it.
   */
  viewId?: string | undefined;
  /*
   * The person's direct messages with the app, when they wrote to it there.
   * Not a channel to answer in with a message only they see: they are
   * answered by the app's own message there, the last of the ways above.
   * Kept as the way back to it from the page a Connect button opens.
   */
  slackDirectMessageChannelId?: string | undefined;
}

// How an answer reached the person (for the log and the tests).
export enum SlackAnswerDelivery {
  ResponseUrl = "ResponseUrl",
  Ephemeral = "Ephemeral",
  Modal = "Modal",
  DirectMessage = "DirectMessage",
  None = "None",
}

// What a request carries that says where it was made.
export interface SlackAnswerPlaceSource {
  projectAuthToken?: string | undefined;
  slackUserId?: string | undefined;
  slackChannelId?: string | undefined;
  slackThreadTs?: string | undefined;
  responseUrl?: string | undefined;
  triggerId?: string | undefined;
  payloadType?: string | undefined;
  // "home" for a press in the app's Home tab, which has no channel.
  slackViewType?: string | undefined;
  /*
   * Pressed on a message only the person sees: a form it opens carries it,
   * so the form's submission is answered with what it did.
   */
  isFromPrivateMessage?: boolean | undefined;
  /*
   * The project the press was read in: a form it opens carries it, so the
   * form's submission is read in the same project.
   */
  projectId?: ObjectID | undefined;
  /*
   * A press made again in the project its person chose in a modal
   * (SlackProjectChoice): what it opens, or answers in a modal, takes that
   * modal's place.
   */
  replaceViewId?: string | undefined;
}

export default class SlackActionAnswer {
  // What Execute On-Call Policy says when there is no policy to offer.
  public static readonly NO_ON_CALL_POLICIES_MESSAGE: string =
    "No on-call policies are available to you in this project yet. Add one in the OneUptime Dashboard under On-Call Duty > Policies, or ask a project admin for access to one.";

  // The place a request says it was made in; null without a token or a person.
  public static getPlace(
    source: SlackAnswerPlaceSource,
  ): SlackAnswerPlace | null {
    if (!source.projectAuthToken || !source.slackUserId) {
      return null;
    }

    const place: SlackAnswerPlace = {
      projectAuthToken: source.projectAuthToken,
      slackUserId: source.slackUserId,
    };

    if (source.slackChannelId) {
      place.slackChannelId = source.slackChannelId;
    }

    if (source.slackThreadTs) {
      place.slackThreadTs = source.slackThreadTs;
    }

    if (SlackUtil.isSlackResponseUrl(source.responseUrl)) {
      place.responseUrl = source.responseUrl;
    }

    /*
     * Only a shortcut and a button of the app's Home tab answer in a modal:
     * everything else has a channel.
     */
    if (
      source.triggerId &&
      (source.payloadType === "shortcut" || source.slackViewType === "home")
    ) {
      place.triggerId = source.triggerId;

      if (source.replaceViewId) {
        place.viewId = source.replaceViewId;
      }
    }

    return place;
  }

  /*
   * Answers the person where they pressed (see above). `connectUrl` adds the
   * Connect button. Never throws: a press is answered as well as Slack
   * allows, and what could not be sent is logged.
   */
  @CaptureSpan()
  public static async answer(data: {
    place: SlackAnswerPlace;
    answer: WorkspaceAnswer;
    connectUrl?: URL | undefined;
  }): Promise<SlackAnswerDelivery> {
    return await SlackActionAnswer.answerWithBlocks({
      place: data.place,
      messageBlocks: SlackActionAnswer.getMessageBlocks(data),
      text: data.answer.text,
    });
  }

  /*
   * An answer of any blocks - an incident with its buttons, which a command
   * answers with - delivered as `answer` delivers one: where the press was,
   * only to the person who made it. `text` is what its notification shows.
   * Never throws.
   */
  @CaptureSpan()
  public static async answerWithBlocks(data: {
    place: SlackAnswerPlace;
    messageBlocks: Array<WorkspaceMessageBlock>;
    text: string;
  }): Promise<SlackAnswerDelivery> {
    const { place, messageBlocks } = data;

    if (place.responseUrl) {
      try {
        await SlackUtil.sendEphemeralResponse({
          responseUrl: place.responseUrl,
          messageBlocks: messageBlocks,
          text: data.text,
        });

        return SlackAnswerDelivery.ResponseUrl;
      } catch (err) {
        logger.debug(
          "Slack did not take an answer at the press's response URL; answering in the channel instead.",
        );
        logger.debug(err);
      }
    }

    if (place.slackChannelId) {
      try {
        await SlackUtil.sendEphemeralMessageToChannel({
          authToken: place.projectAuthToken,
          channelId: place.slackChannelId,
          userId: place.slackUserId,
          threadTs: place.slackThreadTs,
          messageBlocks: messageBlocks,
          text: data.text,
        });

        return SlackAnswerDelivery.Ephemeral;
      } catch (err) {
        logger.debug(
          "Slack did not take an answer in the channel; answering by direct message instead.",
          { channelId: place.slackChannelId },
        );
        logger.debug(err);
      }
    }

    if (place.triggerId) {
      try {
        await SlackUtil.showMessageInModal({
          authToken: place.projectAuthToken,
          triggerId: place.triggerId,
          title: ProductBrandingText.getProductName(),
          messageBlocks: messageBlocks,
          viewId: place.viewId,
        });

        return SlackAnswerDelivery.Modal;
      } catch (err) {
        logger.debug(
          "Slack did not open an answer in a modal; answering by direct message instead.",
        );
        logger.debug(err);
      }
    }

    try {
      // The one answer that notifies: its notification says what it is.
      await SlackUtil.sendDirectMessageToUser({
        authToken: place.projectAuthToken,
        workspaceUserId: place.slackUserId,
        messageBlocks: messageBlocks,
        text: data.text,
      });

      return SlackAnswerDelivery.DirectMessage;
    } catch (err) {
      // The press stands, answered or not.
      logger.error("Could not answer a Slack press anywhere.");
      logger.error(err);
    }

    return SlackAnswerDelivery.None;
  }

  /*
   * An answer as the HTTP response to a slash command itself: Slack shows
   * it at once, only to the person who ran the command ("Only visible to
   * you"), with no request of its own - for an answer that reads nothing
   * first, such as the commands' help (SlackCommandActions).
   */
  public static getCommandResponse(answer: WorkspaceAnswer): JSONObject {
    return {
      response_type: "ephemeral",
      text: SlackUtil.getNotificationText(answer.text),
      blocks: SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: SlackActionAnswer.getMessageBlocks({ answer: answer }),
      }),
    };
  }

  /*
   * Answers a press that came too late (WorkspaceActionAnswers
   * getAlreadyAnswer): who got there first, and when - after the page of
   * the presser's own it answered, when it answered one.
   */
  @CaptureSpan()
  public static async answerAlready(data: {
    source: SlackAnswerPlaceSource;
    event: WorkspaceEventRecord;
    press: WorkspaceLatePress;
    // The presser's person's pages a late Acknowledge answered.
    answeredPageCount?: number | undefined;
  }): Promise<SlackAnswerDelivery> {
    const place: SlackAnswerPlace | null = SlackActionAnswer.getPlace(
      data.source,
    );

    if (!place) {
      return SlackAnswerDelivery.None;
    }

    return await SlackActionAnswer.answer({
      place: place,
      answer: await WorkspaceActionAnswers.getAlreadyAnswer({
        event: data.event,
        press: data.press,
        answeredPageCount: data.answeredPageCount,
      }),
    });
  }

  /*
   * Opens a form for a press, carrying where the press was made, and the
   * project it was read in (SlackModalMetadata), so the form's submission is
   * answered there too, and read in the same project. A press made again
   * once its project was chosen in a modal opens the form in that modal's
   * place (SlackProjectChoice).
   */
  @CaptureSpan()
  public static async showModal(data: {
    source: SlackAnswerPlaceSource & { triggerId?: string | undefined };
    modalBlock: WorkspaceModalBlock;
  }): Promise<void> {
    const modalBlock: WorkspaceModalBlock = {
      ...data.modalBlock,
      actionValue: SlackModalMetadata.write(data.modalBlock.actionValue, {
        channelId: data.source.slackChannelId,
        threadTs: data.source.slackThreadTs,
        isFromPrivateMessage: data.source.isFromPrivateMessage,
        projectId: data.source.projectId?.toString(),
      }),
    };

    if (data.source.replaceViewId) {
      return await SlackUtil.replaceModal({
        authToken: data.source.projectAuthToken!,
        viewId: data.source.replaceViewId,
        modalBlock: modalBlock,
      });
    }

    await SlackUtil.showModalToUser({
      authToken: data.source.projectAuthToken!,
      triggerId: data.source.triggerId!,
      modalBlock: modalBlock,
    });
  }

  // The answer's blocks: its Markdown, then its Connect button.
  private static getMessageBlocks(data: {
    answer: WorkspaceAnswer;
    connectUrl?: URL | undefined;
  }): Array<WorkspaceMessageBlock> {
    const markdown: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: data.answer.markdown,
    };

    if (!data.connectUrl) {
      return [markdown];
    }

    const buttons: WorkspacePayloadButtons = {
      _type: "WorkspacePayloadButtons",
      buttons: [
        {
          _type: "WorkspaceMessagePayloadButton",
          title: WorkspaceActionAnswers.getConnectButtonTitle(
            WorkspaceType.Slack,
          ),
          value: "connect",
          actionId: SlackActionType.ConnectSlackAccount,
          url: data.connectUrl,
          isPrimary: true,
        },
      ],
    };

    return [markdown, buttons];
  }
}
