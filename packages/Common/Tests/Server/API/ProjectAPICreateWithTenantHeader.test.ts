import ProjectAPI from "../../../Server/API/ProjectAPI";
import ProjectService from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import { mockRouter } from "./Helpers";
import {
  globalPermissionFor,
  ownerOf,
  postProject,
  putIdOnProjectAfterTheHooks,
  ProjectRouteResult,
  stubProjectCreateSideEffects,
  stubSignedInUser,
} from "./ProjectCreateTestHelpers";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * POST /api/project with a `tenantid` (or `projectid`) header.
 *
 * Project's tenant column is its own primary key (`@TenantColumn("_id")`),
 * and DatabaseService.create stamped the request's tenant onto the tenant
 * column of every row it created - so a project created with a tenant header
 * was handed the id of the project the header named. save() takes an entity
 * that carries an existing id as an UPDATE of that row. The request only
 * failed, with a 500 ("invalid input syntax for type uuid:
 * "{"_type":"ObjectID",...}""), because the stamped id was an ObjectID; as a
 * plain string it would have rewritten the named project, and the header is
 * not even required to name a project the caller belongs to.
 *
 * Now the tenant has no bearing on a project create: the header is ignored,
 * the new project is inserted, and a create that reaches save() carrying an
 * id it may not have is refused rather than saved.
 *
 * Driven through the route ProjectAPI registers, with the real user
 * middleware, BaseAPI.createItem and ProjectService.create - hooks,
 * permission checks and all (see ProjectCreateTestHelpers). The repository is
 * stubbed: its save() records the entity it was handed.
 * ProjectCreateWithTenantHeaderPostgres.test.ts sends the same request at a
 * real Project table, where INSERT and UPDATE are the database's to tell
 * apart.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
    NotificationSlackWebhookOnCreateProject: "",
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const USER_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");

// The project the caller is working in, which they own.
const CURRENT_PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

// Someone else's project. The middleware accepts it as a tenant all the same.
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

const GENERATED_PROJECT_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// What the middleware leaves behind for a signed-in owner of CURRENT_PROJECT_ID.
function ownerProps(
  tenantId: ObjectID = CURRENT_PROJECT_ID,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: tenantId,
    userGlobalAccessPermission: globalPermissionFor(CURRENT_PROJECT_ID),
    userTenantAccessPermission: {
      [CURRENT_PROJECT_ID.toString()]: ownerOf(CURRENT_PROJECT_ID),
    },
  };
}

