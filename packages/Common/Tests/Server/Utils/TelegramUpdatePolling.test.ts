import TelegramUpdatePolling, {
  TELEGRAM_LONG_POLL_SECONDS,
  TELEGRAM_POLL_JOB_NAME,
  TELEGRAM_POLL_JOB_TIMEOUT_MS,
  TELEGRAM_UPDATE_RETRY_WINDOW_SECONDS,
  TELEGRAM_UPDATES_PER_RUN,
  TelegramPollOutcome,
  TelegramPollResult,
} from "../../../Server/Utils/TelegramUpdatePolling";
import TelegramBotUpdates from "../../../Server/Utils/TelegramBotUpdates";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import logger from "../../../Server/Utils/Logger";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../Utils/API";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * "Poll Telegram for Messages": a server Telegram cannot reach fetches the
 * bot's messages itself, so people on a server behind a VPN or a firewall
 * can still link their Telegram accounts. These tests hold the poller to
 * Telegram's getUpdates rules:
 *
 *   - a message is confirmed (an offset past it) only once it was handled,
 *     or once it is too old to try again;
 *   - a webhook stops getUpdates, so the poller removes it, keeping the
 *     messages waiting for it;
 *   - nothing runs while polling is off, and one run at a time;
 *   - the bot token is never written to the log.
 */

jest.mock("../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

jest.mock("../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: { lock: jest.fn(), release: jest.fn() },
  };
});

