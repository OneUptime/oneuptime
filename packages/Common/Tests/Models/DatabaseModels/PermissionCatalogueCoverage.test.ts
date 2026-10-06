import AllModelTypes from "../../../Models/DatabaseModels/Index";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import Dictionary from "../../../Types/Dictionary";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test: every permission a model gates CRUD on must exist in the
 * permission catalogue, and a model must not gate its own columns on another
 * model's permission.
 *
 * The case that prompted this: ScheduledMaintenanceTemplateOwnerUser gated its
 * required, non-nullable scheduledMaintenanceTemplateId column on the *Team*
 * create permission. It was invisible only because the two enum values happened
 * to collide, so both names resolved to one string. The moment that collision
 * was fixed the mis-key became a hard BadDataException on every create, on a
 * column the dashboard always sends — a latent break sitting behind an
 * unrelated bug.
 *
 * Sweeping every model rather than asserting on a list is the point: a mis-key
 * in a model nobody is looking at fails here instead of in production. The
 * sweep found twenty-one more of them, listed below; they are recorded as a
 * baseline rather than fixed, because each needs its own judgement about which
 * permission was meant.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

/*
 * The only two permissions a model may reference without a PermissionProps
 * entry. Both are internal markers rather than capabilities an administrator
 * hands out — AuthenticatedRequest marks "some authenticated principal made
 * this call" and UnAuthorizedSsoUser marks a user who has not yet passed the
 * project's SSO. Neither belongs in the picker, so neither has props.
 *
 * Anything else appearing here means a permission is referenced by a live model
 * but cannot be granted on its own, which is a bug, not a policy.
 */
const PERMISSIONS_WITHOUT_PROPS_BY_DESIGN: Array<string> = [
  "AuthenticatedRequest",
  "UnAuthorizedSsoUser",
];

/*
 * Columns whose create list requires a granular permission the table's own
 * create list never accepts. The copy-paste mis-keys of the same family as
 * the ScheduledMaintenanceTemplateOwnerUser one this test was written for -
 * the incident, monitor and on-call feeds asking for
 * CreateScheduledMaintenanceFeed, a monitor's current status for
 * CreateProjectIncident, a runbook secret's runners for ReadRunbookSecret, a
 * scheduled maintenance event's status message for
 * CreateIncidentPublicNote (and MetricType.services for
 * CreateProjectIncident before them) - now ask for their own record's
 * permission. What is left is a project's own columns: a project is created
 * by any signed-in user, before anyone holds a permission in it. (Its
 * creator is no longer one of them: OneUptime decides who created a record,
 * so no request writes it - UserAttribution.)
 *
 * This list must only ever shrink. A new entry means a new mis-key.
 */
const KNOWN_CROSS_MODEL_COLUMN_GATES: Array<string> = [
  "Project.businessDetails requires ManageProjectBilling",
  "Project.businessDetailsCountry requires ManageProjectBilling",
  "Project.financeAccountingEmail requires ManageProjectBilling",
  "Project.paymentProviderPlanId requires CurrentUser",
  "Project.sendInvoicesByEmail requires ManageProjectBilling",
];

function modelName(modelType: ModelType): string {
  return modelType.name;
}

function tableLevelPermissions(model: BaseModel): Array<Permission> {
  return [
    ...(model.createRecordPermissions || []),
    ...(model.readRecordPermissions || []),
    ...(model.updateRecordPermissions || []),
    ...(model.deleteRecordPermissions || []),
  ];
}

function columnLevelPermissions(model: BaseModel): Array<Permission> {
  const permissions: Array<Permission> = [];

  for (const column of model.getTableColumns().columns) {
    const accessControl: ReturnType<BaseModel["getColumnAccessControlFor"]> =
      model.getColumnAccessControlFor(column);

    if (!accessControl) {
      continue;
    }

    permissions.push(
      ...(accessControl.create || []),
      ...(accessControl.read || []),
      ...(accessControl.update || []),
    );
  }

  return permissions;
}

