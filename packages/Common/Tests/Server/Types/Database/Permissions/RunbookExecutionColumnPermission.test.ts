import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import RunbookExecution from "../../../../../Models/DatabaseModels/RunbookExecution";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import RunbookExecutionStatus from "../../../../../Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "../../../../../Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "../../../../../Types/Runbook/RunbookStepType";
import { describe, expect, it } from "@jest/globals";

/*
 * RunbookExecution is mounted on the generic CRUD API, and its status and
 * stepExecutions columns used to be updatable by everyone holding its
 * table-level update grant (EditRunbookExecution among them). A step entry
 * carries the step's status AND its definition — the Worker runs the step
 * from it — so a direct write could pre-approve a gate the run had not
 * reached (the same bypass the step routes now refuse) or rewrite the script
 * a later step runs. Both columns are now written only by the server, as
 * root.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

// Every permission built here is an explicit allow, keyed under the tenant.
function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

type CheckFunction = () => void;

function checkUpdate(
  data: Record<string, unknown>,
  permissions: Array<Permission>,
): CheckFunction {
  return () => {
    ColumnPermissions.checkDataColumnPermissions(
      RunbookExecution,
      data as unknown as RunbookExecution,
      makeProps(permissions),
      DatabaseRequestType.Update,
    );
  };
}

// The holders of RunbookExecution's table-level update grant.
const UPDATE_GRANTS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditRunbookExecution,
  Permission.RunbookAdmin,
];

const PRE_APPROVED_GATE: Array<Record<string, unknown>> = [
  {
    step: {
      id: "l2",
      order: 2,
      type: RunbookStepType.Manual,
      title: "L2 approval",
      config: {},
    },
    status: RunbookStepExecutionStatus.Completed,
  },
];

describe("RunbookExecution's server-managed columns", () => {
  describe("harness guard", () => {
    /*
     * Without these, the refusals below could pass because the props were
     * mis-built and granted nothing at all.
     */
    it("lets EditRunbookExecution write a column that is still updatable", () => {
      expect(
        checkUpdate({ failureReason: "note" }, [
          Permission.EditRunbookExecution,
        ]),
      ).not.toThrow();
    });

    it("refuses a reader that writes a column that is still updatable", () => {
      expect(
        checkUpdate({ failureReason: "note" }, [Permission.Viewer]),
      ).toThrow(BadDataException);
    });
  });

  it.each(UPDATE_GRANTS)(
    "REGRESSION: %s cannot write stepExecutions through the generic API",
    (permission: Permission) => {
      expect(
        checkUpdate({ stepExecutions: PRE_APPROVED_GATE }, [permission]),
      ).toThrow(
        "User is not allowed to update on stepExecutions column of Runbook Execution",
      );
    },
  );

  it.each(UPDATE_GRANTS)(
    "%s cannot write status through the generic API",
    (permission: Permission) => {
      expect(
        checkUpdate({ status: RunbookExecutionStatus.WaitingForManualStep }, [
          permission,
        ]),
      ).toThrow(
        "User is not allowed to update on status column of Runbook Execution",
      );
    },
  );

  it("grants nobody update on either column", () => {
    const model: RunbookExecution = new RunbookExecution();

    expect(model.getColumnAccessControlFor("stepExecutions")?.update).toEqual(
      [],
    );
    expect(model.getColumnAccessControlFor("status")?.update).toEqual([]);
  });

  it("still lets the people who may read an execution read both columns", () => {
    const model: RunbookExecution = new RunbookExecution();

    for (const column of ["stepExecutions", "status"]) {
      expect(model.getColumnAccessControlFor(column)?.read).toEqual(
        expect.arrayContaining([
          Permission.ReadRunbookExecution,
          Permission.Viewer,
        ]),
      );
    }
  });
});
