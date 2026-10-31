import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls (the DashboardCertsJobs
 * pattern).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The certificate jobs of a form's own domains (FormDomain) are SCHEDULED AT
 * ALL, on the schedule and budget the feature needs - the twins of the
 * status page and dashboard jobs.
 *
 * RunCron registers purely as a module side effect, so the import line in
 * App/FeatureSet/Workers/Index.ts is load-bearing: delete it and every
 * service suite stays green while production never verifies, orders or
 * renews a single form domain's certificate. The REAL RunCron and
 * JobDictionary run here; only the queue under them and the service they
 * delegate to are replaced.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

const mockVerifyCname: jest.Mock = jest.fn();
const mockOrderSsl: jest.Mock = jest.fn();
const mockCheckOrderStatus: jest.Mock = jest.fn();
const mockUpdateProvisioning: jest.Mock = jest.fn();
const mockRenewCerts: jest.Mock = jest.fn();

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

jest.mock("Common/Server/Services/FormDomainService", () => {
  return {
    __esModule: true,
    default: {
      verifyCnameWhoseCnameisNotVerified: mockVerifyCname,
      orderSSLForDomainsWhichAreNotOrderedYet: mockOrderSsl,
      checkOrderStatus: mockCheckOrderStatus,
      updateSslProvisioningStatusForAllDomains: mockUpdateProvisioning,
      renewCertsWhichAreExpiringSoon: mockRenewCerts,
    },
  };
});

/*
 * A plain object, so a test can switch forms on custom domains off by
 * writing to it: the job module reads the value when it runs, not when it
 * loads.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    __esModule: true,
    FormCNameRecord: "oneuptime.example.com",
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
import logger from "Common/Server/Utils/Logger";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/FormCerts/FormCerts";

// Snapshotted at import time; registration happens exactly once.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const mockedLogger: { error: jest.Mock; debug: jest.Mock } =
  logger as unknown as { error: jest.Mock; debug: jest.Mock };

const mockedConfig: { FormCNameRecord: string } = jest.requireMock(
  "Common/Server/EnvironmentConfig",
);

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
    name: "FormCerts:VerifyCnameWhoseCnameisNotVerified",
    serviceMethod: mockVerifyCname,
    // It orders the certificates of the domains it verifies.
    timeoutInMinutes: 30,
  },
  {
    name: "FormCerts:OrderSSL",
    serviceMethod: mockOrderSsl,
    timeoutInMinutes: 30,
  },
  {
    name: "FormCerts:CheckOrderStatus",
    serviceMethod: mockCheckOrderStatus,
    timeoutInMinutes: 30,
  },
  {
    name: "FormCerts:CheckSslProvisioningStatus",
    serviceMethod: mockUpdateProvisioning,
    timeoutInMinutes: 30,
  },
  {
    name: "FormCerts:RenewCerts",
    serviceMethod: mockRenewCerts,
    timeoutInMinutes: 15,
  },
];

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");
const WORKERS_INDEX_PATH: string = path.join(WORKERS_DIR, "Index.ts");
const JOB_FILE: string = path.join(
  WORKERS_DIR,
  "Jobs",
  "FormCerts",
  "FormCerts.ts",
);

const DEFAULT_JOB_TIMEOUT_IN_MS: number = JobDictionary.getTimeoutInMs(
  "FormCerts:NotARealJob",
);

function sideEffectImport(specifier: string): RegExp {
  const escaped: string = escapeRegExp(specifier);

  return new RegExp(`^\\s*import\\s+["']${escaped}["']\\s*;?\\s*$`, "m");
}

beforeEach(() => {
  mockedConfig.FormCNameRecord = "oneuptime.example.com";
  mockedLogger.debug.mockClear();

  for (const job of JOBS) {
    job.serviceMethod.mockReset();
    job.serviceMethod.mockResolvedValue(undefined as never);
  }
});

describe("form domain certificate jobs - wired into the worker at all", () => {
  test("Workers/Index.ts imports the job module as a top-level side effect, beside its twins", () => {
    expect(fs.existsSync(JOB_FILE)).toBe(true);

    const indexSource: string = fs.readFileSync(WORKERS_INDEX_PATH, {
      encoding: "utf-8",
    });

    expect(indexSource).toMatch(sideEffectImport("./Jobs/FormCerts/FormCerts"));
    expect(indexSource).toMatch(
      sideEffectImport("./Jobs/StatusPageCerts/StatusPageCerts"),
    );
    expect(indexSource).toMatch(
      sideEffectImport("./Jobs/DashboardCerts/DashboardCerts"),
    );
  });
});

describe("form domain certificate jobs - registration", () => {
  test("registering logged no error, so nothing was silently swallowed", () => {
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("all five jobs put runnable functions in JobDictionary under their exact names", () => {
    for (const job of JOBS) {
      expect(JobDictionary.has(job.name)).toBe(true);
      expect(typeof JobDictionary.getJobFunction(job.name)).toBe("function");
    }
  });

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

  test("each has its own timeout, longer than the five-minute default", () => {
    for (const job of JOBS) {
      const timeoutInMs: number = JobDictionary.getTimeoutInMs(job.name);

      expect(timeoutInMs).toBe(job.timeoutInMinutes * 60 * 1000);
      expect(timeoutInMs).toBeGreaterThan(DEFAULT_JOB_TIMEOUT_IN_MS);
    }
  });

  test("none of them shares a name with a status page or dashboard certificate job", () => {
    for (const job of JOBS) {
      expect(job.name.startsWith("FormCerts:")).toBe(true);
    }
  });
});

describe("form domain certificate jobs - what the registered functions do", () => {
  test.each(
    JOBS.map((job: JobSpec) => {
      return [job.name, job] as const;
    }),
  )(
    "%s delegates to (and awaits) its FormDomainService sweep, and only that one",
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

  /*
   * FormCNameRecord - FORM_CNAME_RECORD, else the status page CNAME record -
   * is the switch for forms on custom domains: with neither set the Custom
   * Domains API refuses to verify or order anything, so the workers must not
   * do it behind the API's back.
   */
  test.each(
    JOBS.map((job: JobSpec) => {
      return [job.name, job] as const;
    }),
  )(
    "%s does nothing while forms on custom domains are off, and says why",
    async (_name: string, job: JobSpec) => {
      mockedConfig.FormCNameRecord = "";

      const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
        job.name,
      );

      await expect(jobFunction()).resolves.toBeUndefined();

      for (const each of JOBS) {
        expect(each.serviceMethod).not.toHaveBeenCalled();
      }

      expect(String(mockedLogger.debug.mock.calls[0]![0])).toContain(
        "FORM_CNAME_RECORD nor STATUS_PAGE_CNAME_RECORD",
      );
    },
  );
});
