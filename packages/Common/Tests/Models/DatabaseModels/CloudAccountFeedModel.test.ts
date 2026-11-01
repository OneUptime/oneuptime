import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudAccountFeed, {
  CloudAccountFeedEventType,
} from "../../../Models/DatabaseModels/CloudAccountFeed";
import CloudResourceFeed from "../../../Models/DatabaseModels/CloudResourceFeed";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * A cloud account's feed: what happened to the account in OneUptime - how
 * it came to OneUptime, its Cloud AI agent connecting or being reset, and
 * who changed what OneUptime AI may do there. It is the account's audit
 * trail for the one component that holds the credentials to change the
 * customer's cloud, so the properties pinned here are the ones an audit
 * trail cannot do without:
 *
 *   - its table exists (registered) and its route is its own;
 *   - it is a project's, and read with its account: a person who may not
 *     read the account reads none of its feed;
 *   - nobody writes it but OneUptime - no create, update or delete for any
 *     role, on the table or on any column - so nobody can forge, edit or
 *     erase an entry through the API;
 *   - it holds what every resource feed holds, under its own column names.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

const PERMISSION_PROPS: Array<PermissionProps> =
  PermissionHelper.getAllPermissionProps();

function permissionExists(permission: Permission): boolean {
  return PERMISSION_PROPS.some((props: PermissionProps): boolean => {
    return props.permission === permission;
  });
}

describe("CloudAccountFeed", () => {
  const model: CloudAccountFeed = new CloudAccountFeed();

  test("is registered, so its table is created", () => {
    expect(MODEL_TYPES).toContain(CloudAccountFeed);
  });

  test("claims its own CRUD route, which no other model shares", () => {
    expect(model.getCrudApiPath()!.toString()).toBe("/cloud-account-feed");

    const sharing: Array<string> = MODEL_TYPES.filter(
      (modelType: ModelType): boolean => {
        return (
          new modelType().getCrudApiPath()?.toString() === "/cloud-account-feed"
        );
      },
    ).map((modelType: ModelType): string => {
      return modelType.name;
    });

    expect(sharing).toEqual(["CloudAccountFeed"]);
  });

  test("is a project's, and read only by whoever may read its account", () => {
    expect(model.getTenantColumn()).toBe("projectId");
    expect(model.canAccessIfCanReadOn).toBe("cloudAccount");

    // The relation it is read through is the account.
    expect(model.getTableColumnMetadata("cloudAccount").modelType).toBe(
      CloudAccount,
    );
    expect(
      model.getTableColumnMetadata("cloudAccount").manyToOneRelationColumn,
    ).toBe("cloudAccountId");
  });

  test("an account has no owners, so its feed inherits none", () => {
    // Owned scope through an account would hide every entry from everyone.
    expect(
      (model as unknown as { ownedThrough?: unknown }).ownedThrough,
    ).toBeUndefined();
  });

  test("nobody but OneUptime writes it: no create, update or delete for any role", () => {
    expect(model.getCreatePermissions()).toEqual([]);
    expect(model.getUpdatePermissions()).toEqual([]);
    expect(model.getDeletePermissions()).toEqual([]);

    const columnAccess: Record<string, ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    expect(Object.keys(columnAccess).length).toBeGreaterThan(0);

    for (const [column, access] of Object.entries(columnAccess)) {
      expect({ column, create: access.create }).toEqual({
        column,
        create: [],
      });
      expect({ column, update: access.update }).toEqual({
        column,
        update: [],
      });
    }
  });

  test("is read with the Cloud Resource feed's permissions, as its account is with the Cloud Resource ones", () => {
    const reads: Array<Permission> = model.getReadPermissions();

    expect(reads).toEqual(new CloudResourceFeed().getReadPermissions());
    expect(reads).toContain(Permission.ReadCloudResourceFeed);

    for (const permission of reads) {
      expect(permissionExists(permission)).toBe(true);
    }

    // Everyone who may read an entry may read its account.
    const accountReads: Array<Permission> =
      new CloudAccount().getReadPermissions();

    for (const permission of reads) {
      if (permission === Permission.ReadCloudResourceFeed) {
        continue;
      }

      expect(accountReads).toContain(permission);
    }
  });

  test("holds what every resource feed holds, under its own column names", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    for (const column of [
      "projectId",
      "cloudAccountId",
      "feedInfoInMarkdown",
      "moreInformationInMarkdown",
      "cloudAccountFeedEventType",
      "displayColor",
      "userId",
      "postedAt",
    ]) {
      expect(columns).toContain(column);
    }

    expect(model.getTableColumnMetadata("cloudAccountId").required).toBe(true);
    expect(model.getTableColumnMetadata("feedInfoInMarkdown").required).toBe(
      true,
    );
  });

  test("its events are how the account came to OneUptime, and what changed since", () => {
    expect(Object.values(CloudAccountFeedEventType)).toEqual([
      "CloudAccountCreated",
      "CloudAccountUpdated",
    ]);

    // Stored verbatim: a value that drifts from its key orphans every row.
    for (const [key, value] of Object.entries(CloudAccountFeedEventType)) {
      expect(value).toBe(key);
    }
  });

  test("names itself as the account's feed", () => {
    expect(model.tableName).toBe("CloudAccountFeed");
    expect(model.singularName).toBe("Cloud Account Feed");
    expect(model.pluralName).toBe("Cloud Account Feeds");
    expect(model.tableDescription).toContain("Cloud AI agent");
  });
});
