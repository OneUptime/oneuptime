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
 * webhooks set with NOTIFICATION_SLACK_WEBHOOK_ON_* (EnvironmentConfig) -
 * about a project:
 *
 * - its balance for SMS and calls, or its AI balance, refilled - by Auto
 *   Recharge or the Recharge button (NotificationService, AIBillingService);
 * - either balance adjusted by a master admin (ProjectService.adjustBalance);
 * - the project deleted, with the feedback its owner gave for deleting it
 *   (ProjectService.onDeleteSuccess).
 *
 * Both balances post to NOTIFICATION_SLACK_WEBHOOK_ON_SUBSCRIPTION_UPDATE, in
 * the same words, so a refill or an adjustment of AI credits reads exactly as
 * one of SMS and call balance does.
 *
 * A project's name, its creator's name and the feedback a customer typed are
 * text OneUptime did not write - a project named "<!channel>" would notify the
 * whole channel - so each message is written with mdText, which places every
 * value as text, and converted to Slack's mrkdwn
 * (SlackUtil.convertMarkdownToSlackRichText), as a status page's Slack
 * messages are.
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
   * Posts a message to an operator's incoming webhook. Never throws: the
   * message is a notice to the operator, and what it is about - a recharge,
   * an adjustment, a deletion - has happened already. A message Slack did
   * not take, or a webhook that is not one, is logged.
   */
  public static async post(data: {
    webhookUrl: string;
    text: string;
    // What the message is about, for the log line: "AI balance refill".
    about: string;
    projectId?: ObjectID | null | undefined;
  }): Promise<void> {
    const logAttributes: LogAttributes = (
      data.projectId ? { projectId: data.projectId.toString() } : {}
    ) as LogAttributes;

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
    const feedback: string = (deletionReason || "")
      .trim()
      .substring(0, SlackUtil.MARKDOWN_MAX_LENGTH);

    if (!feedback) {
      return mdText`**Deletion Feedback:** _None given_`;
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
    return mdText`**Deletion Feedback:**

${FeedMarkdown.join(quotedLines, "\n")}`;
  }

  private static toSlackText(lines: Array<MarkdownText>): string {
    return SlackUtil.convertMarkdownToSlackRichText(
      FeedMarkdown.join(lines, "\n").toString(),
    );
  }
}
