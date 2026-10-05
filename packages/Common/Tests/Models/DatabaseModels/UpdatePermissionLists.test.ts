import AllModelTypes from "../../../Models/DatabaseModels/Index";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
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
 *   - an incident template's Change Monitor Status to and Initial Incident
 *     State, and a scheduled maintenance template's Change Monitor Status
 *     to, listed nobody on the relation and the template's editors on its
 *     ID column (see the last rule).
 *
 * So every model, database and analytics, is held to three rules, and
 * every database model to a fourth, about relations. They are written over
 * the permissions a team can grant inside a project: the user's own
 * (Current User) and the global ones are not about editing a project's
 * records.
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

/*
 * A relation and its ID column - Change Monitor Status To and Change
 * Monitor Status To ID - are two names for one database column, and an
 * update writes it by either: the API takes both, and the dashboard's forms
 * write the relation. A shorter list on one of the two keeps nobody from
 * the column - they write it by the other name - it only hides the column
 * from whatever writes by that name. A form leaves out a field its viewer
 * may not update (ModelForm), so an incident template's Change Monitor
 * Status to and Initial Incident State, and a scheduled maintenance
 * template's Change Monitor Status to, were missing from their Edit for
 * everybody but master admins, while the same people changed the column
 * through its ID over the API.
 */

interface RelationAndIdColumn {
  tableName: string;
  relation: string;
  idColumn: string;
  relationList: Array<Permission>;
  idColumnList: Array<Permission>;
}

const DATABASE_MODELS: Array<BaseModel> = (
  AllModelTypes as Array<{ new (): BaseModel }>
).map((modelType: { new (): BaseModel }): BaseModel => {
  return new modelType();
});

function sortedCopy(permissions: Array<Permission>): Array<Permission> {
  return [...permissions].sort();
}

// Every relation of a model whose ID column is one of the model's columns.
function relationsWithIdColumns(model: BaseModel): Array<RelationAndIdColumn> {
  const accessLists: Dictionary<ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();
  const columns: Array<string> = model.getTableColumns().columns;
  const relations: Array<RelationAndIdColumn> = [];

  for (const column of [...columns].sort()) {
    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(column);

    if (
      metadata?.type !== TableColumnType.Entity ||
      !metadata.manyToOneRelationColumn ||
      !columns.includes(metadata.manyToOneRelationColumn)
    ) {
      continue;
    }

    const idColumn: string = metadata.manyToOneRelationColumn;

    relations.push({
      tableName: model.tableName || "",
      relation: column,
      idColumn: idColumn,
      relationList: sortedCopy(accessLists[column]?.update || []),
      idColumnList: sortedCopy(accessLists[idColumn]?.update || []),
    });
  }

  return relations;
}

const ALL_RELATIONS: Array<RelationAndIdColumn> = DATABASE_MODELS.flatMap(
  (model: BaseModel): Array<RelationAndIdColumn> => {
    return relationsWithIdColumns(model);
  },
);

function findRelation(
  tableName: string,
  relation: string,
): RelationAndIdColumn {
  const found: RelationAndIdColumn | undefined = ALL_RELATIONS.find(
    (candidate: RelationAndIdColumn) => {
      return (
        candidate.tableName === tableName && candidate.relation === relation
      );
    },
  );

  expect([`${tableName}.${relation}`, Boolean(found)]).toEqual([
    `${tableName}.${relation}`,
    true,
  ]);

  return found!;
}

function haveOneList(relation: RelationAndIdColumn): boolean {
  return relation.relationList.join(",") === relation.idColumnList.join(",");
}

/*
 * Relations whose two lists differ, each left as it is for a change of its
 * own. The list may only shrink: an entry whose lists have come to agree
 * fails below, so it is removed with the reason it stood for.
 */
interface RelationsLeftApart {
  tableName: string;
  relations: Array<string>;
  reason: string;
}

