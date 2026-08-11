import DeletedProjectService from "../../../Server/Services/DeletedProjectService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeletedProject from "../../../Models/DatabaseModels/DeletedProject";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import CompanySize from "../../../Types/Company/CompanySize";
import JobRole from "../../../Types/Company/JobRole";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * A project is hard deleted, so the snapshot this service writes is the only
 * thing left of it. Anything it drops on the floor - the reason the customer
 * gave, the address to reach them on, what they were paying - cannot be
 * recovered afterwards, which is what every case below is about.
 *
 * Billing is on for this file: the audit trail exists so OneUptime can follow
 * up with a SaaS customer. IsBillingEnabled is read at import time, so the
 * self-hosted case needs its own module registry and lives in
 * DeletedProjectServiceSelfHosted.test.ts.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CREATOR_USER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_USER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

type MakeCreatorFunction = () => User;

const makeCreator: MakeCreatorFunction = (): User => {
  const user: User = new User();
  user._id = CREATOR_USER_ID.toString();
  user.name = new Name("Jane Creator");
  user.email = new Email("jane@acme.com");
  user.companyName = "Acme Inc.";
  user.companyPhoneNumber = new Phone("+15555550100");
  user.companySize = CompanySize.ElevenToFifty;
  user.jobRole = JobRole.EngineeringManager;

  return user;
};

type MakeProjectFunction = (overrides?: Partial<Project>) => Project;

const makeProject: MakeProjectFunction = (
  overrides?: Partial<Project>,
): Project => {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Acme Monitoring";
  project.slug = "acme-monitoring";
  project.createdAt = new Date("2024-01-01T00:00:00.000Z");
  project.planName = PlanType.Growth;
  project.paymentProviderPlanId = "price_growth";
  project.paymentProviderCustomerId = "cus_123";
  project.paymentProviderSubscriptionId = "sub_123";
  project.paymentProviderSubscriptionStatus = SubscriptionStatus.Active;
  project.paymentProviderSubscriptionSeats = 7;
  project.trialEndsAt = new Date("2024-02-01T00:00:00.000Z");
  project.currentActiveMonitorsCount = 12;
  project.isBlocked = false;
  project.createdByUserId = CREATOR_USER_ID;
  project.createdByUser = makeCreator();

  return Object.assign(project, overrides || {});
};

