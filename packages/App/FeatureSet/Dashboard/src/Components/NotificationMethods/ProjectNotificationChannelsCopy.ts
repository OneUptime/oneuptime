import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ProjectNotificationChannel,
  ProjectNotificationChannelColumn,
} from "Common/Utils/Project/NotificationChannels";

export { ProjectNotificationChannel };
export type { ProjectNotificationChannelColumn };

/*
 * The four notification channels a project switches on and off: SMS, phone
 * calls, WhatsApp and Telegram. Each is one boolean column on the Project
 * (enableSmsNotifications, ...), every one of them off on a new project.
 *
 * Only a project owner, or someone with Manage Billing, may change them -
 * the columns' own update permissions - and not a project admin: a channel
 * that costs money is billing (Common/Utils/Project/NotificationChannels,
 * which also words what the server says). So wherever a channel is off:
 * - someone who may turn it on gets the switch itself, or a link straight
 *   to it (the Notification Channels card);
 * - everyone else is told exactly who can, and where - never to "ask an
 *   admin", who could not. Each such sentence is one whole key, so a
 *   language can give "it" the gender of the channel it stands for.
 *
 * What a switch that is off does, so the copy says it right:
 * - Nobody in the project can add a method on that channel. UserSmsService,
 *   UserCallService, UserWhatsAppService and UserTelegramService refuse the
 *   new row ("SMS is off in this project. A project owner or someone
 *   with Manage Billing can turn it on in ..."), and
 *   UserIncomingCallNumberService refuses incoming call numbers while SMS is
 *   off, because they are verified by text.
 * - Resending a verification code is refused too, for SMS, calls and
 *   incoming call numbers (not for WhatsApp or Telegram).
 * - Email, push, Slack, Microsoft Teams and webhooks have no switch.
 *
 * Every place that shows these switches or depends on them reads this file:
 * the Notification Channels card on Project Settings -> Notification
 * Settings, the panel at the top of each of a person's method lists while
 * its channel is off, the channels an admin may add for someone else, and
 * the setup checklist's "is any of your channels usable" step. Kept free of
 * React, so App/Tests can read these exact strings. Every string is a whole
 * sentence or a whole name, wrapped in translationKey() so
 * npm run i18n:extract finds it.
 */

export interface ProjectNotificationChannelDefinition {
  channel: ProjectNotificationChannel;
  column: ProjectNotificationChannelColumn;
  /*
   * The channel's name: its row on the Notification Channels card, and the
   * switch at the top of a method list while it is off.
   */
  title: string;
  // What the channel sends, on the Notification Channels card.
  description: string;
  /*
   * Where OneUptime bills for messages: what this channel costs. Said
   * wherever its switch is, so that turning it on is never a surprise on
   * the bill.
   */
  balanceNote: string;
  /*
   * Whether resending a verification code is refused while the channel is
   * off. The services for SMS and calls check the switch before they send a
   * code again; WhatsApp and Telegram do not.
   */
  isCodeResendRefusedWhileOff: boolean;
}

export const ProjectNotificationChannelsCopy: {
  cardTitle: string;
  cardDescription: string;
  // On the card, for someone whose switches are locked.
  whoCanChange: string;
  /*
   * The page with the switches, as the text of a link to it - for people
   * who may turn them on.
   */
  settingsLinkText: string;
} = {
  cardTitle: translationKey("Notification Channels"),
  cardDescription: translationKey(
    "Each of these has to be on before anyone in this project can add it as a notification method.",
  ),
  whoCanChange: translationKey(
    "A project owner or someone with Manage Billing can change these.",
  ),
  settingsLinkText: translationKey("Project Settings → Notification Settings"),
};

/*
 * SMS and calls go through the project's own Twilio account, and are not
 * paid from the balance, only when one of its Twilio configs is the project
 * default (ProjectCallSMSConfigService.getProjectDefaultTwilioConfig). A
 * project's first config becomes the default; a config that is not the
 * default sends nothing to the project's members.
 */
const TWILIO_BALANCE_NOTE: string = translationKey(
  "Paid from the project's balance, unless the project has a default Twilio Config.",
);

const BALANCE_NOTE: string = translationKey("Paid from the project's balance.");

