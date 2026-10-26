import logger, { LogAttributes } from "./Logger";
import SlackUtil from "./Workspace/Slack/Slack";
import Project from "../../Models/DatabaseModels/Project";
import User from "../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import URL from "../../Types/API/URL";
import BalanceAdjustmentType from "../../Types/Billing/BalanceAdjustmentType";
import ProjectBalanceType from "../../Types/Billing/ProjectBalanceType";
import Email from "../../Types/Email";
import { JSONObject } from "../../Types/JSON";
import Name from "../../Types/Name";
import ObjectID from "../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../Utils/Markdown/FeedMarkdown";

/*
 * What OneUptime tells its operator's own Slack channels - the incoming
 * webhooks set with NOTIFICATION_SLACK_WEBHOOK_ON_* (EnvironmentConfig):
 *
 * - a user created, by signing up or by an invitation
 *   (UserService.onCreateSuccess, NOTIFICATION_SLACK_WEBHOOK_ON_CREATED_USER);
 * - a project created (ProjectService.onCreateSuccess,
 *   NOTIFICATION_SLACK_WEBHOOK_ON_CREATED_PROJECT);
 * - its plan changed, or its subscription reactivated, and the replaced
 *   subscriptions a plan change could not cancel (ProjectService.changePlan,
 *   ProjectService.reactiveSubscription);
 * - its balance for SMS and calls, or its AI balance, refilled - by Auto
 *   Recharge or the Recharge button (NotificationService, AIBillingService);
 * - either balance adjusted by a master admin (ProjectService.adjustBalance);
 * - the project deleted, with the feedback its owner gave for deleting it
 *   (ProjectService.onDeleteSuccess, NOTIFICATION_SLACK_WEBHOOK_ON_DELETED
 *   _PROJECT);
 * - a 👍 or 👎 on an answer from OneUptime AI in Microsoft Teams, with what
 *   its sender wrote (MicrosoftTeamsAiAnswer.handleFeedback,
 *   NOTIFICATION_SLACK_WEBHOOK_ON_AI_FEEDBACK) - reports of answers that
 *   are wrong or inappropriate, which the operator acts on.
 *
 * Plan changes and both balances post to NOTIFICATION_SLACK_WEBHOOK_ON
 * _SUBSCRIPTION_UPDATE. Both balances use the same words, so a refill or an
 * adjustment of AI credits reads exactly as one of SMS and call balance does.
 *
 * A user's name and company, a project's name, its creator's name and the
 * feedback a customer typed are text OneUptime did not write - a project or
 * a company named "<!channel>" would notify the whole channel - so each
 * message is written with mdText, which places every value as text, and
 * converted to Slack's mrkdwn (SlackUtil.convertMarkdownToSlackRichText), as
 * a status page's Slack messages are.
 */

// What each balance is called in its messages: "AI Balance Refilled".
const BALANCE_TITLES: Readonly<Record<ProjectBalanceType, string>> = {
  [ProjectBalanceType.SmsOrCall]: "SMS and Call Balance",
  [ProjectBalanceType.AI]: "AI Balance",
};

// What a refill or adjustment is about, in a log line.
const BALANCE_LOG_NAMES: Readonly<Record<ProjectBalanceType, string>> = {
  [ProjectBalanceType.SmsOrCall]: "SMS and call balance",
  [ProjectBalanceType.AI]: "AI balance",
};

// A line break in feedback a customer typed, whichever way it was typed.
const LINE_BREAK_PATTERN: RegExp = /\r\n|\r|\n/;

export interface BalanceRefilledNotice {
  balance: ProjectBalanceType;
  // Its name, and its creator's name and email when they were read.
  project: Project;
  amountInUSD: number;
  currentBalanceInUSD: number;
  // Auto Recharge, rather than somebody pressing Recharge.
  isAutomatic: boolean;
}

