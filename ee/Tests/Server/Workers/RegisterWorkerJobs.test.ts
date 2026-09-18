import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The enterprise Workers area: registerWorkerJobs() loads the two
 * instance-health cron modules, which register themselves through core's real
 * RunCron. Only the Redis-backed Queue.addJob is replaced, so this checks the
 * real JobDictionary and the real schedule core's queue workers will see.
 *
 * The job names are a contract with every install that ran an earlier release
 * (the repeatable definitions are already in Redis) and with core's
 * EnterpriseLoader, which gives a no-op handler to any enterprise job name ee
 * did not register.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import WorkersArea from "../../../Server/Workers/Index";
import EnterpriseModule, { ENTERPRISE_AREAS } from "../../../Server/Index";
import EnterpriseArea from "../../../Server/Types/EnterpriseArea";
import JobDictionary from "App/FeatureSet/Workers/Utils/JobDictionary";
import { INSTANCE_HEALTH_JOB_TIMEOUT_IN_MINUTES } from "App/FeatureSet/Workers/Jobs/InstanceHealth/InstanceHealthLock";
import EnterpriseLoader, {
  ENTERPRISE_OWNED_JOB_NAMES,
} from "App/Utils/EnterpriseLoader";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

const HEALTH_JOB_NAMES: Array<string> = [
  "InstanceHealth:EvaluatePostgresHealth",
  "InstanceHealth:EvaluateRedisHealth",
];

let addJobSpy: { mock: { calls: Array<Array<unknown>> } };

beforeAll(() => {
  setTestBillingEnabled(false);
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
  addJobSpy = jest
    .spyOn(Queue, "addJob")
    .mockResolvedValue(undefined as never) as unknown as {
    mock: { calls: Array<Array<unknown>> };
  };
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("the enterprise Workers area", () => {
  test("is one of the assembled module's areas and registers worker jobs", () => {
    expect(ENTERPRISE_AREAS).toContain(WorkersArea);
    expect(
      ENTERPRISE_AREAS.find((area: EnterpriseArea): boolean => {
        return area.name === "Workers";
      })?.registerWorkerJobs,
    ).toBe(WorkersArea.registerWorkerJobs);
  });

  test("nothing is registered until core asks", () => {
    for (const jobName of HEALTH_JOB_NAMES) {
      expect({ jobName, registered: JobDictionary.has(jobName) }).toEqual({
        jobName,
        registered: false,
      });
    }
  });

  test("registerWorkerJobs registers both health evaluations with core's JobDictionary", async () => {
    await EnterpriseModule.registerWorkerJobs();

    for (const jobName of HEALTH_JOB_NAMES) {
      expect({ jobName, registered: JobDictionary.has(jobName) }).toEqual({
        jobName,
        registered: true,
      });
      expect(JobDictionary.getTimeoutInMs(jobName)).toBe(
        OneUptimeDate.convertMinutesToMilliseconds(
          INSTANCE_HEALTH_JOB_TIMEOUT_IN_MINUTES,
        ),
      );
    }
  });

  test("each is scheduled every five minutes on the worker queue, and not run on startup", () => {
    for (const jobName of HEALTH_JOB_NAMES) {
      const calls: Array<Array<unknown>> = addJobSpy.mock.calls.filter((call: Array<unknown>): boolean => {
        return call[1] === jobName;
      });

      expect(calls).toEqual([
        [QueueName.Worker, jobName, jobName, {}, { scheduleAt: EVERY_FIVE_MINUTE }],
      ]);
    }
  });

  test("asking again does not schedule them twice", async () => {
    const before: number = addJobSpy.mock.calls.length;

    await WorkersArea.registerWorkerJobs?.();

    expect(addJobSpy.mock.calls.length).toBe(before);
  });

  test("the names are the enterprise-owned names core keeps placeholders for", () => {
    for (const jobName of HEALTH_JOB_NAMES) {
      expect(ENTERPRISE_OWNED_JOB_NAMES).toContain(jobName);
    }
  });

  test("core's placeholder pass leaves the registered health jobs alone", () => {
    const placeholders: Array<string> =
      EnterpriseLoader.registerMissingJobPlaceholders();

    for (const jobName of HEALTH_JOB_NAMES) {
      expect(placeholders).not.toContain(jobName);
    }
  });
});
