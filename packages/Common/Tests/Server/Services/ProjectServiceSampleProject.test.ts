type MockBillingGlobal = typeof globalThis & {
  __sampleProjectTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__sampleProjectTestBillingEnabled = true;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__sampleProjectTestBillingEnabled;
    },
  });

  return mocked;
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import BillingService from "../../../Server/Services/BillingService";
import DeletedProjectService from "../../../Server/Services/DeletedProjectService";
import ProjectService, {
  ProjectService as ProjectServiceClass,
  SAMPLE_PROJECT_PLAN,
} from "../../../Server/Services/ProjectService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import SampleProjectAnalyticsData from "../../../Server/Utils/SampleProject/SampleProjectAnalyticsData";
import SsoRequirementChanges from "../../../Server/Utils/SsoRequirementChanges";
import Project from "../../../Models/DatabaseModels/Project";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SAMPLE PROJECT, AS PROJECTSERVICE SEES IT (issue #6808).
 *
 *   - isSampleProject answers from a per-server cache: the flag never
 *     changes, a burst shares one read, and a project not found is not kept;
 *   - its plan is the top plan and never unpaid, with no plan id at all;
 *   - making one (as root, with the flag) needs no plan, and creates no
 *     payment customer or subscription, no server/project_created and no
 *     operator message; anyone else who sends the flag makes an ordinary,
 *     billed project;
 *   - deleting one deletes its analytics rows, and writes no deleted-project
 *     record and no operator message;
 *   - the monitoring paths leave it out.
 *
 * No database: findOneById and the other services are jest.spyOn stubs, and
 * the protected hooks are reached through a structural cast.
 * ---------------------------------------------------------------------------
 */

const SAMPLE_ID: ObjectID = new ObjectID(
  "5a3c0000-0000-4000-8000-000000000001",
);
const REAL_ID: ObjectID = new ObjectID("5a3c0000-0000-4000-8000-000000000002");
const USER_ID: ObjectID = new ObjectID("5a3c0000-0000-4000-8000-0000000000aa");

interface ProjectServiceInternals {
  onBeforeCreate: (createBy: CreateBy<Project>) => Promise<OnCreate<Project>>;
  onCreateSuccess: (
    onCreate: OnCreate<Project>,
    createdItem: Project,
  ) => Promise<Project>;
  onDeleteSuccess: (
    onDelete: OnDelete<Project>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<Project>>;
  sampleProjectCache: { clear: () => void };
}

const internals: () => ProjectServiceInternals =
  (): ProjectServiceInternals => {
    return ProjectService as unknown as ProjectServiceInternals;
  };

const projectRow: (data: Partial<Project>) => Project = (
  data: Partial<Project>,
): Project => {
  const project: Project = new Project();
  Object.assign(project, data);
  return project;
};

const setBilling: (isOn: boolean) => void = (isOn: boolean): void => {
  (globalThis as MockBillingGlobal).__sampleProjectTestBillingEnabled = isOn;
};

beforeEach(() => {
  setBilling(true);
  internals().sampleProjectCache.clear();
  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  ProjectService.forgetCurrentPlan(SAMPLE_ID);
  ProjectService.forgetCurrentPlan(REAL_ID);
});

describe("isSampleProject", () => {
  test("answers from the flag, and keeps the answer", async () => {
    const findOneById: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(
        projectRow({
          _id: SAMPLE_ID.toString(),
          isSampleProject: true,
        }) as never,
      );

    await expect(ProjectService.isSampleProject(SAMPLE_ID)).resolves.toBe(true);
    await expect(
      ProjectService.isSampleProject(SAMPLE_ID.toString().toUpperCase()),
    ).resolves.toBe(true);

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { isSampleProject: true },
        props: { isRoot: true, ignoreHooks: true },
      }),
    );
  });

  test("a project that is not a sample is not one, and that is kept too", async () => {
    const findOneById: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectRow({ isSampleProject: false }) as never);

    await expect(ProjectService.isSampleProject(REAL_ID)).resolves.toBe(false);
    await expect(ProjectService.isSampleProject(REAL_ID)).resolves.toBe(false);

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("a burst of callers shares one read", async () => {
    let resolveRead!: (project: Project) => void;
    const findOneById: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockReturnValue(
        new Promise<Project>((resolve: (project: Project) => void) => {
          resolveRead = resolve;
        }) as never,
      );

    const answers: Promise<Array<boolean>> = Promise.all([
      ProjectService.isSampleProject(SAMPLE_ID),
      ProjectService.isSampleProject(SAMPLE_ID),
      ProjectService.isSampleProject(SAMPLE_ID),
    ]);

    resolveRead(projectRow({ isSampleProject: true }));

    await expect(answers).resolves.toEqual([true, true, true]);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("a project not found is not a sample, and is asked again next time", async () => {
    const findOneById: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(null as never);

    await expect(ProjectService.isSampleProject(SAMPLE_ID)).resolves.toBe(
      false,
    );
    await expect(ProjectService.isSampleProject(SAMPLE_ID)).resolves.toBe(
      false,
    );

    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  test("with no database, no project is a sample and nothing is read", async () => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);
    const findOneById: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );

    await expect(ProjectService.isSampleProject(SAMPLE_ID)).resolves.toBe(
      false,
    );
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("a read that fails throws, for each caller to decide", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("database unavailable"));

    await expect(ProjectService.isSampleProject(SAMPLE_ID)).rejects.toThrow(
      "database unavailable",
    );
  });
});

describe("getCurrentPlan of a sample project", () => {
  test("is the top plan and never unpaid, with no plan id", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectRow({ isSampleProject: true }) as never);

    await expect(ProjectService.getCurrentPlan(SAMPLE_ID)).resolves.toEqual({
      plan: SAMPLE_PROJECT_PLAN,
      isSubscriptionUnpaid: false,
    });
    expect(SAMPLE_PROJECT_PLAN).toBe(PlanType.Enterprise);
  });

  test("a real project with no plan is still refused", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectRow({ isSampleProject: false }) as never);

    await expect(ProjectService.getCurrentPlan(REAL_ID)).rejects.toThrow(
      "Project does not have any plans",
    );
  });
});

