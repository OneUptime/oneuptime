import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import WorkflowVariable from "../../../../../Models/DatabaseModels/WorkflowVariable";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Columns from "../../../../../Types/Database/Columns";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * A customer's Workflow could not rotate the secret it stored in a Workflow
 * Variable. The API key carried Permission.EditWorkflowVariable - which is the
 * table-level update grant on WorkflowVariable - but the "content" column's
 * ColumnAccessControl.update listed only ProjectOwner and ProjectAdmin. So the
 * one column the caller actually wanted to write was the one column its
 * permission did not cover.
 *
 * "content" is the secret itself, so its read list is deliberately empty: not
 * even a ProjectOwner may read it back. Widening update must not widen read -
 * ColumnAccessControl keeps create/read/update as three independent arrays, and
 * these tests pin that independence so a future edit cannot quietly turn a
 * write grant into a way to exfiltrate the secret.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

/*
 * DatabaseCommonInteractionPropsUtil.getUserPermissions drops every permission
 * whose isBlockPermission does not match the requested PermissionType, and it
 * only reads the tenant bucket when props.tenantId is set. Getting either wrong
 * yields an empty permission set, which would make the "does not throw" cases
 * below pass for entirely the wrong reason. Every permission built here is an
 * explicit allow, keyed under the tenant this request runs as.
 */
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

function makeUserPermissions(
  permissions: Array<Permission>,
): Array<UserPermission> {
  return permissions.map((permission: Permission) => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
    };
  });
}

type CheckFunction = () => void;

function checkUpdate(
  data: Partial<WorkflowVariable>,
  permissions: Array<Permission>,
): CheckFunction {
  return () => {
    ColumnPermissions.checkDataColumnPermissions(
      WorkflowVariable,
      data as WorkflowVariable,
      makeProps(permissions),
      DatabaseRequestType.Update,
    );
  };
}

describe("ColumnPermissions on WorkflowVariable", () => {
  describe("harness guard", () => {
    /*
     * Runs first on purpose. Every other update assertion in this file is a
     * "does not throw", which an empty or mis-shaped permission set would also
     * satisfy - getModelColumnsByPermissions would return no columns, but so
     * would a props object the util silently ignored. This case has a caller
     * that genuinely lacks the update grant, so it MUST throw. If it stops
     * throwing, the props factory above is broken, not the model.
     */
    it("still refuses a read-only key that tries to write content", () => {
      expect(
        checkUpdate({ content: "rotated-token" }, [
          Permission.ReadWorkflowVariable,
        ]),
      ).toThrow(BadDataException);

      expect(
        checkUpdate({ content: "rotated-token" }, [
          Permission.ReadWorkflowVariable,
        ]),
      ).toThrow(
        "User is not allowed to update on content column of Workflow Variable",
      );
    });
  });

  describe("update", () => {
    /*
     * The fix. EditWorkflowVariable is the table-level update grant, so a key
     * holding it was already allowed to reach the update path - it just could
     * not write the only column worth writing.
     */
    it("lets a key with EditWorkflowVariable write the content column", () => {
      expect(
        checkUpdate({ content: "rotated-token" }, [
          Permission.EditWorkflowVariable,
        ]),
      ).not.toThrow();
    });

    it("still lets a key with EditWorkflowVariable write name and description", () => {
      expect(
        checkUpdate({ name: "Airflow-Token" }, [
          Permission.EditWorkflowVariable,
        ]),
      ).not.toThrow();

      expect(
        checkUpdate({ description: "Token used by the Airflow workflow" }, [
          Permission.EditWorkflowVariable,
        ]),
      ).not.toThrow();
    });

    it("still lets a project admin write the content column", () => {
      expect(
        checkUpdate({ content: "rotated-token" }, [Permission.ProjectAdmin]),
      ).not.toThrow();
    });

    it("still lets a project owner write the content column", () => {
      expect(
        checkUpdate({ content: "rotated-token" }, [Permission.ProjectOwner]),
      ).not.toThrow();
    });
  });

  describe("create", () => {
    /*
     * The create list already carried CreateWorkflowVariable, so a variable
     * could always be created with its content and then never edited. Pinned
     * here so the update widening is not mistaken for having changed create.
     */
    it("leaves the create path alone for CreateWorkflowVariable", () => {
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          WorkflowVariable,
          {
            content: "initial-token",
            name: "Airflow-Token",
          } as WorkflowVariable,
          makeProps([Permission.CreateWorkflowVariable]),
          DatabaseRequestType.Create,
        );
      }).not.toThrow();
    });
  });

  describe("read", () => {
    /*
     * content.read is [] - the secret is write-only by design, and the UI reads
     * it back through nothing. Asserting "name" is present in the same call
     * proves the read list was genuinely evaluated rather than the whole model
     * coming back empty, which would make the content assertion vacuous.
     */
    it("keeps content unreadable even for a project owner", () => {
      const columns: Columns = ColumnPermissions.getModelColumnsByPermissions(
        WorkflowVariable,
        makeUserPermissions([
          Permission.ProjectOwner,
          Permission.ReadWorkflowVariable,
        ]),
        DatabaseRequestType.Read,
      );

      expect(columns.columns).not.toContain("content");
      expect(columns.columns).toContain("name");
    });

    it("reports content as updatable but not readable for the same key", () => {
      const userPermissions: Array<UserPermission> = makeUserPermissions([
        Permission.EditWorkflowVariable,
      ]);

      const updatableColumns: Columns =
        ColumnPermissions.getModelColumnsByPermissions(
          WorkflowVariable,
          userPermissions,
          DatabaseRequestType.Update,
        );

      const readableColumns: Columns =
        ColumnPermissions.getModelColumnsByPermissions(
          WorkflowVariable,
          userPermissions,
          DatabaseRequestType.Read,
        );

      expect(updatableColumns.columns).toContain("content");
      expect(readableColumns.columns).not.toContain("content");
    });
  });
});
