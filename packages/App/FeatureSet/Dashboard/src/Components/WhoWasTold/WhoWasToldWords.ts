import { describeAnswerTime } from "../OnCallTestPage/TestPageResult";
import { CHANNEL_NAMES } from "../OnCallTestPage/OnCallTestPageWords";
import {
  getOnCallLogStepWords,
  getOnCallRunWords,
} from "../OnCallPolicy/ExecutionLogs/OnCallLogLineWords";
import { ON_CALL_POLICY_RUN_STATUS_LABELS } from "../OnCallPolicy/ExecutionLogs/OnCallLogStatusLabels";
import {
  WhoWasToldChannelGroup,
  WhoWasToldCounts,
  WhoWasToldNotification,
  WhoWasToldPage,
  WhoWasToldPerson,
  WhoWasToldResult,
  WhoWasToldRun,
  WhoWasToldTarget,
  getWhoWasToldCounts,
  getWhoWasToldRunsThatPagedNobody,
} from "Common/Types/Notification/WhoWasTold";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageDeliveryStatus,
  OnCallTestPageRecordKind,
  OnCallTestPageStepStatus,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import {
  composedValue,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import WorkspaceRefusal, {
  WorkspaceRefusalReading,
} from "Common/Utils/Workspace/WorkspaceRefusal";
import {
  STATUS_CHIPS,
  WHO_WAS_TOLD_COPY,
  WHO_WAS_TOLD_PLURALS,
  WhoWasToldChip,
} from "./WhoWasToldCopy";

/*
 * "WHO WAS TOLD" IN THE READER'S WORDS (Types/Notification/WhoWasTold,
 * #7075).
 *
 * The server says what happened as data; each sentence and chip the card
 * draws is a whole phrase looked up here, the project's own names - a
 * person, a policy, a channel - set into it. A step's or a run's line is
 * worded as the on-call logs word it (OnCallLogLineWords), a notification's
 * status as a test page's result says it (OnCallTestPageWords), and a
 * workspace's refusal as the Workspace Logs table says it (WorkspaceRefusal,
 * #9349), so one thing reads alike on every page.
 */

// The card's own words, for whoever words it: WhoWasToldCopy.
export { STATUS_CHIPS, WHO_WAS_TOLD_COPY, WHO_WAS_TOLD_PLURALS };
export type { WhoWasToldChip };

// What became of one notification, as a test page's result says it.
export const DELIVERY_CHIPS: Readonly<
  Record<OnCallTestPageDeliveryStatus, WhoWasToldChip>
> = {
  [OnCallTestPageDeliveryStatus.Sending]: {
    text: translationKey("Sending"),
    tone: PillTone.Neutral,
  },
  [OnCallTestPageDeliveryStatus.Sent]: {
    text: translationKey("Sent"),
    tone: PillTone.Info,
  },
  [OnCallTestPageDeliveryStatus.Delivered]: {
    text: translationKey("Delivered"),
    tone: PillTone.Success,
  },
  [OnCallTestPageDeliveryStatus.NotAnswered]: {
    text: translationKey("Not answered"),
    tone: PillTone.Warning,
  },
  [OnCallTestPageDeliveryStatus.Acknowledged]: {
    text: translationKey("Acknowledged"),
    tone: PillTone.Success,
  },
  [OnCallTestPageDeliveryStatus.Failed]: {
    text: translationKey("Failed"),
    tone: PillTone.Danger,
  },
};

// What became of one page.
export const PAGE_CHIPS: Readonly<
  Record<OnCallTestPageStepStatus, WhoWasToldChip>
> = {
  [OnCallTestPageStepStatus.Paged]: {
    text: translationKey("Paged"),
    tone: PillTone.Info,
  },
  [OnCallTestPageStepStatus.Acknowledged]: {
    text: translationKey("Acknowledged"),
    tone: PillTone.Success,
  },
  [OnCallTestPageStepStatus.Skipped]: {
    text: translationKey("Not paged"),
    tone: PillTone.Warning,
  },
  [OnCallTestPageStepStatus.Failed]: {
    text: translationKey("Failed"),
    tone: PillTone.Danger,
  },
};

// The record's created notification to its status pages' subscribers.
export const SUBSCRIBER_CHIPS: Readonly<
  Record<StatusPageSubscriberNotificationStatus, WhoWasToldChip>
> = {
  [StatusPageSubscriberNotificationStatus.Success]: {
    text: translationKey("Notified"),
    tone: PillTone.Info,
  },
  [StatusPageSubscriberNotificationStatus.Failed]: {
    text: translationKey("Failed"),
    tone: PillTone.Danger,
  },
  [StatusPageSubscriberNotificationStatus.Skipped]: {
    text: translationKey("Not notified"),
    tone: PillTone.Neutral,
  },
  [StatusPageSubscriberNotificationStatus.Pending]: {
    text: translationKey("Waiting"),
    tone: PillTone.Neutral,
  },
  [StatusPageSubscriberNotificationStatus.InProgress]: {
    text: translationKey("Sending"),
    tone: PillTone.Neutral,
  },
};

/*
 * A run that paged nobody, by its status (ON_CALL_POLICY_RUN_STATUS_LABELS,
 * the words its Execution Logs draw): one that waits - for working hours,
 * for OneUptime AI - is no failure; one that reached nobody needs a look.
 */
export function getRunChip(status: string): WhoWasToldChip {
  const text: string =
    ON_CALL_POLICY_RUN_STATUS_LABELS[status as OnCallDutyPolicyStatus] ||
    status;

  switch (status) {
    case OnCallDutyPolicyStatus.Error:
      return { text: text, tone: PillTone.Danger };
    case OnCallDutyPolicyStatus.CompletedWithNoNotifications:
      return { text: text, tone: PillTone.Warning };
    case OnCallDutyPolicyStatus.Waiting:
    case OnCallDutyPolicyStatus.Scheduled:
      return { text: text, tone: PillTone.Neutral };
    default:
      return { text: text, tone: PillTone.Info };
  }
}

// A channel's name in the reader's words: "SMS", "Phone call".
export function getChannelName(
  channel: OnCallPageChannel,
  translator: Translator,
): string {
  const name: string = CHANNEL_NAMES[channel] || channel;
  return translator.translateText(name) || name;
}

/*
 * THE CARD'S FIRST WORDS: how many people and channels OneUptime told, who
 * acknowledged it first and how soon after its first page, and how many
 * notifications failed - or, with nothing yet, that nobody has been told.
 */
export function getWhoWasToldSentences(
  result: Pick<
    WhoWasToldResult,
    "people" | "channels" | "runs" | "recordKind" | "subscribers"
  >,
  translator: Translator,
): Array<string> {
  const counts: WhoWasToldCounts = getWhoWasToldCounts(result);
  const sentences: Array<string> = [];

  if (counts.toldPeopleCount > 0 && counts.toldChannelCount > 0) {
    sentences.push(
      translator.translateTemplate(WHO_WAS_TOLD_COPY.toldPeopleAndChannels, {
        people: composedValue((sentence: Translator): string => {
          return sentence.translatePlural(
            WHO_WAS_TOLD_PLURALS.people,
            counts.toldPeopleCount,
          );
        }),
        channels: composedValue((sentence: Translator): string => {
          return sentence.translatePlural(
            WHO_WAS_TOLD_PLURALS.channels,
            counts.toldChannelCount,
          );
        }),
      }),
    );
  } else if (counts.toldPeopleCount > 0) {
    sentences.push(
      translator.translatePlural(
        WHO_WAS_TOLD_PLURALS.toldPeople,
        counts.toldPeopleCount,
      ),
    );
  } else if (counts.toldChannelCount > 0) {
    sentences.push(
      translator.translatePlural(
        WHO_WAS_TOLD_PLURALS.postedChannels,
        counts.toldChannelCount,
      ),
    );
  } else {
    sentences.push(
      translator.translateText(
        result.recordKind === OnCallTestPageRecordKind.Alert
          ? WHO_WAS_TOLD_COPY.nobodyYetAlert
          : WHO_WAS_TOLD_COPY.nobodyYetIncident,
      ) || "",
    );
  }

  if (counts.firstAcknowledgement) {
    const name: string =
      counts.firstAcknowledgement.name ||
      translator.translateText(WHO_WAS_TOLD_COPY.someone) ||
      "";

    sentences.push(
      typeof counts.firstAcknowledgement.afterSeconds === "number"
        ? translator.translateTemplate(WHO_WAS_TOLD_COPY.acknowledgedAfter, {
            name: name,
            time: composedValue((sentence: Translator): string => {
              return describeAnswerTime(
                sentence,
                counts.firstAcknowledgement?.afterSeconds || 0,
              );
            }),
          })
        : translator.translateTemplate(WHO_WAS_TOLD_COPY.acknowledged, {
            name: name,
          }),
    );
  }

  if (counts.failedCount > 0) {
    sentences.push(
      translator.translatePlural(
        WHO_WAS_TOLD_PLURALS.failed,
        counts.failedCount,
      ),
    );
  }

  return sentences.filter(Boolean);
}

/*
 * What the reader may not read, counted: notifications whose logs they may
 * not open, and runs of policies they may not see. Never who, or what.
 */
export function getWhoWasToldHiddenSentences(
  result: Pick<WhoWasToldResult, "hiddenNotificationCount" | "hiddenRunCount">,
  translator: Translator,
): Array<string> {
  const sentences: Array<string> = [];

  if (result.hiddenNotificationCount > 0) {
    sentences.push(
      translator.translatePlural(
        WHO_WAS_TOLD_PLURALS.hiddenNotifications,
        result.hiddenNotificationCount,
      ),
    );
  }

  if (result.hiddenRunCount > 0) {
    sentences.push(
      translator.translatePlural(
        WHO_WAS_TOLD_PLURALS.hiddenRuns,
        result.hiddenRunCount,
      ),
    );
  }

  return sentences;
}

/*
 * How a page reached a person, or where a target was: "Paged by Default ·
 * Level 1 · Team Platform", "Paged directly · Covering for Ana Lopez" -
 * each piece a phrase of its own, set off as the reader's language does.
 */
export function getPageThroughWords(
  translator: Translator,
  page: Pick<
    WhoWasToldPage,
    | "policyName"
    | "isDirectPage"
    | "levelOrder"
    | "levelName"
    | "teamName"
    | "scheduleName"
    | "isNextInRotation"
  > &
    Partial<Pick<WhoWasToldPage, "coveringForName">>,
): Array<string> {
  const pieces: Array<string> = [];

  if (page.isDirectPage) {
    pieces.push(
      translator.translateText(WHO_WAS_TOLD_COPY.pagedDirectly) || "",
    );
  } else if (page.policyName) {
    pieces.push(
      translator.translateTemplate(WHO_WAS_TOLD_COPY.pagedBy, {
        policy: page.policyName,
      }),
    );
  }

  if (page.levelOrder) {
    pieces.push(
      translator.translateTemplate("Level {{order}}", {
        order: page.levelOrder,
      }),
    );
  }

  if (page.teamName) {
    pieces.push(
      translator.translateTemplate("Team {{name}}", { name: page.teamName }),
    );
  }

  if (page.scheduleName) {
    pieces.push(
      translator.translateTemplate("Schedule {{name}}", {
        name: page.scheduleName,
      }),
    );
  }

  if (page.isNextInRotation) {
    pieces.push(translator.translateText("Next in rotation") || "");
  }

  if (page.coveringForName) {
    pieces.push(
      translator.translateTemplate("Covering for {{name}}", {
        name: page.coveringForName,
      }),
    );
  }

  return pieces.filter(Boolean);
}

/*
 * Why a page did not reach them, or what became of it: the step's line in
 * the reader's words where the on-call logs word it, else as written. Null
 * for a page that went out with nothing to say.
 */
export function getPageReason(
  translator: Translator,
  page: Pick<
    WhoWasToldPage,
    | "statusMessage"
    | "status"
    | "userNotificationEventType"
    | "teamName"
    | "scheduleName"
  >,
  personName: string,
): string | null {
  if (
    !page.statusMessage ||
    page.status === OnCallTestPageStepStatus.Acknowledged
  ) {
    return null;
  }

  return (
    getOnCallLogStepWords(translator, {
      statusMessage: page.statusMessage,
      userNotificationEventType: page.userNotificationEventType as
        | UserNotificationEventType
        | undefined,
      userName: personName || undefined,
      teamName: page.teamName,
      scheduleName: page.scheduleName,
    }) || page.statusMessage
  );
}

// Why a target reached nobody: its step's line, worded where it can be.
export function getTargetReason(
  translator: Translator,
  target: WhoWasToldTarget,
): string {
  return (
    getOnCallLogStepWords(translator, {
      statusMessage: target.statusMessage,
      userNotificationEventType: target.userNotificationEventType as
        | UserNotificationEventType
        | undefined,
      teamName: target.teamName,
      scheduleName: target.scheduleName,
    }) || target.statusMessage
  );
}

// Why a run paged nobody: its own line, as its Execution Logs word it.
export function getRunReason(
  translator: Translator,
  run: WhoWasToldRun,
): string {
  return (
    getOnCallRunWords(translator, {
      statusMessage: run.statusMessage,
      userNotificationEventType: run.userNotificationEventType as
        | UserNotificationEventType
        | undefined,
    }) || run.statusMessage
  );
}

/*
 * Why a notification did not go out, or how a call ended: a workspace's
 * refusal in OneUptime's words, as the Workspace Logs' Reason column says
 * it (#9349), any other as its log wrote it. Null for one with nothing to say.
 */
export function getNotificationReason(
  notification: Pick<
    WhoWasToldNotification,
    "statusMessage" | "status" | "workspaceType" | "channel"
  >,
): string | null {
  if (!notification.statusMessage) {
    return null;
  }

  if (
    notification.workspaceType &&
    notification.status === OnCallTestPageDeliveryStatus.Failed
  ) {
    const reading: WorkspaceRefusalReading = WorkspaceRefusal.read({
      message: notification.statusMessage,
      workspaceType: notification.workspaceType,
    });

    if (reading.reason) {
      return reading.reason;
    }
  }

  return notification.statusMessage;
}

// The channels a person's or a channel's notifications went by, each once.
export function getChannelsOf(
  notifications: ReadonlyArray<Pick<WhoWasToldNotification, "channel">>,
  pages: ReadonlyArray<Pick<WhoWasToldPage, "channels">> = [],
): Array<OnCallPageChannel> {
  const channels: Array<OnCallPageChannel> = [];

  for (const channel of [
    ...pages.flatMap(
      (page: Pick<WhoWasToldPage, "channels">): Array<OnCallPageChannel> => {
        return page.channels;
      },
    ),
    ...notifications.map(
      (notification: Pick<WhoWasToldNotification, "channel">) => {
        return notification.channel;
      },
    ),
  ]) {
    if (!channels.includes(channel)) {
      channels.push(channel);
    }
  }

  return channels;
}

/*
 * THE LIST'S SECTIONS, each in order of time: the people told, paged or
 * skipped; what was not paged (a target that reached nobody, a run that
 * paged nobody); the channels posted to; the status page subscribers.
 */
export interface WhoWasToldSections {
  people: Array<WhoWasToldPerson>;
  notPaged: Array<WhoWasToldTarget>;
  runsThatPagedNobody: Array<WhoWasToldRun>;
  channels: Array<WhoWasToldChannelGroup>;
}

export function getWhoWasToldSections(
  result: WhoWasToldResult,
): WhoWasToldSections {
  // A run whose targets say why it paged nobody is said by them, not again.
  const runsWithTargets: Set<string> = new Set<string>(
    result.notPaged.map((target: WhoWasToldTarget): string => {
      return target.runId;
    }),
  );

  return {
    people: result.people,
    notPaged: result.notPaged,
    runsThatPagedNobody: getWhoWasToldRunsThatPagedNobody(result).filter(
      (run: WhoWasToldRun): boolean => {
        return !runsWithTargets.has(run.id);
      },
    ),
    channels: result.channels,
  };
}

// The most people a busy record lists before "Show more".
export const WHO_WAS_TOLD_PEOPLE_SHOWN: number = 6;