describe("DeletedProjectService.logProjectDeletion", () => {
  let created: Array<CreateBy<DeletedProject>> = [];

  beforeEach(() => {
    created = [];

    getJestSpyOn(DeletedProjectService, "create").mockImplementation((async (
      createBy: CreateBy<DeletedProject>,
    ) => {
      created.push(createBy);
      return createBy.data;
    }) as never);

    getJestSpyOn(UserService, "findOneById").mockResolvedValue(null as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes one row for the deleted project", async () => {
    await DeletedProjectService.logProjectDeletion({
      project: makeProject(),
      deletedByUserId: CREATOR_USER_ID,
      deletionReason: "We moved to a single project",
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(created[0]?.data.projectName).toBe("Acme Monitoring");
  });

  /*
   * The table has empty access control arrays, so nothing but a root write can
   * ever land a row in it.
   */
  it("writes as root, because no user permission can write this table", async () => {
    await DeletedProjectService.logProjectDeletion({
      project: makeProject(),
      deletedByUserId: CREATOR_USER_ID,
    });

    expect(created[0]?.props).toEqual({ isRoot: true });
  });

  it("keeps the reason the customer typed, which is the whole point", async () => {
    await DeletedProjectService.logProjectDeletion({
      project: makeProject(),
      deletedByUserId: CREATOR_USER_ID,
      deletionReason: "Too expensive for our team size",
    });

    expect(created[0]?.data.deletionReason).toBe(
      "Too expensive for our team size",
    );
  });

  it("still records the deletion when no reason was given", async () => {
    await DeletedProjectService.logProjectDeletion({
      project: makeProject(),
      deletedByUserId: CREATOR_USER_ID,
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.data.deletionReason).toBeUndefined();
  });

  it("copies the project snapshot rather than relating to the deleted row", async () => {
    await DeletedProjectService.logProjectDeletion({
      project: makeProject(),
      deletedByUserId: CREATOR_USER_ID,
    });

    const row: DeletedProject = created[0]!.data;

    expect(row.projectSlug).toBe("acme-monitoring");
    expect(row.projectCreatedAt).toEqual(new Date("2024-01-01T00:00:00.000Z"));
    expect(row.planName).toBe("Growth");
    expect(row.paymentProviderPlanId).toBe("price_growth");
    expect(row.paymentProviderCustomerId).toBe("cus_123");
    expect(row.paymentProviderSubscriptionId).toBe("sub_123");
    expect(row.paymentProviderSubscriptionStatus).toBe(
      SubscriptionStatus.Active,
    );
    expect(row.paymentProviderSubscriptionSeats).toBe(7);
    expect(row.trialEndsAt).toEqual(new Date("2024-02-01T00:00:00.000Z"));
    expect(row.activeMonitorCount).toBe(12);
    expect(row.wasProjectBlocked).toBe(false);
  });

  it("stamps the time of the deletion", async () => {
    const before: number = Date.now();

    await DeletedProjectService.logProjectDeletion({
      project: makeProject(),
      deletedByUserId: CREATOR_USER_ID,
    });

    const deletedAt: Date | undefined = created[0]?.data.projectDeletedAt;

    expect(deletedAt).toBeInstanceOf(Date);
    expect(deletedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("records that a blocked project was deleted, which is a different story", async () => {
    await DeletedProjectService.logProjectDeletion({
      project: makeProject({ isBlocked: true }),
      deletedByUserId: CREATOR_USER_ID,
    });

    expect(created[0]?.data.wasProjectBlocked).toBe(true);
  });

  describe("who to reach out to", () => {
    it("records the creator of the project", async () => {
      await DeletedProjectService.logProjectDeletion({
        project: makeProject(),
        deletedByUserId: CREATOR_USER_ID,
      });

      const row: DeletedProject = created[0]!.data;

      expect(row.projectCreatedByUserId?.toString()).toBe(
        CREATOR_USER_ID.toString(),
      );
      expect(row.projectCreatedByUserName).toBe("Jane Creator");
      expect(row.projectCreatedByUserEmail?.toString()).toBe("jane@acme.com");
    });

    /*
     * The common case: the owner deletes their own project. Looking the same
     * user up again would be a wasted query on a path that already did one.
     */
    it("does not re-query the user when the creator deleted their own project", async () => {
      await DeletedProjectService.logProjectDeletion({
        project: makeProject(),
        deletedByUserId: CREATOR_USER_ID,
      });

      expect(UserService.findOneById).not.toHaveBeenCalled();
      expect(created[0]?.data.projectDeletedByUserName).toBe("Jane Creator");
      expect(created[0]?.data.projectDeletedByUserEmail?.toString()).toBe(
        "jane@acme.com",
      );
    });

    it("looks up the deleting user when it was not the creator", async () => {
      const other: User = new User();
      other._id = OTHER_USER_ID.toString();
      other.name = new Name("Sam Admin");
      other.email = new Email("sam@acme.com");

      getJestSpyOn(UserService, "findOneById").mockResolvedValue(
        other as never,
      );

      await DeletedProjectService.logProjectDeletion({
        project: makeProject(),
        deletedByUserId: OTHER_USER_ID,
      });

      expect(UserService.findOneById).toHaveBeenCalled();

      const row: DeletedProject = created[0]!.data;

      expect(row.projectDeletedByUserId?.toString()).toBe(
        OTHER_USER_ID.toString(),
      );
      expect(row.projectDeletedByUserName).toBe("Sam Admin");
      expect(row.projectDeletedByUserEmail?.toString()).toBe("sam@acme.com");
      // The creator is still recorded separately.
      expect(row.projectCreatedByUserName).toBe("Jane Creator");
    });

    /*
     * API-key and root deletes have no acting user. The row is still worth
     * writing - the project and its billing history are the interesting part.
     */
    it("records the deletion when no user is attached to it", async () => {
      await DeletedProjectService.logProjectDeletion({
        project: makeProject(),
      });

      expect(UserService.findOneById).not.toHaveBeenCalled();
      expect(created).toHaveLength(1);
      expect(created[0]?.data.projectDeletedByUserId).toBeUndefined();
      expect(created[0]?.data.projectDeletedByUserName).toBeUndefined();
    });

    it("survives the deleting user no longer being findable", async () => {
      getJestSpyOn(UserService, "findOneById").mockResolvedValue(null as never);

      await DeletedProjectService.logProjectDeletion({
        project: makeProject(),
        deletedByUserId: OTHER_USER_ID,
      });

      expect(created).toHaveLength(1);
      expect(created[0]?.data.projectDeletedByUserId?.toString()).toBe(
        OTHER_USER_ID.toString(),
      );
      expect(created[0]?.data.projectDeletedByUserName).toBeUndefined();
    });

    it("records the deletion for a project whose creator is gone", async () => {
      const project: Project = makeProject();
      delete project.createdByUser;
      delete project.createdByUserId;

      await DeletedProjectService.logProjectDeletion({
        project: project,
        deletionReason: "No longer needed",
      });

      expect(created).toHaveLength(1);
      expect(created[0]?.data.projectCreatedByUserName).toBeUndefined();
      expect(created[0]?.data.deletionReason).toBe("No longer needed");
    });
  });

  describe("company details", () => {
    it("takes the company from the user who created the project", async () => {
      await DeletedProjectService.logProjectDeletion({
        project: makeProject(),
        deletedByUserId: CREATOR_USER_ID,
      });

      const row: DeletedProject = created[0]!.data;

      expect(row.companyName).toBe("Acme Inc.");
      expect(row.companyPhoneNumber?.toString()).toBe("+15555550100");
      expect(row.companySize).toBe(CompanySize.ElevenToFifty);
      expect(row.jobRole).toBe(JobRole.EngineeringManager);
    });

    /*
     * Company details are collected at signup, so an invited teammate often
     * has none. Falling back keeps a usable answer on the row.
     */
    it("falls back to the deleting user when the creator has no company on file", async () => {
      const project: Project = makeProject();
      project.createdByUser = new User();
      project.createdByUser._id = CREATOR_USER_ID.toString();
      project.createdByUser.name = new Name("Jane Creator");

      const deleter: User = new User();
      deleter._id = OTHER_USER_ID.toString();
      deleter.companyName = "Acme Subsidiary";
      deleter.companyPhoneNumber = new Phone("+15555550199");
      deleter.companySize = CompanySize.FiveHundredAndMore;
      deleter.jobRole = JobRole.CTO;

      getJestSpyOn(UserService, "findOneById").mockResolvedValue(
        deleter as never,
      );

      await DeletedProjectService.logProjectDeletion({
        project: project,
        deletedByUserId: OTHER_USER_ID,
      });

      const row: DeletedProject = created[0]!.data;

      expect(row.companyName).toBe("Acme Subsidiary");
      expect(row.companyPhoneNumber?.toString()).toBe("+15555550199");
      expect(row.companySize).toBe(CompanySize.FiveHundredAndMore);
      expect(row.jobRole).toBe(JobRole.CTO);
    });

    it("prefers the creator's company over the deleting user's", async () => {
      const deleter: User = new User();
      deleter._id = OTHER_USER_ID.toString();
      deleter.companyName = "Somewhere Else";

      getJestSpyOn(UserService, "findOneById").mockResolvedValue(
        deleter as never,
      );

      await DeletedProjectService.logProjectDeletion({
        project: makeProject(),
        deletedByUserId: OTHER_USER_ID,
      });

      expect(created[0]?.data.companyName).toBe("Acme Inc.");
    });

    it("writes the row even when nobody filled in a company", async () => {
      const project: Project = makeProject();
      project.createdByUser = new User();
      project.createdByUser._id = CREATOR_USER_ID.toString();

      await DeletedProjectService.logProjectDeletion({
        project: project,
        deletedByUserId: CREATOR_USER_ID,
      });

      expect(created).toHaveLength(1);
      expect(created[0]?.data.companyName).toBeUndefined();
    });
  });

  /*
   * The project id is what makes the row identifiable at all. A project
   * without one cannot have been in the database, so there is nothing to log.
   */
  it("does not write a row for a project with no id", async () => {
    const project: Project = makeProject();
    delete project._id;

    const result: DeletedProject | null =
      await DeletedProjectService.logProjectDeletion({
        project: project,
        deletedByUserId: CREATOR_USER_ID,
      });

    expect(result).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("returns the row it wrote", async () => {
    const result: DeletedProject | null =
      await DeletedProjectService.logProjectDeletion({
        project: makeProject(),
        deletedByUserId: CREATOR_USER_ID,
      });

    expect(result).not.toBeNull();
    expect(result?.projectName).toBe("Acme Monitoring");
  });
});
