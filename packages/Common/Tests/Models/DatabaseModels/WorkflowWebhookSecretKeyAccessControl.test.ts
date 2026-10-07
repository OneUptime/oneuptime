import Workflow from "../../../Models/DatabaseModels/Workflow";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import SelectPermission from "../../../Server/Types/Database/Permissions/SelectPermission";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import { WORKFLOW_RUN_PERMISSIONS } from "../../../Types/Workflow/WorkflowRunPermissions";
import Permission, {
  PermissionHelper,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * A workflow's webhook secret key is the last segment of its Webhook
 * trigger's URL, and whoever has the URL can start the workflow. Running a
 * workflow by hand is for its editors and Workflow Members
 * (Types/Workflow/WorkflowRunPermissions, the workflow service's Manual
 * API), so a key every Viewer could read was a way round that: "read-only"
 * could start any webhook workflow in the project.
 *
 * The key is now readable by exactly the roles that can reset it, as
 * Monitor's secret keys are since issue #3360. These run the server's own
 * permission checks - the ones a request goes through - rather than reading
 * the lists back.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

const COLUMN: string = "webhookSecretKey";

// The workflow's editors: its update list, Workflow Admin included.
const CAN_SEE_AND_RESET: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditWorkflow,
  Permission.WorkflowAdmin,
];

/*
 * Every role that can open a workflow but not edit it. A Workflow Member may
 * run a workflow by hand - from its trigger, as its editors built it - but a
 * webhook URL starts it with whatever body its caller sends, from anywhere,
 * so the URL stays with the people who could change the workflow anyway.
 */
const CANNOT_SEE: Array<Permission> = [
  Permission.Viewer,
  Permission.WorkflowViewer,
  Permission.ReadWorkflow,
  Permission.ProjectMember,
  Permission.WorkflowMember,
  Permission.CreateWorkflow,
  Permission.DeleteWorkflow,
];

function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const userPermissions: Array<UserPermission> = permissions.map(
    (permission: Permission) => {
      return {
        _type: "UserPermission" as const,
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: userPermissions,
  };

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

function selectError(
  permissions: Array<Permission>,
  select: Record<string, boolean>,
): Error | null {
  try {
    SelectPermission.checkSelectPermission(
      Workflow,
      select as any,
      propsWith(permissions),
    );
  } catch (err) {
    return err as Error;
  }

  return null;
}

function updateError(permissions: Array<Permission>): Error | null {
  const data: Workflow = new Workflow();
  data.webhookSecretKey = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

  try {
    ColumnPermissions.checkDataColumnPermissions(
      Workflow,
      data,
      propsWith(permissions),
      DatabaseRequestType.Update,
    );
  } catch (err) {
    return err as Error;
  }

  return null;
}

const columnAccess: () => ColumnAccessControl = (): ColumnAccessControl => {
  const accessControl: ColumnAccessControl | null =
    new Workflow().getColumnAccessControlFor(COLUMN);

  expect(accessControl).not.toBeNull();

  return accessControl!;
};

describe("Workflow.webhookSecretKey access control", () => {
  test("who may read the key is exactly who may reset it", () => {
    expect([...columnAccess().read].sort()).toEqual(
      [...columnAccess().update].sort(),
    );
    expect([...columnAccess().read].sort()).toEqual(
      [...CAN_SEE_AND_RESET].sort(),
    );
  });

  test("nobody sets it on create: the server generates it", () => {
    expect(columnAccess().create).toEqual([]);
  });

  test.each(CAN_SEE_AND_RESET)(
    "%s may read the key",
    (permission: Permission) => {
      expect(selectError([permission], { [COLUMN]: true })).toBeNull();
    },
  );

  test.each(CAN_SEE_AND_RESET)(
    "%s may reset the key",
    (permission: Permission) => {
      expect(updateError([permission])).toBeNull();
    },
  );

  test.each(CANNOT_SEE)(
    "%s is refused the key, with the permissions that would allow it",
    (permission: Permission) => {
      const error: Error | null = selectError([permission], {
        [COLUMN]: true,
      });

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error?.message).toContain("webhookSecretKey");
      expect(error?.message).toContain("Edit Workflow");
    },
  );

  test.each(CANNOT_SEE)(
    "%s may not reset the key",
    (permission: Permission) => {
      expect(updateError([permission])?.message).toContain(
        "is not allowed to update on webhookSecretKey column of Workflow",
      );
    },
  );

  test("seeing the URL never lets anyone start a workflow they could not start by hand", () => {
    /*
     * Manual in the workflow service allows a run to whoever holds one of
     * WORKFLOW_RUN_PERMISSIONS; RunStep to whoever holds one of the
     * workflow's update permissions. Whoever may see the key may do both.
     */
    const canEdit: Array<Permission> = new Workflow().getUpdatePermissions();

    for (const permission of columnAccess().read) {
      expect(WORKFLOW_RUN_PERMISSIONS).toContain(permission);
      expect(canEdit).toContain(permission);
    }
  });

  test("a Workflow Member runs workflows by hand but never sees the URL", () => {
    expect(WORKFLOW_RUN_PERMISSIONS).toContain(Permission.WorkflowMember);
    expect(columnAccess().read).not.toContain(Permission.WorkflowMember);
  });

  test("a Viewer can still open the builder: the graph and the name stay readable", () => {
    /*
     * The regression that would break the builder for read-only users: the
     * builder asks for the graph whatever the user's role, and only asks for
     * the key when PermissionGate says it may.
     */
    const readers: Array<Permission> = new Workflow().getReadPermissions();

    for (const permission of CANNOT_SEE.filter((role: Permission) => {
      return readers.includes(role);
    })) {
      expect(selectError([permission], { graph: true, name: true })).toBeNull();
    }
  });

  test("a select without the key works for everyone who can read the workflow", () => {
    const readers: Array<Permission> = new Workflow().getReadPermissions();

    for (const permission of readers) {
      expect(selectError([permission], { graph: true })).toBeNull();
    }
  });

  test("the key's read list is narrower than the workflow's, so viewers are really excluded", () => {
    const readers: Array<Permission> = new Workflow().getReadPermissions();

    expect(
      PermissionHelper.doesPermissionsIntersect([Permission.Viewer], readers),
    ).toBe(true);
    expect(columnAccess().read).not.toContain(Permission.Viewer);
  });
});
