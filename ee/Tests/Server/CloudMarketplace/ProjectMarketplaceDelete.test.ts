/*
 * IsBillingEnabled is read as a property at every use site in TypeScript's
 * CommonJS emit, so a getter laid over the otherwise real module lets one
 * suite delete projects on OneUptime Cloud and on a self-hosted install.
 * The incoming webhook config.env may carry is blanked, so no delete here
 * posts to Slack.
 */
let mockIsBillingEnabled: boolean = true;

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
    NotificationSlackWebhookOnDeleteProject: "",
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });

  return mocked;
});

import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import BillingService from "Common/Server/Services/BillingService";
import DeletedProjectService from "Common/Server/Services/DeletedProjectService";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import ProjectService from "Common/Server/Services/ProjectService";
import DeleteBy from "Common/Server/Types/Database/DeleteBy";
import FindBy from "Common/Server/Types/Database/FindBy";
import { OnDelete } from "Common/Server/Types/Database/Hooks";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import DeletedProject from "Common/Models/DatabaseModels/DeletedProject";
import Project from "Common/Models/DatabaseModels/Project";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "Common/Tests/Spy";
import { stubRowsCallerMayDelete } from "Common/Tests/Server/TestingUtils/RowsCallerMayWrite";
import EnterpriseModule from "../../../Server/Index";
import MarketplacePurchases from "../../../Server/CloudMarketplace/MarketplacePurchases";
import MarketplaceUsageReporter from "../../../Server/CloudMarketplace/MarketplaceUsageReporter";
import VercelMarketplaceResources from "../../../Server/CloudMarketplace/Vercel/VercelMarketplaceResources";

/*
 * A marketplace bills a project by the hour, after the hour, so a project
 * deleted part way through an hour still owes that part - and every balance
 * top-up bought since its last hourly report. The reporter needs the project
 * to price it (its plan, seats and monitors), so the bill is made in
 * onBeforeDelete, while the project is still there; onDeleteSuccess then
 * unlinks the purchase, and no hourly report bills it again.
 *
 * Core's ProjectService reaches the marketplace billing through the
 * enterprise module's project billing hooks. Here the real enterprise module
 * is registered, so a delete runs ProjectService -> EnterpriseEdition -> the
 * CloudMarketplace area's hooks -> the reporter and the purchases.
 *
 * Nothing below the service boundary runs: no database, no marketplace.
 * MarketplaceUsageReporterProjectDelete.test.ts covers the report itself.
 */

const MARKETPLACE_PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CARD_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const VERCEL_PROJECT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

type MakeProjectFunction = (
  id: ObjectID,
  billingMarketplace?: CloudMarketplace | undefined,
) => Project;

const makeProject: MakeProjectFunction = (
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
  }

  return project;
};

// A delete of the projects a user created. The rows it is held to are the suite's.
const makeDeleteBy: () => DeleteBy<Project> = (): DeleteBy<Project> => {
  return {
    query: { createdByUserId: USER_ID.toString() },
    limit: 10,
    skip: 0,
    props: { isRoot: false, userId: USER_ID },
  } as unknown as DeleteBy<Project>;
};

/*
 * onBeforeDelete and onDeleteSuccess are protected - DatabaseService is what
 * calls them, in this order, around the DELETE.
 */
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

const idsOf: (spy: jest.SpyInstance) => Array<string> = (
  spy: jest.SpyInstance,
): Array<string> => {
  return spy.mock.calls.map((call: Array<unknown>) => {
    return String(call[0]);
  });
};

