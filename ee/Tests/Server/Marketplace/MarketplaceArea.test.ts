import MarketplaceArea, {
  MARKETPLACE_JOB_NAMES,
  isMarketplaceBillingWanted,
} from "../../../Server/Marketplace/Index";
import {
  REPORT_MARKETPLACE_USAGE_JOB_NAME,
  REPORT_MARKETPLACE_USAGE_TIMEOUT_IN_MS,
} from "../../../Server/Marketplace/MarketplaceUsageRun";
import { ENTERPRISE_AREAS } from "../../../Server/Index";
import { ENTERPRISE_OWNED_JOB_NAMES } from "App/Utils/EnterpriseLoader";
import JobDictionary from "App/FeatureSet/Workers/Utils/JobDictionary";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import logger from "Common/Server/Utils/Logger";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The Marketplace area of the enterprise module: it registers the usage job
 * only on a self-hosted installation that names a marketplace, says in the
 * log how the installation is billed, and adds no routes.
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

const ORIGINAL_ENV: NodeJS.ProcessEnv = { ...process.env };

const setMarketplaceEnv: (env: Record<string, string>) => void = (
  env: Record<string, string>,
): void => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("ENTERPRISE_MARKETPLACE")) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, env);
};

beforeEach(() => {
  setTestBillingEnabled(false);
  setMarketplaceEnv({});
  jest.spyOn(logger, "info").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("the Marketplace area", () => {
  it("is part of the enterprise module, after every area that was there before it", () => {
    // Only the audit log export, added after it, comes later.
    expect(ENTERPRISE_AREAS[ENTERPRISE_AREAS.length - 2]).toBe(MarketplaceArea);
    expect(ENTERPRISE_AREAS[ENTERPRISE_AREAS.length - 1]?.name).toBe(
      "AuditLogExport",
    );
    expect(MarketplaceArea.name).toBe("Marketplace");
  });

  it("adds no routes", () => {
    expect(MarketplaceArea.getApiRouters).toBeUndefined();
    expect(MarketplaceArea.getIdentityRouters).toBeUndefined();
  });

  it("names its job, which core keeps a placeholder for", () => {
    expect(MARKETPLACE_JOB_NAMES).toEqual([REPORT_MARKETPLACE_USAGE_JOB_NAME]);
    expect(ENTERPRISE_OWNED_JOB_NAMES).toContain(
      REPORT_MARKETPLACE_USAGE_JOB_NAME,
    );
  });
});

describe("isMarketplaceBillingWanted", () => {
  it("is only for a self-hosted installation that names a marketplace", () => {
    expect(isMarketplaceBillingWanted({ kind: "none" })).toBe(false);
    expect(
      isMarketplaceBillingWanted({
        kind: "incomplete",
        marketplace: null,
        problems: ["?"],
      }),
    ).toBe(true);

    setTestBillingEnabled(true);
    expect(
      isMarketplaceBillingWanted({
        kind: "incomplete",
        marketplace: null,
        problems: ["?"],
      }),
    ).toBe(false);
  });

  it("reads the environment when not handed the settings", () => {
    expect(isMarketplaceBillingWanted()).toBe(false);

    setMarketplaceEnv({ ENTERPRISE_MARKETPLACE: "azure" });
    expect(isMarketplaceBillingWanted()).toBe(true);
  });
});

describe("MarketplaceArea.init", () => {
  it("says nothing on an installation that names no marketplace", async () => {
    await MarketplaceArea.init!();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("names what is missing when the settings are incomplete", async () => {
    setMarketplaceEnv({ ENTERPRISE_MARKETPLACE: "azure" });

    await MarketplaceArea.init!();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("global.azure.extension.resourceId"),
    );
  });

  it("says how a complete installation is billed", async () => {
    setMarketplaceEnv({
      ENTERPRISE_MARKETPLACE: "azure",
      ENTERPRISE_MARKETPLACE_AZURE_RESOURCE_ID:
        "/subscriptions/0000/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/aks/providers/Microsoft.KubernetesConfiguration/extensions/oneuptime",
      ENTERPRISE_MARKETPLACE_AZURE_PLAN_ID: "enterprise",
      ENTERPRISE_MARKETPLACE_AZURE_CLIENT_ID:
        "6f1d1e8c-1111-4a2b-9c3d-123456789abc",
    });

    await MarketplaceArea.init!();

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("billed through Microsoft Marketplace"),
    );
  });

  it("stays quiet on OneUptime Cloud", async () => {
    setTestBillingEnabled(true);
    setMarketplaceEnv({ ENTERPRISE_MARKETPLACE: "aws" });

    await MarketplaceArea.init!();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe("MarketplaceArea.registerWorkerJobs", () => {
  it("registers nothing on an installation that names no marketplace", async () => {
    const addJob: jest.SpiedFunction<typeof Queue.addJob> = jest
      .spyOn(Queue, "addJob")
      .mockResolvedValue(undefined as never);

    await MarketplaceArea.registerWorkerJobs!();

    expect(
      addJob.mock.calls.filter((call: Array<unknown>): boolean => {
        return call[1] === REPORT_MARKETPLACE_USAGE_JOB_NAME;
      }),
    ).toEqual([]);
  });

  it("registers the usage job every 15 minutes and at startup, on the worker queue", async () => {
    const addJob: jest.SpiedFunction<typeof Queue.addJob> = jest
      .spyOn(Queue, "addJob")
      .mockResolvedValue(undefined as never);
    setMarketplaceEnv({ ENTERPRISE_MARKETPLACE: "aws" });

    await MarketplaceArea.registerWorkerJobs!();

    expect(JobDictionary.has(REPORT_MARKETPLACE_USAGE_JOB_NAME)).toBe(true);
    expect(
      JobDictionary.getTimeoutInMs(REPORT_MARKETPLACE_USAGE_JOB_NAME),
    ).toBe(REPORT_MARKETPLACE_USAGE_TIMEOUT_IN_MS);
    expect(
      addJob.mock.calls.filter((call: Array<unknown>): boolean => {
        return call[1] === REPORT_MARKETPLACE_USAGE_JOB_NAME;
      }),
    ).toEqual([
      [
        QueueName.Worker,
        REPORT_MARKETPLACE_USAGE_JOB_NAME,
        REPORT_MARKETPLACE_USAGE_JOB_NAME,
        {},
        { scheduleAt: EVERY_FIFTEEN_MINUTE },
      ],
      [
        QueueName.Worker,
        REPORT_MARKETPLACE_USAGE_JOB_NAME,
        REPORT_MARKETPLACE_USAGE_JOB_NAME,
        {},
        {},
      ],
    ]);
  });
});
