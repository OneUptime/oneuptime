import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import ApiKey from "../../../../../Models/DatabaseModels/ApiKey";
import ApiKeyCustomRole from "../../../../../Models/DatabaseModels/ApiKeyCustomRole";
import ApiKeyPermission from "../../../../../Models/DatabaseModels/ApiKeyPermission";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomRole from "../../../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../../../Models/DatabaseModels/CustomRolePermission";
import Label from "../../../../../Models/DatabaseModels/Label";
import ProjectSCIM from "../../../../../Models/DatabaseModels/ProjectSCIM";
import ProjectSso from "../../../../../Models/DatabaseModels/ProjectSso";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamCustomRole from "../../../../../Models/DatabaseModels/TeamCustomRole";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../../../Models/DatabaseModels/TeamPermission";
import AccessTokenService from "../../../../../Server/Services/AccessTokenService";
import ApiKeyPermissionService from "../../../../../Server/Services/ApiKeyPermissionService";
import CustomRolePermissionService from "../../../../../Server/Services/CustomRolePermissionService";
import CustomRoleService from "../../../../../Server/Services/CustomRoleService";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import TeamCustomRoleService from "../../../../../Server/Services/TeamCustomRoleService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../../../Server/Services/TeamPermissionService";
import TeamService from "../../../../../Server/Services/TeamService";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import WorkflowAccessChangeRefusedException from "../../../../../Server/Types/Database/Permissions/WorkflowAccessChangeRefusedException";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import DeleteOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/DeleteOneBaseModel";
import FindManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindManyBaseModel";
import FindOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindOneBaseModel";
import { describeRefusal } from "../../../../../Server/Types/Workflow/Components/BaseModel/LogComponentError";
import UpdateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateOneBaseModel";
import RuntimeComponents from "../../../../../Server/Types/Workflow/Components/Index";
import ProjectReferenceCheck from "../../../../../Server/Utils/Database/ProjectReferenceCheck";
import WorkflowPrincipal from "../../../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Exception from "../../../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import Text from "../../../../../Types/Text";
import UserType from "../../../../../Types/UserType";
import {
  DatabaseOperation,
  WRITE_DATABASE_OPERATIONS,
  getDatabaseOperation,
} from "../../../../../Types/Workflow/DatabaseOperation";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../../Enterprise/TestBillingFlag",
    ) as typeof import("../../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * A WORKFLOW'S STEP CHANGES NOBODY'S ACCESS.
 *
 * A step acts as a Project Admin of its project (WorkflowPrincipal), and a
 * Project Admin may give a team Project Admin, or put someone on the Admin
 * team. But a Project Admin is not who builds every workflow: Project
 * Member is on the Workflow create list, as are Workflow Admin and Create
 * Workflow, and Edit Workflow changes a workflow's steps. So a member who
 * may not touch the project's teams could build a workflow whose "Create
 * One Team Permission" step gives the Members team - their own - Project
 * Admin, or whose "Create One Team Member" step puts them on the Admin team,
 * accepted at once since they are in the project already; once it ran, they
 * were a Project Admin.
 *
 * A step is not lent that: it creates, changes and deletes no team, team
 * member, team permission, custom role, role permission, team role or API
 * key permission (WorkflowPrincipal.ACCESS_TABLES), whoever built the
 * workflow and whatever it sends. It is refused before anything else is
 * asked or any hook runs, takes its Error output, and its run log says so
 * in plain words. Its triggers and Find steps still read these records; a
 * person, an API key and OneUptime itself are held as before.
 *
 * The two ways in run first, over the real TeamPermissionService and
 * TeamMemberService with the project's three teams held in memory: on code
 * without the rule, the Members team is given Project Admin and the member
 * sits on the Admin team, accepted - both writes reach the tables. Then
 * every step that writes these records, as the Builder offers it; then what
 * still works; then the rule itself, the list it reads, and the run log.
 */

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000001",
);
// The project member who builds the workflow, and the project's owner.
const MEMBER_USER_ID: string = "7d000000-0000-4000-8000-0000000000a1";
const OWNER_USER_ID: string = "7d000000-0000-4000-8000-0000000000a2";
// The three teams every project starts with (ProjectService).
const OWNERS_TEAM_ID: string = "7d000000-0000-4000-8000-0000000000b1";
const ADMIN_TEAM_ID: string = "7d000000-0000-4000-8000-0000000000b2";
const MEMBERS_TEAM_ID: string = "7d000000-0000-4000-8000-0000000000b3";
// Their permissions, and a block the Members team carries.
const OWNERS_PERMISSION_ID: string = "7d000000-0000-4000-8000-0000000000c1";
const ADMIN_PERMISSION_ID: string = "7d000000-0000-4000-8000-0000000000c2";
const MEMBERS_PERMISSION_ID: string = "7d000000-0000-4000-8000-0000000000c3";
const MEMBERS_BLOCK_ID: string = "7d000000-0000-4000-8000-0000000000c4";
// Who is on which team.
const OWNER_MEMBERSHIP_ID: string = "7d000000-0000-4000-8000-0000000000d1";
const MEMBER_MEMBERSHIP_ID: string = "7d000000-0000-4000-8000-0000000000d2";
// Any other record a step might name.
const RECORD_ID: string = "7d000000-0000-4000-8000-0000000000e1";

