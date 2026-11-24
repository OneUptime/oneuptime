import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * ISSUES #10546 AND #10548: the two switches of Security Events' Trusted
 * Proxies - whether the project's own load balancers are trusted
 * (Project.securityTrustOwnLoadBalancers, on unless turned off) and whether
 * its access logs end with X-Forwarded-For
 * (Project.securityReadAccessLogForwardedFor, off unless turned on).
 *
 * A Security Admin may turn either off and on, as a Project Owner or Admin
 * may, and reaches no other column of the project through them. Every role
 * that reads the project reads them, so Trusted Proxies says to everyone
 * what is trusted.
 */

const SWITCHES: Array<string> = [
  "securityTrustOwnLoadBalancers",
  "securityReadAccessLogForwardedFor",
];

const PROJECT_ID: ObjectID = new ObjectID(
  "e5000000-0000-4000-8000-000000010546",
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

describe.each(SWITCHES)("who may flip %s", (column: string) => {
  it.each([
    Permission.SecurityAdmin,
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
  ])("%s may, either way", (permission: Permission) => {
    expect(mayWrite({ [column]: false }, permission)).toBe(true);
    expect(mayWrite({ [column]: true }, permission)).toBe(true);
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
    expect(mayWrite({ [column]: false }, permission)).toBe(false);
  });

  it("every role that reads the project reads it", () => {
    const readers: Array<Permission> = new Project().getColumnAccessControlFor(
      column,
    )!.read;

    for (const reader of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
    ]) {
      expect(readers).toContain(reader);
    }
  });
});

describe("a Security Admin reaches nothing else of the project through them", () => {
  it.each([
    ["the project's name", { name: "Renamed" }],
    ["its trusted proxies", { securityTrustedProxies: "203.0.113.0/24" }],
    ["its AI switch", { enableAi: false }],
    ["its plan", { paymentProviderPlanId: "plan_enterprise" }],
  ])("not %s", (_what: string, data: Record<string, unknown>) => {
    for (const column of SWITCHES) {
      expect(
        mayWrite({ ...data, [column]: false }, Permission.SecurityAdmin),
      ).toBe(false);
    }
  });
});

describe("where a project starts", () => {
  it("its load balancers trusted, its access logs not read for the header", () => {
    const project: Project = new Project();

    expect(
      project.getTableColumnMetadata("securityTrustOwnLoadBalancers")
        .defaultValue,
    ).toBe(true);
    expect(
      project.getTableColumnMetadata("securityReadAccessLogForwardedFor")
        .defaultValue,
    ).toBe(false);
  });
});
