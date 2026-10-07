import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../../../../../Server/Types/Database/Permissions/BillingPermission";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../../../Models/DatabaseModels/Project";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import WorkflowVariable from "../../../../../Models/DatabaseModels/WorkflowVariable";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { ALWAYS_SELECTABLE_COLUMNS } from "../../../../../Types/HeldPermissions";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import {
  WORKFLOW_EDIT_PERMISSIONS,
  WORKFLOW_RUN_ONLY_PERMISSIONS,
  WORKFLOW_RUN_PERMISSIONS,
} from "../../../../../Types/Workflow/WorkflowRunPermissions";
import {
  PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL,
  PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS,
  ProjectNotificationChannelColumn,
} from "../../../../../Utils/Project/NotificationChannels";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The role decisions, as the server holds them: what a request with each
 * role is let through, asked of the checks every request goes through - the
 * table's lists (TablePermission) and then each written column's
 * (ColumnPermission) - never of the lists read back.
 *
 *   - A Billing Admin may turn a project's SMS, phone calls, WhatsApp and
 *     Telegram on and off - and change nothing else about the project.
 *   - A Workflow Admin may create, change, run and delete workflows, and the
 *     variables they use.
 *   - A Workflow Member may open workflows and run them, and change none:
 *     no create, no edit, no delete, no variables.
 *
 * Every member of a project also holds Project User (AccessTokenService adds
 * it), so each caller here holds it too: it must not widen anything.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

type ModelType = { new (): DatabaseBaseModel };

function rowsFor(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): Array<UserPermission> {
  return [
    ...[...permissions, Permission.ProjectUser].map(
      (permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      },
    ),
    ...blocked.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: true,
      };
    }),
  ];
}

function propsFor(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: rowsFor(permissions, blocked),
  };

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

/*
 * Whether the table lets the caller do the operation at all: an allow row
 * for one of its permissions, then no team block with no labels on them -
 * the two table steps of every request.
 */
function tableAllows(
  modelType: ModelType,
  permissions: Array<Permission>,
  type: DatabaseRequestType,
  blocked: Array<Permission> = [],
): boolean {
  const props: DatabaseCommonInteractionProps = propsFor(permissions, blocked);

  try {
    TablePermission.checkTableLevelPermissions(modelType, props, type);
    TablePermission.checkTableLevelBlockPermissions(modelType, props, type);

    return true;
  } catch {
    return false;
  }
}

// Whether a create or update writing `data` passes both checks.
function mayWrite(
  modelType: ModelType,
  permissions: Array<Permission>,
  type: DatabaseRequestType,
  data: Record<string, unknown>,
): boolean {
  if (!tableAllows(modelType, permissions, type)) {
    return false;
  }

  const model: DatabaseBaseModel = new modelType();

  for (const [key, value] of Object.entries(data)) {
    (model as unknown as Record<string, unknown>)[key] = value;
  }

  try {
    ColumnPermissions.checkDataColumnPermissions(
      modelType,
      model,
      propsFor(permissions),
      type,
    );

    return true;
  } catch {
    return false;
  }
}

/*
 * The columns the caller may read, create or update, sorted - leaving out
 * the ones every record has (_id, createdAt, ...), which no write sets and
 * the server never checks.
 */
function columnsFor(
  modelType: ModelType,
  permissions: Array<Permission>,
  type: DatabaseRequestType,
): Array<string> {
  return ColumnPermissions.getModelColumnsByPermissions(
    modelType,
    rowsFor(permissions),
    type,
  )
    .columns.filter((column: string): boolean => {
      return !ALWAYS_SELECTABLE_COLUMNS.includes(column);
    })
    .sort();
}

const CHANNEL_COLUMNS: Array<ProjectNotificationChannelColumn> = Object.values(
  PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL,
);

