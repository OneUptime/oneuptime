import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import GlobalConfigService from "../Services/GlobalConfigService";
import { redactLogString } from "./LogRedaction";
import logger from "./Logger";
import TelegramBotUpdates from "./TelegramBotUpdates";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import API from "../../Utils/API";

/*
 * Fetches the messages people send the OneUptime bot, for a server Telegram
 * cannot reach - one behind a VPN, or a firewall that lets nothing in
 * (GlobalConfig.telegramPollForUpdates: "Poll Telegram for Messages" in the
 * Admin Dashboard). The worker job Telegram:PollUpdates runs it every few
 * seconds. A run asks Telegram for new messages with one long-poll
 * getUpdates request, over outbound HTTPS only, and hands each message to
 * TelegramBotUpdates, as the webhook does.
 *
 * Telegram keeps a message until a getUpdates request asks only for the ones
 * after it (its offset), so nothing is stored here. A run confirms the
 * messages it handled before it ends, and a message it could not handle is
 * fetched again by the next run.
 */

export const TELEGRAM_POLL_JOB_NAME: string = "Telegram:PollUpdates";

// How long one getUpdates request waits for a message before answering with none.
export const TELEGRAM_LONG_POLL_SECONDS: number = 20;

// The request itself waits that long, so it is given longer than that.
const GET_UPDATES_REQUEST_TIMEOUT_MS: number =
  (TELEGRAM_LONG_POLL_SECONDS + 10) * 1000;

const CONFIRM_REQUEST_TIMEOUT_MS: number = 10 * 1000;

// Messages one run takes from Telegram, at most.
export const TELEGRAM_UPDATES_PER_RUN: number = 20;

/*
 * A message whose handling failed - the database could not be reached, say -
 * is fetched again by the next run while it is this young. An older one is
 * dropped, with an error in the log: a message that always fails would
 * otherwise hold back every message after it.
 */
export const TELEGRAM_UPDATE_RETRY_WINDOW_SECONDS: number = 5 * 60;

/*
 * One run at a time, on every server: Telegram answers a second getUpdates
 * request for the same bot with a conflict, and two runs could handle one
 * message twice. The lock outlasts the longest run, so a run that dies
 * holding it frees it on its own.
 */
const POLL_LOCK_KEY: string = TELEGRAM_POLL_JOB_NAME;
const POLL_LOCK_NAMESPACE: string = "Workers.Cron";
const POLL_LOCK_TIMEOUT_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(2);

export const TELEGRAM_POLL_JOB_TIMEOUT_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(1.5);

// A failure that repeats every run is logged once in this long.
const REPEATED_FAILURE_LOG_INTERVAL_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(10);

export enum TelegramPollOutcome {
  // Polling is off, or no bot is configured.
  Off = "off",
  // Another run is fetching messages.
  Busy = "busy",
  Polled = "polled",
  // Telegram had a webhook set, which stops getUpdates; it was removed.
  WebhookRemoved = "webhook-removed",
  Failed = "failed",
}

export interface TelegramPollResult {
  outcome: TelegramPollOutcome;
  // Messages handled and confirmed by this run.
  handledUpdates: number;
}

export default class TelegramUpdatePolling {
  private static lastFailureLoggedAt: Map<string, number> = new Map<
    string,
    number
  >();

