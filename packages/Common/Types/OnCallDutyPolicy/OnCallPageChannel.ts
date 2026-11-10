import UserNotificationStatus from "../UserNotification/UserNotificationStatus";

/*
 * HOW A PAGE REACHES SOMEBODY, AND HOW THEY ANSWER IT.
 *
 * A page reaches a person through their own On-Call Rules: an email and a
 * push now, an SMS after five minutes, a call after ten. Each notification
 * that goes out is a row of their on-call timeline (UserOnCallLogTimeline),
 * and which channel it went out by is which of the row's notification
 * method columns is set - its call, its SMS, its push device. The person
 * answers the page from one of those notifications - a call's 1, an SMS's
 * link, a button in Slack - and the row they answered from says so: it is
 * acknowledged, or it is the one they escalated the page from.
 *
 * The record's feed tells this story (OnCallFeedText): "On-call policy
 * Payments paged Nitin Kumar via push notification and email at Level 1 of
 * 3", "... paged Nitin Kumar again via phone call ...", "Nitin Kumar did
 * not answer the phone call ...", "Nitin Kumar acknowledged the page ...
 * via phone call". The run's Slack and Microsoft
 * Teams message says the same in its own short words: "Nitin: paged once ·
 * by SMS and email" (OnCallPolicyRunMessage). This file is the one list of
 * the channels both read, so a new channel is named everywhere at once.
 */

export enum OnCallPageChannel {
  Call = "Call",
  SMS = "SMS",
  WhatsApp = "WhatsApp",
  Telegram = "Telegram",
  Push = "Push",
  Email = "Email",
  Slack = "Slack",
  MicrosoftTeams = "Microsoft Teams",
  Mattermost = "Mattermost",
  Webhook = "Webhook",
  CustomChannel = "Custom Channel",
}

/*
 * The notification method columns of one notification of a page, as a
 * UserOnCallLogTimeline row holds them: the one set is the channel it went
 * out by. Read structurally, so this file needs no model.
 */
export interface OnCallPageNotificationMethods {
  userCallId?: unknown;
  userSmsId?: unknown;
  userWhatsAppId?: unknown;
  userTelegramId?: unknown;
  userPushId?: unknown;
  userEmailId?: unknown;
  userSlackId?: unknown;
  userMicrosoftTeamsId?: unknown;
  userMattermostId?: unknown;
  userWebhookId?: unknown;
  customNotificationChannelId?: unknown;
}

// One notification of a page: its channel, where it stands, and its answer.
export interface OnCallPageNotification extends OnCallPageNotificationMethods {
  id?: { toString(): string } | null | undefined;
  status?: UserNotificationStatus | string | null | undefined;
  isAcknowledged?: boolean | null | undefined;
  acknowledgedAt?: Date | string | null | undefined;
  createdAt?: Date | string | null | undefined;
}

export interface OnCallPageChannelInfo {
  channel: OnCallPageChannel;
  // The column of a notification that is set when it went out by it.
  field: keyof OnCallPageNotificationMethods;
  /*
   * In a sentence of the record's feed, after "via": "paged Nitin via
   * phone call", "acknowledged the page via push notification".
   */
  name: string;
  /*
   * In the run's Slack and Microsoft Teams message, where a person's line
   * is kept short: "paged once · by call and push".
   */
  shortName: string;
}

/*
 * Every channel, in the order a list names them: the ones that wake
 * somebody up first, as the run's Slack message has always listed them.
 */
export const ON_CALL_PAGE_CHANNELS: ReadonlyArray<OnCallPageChannelInfo> = [
  {
    channel: OnCallPageChannel.Call,
    field: "userCallId",
    name: "phone call",
    shortName: "call",
  },
  {
    channel: OnCallPageChannel.SMS,
    field: "userSmsId",
    name: "SMS",
    shortName: "SMS",
  },
  {
    channel: OnCallPageChannel.WhatsApp,
    field: "userWhatsAppId",
    name: "WhatsApp",
    shortName: "WhatsApp",
  },
  {
    channel: OnCallPageChannel.Telegram,
    field: "userTelegramId",
    name: "Telegram",
    shortName: "Telegram",
  },
  {
    channel: OnCallPageChannel.Push,
    field: "userPushId",
    name: "push notification",
    shortName: "push",
  },
  {
    channel: OnCallPageChannel.Email,
    field: "userEmailId",
    name: "email",
    shortName: "email",
  },
  {
    channel: OnCallPageChannel.Slack,
    field: "userSlackId",
    name: "Slack",
    shortName: "Slack",
  },
  {
    channel: OnCallPageChannel.MicrosoftTeams,
    field: "userMicrosoftTeamsId",
    name: "Microsoft Teams",
    shortName: "Microsoft Teams",
  },
  {
    channel: OnCallPageChannel.Mattermost,
    field: "userMattermostId",
    name: "Mattermost",
    shortName: "Mattermost",
  },
  {
    channel: OnCallPageChannel.Webhook,
    field: "userWebhookId",
    name: "webhook",
    shortName: "webhook",
  },
  {
    channel: OnCallPageChannel.CustomChannel,
    field: "customNotificationChannelId",
    name: "custom channel",
    shortName: "custom channel",
  },
];

