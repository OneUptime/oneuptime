/*
 * IsBillingEnabled is read as a property at every use site in TypeScript's
 * CommonJS emit, so a getter laid over the otherwise real module lets one
 * suite delete projects on OneUptime Cloud and on a self-hosted install.
 * The incoming webhook config.env may carry is blanked, so no delete here
 * posts to Slack.
 */
let mockIsBillingEnabled: boolean = true;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
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

import BillingService from "../../../Server/Services/BillingService";
import DeletedProjectService from "../../../Server/Services/DeletedProjectService";
import MarketplaceSubscriptionService from "../../../Server/Services/MarketplaceSubscriptionService";
import ProjectService from "../../../Server/Services/ProjectService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import Select from "../../../Server/Types/Database/Select";
import logger from "../../../Server/Utils/Logger";
import MarketplaceUsageReporter from "../../../Server/Utils/Marketplace/MarketplaceUsageReporter";
import DeletedProject from "../../../Models/DatabaseModels/DeletedProject";
import Project from "../../../Models/DatabaseModels/Project";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";
import { stubRowsCallerMayDelete } from "../TestingUtils/RowsCallerMayWrite";

/*
 * A marketplace bills a project by the hour, after the hour, so a project
 * deleted part way through an hour still owes that part - and every balance
 * top-up bought since its last hourly report. The reporter needs the project
 * to price it (its plan, seats and monitors), so the bill is made in
 * onBeforeDelete, while the project is still there; onDeleteSuccess then
 * unlinks the purchase, and no hourly report bills it again.
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

describe("ProjectService: deleting a project a cloud marketplace bills", () => {
  let rows: Array<Project> = [];
  let findByCalls: Array<FindBy<Project>> = [];
  let reportFinalUsageOfProject: jest.SpyInstance;

  beforeEach(() => {
    mockIsBillingEnabled = true;
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

    // The owner may delete both projects.
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
    getJestSpyOn(
      MarketplaceSubscriptionService,
      "unlinkProject",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(logger, "error").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
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

    expect(
      reportFinalUsageOfProject.mock.calls.map((call: Array<unknown>) => {
        return String(call[0]);
      }),
    ).toEqual([MARKETPLACE_PROJECT_ID.toString(), other.toString()]);
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

    const unlinkProject: jest.Mock =
      MarketplaceSubscriptionService.unlinkProject as unknown as jest.Mock;

    expect(String(unlinkProject.mock.calls[0]![0])).toBe(
      MARKETPLACE_PROJECT_ID.toString(),
    );
    expect(reportFinalUsageOfProject.mock.invocationCallOrder[0]!).toBeLessThan(
      unlinkProject.mock.invocationCallOrder[0]!,
    );
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