jest.mock("../../../Server/Utils/TelegramBotUpdates", () => {
  return {
    __esModule: true,
    default: { handleUpdate: jest.fn() },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("../../../Utils/API", () => {
  return {
    __esModule: true,
    default: { post: jest.fn() },
  };
});

const BOT_TOKEN: string = "8012345678:ABCdefGHIjklMNOpqrsTUVwxyz-0987654321";

const globalConfigService: { findOneBy: jest.Mock } =
  GlobalConfigService as unknown as { findOneBy: jest.Mock };
const semaphore: { lock: jest.Mock; release: jest.Mock } =
  Semaphore as unknown as { lock: jest.Mock; release: jest.Mock };
const botUpdates: { handleUpdate: jest.Mock } =
  TelegramBotUpdates as unknown as { handleUpdate: jest.Mock };
const api: { post: jest.Mock } = API as unknown as { post: jest.Mock };
const log: {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
} = logger as unknown as {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

const nowInSeconds: () => number = (): number => {
  return Math.floor(Date.now() / 1000);
};

function message(updateId: number, sentAtSeconds?: number): JSONObject {
  return {
    update_id: updateId,
    message: {
      text: `/start code-${updateId}`,
      chat: { id: 100 + updateId },
      date: sentAtSeconds === undefined ? nowInSeconds() : sentAtSeconds,
    },
  };
}

function updatesResponse(updates: Array<JSONObject>): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, { ok: true, result: updates }, {});
}

function refusal(statusCode: number, description: string): HTTPErrorResponse {
  return new HTTPErrorResponse(
    statusCode,
    { ok: false, error_code: statusCode, description },
    {},
  );
}

// The Bot API method and body of each request the poller made, in order.
function requests(): Array<{ method: string; data: JSONObject }> {
  return api.post.mock.calls.map((call: Array<unknown>) => {
    const options: { url: { toString: () => string }; data: JSONObject } =
      call[0] as { url: { toString: () => string }; data: JSONObject };
    const url: string = options.url.toString();
    return {
      method: url.substring(url.lastIndexOf("/") + 1),
      data: options.data,
    };
  });
}

function everythingLogged(): string {
  return JSON.stringify([
    log.debug.mock.calls,
    log.info.mock.calls,
    log.warn.mock.calls,
    log.error.mock.calls,
  ]);
}

describe("TelegramUpdatePolling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (
      TelegramUpdatePolling as unknown as {
        lastFailureLoggedAt: Map<string, number>;
      }
    ).lastFailureLoggedAt.clear();
    globalConfigService.findOneBy.mockResolvedValue({
      telegramBotToken: ` ${BOT_TOKEN} `,
      telegramPollForUpdates: true,
    });
    semaphore.lock.mockResolvedValue({ id: "mutex" });
    semaphore.release.mockResolvedValue(undefined);
    botUpdates.handleUpdate.mockResolvedValue(undefined);
  });

  describe("run", () => {
    test("does nothing while polling is off", async () => {
      globalConfigService.findOneBy.mockResolvedValue({
        telegramBotToken: BOT_TOKEN,
        telegramPollForUpdates: false,
      });

      const result: TelegramPollResult = await TelegramUpdatePolling.run();

      expect(result).toEqual({
        outcome: TelegramPollOutcome.Off,
        handledUpdates: 0,
      });
      expect(semaphore.lock).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
    });

    test("does nothing while no bot is configured, even with polling on", async () => {
      globalConfigService.findOneBy.mockResolvedValue({
        telegramBotToken: "  ",
        telegramPollForUpdates: true,
      });

      const result: TelegramPollResult = await TelegramUpdatePolling.run();

      expect(result.outcome).toBe(TelegramPollOutcome.Off);
      expect(semaphore.lock).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
    });

    test("reads only the token and the switch, as root", async () => {
      api.post.mockResolvedValue(updatesResponse([]));

      await TelegramUpdatePolling.run();

      expect(globalConfigService.findOneBy).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { telegramBotToken: true, telegramPollForUpdates: true },
          props: { isRoot: true },
        }),
      );
    });

    test("skips the run while another run holds the lock", async () => {
      semaphore.lock.mockRejectedValue(new Error("lock is taken"));

      const result: TelegramPollResult = await TelegramUpdatePolling.run();

      expect(result.outcome).toBe(TelegramPollOutcome.Busy);
      expect(api.post).not.toHaveBeenCalled();
      expect(semaphore.release).not.toHaveBeenCalled();
    });

    test("takes the lock without waiting for it, for longer than a run lasts", async () => {
      api.post.mockResolvedValue(updatesResponse([]));

      await TelegramUpdatePolling.run();

      const lockOptions: { acquireAttemptsLimit: number; lockTimeout: number } =
        semaphore.lock.mock.calls[0]![0] as {
          acquireAttemptsLimit: number;
          lockTimeout: number;
        };

      expect(lockOptions.acquireAttemptsLimit).toBe(1);
      expect(lockOptions.lockTimeout).toBeGreaterThan(
        TELEGRAM_POLL_JOB_TIMEOUT_MS,
      );
      expect(TELEGRAM_POLL_JOB_TIMEOUT_MS).toBeGreaterThan(
        TELEGRAM_LONG_POLL_SECONDS * 1000,
      );
    });

    test("releases the lock after a run that failed", async () => {
      api.post.mockRejectedValue(new Error("socket hang up"));

      await TelegramUpdatePolling.run();

      expect(semaphore.release).toHaveBeenCalledTimes(1);
    });

    test("hands each message to the handler with the configured token", async () => {
      const update: JSONObject = message(7);
      api.post.mockResolvedValueOnce(updatesResponse([update]));
      api.post.mockResolvedValueOnce(updatesResponse([]));

      const result: TelegramPollResult = await TelegramUpdatePolling.run();

      expect(result).toEqual({
        outcome: TelegramPollOutcome.Polled,
        handledUpdates: 1,
      });

      const handled: {
        update: JSONObject;
        getBotToken: () => Promise<string>;
      } = botUpdates.handleUpdate.mock.calls[0]![0] as {
        update: JSONObject;
        getBotToken: () => Promise<string>;
      };

      expect(handled.update).toEqual(update);
      // Trimmed, as the Admin Dashboard saves it with whatever was pasted.
      await expect(handled.getBotToken()).resolves.toBe(BOT_TOKEN);
    });
  });

  describe("pollOnce", () => {
    test("long-polls for messages only, a bounded number at a time", async () => {
      api.post.mockResolvedValue(updatesResponse([]));

      await TelegramUpdatePolling.pollOnce(BOT_TOKEN);

      expect(requests()).toEqual([
        {
          method: "getUpdates",
          data: {
            timeout: TELEGRAM_LONG_POLL_SECONDS,
            limit: TELEGRAM_UPDATES_PER_RUN,
            allowed_updates: ["message"],
          },
        },
      ]);

      const requestTimeoutInMs: number = (
        api.post.mock.calls[0]![0] as { options: { timeout: number } }
      ).options.timeout;

      // The request outlasts the long poll, or every quiet poll would fail.
      expect(requestTimeoutInMs).toBeGreaterThan(
        TELEGRAM_LONG_POLL_SECONDS * 1000,
      );
    });

    test("sends nothing more when there is no message", async () => {
      api.post.mockResolvedValue(updatesResponse([]));

      const result: TelegramPollResult =
        await TelegramUpdatePolling.pollOnce(BOT_TOKEN);

      expect(result).toEqual({
        outcome: TelegramPollOutcome.Polled,
        handledUpdates: 0,
      });
      expect(api.post).toHaveBeenCalledTimes(1);
      expect(botUpdates.handleUpdate).not.toHaveBeenCalled();
    });

    test("handles messages oldest first, then confirms past the last one", async () => {
      api.post.mockResolvedValueOnce(
        updatesResponse([message(12), message(10), message(11)]),
      );
      api.post.mockResolvedValueOnce(updatesResponse([]));

      const result: TelegramPollResult =
        await TelegramUpdatePolling.pollOnce(BOT_TOKEN);

      expect(result.handledUpdates).toBe(3);
      expect(
        botUpdates.handleUpdate.mock.calls.map((call: Array<unknown>) => {
          return ((call[0] as { update: JSONObject }).update as JSONObject)[
            "update_id"
          ];
        }),
      ).toEqual([10, 11, 12]);
      expect(requests()[1]).toEqual({
        method: "getUpdates",
        data: {
          offset: 13,
          limit: 1,
          timeout: 0,
          allowed_updates: ["message"],
        },
      });
    });

    test("leaves a message it could not handle for the next run, and everything after it", async () => {
      botUpdates.handleUpdate.mockImplementation(
        async (data: unknown): Promise<void> => {
          if ((data as { update: JSONObject }).update["update_id"] === 21) {
            throw new Error("database unavailable");
          }
        },
      );
      api.post.mockResolvedValueOnce(
        updatesResponse([message(20), message(21), message(22)]),
      );
      api.post.mockResolvedValueOnce(updatesResponse([]));

      const result: TelegramPollResult =
        await TelegramUpdatePolling.pollOnce(BOT_TOKEN);

      expect(result.handledUpdates).toBe(1);
      expect(botUpdates.handleUpdate).toHaveBeenCalledTimes(2);
      // Confirmed up to 21, not past it: Telegram sends 21 and 22 again.
      expect(requests()[1]!.data["offset"]).toBe(21);
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining("the next run fetches it again"),
      );
    });

    test("sends no confirmation when the first message fails", async () => {
      botUpdates.handleUpdate.mockRejectedValue(
        new Error("database unavailable"),
      );
      api.post.mockResolvedValueOnce(updatesResponse([message(30)]));

      await TelegramUpdatePolling.pollOnce(BOT_TOKEN);

      expect(api.post).toHaveBeenCalledTimes(1);
    });

    test("drops a failing message once it is too old to try again", async () => {
      const tooOld: number =
        nowInSeconds() - TELEGRAM_UPDATE_RETRY_WINDOW_SECONDS - 60;
      botUpdates.handleUpdate.mockImplementation(
        async (data: unknown): Promise<void> => {
          if ((data as { update: JSONObject }).update["update_id"] === 40) {
            throw new Error("always fails");
          }
        },
      );
      api.post.mockResolvedValueOnce(
        updatesResponse([message(40, tooOld), message(41)]),
      );
      api.post.mockResolvedValueOnce(updatesResponse([]));

      const result: TelegramPollResult =
        await TelegramUpdatePolling.pollOnce(BOT_TOKEN);

      // The old message no longer holds back the one after it.
      expect(result.handledUpdates).toBe(1);
      expect(botUpdates.handleUpdate).toHaveBeenCalledTimes(2);
      expect(requests()[1]!.data["offset"]).toBe(42);
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining("dropping it"),
      );
    });

    test("removes a webhook that stops polling, keeping the messages waiting for it", async () => {
      api.post.mockResolvedValueOnce(
        refusal(
          409,
          "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first",
        ),
      );
      api.post.mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          { ok: true, result: true, description: "Webhook was deleted" },
          {},
        ),
      );

      const result: TelegramPollResult =
        await TelegramUpdatePolling.pollOnce(BOT_TOKEN);

      expect(result.outcome).toBe(TelegramPollOutcome.WebhookRemoved);
      expect(requests()[1]).toEqual({
        method: "deleteWebhook",
        data: { drop_pending_updates: false },
      });
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining("Removed the bot's Telegram webhook"),
      );
      expect(botUpdates.handleUpdate).not.toHaveBeenCalled();
    });

    test("reports a webhook it could not remove", async () => {
      api.post.mockResolvedValueOnce(
        refusal(
          409,
          "Conflict: can't use getUpdates method while webhook is active",
        ),
      );
      api.post.mockResolvedValueOnce(refusal(500, "Internal Server Error"));

      const result: TelegramPollResult =
        await TelegramUpdatePolling.pollOnce(BOT_TOKEN);

      expect(result.outcome).toBe(TelegramPollOutcome.Failed);
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining("refused to remove it"),
      );
    });

    test("never removes a webhook over another program's getUpdates", async () => {
      api.post.mockResolvedValueOnce(
        refusal(
          409,
          "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
        ),
      );

      const result: TelegramPollResult =
        await TelegramUpdatePolling.pollOnce(BOT_TOKEN);

      expect(result.outcome).toBe(TelegramPollOutcome.Failed);
      expect(api.post).toHaveBeenCalledTimes(1);
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "Something else is fetching this bot's messages",
        ),
      );
    });

    test("says to check the token when Telegram does not accept it", async () => {
      api.post.mockResolvedValue(refusal(401, "Unauthorized"));

      const result: TelegramPollResult =
        await TelegramUpdatePolling.pollOnce(BOT_TOKEN);

      expect(result.outcome).toBe(TelegramPollOutcome.Failed);
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining("did not accept the bot token"),
      );
    });

    test("logs a failure that repeats every run only once in a while", async () => {
      api.post.mockRejectedValue(new Error("connect ETIMEDOUT"));

      for (let run: number = 0; run < 5; run++) {
        const result: TelegramPollResult =
          await TelegramUpdatePolling.pollOnce(BOT_TOKEN);
        expect(result.outcome).toBe(TelegramPollOutcome.Failed);
      }

      expect(log.error).toHaveBeenCalledTimes(1);
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining("Could not reach Telegram"),
      );
    });

    test("never writes the bot token to the log", async () => {
      api.post.mockRejectedValueOnce(
        new Error(
          `request to https://api.telegram.org/bot${BOT_TOKEN}/getUpdates failed`,
        ),
      );
      await TelegramUpdatePolling.pollOnce(BOT_TOKEN);

      botUpdates.handleUpdate.mockRejectedValue(
        new Error(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`),
      );
      api.post.mockResolvedValueOnce(updatesResponse([message(50)]));
      await TelegramUpdatePolling.pollOnce(BOT_TOKEN);

      api.post.mockResolvedValueOnce(
        refusal(409, `webhook is active for bot${BOT_TOKEN}`),
      );
      api.post.mockRejectedValueOnce(
        new Error(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`),
      );
      await TelegramUpdatePolling.pollOnce(BOT_TOKEN);

      expect(log.error).toHaveBeenCalled();
      expect(everythingLogged()).not.toContain(BOT_TOKEN);
      expect(everythingLogged()).not.toContain("ABCdefGHIjklMNOpqrsTUVwxyz");
    });
  });

  describe("readUpdates", () => {
    test("keeps updates with a numeric id, oldest first", () => {
      expect(
        TelegramUpdatePolling.readUpdates({
          ok: true,
          result: [
            { update_id: 3 },
            { update_id: "2" },
            null,
            { message: {} },
            { update_id: 1 },
            { update_id: 1.5 },
          ],
        } as unknown as JSONObject),
      ).toEqual([{ update_id: 1 }, { update_id: 3 }]);
    });

    test("reads no updates from an answer without a result list", () => {
      expect(TelegramUpdatePolling.readUpdates({ ok: true })).toEqual([]);
      expect(
        TelegramUpdatePolling.readUpdates({ result: "nope" } as JSONObject),
      ).toEqual([]);
    });
  });

  describe("isWorthFetchingAgain", () => {
    const now: Date = new Date("2026-10-22T12:00:00Z");
    const nowSeconds: number = now.getTime() / 1000;

    test("tries a message again while it is younger than the retry window", () => {
      expect(
        TelegramUpdatePolling.isWorthFetchingAgain(
          message(1, nowSeconds - TELEGRAM_UPDATE_RETRY_WINDOW_SECONDS + 1),
          now,
        ),
      ).toBe(true);
    });

    test("gives up on a message as old as the retry window", () => {
      expect(
        TelegramUpdatePolling.isWorthFetchingAgain(
          message(1, nowSeconds - TELEGRAM_UPDATE_RETRY_WINDOW_SECONDS),
          now,
        ),
      ).toBe(false);
    });

    test("gives up on an update that says nothing of when it was sent", () => {
      expect(
        TelegramUpdatePolling.isWorthFetchingAgain({ update_id: 1 }, now),
      ).toBe(false);
      expect(
        TelegramUpdatePolling.isWorthFetchingAgain(
          { update_id: 1, message: { date: "yesterday" } },
          now,
        ),
      ).toBe(false);
    });
  });

  test("is the job the worker runs", () => {
    expect(TELEGRAM_POLL_JOB_NAME).toBe("Telegram:PollUpdates");
  });
});