describe("making a sample project", () => {
  test("OneUptime (root) with the flag makes one", () => {
    expect(
      ProjectServiceClass.isSampleProjectCreate({
        data: projectRow({ isSampleProject: true }),
        props: { isRoot: true, userId: USER_ID },
      } as CreateBy<Project>),
    ).toBe(true);
  });

  test("anyone else who sends the flag makes an ordinary project", () => {
    expect(
      ProjectServiceClass.isSampleProjectCreate({
        data: projectRow({ isSampleProject: true }),
        props: { userId: USER_ID },
      } as CreateBy<Project>),
    ).toBe(false);
    expect(
      ProjectServiceClass.isSampleProjectCreate({
        data: projectRow({}),
        props: { isRoot: true, userId: USER_ID },
      } as CreateBy<Project>),
    ).toBe(false);
  });

  const stubDefaults: () => void = (): void => {
    for (const method of [
      "addDefaultIncidentSeverity",
      "addDefaultAlertSeverity",
      "addDefaultProjectTeams",
      "addDefaultMonitorStatus",
      "addDefaultIncidentState",
      "addDefaultIncidentPostmortemStatuses",
      "addDefaultScheduledMaintenanceState",
      "addDefaultAlertState",
      "addDefaultIncidentRoles",
      "addDefaultNetworkSiteTypes",
      "addDefaultNetworkDeviceRoles",
      "addDefaultSecurityCasePriorities",
      "addDefaultSecurityCaseStatuses",
    ]) {
      jest
        .spyOn(ProjectService as never, method as never)
        .mockResolvedValue(undefined as never);
    }

    jest
      .spyOn(SsoRequirementChanges, "afterProjectCreate")
      .mockResolvedValue(undefined as never);
  };

  test("with billing on, it gets no customer, no subscription, no event and no notice, but its defaults", async () => {
    stubDefaults();
    const createCustomer: jest.SpyInstance = jest.spyOn(
      BillingService,
      "createCustomer",
    );
    const subscribeToPlan: jest.SpyInstance = jest.spyOn(
      BillingService,
      "subscribeToPlan",
    );
    const capture: jest.SpyInstance = jest
      .spyOn(ProductAnalytics, "capture")
      .mockReturnValue(undefined as never);
    const findOneById: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );

    const created: Project = projectRow({
      _id: SAMPLE_ID.toString(),
      name: "Sample: Acme Shop",
      isSampleProject: true,
    });

    await internals().onCreateSuccess(
      {
        createBy: { data: created, props: { isRoot: true, userId: USER_ID } },
        carryForward: null,
      } as unknown as OnCreate<Project>,
      created,
    );

    expect(createCustomer).not.toHaveBeenCalled();
    expect(subscribeToPlan).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    // The operator's notice re-reads the project; a sample's is never sent.
    expect(findOneById).not.toHaveBeenCalled();
    expect(
      (ProjectService as unknown as Record<string, jest.SpyInstance>)[
        "addDefaultProjectTeams"
      ],
    ).toHaveBeenCalledWith(created);
    // And this server knows it is a sample without reading it again.
    await expect(ProjectService.isSampleProject(SAMPLE_ID)).resolves.toBe(true);
  });

  test("a real project with billing on still gets its customer", async () => {
    stubDefaults();
    const createCustomer: jest.SpyInstance = jest
      .spyOn(BillingService, "createCustomer")
      .mockRejectedValue(new Error("reached the payment provider"));

    const created: Project = projectRow({
      _id: REAL_ID.toString(),
      name: "Acme",
      isSampleProject: false,
      paymentProviderPlanId: "plan_growth",
    });

    await expect(
      internals().onCreateSuccess(
        {
          createBy: { data: created, props: { userId: USER_ID } },
          carryForward: null,
        } as unknown as OnCreate<Project>,
        created,
      ),
    ).rejects.toThrow("reached the payment provider");

    expect(createCustomer).toHaveBeenCalled();
  });
});

