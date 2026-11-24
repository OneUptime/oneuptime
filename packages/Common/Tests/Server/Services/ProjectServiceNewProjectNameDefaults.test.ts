import DatabaseConfig from "../../../Server/DatabaseConfig";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { columnsTheCreateWrote } from "../TestingUtils/ColumnsSetByServer";

/*
 * A NEW PROJECT REQUIRES UNIQUE NAMES; A PROJECT THAT EXISTED BEFORE DOES
 * NOT UNTIL AN OWNER TURNS IT ON (#10761).
 *
 * The switch is turned on by ProjectService.onBeforeCreate when the create
 * request leaves it unset - every project created in the Dashboard - and
 * NOT by its column's default, which stays off: an upgrade must refuse no
 * name a project's API clients or Terraform configurations already rely
 * on, and a default reaches the generated Terraform provider as a static
 * default that would flip Terraform-managed projects on their next apply.
 * (The migration that adds the column off for every project that exists
 * is proven on Postgres: RequiredUniqueNamesPostgres.)
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: false,
    NotificationSlackWebhookOnCreateProject: "",
  };
});

const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555510761");

function userProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public, Permission.User],
      projectIds: [],
      _type: "UserGlobalAccessPermission",
    },
  } as DatabaseCommonInteractionProps;
}

async function runOnBeforeCreate(
  project: Project,
  props: DatabaseCommonInteractionProps = userProps(),
): Promise<Project> {
  const result: OnCreate<Project> = await (
    ProjectService as unknown as {
      onBeforeCreate: (
        createBy: CreateBy<Project>,
      ) => Promise<OnCreate<Project>>;
    }
  ).onBeforeCreate({
    data: project,
    props,
  } as CreateBy<Project>);

  return result.createBy.data;
}

describe("the Require Unique Names column", () => {
  it("is a switch that is off in its column, so every project that exists keeps letting names repeat", () => {
    const metadata: ReturnType<Project["getTableColumnMetadata"]> =
      new Project().getTableColumnMetadata("requireUniqueNames");

    expect(metadata?.type).toBe(TableColumnType.Boolean);
    expect(metadata?.required).toBe(true);
    expect(metadata?.defaultValue).toBe(false);
    expect(metadata?.isDefaultValueColumn).toBe(true);
    expect(metadata?.title).toBe("Require Unique Names");
    expect(metadata?.description).toContain("On for new projects.");
    expect(metadata?.description?.length).toBeLessThanOrEqual(150);
  });

  it("only a Project Owner or Admin changes it; every member reads it", () => {
    const access: ReturnType<Project["getColumnAccessControlFor"]> =
      new Project().getColumnAccessControlFor("requireUniqueNames");

    expect(access?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    expect(access?.read).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
      ]),
    );
    // Whoever creates a project may say whether it starts on.
    expect(access?.create).toEqual(expect.arrayContaining([Permission.User]));
  });
});

describe("ProjectService.applyNewProjectNameDefaults", () => {
  it("turns it on when the request leaves it unset or null", () => {
    const unset: { requireUniqueNames?: boolean | null } = {};
    const asNull: { requireUniqueNames?: boolean | null } = {
      requireUniqueNames: null,
    };

    ProjectService.applyNewProjectNameDefaults(unset);
    ProjectService.applyNewProjectNameDefaults(asNull);

    expect(unset.requireUniqueNames).toBe(true);
    expect(asNull.requireUniqueNames).toBe(true);
  });

  it("keeps what the request says, off or on", () => {
    const off: { requireUniqueNames?: boolean | null } = {
      requireUniqueNames: false,
    };
    const on: { requireUniqueNames?: boolean | null } = {
      requireUniqueNames: true,
    };

    ProjectService.applyNewProjectNameDefaults(off);
    ProjectService.applyNewProjectNameDefaults(on);

    expect(off.requireUniqueNames).toBe(false);
    expect(on.requireUniqueNames).toBe(true);
  });
});

describe("ProjectService.onBeforeCreate: names in a new project", () => {
  beforeEach(() => {
    getJestSpyOn(UserService, "findOneById").mockResolvedValue(
      new User() as never,
    );
    getJestSpyOn(
      DatabaseConfig,
      "shouldDisableUserProjectCreation",
    ).mockResolvedValue(false as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("a project created in the Dashboard requires unique names", async () => {
    const project: Project = new Project();
    project.name = "Acme";

    const created: Project = await runOnBeforeCreate(project);

    expect(created.requireUniqueNames).toBe(true);
  });

  it("a create request that turns it off - through the API or Terraform - keeps it off", async () => {
    const project: Project = new Project();
    project.name = "Acme";
    project.requireUniqueNames = false;

    const created: Project = await runOnBeforeCreate(project);

    expect(created.requireUniqueNames).toBe(false);
  });

  it("applies to a root create too: a project OneUptime makes for someone", async () => {
    const project: Project = new Project();
    project.name = "Seeded";

    const created: Project = await runOnBeforeCreate(project, {
      userId: USER_ID,
      isRoot: true,
    });

    expect(created.requireUniqueNames).toBe(true);
  });

  it("what the hook sets still passes the column permission check of a non-root create", async () => {
    const project: Project = new Project();
    project.name = "Acme";

    const created: Project = await runOnBeforeCreate(project);

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        Project,
        created,
        userProps(),
        DatabaseRequestType.Create,
        columnsTheCreateWrote(created),
      );
    }).not.toThrow();
  });
});
