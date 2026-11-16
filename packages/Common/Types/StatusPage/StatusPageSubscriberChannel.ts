import Dictionary from "../Dictionary";
import { StatusPageSubscriberUnsubscribeChannel } from "./StatusPageSubscriberUnsubscribe";

/*
 * The channels a status page's subscribers are reached on, as the
 * dashboard's one Subscribers page names its tabs in the address
 * (`…/status-pages/:id/subscribers?channel=sms`).
 *
 * Each channel was a page of its own until #9125 - Email Subscribers, SMS
 * Subscribers, Slack Subscribers, Microsoft Teams Subscribers and Webhook
 * Subscribers, five menu entries for one kind of record - and those
 * addresses are still in bookmarks, wikis and the emails the server sent.
 * They are named here, once, and the dashboard forwards each to its tab
 * (MOVED_SUBSCRIBER_LIST_PATHS). Anything that links to a channel's list,
 * the server's emails included, builds the address from this vocabulary.
 *
 * React-free and database-free, so the server, the dashboard and a test can
 * all read it.
 */
enum StatusPageSubscriberChannel {
  Email = "email",
  SMS = "sms",
  Slack = "slack",
  MicrosoftTeams = "microsoft-teams",
  Webhook = "webhook",
}

// In tab order. The first is the tab a bare address opens.
export const STATUS_PAGE_SUBSCRIBER_CHANNELS: ReadonlyArray<StatusPageSubscriberChannel> =
  [
    StatusPageSubscriberChannel.Email,
    StatusPageSubscriberChannel.SMS,
    StatusPageSubscriberChannel.Slack,
    StatusPageSubscriberChannel.MicrosoftTeams,
    StatusPageSubscriberChannel.Webhook,
  ];

export const DEFAULT_STATUS_PAGE_SUBSCRIBER_CHANNEL: StatusPageSubscriberChannel =
  StatusPageSubscriberChannel.Email;

// The query parameter that names the open tab.
export const STATUS_PAGE_SUBSCRIBER_CHANNEL_QUERY_PARAM: string = "channel";

// The Subscribers page, under a status page's own address.
export const STATUS_PAGE_SUBSCRIBERS_PAGE_PATH: string = "subscribers";

/*
 * Where each channel's list used to be, under a status page's own address,
 * and the tab it is now.
 */
export const MOVED_SUBSCRIBER_LIST_PATHS: Readonly<
  Record<string, StatusPageSubscriberChannel>
> = {
  "email-subscribers": StatusPageSubscriberChannel.Email,
  "sms-subscribers": StatusPageSubscriberChannel.SMS,
  "slack-subscribers": StatusPageSubscriberChannel.Slack,
  "microsoft-teams-subscribers": StatusPageSubscriberChannel.MicrosoftTeams,
  "webhook-subscribers": StatusPageSubscriberChannel.Webhook,
};

// The channel a value names, or null when it names none.
export const readStatusPageSubscriberChannel: (
  value: string | null | undefined,
) => StatusPageSubscriberChannel | null = (
  value: string | null | undefined,
): StatusPageSubscriberChannel | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized: string = value.trim().toLowerCase();

  for (const channel of STATUS_PAGE_SUBSCRIBER_CHANNELS) {
    if (channel === normalized) {
      return channel;
    }
  }

  return null;
};

/*
 * The query that opens the Subscribers page on a channel's tab:
 * { channel: "sms" }, and nothing for the first tab, whose address is the
 * bare one - the address the page itself shows once that tab is open.
 */
export const getStatusPageSubscriberChannelQuery: (
  channel: StatusPageSubscriberChannel,
) => Dictionary<string> = (
  channel: StatusPageSubscriberChannel,
): Dictionary<string> => {
  if (channel === DEFAULT_STATUS_PAGE_SUBSCRIBER_CHANNEL) {
    return {};
  }

  return { [STATUS_PAGE_SUBSCRIBER_CHANNEL_QUERY_PARAM]: channel };
};

const CHANNEL_BY_UNSUBSCRIBE_CHANNEL: Readonly<
  Record<StatusPageSubscriberUnsubscribeChannel, StatusPageSubscriberChannel>
> = {
  [StatusPageSubscriberUnsubscribeChannel.Email]:
    StatusPageSubscriberChannel.Email,
  [StatusPageSubscriberUnsubscribeChannel.SMS]: StatusPageSubscriberChannel.SMS,
  [StatusPageSubscriberUnsubscribeChannel.Slack]:
    StatusPageSubscriberChannel.Slack,
  [StatusPageSubscriberUnsubscribeChannel.MicrosoftTeams]:
    StatusPageSubscriberChannel.MicrosoftTeams,
  [StatusPageSubscriberUnsubscribeChannel.Webhook]:
    StatusPageSubscriberChannel.Webhook,
};

// The tab a subscriber's channel is on, as the server's emails name it.
export const getStatusPageSubscriberChannelForUnsubscribeChannel: (
  channel: StatusPageSubscriberUnsubscribeChannel,
) => StatusPageSubscriberChannel = (
  channel: StatusPageSubscriberUnsubscribeChannel,
): StatusPageSubscriberChannel => {
  return CHANNEL_BY_UNSUBSCRIBE_CHANNEL[channel];
};

export default StatusPageSubscriberChannel;