/*
 * The message a person's page is marked "Notification Sent" with when its
 * first notifications went out (UserOnCallLogService). It says nothing the
 * feed's sentence does not - who was paged, and now via what - so the feed
 * leaves it out (OnCallFeedText).
 */
export const ON_CALL_PAGE_SENT_STATUS_MESSAGE: string = "Alert Sent";

/*
 * Whether a notification went out - or is going out - to its person:
 * sending, sent, answered, or a call that rang and was not picked up. One
 * that failed or was skipped did not.
 */
export function isOnCallPageNotificationOut(
  status: UserNotificationStatus | string | null | undefined,
): boolean {
  return (
    status === UserNotificationStatus.Sending ||
    status === UserNotificationStatus.Sent ||
    status === UserNotificationStatus.Acknowledged ||
    status === UserNotificationStatus.PassedOn ||
    status === UserNotificationStatus.NotAnswered
  );
}

/*
 * The channels that ring, and so can be picked up or not: a phone call.
 * Only a notification by one of them can go unanswered
 * (UserNotificationStatus.NotAnswered) - an SMS or an email is read when it
 * is read.
 */
export const ON_CALL_PAGE_RINGING_CHANNELS: ReadonlyArray<OnCallPageChannel> = [
  OnCallPageChannel.Call,
];

/*
 * The channels one notification went out by - one, as every notification
 * method is a rule of its own; a rule written through the API can name two,
 * and its one row then names both. In the list's order.
 */
export function getOnCallPageChannelsOf(
  notification: OnCallPageNotificationMethods | null | undefined,
): Array<OnCallPageChannel> {
  if (!notification) {
    return [];
  }

  return ON_CALL_PAGE_CHANNELS.filter((info: OnCallPageChannelInfo) => {
    return Boolean(notification[info.field]);
  }).map((info: OnCallPageChannelInfo) => {
    return info.channel;
  });
}

// What a channel is called in a sentence of the feed: "phone call".
export function getOnCallPageChannelName(channel: OnCallPageChannel): string {
  return (
    ON_CALL_PAGE_CHANNELS.find((info: OnCallPageChannelInfo) => {
      return info.channel === channel;
    })?.name || channel.toString()
  );
}

// What a channel is called in the run's chat message: "call".
export function getOnCallPageChannelShortName(
  channel: OnCallPageChannel,
): string {
  return (
    ON_CALL_PAGE_CHANNELS.find((info: OnCallPageChannelInfo) => {
      return info.channel === channel;
    })?.shortName || channel.toString()
  );
}

// Channels as a list names them: each once, in the list's order.
export function sortOnCallPageChannels(
  channels: Array<OnCallPageChannel>,
): Array<OnCallPageChannel> {
  return ON_CALL_PAGE_CHANNELS.filter((info: OnCallPageChannelInfo) => {
    return channels.includes(info.channel);
  }).map((info: OnCallPageChannelInfo) => {
    return info.channel;
  });
}

/*
 * The channels a page went out to its person by: every notification of it
 * that went out (isOnCallPageNotificationOut), each channel once. One that
 * could not be sent is told of on its own, not counted here.
 */
export function getOnCallPageChannelsOut(
  notifications: Array<OnCallPageNotification>,
): Array<OnCallPageChannel> {
  const channels: Array<OnCallPageChannel> = [];

  for (const notification of notifications) {
    if (!isOnCallPageNotificationOut(notification.status)) {
      continue;
    }

    channels.push(...getOnCallPageChannelsOf(notification));
  }

  return sortOnCallPageChannels(channels);
}

// A moment of a notification, as a number to order by; 0 when it has none.
function getTime(value: Date | string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const time: number = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
}

/*
 * The channel the person answered their page from: the notification they
 * acknowledged it from - the latest, should there be two - or, for a page
 * they escalated, the one they escalated it from. Empty when they answered
 * some other way - by acknowledging the record itself, in the Dashboard or
 * the app - which no notification of the page records.
 */
export function getOnCallPageAnsweredChannels(
  notifications: Array<OnCallPageNotification>,
  answer: "acknowledged" | "escalated",
): Array<OnCallPageChannel> {
  const answeredFrom: Array<OnCallPageNotification> = notifications.filter(
    (notification: OnCallPageNotification) => {
      return answer === "acknowledged"
        ? Boolean(notification.isAcknowledged)
        : notification.status === UserNotificationStatus.PassedOn;
    },
  );

  let latest: OnCallPageNotification | undefined = undefined;

  for (const notification of answeredFrom) {
    if (
      !latest ||
      getTime(notification.acknowledgedAt || notification.createdAt) >=
        getTime(latest.acknowledgedAt || latest.createdAt)
    ) {
      latest = notification;
    }
  }

  return getOnCallPageChannelsOf(latest);
}

