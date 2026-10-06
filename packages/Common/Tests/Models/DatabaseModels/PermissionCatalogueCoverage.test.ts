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
 * for the exception permissions.
 *
 * A table whose columns ask for another family's permission on purpose, or
 * for a change of its own. This list must only ever shrink: an entry no
 * column holds any more fails below, and is removed with its reason.
 */
const KNOWN_ANALYTICS_COLUMN_GATES: Array<{
  tableName: string;
  permission: Permission;
  reason: string;
}> = [
  {
    tableName: AnalyticsTableName.Metric,
    permission: Permission.CreateTelemetryServiceLog,
    reason:
      "A metric data point's columns are created and read with the log permissions while the table's own lists name the trace permissions, and neither is the Telemetry Service Metrics family. Which family a metric belongs to decides what custom roles can read in metric charts, so it is a change of its own.",
  },
];

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

function isKnownAnalyticsGate(
  tableName: string,
  permission: Permission,
): boolean {
  return KNOWN_ANALYTICS_COLUMN_GATES.some(
    (entry: { tableName: string; permission: Permission }): boolean => {
      return entry.tableName === tableName && entry.permission === permission;
    },
  );
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

          if (
            rolePermissions.has(value) ||
            tableCreate.has(value) ||
            isKnownAnalyticsGate(model.tableName, permission)
          ) {
            continue;
          }

          offenders.push(`${model.tableName}.${list.column} requires ${value}`);
        }
      }
    }

    expect(offenders.sort()).toEqual([]);
  });

  test("an exception's span name is created and read with the exception permissions", () => {
    const spanName: ColumnAccessControl | undefined = ANALYTICS_MODELS.find(
      (model: AnalyticsBaseModel): boolean => {
        return model.tableName === AnalyticsTableName.ExceptionInstance;
      },
    )!.getColumnAccessControlForAllColumns()["spanName"];

    expect(spanName?.create).toContain(Permission.CreateTelemetryException);
    expect(spanName?.read).toContain(Permission.ReadTelemetryException);
    expect(spanName?.create).not.toContain(
      Permission.CreateTelemetryServiceTraces,
    );
    expect(spanName?.read).not.toContain(Permission.ReadTelemetryServiceTraces);
  });

  test("every known gate still matches a column, and says why", () => {
    for (const entry of KNOWN_ANALYTICS_COLUMN_GATES) {
      const model: AnalyticsBaseModel = ANALYTICS_MODELS.find(
        (candidate: AnalyticsBaseModel): boolean => {
          return candidate.tableName === entry.tableName;
        },
      )!;

      expect(entry.reason.length).toBeGreaterThan(40);
      expect([
        entry.tableName,
        entry.permission,
        analyticsColumnCreateLists(model).some(
          (list: { permissions: Array<Permission> }): boolean => {
            return list.permissions.includes(entry.permission);
          },
        ),
      ]).toEqual([entry.tableName, entry.permission, true]);
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
