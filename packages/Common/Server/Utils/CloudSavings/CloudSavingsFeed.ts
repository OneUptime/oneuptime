import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import { CloudAccountFeedEventType } from "../../../Models/DatabaseModels/CloudAccountFeed";
import { CloudResourceFeedEventType } from "../../../Models/DatabaseModels/CloudResourceFeed";
import CloudSavingsAction from "../../../Models/DatabaseModels/CloudSavingsAction";
import {
  Blue500,
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "../../../Types/BrandColors";
import {
  CLOUD_SAVINGS_ACTION_TITLES,
  CloudSavingsActionOrigin,
  CloudSavingsActionUndo,
} from "../../../Types/Cloud/CloudSavingsAction";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import CloudAccountFeedService from "../../Services/CloudAccountFeedService";
import CloudResourceFeedService from "../../Services/CloudResourceFeedService";
import logger from "../Logger";

/*
 * ON THE TIMELINE (#11010): every change for a saving is on its resource's
 * feed and its account's - what changed, who approved it (or which AI rule
 * or schedule made it), and how to undo it, or that it cannot be.
 *
 * Written in English, as every feed line is; the Dashboard draws the
 * feed's Markdown as written. Never throws: the change is made either way.
 */

export enum CloudSavingsFeedEvent {
  Proposed = "Proposed",
  Applied = "Applied",
  Failed = "Failed",
  Dismissed = "Dismissed",
  Undone = "Undone",
}

const RESOURCE_EVENTS: Readonly<
  Record<CloudSavingsFeedEvent, CloudResourceFeedEventType>
> = {
  [CloudSavingsFeedEvent.Proposed]:
    CloudResourceFeedEventType.SavingsActionProposed,
  [CloudSavingsFeedEvent.Applied]:
    CloudResourceFeedEventType.SavingsActionApplied,
  [CloudSavingsFeedEvent.Failed]:
    CloudResourceFeedEventType.SavingsActionFailed,
  [CloudSavingsFeedEvent.Dismissed]:
    CloudResourceFeedEventType.SavingsActionDismissed,
  [CloudSavingsFeedEvent.Undone]:
    CloudResourceFeedEventType.SavingsActionUndone,
};

const ACCOUNT_EVENTS: Readonly<
  Record<CloudSavingsFeedEvent, CloudAccountFeedEventType>
> = {
  [CloudSavingsFeedEvent.Proposed]:
    CloudAccountFeedEventType.SavingsActionProposed,
  [CloudSavingsFeedEvent.Applied]:
    CloudAccountFeedEventType.SavingsActionApplied,
  [CloudSavingsFeedEvent.Failed]: CloudAccountFeedEventType.SavingsActionFailed,
  [CloudSavingsFeedEvent.Dismissed]:
    CloudAccountFeedEventType.SavingsActionDismissed,
  [CloudSavingsFeedEvent.Undone]: CloudAccountFeedEventType.SavingsActionUndone,
};

const COLORS: Readonly<Record<CloudSavingsFeedEvent, Color>> = {
  [CloudSavingsFeedEvent.Proposed]: Blue500,
  [CloudSavingsFeedEvent.Applied]: Green500,
  [CloudSavingsFeedEvent.Failed]: Red500,
  [CloudSavingsFeedEvent.Dismissed]: Gray500,
  [CloudSavingsFeedEvent.Undone]: Yellow500,
};

// "12.50 USD": a figure and its currency, as a feed line writes money.
export function formatFeedMoney(amount: number, currency: string): string {
  return `${(Math.round((Number(amount) || 0) * 100) / 100).toFixed(2)}${NO_BREAK_SPACE}${(
    currency || "USD"
  ).toUpperCase()}`;
}

// How the change is taken back, or that it cannot be: the line's last sentence.
export function getUndoSentence(action: CloudSavingsAction): string {
  if (action.cloudOffHoursScheduleId) {
    return "The schedule starts it again when working hours begin.";
  }

  switch (action.undo) {
    case CloudSavingsActionUndo.Undoable:
      return "Undo it from Cloud > Savings or this resource's page.";
    case CloudSavingsActionUndo.FromSnapshot:
      return "Undo makes the disk again from its final snapshot.";
    default:
      return "It cannot be undone.";
  }
}

// Who made it: "approved by", "made by the AI rule", "stopped by the schedule".
function getByWhom(action: CloudSavingsAction): MarkdownText {
  if (action.origin === CloudSavingsActionOrigin.Schedule) {
    return mdText`by an off-hours schedule`;
  }

  if (action.autoRemediationRuleName && !action.approvedByUserId) {
    return mdText`without asking, as the AI rule **${action.autoRemediationRuleName}** allows`;
  }

  return mdText`on its owner's approval`;
}

export function getFeedMarkdown(data: {
  event: CloudSavingsFeedEvent;
  action: CloudSavingsAction;
  // What the cloud said or did, in a sentence.
  detail?: string | undefined;
}): MarkdownText {
  const action: CloudSavingsAction = data.action;
  const title: string =
    CLOUD_SAVINGS_ACTION_TITLES[action.kind!] || String(action.kind);
  const resource: string = action.resourceName || action.resourceId || "";
  const saves: string = formatFeedMoney(
    Number(action.monthlySavings) || 0,
    action.currency || "USD",
  );
  const detail: string = (data.detail || action.summary || "").trim();

  switch (data.event) {
    case CloudSavingsFeedEvent.Proposed:
      return mdText`**${title}** proposed for ${resource}, to save ${saves} a month. It waits for an owner of the resource to approve it.`;
    case CloudSavingsFeedEvent.Applied:
      return mdText`**${title}** made ${getByWhom(action)}: ${detail} ${getUndoSentence(action)}`;
    case CloudSavingsFeedEvent.Failed:
      return mdText`**${title}** on ${resource} failed: ${detail}`;
    case CloudSavingsFeedEvent.Dismissed:
      return action.dismissReason
        ? mdText`**${title}** for ${resource} was dismissed: ${action.dismissReason}`
        : mdText`**${title}** for ${resource} was dismissed.`;
    case CloudSavingsFeedEvent.Undone:
      return mdText`**${title}** was undone: ${detail}`;
  }
}

/*
 * The line, on the resource's feed (when OneUptime holds the resource) and
 * on its account's. The person who acted is named by the feed itself.
 */
export async function writeCloudSavingsFeed(data: {
  event: CloudSavingsFeedEvent;
  action: CloudSavingsAction;
  detail?: string | undefined;
  userId?: ObjectID | undefined;
}): Promise<void> {
  const action: CloudSavingsAction = data.action;

  if (!action.projectId) {
    return;
  }

  const markdown: string = getFeedMarkdown(data).toString();

  try {
    if (action.cloudResourceId) {
      await CloudResourceFeedService.createCloudResourceFeedItem({
        projectId: action.projectId,
        cloudResourceId: action.cloudResourceId,
        cloudResourceFeedEventType: RESOURCE_EVENTS[data.event],
        displayColor: COLORS[data.event],
        feedInfoInMarkdown: markdown,
        userId: data.userId,
      });
    }

    if (action.cloudAccountId) {
      await CloudAccountFeedService.createCloudAccountFeedItem({
        projectId: action.projectId,
        cloudAccountId: action.cloudAccountId,
        cloudAccountFeedEventType: ACCOUNT_EVENTS[data.event],
        displayColor: COLORS[data.event],
        feedInfoInMarkdown: markdown,
        userId: data.userId,
      });
    }
  } catch (error) {
    logger.error(
      `Cloud savings: could not write the timeline of action ${action.id?.toString()}: ${error}`,
    );
  }
}