// In the order a person's Direct Contact tab lists them.
export const PROJECT_NOTIFICATION_CHANNELS: ReadonlyArray<ProjectNotificationChannelDefinition> =
  [
    {
      channel: ProjectNotificationChannel.SMS,
      column: "enableSmsNotifications",
      title: translationKey("SMS"),
      description: translationKey(
        "Text messages to the phone numbers people add. Numbers for incoming calls are verified by SMS too.",
      ),
      balanceNote: TWILIO_BALANCE_NOTE,
      isCodeResendRefusedWhileOff: true,
    },
    {
      channel: ProjectNotificationChannel.Call,
      column: "enableCallNotifications",
      title: translationKey("Phone Calls"),
      description: translationKey(
        "Voice calls to the phone numbers people add.",
      ),
      balanceNote: TWILIO_BALANCE_NOTE,
      isCodeResendRefusedWhileOff: true,
    },
    {
      channel: ProjectNotificationChannel.WhatsApp,
      column: "enableWhatsAppNotifications",
      title: translationKey("WhatsApp"),
      description: translationKey(
        "Messages to the WhatsApp numbers people add.",
      ),
      balanceNote: BALANCE_NOTE,
      isCodeResendRefusedWhileOff: false,
    },
    {
      channel: ProjectNotificationChannel.Telegram,
      column: "enableTelegramNotifications",
      title: translationKey("Telegram"),
      description: translationKey(
        "Messages from the OneUptime bot to the Telegram accounts people link.",
      ),
      balanceNote: BALANCE_NOTE,
      isCodeResendRefusedWhileOff: false,
    },
  ];

export const PROJECT_NOTIFICATION_CHANNEL_COLUMNS: ReadonlyArray<ProjectNotificationChannelColumn> =
  PROJECT_NOTIFICATION_CHANNELS.map(
    (
      definition: ProjectNotificationChannelDefinition,
    ): ProjectNotificationChannelColumn => {
      return definition.column;
    },
  );

export const getProjectNotificationChannel: (
  channel: ProjectNotificationChannel,
) => ProjectNotificationChannelDefinition = (
  channel: ProjectNotificationChannel,
): ProjectNotificationChannelDefinition => {
  const definition: ProjectNotificationChannelDefinition | undefined =
    PROJECT_NOTIFICATION_CHANNELS.find(
      (candidate: ProjectNotificationChannelDefinition): boolean => {
        return candidate.channel === channel;
      },
    );

  if (!definition) {
    throw new Error(`Projects have no ${channel} notification switch.`);
  }

  return definition;
};

// The channel a Project column switches, or undefined for any other column.
export const getProjectNotificationChannelForColumn: (
  column: string,
) => ProjectNotificationChannelDefinition | undefined = (
  column: string,
): ProjectNotificationChannelDefinition | undefined => {
  return PROJECT_NOTIFICATION_CHANNELS.find(
    (candidate: ProjectNotificationChannelDefinition): boolean => {
      return candidate.column === column;
    },
  );
};

/*
 * Whether each channel is on, for a project. Kept as a record over every
 * channel, so a channel can never be missing from an answer.
 */
export type EnabledProjectChannels = Record<
  ProjectNotificationChannel,
  boolean
>;

/*
 * Whether each channel is on, read from a project row. A column the row does
 * not carry reads as its default, which is off for all four (the model's
 * defaultValue): the same answer the server gives a project that never set
 * it.
 */
export const readEnabledProjectChannels: (
  project: Partial<Record<ProjectNotificationChannelColumn, unknown>>,
) => EnabledProjectChannels = (
  project: Partial<Record<ProjectNotificationChannelColumn, unknown>>,
): EnabledProjectChannels => {
  const enabled: EnabledProjectChannels = {
    [ProjectNotificationChannel.SMS]: false,
    [ProjectNotificationChannel.Call]: false,
    [ProjectNotificationChannel.WhatsApp]: false,
    [ProjectNotificationChannel.Telegram]: false,
  };

  for (const definition of PROJECT_NOTIFICATION_CHANNELS) {
    enabled[definition.channel] = project[definition.column] === true;
  }

  return enabled;
};

// The channels that are off, in PROJECT_NOTIFICATION_CHANNELS order.
export const getDisabledProjectChannels: (
  enabled: EnabledProjectChannels,
) => Array<ProjectNotificationChannel> = (
  enabled: EnabledProjectChannels,
): Array<ProjectNotificationChannel> => {
  return PROJECT_NOTIFICATION_CHANNELS.filter(
    (definition: ProjectNotificationChannelDefinition): boolean => {
      return !enabled[definition.channel];
    },
  ).map(
    (
      definition: ProjectNotificationChannelDefinition,
    ): ProjectNotificationChannel => {
      return definition.channel;
    },
  );
};

/*
 * A person's own list of methods on one channel (User Settings ->
 * Notification Methods, and Incoming Call Policy -> Phone Numbers), and what
 * it says while the project has that channel off.
 *
 * Its Add button is gone then: the server refuses the row. In its place, at
 * the top of the list, people who may change the switch get the switch
 * itself; everyone else is told what is off, and who can turn it on.
 */
