import {
  getProjectNotificationChannelOffMessage,
  ProjectNotificationChannel,
} from "../../Utils/Project/NotificationChannels";
import { ALREADY_PAGED_TIMELINE_MESSAGE } from "./AlreadyPagedTimelineMessage";
import { readAwayUntil } from "./AwayTimelineMessage";
import { ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE } from "./OnCallDirectPage";
import { ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE } from "./OnCallDutyPolicyRunEnding";
import {
  OnCallEmptyLevelLine,
  readOnCallEmptyLevelLine,
} from "./OnCallEmptyLevel";
import {
  isOnCallFallbackFailedStatusMessage,
  isOnCallFallbackNotifiedStatusMessage,
  isOnCallNoNotificationRulesStatusMessage,
  isOnCallNoVerifiedMethodStatusMessage,
  isOnCallOptedOutStatusMessage,
  NOBODY_ON_CALL_IN_SCHEDULE_TIMELINE_MESSAGE,
  NOT_A_PROJECT_MEMBER_STATUS_MESSAGE,
  NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
  ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE,
  PUSH_NOT_SENT_TO_APP_THAT_NO_LONGER_RECEIVES_MESSAGE,
  PUSH_NOT_SENT_TO_BROWSER_THAT_NO_LONGER_RECEIVES_MESSAGE,
  SENDING_NOTIFICATION_TO_USER_TIMELINE_MESSAGE,
} from "./OnCallPageLine";
import { OnCallPageChannel } from "./OnCallPageChannel";
import {
  ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
  ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
  ON_CALL_TEST_PAGE_FIRST_LEVEL_REACHED_NOBODY_MESSAGE,
  ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
  ON_CALL_TEST_PAGE_RULES_RAN_MESSAGE,
  ON_CALL_TEST_PAGE_RUN_UNREADABLE_MESSAGE,
  ON_CALL_TEST_PAGE_WENT_THROUGH_EVERY_LEVEL_MESSAGE,
  OnCallTestPageLine,
  OnCallTestPageLineCode,
} from "./OnCallTestPage";
import { NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE } from "./NextInRotation";

/*
 * A TEST PAGE'S RESULT, LINE BY LINE, AS CODES (#7260).
 *
 * A test page writes its lines in English, as every page does: on each
 * message it did not send (OnCallTestPageDelivery), on each person or
 * target of the run's timeline, and on the run itself. Its result
 * (OnCallTestPageService.getResult) reads the lines it knows back into a
 * code with the values they name, so the Dashboard words them in the
 * reader's language (OnCallTestPageWords). A line read here is compared
 * with the words its writer uses - the same constants and builders - so a
 * line that changes is read the same way, or not at all; a line that is not
 * one of these, such as a provider's own error, gets no code and is shown
 * as written.
 *
 * React-free and server-safe: the server, the dashboard and their tests read
 * it.
 */

// The methods a test does not use while they are not verified.
export type OnCallTestPageNotVerifiedChannel =
  | OnCallPageChannel.Email
  | OnCallPageChannel.SMS
  | OnCallPageChannel.WhatsApp
  | OnCallPageChannel.Call
  | OnCallPageChannel.Telegram
  | OnCallPageChannel.Slack
  | OnCallPageChannel.MicrosoftTeams
  | OnCallPageChannel.Mattermost;

/*
 * How each line is written: around the method's address for an email or a
 * phone number, as a whole for an account.
 */
const NOT_VERIFIED_LINES: Readonly<
  Record<
    OnCallTestPageNotVerifiedChannel,
    { prefix: string; suffix: string } | { whole: string }
  >
> = {
  [OnCallPageChannel.Email]: {
    prefix: "Email notification not sent because email ",
    suffix: " is not verified.",
  },
  [OnCallPageChannel.SMS]: {
    prefix: "SMS not sent because phone ",
    suffix: " is not verified.",
  },
  [OnCallPageChannel.WhatsApp]: {
    prefix: "WhatsApp message not sent because phone ",
    suffix: " is not verified.",
  },
  [OnCallPageChannel.Call]: {
    prefix: "Call not sent because phone ",
    suffix: " is not verified.",
  },
  [OnCallPageChannel.Telegram]: {
    whole:
      "Telegram message not sent because the Telegram account is not verified.",
  },
  [OnCallPageChannel.Slack]: {
    whole: "Slack message not sent because the Slack account is not verified.",
  },
  [OnCallPageChannel.MicrosoftTeams]: {
    whole:
      "Microsoft Teams message not sent because the Microsoft Teams account is not verified.",
  },
  [OnCallPageChannel.Mattermost]: {
    whole:
      "Mattermost message not sent because the Mattermost account is not verified.",
  },
};

