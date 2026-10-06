import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import SelectPermission from "../../../../../Server/Types/Database/Permissions/SelectPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import NetworkAlertPolicy from "../../../../../Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDeviceAutoImportRule from "../../../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import Project from "../../../../../Models/DatabaseModels/Project";
import Team from "../../../../../Models/DatabaseModels/Team";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import WorkspaceNotificationLog from "../../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Who may read the columns whose read lists named another record's read
 * permission, asked of the server's own checks - the record's read list
 * (TablePermission) and then the column's (SelectPermission), the two a read
 * runs before it selects - for every permission a team or an API key can be
 * granted, one at a time.
 *
 * Each column is now read by exactly who reads its record: the same people
 * who read a column that always had the record's own list (a log's message,
 * a rule's name). So the record's own read permission reads it on its own,
 * the permission it named before reads nothing on its own, and nobody who
 * may read the record is refused it - which, because a select naming one
 * unreadable column fails the whole request, used to fail the list a page
 * asks for.
 *
 * The API and Terraform read with an API key, whose permissions are its
 * grants plus Current User; a signed-in member also holds Project User, the
 * mark of membership every shared table reads through. Both are asked.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

type Principal = "member" | "apiKey";

const PRINCIPALS: Array<Principal> = ["member", "apiKey"];

/*
 * Fresh props per check: DatabaseCommonInteractionPropsUtil adds Public and
 * Current User to the global permissions it is handed. The tenant set is
 * what AccessTokenService gives a member and APIKeyAccessPermission gives a
 * key: Current User and Unauthorized SSO User for both, Project User for a
 * member.
 */