export interface BalanceAdjustedNotice {
  balance: ProjectBalanceType;
  projectId: ObjectID;
  // Null when it could not be read: the message still goes, without a name.
  project?: Project | null | undefined;
  adjustmentType: BalanceAdjustmentType;
  amountInUSDCents: number;
  previousBalanceInUSDCents: number;
  newBalanceInUSDCents: number;
  reason: string;
  // The master admin who made it, when they are known.
  adjustedByUserId?: ObjectID | undefined;
  adjustedByUser?: User | null | undefined;
}

export interface ProjectDeletedNotice {
  // The snapshot ProjectService.onBeforeDelete read before the delete.
  project: Project;
  // From the payment provider, when billing is on and it answered.
  subscriptionStatus?: string | null | undefined;
  // What the customer said when asked why they are deleting the project.
  deletionReason?: string | null | undefined;
}

export interface UserCreatedNotice {
  // As created: their email, and the name, phone and company they gave.
  user: User;
}

// A 👍 or a 👎, as Microsoft Teams names them.
export enum AiAnswerFeedbackReaction {
  Like = "like",
  Dislike = "dislike",
}

export interface AiAnswerFeedbackNotice {
  // Where the answer was given: "Microsoft Teams".
  chat: string;
  reaction: AiAnswerFeedbackReaction;
  // What its sender wrote with it; empty for nothing.
  feedback: string;
  // The project the conversation belongs to, when it could be told.
  project?: Project | null | undefined;
  projectId?: ObjectID | null | undefined;
  // "personal", "groupChat" or "channel".
  conversationType?: string | undefined;
  // Its sender's name, as the chat shows it.
  userName?: string | undefined;
  // The answer's message in the chat, to find it by.
  messageId?: string | undefined;
}

export interface ProjectCreatedNotice {
  /*
   * Read again once it was created: its name, its creator's name and
   * email, and the plan and subscription status billing gave it.
   */
  project: Project;
  // Where OneUptime bills, the message says which plan the project is on.
  isBillingEnabled: boolean;
}

export interface ProjectPlanChangedNotice {
  // Read again after the change: the plan and status it has now.
  project: Project;
  // Where OneUptime bills, the message says which plan the project is on.
  isBillingEnabled: boolean;
}

export interface SubscriptionsPendingCancellationNotice {
  projectId: ObjectID;
  // Replaced by a plan change, not cancelled, and recorded nowhere else.
  subscriptionIds: Array<string>;
}

export default class OperatorSlackNotice {
  public static getBalanceTitle(balance: ProjectBalanceType): string {
    return BALANCE_TITLES[balance];
  }

  public static getBalanceLogName(balance: ProjectBalanceType): string {
    return BALANCE_LOG_NAMES[balance];
  }

  /*
   * An amount in USD as the messages show it: "$20 USD", "$20.50 USD", and
   * "-$1.50 USD" for a balance that messages sent together took below zero.
   */
  public static formatUsd(amountInUSD: number): string {
    if (typeof amountInUSD !== "number" || !Number.isFinite(amountInUSD)) {
      return "N/A";
    }

    const sign: string = amountInUSD < 0 ? "-" : "";
    const absoluteAmount: number = Math.abs(amountInUSD);
    const digits: string = Number.isInteger(absoluteAmount)
      ? absoluteAmount.toString()
      : absoluteAmount.toFixed(2);

    return `${sign}$${digits} USD`;
  }

  /*
   * A balance recharged and credited: how much was added, what the balance
   * is now, and whether Auto Recharge added it or somebody pressed Recharge.
   */
  public static getBalanceRefilledText(data: BalanceRefilledNotice): string {
    const lines: Array<MarkdownText> = [
      mdText`**${this.getBalanceTitle(data.balance)} Refilled:**`,
      ...this.getProjectLines({ project: data.project }),
      mdText`**Refill Amount:** ${this.formatUsd(data.amountInUSD)}`,
      mdText`**Current Balance:** ${this.formatUsd(data.currentBalanceInUSD)}`,
      mdText`**Recharge Type:** ${data.isAutomatic ? "Auto Recharge" : "Manual"}`,
    ];

    const createdBy: string | null = this.describePerson({
      name: data.project.createdOwnerName,
      email: data.project.createdOwnerEmail,
    });

    if (createdBy) {
      lines.push(mdText`**Project Created By:** ${createdBy}`);
    }

    return this.toSlackText(lines);
  }

