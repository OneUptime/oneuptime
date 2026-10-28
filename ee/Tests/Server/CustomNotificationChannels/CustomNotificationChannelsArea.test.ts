import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * The CustomNotificationChannels area of the enterprise module
 * (ee/Server/CustomNotificationChannels/Index.ts): the router it hands core's
 * API - the send route core posts every request for a channel to - and the
 * every-five-minutes job that adds a channel paging everyone to everybody's
 * on-call rules, registered through core's real RunCron (only the
 * Redis-backed Queue.addJob and the Valkey lock are replaced), so this
 * checks the real JobDictionary and the schedule the queue workers see.
 *
 * The job's name is the one core enqueues it by the moment a channel starts
 * paging everyone (CustomNotificationChannelService): core never imports
 * ee/, so the name is the contract.
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

import CustomNotificationChannelsArea from "../../../Server/CustomNotificationChannels/Index";
import CustomChannelSendAPI from "../../../Server/CustomNotificationChannels/API/CustomChannelSendAPI";
import AddCustomChannelToEveryonesRules from "../../../Server/CustomNotificationChannels/AddCustomChannelToEveryonesRules";
import { ENTERPRISE_AREAS } from "../../../Server/Index";
import EnterpriseArea from "../../../Server/Types/EnterpriseArea";
import JobDictionary from "App/FeatureSet/Workers/Utils/JobDictionary";
import EnterpriseLoader, {
  ENTERPRISE_OWNED_JOB_NAMES,
} from "App/Utils/EnterpriseLoader";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import CustomNotificationChannelService, {
  ADD_CUSTOM_CHANNEL_TO_EVERYONES_RULES_JOB_NAME,
} from "Common/Server/Services/CustomNotificationChannelService";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import fs from "fs";
import path from "path";

const JOB_NAME: string = "OnCallDutyPolicy:AddCustomChannelToEveryonesRules";

const APP_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "App",
);

let addJobSpy: { mock: { calls: Array<Array<unknown>> } };

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

function routesOf(router: ExpressRouter): Array<string> {
  return (router as unknown as { stack: Array<RouteLayer> }).stack
    .filter((layer: RouteLayer): boolean => {
      return Boolean(layer.route);
    })
    .map((layer: RouteLayer): string => {
      return `${Object.keys(layer.route!.methods).join(",").toUpperCase()} ${layer.route!.path}`;
    });
}

// A lock as Semaphore.lock hands it out; only release() is ever called on it.
const MUTEX: SemaphoreMutex = {
  release: async (): Promise<void> => {
    return undefined;
  },
} as unknown as SemaphoreMutex;

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
  uninstallEnterpriseModule();
  jest.restoreAllMocks();
});

describe("the CustomNotificationChannels area", () => {
  test("is in the assembled module once, right after Backup, with OneUptime Cloud's billing areas still last", () => {
    const names: Array<string> = ENTERPRISE_AREAS.map(
      (area: EnterpriseArea): string => {
        return area.name;
      },
    );

    expect(CustomNotificationChannelsArea.name).toBe(
      "CustomNotificationChannels",
    );
    expect(
      ENTERPRISE_AREAS.filter((area: EnterpriseArea): boolean => {
        return area === CustomNotificationChannelsArea;
      }),
    ).toHaveLength(1);
    expect(names.indexOf("CustomNotificationChannels")).toBe(
      names.indexOf("Backup") + 1,
    );
    expect(names.slice(-2)).toEqual(["Billing", "CloudMarketplace"]);
  });

  test("adds an API router and worker jobs, and nothing else: no boot step, no identity routes", () => {
    expect(Object.keys(CustomNotificationChannelsArea).sort()).toEqual(
      ["getApiRouters", "name", "registerWorkerJobs"].sort(),
    );
  });

  test("hands core one router, with the send route and nothing else", () => {
    const routers: Array<ExpressRouter> =
      CustomNotificationChannelsArea.getApiRouters?.() || [];

    expect(routers).toEqual([CustomChannelSendAPI]);
    expect(routesOf(routers[0]!)).toEqual([
      "POST /notification/custom-channel/send",
    ]);
  });

  test("the router is the same with billing on: OneUptime Cloud sends to custom channels too", () => {
    setTestBillingEnabled(true);

    try {
      expect(CustomNotificationChannelsArea.getApiRouters?.()).toEqual([
        CustomChannelSendAPI,
      ]);
    } finally {
      setTestBillingEnabled(false);
    }
  });
});

