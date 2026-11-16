import { PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE } from "./NotificationChannels";
import TwilioConfigUses from "../../Types/CallAndSMS/TwilioConfigUse";

/*
 * The Twilio account SMS and phone calls go through.
 *
 * SMS and calls to the people in a project - on-call alerts, notifications, and
 * the codes that verify their phone numbers - go through the project's default
 * Twilio config (Project Settings > Notifications > Notification Channels), and
 * through the Twilio account of the OneUptime server itself when the project
 * has none (Admin Dashboard > Settings > Call and SMS). OneUptime Cloud always
 * has the second. A self-hosted server has neither until somebody sets one up,
 * and until then no SMS or call can go anywhere.
 *
 * That used to be found out the hard way: the Notification service logged
 * "Twilio Config not found", the verification code was sent fire-and-forget,
 * and the dialog the person was looking at said "We have sent a SMS with your
 * verification code" regardless. So everything that runs into it - the log
 * of the message that was not sent, a verification code that could not be
 * sent, the dialog that offers to send one - says what is missing, who can
 * add it, and where, in these words.
 *
 * Who can add one: the OneUptime server's administrator (the master admin,
 * who alone opens the Admin Dashboard), and for one project, whoever may
 * create its Twilio configs - ProjectCallSMSConfig's create permissions,
 * which a test holds to these words.
 *
 * Kept free of server and React code, so the server, the dashboard and the
 * tests read the same words.
 */

// Where the OneUptime server's own Twilio account is set.
export const SERVER_TWILIO_SETTINGS_PAGE: string =
  "Admin Dashboard > Settings > Call and SMS";

// Where a project's own Twilio account is added (its Twilio Config card).
export const PROJECT_TWILIO_SETTINGS_PAGE: string =
  PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE;

/*
 * The people ProjectCallSMSConfig's create permissions let in, by the names
 * people see them under: the Project Owner and Project Admin roles and the
 * Create Call and SMS permission.
 */
export const WHO_MAY_ADD_A_PROJECT_TWILIO_ACCOUNT: string =
  "a Project Owner, a Project Admin or someone with Create Call and SMS";

/*
 * The people ProjectCallSMSConfig's update permissions let in, by the names
 * people see them under: they can change what a project's config is used
 * for (TwilioConfigUse).
 */
export const WHO_MAY_EDIT_A_PROJECT_TWILIO_ACCOUNT: string =
  "a Project Owner, a Project Admin or someone with Edit Call and SMS";

export enum TwilioMessageKind {
  SMS = "SMS",
  Call = "Call",
}

// What cannot happen without an account, after "set up to".
const WHAT_NEEDS_IT: Readonly<Record<TwilioMessageKind, string>> = {
  [TwilioMessageKind.SMS]: "send SMS",
  [TwilioMessageKind.Call]: "make phone calls",
};

/*
 * Who can add an account, and where, as the sentence after one that says
 * there is none: "The OneUptime server's administrator can add one in Admin
 * Dashboard > Settings > Call and SMS, or a project owner, a project admin or
 * someone with Create Call and SMS can add this project's own in Project
 * Settings > Notification Channels."
 */
export const WHO_CAN_ADD_A_TWILIO_ACCOUNT_SENTENCE: string = `The OneUptime server's administrator can add one in ${SERVER_TWILIO_SETTINGS_PAGE}, or ${WHO_MAY_ADD_A_PROJECT_TWILIO_ACCOUNT} can add this project's own in ${PROJECT_TWILIO_SETTINGS_PAGE}.`;

/*
 * What else can be done when a status page's own Twilio config is not used
 * for the message (TwilioConfigUse): the server's administrator can add an
 * account for it, or someone who may edit the project's configs can have
 * the config used for calls and SMS too.
 */
export const WHO_CAN_USE_THE_PROJECT_TWILIO_ACCOUNT_FOR_IT_SENTENCE: string = `The OneUptime server's administrator can add one in ${SERVER_TWILIO_SETTINGS_PAGE}, or ${WHO_MAY_EDIT_A_PROJECT_TWILIO_ACCOUNT} can use this config for calls and SMS in ${PROJECT_TWILIO_SETTINGS_PAGE}.`;

/*
 * The row action that makes a config the project's default for one kind of
 * message, as the Twilio Config table names it for a config that would take
 * only that kind - one used for SMS only, or for calls only
 * (TwilioConfigDefaultCopy).
 */
export const SET_AS_PROJECT_DEFAULT_FOR: Readonly<
  Record<TwilioMessageKind, string>
> = {
  [TwilioMessageKind.SMS]: "Set as Project Default for SMS",
  [TwilioMessageKind.Call]: "Set as Project Default for Calls",
};

// What a config sends, as in "a config used for SMS only", "the default for calls".
const WHAT_A_CONFIG_SENDS: Readonly<Record<TwilioMessageKind, string>> = {
  [TwilioMessageKind.SMS]: "SMS",
  [TwilioMessageKind.Call]: "calls",
};

/*
 * What else can be done when the project's default Twilio config is not
 * used for the message: a project has one default for SMS and one for
 * calls (TwilioConfigDefaults), so the fix is most often a second config,
 * used for that kind only - numbers that cannot do both are why a project
 * has a config for one kind only (issue #6574) - made the default for it.
 * Or the default is used for calls and SMS. Or the server's administrator
 * adds an account for it. "The OneUptime server's administrator can add one
 * in ..., or a Project Owner, a Project Admin or someone with Edit Call and
 * SMS can make a config used for calls only the project default for calls
 * (Set as Project Default for Calls in its row's menu), or use this config
 * for calls and SMS, in Project Settings > ...".
 */
