import PageMap from "../../Utils/PageMap";
import Color from "Common/Types/Color";
import {
  Blue500,
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageDeliveryStatus,
  OnCallTestPageFix,
  OnCallTestPageStatus,
  OnCallTestPageStepStatus,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS A TEST PAGE'S DIALOG AND RESULT USE (OnCallTestPage), each a
 * whole phrase translated as one - and the page each fix opens.
 */

// What a channel is called in a line of the result: "SMS", "Phone call".
export const CHANNEL_NAMES: Readonly<Record<OnCallPageChannel, string>> = {
  [OnCallPageChannel.Call]: translationKey("Phone call"),
  [OnCallPageChannel.SMS]: translationKey("SMS"),
  [OnCallPageChannel.WhatsApp]: translationKey("WhatsApp"),
  [OnCallPageChannel.Telegram]: translationKey("Telegram"),
  [OnCallPageChannel.Push]: translationKey("Push notification"),
  [OnCallPageChannel.Email]: translationKey("Email"),
  [OnCallPageChannel.Slack]: translationKey("Slack"),
  [OnCallPageChannel.MicrosoftTeams]: translationKey("Microsoft Teams"),
  [OnCallPageChannel.Mattermost]: translationKey("Mattermost"),
  [OnCallPageChannel.Webhook]: translationKey("Webhook"),
  [OnCallPageChannel.CustomChannel]: translationKey("Custom channel"),
};

/*
 * "by SMS", "by phone call": the channel the test was acknowledged from, in
 * the result's sentence.
 */
export const ACKNOWLEDGED_BY_SENTENCES: Readonly<
  Record<OnCallPageChannel, string>
> = {
  [OnCallPageChannel.Call]: translationKey(
    "{{name}} acknowledged it by phone call after {{time}}.",
  ),
  [OnCallPageChannel.SMS]: translationKey(
    "{{name}} acknowledged it by SMS after {{time}}.",
  ),
  [OnCallPageChannel.WhatsApp]: translationKey(
    "{{name}} acknowledged it by WhatsApp after {{time}}.",
  ),
  [OnCallPageChannel.Telegram]: translationKey(
    "{{name}} acknowledged it by Telegram after {{time}}.",
  ),
  [OnCallPageChannel.Push]: translationKey(
    "{{name}} acknowledged it by push notification after {{time}}.",
  ),
  [OnCallPageChannel.Email]: translationKey(
    "{{name}} acknowledged it by email after {{time}}.",
  ),
  [OnCallPageChannel.Slack]: translationKey(
    "{{name}} acknowledged it in Slack after {{time}}.",
  ),
  [OnCallPageChannel.MicrosoftTeams]: translationKey(
    "{{name}} acknowledged it in Microsoft Teams after {{time}}.",
  ),
  [OnCallPageChannel.Mattermost]: translationKey(
    "{{name}} acknowledged it in Mattermost after {{time}}.",
  ),
  [OnCallPageChannel.Webhook]: translationKey(
    "{{name}} acknowledged it by webhook after {{time}}.",
  ),
  [OnCallPageChannel.CustomChannel]: translationKey(
    "{{name}} acknowledged it by custom channel after {{time}}.",
  ),
};

export const DELIVERY_STATUS_WORDS: Readonly<
  Record<OnCallTestPageDeliveryStatus, { text: string; color: Color }>
> = {
  [OnCallTestPageDeliveryStatus.Sending]: {
    text: translationKey("Sending"),
    color: Gray500,
  },
  [OnCallTestPageDeliveryStatus.Sent]: {
    text: translationKey("Sent"),
    color: Blue500,
  },
  [OnCallTestPageDeliveryStatus.Delivered]: {
    text: translationKey("Delivered"),
    color: Green500,
  },
  [OnCallTestPageDeliveryStatus.NotAnswered]: {
    text: translationKey("Not answered"),
    color: Yellow500,
  },
  [OnCallTestPageDeliveryStatus.Acknowledged]: {
    text: translationKey("Acknowledged"),
    color: Green500,
  },
  [OnCallTestPageDeliveryStatus.Failed]: {
    text: translationKey("Failed"),
    color: Red500,
  },
};

export const STEP_STATUS_WORDS: Readonly<
  Record<OnCallTestPageStepStatus, { text: string; color: Color }>
> = {
  [OnCallTestPageStepStatus.Paged]: {
    text: translationKey("Paged"),
    color: Blue500,
  },
  [OnCallTestPageStepStatus.Acknowledged]: {
    text: translationKey("Acknowledged"),
    color: Green500,
  },
  [OnCallTestPageStepStatus.Skipped]: {
    text: translationKey("Not paged"),
    color: Yellow500,
  },
  [OnCallTestPageStepStatus.Failed]: {
    text: translationKey("Failed"),
    color: Red500,
  },
};

// The result's headline, and its color.
export const RESULT_STATUS_WORDS: Readonly<
  Record<OnCallTestPageStatus, { title: string; color: Color }>
> = {
  [OnCallTestPageStatus.Paging]: {
    title: translationKey("Waiting for an acknowledgement"),
    color: Blue500,
  },
  [OnCallTestPageStatus.Acknowledged]: {
    title: translationKey("It works"),
    color: Green500,
  },
  [OnCallTestPageStatus.Ended]: {
    title: translationKey("Nobody acknowledged it"),
    color: Yellow500,
  },
  [OnCallTestPageStatus.Failed]: {
    title: translationKey("The test could not run"),
    color: Red500,
  },
};

// Where a message that did not go out is put right, and the link's words.
export interface OnCallTestPageFixLink {
  pageMap: PageMap;
  text: string;
}

export const FIX_LINKS: Readonly<
  Record<OnCallTestPageFix, OnCallTestPageFixLink>
> = {
  [OnCallTestPageFix.NotificationMethods]: {
    pageMap: PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
    text: translationKey("Open Notification Methods"),
  },
  [OnCallTestPageFix.OnCallRules]: {
    pageMap: PageMap.USER_SETTINGS_ON_CALL_RULES,
    text: translationKey("Open On-Call Rules"),
  },
  [OnCallTestPageFix.ProjectNotificationSettings]: {
    pageMap: PageMap.SETTINGS_NOTIFICATION_SETTINGS,
    text: translationKey("Open Notification Settings"),
  },
  [OnCallTestPageFix.ProjectBalance]: {
    pageMap: PageMap.SETTINGS_BILLING,
    text: translationKey("Open Billing"),
  },
  [OnCallTestPageFix.ProjectCallAndSms]: {
    pageMap: PageMap.SETTINGS_NOTIFICATION_SETTINGS,
    text: translationKey("Open Notification Settings"),
  },
  [OnCallTestPageFix.ProjectWorkspaceConnections]: {
    pageMap: PageMap.SETTINGS_SLACK_INTEGRATION,
    text: translationKey("Open the workspace connection"),
  },
};

/*
 * The workspace a fix of a chat message opens: the one the message was
 * sent through, Slack when it is not known.
 */
export function getFixLink(data: {
  fix: OnCallTestPageFix;
  channel: OnCallPageChannel | null;
}): OnCallTestPageFixLink {
  if (data.fix === OnCallTestPageFix.ProjectWorkspaceConnections) {
    if (data.channel === OnCallPageChannel.MicrosoftTeams) {
      return {
        ...FIX_LINKS[data.fix],
        pageMap: PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
      };
    }

    if (data.channel === OnCallPageChannel.Mattermost) {
      return {
        ...FIX_LINKS[data.fix],
        pageMap: PageMap.SETTINGS_MATTERMOST_INTEGRATION,
      };
    }
  }

  return FIX_LINKS[data.fix];
}
