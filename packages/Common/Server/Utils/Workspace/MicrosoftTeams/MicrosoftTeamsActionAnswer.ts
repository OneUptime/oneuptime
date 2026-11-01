import { TurnContext } from "./Botbuilder";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceActionAnswers, {
  WorkspaceAnswer,
  WorkspaceLatePress,
} from "../WorkspaceActionAnswers";
import { WorkspaceConnectRequestTeamsPlace } from "../WorkspaceConnectRequest";
import { WorkspaceEventRecord } from "../WorkspaceMemberActions";
import MicrosoftTeamsUtil from "./MicrosoftTeams";
import MicrosoftTeamsMessageSize from "./MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies, {
  MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
} from "./MicrosoftTeamsReplies";

/*
 * WHERE A PRESS IN MICROSOFT TEAMS IS ANSWERED: WHERE IT WAS MADE, TO WHOEVER
 * MADE IT.
 *
 * Microsoft Teams has no message only one person sees, so the answer to a
 * button is a reply in the conversation it was pressed in - the channel
 * post's own thread, or the chat - that mentions the person who pressed it,
 * so they are the one Teams notifies, and the reply says who it is for:
 *
 *   @Nitin 🔗 Connect your Microsoft Teams account to acknowledge this
 *   incident. It takes one click, and OneUptime acknowledges it for you as
 *   soon as you're connected.          [Connect Microsoft Teams account]
 *
 * It is a small card, not plain text: a card shows a moment in each reader's
 * own time ("at 6:07 PM", WorkspaceMessageTime), and carries the Connect
 * button. Its summary is what a notification shows. Nothing in an answer is
 * private: a Connect link is for one Microsoft account, and anybody else who
 * opens it is refused when they sign in (WorkspaceConnectRequest).
 */

// Who a reply mentions: their Teams id ("29:..."), and the name to show.
export interface MicrosoftTeamsMention {
  id: string;
  name: string;
}

// A button under an answer that opens a page: the help's way forward.
export interface MicrosoftTeamsAnswerLink {
  title: string;
  url: URL;
}

