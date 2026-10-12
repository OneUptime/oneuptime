import { EVERY_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * VMware:ExpireConnectionTests answers the vCenter connection tests no probe
 * will answer, every minute, so "Test connection" in the dashboard always
 * ends - and no password waits in the table for a probe that is not coming.
 * The job registers itself with RunCron at import time; the recorder below
 * captures it and each test drives one tick.
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

jest.mock("Common/Server/Services/VMwareVCenterConnectionTestService", () => {
  return {
    __esModule: true,
    default: {
      expireStaleTests: jest.fn(),
    },
  };
});

import VMwareVCenterConnectionTestService from "Common/Server/Services/VMwareVCenterConnectionTestService";
import logger from "Common/Server/Utils/Logger";
import "../../../../FeatureSet/Workers/Jobs/VMware/ExpireConnectionTests";

const JOB_NAME: string = "VMware:ExpireConnectionTests";

const service: { expireStaleTests: jest.Mock } =
  VMwareVCenterConnectionTestService as unknown as {
    expireStaleTests: jest.Mock;
  };

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

beforeEach(() => {
  service.expireStaleTests.mockReset();
  service.expireStaleTests.mockResolvedValue(undefined as never);
  mockedLogger.error.mockReset();
});

describe("VMware:ExpireConnectionTests", () => {
  test("is registered to run every minute, not at startup", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedJobs[JOB_NAME]!.options).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    });
  });

  test("is part of the worker: the Workers index imports it", () => {
    const index: string = fs.readFileSync(
      path.resolve(__dirname, "../../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    expect(index).toMatch(
      /^import "\.\/Jobs\/VMware\/ExpireConnectionTests";$/m,
    );
  });

  test("a tick fails the tests nobody will answer", async () => {
    await mockCapturedJobs[JOB_NAME]!.handler();

    expect(service.expireStaleTests).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("a tick that fails is logged, never thrown into the scheduler", async () => {
    service.expireStaleTests.mockRejectedValue(
      new Error("database is gone") as never,
    );

    await expect(
      mockCapturedJobs[JOB_NAME]!.handler(),
    ).resolves.toBeUndefined();
    expect(mockedLogger.error).toHaveBeenCalledWith(
      "VMware:ExpireConnectionTests cron failed: database is gone",
    );
  });
});
