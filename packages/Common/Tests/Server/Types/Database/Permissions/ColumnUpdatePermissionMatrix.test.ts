import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import SelectPermission from "../../../../../Server/Types/Database/Permissions/SelectPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MetricType from "../../../../../Models/DatabaseModels/MetricType";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenanceTemplate from "../../../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Who may change the columns whose update lists named the wrong permission,
 * asked of the server's own checks - the record's update list
 * (TablePermission) and then the column's (ColumnPermission), the two an
 * update runs before it writes - for every permission a team can grant, one
 * at a time.
 *
 *   - Monitor's "Disable Monitoring" (the Monitoring card's switch and Turn
 *     monitoring on) takes what renaming the monitor takes.
 *   - The recurring and subscriber notification settings of a scheduled
 *     maintenance template take what renaming the template takes.
 *   - A metric's Services take the telemetry metric permissions, for reading
 *     and for changing, like the record.
 *   - Every column of a workflow takes Edit Workflow (or a project owner or
 *     admin); Delete Workflow deletes workflows and nothing more.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

/*
 * Fresh props per check: DatabaseCommonInteractionPropsUtil adds the Public
 * and Current User permissions to what it is handed.
 */
function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission" as const,
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

// Every permission a team can grant inside a project.
const GRANTABLE: Array<Permission> = PermissionHelper.getTenantPermissionProps()
  .map((props: PermissionProps) => {
    return props.permission;
  })
  .sort();

/*
 * Whether one permission, on its own, lets somebody write `value` to
 * `column` of a `modelType` record: the record's update check, then the
 * column's - in the order an update asks them.
 */
function mayUpdate<TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  column: string;
  value: unknown;
  permissions: Array<Permission>;
}): boolean {
  const props: DatabaseCommonInteractionProps = propsWith(data.permissions);
  const row: TBaseModel = new data.modelType();
  (row as unknown as Record<string, unknown>)[data.column] = data.value;

  try {
    TablePermission.checkTableLevelPermissions(
      data.modelType,
      props,
      DatabaseRequestType.Update,
    );
    ColumnPermissions.checkDataColumnPermissions(
      data.modelType,
      row,
      props,
      DatabaseRequestType.Update,
    );
  } catch {
    return false;
  }

  return true;
}

function mayRead<TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  column: string;
  permissions: Array<Permission>;
}): boolean {
  const props: DatabaseCommonInteractionProps = propsWith(data.permissions);

  try {
    TablePermission.checkTableLevelPermissions(
      data.modelType,
      props,
      DatabaseRequestType.Read,
    );
    SelectPermission.checkSelectPermission(
      data.modelType,
      { _id: true, [data.column]: true } as never,
      props,
    );
  } catch {
    return false;
  }

  return true;
}

// Which grantable permissions, each on its own, may write the column.
function whoMayUpdate<TBaseModel extends BaseModel>(
  modelType: { new (): TBaseModel },
  column: string,
  value: unknown,
): Array<Permission> {
  return GRANTABLE.filter((permission: Permission) => {
    return mayUpdate({
      modelType,
      column,
      value,
      permissions: [permission],
    });
  });
}

describe("Monitor.disableActiveMonitoring", () => {
  const EDITORS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.MonitorAdmin,
    Permission.MonitorMember,
    Permission.EditProjectMonitor,
  ];

  test("whoever may edit a monitor may turn its checks off and on", () => {
    expect(whoMayUpdate(Monitor, "disableActiveMonitoring", true)).toEqual(
      [...EDITORS].sort(),
    );
  });

  test("it takes exactly what renaming the monitor takes", () => {
    expect(whoMayUpdate(Monitor, "disableActiveMonitoring", false)).toEqual(
      whoMayUpdate(Monitor, "name", "Renamed monitor"),
    );
  });

  test.each([
    Permission.CreateProjectMonitor,
    Permission.ReadProjectMonitor,
    Permission.DeleteProjectMonitor,
    Permission.Viewer,
    Permission.MonitorViewer,
  ])(
    "%s alone does not turn a monitor's checks off",
    (permission: Permission) => {
      expect(
        mayUpdate({
          modelType: Monitor,
          column: "disableActiveMonitoring",
          value: true,
          permissions: [permission],
        }),
      ).toBe(false);
    },
  );

  test("Create Monitor beside Edit Monitor still lets the switch be changed", () => {
    expect(
      mayUpdate({
        modelType: Monitor,
        column: "disableActiveMonitoring",
        value: true,
        permissions: [
          Permission.CreateProjectMonitor,
          Permission.EditProjectMonitor,
        ],
      }),
    ).toBe(true);
  });
});

