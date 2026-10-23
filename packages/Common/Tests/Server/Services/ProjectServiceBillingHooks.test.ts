/*
 * Billing is pinned per test (CI's config.env sets BILLING_ENABLED=true), and
 * the plans a plan change needs are given here. The incoming webhook
 * config.env may carry is blanked, so nothing here posts to Slack.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  const mocked: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );

  mocked["NotificationSlackWebhookOnDeleteProject"] = "";
  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return {
      SUBSCRIPTION_PLAN_FREE: "Free,free_monthly,free_yearly,0,0,1,0",
      SUBSCRIPTION_PLAN_GROWTH:
        "Growth,growth_monthly,growth_yearly,22,240,2,14",
    };
  };

  return mocked;
});

import { ProjectBillingState } from "../../../Server/Enterprise/EnterpriseServerModule";
import BillingService from "../../../Server/Services/BillingService";
import DeletedProjectService from "../../../Server/Services/DeletedProjectService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import PlanDowngradeOwnerNotice from "../../../Server/Utils/Billing/PlanDowngradeOwnerNotice";
import logger from "../../../Server/Utils/Logger";
import DeletedProject from "../../../Models/DatabaseModels/DeletedProject";
import Project from "../../../Models/DatabaseModels/Project";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";
import {
  MockedProjectBillingHooks,
  createProjectBillingHooksSpy,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { stubRowsCallerMayDelete } from "../TestingUtils/RowsCallerMayWrite";

/*
 * OneUptime Cloud's marketplace billing (AWS, Microsoft, Google Cloud and
 * Vercel Marketplace) lives in the enterprise module. ProjectService tells it
 * what happens to projects through the module's project billing hooks
 * (EnterpriseEdition.getProjectBillingHooks):
 *
 *   beforeProjectsDelete        every project a delete is held to, with the
 *                               marketplace that bills it, while the projects
 *                               are still there to be priced;
 *   afterProjectsDelete         every project really deleted;
 *   afterMarketplacePlanChange  a marketplace-billed project's new plan.
 *
 * Only with billing on, never failing the change it reports, and with
 * nothing to tell on the Community Edition. What the hooks do is the
 * enterprise module's (ee/Tests/Server/CloudMarketplace).
 */

const MARKETPLACE_PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CARD_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const makeProject: (
  id: ObjectID,
  billingMarketplace?: CloudMarketplace | undefined,
) => Project = (
  id: ObjectID,
  billingMarketplace?: CloudMarketplace | undefined,
): Project => {
  const project: Project = new Project();
  project._id = id.toString();
  project.name = billingMarketplace ? "Bought on a marketplace" : "Card";

  if (billingMarketplace) {
    project.billingMarketplace = billingMarketplace;
  } else {
    project.paymentProviderSubscriptionId = "sub_123";
    project.paymentProviderMeteredSubscriptionId = "sub_metered_123";
  }

  return project;
};

const makeDeleteBy: () => DeleteBy<Project> = (): DeleteBy<Project> => {
  return {
    query: { createdByUserId: USER_ID.toString() },
    limit: 10,
    skip: 0,
    props: { isRoot: false, userId: USER_ID },
  } as unknown as DeleteBy<Project>;
};

// DatabaseService calls these protected hooks, in this order, around the DELETE.
const callOnBeforeDelete: (
  deleteBy: DeleteBy<Project>,
) => Promise<OnDelete<Project>> = (
  deleteBy: DeleteBy<Project>,
): Promise<OnDelete<Project>> => {
  return (
    ProjectService as unknown as {
      onBeforeDelete: (d: DeleteBy<Project>) => Promise<OnDelete<Project>>;
    }
  ).onBeforeDelete(deleteBy);
};

const callOnDeleteSuccess: (
  onDelete: OnDelete<Project>,
  deletedIds: Array<ObjectID>,
) => Promise<OnDelete<Project>> = (
  onDelete: OnDelete<Project>,
  deletedIds: Array<ObjectID>,
): Promise<OnDelete<Project>> => {
  return (
    ProjectService as unknown as {
      onDeleteSuccess: (
        d: OnDelete<Project>,
        ids: Array<ObjectID>,
      ) => Promise<OnDelete<Project>>;
    }
  ).onDeleteSuccess(onDelete, deletedIds);
};

// A hook's project list, as plain strings, so it compares by value.
const describeProjects: (
  projects: Array<ProjectBillingState>,
) => Array<[string, CloudMarketplace | null]> = (
  projects: Array<ProjectBillingState>,
): Array<[string, CloudMarketplace | null]> => {
  return projects.map(
    (project: ProjectBillingState): [string, CloudMarketplace | null] => {
      return [project.projectId.toString(), project.billingMarketplace];
    },
  );
};

const firstArgument: (hook: jest.Mock) => Array<ProjectBillingState> = (
  hook: jest.Mock,
): Array<ProjectBillingState> => {
  return hook.mock.calls[0]![0] as Array<ProjectBillingState>;
};

