import { ONEUPTIME_PRODUCT_NAME } from "../../Types/Branding/ProductBranding";
import { toGsm7Message } from "./Gsm7Text";
import { countSmsSegments } from "./SmsSegments";

/*
 * THE TEXT MESSAGES A TEAM MEMBER CHOSE TO GET.
 *
 * Besides pages (OnCallPageSms), OneUptime texts a team member about what
 * they asked to hear of in User Settings > Notification Settings: an
 * incident they own changed state, their on-call shift starts, they were
 * added to an escalation rule, a call to their incoming call policy was
 * missed. Each is one sentence, said the same way:
 *
 *   OneUptime: Incident INC-42 (Checkout API is down) is now Acknowledged.
 *   Turn off in User Settings > Notification Settings.
 *
 * (one line when sent). Who sends it comes first, as in a page, and the
 * last sentence says where these texts are turned off. They used to open
 * with "This is a message from OneUptime." and close with "To unsubscribe
 * from this notification go to User Settings in OneUptime Dashboard." -
 * 116 characters of a part's 160 before anything was said, so every one of
 * them took two parts.
 *
 * As it goes out (fitNotificationSmsForSending) the text is written in the
 * characters an SMS carries cheaply (Gsm7Text), links as they are, and the
 * turn-off sentence is left out when that is what makes it fit in one part.
 * Its other copies - a Slack or Microsoft Teams message, a Telegram message
 * made from it - keep every character as written.
 *
 * Pure, with no Node or browser APIs.
 */

/*
 * Who sends it. The Notification service puts the installation's own name
 * in its place when it goes by one, as in every SMS.
 */
export const NOTIFICATION_SMS_SENDER: string = ONEUPTIME_PRODUCT_NAME;

// Where a team member turns these texts off.
export const NOTIFICATION_SMS_TURN_OFF: string =
  "Turn off in User Settings > Notification Settings.";

// "OneUptime: <sentence> Turn off in User Settings > Notification Settings."
export const buildNotificationSms: (sentence: string) => string = (
  sentence: string,
): string => {
  return `${NOTIFICATION_SMS_SENDER}: ${sentence.trim()} ${NOTIFICATION_SMS_TURN_OFF}`;
};

/*
 * The text as it goes out by SMS: in GSM-7's characters wherever they have a
 * look-alike, links as written, and without the turn-off sentence when that
 * makes it fit in one part. `sentAs` is what the send path does to it
 * before the provider gets it (the installation's own name).
 */
export const fitNotificationSmsForSending: (
  message: string,
  sentAs?: (text: string) => string,
) => string = (
  message: string,
  sentAs: (text: string) => string = (text: string): string => {
    return text;
  },
): string => {
  const written: string = toGsm7Message(message);

  if (countSmsSegments(sentAs(written)).segments <= 1) {
    return written;
  }

  const ending: string = ` ${NOTIFICATION_SMS_TURN_OFF}`;

  if (!written.endsWith(ending)) {
    return written;
  }

  const withoutTurnOff: string = written.slice(0, -ending.length);

  return countSmsSegments(sentAs(withoutTurnOff)).segments <= 1
    ? withoutTurnOff
    : written;
};
