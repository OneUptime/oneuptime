import ProjectBalanceType from "../../Types/Billing/ProjectBalanceType";
import Permission from "../../Types/Permission";
import {
  PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE,
  PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PATH,
  ProjectNotificationChannel,
} from "./NotificationChannels";

/*
 * A project's two prepaid balances, which exist where OneUptime bills
 * (OneUptime Cloud):
 *
 * - its balance for SMS, phone calls, WhatsApp and Telegram
 *   (Project.smsOrCallCurrentBalanceInUSDCents), on Project Settings >
 *   Notification Settings;
 * - its AI credits (Project.aiCurrentBalanceInUSDCents), which pay for
 *   OneUptime AI on the OneUptime-hosted LLM provider, on Project Settings →
 *   AI Credits.
 *
 * Only a project owner, or someone with Manage Billing, may add to either:
 * the recharge routes (POST /notification/recharge and POST /ai/recharge)
 * let in exactly PROJECT_BALANCE_RECHARGE_PERMISSIONS, and so do the Auto
 * Recharge columns' update permissions - a test holds all of them to this
 * list. Not a project admin: adding balance charges the project's card, and
 * that is billing.
 *
 * So everything that says a balance is too low says who can add to it, in
 * these words, and where - and never tells its reader to do it, since most
 * readers cannot: the server's refusals (adding a notification method,
 * sending its code again, an AI call), the log of a message that was not
 * sent, and the AI readiness gaps. The owners, who may, are told to, with a
 * link (Server/Utils/ProjectBalanceOwnerNotice). The dashboard says the
 * same in its own translated copy (Components/ProjectBalance), and offers
 * the Recharge button, or a link to the page, only to the people who may.
 *
 * None of it reaches a status page visitor: a subscriber's text that the
 * balance could not pay for counts as not reached, and the visitor is never
 * sent to project settings.
 *
 * Kept free of server and React code, so the server, the dashboard and the
 * tests read the same words.
 */

export { ProjectBalanceType };

/*
 * Who may add to a balance: the recharge routes' permissions, and the update
 * permissions of every Auto Recharge column.
 */
export const PROJECT_BALANCE_RECHARGE_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ManageProjectBilling,
];

/*
 * The people PROJECT_BALANCE_RECHARGE_PERMISSIONS let in, in words - the
 * same words the daily AI limits use for the same two permissions. The
 * notification channel switches let in a Billing Admin as well, so their
 * words name one more (Utils/Project/NotificationChannels): a Billing Admin
 * may switch a paid channel on, and not add to the balance it spends.
 */
export const WHO_CAN_ADD_PROJECT_BALANCE: string =
  "a project owner or someone with Manage Billing";

export type ProjectBalanceAutoRechargeColumn =
  | "enableAutoRechargeSmsOrCallBalance"
  | "autoRechargeSmsOrCallByBalanceInUSD"
  | "autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD"
  | "enableAutoRechargeAiBalance"
  | "autoAiRechargeByBalanceInUSD"
  | "autoRechargeAiWhenCurrentBalanceFallsInUSD";

/*
 * Each balance's Auto Recharge card: its switch first, then how much is
 * added and when. Changing any of them takes the same permissions as a
 * recharge.
 */
export const PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS: Readonly<
  Record<ProjectBalanceType, ReadonlyArray<ProjectBalanceAutoRechargeColumn>>
> = {
  [ProjectBalanceType.SmsOrCall]: [
    "enableAutoRechargeSmsOrCallBalance",
    "autoRechargeSmsOrCallByBalanceInUSD",
    "autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD",
  ],
  [ProjectBalanceType.AI]: [
    "enableAutoRechargeAiBalance",
    "autoAiRechargeByBalanceInUSD",
    "autoRechargeAiWhenCurrentBalanceFallsInUSD",
  ],
};

// The page that holds each balance, its Recharge button and Auto Recharge.
export const PROJECT_BALANCE_SETTINGS_PAGE: Readonly<
  Record<ProjectBalanceType, string>
> = {
  [ProjectBalanceType.SmsOrCall]: PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE,
  [ProjectBalanceType.AI]: "Project Settings → AI Credits",
};

// Where that page is in the dashboard, under a project's own route.
export const PROJECT_BALANCE_SETTINGS_PATH: Readonly<
  Record<ProjectBalanceType, string>
> = {
  [ProjectBalanceType.SmsOrCall]: PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PATH,
  [ProjectBalanceType.AI]: "settings/ai-credits",
};

// What is added to each balance, in a sentence.
const WHAT_IS_ADDED: Readonly<Record<ProjectBalanceType, string>> = {
  [ProjectBalanceType.SmsOrCall]: "balance",
  [ProjectBalanceType.AI]: "AI credits",
};

const capitalize: (text: string) => string = (text: string): string => {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
};

/*
 * Who can add to a balance, and where, as the sentence after one that says
 * it is too low - for whoever reads it, who may or may not be one of them:
 * "A project owner or someone with Manage Billing can add balance in Project
 * Settings > Notification Settings."
 *
 * It does not offer Auto Recharge as the way out. For AI credits it is not
 * one: AI is recharged after a call it paid for, so a balance that is used
 * up stays used up until someone adds credits. Whoever can add balance finds
 * Auto Recharge on the same page.
 */
