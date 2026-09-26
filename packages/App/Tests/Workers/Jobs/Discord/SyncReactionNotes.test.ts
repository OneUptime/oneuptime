import { beforeEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";

/*
 * Discord has no reaction webhooks for messages people post, so this job
 * polls the watched channels every minute or note reactions sit unsaved.
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

const syncAllProjects: jest.Mock = jest.fn(async (): Promise<void> => {});

jest.mock("Common/Server/Utils/Workspace/Discord/ReactionNoteSync", () => {
  return {
    __esModule: true,
    default: {
      syncAllProjects: (): unknown => {
        return syncAllProjects();
      },
    },
  };
});

import "../../../../FeatureSet/Workers/Jobs/Discord/SyncReactionNotes";

describe("Discord:SyncReactionNotes", () => {
  beforeEach((): void => {
    syncAllProjects.mockClear();
  });

  test("is registered to run every minute with a timeout", () => {
    expect(runCron).toHaveBeenCalledTimes(1);

    const [name, options] = runCron.mock.calls[0] as [
      string,
      { schedule: string; runOnStartup: boolean; timeoutInMS: number },
    ];

    expect(name).toBe("Discord:SyncReactionNotes");
    expect(options).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
      timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(5),
    });
  });

  test("each run syncs every Discord-connected project", async () => {
    const [, , run]: [string, unknown, () => Promise<void>] = runCron.mock
      .calls[0] as [string, unknown, () => Promise<void>];

    await run();

    expect(syncAllProjects).toHaveBeenCalledTimes(1);
  });

  test("a failing run surfaces the error to the cron framework", async () => {
    syncAllProjects.mockRejectedValueOnce(new Error("discord down"));

    const [, , run]: [string, unknown, () => Promise<void>] = runCron.mock
      .calls[0] as [string, unknown, () => Promise<void>];

    // RunCron owns error handling; the job must not swallow failures.
    await expect(run()).rejects.toThrow("discord down");
  });
});