describe("Permission catalogue coverage across database models", () => {
  test("every model-referenced permission is a real enum member", () => {
    const validValues: Set<string> = new Set(Object.values(Permission));
    const unknown: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();

      for (const permission of [
        ...tableLevelPermissions(model),
        ...columnLevelPermissions(model),
      ]) {
        if (!validValues.has(permission as unknown as string)) {
          unknown.push(`${modelName(modelType)} -> ${permission}`);
        }
      }
    }

    expect(unknown).toEqual([]);
  });

  test("every model-referenced permission resolves to a props entry", () => {
    const withProps: Set<string> = new Set(
      PermissionHelper.getAllPermissionProps().map((props: PermissionProps) => {
        return props.permission.toString();
      }),
    );

    const allowed: Set<string> = new Set(PERMISSIONS_WITHOUT_PROPS_BY_DESIGN);

    const missing: Set<string> = new Set<string>();

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();

      for (const permission of [
        ...tableLevelPermissions(model),
        ...columnLevelPermissions(model),
      ]) {
        const value: string = permission.toString();

        if (withProps.has(value) || allowed.has(value)) {
          continue;
        }

        missing.add(`${modelName(modelType)} -> ${value}`);
      }
    }

    expect(Array.from(missing).sort()).toEqual([]);
  });

  test("the by-design exemptions really have no props", () => {
    /*
     * If somebody gives one of these a props entry, the exemption must go too —
     * otherwise it keeps excusing a permission that no longer needs it, and the
     * next genuinely-missing one hides behind it.
     */
    const withProps: Set<string> = new Set(
      PermissionHelper.getAllPermissionProps().map((props: PermissionProps) => {
        return props.permission.toString();
      }),
    );

    const stale: Array<string> = PERMISSIONS_WITHOUT_PROPS_BY_DESIGN.filter(
      (permission: string) => {
        return withProps.has(permission);
      },
    );

    expect(stale).toEqual([]);
  });

  test("no column is gated on a granular permission its table does not accept", () => {
    /*
     * A column's create list must not require a granular permission that the
     * table's own create list never accepts — the caller would pass the table
     * gate and then fail on the column, which for a required column means the
     * record can never be created by that permission at all. Roles are excluded
     * because they legitimately appear in different combinations.
     */
    const rolePermissions: Set<string> = new Set(
      PermissionHelper.getRolePermissionProps().map(
        (props: PermissionProps) => {
          return props.permission.toString();
        },
      ),
    );

    const offenders: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();

      const tableCreate: Set<string> = new Set(
        (model.createRecordPermissions || []).map((permission: Permission) => {
          return permission.toString();
        }),
      );

      if (tableCreate.size === 0) {
        continue;
      }

      for (const column of model.getTableColumns().columns) {
        const accessControl: ReturnType<
          BaseModel["getColumnAccessControlFor"]
        > = model.getColumnAccessControlFor(column);

        for (const permission of accessControl?.create || []) {
          const value: string = permission.toString();

          if (rolePermissions.has(value) || tableCreate.has(value)) {
            continue;
          }

          offenders.push(`${modelName(modelType)}.${column} requires ${value}`);
        }
      }
    }

    expect(offenders.sort()).toEqual(
      KNOWN_CROSS_MODEL_COLUMN_GATES.slice().sort(),
    );
  });
});

/*
 * The analytics tables are held to the same rule: a column's create list
 * asks for a granular permission its table accepts. An exception's span name
 * asked for the trace permissions, where every other exception column asks
 * for the exception permissions; a metric data point's columns asked for
 * the log permissions while its table asked for the trace ones. Each now
 * asks for its own family's - and with them gone, no analytics column is
 * excused from the rule.
 */
const ANALYTICS_MODELS: Array<AnalyticsBaseModel> = (
  AnalyticsModels as Array<{ new (): AnalyticsBaseModel }>
).map((modelType: { new (): AnalyticsBaseModel }): AnalyticsBaseModel => {
  return new modelType();
});

function analyticsColumnCreateLists(
  model: AnalyticsBaseModel,
): Array<{ column: string; permissions: Array<Permission> }> {
  const columns: Dictionary<ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();

  return Object.keys(columns)
    .sort()
    .map((column: string) => {
      return { column: column, permissions: columns[column]?.create || [] };
    });
}

