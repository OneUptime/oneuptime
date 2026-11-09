import ProjectService from "../../../Server/Services/ProjectService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { DefaultTableColumnsUtil } from "../../../Types/Table/DefaultTableColumns";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * "Default columns per project" (#5485's follow-ups). A project keeps the
 * columns each of its lists shows everyone who has not chosen their own in
 * Project.defaultTableColumns: a Project Owner's or Admin's to write - the
 * same as the project's default network topology layout, a team-wide view
 * setting of the same kind - and readable by everyone with a place in the
 * project, because every one of them opens the lists. Whatever is written
 * reads as layouts, or is refused, by the Dashboard, the API and Terraform
 * alike.
 */

const COLUMN: string = "defaultTableColumns";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const INCIDENTS_DEFAULT: Record<string, unknown> = {
  "incidents-table": {
    order: ["incidentNumber", "title", "currentIncidentState", "labels"],
    hidden: ["labels"],
  },
};

function permissionRow(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: false,
  };
}

function propsWith(
  ...permissions: Array<Permission>
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map(permissionRow),
  };

  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  } as DatabaseCommonInteractionProps;
}

// Whether a caller holding these may write the data on a project.
function mayWrite(
  data: Record<string, unknown>,
  requestType: DatabaseRequestType,
  ...permissions: Array<Permission>
): boolean {
  const props: DatabaseCommonInteractionProps = propsWith(...permissions);

  try {
    TablePermission.checkTableLevelPermissions(Project, props, requestType);
    ColumnPermissions.checkDataColumnPermissions(
      Project,
      data as unknown as BaseModel,
      props,
      requestType,
    );
    return true;
  } catch {
    return false;
  }
}

interface ProjectHookAccess {
  onBeforeUpdate(updateBy: UpdateBy<Project>): Promise<OnUpdate<Project>>;
  onBeforeCreate(createBy: CreateBy<Project>): Promise<unknown>;
}

const hooks: ProjectHookAccess = ProjectService as unknown as ProjectHookAccess;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Project.defaultTableColumns: the column", () => {
  const project: Project = new Project();

  it("is optional JSON, titled and described for the API reference, with an example of one list's layout", () => {
    const metadata: {
      type: TableColumnType;
      required?: boolean;
      title?: string;
      description?: string;
      example?: unknown;
    } = project.getTableColumnMetadata(COLUMN) as unknown as {
      type: TableColumnType;
      required?: boolean;
      title?: string;
      description?: string;
      example?: unknown;
    };

    expect(metadata.type).toBe(TableColumnType.JSON);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("Default Table Columns");
    expect(metadata.description).toContain("who has not chosen their own");
    expect(
      DefaultTableColumnsUtil.getProblem(JSON.parse(String(metadata.example))),
    ).toBeNull();
  });

  it("a Project Owner or Project Admin writes it, and no one else - as the project's default topology layout", () => {
    expect(project.getColumnAccessControlFor(COLUMN)?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    expect(project.getColumnAccessControlFor(COLUMN)).toEqual(
      project.getColumnAccessControlFor("defaultNetworkTopologyLayout"),
    );
    // Nobody names it on a new project: it is set from a list.
    expect(project.getColumnAccessControlFor(COLUMN)?.create).toEqual([]);
  });

  it("everyone with a place in the project reads it, because everyone opens the lists", () => {
    expect(project.getColumnAccessControlFor(COLUMN)?.read).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ]);
  });

  it.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "the column layer lets %s write it, and clear it",
    (permission: Permission) => {
      expect(
        mayWrite(
          { [COLUMN]: INCIDENTS_DEFAULT },
          DatabaseRequestType.Update,
          permission,
        ),
      ).toBe(true);
      expect(
        mayWrite({ [COLUMN]: null }, DatabaseRequestType.Update, permission),
      ).toBe(true);
    },
  );

  it.each([
    Permission.ProjectMember,
    Permission.EditProject,
    Permission.ManageProjectBilling,
    Permission.BillingAdmin,
    Permission.Viewer,
    Permission.ReadProject,
    Permission.ProjectUser,
    Permission.CreateTableView,
    Permission.EditTableView,
  ])("and refuses %s", (permission: Permission) => {
    expect(
      mayWrite(
        { [COLUMN]: INCIDENTS_DEFAULT },
        DatabaseRequestType.Update,
        permission,
      ),
    ).toBe(false);
  });

  it("is not set when a project is created, even by its future owner", () => {
    expect(
      mayWrite(
        { name: "Acme Retail", [COLUMN]: INCIDENTS_DEFAULT },
        DatabaseRequestType.Create,
        Permission.User,
      ),
    ).toBe(false);
    expect(
      mayWrite(
        { name: "Acme Retail" },
        DatabaseRequestType.Create,
        Permission.User,
      ),
    ).toBe(true);
  });

  it("starts empty on a new project: every list shows its own columns", () => {
    expect(new Project().defaultTableColumns).toBeUndefined();
  });
});

