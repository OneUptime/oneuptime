import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import Project from "Common/Models/DatabaseModels/Project";
import IncidentRoleService from "Common/Server/Services/IncidentRoleService";
import ProjectService from "Common/Server/Services/ProjectService";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import FindBy from "Common/Server/Types/Database/FindBy";
import ObjectID from "Common/Types/ObjectID";
import AddDefaultIncidentRolesToExistingProjects from "../../../FeatureSet/Workers/DataMigrations/AddDefaultIncidentRolesToExistingProjects";
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

/*
 * AddDefaultIncidentRolesToExistingProjects gives a project that has no
 * incident roles at all the ones a new project starts with. It seeds through
 * ProjectService.addDefaultIncidentRoles, so since new projects start with
 * Incident Commander alone, so does a project it seeds - and a project that
 * already has roles, the old four defaults among them, is not touched.
 *
 * Run end to end with the real seeder; only the two services' reads and
 * writes are stubbed, answering from a per-project list of roles.
 */

const EMPTY_PROJECT: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OLD_DEFAULTS_PROJECT: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CUSTOM_ROLES_PROJECT: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const OLD_DEFAULTS: Array<string> = [
  "Incident Commander",
  "Responder",
  "Communications Lead",
  "Observer",
];

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

function project(id: ObjectID): Project {
  const item: Project = new Project();
  item._id = id.toString();
  return item;
}

function rolesNamed(names: Array<string>): Array<IncidentRole> {
  return names.map((name: string): IncidentRole => {
    const role: IncidentRole = new IncidentRole();
    role._id = ObjectID.generate().toString();
    role.name = name;
    return role;
  });
}

describe("AddDefaultIncidentRolesToExistingProjects", () => {
  let rolesByProject: Map<string, Array<IncidentRole>>;
  let created: Array<IncidentRole>;

  beforeEach(() => {
    rolesByProject = new Map<string, Array<IncidentRole>>([
      [EMPTY_PROJECT.toString(), []],
      [OLD_DEFAULTS_PROJECT.toString(), rolesNamed(OLD_DEFAULTS)],
      [CUSTOM_ROLES_PROJECT.toString(), rolesNamed(["Scribe"])],
    ]);
    created = [];

    jest
      .spyOn(ProjectService, "findBy")
      .mockResolvedValue([
        project(EMPTY_PROJECT),
        project(OLD_DEFAULTS_PROJECT),
        project(CUSTOM_ROLES_PROJECT),
      ] as never);

    jest.spyOn(IncidentRoleService, "findBy").mockImplementation((async (
      findBy: FindBy<IncidentRole>,
    ): Promise<Array<IncidentRole>> => {
      const projectId: string = String(
        (findBy.query as { projectId?: unknown }).projectId,
      );

      return rolesByProject.get(projectId) || [];
    }) as never);

    jest.spyOn(IncidentRoleService, "create").mockImplementation((async (
      createBy: CreateBy<IncidentRole>,
    ): Promise<IncidentRole> => {
      created.push(createBy.data);
      return createBy.data;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a project with no roles gets Incident Commander, and nothing else", async () => {
    await new AddDefaultIncidentRolesToExistingProjects().migrate();

    const forEmptyProject: Array<IncidentRole> = created.filter(
      (role: IncidentRole): boolean => {
        return role.projectId?.toString() === EMPTY_PROJECT.toString();
      },
    );

    expect(
      forEmptyProject.map((role: IncidentRole): string | undefined => {
        return role.name;
      }),
    ).toEqual(["Incident Commander"]);
    expect(forEmptyProject[0]!.isPrimaryRole).toBe(true);
    expect(forEmptyProject[0]!.isDeleteable).toBe(false);
  });

  test("a project with the old four defaults keeps them, and gets nothing", async () => {
    await new AddDefaultIncidentRolesToExistingProjects().migrate();

    expect(
      created.filter((role: IncidentRole): boolean => {
        return role.projectId?.toString() === OLD_DEFAULTS_PROJECT.toString();
      }),
    ).toEqual([]);
  });

  test("a project with roles of its own is not touched", async () => {
    await new AddDefaultIncidentRolesToExistingProjects().migrate();

    expect(
      created.filter((role: IncidentRole): boolean => {
        return role.projectId?.toString() === CUSTOM_ROLES_PROJECT.toString();
      }),
    ).toEqual([]);
  });

  test("across all projects, the only role written is one Incident Commander", async () => {
    await new AddDefaultIncidentRolesToExistingProjects().migrate();

    expect(created).toHaveLength(1);
    expect(created[0]!.name).toBe("Incident Commander");
  });

  test("is still registered, under its own name", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain("new AddDefaultIncidentRolesToExistingProjects(),");
    expect(new AddDefaultIncidentRolesToExistingProjects().name).toBe(
      "AddDefaultIncidentRolesToExistingProjects",
    );
  });
});