function findAnalyticsModel(tableName: string): AnalyticsBaseModel {
  const model: AnalyticsBaseModel | undefined = ANALYTICS_MODELS.find(
    (candidate: AnalyticsBaseModel): boolean => {
      return candidate.tableName === tableName;
    },
  );

  expect([tableName, Boolean(model)]).toEqual([tableName, true]);

  return model!;
}

describe("Permission catalogue coverage across analytics models", () => {
  test("the sweep sees the analytics tables", () => {
    expect(
      ANALYTICS_MODELS.map((model: AnalyticsBaseModel): string => {
        return model.tableName;
      }),
    ).toEqual(
      expect.arrayContaining([
        AnalyticsTableName.Metric,
        AnalyticsTableName.ExceptionInstance,
      ]),
    );
  });

  test("no column is gated on a granular permission its table does not accept", () => {
    const rolePermissions: Set<string> = new Set(
      PermissionHelper.getRolePermissionProps().map(
        (props: PermissionProps) => {
          return props.permission.toString();
        },
      ),
    );

    const offenders: Array<string> = [];

    for (const model of ANALYTICS_MODELS) {
      const tableCreate: Set<string> = new Set(
        (model.getCreatePermissions() || []).map((permission: Permission) => {
          return permission.toString();
        }),
      );

      if (tableCreate.size === 0) {
        continue;
      }

      for (const list of analyticsColumnCreateLists(model)) {
        for (const permission of list.permissions) {
          const value: string = permission.toString();

          if (rolePermissions.has(value) || tableCreate.has(value)) {
            continue;
          }

          offenders.push(`${model.tableName}.${list.column} requires ${value}`);
        }
      }
    }

    expect(offenders.sort()).toEqual([]);
  });

  test("an exception's span name is created and read with the exception permissions", () => {
    const spanName: ColumnAccessControl | undefined = findAnalyticsModel(
      AnalyticsTableName.ExceptionInstance,
    ).getColumnAccessControlForAllColumns()["spanName"];

    expect(spanName?.create).toContain(Permission.CreateTelemetryException);
    expect(spanName?.read).toContain(Permission.ReadTelemetryException);
    expect(spanName?.create).not.toContain(
      Permission.CreateTelemetryServiceTraces,
    );
    expect(spanName?.read).not.toContain(Permission.ReadTelemetryServiceTraces);
  });
});

/*
 * A metric data point is the Telemetry Service Metrics family's, like the
 * metric catalogue (MetricType) beside it: its table and every column of it
 * name the metric permissions, and no column names the log or trace ones it
 * used to. Before, its columns were read with Read Telemetry Service Log
 * while the table was read with Read Telemetry Service Traces, so a custom
 * role holding Read Telemetry Service Metrics - the permission the picker
 * offers for metrics - saw no metric chart.
 */
describe("a metric data point is the metric family's", () => {
  const OTHER_FAMILIES: Array<Permission> = [
    Permission.ReadTelemetryServiceLog,
    Permission.CreateTelemetryServiceLog,
    Permission.EditTelemetryServiceLog,
    Permission.DeleteTelemetryServiceLog,
    Permission.ReadTelemetryServiceTraces,
    Permission.CreateTelemetryServiceTraces,
    Permission.EditTelemetryServiceTraces,
    Permission.DeleteTelemetryServiceTraces,
  ];

  test.each([
    ["read", Permission.ReadTelemetryServiceMetrics],
    ["create", Permission.CreateTelemetryServiceMetrics],
    ["update", Permission.EditTelemetryServiceMetrics],
    ["delete", Permission.DeleteTelemetryServiceMetrics],
  ])(
    "the table's %s list names %s",
    (operation: string, permission: Permission) => {
      const metric: AnalyticsBaseModel = findAnalyticsModel(
        AnalyticsTableName.Metric,
      );
      const list: Array<Permission> =
        operation === "read"
          ? metric.getReadPermissions()
          : operation === "create"
            ? metric.getCreatePermissions()
            : operation === "update"
              ? metric.getUpdatePermissions()
              : metric.getDeletePermissions();

      expect(list).toContain(permission);

      for (const other of OTHER_FAMILIES) {
        expect([operation, other, list.includes(other)]).toEqual([
          operation,
          other,
          false,
        ]);
      }
    },
  );

  test("every column is read and created with the metric permissions alone", () => {
    const columns: Dictionary<ColumnAccessControl> = findAnalyticsModel(
      AnalyticsTableName.Metric,
    ).getColumnAccessControlForAllColumns();

    expect(Object.keys(columns).length).toBeGreaterThan(30);

    for (const column of Object.keys(columns).sort()) {
      const read: Array<Permission> = columns[column]?.read || [];
      const create: Array<Permission> = columns[column]?.create || [];

      expect([column, read.includes(Permission.ReadTelemetryServiceMetrics)]).toEqual(
        [column, true],
      );
      expect([
        column,
        create.includes(Permission.CreateTelemetryServiceMetrics),
      ]).toEqual([column, true]);

      for (const other of OTHER_FAMILIES) {
        expect([column, other, [...read, ...create].includes(other)]).toEqual(
          [column, other, false],
        );
      }
    }
  });
});

