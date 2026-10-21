import { beforeEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";

/*
 * On-call user groups (Slack user groups, Microsoft Teams tags) take the
 * people on call at every hand-off, straight from the schedule's roster
 * refresh. This job is the backstop: each minute it looks again at the
 * groups whose time has come (every 15 minutes, sooner after Slack or Teams
 * did not answer) - so a member added by hand, or somebody who has since
 * connected their account, is put right.
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

const syncDueGroups: jest.Mock = jest.fn(async (): Promise<void> => {});

jest.mock(
  "Common/Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync",
  () => {
    return {
      __esModule: true,
      default: {
        syncDueGroups: (...args: Array<unknown>): unknown => {
          return syncDueGroups(...args);
        },
      },
    };
  },
);

import "../../../../FeatureSet/Workers/Jobs/WorkspaceUserGroup/SyncUserGroups";

describe("WorkspaceUserGroup:SyncUserGroups", () => {
  beforeEach((): void => {
    syncDueGroups.mockClear();
  });

  test("is registered to run every minute, not on startup, with a timeout", () => {
    expect(runCron).toHaveBeenCalledTimes(1);

    const [name, options] = runCron.mock.calls[0] as [
      string,
      { schedule: string; runOnStartup: boolean; timeoutInMS: number },
    ];

    expect(name).toBe("WorkspaceUserGroup:SyncUserGroups");
    expect(options).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
      timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(5),
    });
  });

  test("each run looks at the groups that are due, with the default batch", async () => {
    const run: () => Promise<void> = runCron.mock
      .calls[0]![2] as () => Promise<void>;

    await run();

    expect(syncDueGroups).toHaveBeenCalledTimes(1);
    expect(syncDueGroups).toHaveBeenCalledWith();
  });

  test("a failed run is reported to the cron runner, not swallowed", async () => {
    syncDueGroups.mockRejectedValueOnce(new Error("database is down"));
    const run: () => Promise<void> = runCron.mock
      .calls[0]![2] as () => Promise<void>;

    await expect(run()).rejects.toThrow("database is down");
  });

  test("the worker loads the job", () => {
    const workers: string = fs.readFileSync(
      path.resolve(__dirname, "../../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    expect(workers).toContain(
      'import "./Jobs/WorkspaceUserGroup/SyncUserGroups";',
    );
  });
});
