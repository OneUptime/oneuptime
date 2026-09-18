import ProjectService from "../../../Server/Services/ProjectService";
import BillingService from "../../../Server/Services/BillingService";
import DeletedProjectService from "../../../Server/Services/DeletedProjectService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import Select from "../../../Server/Types/Database/Select";
import logger from "../../../Server/Utils/Logger";
import DeletedProject from "../../../Models/DatabaseModels/DeletedProject";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * Deleting a project is the one moment OneUptime learns that a customer has
 * left, and it is irreversible: the rows are hard deleted and every detail of
 * the account goes with them. These tests pin the two things that make the
 * DeletedProject record trustworthy - that onBeforeDelete reads the snapshot
 * while the project still exists, and that onDeleteSuccess writes it before
 * anything else in the hook can fail.
 *
 * Nothing below the service boundary runs: no database, no Stripe, no Slack.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,

    /*
     * config.env may carry a real incoming webhook and onDeleteSuccess posts
     * every project deletion to it. Blanked so the suite cannot post to Slack.
     */
    NotificationSlackWebhookOnDeleteProject: "",
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

type MakeProjectFunction = (id?: ObjectID) => Project;

const makeProject: MakeProjectFunction = (id?: ObjectID): Project => {
  const project: Project = new Project();
  project._id = (id || PROJECT_ID).toString();
  project.name = "Acme Monitoring";
  project.paymentProviderSubscriptionId = "sub_123";
  project.paymentProviderMeteredSubscriptionId = "sub_metered_123";

  return project;
};

type MakeDeleteByFunction = (
  overrides?: Partial<DeleteBy<Project>>,
) => DeleteBy<Project>;

const makeDeleteBy: MakeDeleteByFunction = (
  overrides?: Partial<DeleteBy<Project>>,
): DeleteBy<Project> => {
  return {
    query: { _id: PROJECT_ID.toString() },
    limit: 10,
    skip: 0,
    props: { isRoot: false, userId: USER_ID },
    ...(overrides || {}),
  } as DeleteBy<Project>;
};

/*
 * onBeforeDelete and onDeleteSuccess are protected - DatabaseService is what
 * calls them. Reaching them directly is the only way to test them without a
 * database.
 */
type CallOnBeforeDeleteFunction = (
  deleteBy: DeleteBy<Project>,
) => Promise<OnDelete<Project>>;

const callOnBeforeDelete: CallOnBeforeDeleteFunction = (
  deleteBy: DeleteBy<Project>,
): Promise<OnDelete<Project>> => {
  return (
    ProjectService as unknown as {
      onBeforeDelete: (d: DeleteBy<Project>) => Promise<OnDelete<Project>>;
    }
  ).onBeforeDelete(deleteBy);
};

type CallOnDeleteSuccessFunction = (
  onDelete: OnDelete<Project>,
  deletedIds: Array<ObjectID>,
) => Promise<OnDelete<Project>>;