/*
 * The columns that asked for another record's permission, each now asking
 * for its own record's - set at create by whoever may create the record.
 */
describe("the columns that asked for another record's permission", () => {
  function columnLists(
    tableName: string,
    column: string,
  ): ColumnAccessControl | undefined {
    const modelType: ModelType | undefined = MODEL_TYPES.find(
      (candidate: ModelType): boolean => {
        return new candidate().tableName === tableName;
      },
    );

    expect([tableName, Boolean(modelType)]).toEqual([tableName, true]);

    return new modelType!().getColumnAccessControlFor(column) || undefined;
  }

  test.each([
    ["Monitor", "currentMonitorStatusId", Permission.CreateProjectMonitor],
    ["IncidentFeed", "postedAt", Permission.CreateIncidentFeed],
    ["IncidentFeed", "user", Permission.CreateIncidentFeed],
    ["IncidentFeed", "userId", Permission.CreateIncidentFeed],
    ["MonitorFeed", "postedAt", Permission.CreateMonitorFeed],
    ["MonitorFeed", "user", Permission.CreateMonitorFeed],
    ["MonitorFeed", "userId", Permission.CreateMonitorFeed],
    ["OnCallDutyPolicyFeed", "postedAt", Permission.CreateOnCallDutyPolicyFeed],
    ["OnCallDutyPolicyFeed", "user", Permission.CreateOnCallDutyPolicyFeed],
    ["OnCallDutyPolicyFeed", "userId", Permission.CreateOnCallDutyPolicyFeed],
    [
      "ScheduledMaintenance",
      "subscriberNotificationStatusMessage",
      Permission.CreateProjectScheduledMaintenance,
    ],
    ["RunbookSecret", "runners", Permission.CreateRunbookSecret],
  ])(
    "%s.%s is created with %s",
    (tableName: string, column: string, permission: Permission) => {
      expect(columnLists(tableName, column)?.create).toContain(permission);
    },
  );

  test.each([
    ["IncidentFeed", Permission.ReadIncidentFeed],
    ["MonitorFeed", Permission.ReadMonitorFeed],
    ["OnCallDutyPolicyFeed", Permission.ReadOnCallDutyPolicyFeed],
  ])(
    "%s's posted-at and posted-by columns are read with %s",
    (tableName: string, permission: Permission) => {
      for (const column of ["postedAt", "user", "userId"]) {
        const read: Array<Permission> =
          columnLists(tableName, column)?.read || [];

        expect([column, read.includes(permission)]).toEqual([column, true]);
        expect(read).not.toContain(Permission.ReadScheduledMaintenanceFeed);
      }
    },
  );
});

