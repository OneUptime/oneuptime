import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls (the DashboardCertsJobs
 * pattern).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The status page custom domain certificate jobs: scheduled every 15
 * minutes, each delegating to its StatusPageDomainService sweep, each with
 * a timeout of its own.
 *
 * The CNAME sweep now orders the certificate of a domain it has just
 * verified, and the re-order sweep orders in turn instead of looking
 * certificates up one at a time - both can take longer than the worker's
 * five-minute default, which ended a run part way through. The REAL RunCron
 * and JobDictionary run here; only the queue under them and the service
 * they delegate to are replaced.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

const mockRenewCerts: jest.Mock = jest.fn();
const mockUpdateProvisioning: jest.Mock = jest.fn();
const mockOrderSsl: jest.Mock = jest.fn();
const mockVerifyCname: jest.Mock = jest.fn();
const mockCheckOrderStatus: jest.Mock = jest.fn();

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

jest.mock("Common/Server/Services/StatusPageDomainService", () => {
  return {
    __esModule: true,
    default: {
      renewCertsWhichAreExpiringSoon: mockRenewCerts,
      updateSslProvisioningStatusForAllDomains: mockUpdateProvisioning,
      orderSSLForDomainsWhichAreNotOrderedYet: mockOrderSsl,
      verifyCnameWhoseCnameisNotVerified: mockVerifyCname,
      checkOrderStatus: mockCheckOrderStatus,
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
 * Imported AFTER the mocks and the bindings their factories close over; the
 * job import comes last - its side effects are what this file is about.
 */
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/StatusPageCerts/StatusPageCerts";

// Snapshotted at import time; registration happens exactly once.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

type JobSpec = {
  name: string;
  serviceMethod: jest.Mock;
  timeoutInMinutes: number;
};

/*
 * The names are the queue's job ids, so they are a contract with every
 * scheduled job already in Redis: a rename schedules a second copy.
 */
const JOBS: Array<JobSpec> = [
  {
    name: "StatusPageCerts:RenewCerts",
    serviceMethod: mockRenewCerts,
    timeoutInMinutes: 15,
  },
  {
    name: "StatusPageCerts:CheckSslProvisioningStatus",
    serviceMethod: mockUpdateProvisioning,
    timeoutInMinutes: 30,
  },
  {
    name: "StatusPageCerts:OrderSSL",
    serviceMethod: mockOrderSsl,
    timeoutInMinutes: 30,
  },
  {
    name: "StatusPageCerts:VerifyCnameWhoseCnameisNotVerified",
    serviceMethod: mockVerifyCname,
    timeoutInMinutes: 30,
  },
  {
    name: "StatusPageCerts:CheckOrderStatus",
    serviceMethod: mockCheckOrderStatus,
    timeoutInMinutes: 30,
  },
];

const DEFAULT_JOB_TIMEOUT_IN_MS: number = JobDictionary.getTimeoutInMs(
  "StatusPageCerts:NotARealJob",
);

beforeEach(() => {
  for (const job of JOBS) {
    job.serviceMethod.mockReset();
    job.serviceMethod.mockResolvedValue(undefined as never);
  }
});

describe("status page certificate jobs - registration", () => {
  test("each is scheduled exactly once, every 15 minutes on the Worker queue, with no run on startup", () => {
    expect(registrationAddJobCalls).toHaveLength(JOBS.length);

    for (const job of JOBS) {
      // Queue.addJob(queueName, jobId, jobName, data, options)
      const calls: Array<Array<unknown>> = registrationAddJobCalls.filter(
        (call: Array<unknown>) => {
          return call[2] === job.name;
        },
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]![0]).toBe("Worker");
      expect(calls[0]![1]).toBe(job.name);
      expect(calls[0]![4]).toEqual({ scheduleAt: EVERY_FIFTEEN_MINUTE });
    }
  });

  /*
   * The CNAME sweep orders the certificates of the domains it verifies, and
   * the re-order sweep orders too: an order can take a while.
   */
  test("each has its own timeout, longer than the five-minute default", () => {
    for (const job of JOBS) {
      const timeoutInMs: number = JobDictionary.getTimeoutInMs(job.name);

      expect([job.name, timeoutInMs]).toEqual([
        job.name,
        job.timeoutInMinutes * 60 * 1000,
      ]);
      expect(timeoutInMs).toBeGreaterThan(DEFAULT_JOB_TIMEOUT_IN_MS);
    }
  });
});

describe("status page certificate jobs - what the registered functions do", () => {
  test.each(
    JOBS.map((job: JobSpec) => {
      return [job.name, job] as const;
    }),
  )(
    "%s delegates to (and awaits) its StatusPageDomainService sweep, and only that one",
    async (_name: string, job: JobSpec) => {
      const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
        job.name,
      );

      await jobFunction();

      expect(job.serviceMethod).toHaveBeenCalledTimes(1);

      for (const other of JOBS) {
        if (other !== job) {
          expect(other.serviceMethod).not.toHaveBeenCalled();
        }
      }

      const failure: Error = new Error(`${job.name} failed`);
      job.serviceMethod.mockRejectedValue(failure as never);

      await expect(jobFunction()).rejects.toThrow(failure);
    },
  );
});