describe("ProjectService tells OneUptime Cloud's billing about deleted projects", () => {
  let rows: Array<Project> = [];
  let hooks: MockedProjectBillingHooks;
  let cancelSubscription: jest.SpyInstance;

  beforeEach(() => {
    setTestBillingEnabled(true);
    hooks = createProjectBillingHooksSpy();
    installFakeEnterpriseModule({ projectBillingHooks: hooks });

    rows = [
      makeProject(MARKETPLACE_PROJECT_ID, CloudMarketplace.Azure),
      makeProject(CARD_PROJECT_ID),
    ];

    getJestSpyOn(ProjectService, "findBy").mockImplementation((async (
      _findBy: FindBy<Project>,
    ) => {
      return rows;
    }) as never);

    stubRowsCallerMayDelete(ProjectService, () => {
      return rows;
    });

    getJestSpyOn(DeletedProjectService, "logProjectDeletion").mockResolvedValue(
      new DeletedProject() as never,
    );
    cancelSubscription = getJestSpyOn(
      BillingService,
      "cancelSubscription",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(logger, "error").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  it("before the delete, hands over every project the delete is held to, with the marketplace that bills it", async () => {
    await callOnBeforeDelete(makeDeleteBy());

    expect(hooks.beforeProjectsDelete).toHaveBeenCalledTimes(1);
    expect(describeProjects(firstArgument(hooks.beforeProjectsDelete))).toEqual(
      [
        [MARKETPLACE_PROJECT_ID.toString(), CloudMarketplace.Azure],
        [CARD_PROJECT_ID.toString(), null],
      ],
    );
    expect(hooks.afterProjectsDelete).not.toHaveBeenCalled();
  });

  it("hands over nothing when the caller may delete none of the projects", async () => {
    stubRowsCallerMayDelete(ProjectService, () => {
      return [];
    });

    await callOnBeforeDelete(makeDeleteBy());

    expect(hooks.beforeProjectsDelete).not.toHaveBeenCalled();
  });

  it("after the delete, hands over the projects really deleted, after cancelling their card subscriptions", async () => {
    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());

    await callOnDeleteSuccess(onDelete, [MARKETPLACE_PROJECT_ID]);

    expect(describeProjects(firstArgument(hooks.afterProjectsDelete))).toEqual([
      [MARKETPLACE_PROJECT_ID.toString(), CloudMarketplace.Azure],
    ]);
    expect(cancelSubscription).toHaveBeenCalledWith("sub_123");
    expect(cancelSubscription.mock.invocationCallOrder[0]!).toBeLessThan(
      hooks.afterProjectsDelete.mock.invocationCallOrder[0]!,
    );
  });

  it("a deleted project the delete did not snapshot is handed over without a marketplace", async () => {
    const stranger: ObjectID = new ObjectID(
      "77777777-7777-4777-8777-777777777777",
    );

    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());

    await callOnDeleteSuccess(onDelete, [CARD_PROJECT_ID, stranger]);

    expect(describeProjects(firstArgument(hooks.afterProjectsDelete))).toEqual([
      [CARD_PROJECT_ID.toString(), null],
      [stranger.toString(), null],
    ]);
  });

  it("hands over nothing after a delete that deleted nothing", async () => {
    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());

    await callOnDeleteSuccess(onDelete, []);

    expect(hooks.afterProjectsDelete).not.toHaveBeenCalled();
  });

  it("tells billing before the delete what it later tells it was deleted", async () => {
    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());
    await callOnDeleteSuccess(onDelete, [
      MARKETPLACE_PROJECT_ID,
      CARD_PROJECT_ID,
    ]);

    expect(
      hooks.beforeProjectsDelete.mock.invocationCallOrder[0]!,
    ).toBeLessThan(hooks.afterProjectsDelete.mock.invocationCallOrder[0]!);
  });

  it("tells nothing with billing off, even when the enterprise module has hooks", async () => {
    setTestBillingEnabled(false);

    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());
    await callOnDeleteSuccess(onDelete, [MARKETPLACE_PROJECT_ID]);

    expect(hooks.beforeProjectsDelete).not.toHaveBeenCalled();
    expect(hooks.afterProjectsDelete).not.toHaveBeenCalled();
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("deletes as before on the Community Edition, which has no hooks", async () => {
    uninstallEnterpriseModule();

    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());

    await expect(
      callOnDeleteSuccess(onDelete, [MARKETPLACE_PROJECT_ID]),
    ).resolves.toBe(onDelete);

    expect(hooks.beforeProjectsDelete).not.toHaveBeenCalled();
    expect(hooks.afterProjectsDelete).not.toHaveBeenCalled();
  });

  it("a module that answers no hooks (billing off in ee) is told nothing", async () => {
    installFakeEnterpriseModule({ projectBillingHooks: null });

    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());
    await callOnDeleteSuccess(onDelete, [MARKETPLACE_PROJECT_ID]);

    expect(hooks.beforeProjectsDelete).not.toHaveBeenCalled();
    expect(hooks.afterProjectsDelete).not.toHaveBeenCalled();
  });

  it("a hook that throws never fails the delete, and is logged", async () => {
    const failure: Error = new Error("the marketplace is down");
    hooks.beforeProjectsDelete.mockRejectedValue(failure as never);
    hooks.afterProjectsDelete.mockRejectedValue(failure as never);

    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());

    expect(
      onDelete.carryForward.map((project: Project) => {
        return project.id?.toString();
      }),
    ).toEqual([MARKETPLACE_PROJECT_ID.toString(), CARD_PROJECT_ID.toString()]);

    await expect(
      callOnDeleteSuccess(onDelete, [MARKETPLACE_PROJECT_ID]),
    ).resolves.toBe(onDelete);

    expect(logger.error).toHaveBeenCalledWith(failure);
  });

  it("a module whose hooks cannot be read is logged, and the delete goes on", async () => {
    const fake: ReturnType<typeof installFakeEnterpriseModule> =
      installFakeEnterpriseModule({ projectBillingHooks: hooks });
    fake.projectBillingHooksError = new Error("hooks unavailable");

    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());

    await expect(
      callOnDeleteSuccess(onDelete, [MARKETPLACE_PROJECT_ID]),
    ).resolves.toBe(onDelete);

    expect(hooks.beforeProjectsDelete).not.toHaveBeenCalled();
    expect(hooks.afterProjectsDelete).not.toHaveBeenCalled();
  });
});

