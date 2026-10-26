import { Activity, BotConnectorMappers } from "./Botbuilder";
import Project from "../../../../Models/DatabaseModels/Project";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import { NotificationSlackWebhookOnAiFeedback } from "../../../EnvironmentConfig";
import ProjectService from "../../../Services/ProjectService";
import logger from "../../Logger";
import OperatorSlackNotice, {
  AiAnswerFeedbackReaction,
} from "../../OperatorSlackNotice";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsTenantResolution,
} from "./MicrosoftTeams";

/*
 * AN ANSWER FROM ONEUPTIME AI, AS MICROSOFT TEAMS SHOWS IT.
 *
 * Microsoft's store requires an app whose content AI writes to say so where
 * the content is shown, to ask its reader to check it, and to let them
 * report content that is wrong, harmful or offensive to its developer
 * (Teams Store validation guidelines, "Apps with AI-generated content").
 * Each answer to a question asked in Teams therefore:
 *
 *   - carries Teams' own "AI generated" label, whose tooltip reads
 *     "AI-generated content may be incorrect": the message's schema.org
 *     Message entity with additionalType AIGeneratedContent;
 *   - ends with a line of its own saying OneUptime AI wrote it, to check it
 *     before acting on it, and how to report it (getNotice), seen in every
 *     Teams client, the label or not;
 *   - carries Teams' feedback buttons, 👍 and 👎, each with a box to say why
 *     (channelData.feedbackLoop).
 *
 * What somebody sends with those buttons reaches the bot as an invoke,
 * message/submitAction with the action "feedback" (handleFeedback), naming
 * the answer it is about. The installation's operator hears of it on Slack
 * (NOTIFICATION_SLACK_WEBHOOK_ON_AI_FEEDBACK): the project, the reaction and
 * what they wrote. The answer itself is not sent there: it was written from
 * the project's own data, for the people in the conversation.
 */

// The invoke Teams sends when somebody submits feedback on a message.
const FEEDBACK_INVOKE_NAME: string = "message/submitAction";
const FEEDBACK_ACTION_NAME: string = "feedback";

/*
 * What somebody wrote in Teams' feedback box is a few sentences. Anything
 * longer than this is cut before it is read, and again where it is quoted
 * (OperatorSlackNotice).
 */
const FEEDBACK_TEXT_MAX_LENGTH: number = 4000;

// The answer it is about, as a log line names it.
const MESSAGE_ID_MAX_LENGTH: number = 200;

/*
 * botbuilder sends an activity through @azure/core-client's serializer,
 * which writes each of its entities by botframework-connector's Entity
 * model: type, text and mentioned, and nothing else. The Activity mapper
 * means its entities to keep their other properties (its inline
 * additionalProperties), but the serializer looks the element up by its
 * class name and uses the model instead - so the AI label's @type,
 * @context and additionalType were dropped, and Teams showed no label.
 * Letting the model keep them, once, makes every entity reach Teams as
 * written; a mention, which uses only the model's own three, is unchanged.
 * MicrosoftTeamsConversationsEndToEnd.test.ts sends through the real
 * botbuilder and checks what arrives.
 */
const allowEntityProperties: () => void = (): void => {
  try {
    const entity: { type: { additionalProperties?: unknown } } | undefined =
      BotConnectorMappers.Entity as unknown as
        | { type: { additionalProperties?: unknown } }
        | undefined;

    if (entity?.type && !entity.type.additionalProperties) {
      entity.type.additionalProperties = { type: { name: "Object" } };
    }
  } catch (err) {
    logger.error(
      `Microsoft Teams answers from OneUptime AI may be sent without their AI label: ${err}`,
    );
  }
};

allowEntityProperties();

