import Markdown from "../../Types/Markdown";
import OneUptimeDate from "../../../Types/Date";
import {
  StatusPageSubscriberContact,
  StatusPageSubscriberUnsubscribeChannel,
} from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";

/*
 * The email a status page's team gets when a subscriber the team added
 * unsubscribes itself.
 *
 * Anyone who can read a mailbox can unsubscribe it. For an address somebody
 * signed up themselves that is the point; for one the team added - a site's
 * mailing list, say site03-all@ - it means one reader can take a whole site
 * off the page before the next outage, and nobody would notice until then. So
 * when a subscriber the team added (StatusPageSubscriber.isAddedByTeam: from
 * the dashboard, with an API key or by a workflow, never a sign-up on the
 * status page) unsubscribes through its link or the manage page, the page's
 * owners and the teammate who added it, if a teammate did, are told
 * (StatusPageSubscriberService.notifyTeamOfUnsubscribe). Without a teammate -
 * an API key or a workflow added it - the email says someone on the team did.
 *
 * Kept free of database access so what the email says can be pinned by a
 * test. It is sent through the SimpleMessage template, whose `message` is
 * inserted as HTML, so every value from a subscriber or a teammate is escaped
 * here.
 */

// How the subscription was cancelled, which the email names.
export enum StatusPageSubscriberUnsubscribeSource {
  // The link at the bottom of a notification (the status page's unsubscribe page).
  UnsubscribeLink = "UnsubscribeLink",
  // The Update Subscription page, where a subscriber can also change preferences.
  ManageSubscriptionPage = "ManageSubscriptionPage",
}

export interface StatusPageSubscriberUnsubscribeNoticeInput {
  statusPageName: string;
  contact: StatusPageSubscriberContact;
  source: StatusPageSubscriberUnsubscribeSource;
  unsubscribedAt: Date;
  /*
   * The teammate who added the subscriber, when a teammate did and they are
   * still known (an API key or a workflow has no name to give).
   */
  addedByName?: string | undefined;
  addedAt?: Date | undefined;
  // The status page's list of subscribers on this channel, in the dashboard.
  subscriberListUrl: string;
}

export interface StatusPageSubscriberUnsubscribeNoticeEmail {
  subject: string;
  // HTML for SimpleMessage's `message`; every interpolated value is escaped.
  message: string;
}

const SUBSCRIBER_LIST_ROUTES: Record<
  StatusPageSubscriberUnsubscribeChannel,
  string
> = {
  [StatusPageSubscriberUnsubscribeChannel.Email]: "email-subscribers",
  [StatusPageSubscriberUnsubscribeChannel.SMS]: "sms-subscribers",
  [StatusPageSubscriberUnsubscribeChannel.Slack]: "slack-subscribers",
  [StatusPageSubscriberUnsubscribeChannel.MicrosoftTeams]:
    "microsoft-teams-subscribers",
  [StatusPageSubscriberUnsubscribeChannel.Webhook]: "webhook-subscribers",
};

const CHANNEL_NAMES: Record<StatusPageSubscriberUnsubscribeChannel, string> = {
  [StatusPageSubscriberUnsubscribeChannel.Email]: "email subscriber",
  [StatusPageSubscriberUnsubscribeChannel.SMS]: "SMS subscriber",
  [StatusPageSubscriberUnsubscribeChannel.Slack]: "Slack subscriber",
  [StatusPageSubscriberUnsubscribeChannel.MicrosoftTeams]:
    "Microsoft Teams subscriber",
  [StatusPageSubscriberUnsubscribeChannel.Webhook]: "webhook subscriber",
};

export default class StatusPageSubscriberUnsubscribeNotice {
  /*
   * The dashboard route, under the status page, of the list a channel's
   * subscribers are on (Dashboard RouteMap, STATUS_PAGE_VIEW_*_SUBSCRIBERS).
   */
  public static getSubscriberListRoute(
    channel: StatusPageSubscriberUnsubscribeChannel,
  ): string {
    return SUBSCRIBER_LIST_ROUTES[channel];
  }

  public static build(
    input: StatusPageSubscriberUnsubscribeNoticeInput,
  ): StatusPageSubscriberUnsubscribeNoticeEmail {
    const escape: (text: string) => string = Markdown.escapeHtml;

    const channelName: string = CHANNEL_NAMES[input.contact.channel];
    const contact: string = input.contact.contact.trim();

    const who: string = contact
      ? `The ${channelName} <strong>${escape(contact)}</strong>`
      : `A ${channelName}`;

    const how: string =
      input.source === StatusPageSubscriberUnsubscribeSource.UnsubscribeLink
        ? "using the unsubscribe link in a notification"
        : "on the status page's Update Subscription page";

    const addedBy: string = input.addedByName?.trim()
      ? escape(input.addedByName.trim())
      : "Someone on your team";

    const addedOn: string = input.addedAt
      ? ` on ${escape(StatusPageSubscriberUnsubscribeNotice.formatDate(input.addedAt))}`
      : "";

    const statusPageName: string = escape(input.statusPageName);
    const subscriberListUrl: string = escape(input.subscriberListUrl);

    const message: string = [
      `<p>${who} unsubscribed from the status page <strong>${statusPageName}</strong> ${how}, at ${escape(
        StatusPageSubscriberUnsubscribeNotice.formatDate(input.unsubscribedAt),
      )}. It will not receive this page's notifications any more.</p>`,
      `<p>${addedBy} added this subscriber${addedOn}. Anyone who reads a shared address, such as a mailing list, can unsubscribe it for everyone who reads it. If that is what happened, add it back or add the people who still need these notifications.</p>`,
      `<p>You are receiving this because you own this status page or added this subscriber. <a href="${subscriberListUrl}">View the status page's subscribers</a>.</p>`,
    ].join("");

    return {
      subject: `A subscriber your team added unsubscribed from ${input.statusPageName}`,
      message: message,
    };
  }

  private static formatDate(date: Date): string {
    return OneUptimeDate.getDateAsFormattedStringInTimezone({
      date: date,
      timezone: "UTC",
      use12HourFormat: false,
    });
  }
}