describe("ProjectService tells OneUptime Cloud's billing about a marketplace-billed project's new plan", () => {
  let hooks: MockedProjectBillingHooks;
  let project: Project;

  beforeEach(() => {
    setTestBillingEnabled(true);
    hooks = createProjectBillingHooksSpy();
    installFakeEnterpriseModule({ projectBillingHooks: hooks });

    project = makeProject(MARKETPLACE_PROJECT_ID, CloudMarketplace.Vercel);
    project.paymentProviderPlanId = "free_monthly";

    getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
      project as never,
    );
    getJestSpyOn(ProjectService, "updateOneById").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(PayAsYouGoBillingService, "invalidate").mockImplementation(
      (() => {}) as never,
    );
    getJestSpyOn(PlanDowngradeOwnerNotice, "notifyIfStopped").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(
      TeamMemberService,
      "getUniqueTeamMemberCountInProject",
    ).mockResolvedValue(3 as never);
    getJestSpyOn(
      ProjectService as unknown as Record<string, () => Promise<void>>,
      "sendSubscriptionChangeWebhookSlackNotification",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(logger, "error").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  it("hands over the project, its marketplace and the new plan once the plan is written", async () => {
    await ProjectService.changePlan({
      projectId: MARKETPLACE_PROJECT_ID,
      paymentProviderPlanId: "growth_monthly",
    });

    expect(hooks.afterMarketplacePlanChange).toHaveBeenCalledTimes(1);
    expect(hooks.afterMarketplacePlanChange).toHaveBeenCalledWith({
      projectId: project.id,
      billingMarketplace: CloudMarketplace.Vercel,
      paymentProviderPlanId: "growth_monthly",
    });
    expect(
      (ProjectService.updateOneById as unknown as jest.Mock).mock
        .invocationCallOrder[0]!,
    ).toBeLessThan(
      hooks.afterMarketplacePlanChange.mock.invocationCallOrder[0]!,
    );
  });

  it("a hook that throws never fails the plan change, and is logged", async () => {
    const failure: Error = new Error("Vercel is down");
    hooks.afterMarketplacePlanChange.mockRejectedValue(failure as never);

    await expect(
      ProjectService.changePlan({
        projectId: MARKETPLACE_PROJECT_ID,
        paymentProviderPlanId: "growth_monthly",
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(failure);
  });

  it("changes the plan as before on the Community Edition, which has no hooks", async () => {
    uninstallEnterpriseModule();

    await expect(
      ProjectService.changePlan({
        projectId: MARKETPLACE_PROJECT_ID,
        paymentProviderPlanId: "growth_monthly",
      }),
    ).resolves.toBeUndefined();

    expect(hooks.afterMarketplacePlanChange).not.toHaveBeenCalled();
    expect(ProjectService.updateOneById).toHaveBeenCalled();
  });

  it("there is no plan change, and nothing to tell, with billing off", async () => {
    setTestBillingEnabled(false);

    await expect(
      ProjectService.changePlan({
        projectId: MARKETPLACE_PROJECT_ID,
        paymentProviderPlanId: "growth_monthly",
      }),
    ).rejects.toThrow("Billing is not enabled for this server");

    expect(hooks.afterMarketplacePlanChange).not.toHaveBeenCalled();
  });
});