// Somebody's 👍 or 👎 on an answer, as Teams sent it.
export interface MicrosoftTeamsAiAnswerFeedback {
  reaction: AiAnswerFeedbackReaction;
  // What they wrote in the feedback box; empty for nothing.
  text: string;
  // The answer it is about: the message the buttons are on.
  messageId: string;
  // "personal", "groupChat" or "channel".
  conversationType: string;
  tenantId: string;
  // Their name, as Teams shows it.
  userName: string;
}

export default class MicrosoftTeamsAiAnswer {
  /*
   * The line every answer ends with: OneUptime AI wrote it, it can be
   * wrong, and the way to say so - in italics, under the answer and its
   * sources.
   */
  public static getNotice(): MarkdownText {
    return mdText`_Written by ${ProductBrandingText.getProductName()} AI, which can make mistakes: check important details before you act on them. Use 👎 to report an answer that is wrong or inappropriate._`;
  }

  /*
   * The answer as a message: its text, Teams' "AI generated" label and the
   * feedback buttons. Posted, or put in place of the channel's "Looking
   * into it…".
   */
  public static toActivity(text: string): Partial<Activity> {
    return {
      type: "message",
      text: text,
      // The message entity that makes Teams show its "AI generated" label.
      entities: [
        {
          type: "https://schema.org/Message",
          "@type": "Message",
          "@context": "https://schema.org",
          additionalType: ["AIGeneratedContent"],
        },
      ],
      channelData: {
        feedbackLoop: { type: "default" },
      },
    };
  }

  // An invoke that is somebody's feedback on one of the bot's messages.
  public static isFeedback(activity: JSONObject): boolean {
    const value: JSONObject | undefined = activity["value"] as
      | JSONObject
      | undefined;

    return (
      activity["type"] === "invoke" &&
      activity["name"] === FEEDBACK_INVOKE_NAME &&
      value?.["actionName"] === FEEDBACK_ACTION_NAME
    );
  }

  /*
   * The feedback an invoke carries, or null for one that is not feedback
   * or names no reaction.
   */
  public static readFeedback(
    activity: JSONObject,
  ): MicrosoftTeamsAiAnswerFeedback | null {
    if (!MicrosoftTeamsAiAnswer.isFeedback(activity)) {
      return null;
    }

    const actionValue: JSONObject =
      ((activity["value"] as JSONObject)["actionValue"] as
        | JSONObject
        | undefined) || {};

    const reaction: unknown = actionValue["reaction"];

    if (
      reaction !== AiAnswerFeedbackReaction.Like &&
      reaction !== AiAnswerFeedbackReaction.Dislike
    ) {
      return null;
    }

    const conversation: JSONObject =
      (activity["conversation"] as JSONObject | undefined) || {};
    const channelData: JSONObject =
      (activity["channelData"] as JSONObject | undefined) || {};
    const from: JSONObject = (activity["from"] as JSONObject | undefined) || {};

    return {
      reaction: reaction as AiAnswerFeedbackReaction,
      text: MicrosoftTeamsAiAnswer.getFeedbackText(actionValue["feedback"]),
      messageId: MicrosoftTeamsAiAnswer.getString(
        activity["replyToId"],
      ).substring(0, MESSAGE_ID_MAX_LENGTH),
      conversationType: MicrosoftTeamsAiAnswer.getString(
        conversation["conversationType"],
      ),
      tenantId:
        MicrosoftTeamsAiAnswer.getString(
          (channelData["tenant"] as JSONObject | undefined)?.["id"],
        ) || MicrosoftTeamsAiAnswer.getString(conversation["tenantId"]),
      userName: MicrosoftTeamsAiAnswer.getString(from["name"]),
    };
  }