/*
 * A message a test did not send, because its method is not verified:
 * "SMS not sent because phone +15550100 is not verified."
 */
export function getOnCallTestPageNotVerifiedMessage(data: {
  channel: OnCallTestPageNotVerifiedChannel;
  // The email or the number: for an email, an SMS, a WhatsApp message or a call.
  address?: string | undefined;
}): string {
  const line: { prefix: string; suffix: string } | { whole: string } =
    NOT_VERIFIED_LINES[data.channel];

  if ("whole" in line) {
    return line.whole;
  }

  return `${line.prefix}${data.address || ""}${line.suffix}`;
}

function isNotVerifiedMessage(
  message: string,
  channel: OnCallPageChannel,
): boolean {
  const line: { prefix: string; suffix: string } | { whole: string } | null =
    (
      NOT_VERIFIED_LINES as Partial<
        Record<
          OnCallPageChannel,
          { prefix: string; suffix: string } | { whole: string }
        >
      >
    )[channel] || null;

  if (!line) {
    return false;
  }

  if ("whole" in line) {
    return message === line.whole;
  }

  return (
    message.length > line.prefix.length + line.suffix.length &&
    message.startsWith(line.prefix) &&
    message.endsWith(line.suffix)
  );
}

/*
 * A message a test did not send to a custom channel that is turned off:
 * "Not sent: Ops bridge is turned off."
 */
const CUSTOM_CHANNEL_OFF_PREFIX: string = "Not sent: ";
const CUSTOM_CHANNEL_OFF_SUFFIX: string = " is turned off.";

export function getOnCallTestPageCustomChannelOffMessage(
  channelName: string,
): string {
  return `${CUSTOM_CHANNEL_OFF_PREFIX}${channelName}${CUSTOM_CHANNEL_OFF_SUFFIX}`;
}

function isCustomChannelOffMessage(message: string): boolean {
  return (
    message.length >
      CUSTOM_CHANNEL_OFF_PREFIX.length + CUSTOM_CHANNEL_OFF_SUFFIX.length &&
    message.startsWith(CUSTOM_CHANNEL_OFF_PREFIX) &&
    message.endsWith(CUSTOM_CHANNEL_OFF_SUFFIX)
  );
}

// The channels the project can switch off, by the page's name for them.
const PROJECT_CHANNEL_OF: Readonly<
  Partial<Record<OnCallPageChannel, ProjectNotificationChannel>>
> = {
  [OnCallPageChannel.SMS]: ProjectNotificationChannel.SMS,
  [OnCallPageChannel.Call]: ProjectNotificationChannel.Call,
  [OnCallPageChannel.WhatsApp]: ProjectNotificationChannel.WhatsApp,
  [OnCallPageChannel.Telegram]: ProjectNotificationChannel.Telegram,
};

/*
 * What one message's line says, as a code: a method that is not verified,
 * a channel switched off in the project, a push device that no longer
 * receives. Null for any other line - a provider's own error, a message on
 * its way - and for a row that names no method.
 */
export function readOnCallTestPageDeliveryLine(data: {
  statusMessage: string | null | undefined;
  channel: OnCallPageChannel | null | undefined;
}): OnCallTestPageLine | null {
  const message: string = (data.statusMessage || "").trim();
  const channel: OnCallPageChannel | null | undefined = data.channel;

  if (!message || !channel) {
    return null;
  }

  if (isNotVerifiedMessage(message, channel)) {
    return { code: OnCallTestPageLineCode.MethodNotVerified, channel: channel };
  }

  if (
    channel === OnCallPageChannel.CustomChannel &&
    isCustomChannelOffMessage(message)
  ) {
    return { code: OnCallTestPageLineCode.MethodNotVerified, channel: channel };
  }

  if (channel === OnCallPageChannel.Push) {
    if (message === PUSH_NOT_SENT_TO_APP_THAT_NO_LONGER_RECEIVES_MESSAGE) {
      return {
        code: OnCallTestPageLineCode.PushDeviceNoLongerReceives,
        isMobileApp: true,
      };
    }

    if (message === PUSH_NOT_SENT_TO_BROWSER_THAT_NO_LONGER_RECEIVES_MESSAGE) {
      return {
        code: OnCallTestPageLineCode.PushDeviceNoLongerReceives,
        isMobileApp: false,
      };
    }
  }

  const projectChannel: ProjectNotificationChannel | undefined =
    PROJECT_CHANNEL_OF[channel];

  if (
    projectChannel &&
    message === getProjectNotificationChannelOffMessage(projectChannel)
  ) {
    return { code: OnCallTestPageLineCode.ChannelOff, channel: channel };
  }

  return null;
}

