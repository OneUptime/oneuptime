import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";

/*
 * AuditLogService caches each project's audit settings (enabled, retention,
 * system events, plan) for a minute. Nothing ever invalidated that cache, so
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
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import UserType from "../../../Types/UserType";

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
});

afterEach(() => {
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

  test("the next audit write in this process reads the new setting", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const project: Project = new Project();
    project._id = projectId.toString();
    project.enableAuditLogs = true;

    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project as never);
    jest.spyOn(AuditLogService, "create").mockResolvedValue(undefined as never);

    const monitor: Monitor = new Monitor();
    monitor._id = ObjectID.generate().toString();
    monitor.name = "Checkout API";

    type RecordFunction = () => Promise<void>;

    const recordMonitorCreate: RecordFunction = async (): Promise<void> => {
      await AuditLogService.recordCreate({
        model: new Monitor(),
        createdItem: monitor,
        // An API-key actor needs no user lookup.
        props: { tenantId: projectId, userType: UserType.API },
      });
    };

    await recordMonitorCreate();
    await recordMonitorCreate();

    // Cached: the second write did not read the project again.
    expect(findProject).toHaveBeenCalledTimes(1);

    await updateProject({ enableAuditLogs: false }, [projectId]);
    await recordMonitorCreate();

    expect(findProject).toHaveBeenCalledTimes(2);
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