  /*
   * Somebody's 👍 or 👎 on an answer: the installation's operator is told,
   * with the project the conversation belongs to, when one can be told.
   * Teams shows its own "thank you"; the bot posts nothing in the
   * conversation. Never throws: the invoke is answered with 200 either way.
   */
  @CaptureSpan()
  public static async handleFeedback(data: {
    activity: JSONObject;
  }): Promise<void> {
    try {
      const feedback: MicrosoftTeamsAiAnswerFeedback | null =
        MicrosoftTeamsAiAnswer.readFeedback(data.activity);

      if (!feedback) {
        logger.debug(
          "A Microsoft Teams feedback invoke named no reaction; nothing to report.",
        );
        return;
      }

      if (!NotificationSlackWebhookOnAiFeedback) {
        logger.debug(
          "Feedback on a OneUptime AI answer in Microsoft Teams: NOTIFICATION_SLACK_WEBHOOK_ON_AI_FEEDBACK is not set, so the operator is not told.",
        );
        return;
      }

      const project: { id: ObjectID | null; record: Project | null } =
        await MicrosoftTeamsAiAnswer.getProject(data.activity, feedback);

      await OperatorSlackNotice.post({
        webhookUrl: NotificationSlackWebhookOnAiFeedback,
        text: OperatorSlackNotice.getAiAnswerFeedbackText({
          chat: "Microsoft Teams",
          reaction: feedback.reaction,
          feedback: feedback.text,
          project: project.record,
          projectId: project.id,
          conversationType: feedback.conversationType,
          userName: feedback.userName,
          messageId: feedback.messageId,
        }),
        about: "feedback on an AI answer",
        projectId: project.id,
      });
    } catch (err) {
      logger.error(
        `Could not report feedback on a OneUptime AI answer in Microsoft Teams: ${err}`,
      );
    }
  }

  /*
   * Teams sends what was written as a JSON string, {"feedbackText": "..."};
   * a client that sends the text itself, or an object, is read too.
   */
  private static getFeedbackText(feedback: unknown): string {
    if (feedback && typeof feedback === "object") {
      return MicrosoftTeamsAiAnswer.getString(
        (feedback as JSONObject)["feedbackText"],
      )
        .substring(0, FEEDBACK_TEXT_MAX_LENGTH)
        .trim();
    }

    if (typeof feedback !== "string") {
      return "";
    }

    const written: string = feedback.substring(0, FEEDBACK_TEXT_MAX_LENGTH * 2);

    try {
      const parsed: unknown = JSON.parse(written);

      if (parsed && typeof parsed === "object") {
        return MicrosoftTeamsAiAnswer.getString(
          (parsed as JSONObject)["feedbackText"],
        )
          .substring(0, FEEDBACK_TEXT_MAX_LENGTH)
          .trim();
      }
    } catch {
      // Not JSON: the text itself.
    }

    return written.substring(0, FEEDBACK_TEXT_MAX_LENGTH).trim();
  }

  /*
   * The project the conversation belongs to, read as any message to the bot
   * is (MicrosoftTeamsUtil.resolveProjectByTenantId); none for an
   * organization connected to no project, or to several with nothing to
   * tell which. Its name is read for the operator's message.
   */
  private static async getProject(
    activity: JSONObject,
    feedback: MicrosoftTeamsAiAnswerFeedback,
  ): Promise<{ id: ObjectID | null; record: Project | null }> {
    if (!feedback.tenantId) {
      return { id: null, record: null };
    }

    try {
      const resolution: MicrosoftTeamsTenantResolution =
        await MicrosoftTeamsUtil.resolveProjectByTenantId({
          tenantId: feedback.tenantId,
          clues: MicrosoftTeamsUtil.getProjectClues({ activity: activity }),
        });

      const projectId: ObjectID | null =
        resolution.projectAuth?.projectId || null;

      if (!projectId) {
        return { id: null, record: null };
      }

      const record: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: { _id: true, name: true },
        props: { isRoot: true },
      });

      return { id: projectId, record: record };
    } catch (err) {
      logger.debug(
        "Could not tell the project of feedback on an AI answer in Microsoft Teams; reporting it without one.",
      );
      logger.debug(err);
      return { id: null, record: null };
    }
  }

  private static getString(value: unknown): string {
    return typeof value === "string" ? value : "";
  }
}
