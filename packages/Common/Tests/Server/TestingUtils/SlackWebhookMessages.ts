import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import timers from "timers";

/*
 * What OneUptime posts to Slack incoming webhooks, caught before it leaves:
 * SlackUtil.sendMessageToChannelViaIncomingWebhook behind a fake that keeps
 * every message it is handed - the webhook it was for, and its text - and
 * answers as Slack does, or fails or never answers when a test says so.
 *
 * config.env may carry a real incoming webhook for the operator's own
 * channels (NOTIFICATION_SLACK_WEBHOOK_ON_*), so a suite that drives a
 * recharge, an adjustment or a deletion catches what it posts here rather
 * than posting it to Slack.
 */

export interface SlackWebhookMessage {
  url: string;
  text: string;
}

export interface SlackWebhookMessages {
  // Every message a post was asked for, in order - failed and held ones too.
  messages: Array<SlackWebhookMessage>;
  // The next posts fail with this error (until set back to null).
  failWith: (error: Error | null) => void;
  // The next posts never answer (until set back to false).
  holdAnswers: (value: boolean) => void;
}

/*
 * Installs the fake (jest.spyOn, so jest.restoreAllMocks() in the test's
 * afterEach takes it away again).
 */
export function captureSlackWebhookMessages(): SlackWebhookMessages {
  const messages: Array<SlackWebhookMessage> = [];
  let failure: Error | null = null;
  let isHoldingAnswers: boolean = false;

  jest
    .spyOn(SlackUtil, "sendMessageToChannelViaIncomingWebhook")
    .mockImplementation((async (data: { url: URL; text: string }) => {
      messages.push({ url: data.url.toString(), text: data.text });

      if (isHoldingAnswers) {
        return await new Promise<never>(() => {});
      }

      if (failure) {
        throw failure;
      }

      return new HTTPResponse<JSONObject>(200, {}, {});
    }) as never);

  return {
    messages,
    failWith: (error: Error | null): void => {
      failure = error;
    },
    holdAnswers: (value: boolean): void => {
      isHoldingAnswers = value;
    },
  };
}

/*
 * Lets the work a call left running in the background - a post it did not
 * wait for - run to its end. Node's own setImmediate: Common's jest
 * environment is jsdom, which has none.
 */
export async function flushBackgroundWork(): Promise<void> {
  for (let round: number = 0; round < 5; round++) {
    await new Promise<void>((resolve: () => void): void => {
      timers.setImmediate(resolve);
    });
  }
}

/*
 * A message's text as a reader sees it in Slack: without the invisible
 * characters that keep its formatting apart (zero-width spaces, word
 * joiners), and with the three characters Slack's text escapes ("&", "<"
 * and ">") read back. That a "<" a customer typed is shown, rather than
 * read as a mention or a link, is what the raw text says: it holds no "<"
 * of theirs.
 */
export function shownInSlack(text: string | undefined): string {
  return (text || "")
    .split("\u200B")
    .join("")
    .split("\u2060")
    .join("")
    .split("&lt;")
    .join("<")
    .split("&gt;")
    .join(">")
    .split("&amp;")
    .join("&");
}

// A message's lines as a reader sees them, without the blank ones.
export function shownLines(text: string | undefined): Array<string> {
  return shownInSlack(text)
    .split("\n")
    .map((line: string): string => {
      return line.trimEnd();
    })
    .filter(Boolean);
}
