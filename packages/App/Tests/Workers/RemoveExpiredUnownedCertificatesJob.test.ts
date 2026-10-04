import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_DAY } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls (the ThreatIntelJobs
 * pattern).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The cleanup of certificates nobody owns is SCHEDULED AT ALL, daily, and
 * hands GreenlockUtil the full list of certificate owners.
 *
 * The renewal runs only touch their own certificates, so without this job
 * nothing would ever delete the certificate of a domain whose row was
 * removed by a cascading delete. RunCron registers purely as a module side
 * effect, so the import in App/FeatureSet/Workers/Index.ts is load-bearing.
 * The REAL RunCron and JobDictionary run here; the queue, GreenlockUtil and
 * the owner list are replaced.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

const mockRemoveExpiredCertificatesNobodyOwns: jest.Mock = jest.fn();
const mockGetAllOwners: jest.Mock = jest.fn();

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
      MarketingEvent: "MarketingEvent",
    },
    default: {
      addJob: mockAddJob,
    },
  };
});

jest.mock("Common/Server/Utils/Greenlock/Greenlock", () => {
  return {
    __esModule: true,
    default: {
      removeExpiredCertificatesNobodyOwns:
        mockRemoveExpiredCertificatesNobodyOwns,
    },
  };
});

jest.mock("Common/Server/Utils/Greenlock/CertificateOwners", () => {
  return {
    __esModule: true,
    default: {
      getAll: mockGetAllOwners,
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

/*
 * Imported AFTER the mocks and the bindings their factories close over: the
 * job registers itself when it is imported.
 */
import logger from "Common/Server/Utils/Logger";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/Certificates/RemoveExpiredUnownedCertificates";

// Snapshotted at import time; registration happens exactly once.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const JOB_NAME: string = "Certificates:RemoveExpiredUnownedCertificates";

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");

const OWNERS: Array<{ name: string }> = [
  { name: "status page domains" },
  { name: "dashboard domains" },
  { name: "primary host" },
];

beforeEach(() => {
  mockRemoveExpiredCertificatesNobodyOwns.mockReset();
  mockRemoveExpiredCertificatesNobodyOwns.mockResolvedValue(0 as never);
  mockGetAllOwners.mockReset();
  mockGetAllOwners.mockReturnValue(OWNERS);
});

describe("certificate cleanup job - wired into the worker", () => {
  test("Workers/Index.ts imports the job module as a top-level side effect", () => {
    expect(
      fs.existsSync(
        path.join(
          WORKERS_DIR,
          "Jobs",
          "Certificates",
          "RemoveExpiredUnownedCertificates.ts",
        ),
      ),
    ).toBe(true);

    const indexSource: string = fs.readFileSync(
      path.join(WORKERS_DIR, "Index.ts"),
      { encoding: "utf-8" },
    );

    expect(indexSource).toMatch(
      /^\s*import\s+["']\.\/Jobs\/Certificates\/RemoveExpiredUnownedCertificates["']\s*;?\s*$/m,
    );
  });

  test("registers once, daily on the Worker queue, with no run on startup and its own timeout", () => {
    expect(mockedLogger.error).not.toHaveBeenCalled();
    expect(JobDictionary.has(JOB_NAME)).toBe(true);

    expect(registrationAddJobCalls).toHaveLength(1);
    // Queue.addJob(queueName, jobId, jobName, data, options)
    expect(registrationAddJobCalls[0]![0]).toBe("Worker");
    expect(registrationAddJobCalls[0]![2]).toBe(JOB_NAME);
    expect(registrationAddJobCalls[0]![4]).toEqual({ scheduleAt: EVERY_DAY });

    expect(JobDictionary.getTimeoutInMs(JOB_NAME)).toBe(15 * 60 * 1000);
  });
});

describe("certificate cleanup job - what it runs", () => {
  test("hands GreenlockUtil every certificate owner, and waits for it", async () => {
    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(JOB_NAME);

    await jobFunction();

    expect(mockGetAllOwners).toHaveBeenCalledTimes(1);
    expect(mockRemoveExpiredCertificatesNobodyOwns).toHaveBeenCalledTimes(1);
    expect(mockRemoveExpiredCertificatesNobodyOwns).toHaveBeenCalledWith({
      owners: OWNERS,
    });

    const failure: Error = new Error("lookup failed");
    mockRemoveExpiredCertificatesNobodyOwns.mockRejectedValue(failure as never);

    await expect(jobFunction()).rejects.toThrow(failure);
  });
});
