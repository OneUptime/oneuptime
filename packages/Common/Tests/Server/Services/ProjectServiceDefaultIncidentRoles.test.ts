import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import Project from "../../../Models/DatabaseModels/Project";
import IncidentRoleService from "../../../Server/Services/IncidentRoleService";
import ProjectService from "../../../Server/Services/ProjectService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { Purple500 } from "../../../Types/BrandColors";
import BadDataException from "../../../Types/Exception/BadDataException";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { SpyInstance } from "jest-mock";

/*
 * The incident roles a new project starts with.
 *
 * The maintainer, on Incidents → Settings → Incident Roles: "To make things
 * simple, can we remove all the roles except Incident Commander by default?
 * People can add more roles if they feel like."
 *
 * So a project is seeded with Incident Commander alone - no Responder, no
 * Communications Lead, no Observer - and Incident Commander stays what the
 * product relies on: the primary role (the declare form and the first state
 * change fill it), never deleted, held by one person. A project that has
 * roles keeps every one of them: the seeder only ever adds.
 *
 * Nothing here touches a database: the seeder runs against spied services,
 * and the project-creation hook and the backfill for older projects, which
 * live behind a full create and in another workspace, are read off the
 * source.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const PROJECT_SERVICE_SOURCE: string = fs.readFileSync(
  path.join(__dirname, "../../../Server/Services/ProjectService.ts"),
  "utf8",
);

const BACKFILL_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "../../../../App/FeatureSet/Workers/DataMigrations/AddDefaultIncidentRolesToExistingProjects.ts",
  ),
  "utf8",
);

const RETIRED_DEFAULT_ROLES: Array<string> = [
  "Responder",
  "Communications Lead",
  "Observer",
];

function newProject(): Project {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();

  return project;
}

function existingRole(name: string): IncidentRole {
  const role: IncidentRole = new IncidentRole();
  role._id = ObjectID.generate().toString();
  role.name = name;

  return role;
}

describe("a new project's incident roles", () => {
  let findBySpy: SpyInstance;
  let createSpy: SpyInstance;
  let deleteSpy: SpyInstance;
  let updateSpy: SpyInstance;

  beforeEach(() => {
    // getExistingProjectScopedNames reads the project's roles through findBy.
    findBySpy = jest
      .spyOn(IncidentRoleService, "findBy")
      .mockResolvedValue([] as never);

    createSpy = jest
      .spyOn(IncidentRoleService, "create")
      .mockImplementation((async (
        createBy: CreateBy<IncidentRole>,
      ): Promise<IncidentRole> => {
        return createBy.data;
      }) as never);

    deleteSpy = jest
      .spyOn(IncidentRoleService, "deleteBy")
      .mockResolvedValue(0 as never);

    updateSpy = jest
      .spyOn(IncidentRoleService, "updateBy")
      .mockResolvedValue(0 as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function seededRoles(): Array<IncidentRole> {
    return createSpy.mock.calls.map((call: Array<unknown>): IncidentRole => {
      return (call[0] as CreateBy<IncidentRole>).data;
    });
  }

  test("are Incident Commander, and nothing else", async () => {
    await ProjectService.addDefaultIncidentRoles(newProject());

    expect(
      seededRoles().map((role: IncidentRole): string | undefined => {
        return role.name;
      }),
    ).toEqual(["Incident Commander"]);
  });

  test("no longer include Responder, Communications Lead or Observer", async () => {
    await ProjectService.addDefaultIncidentRoles(newProject());

    const names: Array<string | undefined> = seededRoles().map(
      (role: IncidentRole): string | undefined => {
        return role.name;
      },
    );

    for (const retired of RETIRED_DEFAULT_ROLES) {
      expect(names).not.toContain(retired);
    }
  });

  test("Incident Commander is the primary role, cannot be deleted, and is one person", async () => {
    await ProjectService.addDefaultIncidentRoles(newProject());

    const commander: IncidentRole = seededRoles()[0]!;

    expect(commander.isPrimaryRole).toBe(true);
    expect(commander.isDeleteable).toBe(false);
    expect(commander.canAssignMultipleUsers).not.toBe(true);
  });

  test("Incident Commander keeps its look and its description", async () => {
    await ProjectService.addDefaultIncidentRoles(newProject());

    const commander: IncidentRole = seededRoles()[0]!;

    expect(commander.roleIcon).toBe(IconProp.ShieldCheck);
    expect(commander.color?.toString()).toBe(Purple500.toString());
    expect(commander.description).toBe(
      "Primary decision maker during an incident. Responsible for coordinating the response and making final decisions.",
    );
  });

  test("it is created in the project, as root", async () => {
    await ProjectService.addDefaultIncidentRoles(newProject());

    const createBy: CreateBy<IncidentRole> = createSpy.mock
      .calls[0]![0] as CreateBy<IncidentRole>;

    expect(createBy.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(createBy.props.isRoot).toBe(true);
  });

  test("the seeder reads the project's own roles before it adds one", async () => {
    await ProjectService.addDefaultIncidentRoles(newProject());

    expect(findBySpy).toHaveBeenCalledTimes(1);

    const query: Record<string, unknown> = (
      findBySpy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
  });

  test("running it twice adds nothing the second time", async () => {
    findBySpy.mockResolvedValue([existingRole("Incident Commander")] as never);

    await ProjectService.addDefaultIncidentRoles(newProject());

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a project that already has the old roles keeps them, and gets only what it lacks", async () => {
    findBySpy.mockResolvedValue(
      RETIRED_DEFAULT_ROLES.map((name: string): IncidentRole => {
        return existingRole(name);
      }) as never,
    );

    await ProjectService.addDefaultIncidentRoles(newProject());

    expect(
      seededRoles().map((role: IncidentRole): string | undefined => {
        return role.name;
      }),
    ).toEqual(["Incident Commander"]);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a project with all four of the old defaults is left exactly as it is", async () => {
    findBySpy.mockResolvedValue(
      ["Incident Commander", ...RETIRED_DEFAULT_ROLES].map(
        (name: string): IncidentRole => {
          return existingRole(name);
        },
      ) as never,
    );

    await ProjectService.addDefaultIncidentRoles(newProject());

    expect(createSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("hands back the project it was given", async () => {
    const project: Project = newProject();

    await expect(ProjectService.addDefaultIncidentRoles(project)).resolves.toBe(
      project,
    );
  });
});

describe("where the seeder runs", () => {
  /*
   * Alongside the other default rows, in the project-creation hook: a
   * project's first incident would otherwise have no Incident Commander to
   * fill.
   */
  test("the project-creation hook seeds the roles with the other defaults", () => {
    const start: number = PROJECT_SERVICE_SOURCE.indexOf("await Promise.all([");

    expect(start).toBeGreaterThan(-1);

    const promiseAllBlock: string = PROJECT_SERVICE_SOURCE.slice(
      start,
      PROJECT_SERVICE_SOURCE.indexOf("]);", start),
    );

    expect(promiseAllBlock).toContain(
      "this.addDefaultIncidentRoles(createdItem)",
    );
  });

  /*
   * The backfill for projects from before roles existed goes through the
   * same seeder, so such a project now gets Incident Commander alone too -
   * and only when it has no role at all, so no project that has roles is
   * touched.
   */
  test("the backfill for older projects seeds through it, only for a project with no roles", () => {
    expect(BACKFILL_SOURCE).toContain(
      "await ProjectService.addDefaultIncidentRoles(project)",
    );
    expect(BACKFILL_SOURCE).toContain("if (existingRoles.length === 0)");
  });

  test("the seeder writes no other role name anywhere in ProjectService", () => {
    for (const retired of RETIRED_DEFAULT_ROLES) {
      expect(PROJECT_SERVICE_SOURCE).not.toContain(`name = "${retired}"`);
    }
  });
});

