import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * The AuditLogExport area of the enterprise module: the test routes it
 * hands core's API, and the every-minute job it registers through core's
 * real RunCron (only the Redis-backed Queue.addJob is replaced), so this
 * checks the real JobDictionary and the real schedule the queue workers see.
 *
 * The job's name is a contract with core's EnterpriseLoader, which gives a
 * placeholder to any enterprise job ee does not register.
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

import AuditLogExportArea from "../../../Server/AuditLogExport/Index";
import AuditLogExporter, {
  AUDIT_LOG_EXPORT_RUN_BUDGET_IN_MS,
} from "../../../Server/AuditLogExport/AuditLogExporter";
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

const JOB_NAME: string = "AuditLogExport:ExportAuditLogs";

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

describe("the AuditLogExport area", () => {
  test("is the assembled module's last area", () => {
    expect(ENTERPRISE_AREAS[ENTERPRISE_AREAS.length - 1]).toBe(
      AuditLogExportArea,
    );
    expect(AuditLogExportArea.name).toBe("AuditLogExport");
    expect(
      ENTERPRISE_AREAS.filter((area: EnterpriseArea): boolean => {
        return area.name === "AuditLogExport";
      }),
    ).toHaveLength(1);
  });

  test("hands core one router with the two test routes and nothing else", () => {
    const routers: Array<ExpressRouter> =
      AuditLogExportArea.getApiRouters?.() || [];

    expect(routers).toHaveLength(1);
    expect(routesOf(routers[0]!)).toEqual([
      "POST /audit-log-export/test",
      "POST /audit-log-export/instance/test",
    ]);
  });

  test("nothing is registered until core asks", () => {
    expect(JobDictionary.has(JOB_NAME)).toBe(false);
  });

  test("registerWorkerJobs registers the export job, with a timeout a minute past the run's budget", async () => {
    await AuditLogExportArea.registerWorkerJobs?.();

    expect(JobDictionary.has(JOB_NAME)).toBe(true);
    expect(JobDictionary.getTimeoutInMs(JOB_NAME)).toBe(
      AUDIT_LOG_EXPORT_RUN_BUDGET_IN_MS +
        OneUptimeDate.convertMinutesToMilliseconds(1),
    );
    expect(AUDIT_LOG_EXPORT_RUN_BUDGET_IN_MS).toBe(
      OneUptimeDate.convertMinutesToMilliseconds(4),
    );
  });

  test("it is scheduled every minute on the worker queue, and not run on startup", () => {
    const calls: Array<Array<unknown>> = addJobSpy.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return call[1] === JOB_NAME;
      },
    );

    expect(calls).toEqual([
      [QueueName.Worker, JOB_NAME, JOB_NAME, {}, { scheduleAt: EVERY_MINUTE }],
    ]);
  });

  test("asking again does not schedule it twice", async () => {
    const before: number = addJobSpy.mock.calls.length;

    await AuditLogExportArea.registerWorkerJobs?.();

    expect(addJobSpy.mock.calls.length).toBe(before);
  });

  test("a run exports every export, and a failed run is logged rather than thrown", async () => {
    const exportAll: jest.SpyInstance = jest
      .spyOn(AuditLogExporter.prototype, "exportAll")
      .mockResolvedValueOnce({ exports: [] } as never)
      .mockRejectedValueOnce(new Error("Postgres is down") as never);
    const logged: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    await JobDictionary.getJobFunction(JOB_NAME)();

    expect(exportAll).toHaveBeenCalledTimes(1);
    expect(logged).not.toHaveBeenCalled();

    await expect(JobDictionary.getJobFunction(JOB_NAME)()).resolves.toBe(
      undefined,
    );

    expect(exportAll).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledWith(`${JOB_NAME}: the run failed:`);
  });

  test("its name is an enterprise-owned name core keeps a placeholder for, and the placeholder pass leaves it alone", () => {
    expect(ENTERPRISE_OWNED_JOB_NAMES).toContain(JOB_NAME);
    expect(EnterpriseLoader.registerMissingJobPlaceholders()).not.toContain(
      JOB_NAME,
    );
  });
});