/*
 * A notification of a page that the record's feed tells of after the
 * page's own entry (OnCallFeedText.getStepNotificationMarkdown).
 */
export enum OnCallPageNotificationEvent {
  /*
   * It went out after the page's own entry was written: a later rule of the
   * person's own On-Call Rules ("call me after 10 minutes").
   */
  SentLater = "SentLater",
  /*
   * It could not be sent: the provider refused it, the device's push token
   * is gone, the channel is not verified.
   */
  Failed = "Failed",
  /*
   * A call that rang and was not picked up: it rang out, or the line was
   * busy (UserNotificationStatus.NotAnswered).
   */
  NotAnswered = "NotAnswered",
}

// What the feed says of one such notification.
export interface OnCallPageNotificationNews {
  event: OnCallPageNotificationEvent;
  // The channels it is news by: the ones the feed has not told of yet.
  channels: Array<OnCallPageChannel>;
  /*
   * Sent later: another notification of the page reached the person before
   * it, so it pages them "again". Not so when it is the first one to: their
   * rules page later, or the first ones could not be sent.
   */
  isPagedBefore: boolean;
}

// Whether two notifications are the same one.
function isSameNotification(
  a: OnCallPageNotification,
  b: OnCallPageNotification,
): boolean {
  if (a === b) {
    return true;
  }

  const id: string = a.id?.toString() || "";

  return Boolean(id) && id === (b.id?.toString() || "");
}

/*
 * Whether a notification of a page came before another: the one written
 * first - or, written in the same instant, the one first by id, so of two
 * notifications each comes before the other in one way only.
 */
function isNotificationBefore(
  a: OnCallPageNotification,
  b: OnCallPageNotification,
): boolean {
  const timeA: number = getTime(a.createdAt);
  const timeB: number = getTime(b.createdAt);

  if (timeA !== timeB) {
    return timeA < timeB;
  }

  return (a.id?.toString() || "") < (b.id?.toString() || "");
}

/*
 * The status a notification before this one had when the feed told of it
 * the way it tells of this one: one that went out, for one sent later; one
 * that failed, for a failure; one not answered, for a call not answered.
 */
function isToldAs(
  event: OnCallPageNotificationEvent,
  status: UserNotificationStatus | string | null | undefined,
): boolean {
  switch (event) {
    case OnCallPageNotificationEvent.Failed:
      return status === UserNotificationStatus.Error;
    case OnCallPageNotificationEvent.NotAnswered:
      return status === UserNotificationStatus.NotAnswered;
    default:
      return isOnCallPageNotificationOut(status);
  }
}

/*
 * What a notification of a page adds to the record's feed after the page's
 * own entry - or null, when it adds nothing. Each channel is told of once a
 * page: a push the person repeats until they answer, or a second call by a
 * rule of their own, goes out by a channel the feed has named already, and
 * would bury the page under one line a minute. So is each failure: a push
 * token that is gone fails every repeat. And so is a call not answered: a
 * second call that rings out says no more than the first. A call not
 * answered is told of by its ringing channel only
 * (ON_CALL_PAGE_RINGING_CHANNELS). `notifications` are all of the page's,
 * this one among them or not.
 */
export function getOnCallPageNotificationNews(data: {
  event: OnCallPageNotificationEvent;
  notification: OnCallPageNotification;
  notifications: Array<OnCallPageNotification>;
}): OnCallPageNotificationNews | null {
  const isSentLater: boolean =
    data.event === OnCallPageNotificationEvent.SentLater;

  const before: Array<OnCallPageNotification> = data.notifications.filter(
    (other: OnCallPageNotification) => {
      return (
        !isSameNotification(other, data.notification) &&
        isNotificationBefore(other, data.notification)
      );
    },
  );

  // The channels the feed told of already, by the notifications before it.
  const toldChannels: Array<OnCallPageChannel> = [];

  for (const other of before) {
    if (isToldAs(data.event, other.status)) {
      toldChannels.push(...getOnCallPageChannelsOf(other));
    }
  }

  const channels: Array<OnCallPageChannel> = getOnCallPageChannelsOf(
    data.notification,
  ).filter((channel: OnCallPageChannel) => {
    if (
      data.event === OnCallPageNotificationEvent.NotAnswered &&
      !ON_CALL_PAGE_RINGING_CHANNELS.includes(channel)
    ) {
      return false;
    }

    return !toldChannels.includes(channel);
  });

  if (channels.length === 0) {
    return null;
  }

  return {
    event: data.event,
    channels: channels,
    isPagedBefore:
      isSentLater &&
      before.some((other: OnCallPageNotification) => {
        return isOnCallPageNotificationOut(other.status);
      }),
  };
}