describe("deleting a sample project", () => {
  const onDelete: (projects: Array<Project>) => OnDelete<Project> = (
    projects: Array<Project>,
  ): OnDelete<Project> => {
    return {
      deleteBy: { query: {}, props: { isRoot: true } },
      carryForward: projects,
    } as unknown as OnDelete<Project>;
  };

  test("deletes its analytics rows, and leaves no deleted-project record", async () => {
    setBilling(false);
    const deleteAll: jest.SpyInstance = jest
      .spyOn(SampleProjectAnalyticsData, "deleteAll")
      .mockResolvedValue({ deletedFrom: [], failedFor: [] });
    const logProjectDeletion: jest.SpyInstance = jest
      .spyOn(DeletedProjectService, "logProjectDeletion")
      .mockResolvedValue(undefined as never);

    await internals().onDeleteSuccess(
      onDelete([
        projectRow({ _id: SAMPLE_ID.toString(), isSampleProject: true }),
        projectRow({ _id: REAL_ID.toString(), isSampleProject: false }),
      ]),
      [SAMPLE_ID, REAL_ID],
    );

    expect(deleteAll).toHaveBeenCalledTimes(1);
    expect(deleteAll).toHaveBeenCalledWith(SAMPLE_ID);
    // The real project is recorded for outreach; the sample is not.
    expect(logProjectDeletion).toHaveBeenCalledTimes(1);
    expect(logProjectDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({ isSampleProject: false }),
      }),
    );
  });

  test("a sample the delete did not reach keeps its rows", async () => {
    setBilling(false);
    const deleteAll: jest.SpyInstance = jest
      .spyOn(SampleProjectAnalyticsData, "deleteAll")
      .mockResolvedValue({ deletedFrom: [], failedFor: [] });
    jest
      .spyOn(DeletedProjectService, "logProjectDeletion")
      .mockResolvedValue(undefined as never);

    await internals().onDeleteSuccess(
      onDelete([
        projectRow({ _id: SAMPLE_ID.toString(), isSampleProject: true }),
      ]),
      [],
    );

    expect(deleteAll).not.toHaveBeenCalled();
  });
});

describe("the monitoring paths", () => {
  test("leave a sample project out, as they leave a blocked one", () => {
    expect(ProjectService.getActiveProjectStatusQuery()).toEqual(
      expect.objectContaining({ isBlocked: false, isSampleProject: false }),
    );
  });
});