const callOnDeleteSuccess: CallOnDeleteSuccessFunction = (
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

interface LoggedDeletion {
  project: Project;
  deletedByUserId?: ObjectID | undefined;
  deletionReason?: string | undefined;
}

describe("ProjectService.onBeforeDelete", () => {
  let findByCalls: Array<FindBy<Project>> = [];

  beforeEach(() => {
    findByCalls = [];

    getJestSpyOn(ProjectService, "findBy").mockImplementation((async (
      findBy: FindBy<Project>,
    ) => {
      findByCalls.push(findBy);
      return [makeProject()];
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("carries the projects forward, because they cannot be read after the delete", async () => {
    const onDelete: OnDelete<Project> =
      await callOnBeforeDelete(makeDeleteBy());

    expect(onDelete.carryForward).toHaveLength(1);
    expect(onDelete.carryForward[0].name).toBe("Acme Monitoring");
  });

  it("reads the projects the delete query matches, as root", async () => {
    await callOnBeforeDelete(makeDeleteBy());

    expect(findByCalls).toHaveLength(1);
    expect(findByCalls[0]?.query).toEqual({ _id: PROJECT_ID.toString() });
    expect(findByCalls[0]?.props).toEqual({ isRoot: true });
  });

  /*
   * Every one of these columns ends up on the DeletedProject row. A column
   * missing from this select is a column that is silently blank in the audit
   * trail forever - there is no second chance to read it.
   */
  it("selects everything the deletion record needs", async () => {
    await callOnBeforeDelete(makeDeleteBy());

    const select: Select<Project> = findByCalls[0]!.select as Select<Project>;

    for (const column of [
      "name",
      "slug",
      "createdAt",
      "planName",
      "paymentProviderPlanId",
      "paymentProviderCustomerId",
      "paymentProviderSubscriptionId",
      "paymentProviderSubscriptionStatus",
      "paymentProviderSubscriptionSeats",
      "trialEndsAt",
      "currentActiveMonitorsCount",
      "isBlocked",
      "createdByUserId",
    ]) {
      expect(select).toHaveProperty(column, true);
    }
  });

  it("selects the creator's contact and company details", async () => {
    await callOnBeforeDelete(makeDeleteBy());

    const select: Select<Project> = findByCalls[0]!.select as Select<Project>;

    for (const column of [
      "name",
      "email",
      "companyName",
      "companyPhoneNumber",
      "companySize",
      "jobRole",
    ]) {
      expect(select["createdByUser"]).toHaveProperty(column, true);
    }
  });

  it("still selects what cancelling the subscriptions needs", async () => {
    await callOnBeforeDelete(makeDeleteBy());

    const select: Select<Project> = findByCalls[0]!.select as Select<Project>;

    expect(select).toHaveProperty("paymentProviderSubscriptionId", true);
    expect(select).toHaveProperty("paymentProviderMeteredSubscriptionId", true);
  });
});

describe("ProjectService.onDeleteSuccess", () => {
  let logged: Array<LoggedDeletion> = [];

  beforeEach(() => {
    logged = [];

    getJestSpyOn(
      DeletedProjectService,
      "logProjectDeletion",
    ).mockImplementation((async (data: LoggedDeletion) => {
      logged.push(data);
      return new DeletedProject();
    }) as never);

    getJestSpyOn(BillingService, "cancelSubscription").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(BillingService, "getSubscriptionStatus").mockResolvedValue(
      "canceled" as never,
    );
    getJestSpyOn(logger, "error").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records the project that was deleted", async () => {
    await callOnDeleteSuccess(
      { deleteBy: makeDeleteBy(), carryForward: [makeProject()] },
      [PROJECT_ID],
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]?.project.name).toBe("Acme Monitoring");
  });

  it("records who deleted it", async () => {
    await callOnDeleteSuccess(
      { deleteBy: makeDeleteBy(), carryForward: [makeProject()] },
      [PROJECT_ID],
    );

    expect(logged[0]?.deletedByUserId?.toString()).toBe(USER_ID.toString());
  });

  it("records why they said they were deleting it", async () => {
    await callOnDeleteSuccess(
      {
        deleteBy: makeDeleteBy({
          deletionReason: "Switching to a different tool",
        }),
        carryForward: [makeProject()],
      },
      [PROJECT_ID],
    );

    expect(logged[0]?.deletionReason).toBe("Switching to a different tool");
  });

  it("records the deletion even when no reason was given", async () => {
    await callOnDeleteSuccess(
      { deleteBy: makeDeleteBy(), carryForward: [makeProject()] },
      [PROJECT_ID],
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]?.deletionReason).toBeUndefined();
  });

  /*
   * deletedByUser is the caller-supplied actor and takes priority over the
   * authenticated user - the same precedence every other delete hook uses.
   */
  it("prefers an explicitly supplied actor over the authenticated user", async () => {
    const actorId: ObjectID = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );
    const actor: User = new User();
    actor._id = actorId.toString();

    await callOnDeleteSuccess(
      {
        deleteBy: makeDeleteBy({ deletedByUser: actor }),
        carryForward: [makeProject()],
      },
      [PROJECT_ID],
    );

    expect(logged[0]?.deletedByUserId?.toString()).toBe(actorId.toString());
  });

  it("records every project when several are deleted at once", async () => {
    await callOnDeleteSuccess(
      {
        deleteBy: makeDeleteBy(),
        carryForward: [makeProject(), makeProject(OTHER_PROJECT_ID)],
      },
      [PROJECT_ID, OTHER_PROJECT_ID],
    );

    expect(logged).toHaveLength(2);
  });

  /*
   * onBeforeDelete snapshots whatever the query matched. Permissions can then
   * narrow the delete, so a project in the snapshot is not necessarily a
   * project that was deleted - and recording one that still exists would send
   * a "sorry you left" email to a live customer.
   */
  it("does not record a project that was not actually deleted", async () => {
    await callOnDeleteSuccess(
      {
        deleteBy: makeDeleteBy(),
        carryForward: [makeProject(), makeProject(OTHER_PROJECT_ID)],
      },
      [PROJECT_ID],
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]?.project.id?.toString()).toBe(PROJECT_ID.toString());
  });

  /*
   * The project is already gone by the time this hook runs. Failing the
   * request because the audit write failed would tell the customer their
   * delete did not work when it did.
   */
  it("does not fail the delete when the audit write throws", async () => {
    getJestSpyOn(DeletedProjectService, "logProjectDeletion").mockRejectedValue(
      new Error("audit table unreachable") as never,
    );

    await expect(
      callOnDeleteSuccess(
        { deleteBy: makeDeleteBy(), carryForward: [makeProject()] },
        [PROJECT_ID],
      ),
    ).resolves.toBeDefined();

    expect(logger.error).toHaveBeenCalled();
  });

  it("still cancels the subscription when the audit write throws", async () => {
    getJestSpyOn(DeletedProjectService, "logProjectDeletion").mockRejectedValue(
      new Error("audit table unreachable") as never,
    );

    await callOnDeleteSuccess(
      { deleteBy: makeDeleteBy(), carryForward: [makeProject()] },
      [PROJECT_ID],
    );

    expect(BillingService.cancelSubscription).toHaveBeenCalledWith("sub_123");
  });

  /*
   * Ordering is the point: Stripe is a network call that can and does fail,
   * and the customer whose cancellation errored is exactly the one worth
   * following up with. Recording first means the row survives that failure.
   */
  it("records the deletion before it touches billing", async () => {
    const callOrder: Array<string> = [];

    getJestSpyOn(
      DeletedProjectService,
      "logProjectDeletion",
    ).mockImplementation((async () => {
      callOrder.push("audit");
      return new DeletedProject();
    }) as never);

    getJestSpyOn(BillingService, "cancelSubscription").mockImplementation(
      (async () => {
        callOrder.push("billing");
        throw new Error("stripe is down");
      }) as never,
    );

    await expect(
      callOnDeleteSuccess(
        { deleteBy: makeDeleteBy(), carryForward: [makeProject()] },
        [PROJECT_ID],
      ),
    ).rejects.toThrow("stripe is down");

    expect(callOrder).toEqual(["audit", "billing"]);
  });

  it("records nothing when nothing was deleted", async () => {
    await callOnDeleteSuccess(
      { deleteBy: makeDeleteBy(), carryForward: [] },
      [],
    );

    expect(logged).toHaveLength(0);
  });
});