/*
 * Read lists, by the same family rule. The server checks a select twice: the
 * record's read list (TablePermission, or the analytics ModelPermission),
 * then each selected column's (SelectPermission). A permission a column
 * names that its record's read list never accepts reads nothing on its own -
 * the record's check refuses first - so it stands in for the record's own
 * read permission, copied from another model's list. Whoever holds only the
 * record's read permission is then refused the column, and since a select
 * that names one unreadable column fails the whole request, a page that
 * lists the records fails with it. These were:
 *
 *   - a workspace notification log's links to the alert, episodes,
 *     scheduled maintenance event, status page and announcement it was
 *     posted for (and the incident's ID) listed Read Push Log;
 *   - a network device auto-import rule's Monitor Template and OID
 *     Collection Template listed the templates' read permissions, and an
 *     alert policy's Monitor Template the monitor templates';
 *   - an on-call execution log's Last Executed Escalation Rule listed the
 *     execution log timeline's;
 *   - a team's Editable, Deleteable, Permissions Editable and Should Have
 *     One Member flags listed Edit Team and Edit Team Permissions;
 *   - a project's Workflow Runs In Last 30 Days listed Read Workflow;
 *   - a metric data point's columns listed the log permissions while the
 *     table listed the trace ones (above).
 *
 * Each now names its own record's read permission. Every model, database
 * and analytics, is held to two rules: no column's read list names a
 * granular permission its record's read list leaves out, and a column open
 * below the admins is open to one of its record's own read permissions.
 * Roles are left out of the first, as for create lists; a record nobody in
 * a project may read (the server's own tables) is skipped, as no column
 * list can open it.
 *
 * A column may be narrower than its record on purpose: a secret is read
 * only by who may edit the record. Those are listed here with the reason.
 * The list may only shrink: an entry no column holds any more fails below,
 * and is removed with its reason.
 */
const KNOWN_CROSS_FAMILY_READS: Array<{
  tableName: string;
  columns: Array<string>;
  permission: Permission;
  reason: string;
}> = [
  {
    tableName: "Monitor",
    columns: [
      "incomingEmailCustomLocalPart",
      "incomingEmailSecretKey",
      "incomingRequestSecretKey",
      "serverMonitorSecretKey",
    ],
    permission: Permission.EditProjectMonitor,
    reason:
      "A monitor's incoming request and incoming email keys, its custom inbound address and its server agent key act as credentials for the monitor, so only who may edit the monitor reads them. Its readers see the monitor without them (MonitorSecretKeySelect leaves them out of the select).",
  },
  {
    tableName: "Workflow",
    columns: ["incomingEmailSecretKey", "webhookSecretKey"],
    permission: Permission.EditWorkflow,
    reason:
      "A workflow's webhook and incoming email keys start the workflow, which running it by hand takes Edit Workflow for, so only who may edit the workflow reads them. Their read list is the same as their update list on purpose.",
  },
  {
    tableName: AnalyticsTableName.RumSessionChunk,
    columns: ["payload"],
    permission: Permission.ReadRumSessionReplayPayload,
    reason:
      "A session replay chunk's payload is the recording itself. Watching a recording is its own permission, narrower than listing sessions, which is what the chunk table's own read list names.",
  },
];

interface ReadListModel {
  tableName: string;
  readList: Array<Permission>;
  columns: Dictionary<ColumnAccessControl>;
}

const READ_LIST_MODELS: Array<ReadListModel> = [
  ...MODEL_TYPES.map((modelType: ModelType): ReadListModel => {
    const model: BaseModel = new modelType();

    return {
      tableName: model.tableName || modelType.name,
      readList: model.getReadPermissions() || [],
      columns: model.getColumnAccessControlForAllColumns(),
    };
  }),
  ...ANALYTICS_MODELS.map((model: AnalyticsBaseModel): ReadListModel => {
    return {
      tableName: model.tableName,
      readList: model.getReadPermissions() || [],
      columns: model.getColumnAccessControlForAllColumns(),
    };
  }),
];

const READ_PERMISSION_PROPS: Dictionary<PermissionProps> =
  PermissionHelper.getAllPermissionPropsAsDictionary();

// One permission for one kind of record, as opposed to a role.
function isGranularPermission(permission: Permission): boolean {
  const props: PermissionProps | undefined = READ_PERMISSION_PROPS[permission];

  return Boolean(props?.isAssignableToTenant && !props.isRolePermission);
}

// A role below the admins: Project Member, Viewer, Monitor Viewer and the like.
function isRoleBelowAdmins(permission: Permission): boolean {
  const props: PermissionProps | undefined = READ_PERMISSION_PROPS[permission];

  return Boolean(
    props?.isAssignableToTenant &&
      props.isRolePermission &&
      (permission.endsWith("Member") || permission.endsWith("Viewer")),
  );
}

