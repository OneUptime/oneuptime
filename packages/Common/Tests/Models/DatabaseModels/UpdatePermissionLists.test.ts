import AllModelTypes from "../../../Models/DatabaseModels/Index";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Who may change a column is decided by two hand-written lists, and the
 * server checks both on every update: the record's own update list
 * (TablePermission) and the column's (ColumnPermission). A column's list is
 * usually a copy of a neighbouring one, and a copy taken from the wrong list
 * reads like any other list. These were:
 *
 *   - Monitor's "Disable Monitoring" listed Create Monitor where every
 *     other monitor column lists Edit Monitor;
 *   - five scheduled maintenance template columns (recurring, and whether
 *     subscribers are notified) listed Edit Scheduled Maintenance Note
 *     Template instead of Edit Scheduled Maintenance Template;
 *   - a metric's Services column listed the incident permissions;
 *   - Workflow's update lists held Delete Workflow beside Edit Workflow.
 *     Editing a workflow, and running one by hand (the Workflow API reads
 *     the same list), takes Edit Workflow.
 *
 * So every model, database and analytics, is held to three rules. They are
 * written over the permissions a team can grant inside a project: the
 * user's own (Current User) and the global ones are not about editing a
 * project's records.
 */

type ModelWithAccessLists = {
  tableName: string | null;
  getUpdatePermissions: () => Array<Permission>;
  getColumnAccessControlForAllColumns: () => Dictionary<ColumnAccessControl>;
};

const MODELS: Array<ModelWithAccessLists> = [
  ...(AllModelTypes as Array<{ new (): unknown }>),
  ...(AnalyticsModels as Array<{ new (): unknown }>),
].map((modelType: { new (): unknown }): ModelWithAccessLists => {
  return new modelType() as ModelWithAccessLists;
});

const PERMISSION_PROPS: Dictionary<PermissionProps> =
  PermissionHelper.getAllPermissionPropsAsDictionary();

// What a team can grant inside a project.
function isProjectPermission(permission: Permission): boolean {
  return Boolean(PERMISSION_PROPS[permission]?.isAssignableToTenant);
}

/*
 * One permission for one kind of record ("Edit Project Monitor"), as opposed
 * to a role that spans many (Project Admin, Monitor Member).
 */
function isRecordPermission(permission: Permission): boolean {
  return (
    isProjectPermission(permission) &&
    !PERMISSION_PROPS[permission]?.isRolePermission
  );
}

// A role below the admins: Project Member, Monitor Member and the like.
function isMemberRole(permission: Permission): boolean {
  return (
    isProjectPermission(permission) &&
    Boolean(PERMISSION_PROPS[permission]?.isRolePermission) &&
    permission.endsWith("Member")
  );
}

// A read-only role: Viewer, Monitor Viewer and the like.
function isViewerRole(permission: Permission): boolean {
  return (
    isProjectPermission(permission) &&
    Boolean(PERMISSION_PROPS[permission]?.isRolePermission) &&
    permission.endsWith("Viewer")
  );
}

// A record permission for another operation than an edit.
const NOT_AN_EDIT: RegExp = /^(Create|Read|Delete)[A-Z]/;

function isNotAnEdit(permission: Permission): boolean {
  return isViewerRole(permission) || NOT_AN_EDIT.test(permission);
}

/*
 * A model that updates with a permission named for another operation, on
 * purpose. Each entry says why. The list may only shrink: an entry that no
 * longer matches anything fails below, so it is removed with the reason it
 * stood for.
 */
const DELIBERATE: Array<{
  tableName: string;
  permission: Permission;
  reason: string;
}> = [
  {
    tableName: "RumSessionPin",
    permission: Permission.CreateRumSessionReplay,
    reason:
      "There is no Edit permission for session replay pins: a pin is created or removed, and the one field changed after the fact (its reason) is changed by whoever may pin.",
  },
];

function isDeliberate(
  tableName: string | null,
  permission: Permission,
): boolean {
  return DELIBERATE.some(
    (entry: { tableName: string; permission: Permission }) => {
      return entry.tableName === tableName && entry.permission === permission;
    },
  );
}

type UpdateList = {
  tableName: string | null;
  where: string;
  permissions: Array<Permission>;
};

function recordUpdateList(model: ModelWithAccessLists): UpdateList {
  return {
    tableName: model.tableName,
    where: `${model.tableName} (the record)`,
    permissions: model.getUpdatePermissions() || [],
  };
}