const RELATIONS_LEFT_APART: Array<RelationsLeftApart> = [
  {
    tableName: "UserNotificationRule",
    relations: [
      "userCall",
      "userEmail",
      "userMicrosoftTeams",
      "userPush",
      "userSlack",
      "userSms",
      "userTelegram",
      "userWebhook",
      "userWhatsApp",
    ],
    reason:
      "On purpose, as the model explains above userCall: an administrator re-points a rule's method through the ID column only, so the check that the method is the rule owner's own has one spelling to validate.",
  },
  {
    tableName: "Alert",
    relations: ["monitorStatusWhenThisAlertWasCreated"],
    reason:
      "The monitor's status when the alert was raised, which the server writes. No form changes it; whether its ID should stay writable over the API is a question about alerts.",
  },
  {
    tableName: "Monitor",
    relations: ["monitorTemplate"],
    reason:
      "The template a monitor was created from, which its sync follows. No form changes it through the relation; whether it may change after the monitor is created is a question about monitor templates.",
  },
  {
    tableName: "ScheduledMaintenance",
    relations: ["changeMonitorStatusTo"],
    reason:
      "An event's monitor status is picked when the event is created: its Affected Resources Edit does not ask it, and the docs say so, while the ID stays writable over the API as it always was. Whether it may change afterwards is a question about events, not templates.",
  },
];

function isLeftApart(relation: RelationAndIdColumn): boolean {
  return RELATIONS_LEFT_APART.some((entry: RelationsLeftApart) => {
    return (
      entry.tableName === relation.tableName &&
      entry.relations.includes(relation.relation)
    );
  });
}

describe("a relation and its ID column", () => {
  test("the sweep sees the relations of every model, and their ID columns", () => {
    expect(ALL_RELATIONS.length).toBeGreaterThan(400);

    expect(
      findRelation("IncidentTemplate", "changeMonitorStatusTo").idColumn,
    ).toBe("changeMonitorStatusToId");
    expect(
      findRelation("IncidentTemplate", "initialIncidentState").idColumn,
    ).toBe("initialIncidentStateId");
    expect(
      findRelation("ScheduledMaintenanceTemplate", "changeMonitorStatusTo")
        .idColumn,
    ).toBe("changeMonitorStatusToId");
  });

  test("share one update list", () => {
    const apart: Array<string> = ALL_RELATIONS.filter(
      (relation: RelationAndIdColumn) => {
        return !isLeftApart(relation) && !haveOneList(relation);
      },
    ).map((relation: RelationAndIdColumn): string => {
      return `${relation.tableName}.${relation.relation} [${relation.relationList.join(", ")}] / ${relation.idColumn} [${relation.idColumnList.join(", ")}]`;
    });

    expect(apart).toEqual([]);
  });

  /*
   * The three that were apart: changed by exactly the people who may edit
   * the template, by either name.
   */
  test.each([
    ["IncidentTemplate", "changeMonitorStatusTo", "EditIncidentTemplate"],
    ["IncidentTemplate", "initialIncidentState", "EditIncidentTemplate"],
    [
      "ScheduledMaintenanceTemplate",
      "changeMonitorStatusTo",
      "EditScheduledMaintenanceTemplate",
    ],
  ])(
    "%s.%s takes the template's own update list, by either name",
    (tableName: string, relation: string, editPermission: string) => {
      const found: RelationAndIdColumn = findRelation(tableName, relation);
      const recordList: Array<Permission> = sortedCopy(
        recordUpdateList(findModel(tableName)).permissions,
      );

      expect(found.relationList).toEqual(recordList);
      expect(found.idColumnList).toEqual(recordList);
      expect(found.relationList).toContain(editPermission as Permission);
    },
  );

  test("every relation left apart still differs, and says why", () => {
    for (const entry of RELATIONS_LEFT_APART) {
      expect(entry.reason.length).toBeGreaterThan(40);

      for (const relation of entry.relations) {
        const found: RelationAndIdColumn = findRelation(
          entry.tableName,
          relation,
        );

        expect([`${entry.tableName}.${relation}`, haveOneList(found)]).toEqual([
          `${entry.tableName}.${relation}`,
          false,
        ]);
      }
    }
  });
});
