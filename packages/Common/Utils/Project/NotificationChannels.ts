import Permission from "../../Types/Permission";

/*
 * SMS, phone calls, WhatsApp and Telegram: the four notification channels a
 * project switches on and off, one Project column each.
 *
 * All four start off on a new project and stay off until someone turns them
 * on: on OneUptime Cloud every message is paid from the project's balance,
 * and a self-hosted install sends them only through a Twilio account or a
 * Telegram bot that somebody has set up.
 *
 * Only a project owner, or someone with Manage Billing, may turn one on or
 * off - the columns' own update permissions
 * (PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS, which a test holds to the
 * Project model). Not a project admin: Project Admin leaves out billing, and
 * a channel that costs money is billing.
 *
 * So everything that says a channel is off says who can turn it on, in these
 * words, and where the switch is: the server's refusals (adding a method,
 * sending a code again, an SMS subscriber, a status page's SMS
 * subscriptions), the log of a message that was not sent, on-call readiness
 * and team compliance. The owners - who may flip it - are told where it is,
 * with a link. The dashboard says the same in its own translated copy
 * (NotificationMethods/ProjectNotificationChannelsCopy), and shows the
 * switch itself, or a link to it, to the people who may flip it.
 */

// Named as the on-call readiness method types name them.
export enum ProjectNotificationChannel {
  SMS = "SMS",
  Call = "Call",
  WhatsApp = "WhatsApp",
  Telegram = "Telegram",
}

export type ProjectNotificationChannelColumn =
  | "enableSmsNotifications"
  | "enableCallNotifications"
  | "enableWhatsAppNotifications"
  | "enableTelegramNotifications";

export const PROJECT_NOTIFICATION_CHANNEL_COLUMNS: Readonly<
  Record<ProjectNotificationChannel, ProjectNotificationChannelColumn>
> = {
  [ProjectNotificationChannel.SMS]: "enableSmsNotifications",
  [ProjectNotificationChannel.Call]: "enableCallNotifications",
  [ProjectNotificationChannel.WhatsApp]: "enableWhatsAppNotifications",
  [ProjectNotificationChannel.Telegram]: "enableTelegramNotifications",
};

/*
 * Who may turn a channel on or off: the update permissions of each of the
 * four columns, in the order the model lists them.
 */
export const PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS: ReadonlyArray<Permission> =
  [Permission.ProjectOwner, Permission.ManageProjectBilling];

// The page that holds the switches (its Notification Channels card).
export const PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE: string =
  "Project Settings > Notification Settings";

// Where that page is in the dashboard, under a project's own route.
export const PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PATH: string =
  "settings/notification-settings";

// The people PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS let in.
const WHO_MAY_TURN_THEM_ON: string =
  "a project owner or someone with Manage Billing";

interface ChannelWords {
  // How a sentence starts with the channel: "SMS", "Phone calls".
  name: string;
  isPlural: boolean;
}

const CHANNEL_WORDS: Readonly<
  Record<ProjectNotificationChannel, ChannelWords>
> = {
  [ProjectNotificationChannel.SMS]: { name: "SMS", isPlural: false },
  [ProjectNotificationChannel.Call]: { name: "Phone calls", isPlural: true },
  [ProjectNotificationChannel.WhatsApp]: {
    name: "WhatsApp",
    isPlural: false,
  },
  [ProjectNotificationChannel.Telegram]: {
    name: "Telegram",
    isPlural: false,
  },
};

export type ChannelPronoun = "it" | "them";

/*
 * Who can turn it on, and where, as the end of a sentence about a channel
 * that is off ("it") or several ("them"): "a project owner or someone with
 * Manage Billing can turn it on in Project Settings > Notification
 * Settings".
 */
export const getWhoCanTurnOnClause: (pronoun: ChannelPronoun) => string = (
  pronoun: ChannelPronoun,
): string => {
  return `${WHO_MAY_TURN_THEM_ON} can turn ${pronoun} on in ${PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE}`;
};

/*
 * The same, as the sentence after one that says a channel is off: "A
 * project owner or someone with Manage Billing can turn it on in Project
 * Settings > Notification Settings."
 */
export const getWhoCanTurnOnSentence: (pronoun: ChannelPronoun) => string = (
  pronoun: ChannelPronoun,
): string => {
  const clause: string = getWhoCanTurnOnClause(pronoun);

  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`;
};

const getPronoun: (channel: ProjectNotificationChannel) => ChannelPronoun = (
  channel: ProjectNotificationChannel,
): ChannelPronoun => {
  return CHANNEL_WORDS[channel].isPlural ? "them" : "it";
};

/*
 * What the server says when something needs a channel the project has off:
 * "SMS is off in this project. A project owner or someone with Manage
 * Billing can turn it on in Project Settings > Notification Settings." Said
 * to whoever asked - someone who may turn it on, or not - so it names who
 * can rather than telling the reader to.
 */
export const getProjectNotificationChannelOffMessage: (
  channel: ProjectNotificationChannel,
) => string = (channel: ProjectNotificationChannel): string => {
  const words: ChannelWords = CHANNEL_WORDS[channel];

  return `${words.name} ${words.isPlural ? "are" : "is"} off in this project. ${getWhoCanTurnOnSentence(getPronoun(channel))}`;
};

/*
 * Numbers for incoming calls are verified by text, so adding one - or
 * sending its code again - needs SMS on.
 */
export const INCOMING_CALL_NUMBER_SMS_OFF_MESSAGE: string = `Numbers for incoming calls are verified by SMS, which is off in this project. ${getWhoCanTurnOnSentence("it")}`;

/*
 * A status page's SMS Subscriptions switch can only be turned on while the
 * project has SMS on.
 */
export const STATUS_PAGE_SMS_SUBSCRIPTIONS_SMS_OFF_MESSAGE: string = `Visitors can't subscribe by SMS while SMS is off in this project. ${getWhoCanTurnOnSentence("it")}`;

/*
 * For the project's owners, about a message that was not sent because its
 * channel is off. They may turn it on, so it tells them to, and where (the
 * email adds the link to that page): "SMS is off in this project. If it
 * should be on, turn it on in Project Settings > Notification Settings."
 */
export const getProjectNotificationChannelOffOwnerSentence: (
  channel: ProjectNotificationChannel,
) => string = (channel: ProjectNotificationChannel): string => {
  const words: ChannelWords = CHANNEL_WORDS[channel];
  const pronoun: ChannelPronoun = getPronoun(channel);

  return `${words.name} ${words.isPlural ? "are" : "is"} off in this project. If ${words.isPlural ? "they" : "it"} should be on, turn ${pronoun} on in ${PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE}.`;
};