const REFUSAL_START: string =
  "Workflow steps don't change who has access to this project";
const ADMIN_CEILING: string =
  "Workflow steps can do only what a Project Admin of this project can do";

interface StepRun {
  result: RunReturnType;
  lines: Array<string>;
}

type SpyInstance = ReturnType<typeof getJestSpyOn>;

const savedPlanEnvironment: Record<string, string | undefined> = {};

function options(lines: Array<string>): RunOptions {
  return {
    log: ((line: unknown): void => {
      lines.push(typeof line === "string" ? line : JSON.stringify(line));
    }) as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    workflowName: "Member's automation",
    projectId: PROJECT_ID,
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };
}

async function run(
  component: ComponentCode,
  args: JSONObject,
): Promise<StepRun> {
  const lines: Array<string> = [];
  const result: RunReturnType = await component.run(args, options(lines));
  return { result, lines };
}

// The run log's line for a step refused for changing access, checked whole.
function expectAccessRefusal(
  step: ComponentCode,
  stepRun: StepRun,
  verb: "create" | "change" | "delete",
  records: string,
): void {
  const expected: string = `"${step.getMetadata().title}" was refused. ${REFUSAL_START}, so they can't ${verb} ${records}. A person who manages the project's teams and API keys has to make this change.`;

  expect(stepRun.result.executePort?.id).toBe("error");
  expect(stepRun.lines).toContain(expected);
  // The Steps view shows the same reason under the Error output.
  expect(stepRun.result.executePortReason).toBe(expected);
  // Said as it is: a Project Admin may make this change, a step may not.
  expect(stepRun.result.executePortReason).not.toContain(ADMIN_CEILING);
}

// A person of the project holding `permissions`, as the API hands them on.
function person(
  permissions: Array<Permission>,
  userType: UserType = UserType.User,
): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = {
    tenantId: PROJECT_ID,
    userType: userType,
    ...ON_HIGHEST_PLAN,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          } as UserPermission;
        }),
      },
    },
  };

  if (userType === UserType.User) {
    props.userId = new ObjectID(MEMBER_USER_ID);
  }

  return props;
}

// What a workflow's step acts with, on the highest plan.
function stepProps(): DatabaseCommonInteractionProps {
  return {
    ...WorkflowPrincipal.getPropsWithoutPlan({
      projectId: PROJECT_ID,
      workflowId: ObjectID.generate(),
      workflowName: "Member's automation",
    }),
    ...ON_HIGHEST_PLAN,
  };
}

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);
});

