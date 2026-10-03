import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How visitors subscribe to a status page: the Subscribe page, and the five
 * channels it offers (email, SMS, Slack, Microsoft Teams and webhook). Each
 * is one boolean column on the status page and has one switch in the
 * dashboard, in the Channels card on Subscribers -> Subscriber Settings.
 *
 * It used to be spread out. The five channel switches were five one-switch
 * cards on Subscriber Settings and again a three-step 'Subscriber Settings'
 * card on Advanced Settings, which was also the only home of Show Subscriber
 * Page. Four of the five channels start off, so on every new status page
 * four of the five subscriber lists opened with a red "not enabled" banner
 * pointing somewhere else. A channel's list now carries the channel's own
 * switch instead, in a neutral panel, while the channel is off.
 *
 * What the switches do, so that the copy says it right: they decide which
 * ways visitors can sign themselves up on the status page - StatusPageAPI
 * refuses a sign-up for a channel that is off, and the Subscribe link only
 * shows with Show Subscriber Page on. They do not stop notifications:
 * subscribers the team adds (on the dashboard, with the API or by a
 * workflow) get updates whatever the switches say.
 *
 * Kept free of React so the components and App/Tests read these exact
 * strings. Every string is a whole sentence or a whole name, wrapped in
 * translationKey() so npm run i18n:extract finds it, and translated in all
 * seventeen Dashboard locale files (App/Tests/Dashboard/SubscriberChannels
 * checks).
 */

export type SubscriberChannelColumn =
  | "enableEmailSubscribers"
  | "enableSmsSubscribers"
  | "enableSlackSubscribers"
  | "enableMicrosoftTeamsSubscribers"
  | "enableWebhookSubscribers";

// The columns the Channels card switches: the five channels and the page.
export type SubscriptionSwitchColumn =
  | SubscriberChannelColumn
  | "showSubscriberPageOnStatusPage";

export interface SubscriberChannelDefinition {
  method: StatusPageSubscriberNotificationMethod;
  column: SubscriberChannelColumn;
  // The channel's row in the Channels card: its name...
  title: string;
  // ...and what subscribing this way gets a visitor.
  description: string;
  /*
   * The switch at the top of the channel's own subscriber list, shown while
   * the channel is off (SubscriberChannelOffPanel). Its name stays the same
   * whichever way it is set; the sentence under it says which way that is.
   */
  listSwitchTitle: string;
  listSwitchOffDescription: string;
  listSwitchOnDescription: string;
}

export const SubscriberChannelsCopy: {
  cardTitle: string;
  cardDescription: string;
  subscribePageTitle: string;
  subscribePageDescription: string;
  /*
   * After the SMS sentences wherever one OneUptime bills for texts (the
   * channel's switch makes paid SMS one press away). A page with its own
   * Twilio Config sends through that account instead.
   */
  smsBalanceSentence: string;
} = {
  cardTitle: translationKey("Channels"),
  cardDescription: translationKey(
    "How visitors can subscribe to this status page. Subscribers your team adds are not affected.",
  ),
  subscribePageTitle: translationKey("Show Subscriber Page"),
  subscribePageDescription: translationKey(
    "Puts a Subscribe link on the status page, where visitors sign up by the channels below.",
  ),
  smsBalanceSentence: translationKey(
    "Each text is paid from the project's SMS and call balance, unless this page has its own Twilio Config.",
  ),
};

/*
 * In the order the side menu lists the subscriber pages, which is the order
 * the Subscribe page on the status page offers them.
 */