export const getWhoCanSetAProjectDefaultForItSentence: (
  kind: TwilioMessageKind,
) => string = (kind: TwilioMessageKind): string => {
  const sends: string = WHAT_A_CONFIG_SENDS[kind];

  return `The OneUptime server's administrator can add one in ${SERVER_TWILIO_SETTINGS_PAGE}, or ${WHO_MAY_EDIT_A_PROJECT_TWILIO_ACCOUNT} can make a config used for ${sends} only the project default for ${sends} (${SET_AS_PROJECT_DEFAULT_FOR[kind]} in its row's menu), or use this config for calls and SMS, in ${PROJECT_TWILIO_SETTINGS_PAGE}.`;
};

/*
 * What is known of why no account takes the message: what the project's
 * own Twilio config - its default, or a status page's - is used for, when
 * that config is not used for this kind of message (a config used for SMS
 * only, for a call). Such a message goes as it would without the config,
 * through the OneUptime server's own account; this is what is said when
 * that has none either.
 */
export interface NoTwilioAccountContext {
  projectConfigUse?: unknown;
  /*
   * The config is a status page's own (StatusPage.callSmsConfig), which its
   * subscribers' SMS go through, rather than the project's default for the
   * message: a project default would not change what the page sends.
   */
  isStatusPageConfig?: boolean | undefined;
}

// Whether the project's own config was passed over: it is not used for this kind.
const isProjectConfigNotUsedFor: (
  kind: TwilioMessageKind,
  context: NoTwilioAccountContext | undefined,
) => boolean = (
  kind: TwilioMessageKind,
  context: NoTwilioAccountContext | undefined,
): boolean => {
  if (
    !context ||
    context.projectConfigUse === undefined ||
    context.projectConfigUse === null
  ) {
    return false;
  }

  return kind === TwilioMessageKind.SMS
    ? !TwilioConfigUses.sendsSms(context.projectConfigUse)
    : !TwilioConfigUses.makesCalls(context.projectConfigUse);
};

/*
 * "This project's default Twilio config is used for SMS only, and no other
 * Twilio account is set up to make phone calls. The OneUptime server's
 * administrator can add one in ..., or ... can make a config used for calls
 * only the project default for calls (...), or use this config for calls
 * and SMS, in ...": why a message the project's own config is not used for
 * went nowhere. Only the project's default for the message was read - a
 * project can have several configs - so it says "default". A status page's
 * own config is the page's: "This status page's Twilio config ...".
 */
const getProjectConfigNotUsedForMessage: (
  kind: TwilioMessageKind,
  context: NoTwilioAccountContext,
) => string = (
  kind: TwilioMessageKind,
  context: NoTwilioAccountContext,
): string => {
  const whatItIsUsedFor: string = `is used for ${TwilioConfigUses.getUseInSentence(
    context.projectConfigUse,
  )}, and no other Twilio account is set up to ${WHAT_NEEDS_IT[kind]}.`;

  if (context.isStatusPageConfig) {
    return `This status page's Twilio config ${whatItIsUsedFor} ${WHO_CAN_USE_THE_PROJECT_TWILIO_ACCOUNT_FOR_IT_SENTENCE}`;
  }

  return `This project's default Twilio config ${whatItIsUsedFor} ${getWhoCanSetAProjectDefaultForItSentence(kind)}`;
};

/*
 * What is said when an SMS or a call cannot go anywhere because there is no
 * Twilio account to send it through: "No Twilio account is set up to send
 * SMS. The OneUptime server's administrator can add one in ...". Said to
 * whoever asked - a person verifying their number, the reader of a message
 * log - so it names who can rather than telling the reader to.
 *
 * When the project has a Twilio config of its own that is not used for this
 * kind of message, it says so, and who can change that: the reader of "no
 * Twilio account" would otherwise look at the project's config and wonder.
 */
export const getNoTwilioAccountMessage: (
  kind: TwilioMessageKind,
  context?: NoTwilioAccountContext | undefined,
) => string = (
  kind: TwilioMessageKind,
  context?: NoTwilioAccountContext | undefined,
): string => {
  if (isProjectConfigNotUsedFor(kind, context)) {
    return getProjectConfigNotUsedForMessage(kind, context!);
  }

  return `No Twilio account is set up to ${WHAT_NEEDS_IT[kind]}. ${WHO_CAN_ADD_A_TWILIO_ACCOUNT_SENTENCE}`;
};

/*
 * Numbers for incoming calls are verified by text, so sending one's code
 * needs an account that can send SMS.
 */
export const INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE: string = `Numbers for incoming calls are verified by SMS, and no Twilio account is set up to send SMS. ${WHO_CAN_ADD_A_TWILIO_ACCOUNT_SENTENCE}`;

/*
 * The same, saying why when the project's default config is used for calls
 * only: "Numbers for incoming calls are verified by SMS. This project's
 * default Twilio config is used for calls only, and no other Twilio account
 * is set up to send SMS. ..."
 */
export const getIncomingCallNumberNoTwilioAccountMessage: (
  context?: NoTwilioAccountContext | undefined,
) => string = (context?: NoTwilioAccountContext | undefined): string => {
  if (isProjectConfigNotUsedFor(TwilioMessageKind.SMS, context)) {
    return `Numbers for incoming calls are verified by SMS. ${getProjectConfigNotUsedForMessage(
      TwilioMessageKind.SMS,
      context!,
    )}`;
  }

  return INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE;
};
