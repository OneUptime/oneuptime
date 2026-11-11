import { translationKey } from "../Translator";
import ServerSendingStatusUtil, {
  ServerSendingChannel,
} from "../ServerSending/ServerSendingStatus";

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

// The channels a test can be sent on: push has no test of its own here.
export const SERVER_TEST_SEND_CHANNELS: ReadonlyArray<ServerSendingChannel> = [
  ServerSendingChannel.Email,
  ServerSendingChannel.SMS,
  ServerSendingChannel.Call,
];

export interface ServerTestSendAnswer {
  channel: ServerSendingChannel;
  result: ServerTestSendResult;
  // Where it went: an email address or a phone number.
  to: string;
  // What took it, or would have: smtp.example.com, Amazon SES (us-east-1), Twilio.
  sentThrough: string | null;
  // What the provider said when it refused, or what the settings are missing.
  message: string | null;
}

// The longest provider answer kept: a mail server's can be long.
export const MAX_SERVER_TEST_SEND_MESSAGE_LENGTH: number = 500;

// What each button and its dialog say.
export const SERVER_TEST_SEND_WORDS: {
  sendTestEmail: string;
  sendTestSms: string;
  makeTestCall: string;
  sendTo: string;
  phoneNumber: string;
  emailAccepted: string;
  smsAccepted: string;
  callAccepted: string;
  refused: string;
  notSetUp: string;
} = {
  sendTestEmail: translationKey("Send test email"),
  sendTestSms: translationKey("Send test SMS"),
  makeTestCall: translationKey("Make test call"),
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
  refused: translationKey("{{sentThrough}} refused it: {{reason}}"),
  notSetUp: translationKey("Nothing was sent: {{reason}}"),
};

// The button and dialog title of a channel's test.
export const getServerTestSendTitle: (channel: ServerSendingChannel) => string =
  (channel: ServerSendingChannel): string => {
    switch (channel) {
      case ServerSendingChannel.SMS:
        return SERVER_TEST_SEND_WORDS.sendTestSms;
      case ServerSendingChannel.Call:
        return SERVER_TEST_SEND_WORDS.makeTestCall;
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

  switch (answer.result) {
    case ServerTestSendResult.Accepted:
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

  return {
    channel: row["channel"],
    result: row["result"] as ServerTestSendResult,
    to: typeof row["to"] === "string" ? row["to"] : "",
    sentThrough: toServerTestSendMessage(row["sentThrough"]),
    message: toServerTestSendMessage(row["message"]),
  };
};
