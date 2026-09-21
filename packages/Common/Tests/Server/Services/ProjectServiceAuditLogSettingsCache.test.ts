import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";

/*
 * The audit-log recorder (Enterprise Edition, behind core's AuditLogService)
 * caches each project's audit settings (enabled, retention, system events,
 * plan) for a minute. Nothing ever invalidated that cache, so
 * for up to a minute after an admin turned audit logging on, the process that
 * saved the setting went on recording nothing - exactly when someone is
 * watching the empty audit page to check that it works. ProjectService now
 * drops the entry when one of those columns changes.
 *
 * The session replay gate store is stubbed: a Project model instance carries
 * every column as an own property, so its unrelated session replay branch
 * runs too, and that branch talks to Redis.
 */

const markProjectDisabledMock: jest.Mock = jest.fn();
const clearProjectDisabledMock: jest.Mock = jest.fn();
const clearCacheMock: jest.Mock = jest.fn();

jest.mock(
  "../../../Server/Utils/SessionReplay/SessionReplayGateCacheStore",
  () => {
    return {
      __esModule: true,
      default: {
        markProjectDisabled: markProjectDisabledMock,
        clearProjectDisabled: clearProjectDisabledMock,
        clearCache: clearCacheMock,
      },
    };
  },
);

import AuditLogService from "../../../Server/Services/AuditLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import {
  createAuditLogRecorderSpy,
  installFakeEnterpriseModule,
  MockedAuditLogRecorder,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";

type HookCallable = {
  onUpdateSuccess: (
    onUpdate: unknown,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<unknown>;
};

const hooks: HookCallable = ProjectService as unknown as HookCallable;

type UpdateProjectFunction = (
  data: unknown,
  updatedItemIds: Array<ObjectID>,
) => Promise<void>;

const updateProject: UpdateProjectFunction = async (
  data: unknown,
  updatedItemIds: Array<ObjectID>,
): Promise<void> => {
  await hooks.onUpdateSuccess(
    { updateBy: { data, props: { isRoot: true } } },
    updatedItemIds,
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  uninstallEnterpriseModule();
});

afterEach(() => {
  uninstallEnterpriseModule();
  jest.restoreAllMocks();
});

describe("ProjectService invalidates the audit log settings cache", () => {
  test.each([
    ["enableAuditLogs", true],
    ["enableAuditLogs", false],
    ["storeSystemEventsInAuditLogs", true],
    ["auditLogsRetentionInDays", 90],
    ["planName", PlanType.Enterprise],
  ])(
    "changing %s (to %p) drops every updated project's entry",
    async (column: string, value: unknown) => {
      const invalidate: jest.SpyInstance = jest.spyOn(
        AuditLogService,
        "invalidateProjectSettings",
      );

      const projectIds: Array<ObjectID> = [
        ObjectID.generate(),
        ObjectID.generate(),
      ];

      await updateProject({ [column]: value }, projectIds);

      expect(invalidate).toHaveBeenCalledTimes(2);
      expect(invalidate).toHaveBeenNthCalledWith(1, projectIds[0]);
      expect(invalidate).toHaveBeenNthCalledWith(2, projectIds[1]);
    },
  );

  test("an unrelated change leaves the cache alone", async () => {
    const invalidate: jest.SpyInstance = jest.spyOn(
      AuditLogService,
      "invalidateProjectSettings",
    );

    await updateProject({ name: "Renamed project" }, [ObjectID.generate()]);

    expect(invalidate).not.toHaveBeenCalled();
  });

  test("a Project instance counts only the columns it actually sets", async () => {
    /*
     * Every column is an own property of a model instance, so a check with
     * `in` would see "enableAuditLogs" on a rename.
     */
    const invalidate: jest.SpyInstance = jest.spyOn(
      AuditLogService,
      "invalidateProjectSettings",
    );

    const rename: Project = new Project();
    rename.name = "Renamed project";

    expect("enableAuditLogs" in rename).toBe(true);

    await updateProject(rename, [ObjectID.generate()]);
    expect(invalidate).not.toHaveBeenCalled();

    const enable: Project = new Project();
    enable.enableAuditLogs = true;

    await updateProject(enable, [ObjectID.generate()]);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  /*
   * The cache itself lives in the Enterprise audit-log recorder (ee/), so
   * "the next write reads the new setting" is pinned there, end to end
   * (ee/Tests/Server/AuditLog/AuditLogSettingsInvalidation.test.ts). What
   * core owns is that the invalidation reaches whichever recorder is
   * registered, and is harmless when none is.
   */
  test("the invalidation reaches the Enterprise audit-log recorder", async () => {
    const recorder: MockedAuditLogRecorder = createAuditLogRecorderSpy();
    installFakeEnterpriseModule({ auditLogRecorder: recorder });

    const projectId: ObjectID = ObjectID.generate();

    await updateProject({ enableAuditLogs: false }, [projectId]);

    expect(recorder.invalidateProjectSettings).toHaveBeenCalledTimes(1);
    expect(recorder.invalidateProjectSettings).toHaveBeenCalledWith(projectId);
  });

  test("on the Community Edition there is no cache to drop, and the update still succeeds", async () => {
    uninstallEnterpriseModule();

    await expect(
      updateProject({ enableAuditLogs: true }, [ObjectID.generate()]),
    ).resolves.toBeUndefined();
  });

  test("a failure to invalidate never fails the project update", async () => {
    jest
      .spyOn(AuditLogService, "invalidateProjectSettings")
      .mockImplementation(() => {
        throw new Error("cache unavailable");
      });

    await expect(
      updateProject({ enableAuditLogs: true }, [ObjectID.generate()]),
    ).resolves.toBeUndefined();
  });
});