// Characters a mention's name drops: the <at> tag's, and the card Markdown's.
const MENTION_NAME_UNSAFE_CHARACTERS: RegExp = /[<>&*_`~[\]\\|#]/g;

const WHITESPACE: RegExp = /\s+/g;

// A name longer than this is cut: a mention is a name, not a paragraph.
const MENTION_NAME_MAX_LENGTH: number = 100;

export default class MicrosoftTeamsActionAnswer {
  // The person a turn is from, to mention; null when it names nobody.
  public static getMention(
    activity: JSONObject | undefined | null,
  ): MicrosoftTeamsMention | null {
    const from: JSONObject | undefined = activity?.["from"] as
      | JSONObject
      | undefined;

    const id: unknown = from?.["id"];
    const name: string = MicrosoftTeamsActionAnswer.getMentionName(
      from?.["name"],
    );

    if (typeof id !== "string" || !id || !name) {
      return null;
    }

    return { id: id, name: name };
  }

  /*
   * A display name as a mention shows it. The name is whatever the person
   * set, and it sits inside an <at> tag in a card's Markdown, where Teams
   * matches it against the mention: so it is left without the characters
   * either would read, and on one line.
   */
  public static getMentionName(name: unknown): string {
    if (typeof name !== "string") {
      return "";
    }

    return name
      .replace(MENTION_NAME_UNSAFE_CHARACTERS, "")
      .replace(WHITESPACE, " ")
      .trim()
      .substring(0, MENTION_NAME_MAX_LENGTH)
      .trim();
  }

  /*
   * The answer as a card: the mention, then the answer, in one text block,
   * and the Connect button when there is one, then the answer's links.
   */
  public static buildCard(data: {
    answer: WorkspaceAnswer;
    mention?: MicrosoftTeamsMention | null | undefined;
    connectUrl?: URL | undefined;
    links?: Array<MicrosoftTeamsAnswerLink> | undefined;
  }): JSONObject {
    const mentionText: string = data.mention
      ? `<at>${data.mention.name}</at>`
      : "";

    const text: string = mentionText
      ? `${mentionText} ${data.answer.markdown}`
      : data.answer.markdown;

    const card: JSONObject = {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: MicrosoftTeamsMessageSize.fitMarkdownText(text),
          wrap: true,
        },
      ],
    };

    const actions: Array<JSONObject> = [];

    if (data.connectUrl) {
      actions.push({
        type: "Action.OpenUrl",
        title: WorkspaceActionAnswers.getConnectButtonTitle(
          WorkspaceType.MicrosoftTeams,
        ),
        url: data.connectUrl.toString(),
        style: "positive",
      });
    }

    for (const link of data.links || []) {
      actions.push({
        type: "Action.OpenUrl",
        title: link.title,
        url: link.url.toString(),
      });
    }

    if (actions.length > 0) {
      card["actions"] = actions;
    }

    if (data.mention) {
      card["msteams"] = {
        entities: [
          {
            type: "mention",
            text: mentionText,
            mentioned: {
              id: data.mention.id,
              name: data.mention.name,
            },
          },
        ],
      };
    }

    return card;
  }

  /*
   * Answers the person who pressed, in the conversation of their press.
   * Never throws (MicrosoftTeamsReplies.sendBestEffort): a reply that cannot
   * be sent must not turn into a failed turn Teams delivers again.
   */
  @CaptureSpan()
  public static async reply(data: {
    turnContext: TurnContext;
    answer: WorkspaceAnswer;
    connectUrl?: URL | undefined;
    links?: Array<MicrosoftTeamsAnswerLink> | undefined;
  }): Promise<boolean> {
    const card: JSONObject = MicrosoftTeamsActionAnswer.buildCard({
      answer: data.answer,
      mention: MicrosoftTeamsActionAnswer.getMention(
        data.turnContext.activity as unknown as JSONObject,
      ),
      connectUrl: data.connectUrl,
      links: data.links,
    });

    return await MicrosoftTeamsReplies.sendBestEffort(data.turnContext, {
      attachments: [
        {
          contentType: MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
          content: card,
        },
      ],
      summary: data.answer.text,
    });
  }

  /*
   * Answers a press that came too late (WorkspaceActionAnswers
   * getAlreadyAnswer): who got there first, and when - after the page of
   * the presser's own it answered, when it answered one.
   */
  @CaptureSpan()
  public static async replyAlready(data: {
    turnContext: TurnContext;
    event: WorkspaceEventRecord;
    press: WorkspaceLatePress;
    // The presser's person's pages a late Acknowledge answered.
    answeredPageCount?: number | undefined;
  }): Promise<boolean> {
    return await MicrosoftTeamsActionAnswer.reply({
      turnContext: data.turnContext,
      answer: await WorkspaceActionAnswers.getAlreadyAnswer({
        event: data.event,
        press: data.press,
        answeredPageCount: data.answeredPageCount,
      }),
    });
  }

  /*
   * Answers a press recorded earlier - once the account it was for is
   * connected - where it was made, mentioning who made it. Never throws.
   */
  @CaptureSpan()
  public static async sendToPlace(data: {
    place: WorkspaceConnectRequestTeamsPlace;
    answer: WorkspaceAnswer;
    // A Connect button under the answer (MicrosoftTeamsReactionNoteSync).
    connectUrl?: URL | undefined;
  }): Promise<boolean> {
    const name: string = MicrosoftTeamsActionAnswer.getMentionName(
      data.place.userName,
    );

    const mention: MicrosoftTeamsMention | null =
      data.place.userTeamsId && name
        ? { id: data.place.userTeamsId, name: name }
        : null;

    try {
      await MicrosoftTeamsUtil.sendCardToConversation({
        conversationId: data.place.conversationId,
        conversationType: data.place.conversationType,
        tenantId: data.place.tenantId,
        serviceUrl: data.place.serviceUrl,
        card: MicrosoftTeamsActionAnswer.buildCard({
          answer: data.answer,
          mention: mention,
          connectUrl: data.connectUrl,
        }),
        summary: data.answer.text,
      });

      return true;
    } catch (err) {
      MicrosoftTeamsReplies.logFailure(
        "Could not answer a Microsoft Teams press where it was made",
        err,
      );
      logger.debug("The press stands; only its answer was not delivered.");
      return false;
    }
  }
}