beforeEach(() => {
  // What is asked here is who, not which plan.
  jest
    .spyOn(BillingPermissions, "checkBillingPermissions")
    .mockImplementation((): void => {
      return undefined;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a Billing Admin turns a project's paid channels on and off", () => {
  const MAY: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.BillingAdmin,
    Permission.ManageProjectBilling,
  ];

  const MAY_NOT: Array<Permission> = [
    Permission.ProjectAdmin,
    Permission.EditProject,
    Permission.ProjectMember,
    Permission.BillingMember,
    Permission.BillingViewer,
    Permission.Viewer,
    Permission.ReadProject,
  ];

  test("the people the product names are exactly these", () => {
    expect([...PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS]).toEqual(MAY);
  });

  for (const column of CHANNEL_COLUMNS) {
    test.each(MAY)(`%s may switch ${column} on and off`, (permission) => {
      for (const value of [true, false]) {
        expect(
          mayWrite(Project, [permission], DatabaseRequestType.Update, {
            [column]: value,
          }),
        ).toBe(true);
      }
    });

    test.each(MAY_NOT)(`%s may not switch ${column}`, (permission) => {
      expect(
        mayWrite(Project, [permission], DatabaseRequestType.Update, {
          [column]: true,
        }),
      ).toBe(false);
    });
  }

  test("a Billing Admin may change those four columns and nothing else about a project", () => {
    expect(
      columnsFor(Project, [Permission.BillingAdmin], DatabaseRequestType.Update),
    ).toEqual([...CHANNEL_COLUMNS].sort());
  });

  test("so a Billing Admin may not rename a project, or change its billing details", () => {
    for (const data of [
      { name: "Renamed" },
      { financeAccountingEmail: "finance@example.com" },
      { enableAutoRechargeSmsOrCallBalance: true },
      { enableAi: true },
    ]) {
      expect([
        data,
        mayWrite(Project, [Permission.BillingAdmin], DatabaseRequestType.Update, data),
      ]).toEqual([data, false]);
    }
  });

  test("a save that switches a channel and renames the project is refused whole", () => {
    expect(
      mayWrite(Project, [Permission.BillingAdmin], DatabaseRequestType.Update, {
        enableSmsNotifications: true,
        name: "Renamed",
      }),
    ).toBe(false);
  });

  test("a Billing Admin sees the switches they may flip, as every member does", () => {
    const readable: Array<string> = columnsFor(
      Project,
      [Permission.BillingAdmin],
      DatabaseRequestType.Read,
    );

    for (const column of CHANNEL_COLUMNS) {
      expect(readable).toContain(column);
    }
  });

  test("a Billing Admin may not create or delete a project", () => {
    expect(
      tableAllows(Project, [Permission.BillingAdmin], DatabaseRequestType.Delete),
    ).toBe(false);
  });

  test("a team's block on Billing Admin, with no labels, takes it away", () => {
    expect(
      tableAllows(
        Project,
        [Permission.BillingAdmin],
        DatabaseRequestType.Update,
        [Permission.BillingAdmin],
      ),
    ).toBe(false);
  });

  test("Billing Member and Billing Viewer gain nothing on a project", () => {
    for (const permission of [
      Permission.BillingMember,
      Permission.BillingViewer,
    ]) {
      expect(
        columnsFor(Project, [permission], DatabaseRequestType.Update),
      ).toEqual([]);
    }
  });
});

describe("a Workflow Admin builds workflows; a Workflow Member runs them", () => {
  test.each([
    DatabaseRequestType.Create,
    DatabaseRequestType.Read,
    DatabaseRequestType.Update,
    DatabaseRequestType.Delete,
  ])("a Workflow Admin may %s a workflow", (type: DatabaseRequestType) => {
    expect(tableAllows(Workflow, [Permission.WorkflowAdmin], type)).toBe(true);
  });

  test("a Workflow Member may open workflows", () => {
    expect(
      tableAllows(Workflow, [Permission.WorkflowMember], DatabaseRequestType.Read),
    ).toBe(true);
  });

  test.each([
    DatabaseRequestType.Create,
    DatabaseRequestType.Update,
    DatabaseRequestType.Delete,
  ])("a Workflow Member may not %s a workflow", (type: DatabaseRequestType) => {
    expect(tableAllows(Workflow, [Permission.WorkflowMember], type)).toBe(
      false,
    );
  });

  test("a Workflow Member creates and changes no column of a workflow", () => {
    expect(
      columnsFor(Workflow, [Permission.WorkflowMember], DatabaseRequestType.Create),
    ).toEqual([]);
    expect(
      columnsFor(Workflow, [Permission.WorkflowMember], DatabaseRequestType.Update),
    ).toEqual([]);
  });

  test("a Workflow Member reads what the Builder shows, but not the trigger keys", () => {
    const readable: Array<string> = columnsFor(
      Workflow,
      [Permission.WorkflowMember],
      DatabaseRequestType.Read,
    );

    for (const column of ["name", "graph", "isEnabled", "isArchived"]) {
      expect(readable).toContain(column);
    }

    expect(readable).not.toContain("webhookSecretKey");
    expect(readable).not.toContain("incomingEmailSecretKey");
  });

  test("a Workflow Admin may write every column Edit Workflow may, and create every column Create Workflow may", () => {
    expect(
      columnsFor(Workflow, [Permission.WorkflowAdmin], DatabaseRequestType.Update),
    ).toEqual(
      columnsFor(Workflow, [Permission.EditWorkflow], DatabaseRequestType.Update),
    );
    expect(
      columnsFor(Workflow, [Permission.WorkflowAdmin], DatabaseRequestType.Create),
    ).toEqual(
      columnsFor(Workflow, [Permission.CreateWorkflow], DatabaseRequestType.Create),
    );
  });

  test("saving the Builder - its graph, name and Enabled switch - is a Workflow Admin's and not a Workflow Member's", () => {
    const save: Record<string, unknown> = {
      name: "Page the on-call",
      graph: { nodes: [], edges: [] },
      isEnabled: true,
    };

    expect(
      mayWrite(Workflow, [Permission.WorkflowAdmin], DatabaseRequestType.Update, save),
    ).toBe(true);
    expect(
      mayWrite(
        Workflow,
        [Permission.WorkflowMember],
        DatabaseRequestType.Update,
        save,
      ),
    ).toBe(false);
  });

  test("a Workflow Admin may see and reset the trigger keys; a Workflow Member may do neither", () => {
    for (const column of ["webhookSecretKey", "incomingEmailSecretKey"]) {
      expect(
        columnsFor(Workflow, [Permission.WorkflowAdmin], DatabaseRequestType.Read),
      ).toContain(column);
      expect(
        columnsFor(Workflow, [Permission.WorkflowAdmin], DatabaseRequestType.Update),
      ).toContain(column);
      expect(
        columnsFor(
          Workflow,
          [Permission.WorkflowMember],
          DatabaseRequestType.Update,
        ),
      ).not.toContain(column);
    }
  });

  test("Project Member still creates and deletes workflows, and still may not change one", () => {
    expect(
      tableAllows(Workflow, [Permission.ProjectMember], DatabaseRequestType.Create),
    ).toBe(true);
    expect(
      tableAllows(Workflow, [Permission.ProjectMember], DatabaseRequestType.Delete),
    ).toBe(true);
    expect(
      tableAllows(Workflow, [Permission.ProjectMember], DatabaseRequestType.Update),
    ).toBe(false);
  });

  test("who may run: the workflow's editors and the Workflow Member - the table's editors are the run list's", () => {
    expect([...WORKFLOW_EDIT_PERMISSIONS]).toEqual(
      new Workflow().getUpdatePermissions(),
    );
    expect([...WORKFLOW_RUN_PERMISSIONS].sort()).toEqual(
      [...WORKFLOW_EDIT_PERMISSIONS, ...WORKFLOW_RUN_ONLY_PERMISSIONS].sort(),
    );

    for (const permission of WORKFLOW_EDIT_PERMISSIONS) {
      expect(tableAllows(Workflow, [permission], DatabaseRequestType.Update)).toBe(
        true,
      );
    }

    // Who may run without editing may still open the workflow they run.
    for (const permission of WORKFLOW_RUN_ONLY_PERMISSIONS) {
      expect(tableAllows(Workflow, [permission], DatabaseRequestType.Read)).toBe(
        true,
      );
      expect(tableAllows(Workflow, [permission], DatabaseRequestType.Update)).toBe(
        false,
      );
    }
  });
});

describe("workflow variables go with building workflows", () => {
  test.each([
    DatabaseRequestType.Create,
    DatabaseRequestType.Read,
    DatabaseRequestType.Update,
    DatabaseRequestType.Delete,
  ])("a Workflow Admin may %s a variable", (type: DatabaseRequestType) => {
    expect(tableAllows(WorkflowVariable, [Permission.WorkflowAdmin], type)).toBe(
      true,
    );
  });

  test("a Workflow Admin may write every column Create and Edit Workflow Variable may", () => {
    expect(
      columnsFor(
        WorkflowVariable,
        [Permission.WorkflowAdmin],
        DatabaseRequestType.Create,
      ),
    ).toEqual(
      columnsFor(
        WorkflowVariable,
        [Permission.CreateWorkflowVariable],
        DatabaseRequestType.Create,
      ),
    );
    expect(
      columnsFor(
        WorkflowVariable,
        [Permission.WorkflowAdmin],
        DatabaseRequestType.Update,
      ),
    ).toEqual(
      columnsFor(
        WorkflowVariable,
        [Permission.EditWorkflowVariable],
        DatabaseRequestType.Update,
      ),
    );
  });

  /*
   * The table let a Project Member create a variable, but every column
   * named only owners, admins and Create Workflow Variable, so the column
   * check refused what the table allowed - the template wizard's variables
   * among them.
   */
  test("a Project Member may create a variable with every column a variable is created with", () => {
    expect(
      tableAllows(
        WorkflowVariable,
        [Permission.ProjectMember],
        DatabaseRequestType.Create,
      ),
    ).toBe(true);
    expect(
      columnsFor(
        WorkflowVariable,
        [Permission.ProjectMember],
        DatabaseRequestType.Create,
      ),
    ).toEqual(
      columnsFor(
        WorkflowVariable,
        [Permission.CreateWorkflowVariable],
        DatabaseRequestType.Create,
      ),
    );
    expect(
      mayWrite(
        WorkflowVariable,
        [Permission.ProjectMember],
        DatabaseRequestType.Create,
        {
          name: "SLACK_WEBHOOK",
          description: "Where alerts go",
          content: "https://hooks.example.com/abc",
          isSecret: true,
        },
      ),
    ).toBe(true);
  });

  test("a Project Member still may not change a variable", () => {
    expect(
      tableAllows(
        WorkflowVariable,
        [Permission.ProjectMember],
        DatabaseRequestType.Update,
      ),
    ).toBe(false);
  });

  test.each([
    DatabaseRequestType.Create,
    DatabaseRequestType.Update,
    DatabaseRequestType.Delete,
  ])("a Workflow Member may not %s a variable", (type: DatabaseRequestType) => {
    expect(
      tableAllows(WorkflowVariable, [Permission.WorkflowMember], type),
    ).toBe(false);
  });

  test("a Workflow Member creates no column of a variable", () => {
    expect(
      columnsFor(
        WorkflowVariable,
        [Permission.WorkflowMember],
        DatabaseRequestType.Create,
      ),
    ).toEqual([]);
  });
});
