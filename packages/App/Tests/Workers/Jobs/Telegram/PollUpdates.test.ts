import { beforeEach, describe, expect, test } from "@jest/globals";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";

/*
 * With "Poll Telegram for Messages" on, this job is the only way a server
 * Telegram cannot reach hears the /start messages that link people's
 * Telegram accounts - so it has to be registered, and run often enough that
 * the bot answers while the person is still looking.
 */

const runCron: jest.Mock = jest.fn();

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: (...args: Array<unknown>): unknown => {
      return runCron(...args);
    },
  };
});

const runPolling: jest.Mock = jest.fn(async (): Promise<unknown> => {
  return { outcome: "off", handledUpdates: 0 };
});

jest.mock("Common/Server/Utils/TelegramUpdatePolling", () => {
  return {
    __esModule: true,
    TELEGRAM_POLL_JOB_NAME: "Telegram:PollUpdates",
    TELEGRAM_POLL_JOB_TIMEOUT_MS: 90000,
    default: {
      run: (): unknown => {
        return runPolling();
      },
    },
  };
});

import "../../../../FeatureSet/Workers/Jobs/Telegram/PollUpdates";
import fs from "fs";
import path from "path";

describe("Telegram:PollUpdates", () => {
  beforeEach((): void => {
    runPolling.mockClear();
  });

  test("is registered to run every ten seconds with the poller's timeout", () => {
    expect(runCron).toHaveBeenCalledTimes(1);

    const [name, options] = runCron.mock.calls[0] as [
      string,
      { schedule: string; runOnStartup: boolean; timeoutInMS: number },
    ];

    expect(name).toBe("Telegram:PollUpdates");
    expect(options).toEqual({
      schedule: EVERY_TEN_SECONDS,
      runOnStartup: false,
      timeoutInMS: 90000,
    });
  });

  test("each run is one run of the poller", async () => {
    const run: () => Promise<void> = runCron.mock
      .calls[0]![2] as () => Promise<void>;

    await run();

    expect(runPolling).toHaveBeenCalledTimes(1);
  });

  test("a failed run is reported to the cron runner, not swallowed", async () => {
    runPolling.mockRejectedValueOnce(new Error("database is down"));
    const run: () => Promise<void> = runCron.mock
      .calls[0]![2] as () => Promise<void>;

    await expect(run()).rejects.toThrow("database is down");
  });

  test("is loaded by the worker", () => {
    const workers: string = fs.readFileSync(
      path.join(__dirname, "../../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    expect(workers).toContain('import "./Jobs/Telegram/PollUpdates";');
  });
});
