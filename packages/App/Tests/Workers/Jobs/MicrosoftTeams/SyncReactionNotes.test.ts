import { beforeEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";

/*
 * Microsoft Teams never tells OneUptime about a 📌 / 📣 on a message a person
 * posted, so this job has to go and look — every minute, or pins sit unsaved.
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

jest.mock(
  "Common/Server/Utils/Workspace/MicrosoftTeams/ReactionNoteSync",
  () => {
    return {
      __esModule: true,
      default: {
        syncAllProjects: (): unknown => {
          return syncAllProjects();
        },
      },
    };
  },
);

import "../../../../FeatureSet/Workers/Jobs/MicrosoftTeams/SyncReactionNotes";

describe("MicrosoftTeams:SyncReactionNotes", () => {
  beforeEach((): void => {
    syncAllProjects.mockClear();
  });

  test("is registered to run every minute with a timeout", () => {
    expect(runCron).toHaveBeenCalledTimes(1);

    const [name, options] = runCron.mock.calls[0] as [
      string,
      { schedule: string; runOnStartup: boolean; timeoutInMS: number },
    ];

    expect(name).toBe("MicrosoftTeams:SyncReactionNotes");
    expect(options).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
      timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(5),
    });
  });

  test("each run syncs every Teams-connected project", async () => {
    const run: () => Promise<void> = runCron.mock
      .calls[0]![2] as () => Promise<void>;

    await run();

    expect(syncAllProjects).toHaveBeenCalledTimes(1);
  });

  test("a failed run is reported to the cron runner, not swallowed", async () => {
    syncAllProjects.mockRejectedValueOnce(new Error("database is down"));
    const run: () => Promise<void> = runCron.mock
      .calls[0]![2] as () => Promise<void>;

    await expect(run()).rejects.toThrow("database is down");
  });
});