function propsFor(
  principal: Principal,
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const implicit: Array<Permission> =
    principal === "member"
      ? [
          Permission.CurrentUser,
          Permission.UnAuthorizedSsoUser,
          Permission.ProjectUser,
        ]
      : [Permission.CurrentUser, Permission.UnAuthorizedSsoUser];

  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: [...implicit, ...permissions].map(
          (permission: Permission) => {
            return {
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission" as const,
            };
          },
        ),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

// Every permission a team or an API key can be granted inside a project.
const GRANTABLE: Array<Permission> = PermissionHelper.getTenantPermissionProps()
  .map((props: PermissionProps) => {
    return props.permission;
  })
  .sort();

type ModelType = { new (): BaseModel };

/*
 * Whether `permissions` let `principal` select `column` of a `modelType`
 * record: the record's read check, then the select's - in the order a read
 * asks them.
 */
function mayRead(data: {
  modelType: ModelType;
  column: string;
  permissions: Array<Permission>;
  principal: Principal;
}): boolean {
  const props: DatabaseCommonInteractionProps = propsFor(
    data.principal,
    data.permissions,
  );

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

// Which grantable permissions, each on its own, let the principal read it.
function whoMayRead(
  modelType: ModelType,
  column: string,
  principal: Principal,
): Array<Permission> {
  return GRANTABLE.filter((permission: Permission) => {
    return mayRead({
      modelType,
      column,
      permissions: [permission],
      principal,
    });
  });
}

interface ChangedColumns {
  modelType: ModelType;
  columns: Array<string>;
  // A column that always had the record's own read list.
  readLikeColumn: string;
  ownPermission: Permission;
  formerPermissions: Array<Permission>;
  // Who reads it, each permission on its own, for an API key.
  apiKeyReaders: Array<Permission>;
}

const RECORD_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
];

const CHANGED: Array<ChangedColumns> = [
  {
    modelType: WorkspaceNotificationLog,
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
    readLikeColumn: "message",
    ownPermission: Permission.ReadWorkspaceNotificationLog,
    formerPermissions: [Permission.ReadPushLog],
    apiKeyReaders: [
      ...RECORD_READERS,
      Permission.ReadWorkspaceNotificationLog,
    ],
  },
  {
    modelType: NetworkDeviceAutoImportRule,
    columns: ["monitorTemplate", "monitorTemplateId"],
    readLikeColumn: "name",
    ownPermission: Permission.ReadNetworkDeviceAutoImportRule,
    formerPermissions: [
      Permission.ReadMonitorTemplate,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
    ],
    apiKeyReaders: [
      ...RECORD_READERS,
      Permission.ReadNetworkDeviceAutoImportRule,
    ],
  },
  {
    modelType: NetworkDeviceAutoImportRule,
    columns: ["oidTemplate", "oidTemplateId"],
    readLikeColumn: "name",
    ownPermission: Permission.ReadNetworkDeviceAutoImportRule,
    formerPermissions: [Permission.ReadNetworkDeviceOidTemplate],
    apiKeyReaders: [
      ...RECORD_READERS,
      Permission.ReadNetworkDeviceAutoImportRule,
    ],
  },
  {
    modelType: NetworkAlertPolicy,
    columns: ["monitorTemplate", "monitorTemplateId"],
    readLikeColumn: "name",
    ownPermission: Permission.ReadNetworkAlertPolicy,
    formerPermissions: [
      Permission.ReadMonitorTemplate,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
    ],
    apiKeyReaders: [...RECORD_READERS, Permission.ReadNetworkAlertPolicy],
  },
  {
    modelType: OnCallDutyPolicyExecutionLog,
    columns: ["lastExecutedEscalationRule", "lastExecutedEscalationRuleId"],
    readLikeColumn: "status",
    ownPermission: Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    formerPermissions: [
      Permission.ReadProjectOnCallDutyPolicyExecutionLogTimeline,
    ],
    apiKeyReaders: [
      ...RECORD_READERS,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
  },
  {
    modelType: Team,
    columns: [
      "isPermissionsEditable",
      "isTeamDeleteable",
      "isTeamEditable",
      "shouldHaveAtLeastOneMember",
    ],
    readLikeColumn: "name",
    ownPermission: Permission.ReadProjectTeam,
    formerPermissions: [
      Permission.EditProjectTeam,
      Permission.EditProjectTeamPermissions,
    ],
    apiKeyReaders: [
      ...RECORD_READERS,
      Permission.ProjectUser,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectTeam,
    ],
  },
];

const CHANGED_ROWS: Array<[string, ChangedColumns, string]> = CHANGED.flatMap(
  (entry: ChangedColumns): Array<[string, ChangedColumns, string]> => {
    return entry.columns.map(
      (column: string): [string, ChangedColumns, string] => {
        return [
          (new entry.modelType().tableName || "") + "." + column,
          entry,
          column,
        ];
      },
    );
  },
);

describe("columns read with their record's own read permission", () => {
  test("the harness refuses a column the permission does not read", () => {
    /*
     * Runs first on purpose: every "reads it" below would also pass if the
     * props were mis-shaped and every check threw for the same wrong reason
     * - mayRead would answer false everywhere, and the equalities would
     * compare two empty lists. A record reader that may not read a secret
     * column has to be refused, and a record reader has to read its name.
     */
    expect(
      mayRead({
        modelType: Monitor,
        column: "name",
        permissions: [Permission.ReadProjectMonitor],
        principal: "apiKey",
      }),
    ).toBe(true);
    expect(
      mayRead({
        modelType: Monitor,
        column: "serverMonitorSecretKey",
        permissions: [Permission.ReadProjectMonitor],
        principal: "apiKey",
      }),
    ).toBe(false);
  });

  test.each(CHANGED_ROWS)(
    "%s is read by exactly who reads its record",
    (_label: string, entry: ChangedColumns, column: string) => {
      for (const principal of PRINCIPALS) {
        expect([
          column,
          principal,
          whoMayRead(entry.modelType, column, principal),
        ]).toEqual([
          column,
          principal,
          whoMayRead(entry.modelType, entry.readLikeColumn, principal),
        ]);
      }
    },
  );

  test.each(CHANGED_ROWS)(
    "%s is read by an API key with its record's own read permissions",
    (_label: string, entry: ChangedColumns, column: string) => {
      expect([column, whoMayRead(entry.modelType, column, "apiKey")]).toEqual([
        column,
        [...entry.apiKeyReaders].sort(),
      ]);
    },
  );

  test.each(CHANGED_ROWS)(
    "%s is read with its record's own read permission alone, not the one it named before",
    (_label: string, entry: ChangedColumns, column: string) => {
      for (const principal of PRINCIPALS) {
        expect([
          column,
          principal,
          mayRead({
            modelType: entry.modelType,
            column,
            permissions: [entry.ownPermission],
            principal,
          }),
        ]).toEqual([column, principal, true]);
      }

      for (const former of entry.formerPermissions) {
        expect([
          column,
          former,
          mayRead({
            modelType: entry.modelType,
            column,
            permissions: [former],
            principal: "apiKey",
          }),
        ]).toEqual([column, former, false]);
      }
    },
  );

  /*
   * A member holds Project User, which the team table and the team flags
   * are read with, so every member reads a team's flags as before. A key
   * holds no Project User: a key granted Read Team now reads them with the
   * team, where the flags used to ask for Edit Team.
   */
  test("every member reads a team's flags, as before", () => {
    for (const column of [
      "isPermissionsEditable",
      "isTeamDeleteable",
      "isTeamEditable",
      "shouldHaveAtLeastOneMember",
    ]) {
      expect(
        mayRead({
          modelType: Team,
          column,
          permissions: [],
          principal: "member",
        }),
      ).toBe(true);
      expect(
        mayRead({
          modelType: Team,
          column,
          permissions: [Permission.ReadProjectTeam],
          principal: "apiKey",
        }),
      ).toBe(true);
      expect(
        mayRead({
          modelType: Team,
          column,
          permissions: [Permission.EditProjectTeam],
          principal: "apiKey",
        }),
      ).toBe(false);
    }
  });

  /*
   * Every principal in a project holds Unauthorized SSO User, which a
   * project's own columns are read with, so the project's workflow run count
   * is read by everybody in the project as before - Read Workflow never
   * added anyone.
   */
  test("a project's workflow run count is read by everybody in the project, as before", () => {
    for (const principal of PRINCIPALS) {
      expect(
        mayRead({
          modelType: Project,
          column: "workflowRunsInLast30Days",
          permissions: [],
          principal,
        }),
      ).toBe(true);
      expect(whoMayRead(Project, "workflowRunsInLast30Days", principal)).toEqual(
        whoMayRead(Project, "name", principal),
      );
    }
  });
});

/*
 * The columns narrower than their record on purpose
 * (PermissionCatalogueCoverage, KNOWN_CROSS_FAMILY_READS): a secret is read
 * by who may edit the record, not by everybody who may read it.
 */
describe("secrets stay with who may edit their record", () => {
  test.each([
    "incomingEmailCustomLocalPart",
    "incomingEmailSecretKey",
    "incomingRequestSecretKey",
    "serverMonitorSecretKey",
  ])("Monitor.%s is read by the monitor's editors only", (column: string) => {
    for (const principal of PRINCIPALS) {
      expect(whoMayRead(Monitor, column, principal)).toEqual(
        [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.MonitorAdmin,
          Permission.MonitorMember,
        ].sort(),
      );
    }

    for (const reader of [
      Permission.Viewer,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ]) {
      expect([
        reader,
        mayRead({
          modelType: Monitor,
          column,
          permissions: [reader],
          principal: "apiKey",
        }),
      ]).toEqual([reader, false]);
    }

    // A granular editor reads it with the monitor's own read permission.
    expect(
      mayRead({
        modelType: Monitor,
        column,
        permissions: [
          Permission.ReadProjectMonitor,
          Permission.EditProjectMonitor,
        ],
        principal: "apiKey",
      }),
    ).toBe(true);
  });

  test.each(["incomingEmailSecretKey", "webhookSecretKey"])(
    "Workflow.%s is read by who may edit the workflow, not by its readers",
    (column: string) => {
      for (const editor of [Permission.ProjectOwner, Permission.ProjectAdmin]) {
        expect([
          editor,
          mayRead({
            modelType: Workflow,
            column,
            permissions: [editor],
            principal: "apiKey",
          }),
        ]).toEqual([editor, true]);
      }

      expect(
        mayRead({
          modelType: Workflow,
          column,
          permissions: [Permission.ReadWorkflow, Permission.EditWorkflow],
          principal: "apiKey",
        }),
      ).toBe(true);

      for (const reader of [
        Permission.Viewer,
        Permission.WorkflowViewer,
        Permission.ReadWorkflow,
      ]) {
        expect([
          reader,
          mayRead({
            modelType: Workflow,
            column,
            permissions: [reader],
            principal: "apiKey",
          }),
        ]).toEqual([reader, false]);
      }
    },
  );
});