describe("deleting a project a cloud marketplace bills, through the enterprise module", () => {
  let rows: Array<Project> = [];
  let findByCalls: Array<FindBy<Project>> = [];
  let reportFinalUsageOfProject: jest.SpyInstance;
  let unlinkProject: jest.SpyInstance;
  let onVercelProjectDeleted: jest.SpyInstance;

  beforeEach(() => {
    mockIsBillingEnabled = true;
    EnterpriseEdition.resetForTests();
    EnterpriseEdition.register(EnterpriseModule);

    findByCalls = [];
    rows = [
      makeProject(MARKETPLACE_PROJECT_ID, CloudMarketplace.Azure),
      makeProject(CARD_PROJECT_ID),
    ];

    getJestSpyOn(ProjectService, "findBy").mockImplementation((async (
      findByArgument: FindBy<Project>,
    ) => {
      findByCalls.push(findByArgument);
      return rows;
    }) as never);

    // The owner may delete every project.
    stubRowsCallerMayDelete(ProjectService, () => {
      return rows;
    });

    reportFinalUsageOfProject = getJestSpyOn(
      MarketplaceUsageReporter,
      "reportFinalUsageOfProject",
    ).mockResolvedValue(undefined as never);

    getJestSpyOn(DeletedProjectService, "logProjectDeletion").mockResolvedValue(
      new DeletedProject() as never,
    );
    getJestSpyOn(BillingService, "cancelSubscription").mockResolvedValue(
      undefined as never,
    );
    unlinkProject = getJestSpyOn(
      MarketplacePurchases,
      "unlinkProject",
    ).mockResolvedValue(undefined as never);
    onVercelProjectDeleted = getJestSpyOn(
      VercelMarketplaceResources,
      "onProjectDeleted",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(logger, "error").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    EnterpriseEdition.resetForTests();
    jest.restoreAllMocks();
  });

  it("bills the marketplace-billed project's last usage before the delete, while the project is still there", async () => {
    await callOnBeforeDelete(makeDeleteBy());

    expect(reportFinalUsageOfProject).toHaveBeenCalledTimes(1);
    expect(String(reportFinalUsageOfProject.mock.calls[0]![0])).toBe(
      MARKETPLACE_PROJECT_ID.toString(),
    );
  });

  it("reads whether a marketplace bills each project with the rows the delete is held to", async () => {
    await callOnBeforeDelete(makeDeleteBy());

    expect(findByCalls).toHaveLength(1);
    expect(findByCalls[0]!.select as Select<Project>).toHaveProperty(
      "billingMarketplace",
      true,
    );
  });

  it("does nothing on a marketplace for a project billed by card", async () => {
    rows = [makeProject(CARD_PROJECT_ID)];

    await callOnBeforeDelete(makeDeleteBy());

    expect(reportFinalUsageOfProject).not.toHaveBeenCalled();
  });

  it("bills every marketplace-billed project of a delete, each once", async () => {
    const other: ObjectID = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );
    rows = [
      makeProject(MARKETPLACE_PROJECT_ID, CloudMarketplace.Azure),
      makeProject(CARD_PROJECT_ID),
      makeProject(other, CloudMarketplace.GoogleCloud),
    ];

    await callOnBeforeDelete(makeDeleteBy());

    expect(idsOf(reportFinalUsageOfProject)).toEqual([
      MARKETPLACE_PROJECT_ID.toString(),
      other.toString(),
    ]);
  });

  it("bills nothing on a project the caller may not delete", async () => {
    stubRowsCallerMayDelete(ProjectService, () => {
      return [];
    });

    await callOnBeforeDelete(makeDeleteBy());

    expect(reportFinalUsageOfProject).not.toHaveBeenCalled();
  });

  it("bills nothing on a self-hosted install, which no marketplace sells", async () => {
    mockIsBillingEnabled = false;

    await callOnBeforeDelete(makeDeleteBy());

    expect(reportFinalUsageOfProject).not.toHaveBeenCalled();
  });

  it("the enterprise module hands out no project billing hooks with billing off", () => {
    mockIsBillingEnabled = false;

    expect(EnterpriseEdition.getProjectBillingHooks()).toBeNull();

    mockIsBillingEnabled = true;

    expect(EnterpriseEdition.getProjectBillingHooks()).not.toBeNull();
  });

  it("still carries the projects forward for the deletion record", async () => {
    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());

    expect(
      onDelete.carryForward.map((project: Project) => {
        return project.id?.toString();
      }),
    ).toEqual([MARKETPLACE_PROJECT_ID.toString(), CARD_PROJECT_ID.toString()]);
  });

  it("bills the last usage before the purchase is unlinked, and unlinks it once the project is gone", async () => {
    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());
    await callOnDeleteSuccess(onDelete, [
      MARKETPLACE_PROJECT_ID,
      CARD_PROJECT_ID,
    ]);

    expect(String(unlinkProject.mock.calls[0]![0])).toBe(
      MARKETPLACE_PROJECT_ID.toString(),
    );
    expect(reportFinalUsageOfProject.mock.invocationCallOrder[0]!).toBeLessThan(
      unlinkProject.mock.invocationCallOrder[0]!,
    );
  });

  it("unlinks the purchases of every project really deleted, and of no other", async () => {
    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());
    await callOnDeleteSuccess(onDelete, [MARKETPLACE_PROJECT_ID]);

    expect(idsOf(unlinkProject)).toEqual([MARKETPLACE_PROJECT_ID.toString()]);
  });

  it("deletes a Vercel resource with its project, before its purchase is unlinked", async () => {
    rows = [
      makeProject(VERCEL_PROJECT_ID, CloudMarketplace.Vercel),
      makeProject(MARKETPLACE_PROJECT_ID, CloudMarketplace.Azure),
    ];

    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());
    await callOnDeleteSuccess(onDelete, [
      VERCEL_PROJECT_ID,
      MARKETPLACE_PROJECT_ID,
    ]);

    expect(idsOf(onVercelProjectDeleted)).toEqual([
      VERCEL_PROJECT_ID.toString(),
    ]);
    expect(onVercelProjectDeleted.mock.invocationCallOrder[0]!).toBeLessThan(
      unlinkProject.mock.invocationCallOrder[0]!,
    );
    expect(idsOf(unlinkProject)).toEqual([
      VERCEL_PROJECT_ID.toString(),
      MARKETPLACE_PROJECT_ID.toString(),
    ]);
  });

  it("tells Vercel nothing about a Vercel project that was not really deleted", async () => {
    rows = [makeProject(VERCEL_PROJECT_ID, CloudMarketplace.Vercel)];

    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());
    await callOnDeleteSuccess(onDelete, []);

    expect(onVercelProjectDeleted).not.toHaveBeenCalled();
    expect(unlinkProject).not.toHaveBeenCalled();
  });

  it("a Vercel deletion that fails is logged, and the purchases are still unlinked", async () => {
    rows = [makeProject(VERCEL_PROJECT_ID, CloudMarketplace.Vercel)];
    onVercelProjectDeleted.mockRejectedValue(
      new Error("Vercel is down") as never,
    );

    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());

    await expect(
      callOnDeleteSuccess(onDelete, [VERCEL_PROJECT_ID]),
    ).resolves.toBeDefined();

    expect(idsOf(unlinkProject)).toEqual([VERCEL_PROJECT_ID.toString()]);
    expect(logger.error).toHaveBeenCalledWith(new Error("Vercel is down"));
  });

  it("a self-hosted install unlinks nothing and tells Vercel nothing", async () => {
    rows = [makeProject(VERCEL_PROJECT_ID, CloudMarketplace.Vercel)];

    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());

    mockIsBillingEnabled = false;
    await callOnDeleteSuccess(onDelete, [VERCEL_PROJECT_ID]);

    expect(onVercelProjectDeleted).not.toHaveBeenCalled();
    expect(unlinkProject).not.toHaveBeenCalled();
  });

  /*
   * reportFinalUsageOfProject is best effort: whatever the marketplace or
   * the database does, the delete goes on. Run for real here, with the read
   * of the purchase failing.
   */
  it("never fails the delete when the marketplace usage cannot be billed", async () => {
    reportFinalUsageOfProject.mockRestore();
    getJestSpyOn(
      MarketplaceSubscriptionService,
      "findPurchaseForProject",
    ).mockRejectedValue(new Error("database is gone") as never);

    await expect(callOnBeforeDelete(makeDeleteBy())).resolves.toMatchObject({
      carryForward: rows,
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `Final marketplace usage report failed for project ${MARKETPLACE_PROJECT_ID.toString()}`,
      ),
    );
  });

  it("does nothing for a marketplace-billed project no purchase bills any more", async () => {
    reportFinalUsageOfProject.mockRestore();
    const findPurchaseForProject: jest.SpyInstance = getJestSpyOn(
      MarketplaceSubscriptionService,
      "findPurchaseForProject",
    ).mockResolvedValue(null as never);

    await expect(callOnBeforeDelete(makeDeleteBy())).resolves.toBeDefined();

    expect(String(findPurchaseForProject.mock.calls[0]![0])).toBe(
      MARKETPLACE_PROJECT_ID.toString(),
    );
    expect(findPurchaseForProject).toHaveBeenCalledTimes(1);
  });
});
