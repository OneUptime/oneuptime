import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import CoreAuditLogService from "Common/Server/Services/AuditLogService";
import ProjectService from "Common/Server/Services/ProjectService";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * The recorder caches each project's audit settings (enabled, retention,
 * system events, plan) for a minute. Nothing ever invalidated that cache, so
 * for up to a minute after an admin turned audit logging on, the process that
 * saved the setting went on recording nothing - exactly when someone is
 * watching the empty audit page to check that it works. ProjectService drops
 * the entry when one of those columns changes.
 *
 * The cache moved to ee/ with the recorder; ProjectService (core) still calls
 * core's AuditLogService.invalidateProjectSettings, which delegates to the
 * registered recorder. This pins the whole path end to end: a real
 * ProjectService update hook, core's real delegate, the real recorder.
 *
 * The session replay gate store is stubbed: a Project model instance carries
 * every column as an own property, so its unrelated session replay branch
 * runs too, and that branch talks to Redis.
 */

jest.mock("Common/Server/Utils/SessionReplay/SessionReplayGateCacheStore", () => {
  return {
    __esModule: true,
    default: {
      markProjectDisabled: jest.fn(),
      clearProjectDisabled: jest.fn(),
      clearCache: jest.fn(),
    },
  };
});

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

let insert: jest.Mock;
let recorder: AuditLogRecorder;
let projectId: ObjectID;
let project: Project;
let findProject: jest.SpyInstance;

type RecordFunction = () => Promise<void>;

const recordMonitorCreate: RecordFunction = async (): Promise<void> => {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.name = "Checkout API";

  // Through core, exactly as DatabaseService records a create.
  await CoreAuditLogService.recordCreate({
    model: new Monitor(),
    createdItem: monitor,
    // An API-key actor needs no user lookup.
    props: { tenantId: projectId, userType: UserType.API },
  });
};

beforeEach(() => {
  setTestBillingEnabled(false);

  insert = jest.fn(() => {
    return Promise.resolve(undefined);
  });
  recorder = new AuditLogRecorder({
    store: { create: insert } as unknown as AuditLogStore,
  });
  installFakeEnterpriseModule({ auditLogRecorder: recorder });

  projectId = ObjectID.generate();
  project = new Project();
  project._id = projectId.toString();
  project.enableAuditLogs = true;

  findProject = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation((() => {
      return Promise.resolve(project);
    }) as never);
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a project's audit settings change reaches the recorder's cache", () => {
  test("the next audit write in this process reads the new setting", async () => {
    await recordMonitorCreate();
    await recordMonitorCreate();

    // Cached: the second write did not read the project again.
    expect(findProject).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(2);

    project = new Project();
    project._id = projectId.toString();
    project.enableAuditLogs = false;

    await updateProject({ enableAuditLogs: false }, [projectId]);
    await recordMonitorCreate();

    expect(findProject).toHaveBeenCalledTimes(2);
    // Logging is off now: the third write recorded nothing.
    expect(insert).toHaveBeenCalledTimes(2);
  });

  test("turning audit logging ON takes effect on the very next write", async () => {
    project.enableAuditLogs = false;

    await recordMonitorCreate();
    expect(insert).not.toHaveBeenCalled();

    project = new Project();
    project._id = projectId.toString();
    project.enableAuditLogs = true;

    await updateProject({ enableAuditLogs: true }, [projectId]);
    await recordMonitorCreate();

    expect(insert).toHaveBeenCalledTimes(1);
  });

  test("an unrelated project change leaves the cache alone", async () => {
    await recordMonitorCreate();
    await updateProject({ name: "Renamed project" }, [projectId]);
    await recordMonitorCreate();

    expect(findProject).toHaveBeenCalledTimes(1);
  });

  test("another project's change leaves this project's entry alone", async () => {
    await recordMonitorCreate();
    await updateProject({ enableAuditLogs: false }, [ObjectID.generate()]);
    await recordMonitorCreate();

    expect(findProject).toHaveBeenCalledTimes(1);
  });
});
