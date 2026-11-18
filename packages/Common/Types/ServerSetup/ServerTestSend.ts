import { translationKey } from "../Translator";
import ServerSendingStatusUtil, {
  ServerSendingChannel,
} from "../ServerSending/ServerSendingStatus";
import ServerSetUpProblem, {
  SERVER_PUSH_TURNED_OFF_PROBLEM,
  ServerSetUpProblemWords,
} from "../ServerSending/ServerSetUpProblem";

/*
 * A TEST SEND THROUGH THE SERVER'S OWN SETTINGS, AND WHAT IT ANSWERED.
 *
 * "Send test email" (Admin Dashboard > Settings > Emails), "Send test SMS"
 * and "Make test call" (Settings > Call and SMS), and the same buttons on
 * the server's setup checklist, send through the server's own settings
 * exactly as a real email, SMS or call does (POST
 * /api/notification/server-test/<channel>, master admins only). So how it
 * went is written to the same record the banner and the checklist read
 * (ServerSendingStatus): a test that goes out makes the channel working, one
 * the provider refuses makes it failing.
 *
 * "Send test push" (Settings > Push Notifications, and the checklist's push
 * row, #7028) pushes to the admin who pressed it, on the phones and browsers
 * they registered, through the same PushNotificationService a page goes
 * through - so once the server records how its pushes go (#6881), a test
 * push is recorded with them.
 *
 * The answer says, in words:
 *
 *   - accepted    the provider took it (smtp.example.com, Twilio): accepted
 *                 is not delivered, and the words say so for email;
 *   - refused     the provider, or the way to it, refused it, and what it
 *                 said;
 *   - not-set-up  nothing went out: what the settings are missing.
 *
 * Pure, with no Node or browser APIs: the Notification service, the Admin
 * Dashboard and their tests read it.
 */

export enum ServerTestSendResult {
  Accepted = "accepted",
  Refused = "refused",
  NotSetUp = "not-set-up",
}

// Where the Notification service takes a test send: /api/notification/server-test/<channel>.
export const SERVER_TEST_SEND_ROUTE: string = "/server-test";

/*
 * The channels a test can be sent on. A test push (#7028) goes to the admin
 * who pressed it, on the phones and browsers they registered: it takes no
 * address, and goes nowhere else.
 */
export const SERVER_TEST_SEND_CHANNELS: ReadonlyArray<ServerSendingChannel> = [
  ServerSendingChannel.Email,
  ServerSendingChannel.SMS,
  ServerSendingChannel.Call,
  ServerSendingChannel.Push,
];

export interface ServerTestSendAnswer {
  channel: ServerSendingChannel;
  result: ServerTestSendResult;
  /*
   * Where it went: an email address or a phone number - or, for a test
   * push, the names of the admin's devices that took it.
   */
  to: string;
  // What took it, or would have: smtp.example.com, Amazon SES (us-east-1), Twilio.
  sentThrough: string | null;
  // What the provider said when it refused, or what the settings are missing.
  message: string | null;
  /*
   * What the settings are missing, in words every language has (#9437):
   * not set up only, and only for a sentence of OneUptime's own. Left out
   * by an older server, and for what is drawn as it came.
   */
  messageWords?: ServerSetUpProblemWords | undefined;
}

/*
 * Why a test push did not go out, as the server answers it: what the reader
 * can do about it, in words every language the Admin Dashboard speaks has
 * (describeServerTestSend reads them in the reader's). Any other reason - a
 * push service's own words - is drawn as it came.
 */
export const SERVER_TEST_PUSH_REASONS: {
  turnedOff: string;
  noDevices: string;
  noVapidKeys: string;
} = {
  // As the checklist says it too (ServerSetUpProblem's SERVER_PUSH_TURNED_OFF_PROBLEM).
  turnedOff: SERVER_PUSH_TURNED_OFF_PROBLEM,
  noDevices: translationKey(
    "You have no phone or browser registered for push notifications. Register one under User Settings > Notification Methods in the Dashboard.",
  ),
  noVapidKeys: translationKey(
    "Your browsers cannot get a push from this server: it has no VAPID keys. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or register a phone with the OneUptime On-Call app.",
  ),
};

// Whether a reason is one of OneUptime's own, worded in every language.
export const isServerTestSendReasonKey: (reason: string) => boolean = (
  reason: string,
): boolean => {
  return (Object.values(SERVER_TEST_PUSH_REASONS) as Array<string>).includes(
    reason,
  );
};

// The longest provider answer kept: a mail server's can be long.
export const MAX_SERVER_TEST_SEND_MESSAGE_LENGTH: number = 500;