export const getProjectBalanceWhoCanAddSentence: (
  balance: ProjectBalanceType,
) => string = (balance: ProjectBalanceType): string => {
  return `${capitalize(WHO_CAN_ADD_PROJECT_BALANCE)} can add ${WHAT_IS_ADDED[balance]} in ${PROJECT_BALANCE_SETTINGS_PAGE[balance]}.`;
};

/*
 * For the project's owners, who may add balance (the email they get when a
 * message was not sent for want of it): what to do, and where. Turning on
 * the notification balance's Auto Recharge charges the card at once when
 * the balance is below its threshold (ProjectService), so it is a way out
 * there; AI credits are recharged only after a call they paid for, so they
 * have to be added first.
 */
export const getProjectBalanceOwnerSentence: (
  balance: ProjectBalanceType,
) => string = (balance: ProjectBalanceType): string => {
  if (balance === ProjectBalanceType.AI) {
    return `Add AI credits in ${PROJECT_BALANCE_SETTINGS_PAGE[balance]}, and turn on Auto Recharge there so they do not run out again.`;
  }

  return `Add balance in ${PROJECT_BALANCE_SETTINGS_PAGE[balance]}, or turn on Auto Recharge there so it does not run out.`;
};

// What sending on a channel is, after "too low to".
const SEND_WORDS: Readonly<Record<ProjectNotificationChannel, string>> = {
  [ProjectNotificationChannel.SMS]: "send SMS",
  [ProjectNotificationChannel.Call]: "make phone calls",
  [ProjectNotificationChannel.WhatsApp]: "send WhatsApp messages",
  [ProjectNotificationChannel.Telegram]: "send Telegram messages",
};

// One message on a channel, as "this SMS".
const ONE_MESSAGE_WORDS: Readonly<Record<ProjectNotificationChannel, string>> =
  {
    [ProjectNotificationChannel.SMS]: "this SMS",
    [ProjectNotificationChannel.Call]: "this call",
    [ProjectNotificationChannel.WhatsApp]: "this WhatsApp message",
    [ProjectNotificationChannel.Telegram]: "this Telegram message",
  };

/*
 * What the server says when adding a notification method, or sending its
 * verification code again, is refused because the project's balance is too
 * low to pay for the code: "This project's balance is too low to send SMS.
 * A project owner or someone with Manage Billing can add balance in Project
 * Settings > Notification Settings." Said to whoever asked, so it names who
 * can rather than telling the reader to.
 */
export const getProjectBalanceTooLowMessage: (
  channel: ProjectNotificationChannel,
) => string = (channel: ProjectNotificationChannel): string => {
  return `This project's balance is too low to ${SEND_WORDS[channel]}. ${getProjectBalanceWhoCanAddSentence(ProjectBalanceType.SmsOrCall)}`;
};

/*
 * Numbers for incoming calls are verified by text, so adding one - or
 * sending its code again - needs balance for an SMS.
 */
export const INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE: string = `Numbers for incoming calls are verified by SMS, and this project's balance is too low to send SMS. ${getProjectBalanceWhoCanAddSentence(ProjectBalanceType.SmsOrCall)}`;

// An amount of money, as the balance pages show it: "0.05 USD".
export const formatProjectBalanceAmount: (
  amountInUSDCents: number,
) => string = (amountInUSDCents: number): string => {
  const cents: number = Number.isFinite(amountInUSDCents)
    ? amountInUSDCents
    : 0;

  return `${(cents / 100).toFixed(2)} USD`;
};

/*
 * Why one message was not sent, in plain facts: "This project's balance is
 * used up." when nothing is left, and otherwise how much is left against
 * what the message costs: "This project's balance (0.05 USD) is less than
 * this SMS costs (0.10 USD)."
 */
export const getProjectBalanceShortfallSentence: (data: {
  channel: ProjectNotificationChannel;
  balanceInUSDCents: number;
  costInUSDCents: number;
}) => string = (data: {
  channel: ProjectNotificationChannel;
  balanceInUSDCents: number;
  costInUSDCents: number;
}): string => {
  if (!(data.balanceInUSDCents > 0)) {
    return "This project's balance is used up.";
  }

  return `This project's balance (${formatProjectBalanceAmount(
    data.balanceInUSDCents,
  )}) is less than ${ONE_MESSAGE_WORDS[data.channel]} costs (${formatProjectBalanceAmount(
    data.costInUSDCents,
  )}).`;
};

/*
 * Why one message was not sent for want of balance, where the project's
 * members read it - the message's log, a person's on-call timeline, and the
 * error a status page job counts as not reached: the shortfall, then who can
 * add balance and where.
 */
export const getProjectBalanceMessageNotSentReason: (data: {
  channel: ProjectNotificationChannel;
  balanceInUSDCents: number;
  costInUSDCents: number;
}) => string = (data: {
  channel: ProjectNotificationChannel;
  balanceInUSDCents: number;
  costInUSDCents: number;
}): string => {
  return `${getProjectBalanceShortfallSentence(data)} ${getProjectBalanceWhoCanAddSentence(ProjectBalanceType.SmsOrCall)}`;
};

/*
 * What an AI call is refused with once the project's AI credits are used up
 * (AIService.executeWithLogging), to whoever asked - Ask AI, a Slack or
 * Microsoft Teams question, a workflow, a runbook step.
 */
export const PROJECT_AI_CREDITS_USED_UP_MESSAGE: string = `This project's AI credits are used up. ${getProjectBalanceWhoCanAddSentence(ProjectBalanceType.AI)}`;
