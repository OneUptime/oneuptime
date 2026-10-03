import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { CertificateOrderReason } from "Common/Server/Utils/Greenlock/CertificateOrderBudget";
import { CertificateOrderOutcome } from "Common/Server/Utils/Greenlock/CertificateOrderOutcome";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls (the StatusPageCertsJobs
 * pattern).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * CoreSSL:EnsurePrimaryHostCertificate - the installation's own host's
 * certificate - orders the way every other certificate is ordered now:
 * through GreenlockUtil.orderCert, which takes the name's lock and one unit
 * of the installation's Let's Encrypt budget, with the primary host's
 * priority (a renewal's: before new custom domains). There is no CNAME to
 * check for it. Another order of the host running, or the budget being
 * used up for the moment, is not a failure: the next run orders it.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

const mockOrderCert: jest.Mock = jest.fn();
const mockFindOneBy: jest.Mock = jest.fn();

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

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    __esModule: true,
    ProvisionSsl: true,
    IsDevelopment: false,
    Host: "OneUptime.Example.com:443",
  };
});

jest.mock("Common/Server/Utils/Greenlock/Greenlock", () => {
  return {
    __esModule: true,
    default: {
      orderCert: mockOrderCert,
    },
  };
});

jest.mock("Common/Server/Services/AcmeCertificateService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: mockFindOneBy,
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

// The job import comes last: its side effects are what this file is about.
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/CoreSsl/ProvisionPrimaryDomain";

const JOB_NAME: string = "CoreSSL:EnsurePrimaryHostCertificate";

function inDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

beforeEach(() => {
  mockOrderCert.mockReset();
  mockFindOneBy.mockReset();
  mockOrderCert.mockResolvedValue(CertificateOrderOutcome.Ordered as never);
  mockFindOneBy.mockResolvedValue(null as never);
});

describe("CoreSSL:EnsurePrimaryHostCertificate", () => {
  test("orders the host's certificate as the primary host, with no CNAME to check", async () => {
    const job: PromiseVoidFunction = JobDictionary.getJobFunction(JOB_NAME);

    await job();

    expect(mockOrderCert).toHaveBeenCalledTimes(1);
    expect(mockOrderCert.mock.calls[0]![0]).toEqual({
      domain: "oneuptime.example.com",
      reason: CertificateOrderReason.PrimaryHost,
      validateCname: null,
    });
  });

  test("a certificate valid for more than 30 days more is left alone", async () => {
    mockFindOneBy.mockResolvedValue({ expiresAt: inDays(60) } as never);

    await JobDictionary.getJobFunction(JOB_NAME)();

    expect(mockOrderCert).not.toHaveBeenCalled();
  });

  test("a certificate within 30 days of expiring is renewed", async () => {
    mockFindOneBy.mockResolvedValue({ expiresAt: inDays(10) } as never);

    await JobDictionary.getJobFunction(JOB_NAME)();

    expect(mockOrderCert).toHaveBeenCalledTimes(1);
  });

  test.each([
    [CertificateOrderOutcome.NotOrderedNow],
    [CertificateOrderOutcome.LimitReached],
  ])(
    "nothing ordered now (%s) is not a failure: the next run orders it",
    async (outcome: CertificateOrderOutcome) => {
      mockOrderCert.mockResolvedValue(outcome as never);

      await expect(
        JobDictionary.getJobFunction(JOB_NAME)(),
      ).resolves.toBeUndefined();
    },
  );

  test("an order that fails fails the run", async () => {
    mockOrderCert.mockRejectedValue(new Error("CA refused the order") as never);

    await expect(JobDictionary.getJobFunction(JOB_NAME)()).rejects.toThrow(
      "CA refused the order",
    );
  });
});