export enum ChannelGatedMethodList {
  SMS = "SMS",
  Call = "Call",
  WhatsApp = "WhatsApp",
  Telegram = "Telegram",
  IncomingCallNumber = "IncomingCallNumber",
}

export interface ChannelGatedMethodListDefinition {
  list: ChannelGatedMethodList;
  // The project switch that has to be on before the list can grow.
  channel: ProjectNotificationChannel;
  // Under the switch while it is off, and once it is on.
  switchOffDescription: string;
  switchOnDescription: string;
  /*
   * For someone who may not change the switch: what is off, and exactly
   * who can turn it on, and where.
   */
  offSentence: string;
  /*
   * The empty list's heading while the channel is off. The list's usual
   * one asks the reader to add one, which they cannot.
   */
  noItemsWhileOff: string;
}

const NO_PHONE_NUMBERS_YET: string = translationKey("No phone numbers yet.");

export const CHANNEL_GATED_METHOD_LISTS: ReadonlyArray<ChannelGatedMethodListDefinition> =
  [
    {
      list: ChannelGatedMethodList.SMS,
      channel: ProjectNotificationChannel.SMS,
      switchOffDescription: translationKey(
        "Off for this project: no one can add a phone number for SMS.",
      ),
      switchOnDescription: translationKey(
        "On for this project: everyone can add a phone number for SMS.",
      ),
      offSentence: translationKey(
        "SMS is off in this project. A project owner or someone with Manage Billing can turn it on in Project Settings → Notification Settings.",
      ),
      noItemsWhileOff: NO_PHONE_NUMBERS_YET,
    },
    {
      list: ChannelGatedMethodList.Call,
      channel: ProjectNotificationChannel.Call,
      switchOffDescription: translationKey(
        "Off for this project: no one can add a phone number for calls.",
      ),
      switchOnDescription: translationKey(
        "On for this project: everyone can add a phone number for calls.",
      ),
      offSentence: translationKey(
        "Phone calls are off in this project. A project owner or someone with Manage Billing can turn them on in Project Settings → Notification Settings.",
      ),
      noItemsWhileOff: NO_PHONE_NUMBERS_YET,
    },
    {
      list: ChannelGatedMethodList.WhatsApp,
      channel: ProjectNotificationChannel.WhatsApp,
      switchOffDescription: translationKey(
        "Off for this project: no one can add a WhatsApp number.",
      ),
      switchOnDescription: translationKey(
        "On for this project: everyone can add a WhatsApp number.",
      ),
      offSentence: translationKey(
        "WhatsApp is off in this project. A project owner or someone with Manage Billing can turn it on in Project Settings → Notification Settings.",
      ),
      noItemsWhileOff: translationKey("No WhatsApp numbers yet."),
    },
    {
      list: ChannelGatedMethodList.Telegram,
      channel: ProjectNotificationChannel.Telegram,
      switchOffDescription: translationKey(
        "Off for this project: no one can link a Telegram account.",
      ),
      switchOnDescription: translationKey(
        "On for this project: everyone can link a Telegram account.",
      ),
      offSentence: translationKey(
        "Telegram is off in this project. A project owner or someone with Manage Billing can turn it on in Project Settings → Notification Settings.",
      ),
      noItemsWhileOff: translationKey("No Telegram accounts linked yet."),
    },
    {
      list: ChannelGatedMethodList.IncomingCallNumber,
      channel: ProjectNotificationChannel.SMS,
      switchOffDescription: translationKey(
        "Off for this project: numbers for incoming calls are verified by SMS, so none can be added.",
      ),
      switchOnDescription: translationKey(
        "On for this project: numbers for incoming calls can be added and verified by SMS.",
      ),
      offSentence: translationKey(
        "Numbers for incoming calls are verified by SMS, which is off in this project. A project owner or someone with Manage Billing can turn it on in Project Settings → Notification Settings.",
      ),
      noItemsWhileOff: NO_PHONE_NUMBERS_YET,
    },
  ];

export const getChannelGatedMethodList: (
  list: ChannelGatedMethodList,
) => ChannelGatedMethodListDefinition = (
  list: ChannelGatedMethodList,
): ChannelGatedMethodListDefinition => {
  const definition: ChannelGatedMethodListDefinition | undefined =
    CHANNEL_GATED_METHOD_LISTS.find(
      (candidate: ChannelGatedMethodListDefinition): boolean => {
        return candidate.list === list;
      },
    );

  if (!definition) {
    throw new Error(`No method list is gated as ${list}.`);
  }

  return definition;
};

export default ProjectNotificationChannelsCopy;