  /*
   * A balance a master admin added to, deducted from or set by hand - paid
   * service handed out, or clawed back, with no payment behind it - with
   * the balance before and after, who did it and the reason they gave.
   */
  public static getBalanceAdjustedText(data: BalanceAdjustedNotice): string {
    const lines: Array<MarkdownText> = [
      mdText`**${this.getBalanceTitle(data.balance)} Adjusted:**`,
      ...this.getProjectLines({
        project: data.project,
        projectId: data.projectId,
      }),
      mdText`**Adjustment:** ${this.describeAdjustment(data)}`,
      mdText`**Previous Balance:** ${this.formatUsd(
        data.previousBalanceInUSDCents / 100,
      )}`,
      mdText`**New Balance:** ${this.formatUsd(data.newBalanceInUSDCents / 100)}`,
      mdText`**Adjusted By:** ${
        this.describePerson({
          name: data.adjustedByUser?.name,
          email: data.adjustedByUser?.email,
        }) ||
        data.adjustedByUserId?.toString() ||
        "Unknown"
      }`,
      mdText`**Reason:** ${FeedMarkdown.multilineText(data.reason.trim() || "N/A")}`,
    ];

    return this.toSlackText(lines);
  }

  /*
   * A project deleted: the snapshot taken before the delete, and the
   * feedback its owner gave when asked why they were deleting it - quoted
   * under its title, every line of it, or that they gave none.
   */
  public static getProjectDeletedText(data: ProjectDeletedNotice): string {
    const project: Project = data.project;

    const lines: Array<MarkdownText> = [
      mdText`**Project Deleted:**`,
      ...this.getProjectLines({ project: project }),
      mdText`**Project Created Date:** ${
        project.createdAt ? new Date(project.createdAt).toUTCString() : "N/A"
      }`,
      mdText`**Project Plan Name:** ${project.planName || "N/A"}`,
    ];

    if (data.subscriptionStatus) {
      lines.push(
        mdText`**Project Subscription Status:** ${data.subscriptionStatus}`,
      );
    }

    const createdBy: string | null = this.describePerson({
      name: project.createdByUser?.name,
      email: project.createdByUser?.email,
    });

    if (createdBy) {
      lines.push(mdText`**Created By:** ${createdBy}`);
    }

    lines.push(this.getDeletionFeedback(data.deletionReason));

    return this.toSlackText(lines);
  }

  /*
   * A 👍 or 👎 on an answer from OneUptime AI: where it was given and in
   * which project, who gave it, the answer's message to find it by, and what
   * they wrote, quoted, last. The answer itself is not in it: it was written
   * from the project's own data, for the people in the conversation.
   */
  public static getAiAnswerFeedbackText(data: AiAnswerFeedbackNotice): string {
    const isReport: boolean =
      data.reaction === AiAnswerFeedbackReaction.Dislike;
    const conversation: string = this.getConversationName(
      data.conversationType,
    );

    const lines: Array<MarkdownText> = [
      isReport
        ? mdText`**OneUptime AI Answer Reported 👎:**`
        : mdText`**OneUptime AI Answer Liked 👍:**`,
      ...this.getProjectLines({
        project: data.project,
        projectId: data.projectId || undefined,
      }),
      conversation
        ? mdText`**Where:** ${data.chat}, ${conversation}`
        : mdText`**Where:** ${data.chat}`,
    ];

    const userName: string = data.userName?.trim() || "";

    if (userName) {
      lines.push(mdText`**From:** ${userName}`);
    }

    if (data.messageId) {
      lines.push(mdText`**Message ID:** ${data.messageId}`);
    }

    lines.push(this.getQuote("Feedback", data.feedback));

    return this.toSlackText(lines);
  }

