import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * The Backup area of the enterprise module: the routes it hands core's
 * API, and the every-minute job it registers through core's real RunCron
 * (only the Redis-backed Queue.addJob is replaced) - so this checks the
 * real JobDictionary and the schedule the queue workers see.
 *
 * The job's name is a contract with core's EnterpriseLoader, which gives a
 * placeholder to any enterprise job ee does not register: it never changes.
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

import BackupArea from "../../../Server/Backup/Index";
import { backupScheduler } from "../../../Server/Backup/BackupScheduler";
import { ENTERPRISE_AREAS } from "../../../Server/Index";
import EnterpriseArea from "../../../Server/Types/EnterpriseArea";
import JobDictionary from "App/FeatureSet/Workers/Utils/JobDictionary";
import EnterpriseLoader, {
  ENTERPRISE_OWNED_JOB_NAMES,
} from "App/Utils/EnterpriseLoader";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

const JOB_NAME: string = "Backup:RunBackups";

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

describe("the Backup area", () => {
  test("is in the assembled module once, right after the audit log export, with OneUptime Cloud's billing areas still last", () => {
    const names: Array<string> = ENTERPRISE_AREAS.map(
      (area: EnterpriseArea): string => {
        return area.name;
      },
    );

    expect(BackupArea.name).toBe("Backup");
    expect(
      ENTERPRISE_AREAS.filter((area: EnterpriseArea): boolean => {
        return area === BackupArea;
      }),
    ).toHaveLength(1);
    expect(names.indexOf("Backup")).toBe(names.indexOf("AuditLogExport") + 1);
    expect(names.slice(-2)).toEqual(["Billing", "CloudMarketplace"]);
  });

  test("hands core one router with the Backups page's routes", () => {
    const routers: Array<ExpressRouter> = BackupArea.getApiRouters?.() || [];

    expect(routers).toHaveLength(1);
    expect(routesOf(routers[0]!)).toEqual([
      "POST /backup/test",
      "GET /backup/overview",
      "POST /backup/run-now",
      "POST /backup/restore-preview",
      "POST /backup/restore",
      "POST /backup/cancel",
      "POST /backup/delete",
      "POST /backup/find",
    ]);
  });

  test("nothing is registered until core asks", () => {
    expect(JobDictionary.has(JOB_NAME)).toBe(false);
  });

  test("registerWorkerJobs registers the tick, with a timeout under the minute's next tick", async () => {
    await BackupArea.registerWorkerJobs?.();

    expect(JobDictionary.has(JOB_NAME)).toBe(true);
    expect(JobDictionary.getTimeoutInMs(JOB_NAME)).toBe(
      OneUptimeDate.convertMinutesToMilliseconds(4),
    );
  });

  test("it is scheduled every minute on the worker queue, and run once at startup, so a stopped run is cleaned up soon after a restart", () => {
    const calls: Array<Array<unknown>> = addJobSpy.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return call[1] === JOB_NAME;
      },
    );

    expect(calls).toEqual([
      [QueueName.Worker, JOB_NAME, JOB_NAME, {}, { scheduleAt: EVERY_MINUTE }],
      [QueueName.Worker, JOB_NAME, JOB_NAME, {}, {}],
    ]);
  });

  test("a tick that fails is logged rather than thrown", async () => {
    const tick: jest.SpiedFunction<typeof backupScheduler.tick> = jest
      .spyOn(backupScheduler, "tick")
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async (): Promise<void> => {
        throw new Error("Postgres is down");
      });
    const logged: jest.SpiedFunction<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    await JobDictionary.getJobFunction(JOB_NAME)();
    expect(logged).not.toHaveBeenCalled();

    await expect(JobDictionary.getJobFunction(JOB_NAME)()).resolves.toBe(
      undefined,
    );

    expect(tick).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledWith(`${JOB_NAME}: the tick failed:`);
  });

  test("its name is an enterprise-owned name core keeps a placeholder for, and the placeholder pass leaves it alone", () => {
    expect(ENTERPRISE_OWNED_JOB_NAMES).toContain(JOB_NAME);
    expect(EnterpriseLoader.registerMissingJobPlaceholders()).not.toContain(
      JOB_NAME,
    );
  });
});