function columnUpdateLists(model: ModelWithAccessLists): Array<UpdateList> {
  const lists: Array<UpdateList> = [];
  const columns: Dictionary<ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();

  for (const column of Object.keys(columns).sort()) {
    lists.push({
      tableName: model.tableName,
      where: `${model.tableName}.${column}`,
      permissions: columns[column]?.update || [],
    });
  }

  return lists;
}

function findModel(tableName: string): ModelWithAccessLists {
  const model: ModelWithAccessLists | undefined = MODELS.find(
    (candidate: ModelWithAccessLists) => {
      return candidate.tableName === tableName;
    },
  );

  expect([tableName, Boolean(model)]).toEqual([tableName, true]);

  return model!;
}

describe("update permission lists", () => {
  test("the sweep sees every model, and the columns of each", () => {
    expect(MODELS.length).toBeGreaterThan(400);

    expect(
      columnUpdateLists(findModel("Monitor")).map((list: UpdateList) => {
        return list.where;
      }),
    ).toContain("Monitor.disableActiveMonitoring");

    // Analytics models are swept too.
    expect(
      columnUpdateLists(findModel(AnalyticsTableName.Log)).map(
        (list: UpdateList) => {
          return list.where;
        },
      ),
    ).toContain(`${AnalyticsTableName.Log}.projectId`);
  });

  /*
   * An update list holds what lets somebody change the record: a role that
   * may edit, or an Edit permission. A Create, Read or Delete permission, or
   * a read-only role, belongs in another list, and one sitting in an update
   * list was copied from the wrong one.
   */
  test("no update list holds a Create, Read or Delete permission, or a read-only role", () => {
    const misplaced: Array<string> = [];

    for (const model of MODELS) {
      for (const list of [
        recordUpdateList(model),
        ...columnUpdateLists(model),
      ]) {
        for (const permission of list.permissions) {
          if (
            isNotAnEdit(permission) &&
            !isDeliberate(list.tableName, permission)
          ) {
            misplaced.push(`${list.where}: ${permission}`);
          }
        }
      }
    }

    expect(misplaced).toEqual([]);
  });

  /*
   * A record permission on a column that its record's update list does not
   * hold never lets anybody change the column on its own - the record's
   * check refuses them first - so it stands in for the record's own Edit
   * permission, copied from another model's list. A record that nobody in a
   * project may update (the server's own tables) is skipped: no column list
   * can open it.
   */
  test("a column's update list names no record permission its record's update list leaves out", () => {
    const foreign: Array<string> = [];

    for (const model of MODELS) {
      const recordList: Array<Permission> = recordUpdateList(model).permissions;

      if (recordList.length === 0) {
        continue;
      }

      for (const list of columnUpdateLists(model)) {
        for (const permission of list.permissions) {
          if (
            isRecordPermission(permission) &&
            !recordList.includes(permission)
          ) {
            foreign.push(`${list.where}: ${permission}`);
          }
        }
      }
    }

    expect(foreign).toEqual([]);
  });

  /*
   * The other half of the same slip. A column may be narrower than its
   * record: a project's AI and retention settings are for its owners and
   * admins only, its settings columns leave out Manage Billing. But a column
   * opened to anyone below the admins - a member role or a record
   * permission - is open to the record's own Edit permission too, or
   * somebody allowed to edit the record is refused a column a member may
   * change.
   */
  test("a column opened below the admins is open to one of its record's own edit permissions", () => {
    const lockedOut: Array<string> = [];

    for (const model of MODELS) {
      const recordEditPermissions: Array<Permission> =
        recordUpdateList(model).permissions.filter(isRecordPermission);

      if (recordEditPermissions.length === 0) {
        continue;
      }

      for (const list of columnUpdateLists(model)) {
        const isOpenBelowAdmins: boolean = list.permissions.some(
          (permission: Permission) => {
            return isRecordPermission(permission) || isMemberRole(permission);
          },
        );

        if (!isOpenBelowAdmins) {
          continue;
        }

        if (
          !list.permissions.some((permission: Permission) => {
            return recordEditPermissions.includes(permission);
          })
        ) {
          lockedOut.push(
            `${list.where} (record: ${recordEditPermissions.join(", ")})`,
          );
        }
      }
    }

    expect(lockedOut).toEqual([]);
  });

  test("every deliberate exception still matches a list, and says why", () => {
    for (const entry of DELIBERATE) {
      const model: ModelWithAccessLists = findModel(entry.tableName);

      const stillUsed: boolean = [
        recordUpdateList(model),
        ...columnUpdateLists(model),
      ].some((list: UpdateList) => {
        return list.permissions.includes(entry.permission);
      });

      expect([entry.tableName, entry.permission, stillUsed]).toEqual([
        entry.tableName,
        entry.permission,
        true,
      ]);
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });
});