describe("POST /api/project with a tenant header", () => {
  // The primary key of every entity handed to save(), as it was at the time.
  let idsHandedToSave: Array<unknown>;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new ProjectAPI();
  });

  beforeEach(() => {
    idsHandedToSave = [];

    /*
     * As TypeORM's save() does for an INSERT, a row without an id is given
     * one. A row that already carries an id would be UPDATEd - which is
     * exactly what must never be reached, so the id it arrived with is kept.
     */
    const save: (entity: Project) => Promise<Project> = jest.fn(
      async (entity: Project): Promise<Project> => {
        idsHandedToSave.push(entity._id);

        if (!entity._id) {
          entity._id = GENERATED_PROJECT_ID;
        }

        return entity;
      },
    );

    getJestSpyOn(ProjectService, "getRepository").mockReturnValue({
      save,
    } as never);

    // The same-name and unique-slug checks: no clash.
    getJestSpyOn(ProjectService, "countBy").mockResolvedValue(
      new PositiveNumber(0) as never,
    );

    stubSignedInUser({ userId: USER_ID, ownedProjectId: CURRENT_PROJECT_ID });
    stubProjectCreateSideEffects();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectANewProject(result: ProjectRouteResult): void {
    // Not a 500, nor any other error.
    expect(result.forwardedError).toBeUndefined();

    // INSERTed: save() was handed a project without an id...
    expect(idsHandedToSave).toEqual([undefined]);

    // ...and the response is the project it created, not one that existed.
    expect(result.sentProject?._id).toBe(GENERATED_PROJECT_ID);
    expect(result.sentProject?.name).toBe("x");
  }

  test("a tenantid header naming the caller's own project creates a new project", async () => {
    expectANewProject(
      await postProject({ tenantid: CURRENT_PROJECT_ID.toString() }),
    );
  });

  test("so does a projectid header, and both together, as in the report", async () => {
    expectANewProject(
      await postProject({ projectid: CURRENT_PROJECT_ID.toString() }),
    );

    idsHandedToSave = [];

    expectANewProject(
      await postProject({
        tenantid: CURRENT_PROJECT_ID.toString(),
        projectid: CURRENT_PROJECT_ID.toString(),
      }),
    );
  });

  test("a tenant header naming a project the caller does not belong to creates a new project too, and never touches that one", async () => {
    const result: ProjectRouteResult = await postProject({
      tenantid: OTHER_PROJECT_ID.toString(),
    });

    expectANewProject(result);
    expect(result.sentProject?._id).not.toBe(OTHER_PROJECT_ID.toString());
  });

  test("an upper-case tenant id, which Postgres would match all the same, changes nothing", async () => {
    expectANewProject(
      await postProject({
        tenantid: CURRENT_PROJECT_ID.toString().toUpperCase(),
      }),
    );
  });

  test("the same request without a tenant header, as the Dashboard sends it, is unchanged", async () => {
    expectANewProject(await postProject({}));
  });

  describe("a create can never turn into an update of the tenant's project", () => {
    function aProject(): Project {
      const project: Project = new Project();
      project.name = "x";
      return project;
    }

    test("a tenant id that reaches create() as a plain string is not stamped onto the new project either", async () => {
      const created: Project = await ProjectService.create({
        data: aProject(),
        props: ownerProps(CURRENT_PROJECT_ID.toString() as unknown as ObjectID),
      });

      expect(idsHandedToSave).toEqual([undefined]);
      expect(created._id).toBe(GENERATED_PROJECT_ID);
    });

    test.each([
      ["a plain string", CURRENT_PROJECT_ID.toString()],
      ["an ObjectID", CURRENT_PROJECT_ID],
      ["another project's id", OTHER_PROJECT_ID.toString()],
    ])(
      "a member's create that reaches save() carrying %s as its id is refused with a 400, not saved",
      async (_label: string, id: string | ObjectID) => {
        putIdOnProjectAfterTheHooks(id);

        await expect(
          ProjectService.create({ data: aProject(), props: ownerProps() }),
        ).rejects.toThrow(
          new BadDataException(
            "An id cannot be supplied when creating Project.",
          ),
        );

        expect(idsHandedToSave).toEqual([]);
      },
    );

    /*
     * Workflow components create as root WITH a tenant, after their own
     * generic stamp (applyTenantColumn) has written the tenant column - for
     * Project, the id. Root may assign ids, but never this one.
     */
    test.each([
      ["a plain string", CURRENT_PROJECT_ID.toString()],
      ["an upper-case string", CURRENT_PROJECT_ID.toString().toUpperCase()],
      ["an ObjectID", CURRENT_PROJECT_ID],
    ])(
      "a root create made in a project and carrying that project's id as %s is refused, not saved",
      async (_label: string, id: string | ObjectID) => {
        const project: Project = aProject();
        (project as unknown as Dictionary<unknown>)["_id"] = id;

        await expect(
          ProjectService.create({
            data: project,
            props: {
              isRoot: true,
              userId: USER_ID,
              tenantId: CURRENT_PROJECT_ID,
            },
          }),
        ).rejects.toThrow(
          new BadDataException(
            "A new Project cannot take the id of the Project this request is made in.",
          ),
        );

        expect(idsHandedToSave).toEqual([]);
      },
    );

    test("a root create may still choose the new project's id, as seeding does", async () => {
      const project: Project = aProject();
      project._id = GENERATED_PROJECT_ID;

      const created: Project = await ProjectService.create({
        data: project,
        props: { isRoot: true, userId: USER_ID },
      });

      expect(idsHandedToSave).toEqual([GENERATED_PROJECT_ID]);
      expect(created._id).toBe(GENERATED_PROJECT_ID);
    });
  });
});