describe("ScheduledMaintenanceTemplate recurring and notification settings", () => {
  const COLUMNS: Array<[string, unknown]> = [
    ["isRecurringEvent", true],
    ["scheduleNextEventAt", new Date("2026-11-01T09:00:00.000Z")],
    ["shouldStatusPageSubscribersBeNotifiedOnEventCreated", false],
    ["shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing", false],
    ["shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded", false],
  ];

  test.each(COLUMNS)(
    "%s takes exactly what renaming the template takes",
    (column: string, value: unknown) => {
      const renamers: Array<Permission> = whoMayUpdate(
        ScheduledMaintenanceTemplate,
        "templateName",
        "Renamed template",
      );

      expect(renamers).toContain(Permission.EditScheduledMaintenanceTemplate);
      expect(whoMayUpdate(ScheduledMaintenanceTemplate, column, value)).toEqual(
        renamers,
      );
    },
  );

  test.each(COLUMNS)(
    "%s is not changed with the note template permission",
    (column: string, value: unknown) => {
      expect(
        mayUpdate({
          modelType: ScheduledMaintenanceTemplate,
          column,
          value,
          permissions: [Permission.EditScheduledMaintenanceNoteTemplate],
        }),
      ).toBe(false);
    },
  );
});

describe("MetricType.services", () => {
  test("is changed with the metric permissions, exactly as the record is", () => {
    expect(whoMayUpdate(MetricType, "services", [])).toEqual(
      [...new MetricType().getUpdatePermissions()].sort(),
    );
  });

  test("is read with the metric permissions, exactly as the record is", () => {
    const readers: Array<Permission> = GRANTABLE.filter(
      (permission: Permission) => {
        return mayRead({
          modelType: MetricType,
          column: "services",
          permissions: [permission],
        });
      },
    );

    expect(readers).toEqual([...new MetricType().getReadPermissions()].sort());
    expect(readers).toContain(Permission.ReadTelemetryServiceMetrics);
  });

  test("the incident permissions do not reach it", () => {
    for (const permission of [
      Permission.EditProjectIncident,
      Permission.ReadProjectIncident,
      Permission.CreateProjectIncident,
    ]) {
      expect([
        permission,
        mayUpdate({
          modelType: MetricType,
          column: "services",
          value: [],
          permissions: [permission],
        }),
      ]).toEqual([permission, false]);
    }
  });
});

describe("Workflow", () => {
  const EDITORS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditWorkflow,
  ];

  const COLUMNS: Array<[string, unknown]> = [
    ["name", "Renamed workflow"],
    ["description", "What it does"],
    ["graph", {}],
    ["isEnabled", true],
    ["isArchived", true],
    ["labels", []],
  ];

  test("the record's update list is Edit Workflow and the project owners and admins", () => {
    expect([...new Workflow().getUpdatePermissions()].sort()).toEqual(
      [...EDITORS].sort(),
    );
  });

  test.each(COLUMNS)(
    "%s is changed by exactly the workflow's editors",
    (column: string, value: unknown) => {
      expect(whoMayUpdate(Workflow, column, value)).toEqual(
        [...EDITORS].sort(),
      );
    },
  );

  test("Delete Workflow alone changes no column of a workflow", () => {
    for (const [column, value] of COLUMNS) {
      expect([
        column,
        mayUpdate({
          modelType: Workflow,
          column,
          value,
          permissions: [Permission.DeleteWorkflow],
        }),
      ]).toEqual([column, false]);
    }
  });

  test("Delete Workflow still deletes a workflow", () => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        Workflow,
        propsWith([Permission.DeleteWorkflow]),
        DatabaseRequestType.Delete,
      );
    }).not.toThrow();
  });
});
