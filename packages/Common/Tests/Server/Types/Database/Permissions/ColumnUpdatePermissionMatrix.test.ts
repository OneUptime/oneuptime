import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import SelectPermission from "../../../../../Server/Types/Database/Permissions/SelectPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ApiKey from "../../../../../Models/DatabaseModels/ApiKey";
import ApiKeyPermission from "../../../../../Models/DatabaseModels/ApiKeyPermission";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../../../Models/DatabaseModels/IncidentTemplate";
import MetricType from "../../../../../Models/DatabaseModels/MetricType";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceTemplate from "../../../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";

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
 *   - A template's Change Monitor Status to (incident and scheduled
 *     maintenance) and an incident template's Initial Incident State take
 *     what renaming the template takes, by the relation the template's cards
 *     write as by its ID column. The relation took nobody's.
 *   - An API key permission row stays with the key it was made for: neither
 *     apiKeyId nor the apiKey relation is changed by anyone. The relation
 *     was changeable while its ID column was not.
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
    ...ON_HIGHEST_PLAN,
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

  /*
   * And Edit All Operational Resources: a monitor is an operational
   * resource, and the column lets in everyone its table does, so it accepts
   * the table's wildcard as the table does.
   */
  test("whoever may edit a monitor may turn its checks off and on", () => {
    expect(whoMayUpdate(Monitor, "disableActiveMonitoring", true)).toEqual(
      [...EDITORS, Permission.EditAllOperationalResources].sort(),
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

  /*
   * A workflow is an operational resource, and each of these columns lets
   * in everyone the workflow's own list does, so each accepts Edit All
   * Operational Resources as the record does.
   */
  test.each(COLUMNS)(
    "%s is changed by exactly the workflow's editors",
    (column: string, value: unknown) => {
      expect(whoMayUpdate(Workflow, column, value)).toEqual(
        [...EDITORS, Permission.EditAllOperationalResources].sort(),
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

describe("a template's Change Monitor Status to and Initial Incident State", () => {
  interface TemplateRelation {
    name: string;
    modelType: { new (): BaseModel };
    relation: string;
    idColumn: string;
    relatedModelType: { new (): BaseModel };
    editors: Array<Permission>;
    notEditors: Array<Permission>;
    otherProductEditor: Permission;
  }

  const INCIDENT_TEMPLATE_EDITORS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.EditIncidentTemplate,
  ];

  const INCIDENT_TEMPLATE_NOT_EDITORS: Array<Permission> = [
    Permission.CreateIncidentTemplate,
    Permission.ReadIncidentTemplate,
    Permission.DeleteIncidentTemplate,
    Permission.Viewer,
    Permission.IncidentViewer,
  ];

  const RELATIONS: Array<TemplateRelation> = [
    {
      name: "IncidentTemplate.changeMonitorStatusTo",
      modelType: IncidentTemplate,
      relation: "changeMonitorStatusTo",
      idColumn: "changeMonitorStatusToId",
      relatedModelType: MonitorStatus,
      editors: INCIDENT_TEMPLATE_EDITORS,
      notEditors: INCIDENT_TEMPLATE_NOT_EDITORS,
      otherProductEditor: Permission.EditScheduledMaintenanceTemplate,
    },
    {
      name: "IncidentTemplate.initialIncidentState",
      modelType: IncidentTemplate,
      relation: "initialIncidentState",
      idColumn: "initialIncidentStateId",
      relatedModelType: IncidentState,
      editors: INCIDENT_TEMPLATE_EDITORS,
      notEditors: INCIDENT_TEMPLATE_NOT_EDITORS,
      otherProductEditor: Permission.EditScheduledMaintenanceTemplate,
    },
    {
      name: "ScheduledMaintenanceTemplate.changeMonitorStatusTo",
      modelType: ScheduledMaintenanceTemplate,
      relation: "changeMonitorStatusTo",
      idColumn: "changeMonitorStatusToId",
      relatedModelType: MonitorStatus,
      editors: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.ScheduledMaintenanceAdmin,
        Permission.ScheduledMaintenanceMember,
        Permission.EditScheduledMaintenanceTemplate,
      ],
      notEditors: [
        Permission.CreateScheduledMaintenanceTemplate,
        Permission.ReadScheduledMaintenanceTemplate,
        Permission.DeleteScheduledMaintenanceTemplate,
        Permission.Viewer,
        Permission.ScheduledMaintenanceViewer,
      ],
      otherProductEditor: Permission.EditIncidentTemplate,
    },
  ];

  // What a form writes into the relation: the picked record, by its id.
  function picked(modelType: { new (): BaseModel }): BaseModel {
    const record: BaseModel = new modelType();
    record._id = ObjectID.generate().toString();
    return record;
  }

  test.each(RELATIONS)(
    "$name is changed by exactly the template's editors",
    (template: TemplateRelation) => {
      expect(
        whoMayUpdate(
          template.modelType,
          template.relation,
          picked(template.relatedModelType),
        ),
      ).toEqual([...template.editors].sort());
    },
  );

  test.each(RELATIONS)(
    "$name takes exactly what renaming the template takes",
    (template: TemplateRelation) => {
      expect(
        whoMayUpdate(
          template.modelType,
          template.relation,
          picked(template.relatedModelType),
        ),
      ).toEqual(
        whoMayUpdate(template.modelType, "templateName", "Renamed template"),
      );
    },
  );

  test.each(RELATIONS)(
    "$name takes exactly what its ID column takes",
    (template: TemplateRelation) => {
      expect(
        whoMayUpdate(
          template.modelType,
          template.relation,
          picked(template.relatedModelType),
        ),
      ).toEqual(
        whoMayUpdate(
          template.modelType,
          template.idColumn,
          ObjectID.generate(),
        ),
      );
    },
  );

  test.each(RELATIONS)(
    "$name is cleared by the same people",
    (template: TemplateRelation) => {
      expect(whoMayUpdate(template.modelType, template.relation, null)).toEqual(
        [...template.editors].sort(),
      );
    },
  );

  test.each(RELATIONS)(
    "$name is not changed with a create, read or delete template permission, or a read-only role",
    (template: TemplateRelation) => {
      for (const permission of template.notEditors) {
        expect([
          permission,
          mayUpdate({
            modelType: template.modelType,
            column: template.relation,
            value: picked(template.relatedModelType),
            permissions: [permission],
          }),
        ]).toEqual([permission, false]);
      }
    },
  );

  test.each(RELATIONS)(
    "$name is not changed by the other product's template editors",
    (template: TemplateRelation) => {
      expect(
        mayUpdate({
          modelType: template.modelType,
          column: template.relation,
          value: picked(template.relatedModelType),
          permissions: [template.otherProductEditor],
        }),
      ).toBe(false);
    },
  );
});

describe("ApiKeyPermission's API key", () => {
  function key(): ApiKey {
    const apiKey: ApiKey = new ApiKey();
    apiKey._id = ObjectID.generate().toString();
    return apiKey;
  }

  test("is not moved to another key by anyone, by the relation", () => {
    expect(whoMayUpdate(ApiKeyPermission, "apiKey", key())).toEqual([]);
  });

  test("is not moved to another key by anyone, by the ID column", () => {
    expect(
      whoMayUpdate(ApiKeyPermission, "apiKeyId", ObjectID.generate()),
    ).toEqual([]);
  });

  test("the row itself is still edited by those who edit API key permissions", () => {
    expect(whoMayUpdate(ApiKeyPermission, "isBlockPermission", true)).toContain(
      Permission.EditProjectApiKeyPermissions,
    );
  });
});