describe("the job", () => {
  test("its name is the one core enqueues it by", () => {
    expect(ADD_CUSTOM_CHANNEL_TO_EVERYONES_RULES_JOB_NAME).toBe(JOB_NAME);
  });

  test("core no longer registers it: the Community Edition's workers have no such job", () => {
    const workers: string = fs.readFileSync(
      path.join(APP_DIR, "FeatureSet", "Workers", "Index.ts"),
      "utf8",
    );

    expect(workers).not.toContain("AddCustomChannelToEveryonesRules");
    expect(
      fs.existsSync(
        path.join(
          APP_DIR,
          "FeatureSet",
          "Workers",
          "Jobs",
          "OnCallDutyPolicy",
          "AddCustomChannelToEveryonesRules.ts",
        ),
      ),
    ).toBe(false);
  });

  test("nothing is registered until core asks", () => {
    expect(JobDictionary.has(JOB_NAME)).toBe(false);
  });

  test("registerWorkerJobs registers it, with the workers' default timeout", async () => {
    await CustomNotificationChannelsArea.registerWorkerJobs?.();

    expect(JobDictionary.has(JOB_NAME)).toBe(true);
    expect(JobDictionary.getTimeoutInMs(JOB_NAME)).toBe(
      OneUptimeDate.convertMinutesToMilliseconds(5),
    );
  });

  test("it is scheduled every five minutes on the worker queue, and not run on startup: core's enqueue runs it within seconds", () => {
    const calls: Array<Array<unknown>> = addJobSpy.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return call[1] === JOB_NAME;
      },
    );

    expect(calls).toEqual([
      [
        QueueName.Worker,
        JOB_NAME,
        JOB_NAME,
        {},
        { scheduleAt: EVERY_FIVE_MINUTE },
      ],
    ]);
  });

  test("asking again does not schedule it twice", async () => {
    const before: number = addJobSpy.mock.calls.length;

    await CustomNotificationChannelsArea.registerWorkerJobs?.();

    expect(addJobSpy.mock.calls.length).toBe(before);
  });

  test("its name is an enterprise-owned name core keeps a placeholder for, and the placeholder pass leaves it alone", () => {
    expect(ENTERPRISE_OWNED_JOB_NAMES).toContain(JOB_NAME);
    expect(EnterpriseLoader.registerMissingJobPlaceholders()).not.toContain(
      JOB_NAME,
    );
  });
});

describe("a run of the job", () => {
  let lock: jest.SpyInstance;
  let release: jest.SpyInstance;
  let run: jest.SpyInstance;

  beforeAll(async () => {
    await CustomNotificationChannelsArea.registerWorkerJobs?.();
  });

  const runJob: () => Promise<void> = async (): Promise<void> => {
    await JobDictionary.getJobFunction(JOB_NAME)();
  };

  const spyOnTheRun: () => void = (): void => {
    lock = jest.spyOn(Semaphore, "lock").mockResolvedValue(MUTEX);
    release = jest
      .spyOn(Semaphore, "release")
      .mockResolvedValue(undefined as never);
    run = jest
      .spyOn(AddCustomChannelToEveryonesRules, "run")
      .mockResolvedValue(2);
  };

  const restore: () => void = (): void => {
    lock.mockRestore();
    release.mockRestore();
    run.mockRestore();
  };

  test("takes the workers' lock under its own name, runs once, and gives the lock back", async () => {
    spyOnTheRun();

    try {
      await runJob();

      expect(lock).toHaveBeenCalledWith({
        key: JOB_NAME,
        namespace: "Workers.Cron",
        lockTimeout: OneUptimeDate.convertMinutesToMilliseconds(6),
        acquireAttemptsLimit: 1,
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledWith(MUTEX);
      expect(lock.mock.invocationCallOrder[0]!).toBeLessThan(
        run.mock.invocationCallOrder[0]!,
      );
      expect(run.mock.invocationCallOrder[0]!).toBeLessThan(
        release.mock.invocationCallOrder[0]!,
      );
      expect(logger.debug).toHaveBeenCalledWith(
        `${JOB_NAME}: added 2 custom channel(s) to everyone's on-call rules`,
        { service: "workers" },
      );
    } finally {
      restore();
    }
  });

  test("a run with nothing to do says nothing", async () => {
    spyOnTheRun();
    run.mockResolvedValue(0);
    (logger.debug as unknown as jest.Mock).mockClear();

    try {
      await runJob();

      expect(logger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining("added"),
        expect.anything(),
      );
      expect(release).toHaveBeenCalledWith(MUTEX);
    } finally {
      restore();
    }
  });

  test("a run already in flight (the lock is taken): skipped, with nothing run and nothing released", async () => {
    spyOnTheRun();
    lock.mockRejectedValue(new Error("lock is held"));

    try {
      await expect(runJob()).resolves.toBeUndefined();

      expect(run).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("a run that fails still gives the lock back, and the worker hears of the failure", async () => {
    spyOnTheRun();
    run.mockRejectedValue(new Error("Postgres is down"));

    try {
      await expect(runJob()).rejects.toThrow("Postgres is down");

      expect(release).toHaveBeenCalledWith(MUTEX);
    } finally {
      restore();
    }
  });

  test("a lock that cannot be given back is logged, and expires on its own", async () => {
    spyOnTheRun();
    release.mockRejectedValue(new Error("Valkey went away"));
    const logged: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    try {
      await expect(runJob()).resolves.toBeUndefined();

      expect(logged).toHaveBeenCalledWith(
        `${JOB_NAME}: error releasing the lock: Error: Valkey went away`,
      );
    } finally {
      restore();
      logged.mockRestore();
    }
  });

  test("while custom channels are not active, a run reads nothing at all", async () => {
    lock = jest.spyOn(Semaphore, "lock").mockResolvedValue(MUTEX);
    release = jest
      .spyOn(Semaphore, "release")
      .mockResolvedValue(undefined as never);
    run = jest.spyOn(AddCustomChannelToEveryonesRules, "run");
    const findChannels: jest.SpyInstance = jest
      .spyOn(CustomNotificationChannelService, "findBy")
      .mockResolvedValue([]);

    try {
      uninstallEnterpriseModule();

      await runJob();

      expect(run).toHaveBeenCalledTimes(1);
      await expect(run.mock.results[0]!.value).resolves.toBe(0);
      expect(findChannels).not.toHaveBeenCalled();

      // With a license that includes them, the same run reads its work.
      installFakeEnterpriseModule();

      await runJob();

      expect(findChannels).toHaveBeenCalledTimes(1);
    } finally {
      restore();
      findChannels.mockRestore();
      uninstallEnterpriseModule();
    }
  });
});
