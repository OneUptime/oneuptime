import { describe, expect, test } from "@jest/globals";
import CallerPermission, {
  PermissionCarrier,
} from "../../../../Server/Utils/Permission/CallerPermission";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Project from "../../../../Models/DatabaseModels/Project";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";

/*
 * CallerPermission is how a route guard, a custom endpoint or a service
 * check asks whether the caller of a request holds a permission. It reads
 * the request's rows by the rule the CRUD path follows: an allow row
 * grants, a block row never does, a block with no labels refuses, and a
 * block with labels restricts only labelled records - which a check that
 * looks at no record does not reach.
 */

const LABEL: ObjectID = new ObjectID("6f1d6c39-0a8e-4f4a-9e43-0d8d4fb0a002");

type RowFunction = (
  permission: Permission,
  options?: { isBlock?: boolean; labelled?: boolean },
) => UserPermission;

const row: RowFunction = (
  permission: Permission,
  options?: { isBlock?: boolean; labelled?: boolean },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labelled ? [LABEL] : [],
    isBlockPermission: Boolean(options?.isBlock),
  };
};

type CallerFunction = (
  projectId: ObjectID,
  rows: Array<UserPermission>,
  globalPermissions?: Array<Permission>,
) => PermissionCarrier;

const caller: CallerFunction = (
  projectId: ObjectID,
  rows: Array<UserPermission>,
  globalPermissions?: Array<Permission>,
): PermissionCarrier => {
  return {
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: rows,
      },
    },
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      globalPermissions: globalPermissions || [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
      projectIds: [projectId],
    },
  };
};

const BILLING: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ManageProjectBilling,
];

describe("CallerPermission.holdsAnyOf", () => {
  const projectId: ObjectID = ObjectID.generate();

  test("a grant", () => {
    expect(
      CallerPermission.holdsAnyOf(
        caller(projectId, [row(Permission.ManageProjectBilling)]),
        BILLING,
      ),
    ).toBe(true);
  });

  test("a grantee whose only row is a block with no labels holds nothing", () => {
    expect(
      CallerPermission.holdsAnyOf(
        caller(projectId, [
          row(Permission.ManageProjectBilling, { isBlock: true }),
        ]),
        BILLING,
      ),
    ).toBe(false);
  });

  test("a grantee whose only row is a block with labels holds nothing", () => {
    expect(
      CallerPermission.holdsAnyOf(
        caller(projectId, [
          row(Permission.ManageProjectBilling, {
            isBlock: true,
            labelled: true,
          }),
        ]),
        BILLING,
      ),
    ).toBe(false);
  });

  test("a grant and a block with no labels together: the block wins", () => {
    expect(
      CallerPermission.holdsAnyOf(
        caller(projectId, [
          row(Permission.ManageProjectBilling),
          row(Permission.ManageProjectBilling, { isBlock: true }),
        ]),
        BILLING,
      ),
    ).toBe(false);

    expect(
      CallerPermission.holdsAnyOf(
        caller(projectId, [
          row(Permission.ManageProjectBilling),
          row(Permission.ProjectOwner, { isBlock: true }),
        ]),
        BILLING,
      ),
    ).toBe(false);
  });

  test("a grant and a block with labels together: the route is not refused", () => {
    const both: PermissionCarrier = caller(projectId, [
      row(Permission.ManageProjectBilling),
      row(Permission.ManageProjectBilling, { isBlock: true, labelled: true }),
    ]);

    expect(CallerPermission.holdsAnyOf(both, BILLING)).toBe(true);
    expect(
      CallerPermission.holdsAnyOf(both, BILLING, {
        labelledBlocksRefuse: true,
      }),
    ).toBe(false);
  });

  test("reads the rows of the project it is asked about", () => {
    const otherProjectId: ObjectID = ObjectID.generate();
    const member: PermissionCarrier = caller(projectId, [
      row(Permission.ManageProjectBilling),
    ]);

    expect(
      CallerPermission.holdsAnyOf(member, BILLING, {
        projectId: otherProjectId,
      }),
    ).toBe(false);
    expect(
      CallerPermission.holdsAnyOf(member, BILLING, { projectId: projectId }),
    ).toBe(true);
  });

  test("global permissions count, rows or not", () => {
    expect(
      CallerPermission.holdsAnyOf(caller(projectId, []), [Permission.User]),
    ).toBe(true);
    expect(CallerPermission.holdsAnyOf(caller(projectId, []), BILLING)).toBe(
      false,
    );
  });

  test("a caller with no project holds nothing in one", () => {
    expect(
      CallerPermission.holdsAnyOf({ userTenantAccessPermission: {} }, BILLING),
    ).toBe(false);
    expect(CallerPermission.isProjectMember({}, projectId)).toBe(false);
    expect(
      CallerPermission.isProjectMember(caller(projectId, []), projectId),
    ).toBe(true);
  });
});

describe("CallerPermission.holdsModelPermission", () => {
  const projectId: ObjectID = ObjectID.generate();

  test("an operational resource accepts its wildcard", () => {
    const wildcardHolder: PermissionCarrier = caller(projectId, [
      row(Permission.EditAllOperationalResources),
    ]);

    expect(
      CallerPermission.holdsModelPermission(wildcardHolder, {
        model: new Monitor(),
        operation: "update",
      }),
    ).toBe(true);
    expect(
      CallerPermission.holdsModelPermission(wildcardHolder, {
        model: new Workflow(),
        operation: "update",
      }),
    ).toBe(true);
  });

  test("a model that is not an operational resource does not", () => {
    expect(
      CallerPermission.holdsModelPermission(
        caller(projectId, [row(Permission.EditAllOperationalResources)]),
        { model: new Project(), operation: "update" },
      ),
    ).toBe(false);
  });

  test("a blocked wildcard grants nothing, and a block on the model's own permission refuses the wildcard", () => {
    expect(
      CallerPermission.holdsModelPermission(
        caller(projectId, [
          row(Permission.EditAllOperationalResources),
          row(Permission.EditAllOperationalResources, { isBlock: true }),
        ]),
        { model: new Monitor(), operation: "update" },
      ),
    ).toBe(false);

    expect(
      CallerPermission.holdsModelPermission(
        caller(projectId, [
          row(Permission.EditAllOperationalResources),
          row(Permission.EditProjectMonitor, { isBlock: true }),
        ]),
        { model: new Monitor(), operation: "update" },
      ),
    ).toBe(false);
  });

  test("the model's own permission, unblocked, grants", () => {
    expect(
      CallerPermission.holdsModelPermission(
        caller(projectId, [row(Permission.EditProjectMonitor)]),
        { model: new Monitor(), operation: "update" },
      ),
    ).toBe(true);
  });
});

describe("CallerPermission.isGrantedAny", () => {
  test("is the allow half alone, for checks that name the block themselves", () => {
    const projectId: ObjectID = ObjectID.generate();
    const both: PermissionCarrier = caller(projectId, [
      row(Permission.ManageProjectBilling),
      row(Permission.ManageProjectBilling, { isBlock: true }),
    ]);

    expect(CallerPermission.isGrantedAny(both, BILLING)).toBe(true);
    expect(CallerPermission.holdsAnyOf(both, BILLING)).toBe(false);
  });
});
