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
import {
  DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS,
  DISCOVERED_DEVICE_RETENTION_REFUSAL,
} from "../../../Types/NetworkDevice/DiscoveredDeviceRetention";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ISSUE #6389: discovered devices nothing has seen for a while are removed
 * from the Discovered Devices list. How long a project keeps them is
 * Project.discoveredDeviceRetentionInDays: 30 days unless a Project Owner
 * or Admin picks 7, 14, 60, 90, 180 or 365, or 0 for Never - the project's
 * other settings' writers - and readable by everyone with a place in the
 * project, because the list says it to everyone who reads it. Whatever is
 * written is one of those, by the Dashboard, the API and Terraform alike.
 */

const COLUMN: string = "discoveredDeviceRetentionInDays";

const PROJECT_ID: ObjectID = new ObjectID(
  "e5000000-0000-4000-8000-000000000001",
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

describe("Project.discoveredDeviceRetentionInDays: the column", () => {
  const project: Project = new Project();

  it("is a required number of days with a default, titled and described for the API reference", () => {
    const metadata: {
      type: TableColumnType;
      required?: boolean;
      isDefaultValueColumn?: boolean;
      defaultValue?: unknown;
      title?: string;
      description?: string;
      example?: unknown;
    } = project.getTableColumnMetadata(COLUMN) as unknown as {
      type: TableColumnType;
      required?: boolean;
      isDefaultValueColumn?: boolean;
      defaultValue?: unknown;
      title?: string;
      description?: string;
      example?: unknown;
    };

    expect(metadata.type).toBe(TableColumnType.Number);
    expect(metadata.required).toBe(true);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(30);
    expect(metadata.example).toBe(30);
    expect(metadata.title).toBe("Discovered Device Retention (Days)");
    expect(metadata.description!.length).toBeLessThanOrEqual(150);
  });

  it("its description names every choice, Never, and what always stays", () => {
    const description: string =
      (
        project.getTableColumnMetadata(COLUMN) as unknown as {
          description: string;
        }
      ).description || "";

    for (const days of DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS) {
      expect(description).toContain(String(days));
    }

    expect(description).toContain("0 to keep all");
    expect(description).toContain("Monitored and classified devices always stay");
  });

  it("a Project Owner or Project Admin writes it, and no one else", () => {
    expect(project.getColumnAccessControlFor(COLUMN)?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    // Nobody names it on a new project: it starts at the default.
    expect(project.getColumnAccessControlFor(COLUMN)?.create).toEqual([]);
  });

  it("is read as the project's other settings are, because the list says it to everyone", () => {
    expect(project.getColumnAccessControlFor(COLUMN)).toEqual(
      project.getColumnAccessControlFor("defaultNetworkTopologyLayout"),
    );
  });

  it.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "the column layer lets %s write it",
    (permission: Permission) => {
      expect(
        mayWrite({ [COLUMN]: 90 }, DatabaseRequestType.Update, permission),
      ).toBe(true);
      expect(
        mayWrite({ [COLUMN]: 0 }, DatabaseRequestType.Update, permission),
      ).toBe(true);
    },
  );

  it.each([
    Permission.ProjectMember,
    Permission.EditProject,
    Permission.Viewer,
    Permission.ReadProject,
    Permission.ProjectUser,
    Permission.EditNetworkDevice,
    Permission.EditNetworkEndpoint,
    Permission.DeleteNetworkEndpoint,
    Permission.EditNetworkSite,
  ])("and refuses %s", (permission: Permission) => {
    expect(
      mayWrite({ [COLUMN]: 90 }, DatabaseRequestType.Update, permission),
    ).toBe(false);
  });

  it("is not set when a project is created, even by its future owner", () => {
    expect(
      mayWrite(
        { name: "Acme Retail", [COLUMN]: 7 },
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
});

describe("ProjectService.applyDiscoveredDeviceRetentionRules: what a project may store", () => {
  it.each([...DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS, 0])(
    "%p days is stored as written",
    (days: number) => {
      const data: { discoveredDeviceRetentionInDays?: unknown } = {
        discoveredDeviceRetentionInDays: days,
      };

      ProjectService.applyDiscoveredDeviceRetentionRules(data);

      expect(data.discoveredDeviceRetentionInDays).toBe(days);
    },
  );

  it("a choice written as text, as a form or Terraform may send it, is stored as the number", () => {
    const data: { discoveredDeviceRetentionInDays?: unknown } = {
      discoveredDeviceRetentionInDays: " 60 ",
    };

    ProjectService.applyDiscoveredDeviceRetentionRules(data);

    expect(data.discoveredDeviceRetentionInDays).toBe(60);
  });

  it("a write that leaves it out is not judged on it, and does not gain it", () => {
    const data: Record<string, unknown> = { name: "Renamed" };

    ProjectService.applyDiscoveredDeviceRetentionRules(data);

    expect(data).toEqual({ name: "Renamed" });
  });

  it.each([
    [null],
    [45],
    [1],
    [-30],
    [7.5],
    [366],
    ["30 days"],
    ["never"],
    [""],
    [true],
    [{ days: 30 }],
    [[30]],
  ])("%p is refused, with the choices", (value: unknown) => {
    expect(() => {
      ProjectService.applyDiscoveredDeviceRetentionRules({
        discoveredDeviceRetentionInDays: value,
      });
    }).toThrow(new BadDataException(DISCOVERED_DEVICE_RETENTION_REFUSAL));
  });

  it("works on a Project model instance, as onBeforeCreate hands it one", () => {
    const project: Project = new Project();
    project.name = "Acme Retail";
    project.discoveredDeviceRetentionInDays = 180;

    ProjectService.applyDiscoveredDeviceRetentionRules(project);

    expect(project.discoveredDeviceRetentionInDays).toBe(180);
    expect(project.name).toBe("Acme Retail");
  });

  it("starts unset on a new Project model: the database's default applies", () => {
    expect(new Project().discoveredDeviceRetentionInDays).toBeUndefined();
  });
});

describe("ProjectService: the rule runs on every write of the project", () => {
  it("an update with days that are not a choice is refused before anything is read", async () => {
    const find: SpyInstance<typeof ProjectService.findBy> = jest.spyOn(
      ProjectService,
      "findBy",
    );

    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: { discoveredDeviceRetentionInDays: 45 },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow(DISCOVERED_DEVICE_RETENTION_REFUSAL);
    expect(find).not.toHaveBeenCalled();
  });

  it("an update with a choice written as text is written as the number", async () => {
    const result: OnUpdate<Project> = await hooks.onBeforeUpdate({
      query: { _id: PROJECT_ID.toString() },
      data: { discoveredDeviceRetentionInDays: "14" },
      props: { isRoot: true },
    } as unknown as UpdateBy<Project>);

    expect((result.updateBy.data as Record<string, unknown>)[COLUMN]).toBe(14);
  });

  it("an update to Never is written as 0", async () => {
    const result: OnUpdate<Project> = await hooks.onBeforeUpdate({
      query: { _id: PROJECT_ID.toString() },
      data: { discoveredDeviceRetentionInDays: 0 },
      props: { isRoot: true },
    } as unknown as UpdateBy<Project>);

    expect((result.updateBy.data as Record<string, unknown>)[COLUMN]).toBe(0);
  });

  it("an update that empties it is refused: the column always holds a value", async () => {
    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: { discoveredDeviceRetentionInDays: null },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow(DISCOVERED_DEVICE_RETENTION_REFUSAL);
  });

  it("a project created with days that are not a choice is refused", async () => {
    const project: Project = new Project();
    project.name = "Acme Retail";
    project.discoveredDeviceRetentionInDays = 3;

    await expect(
      hooks.onBeforeCreate({
        data: project,
        props: { isRoot: true },
      } as unknown as CreateBy<Project>),
    ).rejects.toThrow(DISCOVERED_DEVICE_RETENTION_REFUSAL);
  });
});