// What each button and its dialog say.
export const SERVER_TEST_SEND_WORDS: {
  sendTestEmail: string;
  sendTestSms: string;
  makeTestCall: string;
  sendTestPush: string;
  sendTo: string;
  phoneNumber: string;
  emailAccepted: string;
  smsAccepted: string;
  callAccepted: string;
  pushAccepted: string;
  refused: string;
  pushRefused: string;
  notSetUp: string;
} = {
  sendTestEmail: translationKey("Send test email"),
  sendTestSms: translationKey("Send test SMS"),
  makeTestCall: translationKey("Make test call"),
  sendTestPush: translationKey("Send test push"),
  sendTo: translationKey("Send to"),
  phoneNumber: translationKey("Phone number"),
  emailAccepted: translationKey(
    "{{sentThrough}} accepted the test email to {{to}}. If it does not arrive, look in the spam folder and in the mail server's logs.",
  ),
  smsAccepted: translationKey(
    "{{sentThrough}} accepted the test SMS to {{to}}.",
  ),
  callAccepted: translationKey(
    "{{sentThrough}} accepted the test call to {{to}}.",
  ),
  // Taken by the push services, which is not shown: the words say so.
  pushAccepted: translationKey(
    "The test push was accepted for {{to}}. If it does not show, look at the notification settings of that phone or browser.",
  ),
  refused: translationKey("{{sentThrough}} refused it: {{reason}}"),
  pushRefused: translationKey(
    "None of your devices took the test push: {{reason}}",
  ),
  notSetUp: translationKey("Nothing was sent: {{reason}}"),
};

// The button and dialog title of a channel's test.
export const getServerTestSendTitle: (
  channel: ServerSendingChannel,
) => string = (channel: ServerSendingChannel): string => {
  switch (channel) {
    case ServerSendingChannel.SMS:
      return SERVER_TEST_SEND_WORDS.sendTestSms;
    case ServerSendingChannel.Call:
      return SERVER_TEST_SEND_WORDS.makeTestCall;
    case ServerSendingChannel.Push:
      return SERVER_TEST_SEND_WORDS.sendTestPush;
    default:
      return SERVER_TEST_SEND_WORDS.sendTestEmail;
  }
};

/*
 * What an answer says, in English with its placeholders, and the values to
 * fill them with: the dialog translates it, a command line fills it.
 */
export const getServerTestSendSentence: (answer: ServerTestSendAnswer) => {
  template: string;
  values: Record<string, string>;
} = (
  answer: ServerTestSendAnswer,
): { template: string; values: Record<string, string> } => {
  const sentThrough: string = answer.sentThrough || "The provider";
  const reason: string = answer.message || "No reason was given.";
  const isPush: boolean = answer.channel === ServerSendingChannel.Push;

  switch (answer.result) {
    case ServerTestSendResult.Accepted:
      if (isPush) {
        return {
          template: SERVER_TEST_SEND_WORDS.pushAccepted,
          values: { to: answer.to },
        };
      }

      return {
        template:
          answer.channel === ServerSendingChannel.SMS
            ? SERVER_TEST_SEND_WORDS.smsAccepted
            : answer.channel === ServerSendingChannel.Call
              ? SERVER_TEST_SEND_WORDS.callAccepted
              : SERVER_TEST_SEND_WORDS.emailAccepted,
        values: { sentThrough: sentThrough, to: answer.to },
      };
    case ServerTestSendResult.Refused:
      // A push goes through a push service per device: what each said.
      if (isPush) {
        return {
          template: SERVER_TEST_SEND_WORDS.pushRefused,
          values: { reason: reason },
        };
      }

      return {
        template: SERVER_TEST_SEND_WORDS.refused,
        values: { sentThrough: sentThrough, reason: reason },
      };
    default:
      return {
        template: SERVER_TEST_SEND_WORDS.notSetUp,
        values: { reason: reason },
      };
  }
};

export const toServerTestSendMessage: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();

  return text ? text.slice(0, MAX_SERVER_TEST_SEND_MESSAGE_LENGTH) : null;
};

// An answer read in a browser, or null when it is not one.
export const parseServerTestSendAnswer: (
  value: unknown,
) => ServerTestSendAnswer | null = (
  value: unknown,
): ServerTestSendAnswer | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row: Record<string, unknown> = value as Record<string, unknown>;

  if (
    !ServerSendingStatusUtil.isChannel(row["channel"]) ||
    !SERVER_TEST_SEND_CHANNELS.includes(row["channel"]) ||
    !Object.values(ServerTestSendResult).includes(
      row["result"] as ServerTestSendResult,
    )
  ) {
    return null;
  }

  const answer: ServerTestSendAnswer = {
    channel: row["channel"],
    result: row["result"] as ServerTestSendResult,
    to: typeof row["to"] === "string" ? row["to"] : "",
    sentThrough: toServerTestSendMessage(row["sentThrough"]),
    message: toServerTestSendMessage(row["message"]),
  };

  // Words for what the settings are missing, only when they are ones this page knows.
  const messageWords: ServerSetUpProblemWords | null =
    answer.result === ServerTestSendResult.NotSetUp
      ? ServerSetUpProblem.parse(row["messageWords"])
      : null;

  if (messageWords) {
    answer.messageWords = messageWords;
  }

  return answer;
};
