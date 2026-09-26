import StatusPageSubscriber from "../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseRequestType from "../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../Server/Types/Database/Permissions/ColumnPermission";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Email from "../../Types/Email";
import ObjectID from "../../Types/ObjectID";
import Permission, { UserTenantAccessPermission } from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The two columns behind unsubscribing without signing in, in model
 * metadata, where a later well-meaning edit could change them without
 * breaking any functional test:
 *
 *   - unsubscribeToken is a credential. Holding it unsubscribes the
 *     subscription, so nobody reads it through the API (the dashboard, the
 *     public status page API, exports), nobody writes it, and it stays out
 *     of the API documentation. It is `computed` so the create column check
 *     - which runs after the service mints it - lets a teammate's create
 *     through.
 *   - unsubscribedAt is readable by exactly the roles that read the rest of
 *     a subscriber, and written only by the service.
 */

const model: StatusPageSubscriber = new StatusPageSubscriber();

const projectId: ObjectID = ObjectID.generate();

function props(permissions: Array<Permission>): DatabaseCommonInteractionProps {
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
    userId: ObjectID.generate(),
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

function accessControl(column: string): ColumnAccessControl {
  const control: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);

  expect(control).not.toBeNull();

  return control as ColumnAccessControl;
}

function metadata(column: string): TableColumnMetadata {
  return model.getTableColumnMetadata(column);
}

describe("StatusPageSubscriber.unsubscribeToken", () => {
  test("nobody can read, create or update it through the API", () => {
    expect(accessControl("unsubscribeToken")).toEqual({
      create: [],
      read: [],
      update: [],
    });
  });

  test("is computed, short text and hidden from the API documentation", () => {
    expect(metadata("unsubscribeToken").computed).toBe(true);
    expect(metadata("unsubscribeToken").hideColumnInDocumentation).toBe(true);
    expect(metadata("unsubscribeToken").type).toBe(TableColumnType.ShortText);
  });

  test("a teammate's create carrying the minted token passes the column check", () => {
    const created: StatusPageSubscriber = new StatusPageSubscriber();
    created.projectId = projectId;
    created.statusPageId = ObjectID.generate();
    created.subscriberEmail = new Email("site03-all@acme.com");
    created.isSubscriptionConfirmed = true;
    created.unsubscribeToken = "ab".repeat(32);

    for (const permission of [
      Permission.ProjectAdmin,
      Permission.StatusPageAdmin,
      Permission.CreateStatusPageSubscriber,
    ]) {
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          StatusPageSubscriber,
          created,
          props([permission]),
          DatabaseRequestType.Create,
        );
      }).not.toThrow();
    }
  });

  test("nobody may rewrite it on an update", () => {
    const update: StatusPageSubscriber = new StatusPageSubscriber();
    update.unsubscribeToken = "ab".repeat(32);

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        StatusPageSubscriber,
        update,
        props([Permission.ProjectOwner, Permission.ProjectAdmin]),
        DatabaseRequestType.Update,
      );
    }).toThrow(/unsubscribeToken/);
  });
});

describe("StatusPageSubscriber.unsubscribedAt", () => {
  test("is read by exactly the roles that read whether a subscriber is unsubscribed", () => {
    expect([...accessControl("unsubscribedAt").read].sort()).toEqual(
      [...accessControl("isUnsubscribed").read].sort(),
    );
    expect(accessControl("unsubscribedAt").read).toContain(
      Permission.StatusPageViewer,
    );
  });

  test("nobody writes it through the API; the service does", () => {
    expect(accessControl("unsubscribedAt").create).toEqual([]);
    expect(accessControl("unsubscribedAt").update).toEqual([]);
    expect(metadata("unsubscribedAt").computed).toBe(true);
    expect(metadata("unsubscribedAt").type).toBe(TableColumnType.Date);
  });

  test("a teammate cannot backdate it on an update", () => {
    const update: StatusPageSubscriber = new StatusPageSubscriber();
    update.unsubscribedAt = new Date("2001-01-01T00:00:00.000Z");

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        StatusPageSubscriber,
        update,
        props([Permission.ProjectOwner]),
        DatabaseRequestType.Update,
      );
    }).toThrow(/unsubscribedAt/);
  });

  test("toggling Is Unsubscribed on the dashboard is still allowed", () => {
    const update: StatusPageSubscriber = new StatusPageSubscriber();
    update.isUnsubscribed = true;

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        StatusPageSubscriber,
        update,
        props([Permission.StatusPageMember]),
        DatabaseRequestType.Update,
      );
    }).not.toThrow();
  });
});
