import { EVERY_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * OpenStack:ExpireConnectionTests answers the cloud connection tests no probe will answer,
 * every minute, so "Test connection" in the dashboard always ends, and no secret waits in the
 * table for a probe that is not coming. The job registers itself with RunCron at import time;
 * the recorder below captures it and each test drives one tick.
 */

type CronHandler = () => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
}

interface CapturedJob {
  options: CronOptions;
  handler: CronHandler;
}

const mockCapturedJobs: Record<string, CapturedJob> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: (
      jobName: string,
      options: CronOptions,
      runFunction: CronHandler,
    ): void => {
      mockCapturedJobs[jobName] = { options, handler: runFunction };
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
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

jest.mock("Common/Server/Infrastructure/PostgresDatabase", () => {
  return {
    __esModule: true,
    default: {
      getDataSource: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/OpenStack/OpenStackConnectionTestStore", () => {
  return {
    __esModule: true,
    default: {
      expireStaleTests: jest.fn(),
    },
  };
});

import PostgresDatabase from "Common/Server/Infrastructure/PostgresDatabase";
import OpenStackConnectionTestStore from "Common/Server/Utils/OpenStack/OpenStackConnectionTestStore";
import logger from "Common/Server/Utils/Logger";
import "../../../../FeatureSet/Workers/Jobs/OpenStack/ExpireConnectionTests";

const JOB_NAME: string = "OpenStack:ExpireConnectionTests";

const store: { expireStaleTests: jest.Mock } =
  OpenStackConnectionTestStore as unknown as {
    expireStaleTests: jest.Mock;
  };

const database: { getDataSource: jest.Mock } = PostgresDatabase as unknown as {
  getDataSource: jest.Mock;
};

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const MANAGER: { query: () => void } = { query: (): void => {} };

beforeEach(() => {
  store.expireStaleTests.mockReset();
  store.expireStaleTests.mockResolvedValue(undefined as never);
  database.getDataSource.mockReset();
  database.getDataSource.mockReturnValue({ manager: MANAGER } as never);
  mockedLogger.error.mockReset();
});

describe("OpenStack:ExpireConnectionTests", () => {
  test("is registered to run every minute, not at startup", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedJobs[JOB_NAME]!.options).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    });
  });

  /*
   * The one thing left to do when the table exists: until then every tick would fail on a
   * table that is not there, so the Workers index does not import it yet.
   */
  test("the Workers index imports it once the table exists, and not before", () => {
    const index: string = fs.readFileSync(
      path.resolve(__dirname, "../../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );
    const models: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../../Common/Models/DatabaseModels/Index.ts",
      ),
      "utf8",
    );

    expect(index.includes('"./Jobs/OpenStack/ExpireConnectionTests"')).toBe(
      models.includes("OpenStackCloudConnectionTest"),
    );
  });

  test("a tick fails the tests nobody will answer", async () => {
    await mockCapturedJobs[JOB_NAME]!.handler();

    expect(store.expireStaleTests).toHaveBeenCalledTimes(1);
    expect(store.expireStaleTests).toHaveBeenCalledWith(MANAGER);
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("no database yet is nothing to do", async () => {
    database.getDataSource.mockReturnValue(null as never);

    await mockCapturedJobs[JOB_NAME]!.handler();

    expect(store.expireStaleTests).not.toHaveBeenCalled();
  });

  test("a tick that fails is logged, never thrown into the scheduler", async () => {
    store.expireStaleTests.mockRejectedValue(
      new Error("database is gone") as never,
    );

    await expect(
      mockCapturedJobs[JOB_NAME]!.handler(),
    ).resolves.toBeUndefined();
    expect(mockedLogger.error).toHaveBeenCalledWith(
      "OpenStack:ExpireConnectionTests cron failed: database is gone",
    );
  });
});