  /*
   * A user created, by signing up or by an invitation: their email, and the
   * name, phone number and company they gave - N/A for any they did not.
   */
  public static getUserCreatedText(data: UserCreatedNotice): string {
    const user: User = data.user;

    return this.toSlackText([
      mdText`**New OneUptime User:**`,
      mdText`**Email:** ${user.email?.toString() || "N/A"}`,
      mdText`**Name:** ${user.name?.toString() || "N/A"}`,
      mdText`**Phone:** ${user.companyPhoneNumber?.toString() || "N/A"}`,
      mdText`**Company:** ${user.companyName || "N/A"}`,
    ]);
  }

  /*
   * A project created: its name, who created it when they are known, and,
   * where OneUptime bills, the plan it is on and its subscription's status.
   */
  public static getProjectCreatedText(data: ProjectCreatedNotice): string {
    const lines: Array<MarkdownText> = [
      mdText`**Project Created:**`,
      ...this.getProjectLines({ project: data.project }),
    ];

    const createdBy: string | null = this.describePerson({
      name: data.project.createdOwnerName,
      email: data.project.createdOwnerEmail,
    });

    if (createdBy) {
      lines.push(mdText`**Created By:** ${createdBy}`);
    }

    if (data.isBillingEnabled) {
      lines.push(...this.getPlanLines(data.project));
    }

    return this.toSlackText(lines);
  }

  /*
   * A project's plan changed, or its subscription reactivated: the project,
   * who created it when they are known, and, where OneUptime bills, the plan
   * it is on now and its subscription's status.
   */
  public static getProjectPlanChangedText(
    data: ProjectPlanChangedNotice,
  ): string {
    const lines: Array<MarkdownText> = [
      mdText`**Project Plan Changed:**`,
      ...this.getProjectLines({ project: data.project }),
    ];

    const createdBy: string | null = this.describePerson({
      name: data.project.createdOwnerName,
      email: data.project.createdOwnerEmail,
    });

    if (createdBy) {
      lines.push(mdText`**Project Created By:** ${createdBy}`);
    }

    if (data.isBillingEnabled) {
      lines.push(...this.getPlanLines(data.project));
    }

    return this.toSlackText(lines);
  }

  /*
   * The subscriptions a plan change replaced but could not cancel: still
   * open at the payment provider, and recorded against the project no more,
   * so somebody has to cancel them by hand.
   */
  public static getSubscriptionsPendingCancellationText(
    data: SubscriptionsPendingCancellationNotice,
  ): string {
    return this.toSlackText([
      mdText`**Subscriptions could not be cancelled after a plan change:**`,
      mdText`**Project ID:** ${data.projectId.toString()}`,
      mdText`**Subscriptions still open at the payment provider:** ${FeedMarkdown.join(
        data.subscriptionIds,
      )}`,
      mdText`These are no longer recorded against the project and have to be cancelled by hand.`,
    ]);
  }

  /*
   * Posts a message to an operator's incoming webhook. Never throws: the
   * message is a notice to the operator, and what it is about - a signup, a
   * plan change, a recharge, a deletion - has happened already. A message
   * Slack did not take, or a webhook that is not one, is logged.
   */
  public static async post(data: {
    webhookUrl: string;
    text: string;
    // What the message is about, for the log line: "AI balance refill".
    about: string;
    projectId?: ObjectID | null | undefined;
    // The user a message about a user is about, for the log line.
    userId?: ObjectID | null | undefined;
  }): Promise<void> {
    const logAttributes: LogAttributes = {
      ...(data.projectId ? { projectId: data.projectId.toString() } : {}),
      ...(data.userId ? { userId: data.userId.toString() } : {}),
    } as LogAttributes;

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await SlackUtil.sendMessageToChannelViaIncomingWebhook({
          url: URL.fromString(data.webhookUrl),
          text: data.text,
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error(
          `Error sending slack message for ${data.about}: ${
            response.message || "Slack did not take the message"
          }`,
          logAttributes,
        );
      }
    } catch (error) {
      logger.error(
        `Error sending slack message for ${data.about}: ${error}`,
        logAttributes,
      );
    }
  }