  // One run of the job: fetches and handles new messages, when polling is on.
  public static async run(): Promise<TelegramPollResult> {
    const botToken: string | undefined = await this.getPollingBotToken();

    if (!botToken) {
      return { outcome: TelegramPollOutcome.Off, handledUpdates: 0 };
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: POLL_LOCK_KEY,
        namespace: POLL_LOCK_NAMESPACE,
        lockTimeout: POLL_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
      });
    } catch (err) {
      logger.debug(
        `${TELEGRAM_POLL_JOB_NAME} - Could not take the polling lock; another run is fetching messages (or Redis is unavailable). Skipping this run: ${err}`,
      );
      return { outcome: TelegramPollOutcome.Busy, handledUpdates: 0 };
    }

    try {
      return await this.pollOnce(botToken);
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        // A release failure only means the lock expires on its own timeout.
        logger.error(
          `${TELEGRAM_POLL_JOB_NAME} - Error releasing the polling lock: ${err}`,
        );
      }
    }
  }

  // The bot's token while polling is on and a bot is configured.
  public static async getPollingBotToken(): Promise<string | undefined> {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: {
          telegramBotToken: true,
          telegramPollForUpdates: true,
        },
      });

    if (!globalConfig?.telegramPollForUpdates) {
      return undefined;
    }

    return globalConfig.telegramBotToken?.trim() || undefined;
  }

  // One getUpdates request, and the messages it brings.
  public static async pollOnce(botToken: string): Promise<TelegramPollResult> {
    let response: HTTPResponse<JSONObject> | HTTPErrorResponse;

    try {
      response = await this.callBotApi({
        botToken: botToken,
        method: "getUpdates",
        data: {
          timeout: TELEGRAM_LONG_POLL_SECONDS,
          limit: TELEGRAM_UPDATES_PER_RUN,
          allowed_updates: ["message"],
        },
        timeoutInMs: GET_UPDATES_REQUEST_TIMEOUT_MS,
      });
    } catch (err) {
      this.logRepeatedFailure(
        "fetch",
        `${TELEGRAM_POLL_JOB_NAME} - Could not reach Telegram to fetch the bot's messages: ${this.describeError(err)}`,
      );
      return { outcome: TelegramPollOutcome.Failed, handledUpdates: 0 };
    }

    if (response instanceof HTTPErrorResponse) {
      return await this.onGetUpdatesRefused({
        botToken: botToken,
        response: response,
      });
    }

    let handledUpdates: number = 0;
    let nextOffset: number | undefined = undefined;

    for (const update of this.readUpdates(response.data)) {
      const updateId: number = update["update_id"] as number;

      try {
        await TelegramBotUpdates.handleUpdate({
          update: update,
          getBotToken: async (): Promise<string> => {
            return botToken;
          },
        });
        handledUpdates++;
      } catch (err) {
        if (this.isWorthFetchingAgain(update)) {
          logger.error(
            `${TELEGRAM_POLL_JOB_NAME} - Could not handle Telegram message ${updateId}; the next run fetches it again: ${this.describeError(err)}`,
          );
          break;
        }

        logger.error(
          `${TELEGRAM_POLL_JOB_NAME} - Could not handle Telegram message ${updateId}, sent more than ${TELEGRAM_UPDATE_RETRY_WINDOW_SECONDS / 60} minutes ago; dropping it: ${this.describeError(err)}`,
        );
      }

      nextOffset = updateId + 1;
    }

    if (nextOffset !== undefined) {
      await this.confirmUpdates({ botToken: botToken, offset: nextOffset });
    }

    return { outcome: TelegramPollOutcome.Polled, handledUpdates };
  }

  /*
   * The updates in a getUpdates answer, oldest first. One without a numeric
   * id cannot be confirmed on its own, and is never handled.
   */
  public static readUpdates(data: JSONObject): Array<JSONObject> {
    const result: unknown = data?.["result"];

    if (!Array.isArray(result)) {
      return [];
    }

    return result
      .filter((update: unknown): update is JSONObject => {
        return (
          typeof update === "object" &&
          update !== null &&
          Number.isSafeInteger((update as JSONObject)["update_id"])
        );
      })
      .sort((a: JSONObject, b: JSONObject): number => {
        return (a["update_id"] as number) - (b["update_id"] as number);
      });
  }

  // Whether a message that could not be handled is young enough to try again.
  public static isWorthFetchingAgain(
    update: JSONObject,
    now: Date = OneUptimeDate.getCurrentDate(),
  ): boolean {
    const message: JSONObject | undefined = update["message"] as
      | JSONObject
      | undefined;
    const sentAtSeconds: unknown = message?.["date"];

    if (typeof sentAtSeconds !== "number" || !Number.isFinite(sentAtSeconds)) {
      return false;
    }

    const ageInSeconds: number = now.getTime() / 1000 - sentAtSeconds;

    return ageInSeconds < TELEGRAM_UPDATE_RETRY_WINDOW_SECONDS;
  }

  /*
   * Tells Telegram the messages before `offset` are handled, so it stops
   * sending them. The request returns at once; a message it brings along is
   * not confirmed, and the next run fetches it.
   */
  private static async confirmUpdates(data: {
    botToken: string;
    offset: number;
  }): Promise<void> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await this.callBotApi({
          botToken: data.botToken,
          method: "getUpdates",
          data: {
            offset: data.offset,
            limit: 1,
            timeout: 0,
            allowed_updates: ["message"],
          },
          timeoutInMs: CONFIRM_REQUEST_TIMEOUT_MS,
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error(
          `${TELEGRAM_POLL_JOB_NAME} - Telegram refused to confirm the handled messages (${response.statusCode}): ${this.describeRefusal(response)}. The next run may handle them again.`,
        );
      }
    } catch (err) {
      logger.error(
        `${TELEGRAM_POLL_JOB_NAME} - Could not confirm the handled messages with Telegram; the next run may handle them again: ${this.describeError(err)}`,
      );
    }
  }

  private static async onGetUpdatesRefused(data: {
    botToken: string;
    response: HTTPErrorResponse;
  }): Promise<TelegramPollResult> {
    const description: string = this.describeRefusal(data.response);

    if (data.response.statusCode === 409) {
      /*
       * Telegram sends a bot's messages to its webhook or to getUpdates,
       * never both: while a webhook is set it refuses getUpdates. The
       * administrator chose polling, so the webhook goes. Messages waiting
       * for it are kept, and the next run fetches them.
       */
      if (description.toLowerCase().includes("webhook")) {
        return await this.removeWebhook(data.botToken);
      }

      this.logRepeatedFailure(
        "conflict",
        `${TELEGRAM_POLL_JOB_NAME} - Something else is fetching this bot's messages from Telegram (${description}). Only one program may: stop any other server or tool that polls the bot, or turn off "Poll Telegram for Messages" in the Admin Dashboard.`,
      );
      return { outcome: TelegramPollOutcome.Failed, handledUpdates: 0 };
    }

    if (data.response.statusCode === 401 || data.response.statusCode === 404) {
      this.logRepeatedFailure(
        "token",
        `${TELEGRAM_POLL_JOB_NAME} - Telegram did not accept the bot token (${data.response.statusCode}: ${description}). Check the token in Admin Dashboard > Settings > Telegram.`,
      );
      return { outcome: TelegramPollOutcome.Failed, handledUpdates: 0 };
    }

    this.logRepeatedFailure(
      "refused",
      `${TELEGRAM_POLL_JOB_NAME} - Telegram refused to send the bot's messages (${data.response.statusCode}): ${description}`,
    );
    return { outcome: TelegramPollOutcome.Failed, handledUpdates: 0 };
  }

  private static async removeWebhook(
    botToken: string,
  ): Promise<TelegramPollResult> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await this.callBotApi({
          botToken: botToken,
          method: "deleteWebhook",
          data: {
            drop_pending_updates: false,
          },
          timeoutInMs: CONFIRM_REQUEST_TIMEOUT_MS,
        });

      if (response instanceof HTTPErrorResponse) {
        this.logRepeatedFailure(
          "webhook",
          `${TELEGRAM_POLL_JOB_NAME} - Telegram has a webhook set for the bot, which stops polling, and refused to remove it (${response.statusCode}): ${this.describeRefusal(response)}`,
        );
        return { outcome: TelegramPollOutcome.Failed, handledUpdates: 0 };
      }
    } catch (err) {
      this.logRepeatedFailure(
        "webhook",
        `${TELEGRAM_POLL_JOB_NAME} - Telegram has a webhook set for the bot, which stops polling, and it could not be removed: ${this.describeError(err)}`,
      );
      return { outcome: TelegramPollOutcome.Failed, handledUpdates: 0 };
    }

    logger.warn(
      `${TELEGRAM_POLL_JOB_NAME} - Removed the bot's Telegram webhook: "Poll Telegram for Messages" is on, so OneUptime fetches the bot's messages from Telegram instead. To use the webhook again, turn polling off and register the webhook (Admin Dashboard > Settings > Telegram).`,
    );

    return { outcome: TelegramPollOutcome.WebhookRemoved, handledUpdates: 0 };
  }

  private static async callBotApi(data: {
    botToken: string;
    method: string;
    data: JSONObject;
    timeoutInMs: number;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    return await API.post<JSONObject>({
      url: new URL(
        Protocol.HTTPS,
        "api.telegram.org",
        new Route(`/bot${data.botToken}/${data.method}`),
      ),
      data: data.data,
      headers: {
        "Content-Type": "application/json",
      },
      options: {
        timeout: data.timeoutInMs,
      },
    });
  }

  // Telegram's own reason, never the request's address: it holds the token.
  private static describeRefusal(response: HTTPErrorResponse): string {
    const description: unknown = response.data?.["description"];

    return redactLogString(
      typeof description === "string" && description
        ? description
        : "no reason given",
    );
  }

  private static describeError(err: unknown): string {
    return redactLogString(
      err instanceof Error ? err.message : String(err || "unknown error"),
    );
  }

  /*
   * A failure that comes back every run - an unreachable Telegram, a revoked
   * token - is logged once in REPEATED_FAILURE_LOG_INTERVAL_MS, not every few
   * seconds.
   */
  private static logRepeatedFailure(kind: string, message: string): void {
    const now: number = Date.now();
    const lastLoggedAt: number | undefined = this.lastFailureLoggedAt.get(kind);

    if (
      lastLoggedAt !== undefined &&
      now - lastLoggedAt < REPEATED_FAILURE_LOG_INTERVAL_MS
    ) {
      return;
    }

    this.lastFailureLoggedAt.set(kind, now);
    logger.error(message);
  }
}
