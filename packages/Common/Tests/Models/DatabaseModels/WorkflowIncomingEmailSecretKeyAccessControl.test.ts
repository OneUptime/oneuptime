import Workflow from "../../../Models/DatabaseModels/Workflow";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import SelectPermission from "../../../Server/Types/Database/Permissions/SelectPermission";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * A workflow's incoming email secret key is what its Incoming Email trigger's
 * address is built from (workflow-{key}@{inbound domain}), and whoever has the
 * address can start the workflow. It is held to exactly what the webhook
 * secret key is held to, for the same reason: running a workflow by hand needs
 * the workflow's update permissions, so a key a Viewer could read would let
 * "read-only" start the workflow by email.
 *
 * These run the server's own permission checks - the ones a request goes
 * through - rather than reading the lists back.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

const COLUMN: string = "incomingEmailSecretKey";

const CAN_SEE_AND_RESET: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditWorkflow,
];

const CANNOT_SEE: Array<Permission> = [
  Permission.Viewer,
  Permission.WorkflowViewer,
  Permission.ReadWorkflow,
  Permission.ProjectMember,
  Permission.WorkflowAdmin,
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

function writeError(
  permissions: Array<Permission>,
  requestType: DatabaseRequestType,
): Error | null {
  const data: Workflow = new Workflow();
  data.incomingEmailSecretKey = new ObjectID(
    "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  );

  try {
    ColumnPermissions.checkDataColumnPermissions(
      Workflow,
      data,
      propsWith(permissions),
      requestType,
    );
  } catch (err) {
    return err as Error;
  }

  return null;
}

const columnAccess: (column?: string) => ColumnAccessControl = (
  column: string = COLUMN,
): ColumnAccessControl => {
  const accessControl: ColumnAccessControl | null =
    new Workflow().getColumnAccessControlFor(column);

  expect(accessControl).not.toBeNull();

  return accessControl!;
};

describe("Workflow.incomingEmailSecretKey access control", () => {
  test("who may read the key is exactly who may reset it", () => {
    expect([...columnAccess().read].sort()).toEqual(
      [...columnAccess().update].sort(),
    );
    expect([...columnAccess().read].sort()).toEqual(
      [...CAN_SEE_AND_RESET].sort(),
    );
  });

  test("it is held to exactly what the webhook key is held to", () => {
    const webhook: ColumnAccessControl = columnAccess("webhookSecretKey");

    expect([...columnAccess().read].sort()).toEqual([...webhook.read].sort());
    expect([...columnAccess().update].sort()).toEqual(
      [...webhook.update].sort(),
    );
  });

  test("nobody sets it on create: the server gives it", () => {
    expect(columnAccess().create).toEqual([]);
  });

  test.each([...CAN_SEE_AND_RESET, ...CANNOT_SEE])(
    "%s may not set it on create, so an import cannot bring another workflow's address",
    (permission: Permission) => {
      expect(
        writeError([permission], DatabaseRequestType.Create)?.message,
      ).toContain(
        "is not allowed to create on incomingEmailSecretKey column of Workflow",
      );
    },
  );

  test.each(CAN_SEE_AND_RESET)(
    "%s may read the key",
    (permission: Permission) => {
      expect(selectError([permission], { [COLUMN]: true })).toBeNull();
    },
  );

  test.each(CAN_SEE_AND_RESET)(
    "%s may reset the key",
    (permission: Permission) => {
      expect(writeError([permission], DatabaseRequestType.Update)).toBeNull();
    },
  );

  test.each(CANNOT_SEE)(
    "%s is refused the key, with the permissions that would allow it",
    (permission: Permission) => {
      const error: Error | null = selectError([permission], {
        [COLUMN]: true,
      });

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error?.message).toContain(COLUMN);
      expect(error?.message).toContain("Edit Workflow");
    },
  );

  test.each(CANNOT_SEE)(
    "%s may not reset the key",
    (permission: Permission) => {
      expect(
        writeError([permission], DatabaseRequestType.Update)?.message,
      ).toContain(
        "is not allowed to update on incomingEmailSecretKey column of Workflow",
      );
    },
  );

  test("seeing the address never lets anyone start a workflow they could not start by hand", () => {
    const canRunByHand: Array<Permission> =
      new Workflow().getUpdatePermissions();

    for (const permission of columnAccess().read) {
      expect(canRunByHand).toContain(permission);
    }
  });

  test("a Viewer can still open the builder without it", () => {
    const readers: Array<Permission> = new Workflow().getReadPermissions();

    for (const permission of CANNOT_SEE.filter((role: Permission) => {
      return readers.includes(role);
    })) {
      expect(selectError([permission], { graph: true, name: true })).toBeNull();
    }
  });
});

describe("Workflow.incomingEmailSecretKey is unique", () => {
  /*
   * The inbound webhook finds a workflow by this key alone. Two workflows with
   * one key would mean an email for one could start the other - in another
   * project - so the database refuses a second copy, and the API refuses it
   * before that.
   */
  test("the column is unique in the database", () => {
    const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
      .filterColumns(Workflow)
      .find((candidate: ColumnMetadataArgs) => {
        return candidate.propertyName === COLUMN;
      });

    expect(column).toBeDefined();
    expect(column?.options.unique).toBe(true);
    expect(column?.options.nullable).toBe(true);
  });

  test("and to the API, which checks it before saving", () => {
    const metadata: TableColumnMetadata = new Workflow().getTableColumnMetadata(
      COLUMN,
    );

    expect(metadata.unique).toBe(true);
    expect(metadata.type).toBe(TableColumnType.ObjectID);
  });
});
