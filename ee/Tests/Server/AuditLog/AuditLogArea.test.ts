import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import AuditLogArea, {
  getAuditLogRecorder,
} from "../../../Server/AuditLog/Index";
import AuditLogRecorder from "../../../Server/AuditLog/AuditLogRecorder";
import EnterpriseModule from "../../../Server/Index";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import type { AuditLogRecorder as AuditLogRecorderContract } from "Common/Server/Enterprise/EnterpriseServerModule";
import CoreAuditLogService from "Common/Server/Services/AuditLogService";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { ENTERPRISE_OWNED_JOB_NAMES } from "App/Utils/EnterpriseLoader";

/*
 * The AuditLog area of the enterprise module: what it hands core, and that
 * core's AuditLogService reaches it.
 *
 * Billing and the edition are pinned (CI's config.env sets
 * BILLING_ENABLED=true). RunCron is captured, so loading the assembled module
 * never reaches Redis from this test.
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

jest.mock("App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("the AuditLog area", () => {
  test("hands over a real recorder, not null: the Enterprise Edition records audit logs", () => {
    const recorder: AuditLogRecorderContract | null = getAuditLogRecorder();

    expect(recorder).toBeInstanceOf(AuditLogRecorder);
  });

  test("hands over ONE recorder per process, so every caller shares its caches", () => {
    expect(getAuditLogRecorder()).toBe(getAuditLogRecorder());
  });

  test("the assembled enterprise module hands core that same recorder", () => {
    expect(EnterpriseModule.getAuditLogRecorder()).toBe(getAuditLogRecorder());
  });

  test("the recorder implements every entry point core delegates to", () => {
    const recorder: AuditLogRecorderContract = getAuditLogRecorder()!;

    expect(typeof recorder.recordCreate).toBe("function");
    expect(typeof recorder.recordUpdate).toBe("function");
    expect(typeof recorder.recordDelete).toBe("function");
    expect(typeof recorder.recordDownload).toBe("function");
    expect(typeof recorder.recordSessionEvents).toBe("function");
    expect(typeof recorder.invalidateProjectSettings).toBe("function");
  });

  test("contributes no routers", () => {
    expect(AuditLogArea.name).toBe("AuditLog");
    expect(AuditLogArea.getIdentityRouters).toBeUndefined();
    expect(AuditLogArea.getApiRouters).toBeUndefined();
  });

  /*
   * Its one worker job ends the sessions that ran out, so their timeouts
   * reach the audit log within minutes (issue #6762). RunCron is captured
   * above, so loading it registers nothing in Redis.
   */
  test("registers the job that ends sessions that ran out, every five minutes", async () => {
    const cron: jest.Mock = (
      jest.requireMock("App/FeatureSet/Workers/Utils/Cron") as {
        default: jest.Mock;
      }
    ).default;

    await AuditLogArea.registerWorkerJobs?.();

    const call: Array<unknown> | undefined = cron.mock.calls.find(
      (args: Array<unknown>): boolean => {
        return args[0] === "AuditLog:EndSessionsThatRanOut";
      },
    );

    expect(call).toBeDefined();
    expect(call![1]).toEqual(
      expect.objectContaining({
        schedule: EVERY_FIVE_MINUTE,
        runOnStartup: false,
      }),
    );
    expect(ENTERPRISE_OWNED_JOB_NAMES).toContain(
      "AuditLog:EndSessionsThatRanOut",
    );
  });
});

describe("core's AuditLogService reaches the area's recorder", () => {
  test("once the enterprise module is registered, a core record call arrives at this recorder", async () => {
    const recorder: AuditLogRecorderContract = getAuditLogRecorder()!;
    const recordCreate: jest.SpyInstance = jest
      .spyOn(recorder, "recordCreate")
      .mockImplementation((() => {
        return Promise.resolve();
      }) as never);

    installFakeEnterpriseModule({ auditLogRecorder: recorder });

    const data: {
      model: Monitor;
      createdItem: Monitor;
      props: { tenantId: ObjectID; userType: UserType };
    } = {
      model: new Monitor(),
      createdItem: new Monitor(),
      props: { tenantId: ObjectID.generate(), userType: UserType.API },
    };

    await CoreAuditLogService.recordCreate(data);

    expect(EnterpriseEdition.getAuditLogRecorder()).toBe(recorder);
    expect(recordCreate).toHaveBeenCalledTimes(1);
    expect(recordCreate.mock.calls[0]![0]).toBe(data);
  });

  test("before registration (the Community Edition) the same call reaches nothing", async () => {
    const recorder: AuditLogRecorderContract = getAuditLogRecorder()!;
    const recordCreate: jest.SpyInstance = jest.spyOn(recorder, "recordCreate");

    await CoreAuditLogService.recordCreate({
      model: new Monitor(),
      createdItem: new Monitor(),
      props: { tenantId: ObjectID.generate(), userType: UserType.API },
    });

    expect(recordCreate).not.toHaveBeenCalled();
  });
});
