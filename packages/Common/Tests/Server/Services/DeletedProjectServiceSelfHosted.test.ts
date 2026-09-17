import DeletedProjectService from "../../../Server/Services/DeletedProjectService";
import UserService from "../../../Server/Services/UserService";
import DeletedProject from "../../../Models/DatabaseModels/DeletedProject";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * The deletion audit trail is for reaching out to SaaS customers who left.
 * A self-hosted install has nobody to reach out to, and the operator deleting
 * their own project has not agreed to OneUptime keeping a copy of who they
 * are - so on IsBillingEnabled=false nothing is recorded at all.
 *
 * The flag is read at module scope, so this is a separate file from the
 * billing-on suite rather than a case inside it.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: false,
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

describe("DeletedProjectService.logProjectDeletion on a self-hosted install", () => {
  beforeEach(() => {
    getJestSpyOn(DeletedProjectService, "create").mockResolvedValue(
      new DeletedProject() as never,
    );
    getJestSpyOn(UserService, "findOneById").mockResolvedValue(null as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not record anything", async () => {
    const project: Project = new Project();
    project._id = PROJECT_ID.toString();
    project.name = "Self Hosted Project";

    const result: DeletedProject | null =
      await DeletedProjectService.logProjectDeletion({
        project: project,
        deletedByUserId: USER_ID,
        deletionReason: "Shutting down the instance",
      });

    expect(result).toBeNull();
    expect(DeletedProjectService.create).not.toHaveBeenCalled();
  });

  it("does not go looking up the user either", async () => {
    const project: Project = new Project();
    project._id = PROJECT_ID.toString();
    project.name = "Self Hosted Project";

    await DeletedProjectService.logProjectDeletion({
      project: project,
      deletedByUserId: USER_ID,
    });

    expect(UserService.findOneById).not.toHaveBeenCalled();
  });
});
