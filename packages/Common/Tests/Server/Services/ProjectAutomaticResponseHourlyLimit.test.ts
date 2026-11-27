import ProjectService from "../../../Server/Services/ProjectService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { SECURITY_AUTOMATIC_RESPONSE_MESSAGES } from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ISSUE #10746: a project's hourly limit of automatic blocks -
 * Project.securityAutomaticResponseMaxBlocksPerHour - is set by a Security
 * Admin, as they turn the automatic response policies on, and by a Project
 * Owner or a Project Admin. A Security Admin reaches no other column of the
 * project through it, and the server keeps no limit a project could not
 * set.
 */

const COLUMN: string = "securityAutomaticResponseMaxBlocksPerHour";

const PROJECT_ID: ObjectID = new ObjectID(
  "e5000000-0000-4000-8000-000000010746",
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
    permissions: [Permission.ProjectUser, ...permissions].map(permissionRow),
  };

  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  } as DatabaseCommonInteractionProps;
}

// Whether the permission layers let a write through, as an update is checked.
function mayWrite(
  data: Record<string, unknown>,
  ...permissions: Array<Permission>
): boolean {
  const props: DatabaseCommonInteractionProps = propsWith(...permissions);

  try {
    TablePermission.checkTableLevelPermissions(
      Project,
      props,
      DatabaseRequestType.Update,
    );
    ColumnPermissions.checkDataColumnPermissions(
      Project,
      data as unknown as BaseModel,
      props,
      DatabaseRequestType.Update,
    );
    return true;
  } catch {
    return false;
  }
}

interface ProjectHookAccess {
  onBeforeUpdate(updateBy: UpdateBy<Project>): Promise<OnUpdate<Project>>;
  onBeforeCreate(createBy: CreateBy<Project>): Promise<OnCreate<Project>>;
}

const hooks: ProjectHookAccess = ProjectService as unknown as ProjectHookAccess;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may set the hourly limit", () => {
  it.each([
    Permission.SecurityAdmin,
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
  ])("%s may", (permission: Permission) => {
    expect(mayWrite({ [COLUMN]: 120 }, permission)).toBe(true);
  });

  it.each([
    Permission.SecurityMember,
    Permission.SecurityViewer,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadProject,
    Permission.EditProject,
    Permission.ManageProjectBilling,
    Permission.BillingAdmin,
  ])("%s may not", (permission: Permission) => {
    expect(mayWrite({ [COLUMN]: 120 }, permission)).toBe(false);
  });

  it.each([
    ["the project's name", { name: "Renamed" }],
    // Trusted Proxies is a Security Admin's as well since #11049.
    ["its risk threshold", { securityRiskCaseThreshold: 200 }],
    ["its AI switch", { enableAi: false }],
    ["what OneUptime AI may do", { securityCaseAiEdgeMode: "OnItsOwn" }],
    ["its plan", { paymentProviderPlanId: "plan_enterprise" }],
    ["its incoming request secret", { requireIncomingRequestSecret: true }],
  ])(
    "a Security Admin reaches nothing else of the project: not %s",
    (_what: string, data: Record<string, unknown>) => {
      expect(mayWrite(data, Permission.SecurityAdmin)).toBe(false);
      // Nor with the limit beside it.
      expect(
        mayWrite({ ...data, [COLUMN]: 120 }, Permission.SecurityAdmin),
      ).toBe(false);
    },
  );
});

describe("what the server keeps", () => {
  it("refuses a limit out of range on an update, before anything is read", async () => {
    const find: SpyInstance<typeof ProjectService.findBy> = jest.spyOn(
      ProjectService,
      "findBy",
    );

    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: { [COLUMN]: 501 },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow(
      new BadDataException(
        SECURITY_AUTOMATIC_RESPONSE_MESSAGES.hourlyLimitOutOfRange,
      ),
    );
    expect(find).not.toHaveBeenCalled();
  });

  it("refuses one that is no whole number on an update", async () => {
    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: { [COLUMN]: "2.5" },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow(BadDataException);
  });

  it("refuses one out of range on a create, where the API could name it", async () => {
    const project: Project = new Project();
    project.name = "Acme";
    (project as unknown as Record<string, unknown>)[COLUMN] = 0;

    await expect(
      hooks.onBeforeCreate({
        data: project,
        props: { isRoot: true },
      } as unknown as CreateBy<Project>),
    ).rejects.toThrow(
      new BadDataException(
        SECURITY_AUTOMATIC_RESPONSE_MESSAGES.hourlyLimitOutOfRange,
      ),
    );
  });

  it("keeps a limit sent as text as the number it is", () => {
    const data: Record<string, unknown> = { [COLUMN]: " 75 " };

    ProjectService.applySecurityAutomaticResponseLimitRules(data);

    expect(data[COLUMN]).toBe(75);
  });
});
