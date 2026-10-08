import { PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE } from "./NotificationChannels";

/*
 * The Twilio account SMS and phone calls go through.
 *
 * SMS and calls to the people in a project - on-call alerts, notifications,
 * and the codes that verify their phone numbers - go through the project's
 * default Twilio config (Project Settings > Notification Settings), and
 * through the Twilio account of the OneUptime server itself when the project
 * has none (Admin Dashboard > Settings > Call and SMS). OneUptime Cloud always
 * has the second. A self-hosted server has neither until somebody sets one
 * up, and until then no SMS or call can go anywhere.
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
  "a project owner, a project admin or someone with Create Call and SMS";

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
 * Settings > Notification Settings."
 */
export const WHO_CAN_ADD_A_TWILIO_ACCOUNT_SENTENCE: string = `The OneUptime server's administrator can add one in ${SERVER_TWILIO_SETTINGS_PAGE}, or ${WHO_MAY_ADD_A_PROJECT_TWILIO_ACCOUNT} can add this project's own in ${PROJECT_TWILIO_SETTINGS_PAGE}.`;

/*
 * What is said when an SMS or a call cannot go anywhere because there is no
 * Twilio account to send it through: "No Twilio account is set up to send
 * SMS. The OneUptime server's administrator can add one in ...". Said to
 * whoever asked - a person verifying their number, the reader of a message
 * log - so it names who can rather than telling the reader to.
 */
export const getNoTwilioAccountMessage: (kind: TwilioMessageKind) => string = (
  kind: TwilioMessageKind,
): string => {
  return `No Twilio account is set up to ${WHAT_NEEDS_IT[kind]}. ${WHO_CAN_ADD_A_TWILIO_ACCOUNT_SENTENCE}`;
};

/*
 * Numbers for incoming calls are verified by text, so sending one's code
 * needs an account that can send SMS.
 */
export const INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE: string = `Numbers for incoming calls are verified by SMS, and no Twilio account is set up to send SMS. ${WHO_CAN_ADD_A_TWILIO_ACCOUNT_SENTENCE}`;