/*
 * What the settings page relies on: Incident Commander's Delete is locked
 * because the server refuses it, and its form leaves Allow Multiple Users
 * out because the server refuses that too. The seeded role is run through
 * IncidentRoleService's own hooks.
 */
describe("the server rules Incident Commander lives by", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function seededCommander(): Promise<IncidentRole> {
    jest.spyOn(IncidentRoleService, "findBy").mockResolvedValue([] as never);

    let seeded: IncidentRole | null = null;

    jest.spyOn(IncidentRoleService, "create").mockImplementation((async (
      createBy: CreateBy<IncidentRole>,
    ): Promise<IncidentRole> => {
      seeded = createBy.data;
      return createBy.data;
    }) as never);

    await ProjectService.addDefaultIncidentRoles(newProject());

    jest.restoreAllMocks();

    expect(seeded).not.toBeNull();

    return seeded!;
  }

  test("the seeded role passes the create check (primary, one person)", async () => {
    const commander: IncidentRole = await seededCommander();

    await expect(
      (IncidentRoleService as any).onBeforeCreate({
        data: commander,
        props: { isRoot: true },
      }),
    ).resolves.toBeTruthy();
  });

  test("a primary role that allows more than one person is refused", async () => {
    const commander: IncidentRole = await seededCommander();
    commander.canAssignMultipleUsers = true;

    await expect(
      (IncidentRoleService as any).onBeforeCreate({
        data: commander,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("turning Allow Multiple Users on for it is refused", async () => {
    const commander: IncidentRole = await seededCommander();
    commander._id = ObjectID.generate().toString();

    jest
      .spyOn(IncidentRoleService, "findOneById")
      .mockResolvedValue(commander as never);

    const updateBy: UpdateBy<IncidentRole> = {
      query: { _id: commander._id },
      data: { canAssignMultipleUsers: true },
      props: { isRoot: true },
    } as unknown as UpdateBy<IncidentRole>;

    await expect(
      (IncidentRoleService as any).onBeforeUpdate(updateBy),
    ).rejects.toThrow("Primary roles cannot allow multiple users to be assigned.");
  });

  test("deleting it is refused, in words that name it", async () => {
    const commander: IncidentRole = await seededCommander();

    jest
      .spyOn(IncidentRoleService, "findBy")
      .mockResolvedValue([commander] as never);

    const deleteBy: DeleteBy<IncidentRole> = {
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    } as unknown as DeleteBy<IncidentRole>;

    await expect(
      (IncidentRoleService as any).onBeforeDelete(deleteBy),
    ).rejects.toThrow(
      "Incident Commander role cannot be deleted because it is a required role for incident management.",
    );
  });

  test("a role the project added can be deleted", async () => {
    const responder: IncidentRole = existingRole("Responder");
    responder.isDeleteable = true;

    jest
      .spyOn(IncidentRoleService, "findBy")
      .mockResolvedValue([responder] as never);

    const deleteBy: DeleteBy<IncidentRole> = {
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    } as unknown as DeleteBy<IncidentRole>;

    await expect(
      (IncidentRoleService as any).onBeforeDelete(deleteBy),
    ).resolves.toBeTruthy();
  });
});
