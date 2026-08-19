import { afterEach, describe, expect, test } from "@jest/globals";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import Project from "../../../Models/DatabaseModels/Project";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";

/*
 * getCommonHeaders runs on EVERY model request (create/update/getList/count/
 * getItem/delete) and used to hydrate the entire ~179-column Project model
 * from LocalStorage just to read the tenant id. It now reads the id via
 * ProjectUtil.getCurrentProjectId() - a plain string read - and only falls
 * back to the full getCurrentProject() hydration when no id is available.
 *
 * The priority-order contract these tests pin:
 *   1. getCurrentProjectId() wins whenever it yields an id, and the expensive
 *      getCurrentProject() hydration must NOT run at all (the perf win).
 *   2. The SSO-login window keeps working: the project id is already in
 *      URL/SessionStorage but the full project JSON has not been fetched yet -
 *      the tenant id header must still be sent.
 *   3. The historical fallback to the hydrated project is preserved for the
 *      case where the id read yields nothing.
 *   4. Multi-tenant requests carry no tenant id at all.
 */

const PROJECT_ID: string = "019acd20-1111-4111-8111-111111111111";
const FALLBACK_PROJECT_ID: string = "019acd20-2222-4222-8222-222222222222";

type BuildProjectFunction = (id: string) => Project;

const buildProject: BuildProjectFunction = (id: string): Project => {
  const project: Project = new Project();
  project.id = new ObjectID(id);

  return project;
};

describe("ModelAPI.getCommonHeaders tenant id resolution", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads the tenant id from getCurrentProjectId() without hydrating the full project", () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));

    const getCurrentProject: jest.SpyInstance = jest
      .spyOn(ProjectUtil, "getCurrentProject")
      .mockReturnValue(buildProject(PROJECT_ID));

    const headers: Dictionary<string> = ModelAPI.getCommonHeaders();

    expect(headers["tenantid"]).toBe(PROJECT_ID);

    /*
     * The whole point of the change: the cheap string read is enough, so the
     * BaseModel.fromJSON hydration of the stored project must not run.
     */
    expect(getCurrentProject).not.toHaveBeenCalled();
  });

  test("still sends the tenant id in the SSO-login window (id known, project data not fetched yet)", () => {
    /*
     * After SSO login the project id is available in URL/SessionStorage but
     * localStorage has no project JSON yet, so getCurrentProject() would
     * return null. The header must be sent regardless.
     */
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));

    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(null);

    const headers: Dictionary<string> = ModelAPI.getCommonHeaders();

    expect(headers["tenantid"]).toBe(PROJECT_ID);
  });

  test("falls back to the hydrated project when no project id can be read", () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    const getCurrentProject: jest.SpyInstance = jest
      .spyOn(ProjectUtil, "getCurrentProject")
      .mockReturnValue(buildProject(FALLBACK_PROJECT_ID));

    const headers: Dictionary<string> = ModelAPI.getCommonHeaders();

    expect(headers["tenantid"]).toBe(FALLBACK_PROJECT_ID);
    expect(getCurrentProject).toHaveBeenCalledTimes(1);
  });

  test("sends no tenant id when neither source yields a project", () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(null);

    const headers: Dictionary<string> = ModelAPI.getCommonHeaders();

    expect(headers).not.toHaveProperty("tenantid");
  });

  test("multi-tenant requests carry the multi-tenant flag instead of a tenant id", () => {
    const getCurrentProjectId: jest.SpyInstance = jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));

    const getCurrentProject: jest.SpyInstance = jest
      .spyOn(ProjectUtil, "getCurrentProject")
      .mockReturnValue(buildProject(PROJECT_ID));

    const headers: Dictionary<string> = ModelAPI.getCommonHeaders({
      isMultiTenantRequest: true,
    });

    expect(headers).not.toHaveProperty("tenantid");
    expect(headers["is-multi-tenant-query"]).toBe("true");

    // a multi-tenant request should not read the project at all.
    expect(getCurrentProjectId).not.toHaveBeenCalled();
    expect(getCurrentProject).not.toHaveBeenCalled();
  });
});