describe("ProjectService.applyDefaultTableColumnsRules: what a project may store", () => {
  it("lists' layouts are stored as written", () => {
    const data: { defaultTableColumns?: unknown } = {
      defaultTableColumns: INCIDENTS_DEFAULT,
    };

    ProjectService.applyDefaultTableColumnsRules(data);

    expect(data.defaultTableColumns).toEqual(INCIDENTS_DEFAULT);
  });

  it("stored tidied: each id once, a layout that names nothing left out", () => {
    const data: { defaultTableColumns?: unknown } = {
      defaultTableColumns: {
        "incidents-table": {
          order: ["title", "title", "labels"],
          hidden: ["labels"],
        },
        "alerts-table": { order: [], hidden: [] },
      },
    };

    ProjectService.applyDefaultTableColumnsRules(data);

    expect(data.defaultTableColumns).toEqual({
      "incidents-table": { order: ["title", "labels"], hidden: ["labels"] },
    });
  });

  it("null clears it, and so does an object with no layout", () => {
    for (const value of [null, {}, { "incidents-table": { order: [] } }]) {
      const data: { defaultTableColumns?: unknown } = {
        defaultTableColumns: value,
      };

      ProjectService.applyDefaultTableColumnsRules(data);

      expect(data.defaultTableColumns).toBeNull();
    }
  });

  /*
   * An update that does not mention the column must not start writing it:
   * adding the key - even as null - would clear every list's default every
   * time someone renamed the project.
   */
  it("a write that leaves it out is not judged on it, and does not gain it", () => {
    const data: Record<string, unknown> = { name: "Renamed" };

    ProjectService.applyDefaultTableColumnsRules(data);

    expect(data).toEqual({ name: "Renamed" });
    expect(Object.prototype.hasOwnProperty.call(data, COLUMN)).toBe(false);
  });

  it.each([
    ["text", "incidents-table"],
    ["a list", ["title"]],
    ["a number", 42],
  ])("%s is refused: an object of lists", (_name: string, value: unknown) => {
    expect(() => {
      ProjectService.applyDefaultTableColumnsRules({
        defaultTableColumns: value,
      });
    }).toThrow(
      new BadDataException(
        "Default table columns must be an object of lists to their columns.",
      ),
    );
  });

  it("a layout that is no layout is refused, naming the list", () => {
    expect(() => {
      ProjectService.applyDefaultTableColumnsRules({
        defaultTableColumns: { "incidents-table": { order: "title" } },
      });
    }).toThrow(
      new BadDataException(
        "The order of incidents-table's default columns must be a list of column ids.",
      ),
    );
  });

  it("works on a Project model instance, as onBeforeCreate hands it one", () => {
    const project: Project = new Project();
    project.name = "Acme Retail";
    project.defaultTableColumns = {
      "incidents-table": { order: ["title", "title"], hidden: [] },
    };

    ProjectService.applyDefaultTableColumnsRules(project);

    expect(project.defaultTableColumns).toEqual({
      "incidents-table": { order: ["title"], hidden: [] },
    });
    expect(project.name).toBe("Acme Retail");
  });
});

describe("ProjectService: the rule runs on every write of the project", () => {
  it("an update with columns that are no layout is refused before anything is read", async () => {
    const find: SpyInstance<typeof ProjectService.findBy> = jest.spyOn(
      ProjectService,
      "findBy",
    );

    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: { defaultTableColumns: { "incidents-table": ["title"] } },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow(
      "The default columns of incidents-table must be an object with order and hidden.",
    );
    expect(find).not.toHaveBeenCalled();
  });

  it("an update with layouts is written tidied", async () => {
    const result: OnUpdate<Project> = await hooks.onBeforeUpdate({
      query: { _id: PROJECT_ID.toString() },
      data: {
        defaultTableColumns: {
          "incidents-table": { order: ["title", "title"], hidden: [] },
        },
      },
      props: { isRoot: true },
    } as unknown as UpdateBy<Project>);

    expect((result.updateBy.data as Record<string, unknown>)[COLUMN]).toEqual({
      "incidents-table": { order: ["title"], hidden: [] },
    });
  });

  it("a project created with columns that are no layout is refused", async () => {
    const project: Project = new Project();
    project.name = "Acme Retail";
    project.defaultTableColumns = { "incidents-table": "title" } as never;

    await expect(
      hooks.onBeforeCreate({
        data: project,
        props: { isRoot: true },
      } as unknown as CreateBy<Project>),
    ).rejects.toThrow(
      "The default columns of incidents-table must be an object with order and hidden.",
    );
  });
});