afterAll(() => {
  for (const key of Object.keys(PLAN_ENVIRONMENT)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(savedPlanEnvironment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});

let currentPlanSpy: SpyInstance;

beforeEach(() => {
  // As on OneUptime Cloud, on a plan that sells team management.
  setTestBillingEnabled(true);

  currentPlanSpy = getJestSpyOn(ProjectService, "getCurrentPlan");
  currentPlanSpy.mockImplementation((async () => {
    return { plan: PlanType.Enterprise, isSubscriptionUnpaid: false };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

/*
 * The project's teams as ProjectService creates them, with a block on the
 * Members team, the owner on the Owners team and the member on Members -
 * held in memory behind the real services.
 */
interface Project {
  teams: InMemoryTable;
  permissions: InMemoryTable;
  members: InMemoryTable;
  // Every token refresh a membership change asked for.
  refreshed: SpyInstance;
}

function project(): Project {
  const teams: InMemoryTable = useInMemoryTable(TeamService, [
    {
      _id: OWNERS_TEAM_ID,
      projectId: PROJECT_ID.toString(),
      name: "Owners",
      isPermissionsEditable: false,
      isTeamEditable: false,
      isTeamDeleteable: false,
      shouldHaveAtLeastOneMember: true,
    },
    {
      _id: ADMIN_TEAM_ID,
      projectId: PROJECT_ID.toString(),
      name: "Admin",
      isPermissionsEditable: false,
      isTeamEditable: false,
      isTeamDeleteable: false,
    },
    {
      _id: MEMBERS_TEAM_ID,
      projectId: PROJECT_ID.toString(),
      name: "Members",
      isPermissionsEditable: true,
      isTeamEditable: true,
      isTeamDeleteable: true,
    },
  ]);

  const permissions: InMemoryTable = useInMemoryTable(TeamPermissionService, [
    {
      _id: OWNERS_PERMISSION_ID,
      projectId: PROJECT_ID.toString(),
      teamId: OWNERS_TEAM_ID,
      permission: Permission.ProjectOwner,
      scope: PermissionScope.All,
      isBlockPermission: false,
    },
    {
      _id: ADMIN_PERMISSION_ID,
      projectId: PROJECT_ID.toString(),
      teamId: ADMIN_TEAM_ID,
      permission: Permission.ProjectAdmin,
      scope: PermissionScope.All,
      isBlockPermission: false,
    },
    {
      _id: MEMBERS_PERMISSION_ID,
      projectId: PROJECT_ID.toString(),
      teamId: MEMBERS_TEAM_ID,
      permission: Permission.ProjectMember,
      scope: PermissionScope.All,
      isBlockPermission: false,
    },
    {
      _id: MEMBERS_BLOCK_ID,
      projectId: PROJECT_ID.toString(),
      teamId: MEMBERS_TEAM_ID,
      permission: Permission.DeleteProjectMonitor,
      scope: PermissionScope.All,
      isBlockPermission: true,
    },
  ]);

  const members: InMemoryTable = useInMemoryTable(TeamMemberService, [
    {
      _id: OWNER_MEMBERSHIP_ID,
      projectId: PROJECT_ID.toString(),
      teamId: OWNERS_TEAM_ID,
      userId: OWNER_USER_ID,
      hasAcceptedInvitation: true,
    },
    {
      _id: MEMBER_MEMBERSHIP_ID,
      projectId: PROJECT_ID.toString(),
      teamId: MEMBERS_TEAM_ID,
      userId: MEMBER_USER_ID,
      hasAcceptedInvitation: true,
    },
  ]);

  /*
   * The cross-project reference check (that what a row names is this
   * project's) is a defence of its own, with its own tests; the rows here
   * are all this project's.
   */
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );

  // What a membership change refreshes, and the seats it counts.
  const refreshed: SpyInstance = getJestSpyOn(
    AccessTokenService,
    "refreshUserTenantAccessPermission",
  ).mockResolvedValue(null as never);
  getJestSpyOn(
    AccessTokenService,
    "refreshUserGlobalAccessPermission",
  ).mockResolvedValue(null as never);
  getJestSpyOn(
    TeamMemberService,
    "syncSubscriptionSeatsAfterMembershipChange" as never,
  ).mockResolvedValue(undefined as never);
  getJestSpyOn(
    TeamMemberService,
    "addDefaultNotificationSettingsAndRules" as never,
  ).mockResolvedValue(undefined as never);
  getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(null as never);

  return { teams, permissions, members, refreshed };
}

// The permission rows a team holds now.
function heldBy(table: InMemoryTable, teamId: string): Array<string> {
  return table.rows
    .filter((row: StoredRow) => {
      return String(row["teamId"]).toLowerCase() === teamId.toLowerCase();
    })
    .map((row: StoredRow) => {
      return `${row["isBlockPermission"] ? "block " : ""}${String(row["permission"])}`;
    })
    .sort();
}

// The teams a person is on now.
function teamsOf(table: InMemoryTable, userId: string): Array<string> {
  return table.rows
    .filter((row: StoredRow) => {
      return String(row["userId"]).toLowerCase() === userId.toLowerCase();
    })
    .map((row: StoredRow) => {
      return `${String(row["teamId"]).toLowerCase()}${row["hasAcceptedInvitation"] ? " accepted" : ""}`;
    })
    .sort();
}

describe("a project member's workflow cannot make anyone a Project Admin", () => {
  test('"Create One Team Permission" giving the Members team Project Admin is refused, and the team keeps what it had', async () => {
    const world: Project = project();
    const component: CreateOneBaseModel<TeamPermission> =
      new CreateOneBaseModel<TeamPermission>(TeamPermissionService);

    const step: StepRun = await run(component, {
      json: {
        teamId: MEMBERS_TEAM_ID,
        permission: Permission.ProjectAdmin,
        scope: PermissionScope.All,
      },
    });

    expectAccessRefusal(component, step, "create", "Team Permissions");

    expect(world.permissions.inserts).toEqual([]);
    expect(heldBy(world.permissions, MEMBERS_TEAM_ID)).toEqual([
      "ProjectMember",
      "block DeleteProjectMonitor",
    ]);
  });

  test('"Create One Team Member" putting the member on the Admin team is refused, and they stay on Members only', async () => {
    const world: Project = project();
    const component: CreateOneBaseModel<TeamMember> =
      new CreateOneBaseModel<TeamMember>(TeamMemberService);

    const step: StepRun = await run(component, {
      json: {
        teamId: ADMIN_TEAM_ID,
        userId: MEMBER_USER_ID,
      },
    });

    expectAccessRefusal(component, step, "create", "Team Members");

    expect(world.members.inserts).toEqual([]);
    expect(teamsOf(world.members, MEMBER_USER_ID)).toEqual([
      `${MEMBERS_TEAM_ID} accepted`,
    ]);
    // Refused before any hook: nobody's permissions were refreshed.
    expect(world.refreshed).not.toHaveBeenCalled();
  });

  test('"Create One Team Member" naming the team and the person by relation is refused the same way', async () => {
    const world: Project = project();
    const component: CreateOneBaseModel<TeamMember> =
      new CreateOneBaseModel<TeamMember>(TeamMemberService);

    const step: StepRun = await run(component, {
      json: {
        team: { _id: ADMIN_TEAM_ID },
        user: { _id: MEMBER_USER_ID },
        hasAcceptedInvitation: true,
      },
    });

    expectAccessRefusal(component, step, "create", "Team Members");
    expect(world.members.inserts).toEqual([]);
  });

  test('"Update One Team Permission" turning the Members team\'s role into Project Admin is refused, and the row is unchanged', async () => {
    const world: Project = project();
    const component: UpdateOneBaseModel<TeamPermission> =
      new UpdateOneBaseModel<TeamPermission>(TeamPermissionService);

    const step: StepRun = await run(component, {
      query: { _id: MEMBERS_PERMISSION_ID },
      data: { permission: Permission.ProjectAdmin },
    });

    expectAccessRefusal(component, step, "change", "Team Permissions");

    expect(world.permissions.updates).toEqual([]);
    expect(world.permissions.get(MEMBERS_PERMISSION_ID)?.["permission"]).toBe(
      Permission.ProjectMember,
    );
  });

  test('"Delete One Team Permission" lifting the block on the Members team is refused, and the block stays', async () => {
    const world: Project = project();
    const component: DeleteOneBaseModel<TeamPermission> =
      new DeleteOneBaseModel<TeamPermission>(TeamPermissionService);

    const step: StepRun = await run(component, {
      query: { _id: MEMBERS_BLOCK_ID },
    });

    expectAccessRefusal(component, step, "delete", "Team Permissions");

    expect(world.permissions.deletes).toEqual([]);
    expect(heldBy(world.permissions, MEMBERS_TEAM_ID)).toContain(
      "block DeleteProjectMonitor",
    );
  });

  test('"Delete One Team Member" taking the owner off the Owners team is refused, and the owner stays', async () => {
    const world: Project = project();
    const component: DeleteOneBaseModel<TeamMember> =
      new DeleteOneBaseModel<TeamMember>(TeamMemberService);

    const step: StepRun = await run(component, {
      query: { _id: OWNER_MEMBERSHIP_ID },
    });

    expectAccessRefusal(component, step, "delete", "Team Members");

    expect(world.members.deletes).toEqual([]);
    expect(teamsOf(world.members, OWNER_USER_ID)).toEqual([
      `${OWNERS_TEAM_ID} accepted`,
    ]);
  });

  test("a custom role holding Project Admin is refused at every step that would give it to the Members team", async () => {
    const createRole: CreateOneBaseModel<CustomRole> =
      new CreateOneBaseModel<CustomRole>(CustomRoleService);
    const addPermission: CreateOneBaseModel<CustomRolePermission> =
      new CreateOneBaseModel<CustomRolePermission>(CustomRolePermissionService);
    const giveToTeam: CreateOneBaseModel<TeamCustomRole> =
      new CreateOneBaseModel<TeamCustomRole>(TeamCustomRoleService);

    expectAccessRefusal(
      createRole,
      await run(createRole, { json: { name: "Almost an admin" } }),
      "create",
      "Custom Roles",
    );
    expectAccessRefusal(
      addPermission,
      await run(addPermission, {
        json: {
          customRoleId: RECORD_ID,
          permission: Permission.ProjectAdmin,
        },
      }),
      "create",
      "Custom Role Permissions",
    );
    expectAccessRefusal(
      giveToTeam,
      await run(giveToTeam, {
        json: { customRoleId: RECORD_ID, teamId: MEMBERS_TEAM_ID },
      }),
      "create",
      "Team Custom Roles",
    );
  });

  test('"Update One API Key Permission" raising an API key to Project Admin is refused', async () => {
    const component: UpdateOneBaseModel<ApiKeyPermission> =
      new UpdateOneBaseModel<ApiKeyPermission>(ApiKeyPermissionService);

    expectAccessRefusal(
      component,
      await run(component, {
        query: { _id: RECORD_ID },
        data: { permission: Permission.ProjectAdmin },
      }),
      "change",
      "API Key Permissions",
    );
  });
});

/*
 * Every write step the Builder offers for a record that decides access:
 * Create, Update and Delete, One and Many, of each such workflow-enabled
 * model - the components a workflow runs, as the server registers them. A
 * refused step reaches neither the table nor a hook.
 */
interface WriteStep {
  componentId: string;
  modelName: string;
  operation: DatabaseOperation;
  component: ComponentCode;
}

function accessWriteSteps(): Array<WriteStep> {
  const steps: Array<WriteStep> = [];

  for (const modelType of AllModelTypes as Array<{ new (): BaseModel }>) {
    const model: BaseModel = new modelType();

    if (
      !model.enableWorkflowOn ||
      !WorkflowPrincipal.isAccessTable(modelType)
    ) {
      continue;
    }

    for (const [componentId, component] of Object.entries(RuntimeComponents)) {
      const operation: DatabaseOperation | null = getDatabaseOperation({
        componentId: componentId,
        tableName: model.tableName!,
      });

      if (operation && WRITE_DATABASE_OPERATIONS.includes(operation)) {
        steps.push({
          componentId,
          modelName: model.tableName!,
          operation,
          component,
        });
      }
    }
  }

  return steps.sort((a: WriteStep, b: WriteStep): number => {
    return a.componentId.localeCompare(b.componentId);
  });
}

const ACCESS_WRITE_STEPS: Array<WriteStep> = accessWriteSteps();

// What each kind of write step is handed: enough to reach the service.
function argumentsFor(operation: DatabaseOperation): JSONObject {
  switch (operation) {
    case DatabaseOperation.CreateOne:
      return { json: { name: "Responders" } };
    case DatabaseOperation.CreateMany:
      return { "json-array": [{ name: "Responders" }] };
    case DatabaseOperation.UpdateOne:
      return { query: { _id: RECORD_ID }, data: { name: "Responders" } };
    case DatabaseOperation.UpdateMany:
      return { query: { _id: RECORD_ID }, data: { name: "Responders" } };
    case DatabaseOperation.DeleteOne:
      return { query: { _id: RECORD_ID } };
    case DatabaseOperation.DeleteMany:
      return { query: { _id: RECORD_ID } };
    default:
      throw new Error(`Not a write step: ${operation}`);
  }
}

function verbFor(operation: DatabaseOperation): "create" | "change" | "delete" {
  if (
    operation === DatabaseOperation.CreateOne ||
    operation === DatabaseOperation.CreateMany
  ) {
    return "create";
  }

  if (
    operation === DatabaseOperation.DeleteOne ||
    operation === DatabaseOperation.DeleteMany
  ) {
    return "delete";
  }

  return "change";
}

describe("every step that would write a record deciding access", () => {
  test("is offered for each workflow-enabled access record: Create, Update and Delete, One and Many", () => {
    const byModel: Record<string, Array<string>> = {};

    for (const step of ACCESS_WRITE_STEPS) {
      (byModel[step.modelName] ||= []).push(step.operation);
    }

    for (const operations of Object.values(byModel)) {
      operations.sort();
    }

    const all: Array<string> = [...WRITE_DATABASE_OPERATIONS].sort();

    expect(byModel).toEqual({
      ApiKeyCustomRole: all,
      ApiKeyPermission: all,
      CustomRole: all,
      CustomRolePermission: all,
      Team: all,
      TeamCustomRole: all,
      TeamMember: all,
      TeamPermission: all,
    });
  });

  test.each(
    ACCESS_WRITE_STEPS.map((step: WriteStep) => {
      return [step.componentId, step] as [string, WriteStep];
    }),
  )(
    "%s is refused before its table or any hook is reached",
    async (_componentId: string, step: WriteStep) => {
      const service: DatabaseService<BaseModel> = (
        step.component as unknown as {
          modelService: DatabaseService<BaseModel>;
        }
      ).modelService;

      expect(service).toBeInstanceOf(DatabaseService);

      // Nothing past the refusal may run: not the table, not a hook.
      const repository: SpyInstance = getJestSpyOn(
        service,
        "getRepository",
      ).mockImplementation((() => {
        throw new Error("The table was reached.");
      }) as never);
      const hooks: Array<SpyInstance> = [
        "onBeforeCreate",
        "onBeforeUpdate",
        "onBeforeDelete",
      ].map((hook: string): SpyInstance => {
        return getJestSpyOn(service, hook as never);
      });

      const result: StepRun = await run(
        step.component,
        argumentsFor(step.operation),
      );

      expectAccessRefusal(
        step.component,
        result,
        verbFor(step.operation),
        new (service.modelType as { new (): BaseModel })().pluralName!,
      );

      expect(repository).not.toHaveBeenCalled();

      for (const hook of hooks) {
        expect(hook).not.toHaveBeenCalled();
      }
    },
  );
});

describe("what a step still does with these records", () => {
  function answering<TBaseModel extends BaseModel>(
    service: DatabaseService<TBaseModel>,
    rows: Array<StoredRow>,
  ): InMemoryTable {
    return useInMemoryTable(service, rows);
  }

  test('"Find Many Team Members" reads who is on a team', async () => {
    answering(TeamMemberService, [
      {
        _id: MEMBER_MEMBERSHIP_ID,
        projectId: PROJECT_ID.toString(),
        teamId: MEMBERS_TEAM_ID,
        userId: MEMBER_USER_ID,
        hasAcceptedInvitation: true,
      },
    ]);

    const step: StepRun = await run(
      new FindManyBaseModel<TeamMember>(TeamMemberService),
      {
        query: { teamId: MEMBERS_TEAM_ID },
        select: { _id: true, userId: true, hasAcceptedInvitation: true },
      },
    );

    expect(step.result.executePort?.id).toBe("success");
    expect(JSON.stringify(step.result.returnValues)).toContain(MEMBER_USER_ID);
  });

  test('"Find One Team Permission" reads what a team holds', async () => {
    answering(TeamPermissionService, [
      {
        _id: MEMBERS_PERMISSION_ID,
        projectId: PROJECT_ID.toString(),
        teamId: MEMBERS_TEAM_ID,
        permission: Permission.ProjectMember,
        isBlockPermission: false,
      },
    ]);

    const step: StepRun = await run(
      new FindOneBaseModel<TeamPermission>(TeamPermissionService),
      {
        query: { _id: MEMBERS_PERMISSION_ID },
        select: { _id: true, permission: true },
      },
    );

    expect(step.result.executePort?.id).toBe("success");
    expect(JSON.stringify(step.result.returnValues)).toContain(
      Permission.ProjectMember,
    );
  });

  test("a step that writes any other record a Project Admin may write is not held to this rule", () => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        Label,
        stepProps(),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });
});

describe("people, API keys and OneUptime are held as before", () => {
  const WRITES: Array<
    | DatabaseRequestType.Create
    | DatabaseRequestType.Update
    | DatabaseRequestType.Delete
  > = [
    DatabaseRequestType.Create,
    DatabaseRequestType.Update,
    DatabaseRequestType.Delete,
  ];

  test.each(WRITES)(
    "a Project Admin or a Project Owner may still %s team permissions and members",
    (type: DatabaseRequestType) => {
      for (const holder of [Permission.ProjectAdmin, Permission.ProjectOwner]) {
        for (const modelType of [TeamPermission, TeamMember, Team]) {
          expect(() => {
            TablePermission.checkTableLevelPermissions(
              modelType,
              person([holder]),
              type,
            );
          }).not.toThrow();
        }
      }
    },
  );

  test("an API key holding Project Admin may still change a team's permissions", () => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        TeamPermission,
        person([Permission.ProjectAdmin], UserType.API),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });

  test("a Project Member is refused by the table's own list, as before - not by this rule", () => {
    let refusal: unknown = undefined;

    try {
      TablePermission.checkTableLevelPermissions(
        TeamPermission,
        person([Permission.ProjectMember]),
        DatabaseRequestType.Create,
      );
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal).not.toBeInstanceOf(WorkflowAccessChangeRefusedException);
    expect((refusal as Error).message).toContain(
      "You do not have permissions to create Team Permission",
    );
  });

  test("OneUptime's own writes are not held to it", () => {
    for (const type of WRITES) {
      expect(() => {
        ModelPermission.checkTableWritePermission(
          TeamPermission,
          { isRoot: true, tenantId: PROJECT_ID },
          type,
        );
      }).not.toThrow();
    }
  });

  test("a step is refused the same writes a Project Admin is let through", () => {
    for (const type of WRITES) {
      expect(() => {
        ModelPermission.checkTableWritePermission(
          TeamPermission,
          stepProps(),
          type,
        );
      }).toThrow(WorkflowAccessChangeRefusedException);
    }
  });
});

describe("the rule: a step writes no record that decides who may do what", () => {
  const ACCESS_MODELS: Array<{ new (): BaseModel }> = [
    ApiKey,
    ApiKeyCustomRole,
    ApiKeyPermission,
    CustomRole,
    CustomRolePermission,
    ProjectSCIM,
    ProjectSso,
    Team,
    TeamCustomRole,
    TeamMember,
    TeamPermission,
  ];

  test("covers the project's teams, their members and permissions, custom roles, API keys, SSO and SCIM", () => {
    expect(WorkflowPrincipal.getAccessTables().sort()).toEqual(
      ACCESS_MODELS.map((modelType: { new (): BaseModel }): string => {
        return new modelType().tableName!;
      }).sort(),
    );

    for (const modelType of ACCESS_MODELS) {
      expect(WorkflowPrincipal.isAccessTable(modelType)).toBe(true);
    }

    expect(WorkflowPrincipal.isAccessTable(Label)).toBe(false);
  });

  test("names only tables that exist", () => {
    const tableNames: Array<string> = (
      AllModelTypes as Array<{ new (): BaseModel }>
    ).map((modelType: { new (): BaseModel }): string => {
      return new modelType().tableName || "";
    });

    for (const table of WorkflowPrincipal.getAccessTables()) {
      expect(tableNames).toContain(table);
    }
  });

  test("covers every table that stores a permission", () => {
    const storingPermissions: Array<string> = [];

    for (const modelType of AllModelTypes as Array<{ new (): BaseModel }>) {
      const model: BaseModel = new modelType();

      const storesPermission: boolean = model
        .getTableColumns()
        .columns.some((column: string): boolean => {
          return (
            model.getTableColumnMetadata(column)?.type ===
            TableColumnType.Permission
          );
        });

      if (storesPermission) {
        storingPermissions.push(model.tableName!);
      }
    }

    expect(storingPermissions.length).toBeGreaterThanOrEqual(3);

    for (const table of storingPermissions) {
      expect({ table, held: WorkflowPrincipal.getAccessTables() }).toEqual({
        table,
        held: expect.arrayContaining([table]),
      });
    }
  });

  test.each(
    ACCESS_MODELS.map((modelType: { new (): BaseModel }) => {
      return [new modelType().tableName!, modelType] as [
        string,
        { new (): BaseModel },
      ];
    }),
  )(
    "%s: a step's create, update and delete are refused in its words; its read is not",
    (_table: string, modelType: { new (): BaseModel }) => {
      const records: string = new modelType().pluralName!;

      for (const [type, verb] of [
        [DatabaseRequestType.Create, "create"],
        [DatabaseRequestType.Update, "change"],
        [DatabaseRequestType.Delete, "delete"],
      ] as Array<[DatabaseRequestType, string]>) {
        let refusal: unknown = undefined;

        try {
          WorkflowPrincipal.assertDoesNotChangeAccess({
            modelType: modelType,
            props: stepProps(),
            type: type,
          });
        } catch (error) {
          refusal = error;
        }

        expect(refusal).toBeInstanceOf(WorkflowAccessChangeRefusedException);
        // Still the refusal it is everywhere else.
        expect(refusal).toBeInstanceOf(NotAuthorizedException);
        expect((refusal as Error).message).toBe(
          `${REFUSAL_START}, so they can't ${verb} ${records}. A person who manages the project's teams and API keys has to make this change.`,
        );
      }

      expect(() => {
        WorkflowPrincipal.assertDoesNotChangeAccess({
          modelType: modelType,
          props: stepProps(),
          type: DatabaseRequestType.Read,
        });
      }).not.toThrow();

      // A person who manages access is not a step.
      expect(() => {
        WorkflowPrincipal.assertDoesNotChangeAccess({
          modelType: modelType,
          props: person([Permission.ProjectAdmin]),
          type: DatabaseRequestType.Create,
        });
      }).not.toThrow();
    },
  );

  test("tells a step's props by their user type alone - never root, never a person", () => {
    const props: DatabaseCommonInteractionProps = stepProps();

    expect(WorkflowPrincipal.isWorkflow(props)).toBe(true);
    expect(props.isRoot).toBeUndefined();
    expect(props.userId).toBeUndefined();
    expect(
      WorkflowPrincipal.isWorkflow(person([Permission.ProjectAdmin])),
    ).toBe(false);
  });

  test("the components are the ones a member drops on the canvas", () => {
    expect(
      new CreateOneBaseModel<TeamPermission>(
        TeamPermissionService,
      ).getMetadata().id,
    ).toBe("team-permission-create-one");
    expect(
      new CreateOneBaseModel<TeamMember>(TeamMemberService).getMetadata().id,
    ).toBe("team-member-create-one");
    expect(
      ACCESS_WRITE_STEPS.map((step: WriteStep): string => {
        return step.componentId;
      }),
    ).toContain(`${Text.pascalCaseToDashes("TeamPermission")}-create-many`);
  });
});

describe("the run log", () => {
  test("says the refusal as it is, naming the step - not as the Project Admin ceiling", () => {
    const message: string = WorkflowPrincipal.getAccessChangeRefusal(
      TeamPermission,
      DatabaseRequestType.Create,
    );

    expect(
      describeRefusal({
        error: new WorkflowAccessChangeRefusedException(message),
        message: message,
        stepTitle: "Create One Team Permission",
      }),
    ).toBe(
      `"Create One Team Permission" was refused. ${REFUSAL_START}, so they can't create Team Permissions. A person who manages the project's teams and API keys has to make this change.`,
    );
  });

  test("keeps the Project Admin ceiling's words for every other refusal", () => {
    expect(
      describeRefusal({
        error: new NotAuthorizedException("…"),
        message: "…",
        stepTitle: "Create One Label",
      }),
    ).toBe(`"Create One Label" was refused. ${ADMIN_CEILING}: …`);
  });
});