// A code that names somebody, or something, by name - when there is one.
function withName(
  code: OnCallTestPageLineCode,
  name: string | null | undefined,
): OnCallTestPageLine {
  return name ? { code: code, name: name } : { code: code };
}

/*
 * What one line of the run's timeline says - a person, a team, a schedule
 * or a level - as a code with the name it is about. Null for any other line.
 */
export function readOnCallTestPageStepLine(data: {
  statusMessage: string | null | undefined;
  // The person, the team and the schedule the line is about.
  userName?: string | undefined;
  teamName?: string | undefined;
  scheduleName?: string | undefined;
}): OnCallTestPageLine | null {
  const message: string = (data.statusMessage || "").trim();

  if (!message) {
    return null;
  }

  // The line a page with no rule writes, whichever name of the page it gives.
  if (isOnCallNoNotificationRulesStatusMessage(message)) {
    return { code: OnCallTestPageLineCode.NoRuleNoFallback };
  }

  switch (message) {
    case NOT_A_PROJECT_MEMBER_STATUS_MESSAGE:
    case NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE:
      return withName(OnCallTestPageLineCode.NotProjectMember, data.userName);
    case ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE:
      return withName(OnCallTestPageLineCode.TeamHasNoMembers, data.teamName);
    case NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE:
      return withName(
        OnCallTestPageLineCode.NobodyNextInRotation,
        data.scheduleName,
      );
    case NOBODY_ON_CALL_IN_SCHEDULE_TIMELINE_MESSAGE:
      return withName(OnCallTestPageLineCode.NobodyOnCall, data.scheduleName);
    case ALREADY_PAGED_TIMELINE_MESSAGE:
      return { code: OnCallTestPageLineCode.AlreadyPaged };
    case SENDING_NOTIFICATION_TO_USER_TIMELINE_MESSAGE:
      return { code: OnCallTestPageLineCode.SendingToPerson };
    case ON_CALL_TEST_PAGE_RULES_RAN_MESSAGE:
      return { code: OnCallTestPageLineCode.RulesRan };
    case ON_CALL_TEST_PAGE_RUN_UNREADABLE_MESSAGE:
      return { code: OnCallTestPageLineCode.RunUnreadable };
  }

  switch (readOnCallEmptyLevelLine(message)) {
    case OnCallEmptyLevelLine.NoResponders:
      return { code: OnCallTestPageLineCode.LevelHasNoResponders };
    case OnCallEmptyLevelLine.PagedNobody:
      return { code: OnCallTestPageLineCode.LevelPagedNobody };
    default:
      break;
  }

  const awayUntil: Date | null = readAwayUntil(message);

  if (awayUntil) {
    return {
      ...withName(OnCallTestPageLineCode.AwayWithNobodyCovering, data.userName),
      awayUntil: awayUntil.toISOString(),
    };
  }

  if (isOnCallOptedOutStatusMessage(message)) {
    return { code: OnCallTestPageLineCode.OptedOut };
  }

  if (isOnCallFallbackNotifiedStatusMessage(message)) {
    return { code: OnCallTestPageLineCode.NoRuleFallsBack };
  }

  if (isOnCallNoVerifiedMethodStatusMessage(message)) {
    return withName(OnCallTestPageLineCode.NoVerifiedMethod, data.userName);
  }

  if (isOnCallFallbackFailedStatusMessage(message)) {
    return { code: OnCallTestPageLineCode.FallbackFailed };
  }

  return null;
}

/*
 * What the run's own line says once the test ended or failed, as a code.
 * Null for any other line - one that is still paging, an error's own words.
 */
export function readOnCallTestPageRunLine(
  statusMessage: string | null | undefined,
): OnCallTestPageLine | null {
  switch ((statusMessage || "").trim()) {
    case ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE:
    case ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE:
      return { code: OnCallTestPageLineCode.NobodyPaged };
    case ON_CALL_TEST_PAGE_FIRST_LEVEL_REACHED_NOBODY_MESSAGE:
      return { code: OnCallTestPageLineCode.FirstLevelReachedNobody };
    case ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE:
      return {
        code: OnCallTestPageLineCode.EndedUnanswered,
        minutes: ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
      };
    case ON_CALL_TEST_PAGE_WENT_THROUGH_EVERY_LEVEL_MESSAGE:
      return { code: OnCallTestPageLineCode.WentThroughEveryLevel };
    case ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE:
      return { code: OnCallTestPageLineCode.PolicyHasNoLevels };
    default:
      return null;
  }
}
