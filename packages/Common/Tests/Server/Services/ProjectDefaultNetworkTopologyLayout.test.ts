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
import { NETWORK_TOPOLOGY_LAYOUTS } from "../../../Types/NetworkDevice/NetworkTopologyLayout";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ISSUE #5378: "Allow administrators to set a default network topology
 * layout". A project keeps the layout its network maps open on in
 * Project.defaultNetworkTopologyLayout: a Project Owner's or Admin's to
 * write - as the issue asks, and as the project's other settings are -
 * readable by everyone with a place in the project, because every one of
 * them opens the map. Whatever is written is one of the layouts' ids or
 * nothing, by the Dashboard, the API and Terraform alike.
 */

const COLUMN: string = "defaultNetworkTopologyLayout";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

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

describe("Project.defaultNetworkTopologyLayout: the column", () => {
  const project: Project = new Project();

  it("is optional short text, titled and described for the API reference", () => {
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

    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("Default Network Topology Layout");
    expect(metadata.example).toBe("parentChild");
    expect(metadata.description!.length).toBeLessThanOrEqual(160);
  });

  it("says the layouts it takes, so the API reference lists them and Terraform refuses any other at plan time", () => {
    expect(
      (
        project.getTableColumnMetadata(COLUMN) as unknown as {
          allowedValues?: ReadonlyArray<string>;
        }
      ).allowedValues,
    ).toEqual([...NETWORK_TOPOLOGY_LAYOUTS]);
  });

  it("its description names every layout id it may hold", () => {
    const description: string =
      (
        project.getTableColumnMetadata(COLUMN) as unknown as {
          description: string;
        }
      ).description || "";

    for (const layout of NETWORK_TOPOLOGY_LAYOUTS) {
      expect(description).toContain(layout);
    }
  });

  it("a Project Owner or Project Admin writes it, and no one else", () => {
    expect(project.getColumnAccessControlFor(COLUMN)?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    // Nobody names it on a new project: it is set from the map.
    expect(project.getColumnAccessControlFor(COLUMN)?.create).toEqual([]);
  });

  it("everyone with a place in the project reads it, because everyone opens the map", () => {
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

  it("is read as the project's other settings are: the same list as Limit Alerts to One Episode", () => {
    expect(project.getColumnAccessControlFor(COLUMN)).toEqual(
      project.getColumnAccessControlFor("limitAlertsToOneEpisode"),
    );
  });

  it.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "the column layer lets %s write it",
    (permission: Permission) => {
      expect(
        mayWrite(
          { [COLUMN]: "parentChild" },
          DatabaseRequestType.Update,
          permission,
        ),
      ).toBe(true);
    },
  );

  it.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "and lets %s clear it",
    (permission: Permission) => {
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
    Permission.BillingMember,
    Permission.Viewer,
    Permission.ReadProject,
    Permission.ProjectUser,
    Permission.EditNetworkDevice,
    Permission.EditNetworkSite,
    Permission.EditNetworkDeviceLink,
  ])("and refuses %s", (permission: Permission) => {
    expect(
      mayWrite(
        { [COLUMN]: "parentChild" },
        DatabaseRequestType.Update,
        permission,
      ),
    ).toBe(false);
  });

  it("is not set when a project is created, even by its future owner", () => {
    expect(
      mayWrite(
        { name: "Acme Retail", [COLUMN]: "parentChild" },
        DatabaseRequestType.Create,
        Permission.User,
      ),
    ).toBe(false);
    // The same create without it goes through, so the column is what refuses.
    expect(
      mayWrite(
        { name: "Acme Retail" },
        DatabaseRequestType.Create,
        Permission.User,
      ),
    ).toBe(true);
  });

  it("starts empty on a new project: every map keeps its own default", () => {
    expect(new Project().defaultNetworkTopologyLayout).toBeUndefined();
  });
});

describe("ProjectService.applyDefaultNetworkTopologyLayoutRules: what a project may store", () => {
  it.each([...NETWORK_TOPOLOGY_LAYOUTS])(
    "%s is stored as written",
    (layout: string) => {
      const data: { defaultNetworkTopologyLayout?: unknown } = {
        defaultNetworkTopologyLayout: layout,
      };

      ProjectService.applyDefaultNetworkTopologyLayoutRules(data);

      expect(data.defaultNetworkTopologyLayout).toBe(layout);
    },
  );

  it("an id with space around it is stored trimmed", () => {
    const data: { defaultNetworkTopologyLayout?: unknown } = {
      defaultNetworkTopologyLayout: "  parentChild\n",
    };

    ProjectService.applyDefaultNetworkTopologyLayoutRules(data);

    expect(data.defaultNetworkTopologyLayout).toBe("parentChild");
  });

  it("null clears it", () => {
    const data: { defaultNetworkTopologyLayout?: unknown } = {
      defaultNetworkTopologyLayout: null,
    };

    ProjectService.applyDefaultNetworkTopologyLayoutRules(data);

    expect(data.defaultNetworkTopologyLayout).toBeNull();
  });

  it.each(["", "   ", "\t\n"])(
    "blank text %p is stored as none",
    (value: string) => {
      const data: { defaultNetworkTopologyLayout?: unknown } = {
        defaultNetworkTopologyLayout: value,
      };

      ProjectService.applyDefaultNetworkTopologyLayoutRules(data);

      expect(data.defaultNetworkTopologyLayout).toBeNull();
    },
  );

  /*
   * An update that does not mention the column must not start writing it:
   * adding the key - even as null - would clear the team's default every
   * time someone renamed the project.
   */
  it("a write that leaves it out is not judged on it, and does not gain it", () => {
    const data: Record<string, unknown> = { name: "Renamed" };

    ProjectService.applyDefaultNetworkTopologyLayoutRules(data);

    expect(data).toEqual({ name: "Renamed" });
    expect(Object.prototype.hasOwnProperty.call(data, COLUMN)).toBe(false);
  });

  it.each([
    "Parent and child",
    "parent-child",
    "PARENTCHILD",
    "Force",
    "mesh",
    "constructor",
    "__proto__",
  ])("%p is refused, with the ids it may be", (value: string) => {
    expect(() => {
      ProjectService.applyDefaultNetworkTopologyLayoutRules({
        defaultNetworkTopologyLayout: value,
      });
    }).toThrow(
      new BadDataException(
        "The default network topology layout must be one of force, tiered, radial, star, parentChild.",
      ),
    );
  });

  it.each([[42], [true], [{ layout: "force" }], [["force"]]])(
    "%p is refused as not text",
    (value: unknown) => {
      expect(() => {
        ProjectService.applyDefaultNetworkTopologyLayoutRules({
          defaultNetworkTopologyLayout: value,
        });
      }).toThrow(
        new BadDataException(
          "The default network topology layout must be text.",
        ),
      );
    },
  );

  it("works on a Project model instance, as onBeforeCreate hands it one", () => {
    const project: Project = new Project();
    project.name = "Acme Retail";
    project.defaultNetworkTopologyLayout = " star ";

    ProjectService.applyDefaultNetworkTopologyLayoutRules(project);

    expect(project.defaultNetworkTopologyLayout).toBe("star");
    expect(project.name).toBe("Acme Retail");
  });

  it("leaves a Project model instance with no default untouched", () => {
    const project: Project = new Project();
    project.name = "Acme Retail";

    ProjectService.applyDefaultNetworkTopologyLayoutRules(project);

    expect(project.defaultNetworkTopologyLayout).toBeUndefined();
  });
});

describe("ProjectService: the rule runs on every write of the project", () => {
  it("an update with a layout that does not exist is refused before anything is read", async () => {
    const find: SpyInstance<typeof ProjectService.findBy> = jest.spyOn(
      ProjectService,
      "findBy",
    );

    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: { defaultNetworkTopologyLayout: "Parent and child" },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow(
      "The default network topology layout must be one of force, tiered, radial, star, parentChild.",
    );
    expect(find).not.toHaveBeenCalled();
  });

  it("an update with a layout is written trimmed", async () => {
    const result: OnUpdate<Project> = await hooks.onBeforeUpdate({
      query: { _id: PROJECT_ID.toString() },
      data: { defaultNetworkTopologyLayout: " parentChild " },
      props: { isRoot: true },
    } as unknown as UpdateBy<Project>);

    expect((result.updateBy.data as Record<string, unknown>)[COLUMN]).toBe(
      "parentChild",
    );
  });

  it("an update that clears it with blank text writes none", async () => {
    const result: OnUpdate<Project> = await hooks.onBeforeUpdate({
      query: { _id: PROJECT_ID.toString() },
      data: { defaultNetworkTopologyLayout: "  " },
      props: { isRoot: true },
    } as unknown as UpdateBy<Project>);

    expect(
      (result.updateBy.data as Record<string, unknown>)[COLUMN],
    ).toBeNull();
  });

  it("a project created with a layout that does not exist is refused", async () => {
    const project: Project = new Project();
    project.name = "Acme Retail";
    project.defaultNetworkTopologyLayout = "hub-and-spoke";

    await expect(
      hooks.onBeforeCreate({
        data: project,
        props: { isRoot: true },
      } as unknown as CreateBy<Project>),
    ).rejects.toThrow(
      "The default network topology layout must be one of force, tiered, radial, star, parentChild.",
    );
  });
});