export const SUBSCRIBER_CHANNELS: ReadonlyArray<SubscriberChannelDefinition> =
  [
    {
      method: StatusPageSubscriberNotificationMethod.Email,
      column: "enableEmailSubscribers",
      title: translationKey("Email"),
      description: translationKey(
        "Visitors confirm their address from a link we send them, then get updates by email.",
      ),
      listSwitchTitle: translationKey("Email Subscriptions"),
      listSwitchOffDescription: translationKey(
        "Off for this status page: visitors can't subscribe by email. Subscribers your team adds here still get updates.",
      ),
      listSwitchOnDescription: translationKey(
        "On: visitors can subscribe by email on the status page.",
      ),
    },
    {
      method: StatusPageSubscriberNotificationMethod.SMS,
      column: "enableSmsSubscribers",
      title: translationKey("SMS"),
      description: translationKey("Visitors get updates by text message."),
      listSwitchTitle: translationKey("SMS Subscriptions"),
      listSwitchOffDescription: translationKey(
        "Off for this status page: visitors can't subscribe by SMS. Subscribers your team adds here still get updates.",
      ),
      listSwitchOnDescription: translationKey(
        "On: visitors can subscribe by SMS on the status page.",
      ),
    },
    {
      method: StatusPageSubscriberNotificationMethod.Slack,
      column: "enableSlackSubscribers",
      title: translationKey("Slack"),
      description: translationKey(
        "Visitors get updates in a Slack channel, through its incoming webhook.",
      ),
      listSwitchTitle: translationKey("Slack Subscriptions"),
      listSwitchOffDescription: translationKey(
        "Off for this status page: visitors can't subscribe with Slack. Subscribers your team adds here still get updates.",
      ),
      listSwitchOnDescription: translationKey(
        "On: visitors can subscribe with Slack on the status page.",
      ),
    },
    {
      method: StatusPageSubscriberNotificationMethod.MicrosoftTeams,
      column: "enableMicrosoftTeamsSubscribers",
      title: translationKey("Microsoft Teams"),
      description: translationKey(
        "Visitors get updates in a Microsoft Teams channel, through its incoming webhook.",
      ),
      listSwitchTitle: translationKey("Microsoft Teams Subscriptions"),
      listSwitchOffDescription: translationKey(
        "Off for this status page: visitors can't subscribe with Microsoft Teams. Subscribers your team adds here still get updates.",
      ),
      listSwitchOnDescription: translationKey(
        "On: visitors can subscribe with Microsoft Teams on the status page.",
      ),
    },
    {
      method: StatusPageSubscriberNotificationMethod.Webhook,
      column: "enableWebhookSubscribers",
      title: translationKey("Webhook"),
      description: translationKey(
        "Visitors get a JSON POST request at their own URL on every status page event.",
      ),
      listSwitchTitle: translationKey("Webhook Subscriptions"),
      listSwitchOffDescription: translationKey(
        "Off for this status page: visitors can't subscribe with a webhook. Subscribers your team adds here still get updates.",
      ),
      listSwitchOnDescription: translationKey(
        "On: visitors can subscribe with a webhook on the status page.",
      ),
    },
  ];

// Every column the Channels card writes, the Subscribe page first.
export const SUBSCRIPTION_SWITCH_COLUMNS: ReadonlyArray<SubscriptionSwitchColumn> =
  [
    "showSubscriberPageOnStatusPage",
    ...SUBSCRIBER_CHANNELS.map(
      (channel: SubscriberChannelDefinition): SubscriberChannelColumn => {
        return channel.column;
      },
    ),
  ];

/*
 * The sentence after a channel's description, wherever its switch is: for
 * SMS where OneUptime bills for texts, what they cost. Nothing otherwise.
 */
export const getSubscriberChannelNote: (
  method: StatusPageSubscriberNotificationMethod,
  options: { isBillingEnabled: boolean },
) => string | undefined = (
  method: StatusPageSubscriberNotificationMethod,
  options: { isBillingEnabled: boolean },
): string | undefined => {
  if (
    method === StatusPageSubscriberNotificationMethod.SMS &&
    options.isBillingEnabled
  ) {
    return SubscriberChannelsCopy.smsBalanceSentence;
  }

  return undefined;
};

export const getSubscriberChannel: (
  method: StatusPageSubscriberNotificationMethod,
) => SubscriberChannelDefinition = (
  method: StatusPageSubscriberNotificationMethod,
): SubscriberChannelDefinition => {
  const channel: SubscriberChannelDefinition | undefined =
    SUBSCRIBER_CHANNELS.find(
      (candidate: SubscriberChannelDefinition): boolean => {
        return candidate.method === method;
      },
    );

  if (!channel) {
    throw new Error(`Status pages have no ${method} subscriber channel.`);
  }

  return channel;
};

export default SubscriberChannelsCopy;