function knownCrossFamilyRead(
  tableName: string,
  column: string,
): { permission: Permission } | undefined {
  return KNOWN_CROSS_FAMILY_READS.find(
    (entry: { tableName: string; columns: Array<string> }): boolean => {
      return entry.tableName === tableName && entry.columns.includes(column);
    },
  );
}

function findReadListModel(tableName: string): ReadListModel {
  const model: ReadListModel | undefined = READ_LIST_MODELS.find(
    (candidate: ReadListModel): boolean => {
      return candidate.tableName === tableName;
    },
  );

  expect([tableName, Boolean(model)]).toEqual([tableName, true]);

  return model!;
}

function columnReadList(tableName: string, column: string): Array<Permission> {
  const model: ReadListModel = findReadListModel(tableName);

  expect([tableName, column, Boolean(model.columns[column])]).toEqual([
    tableName,
    column,
    true,
  ]);

  return model.columns[column]?.read || [];
}

describe("read lists name their own record's permissions", () => {
  test("the sweep sees every model, database and analytics, and their columns", () => {
    expect(READ_LIST_MODELS.length).toBeGreaterThan(400);

    expect(Object.keys(findReadListModel("WorkspaceNotificationLog").columns)).toContain(
      "alertId",
    );
    expect(
      Object.keys(findReadListModel(AnalyticsTableName.Metric).columns),
    ).toContain("value");
  });

  test("no column's read list names a granular permission its record's read list leaves out", () => {
    const foreign: Array<string> = [];

    for (const model of READ_LIST_MODELS) {
      if (model.readList.length === 0) {
        continue;
      }

      for (const column of Object.keys(model.columns).sort()) {
        for (const permission of model.columns[column]?.read || []) {
          if (
            !isGranularPermission(permission) ||
            model.readList.includes(permission) ||
            knownCrossFamilyRead(model.tableName, column)?.permission ===
              permission
          ) {
            continue;
          }

          foreign.push(`${model.tableName}.${column} reads with ${permission}`);
        }
      }
    }

    expect(foreign).toEqual([]);
  });

  /*
   * The other half of the same slip. A column may be narrower than its
   * record - a project's billing columns are for its owners - but a column
   * opened to anyone below the admins, a member role or a granular
   * permission, is opened to its record's own read permission too, or
   * whoever may read the record is refused a column a member reads.
   */
  test("a column open below the admins is open to one of its record's own read permissions", () => {
    const lockedOut: Array<string> = [];

    for (const model of READ_LIST_MODELS) {
      const recordReaders: Array<Permission> =
        model.readList.filter(isGranularPermission);

      if (recordReaders.length === 0) {
        continue;
      }

      for (const column of Object.keys(model.columns).sort()) {
        const read: Array<Permission> = model.columns[column]?.read || [];

        const isOpenBelowAdmins: boolean = read.some(
          (permission: Permission): boolean => {
            return (
              isGranularPermission(permission) || isRoleBelowAdmins(permission)
            );
          },
        );

        if (
          !isOpenBelowAdmins ||
          knownCrossFamilyRead(model.tableName, column) ||
          read.some((permission: Permission): boolean => {
            return recordReaders.includes(permission);
          })
        ) {
          continue;
        }

        lockedOut.push(
          `${model.tableName}.${column} (record: ${recordReaders.join(", ")})`,
        );
      }
    }

    expect(lockedOut).toEqual([]);
  });

  test("every known cross-family read still matches its columns, and says why", () => {
    for (const entry of KNOWN_CROSS_FAMILY_READS) {
      expect(entry.reason.length).toBeGreaterThan(40);

      const model: ReadListModel = findReadListModel(entry.tableName);

      // Still a permission the record's own read list leaves out.
      expect([
        entry.tableName,
        entry.permission,
        model.readList.includes(entry.permission),
      ]).toEqual([entry.tableName, entry.permission, false]);

      for (const column of entry.columns) {
        expect([
          `${entry.tableName}.${column}`,
          columnReadList(entry.tableName, column).includes(entry.permission),
        ]).toEqual([`${entry.tableName}.${column}`, true]);
      }
    }
  });

  /*
   * Each of these named another record's read permission and now names its
   * own record's - read by exactly who reads the record, and the server's
   * own check agrees (ColumnReadPermissionMatrix).
   */
  const NOW_READ_WITH_THEIR_RECORD: Array<{
    tableName: string;
    columns: Array<string>;
    ownPermission: Permission;
    formerPermissions: Array<Permission>;
  }> = [
    {
      tableName: "WorkspaceNotificationLog",
      columns: [
        "alert",
        "alertId",
        "alertEpisode",
        "alertEpisodeId",
        "incidentId",
        "incidentEpisode",
        "incidentEpisodeId",
        "scheduledMaintenance",
        "scheduledMaintenanceId",
        "statusPage",
        "statusPageId",
        "statusPageAnnouncement",
        "statusPageAnnouncementId",
      ],
      ownPermission: Permission.ReadWorkspaceNotificationLog,
      formerPermissions: [Permission.ReadPushLog],
    },
    {
      tableName: "NetworkDeviceAutoImportRule",
      columns: ["monitorTemplate", "monitorTemplateId"],
      ownPermission: Permission.ReadNetworkDeviceAutoImportRule,
      formerPermissions: [
        Permission.ReadMonitorTemplate,
        Permission.MonitorAdmin,
        Permission.MonitorMember,
        Permission.MonitorViewer,
      ],
    },
    {
      tableName: "NetworkDeviceAutoImportRule",
      columns: ["oidTemplate", "oidTemplateId"],
      ownPermission: Permission.ReadNetworkDeviceAutoImportRule,
      formerPermissions: [Permission.ReadNetworkDeviceOidTemplate],
    },
    {
      tableName: "NetworkAlertPolicy",
      columns: ["monitorTemplate", "monitorTemplateId"],
      ownPermission: Permission.ReadNetworkAlertPolicy,
      formerPermissions: [
        Permission.ReadMonitorTemplate,
        Permission.MonitorAdmin,
        Permission.MonitorMember,
        Permission.MonitorViewer,
      ],
    },
    {
      tableName: "OnCallDutyPolicyExecutionLog",
      columns: ["lastExecutedEscalationRule", "lastExecutedEscalationRuleId"],
      ownPermission: Permission.ReadProjectOnCallDutyPolicyExecutionLog,
      formerPermissions: [
        Permission.ReadProjectOnCallDutyPolicyExecutionLogTimeline,
      ],
    },
    {
      tableName: "Team",
      columns: [
        "isPermissionsEditable",
        "isTeamDeleteable",
        "isTeamEditable",
        "shouldHaveAtLeastOneMember",
      ],
      ownPermission: Permission.ReadProjectTeam,
      formerPermissions: [
        Permission.EditProjectTeam,
        Permission.EditProjectTeamPermissions,
      ],
    },
    {
      tableName: "Project",
      columns: ["workflowRunsInLast30Days"],
      ownPermission: Permission.ReadProject,
      formerPermissions: [Permission.ReadWorkflow],
    },
  ];

  test.each(
    NOW_READ_WITH_THEIR_RECORD.flatMap(
      (entry: {
        tableName: string;
        columns: Array<string>;
        ownPermission: Permission;
        formerPermissions: Array<Permission>;
      }): Array<[string, string, Permission, Array<Permission>]> => {
        return entry.columns.map(
          (column: string): [string, string, Permission, Array<Permission>] => {
            return [
              entry.tableName,
              column,
              entry.ownPermission,
              entry.formerPermissions,
            ];
          },
        );
      },
    ),
  )(
    "%s.%s is read with its record's own read list (%s)",
    (
      tableName: string,
      column: string,
      ownPermission: Permission,
      formerPermissions: Array<Permission>,
    ) => {
      const recordList: Array<Permission> =
        findReadListModel(tableName).readList;
      const read: Array<Permission> = columnReadList(tableName, column);

      expect(recordList).toContain(ownPermission);

      // Exactly the record's own list, so it reads as the record does.
      expect([...read].sort()).toEqual([...recordList].sort());

      for (const former of formerPermissions) {
        expect([former, read.includes(former)]).toEqual([former, false]);
      }
    },
  );
});