  // The project's name and ID: "N/A" for one that is not known.
  private static getProjectLines(data: {
    project?: Project | null | undefined;
    projectId?: ObjectID | undefined;
  }): Array<MarkdownText> {
    const projectId: string =
      data.project?.id?.toString() || data.projectId?.toString() || "N/A";

    return [
      mdText`**Project Name:** ${data.project?.name || "N/A"}`,
      mdText`**Project ID:** ${projectId}`,
    ];
  }

  // The plan a project is on and its subscription's status: "N/A" for either not known.
  private static getPlanLines(project: Project): Array<MarkdownText> {
    return [
      mdText`**Plan:** ${project.planName || "N/A"}`,
      mdText`**Subscription Status:** ${
        project.paymentProviderSubscriptionStatus || "N/A"
      }`,
    ];
  }

  // "Added $10 USD", "Deducted $10 USD" or "Set to $10 USD".
  private static describeAdjustment(data: BalanceAdjustedNotice): string {
    const amount: string = this.formatUsd(data.amountInUSDCents / 100);

    if (data.adjustmentType === BalanceAdjustmentType.Add) {
      return `Added ${amount}`;
    }

    if (data.adjustmentType === BalanceAdjustmentType.Deduct) {
      return `Deducted ${amount}`;
    }

    return `Set to ${amount}`;
  }

  // A Microsoft Teams conversation's kind, as a message names it.
  private static getConversationName(type: string | undefined): string {
    switch (type) {
      case "personal":
        return "personal chat";
      case "groupChat":
        return "group chat";
      default:
        return type || "";
    }
  }

  // "Jane Doe (jane@example.com)", or whichever of the two is known.
  private static describePerson(data: {
    name?: Name | string | null | undefined;
    email?: Email | string | null | undefined;
  }): string | null {
    const name: string = data.name?.toString().trim() || "";
    const email: string = data.email?.toString().trim() || "";

    if (name && email) {
      return `${name} (${email})`;
    }

    return name || email || null;
  }

  /*
   * The feedback a customer gave for deleting their project, as a quote:
   * every line of it placed as text, so nothing in it formats the message,
   * links anywhere or mentions anyone. Blank feedback is none.
   *
   * At most as much as a Slack message can show (SlackUtil.MARKDOWN_MAX
   * _LENGTH) is quoted. The dashboard sends at most 5,000 characters
   * (ProjectAPI.MAX_DELETION_REASON_LENGTH), but a reason reaches the delete
   * hooks from any caller, and a longer one is cut here - before every line
   * of it is escaped - and the message ends with Slack's note that the text
   * was truncated. The quote is the message's last part: a line after it
   * would be read as more of the quote.
   */
  private static getDeletionFeedback(
    deletionReason: string | null | undefined,
  ): MarkdownText {
    return this.getQuote("Deletion Feedback", deletionReason);
  }

  /*
   * What a customer wrote, under its title, as a quote (getDeletionFeedback
   * says why each line is placed as text, and how much is quoted). Nothing
   * written is "None given".
   */
  private static getQuote(
    title: string,
    written: string | null | undefined,
  ): MarkdownText {
    const feedback: string = (written || "")
      .trim()
      .substring(0, SlackUtil.MARKDOWN_MAX_LENGTH);

    if (!feedback) {
      return mdText`**${title}:** _None given_`;
    }

    const quotedLines: Array<MarkdownText> = feedback
      .split(LINE_BREAK_PATTERN)
      .map((line: string): MarkdownText => {
        return line.trim() ? mdText`> ${line}` : mdText`>`;
      });

    /*
     * A blank line keeps the quote a block of its own: feedback long enough
     * that Slack's converter would read it slowly is held back whole and
     * shown as written (SlackUtil.slackify), and the project above it stays
     * as it reads.
     */
    return mdText`**${title}:**

${FeedMarkdown.join(quotedLines, "\n")}`;
  }

  private static toSlackText(lines: Array<MarkdownText>): string {
    return SlackUtil.convertMarkdownToSlackRichText(
      FeedMarkdown.join(lines, "\n").toString(),
    );
  }
}
