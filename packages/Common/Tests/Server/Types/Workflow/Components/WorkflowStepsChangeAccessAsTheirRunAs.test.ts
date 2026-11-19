import ApiKeyPermission from "../../../../../Models/DatabaseModels/ApiKeyPermission";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomRole from "../../../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../../../Models/DatabaseModels/CustomRolePermission";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamCustomRole from "../../../../../Models/DatabaseModels/TeamCustomRole";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../../../Models/DatabaseModels/TeamPermission";
import ApiKeyPermissionService from "../../../../../Server/Services/ApiKeyPermissionService";
import CustomRolePermissionService from "../../../../../Server/Services/CustomRolePermissionService";
import CustomRoleService from "../../../../../Server/Services/CustomRoleService";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import TeamCustomRoleService from "../../../../../Server/Services/TeamCustomRoleService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../../../Server/Services/TeamPermissionService";
import TeamService from "../../../../../Server/Services/TeamService";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import UpdateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateOneBaseModel";
import ProjectReferenceCheck from "../../../../../Server/Utils/Database/ProjectReferenceCheck";
import { WorkflowRunAsGrant } from "../../../../../Server/Utils/Workflow/WorkflowPrincipal";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { TEAM_NOT_EDITABLE_FOR_ROLES_MESSAGE } from "../../../../../Types/Team/CustomRole";
import { WorkflowRunAs } from "../../../../../Types/Workflow/WorkflowRunAs";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
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
 * A WORKFLOW'S STEP CHANGES TEAMS AND ROLES AS FAR AS ITS RUN AS ALLOWS
 * (#9695).
 *
 * The issue: "On Create Team" -> "Create One Team Custom Role", so every
 * new team gets a role. On the default permissions a workflow's steps
 * change nobody's access (WorkflowStepsDoNotChangeAccess), and the run log
 * said a person had to do it. A person who holds the permissions may now
 * give the workflow Project Owner, or a custom role, to run as; then its
 * steps meet exactly the checks a person with those permissions meets:
 *
 *   - the table's own list (Edit Team Permissions, or Project Owner/Admin);
 *   - the team's permissions must be editable (Owners and Admin are not);
 *   - the grant ceiling: a role, a permission or a team's rows are handed
 *     on only as far as the permissions the workflow runs with reach - a
 *     Project Owner's reach everything, a custom role's only its own - and
 *     the refusal says so of the workflow, naming the permission;
 *   - and never an API key, SSO or SCIM, whatever it runs as.
 *
 * The steps run over the real create pipelines of TeamCustomRoleService,
 * TeamPermissionService and TeamMemberService - their hooks, the
 * permission checks and the grant ceiling - with the database left out:
 * the reads they make are stubbed, and the would-be insert is caught just
 * before it is written, so a step let through is one that reaches it.
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
  "96950000-0000-4000-8000-000000000001",
);
// A team someone just created, and the owners' team.
const NEW_TEAM_ID: ObjectID = new ObjectID(
  "96950000-0000-4000-8000-0000000000b1",
);
const OWNERS_TEAM_ID: ObjectID = new ObjectID(
  "96950000-0000-4000-8000-0000000000b2",
);
// The role every new team is given, and one that holds Project Admin.
const RESPONDER_ROLE_ID: ObjectID = new ObjectID(
  "96950000-0000-4000-8000-0000000000c1",
);
const ADMINS_ROLE_ID: ObjectID = new ObjectID(
  "96950000-0000-4000-8000-0000000000c2",
);
const USER_ID: ObjectID = new ObjectID("96950000-0000-4000-8000-0000000000a1");

class PastTheChecks extends Error {
  public constructor() {
    super("Every check passed; the write would be made now.");
  }
}

interface StepRun {
  result: RunReturnType;
  lines: Array<string>;
}

const savedPlanEnvironment: Record<string, string | undefined> = {};

function row(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    scope: PermissionScope.All,
    isBlockPermission: false,
  };
}

const OWNER_RUN: WorkflowRunAsGrant = {
  runAs: WorkflowRunAs.ProjectOwner,
  givenByUserId: USER_ID,
  givenByName: "Jane Doe",
};

// A workflow that runs as the custom role "Team Provisioner", holding these.
function roleRun(permissions: Array<Permission>): WorkflowRunAsGrant {
  return {
    runAs: WorkflowRunAs.CustomRole,
    customRoleId: ObjectID.generate(),
    customRoleName: "Team Provisioner",
    rolePermissions: permissions.map(row),
    givenByUserId: USER_ID,
    givenByName: "Jane Doe",
  };
}

function options(
  lines: Array<string>,
  runAs: WorkflowRunAsGrant | undefined,
): RunOptions {
  return {
    log: ((line: unknown): void => {
      lines.push(typeof line === "string" ? line : JSON.stringify(line));
    }) as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    workflowName: "Give new teams their role",
    projectId: PROJECT_ID,
    runAs: runAs,
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };
}

async function run(
  component: ComponentCode,
  args: JSONObject,
  runAs: WorkflowRunAsGrant | undefined,
): Promise<StepRun> {
  const lines: Array<string> = [];
  const result: RunReturnType = await component.run(
    args,
    options(lines, runAs),
  );
  return { result, lines };
}

// The row a service's create would insert, caught just before it is written.
function stopBeforeInsert<TBaseModel extends BaseModel>(
  service: DatabaseService<TBaseModel>,
): () => Record<string, unknown> | undefined {
  let inserted: Record<string, unknown> | undefined = undefined;

  // The unique-value checks find no clash, without a database.
  getJestSpyOn(service, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );

  getJestSpyOn(service, "assertCreateWillInsert").mockImplementation(((
    data: unknown,
  ): never => {
    inserted = { ...(data as Record<string, unknown>) };
    throw new PastTheChecks();
  }) as never);

  return (): Record<string, unknown> | undefined => {
    return inserted;
  };
}

// The team a step names, read by the service as it checks the give.
function stubTeam(teamId: ObjectID, isPermissionsEditable: boolean): void {
  getJestSpyOn(TeamService, "findOneBy").mockImplementation((async () => {
    const team: Team = new Team(teamId);
    team.projectId = PROJECT_ID;
    team.isPermissionsEditable = isPermissionsEditable;
    return team;
  }) as never);
}

// The custom role a step gives a team, with the permissions it holds.
function stubRole(
  roleId: ObjectID,
  name: string,
  permissions: Array<Permission>,
): void {
  getJestSpyOn(CustomRoleService, "findOneBy").mockImplementation((async () => {
    const role: CustomRole = new CustomRole(roleId);
    role.projectId = PROJECT_ID;
    role.name = name;
    return role;
  }) as never);

  getJestSpyOn(
    CustomRolePermissionService,
    "findPermissionsOfRole",
  ).mockImplementation((async () => {
    return permissions.map((permission: Permission): CustomRolePermission => {
      const model: CustomRolePermission = new CustomRolePermission();
      model.customRoleId = roleId;
      model.projectId = PROJECT_ID;
      model.permission = permission;
      model.scope = PermissionScope.All;
      model.labels = [];
      return model;
    });
  }) as never);
}

function lineOf(step: ComponentCode, stepRun: StepRun): string {
  const title: string = step.getMetadata().title;
  const line: string | undefined = stepRun.lines.find(
    (candidate: string): boolean => {
      return candidate.startsWith(`"${title}" was refused`);
    },
  );

  expect(line).toBeDefined();

  return line!;
}

// A step let through every check: it reached the would-be insert.
function expectReachedTheTable(stepRun: StepRun): void {
  expect(stepRun.result.executePort?.id).toBe("error");
  expect(stepRun.result.executePortReason).toBe(
    "Every check passed; the write would be made now.",
  );
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

beforeEach(() => {
  setTestBillingEnabled(true);

  // A plan that sells team management, so the plan is not what refuses.
  getJestSpyOn(ProjectService, "getCurrentPlan").mockImplementation(
    (async () => {
      return { plan: PlanType.Enterprise, isSubscriptionUnpaid: false };
    }) as never,
  );

  // The rows here are all this project's: that defence has tests of its own.
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe('"Create One Team Custom Role": a new team given its role (#9695)', () => {
  const giveRole: () => CreateOneBaseModel<TeamCustomRole> =
    (): CreateOneBaseModel<TeamCustomRole> => {
      return new CreateOneBaseModel<TeamCustomRole>(TeamCustomRoleService);
    };

  const ARGUMENTS: JSONObject = {
    json: {
      teamId: NEW_TEAM_ID.toString(),
      customRoleId: RESPONDER_ROLE_ID.toString(),
    },
  };

  test("on the default permissions, it is refused naming Edit Team Permissions and where to give it - and no hook runs", async () => {
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamCustomRoleService);
    const teamRead: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      TeamService,
      "findOneBy",
    );
    const component: CreateOneBaseModel<TeamCustomRole> = giveRole();

    const step: StepRun = await run(component, ARGUMENTS, undefined);

    expect(step.result.executePort?.id).toBe("error");
    expect(lineOf(component, step)).toBe(
      `"Create One Team Custom Role" was refused. Workflows that run with the default permissions don't change who has access to this project, so this step can't create Team Custom Roles. To let this workflow do it, choose what it runs as in its Settings: Project Owner, or a custom role that has Edit Team Permissions.`,
    );
    expect(inserted()).toBeUndefined();
    expect(teamRead).not.toHaveBeenCalled();
  });

  test("run as Project Owner, it passes every check a Project Owner meets and reaches the table", async () => {
    stubTeam(NEW_TEAM_ID, true);
    stubRole(RESPONDER_ROLE_ID, "Incident Responder", [
      Permission.IncidentMember,
      Permission.ProjectAdmin,
    ]);
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamCustomRoleService);

    const step: StepRun = await run(giveRole(), ARGUMENTS, OWNER_RUN);

    expectReachedTheTable(step);
    expect(String(inserted()?.["teamId"]).toLowerCase()).toBe(
      NEW_TEAM_ID.toString().toLowerCase(),
    );
    expect(String(inserted()?.["customRoleId"]).toLowerCase()).toBe(
      RESPONDER_ROLE_ID.toString().toLowerCase(),
    );
    // Into the workflow's own project, whatever the step sent.
    expect(String(inserted()?.["projectId"]).toLowerCase()).toBe(
      PROJECT_ID.toString().toLowerCase(),
    );
  });

  test("run as a custom role with Edit Team Permissions and everything the role gives, it reaches the table", async () => {
    stubTeam(NEW_TEAM_ID, true);
    stubRole(RESPONDER_ROLE_ID, "Incident Responder", [
      Permission.IncidentMember,
    ]);
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamCustomRoleService);

    const step: StepRun = await run(
      giveRole(),
      ARGUMENTS,
      roleRun([
        Permission.EditProjectTeamPermissions,
        Permission.IncidentMember,
      ]),
    );

    expectReachedTheTable(step);
    expect(inserted()).toBeDefined();
  });

  test("run as a custom role, a role holding more than it may give is refused, naming the permission", async () => {
    stubTeam(NEW_TEAM_ID, true);
    stubRole(ADMINS_ROLE_ID, "Admins", [Permission.ProjectAdmin]);
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamCustomRoleService);
    const component: CreateOneBaseModel<TeamCustomRole> = giveRole();

    const step: StepRun = await run(
      component,
      {
        json: {
          teamId: NEW_TEAM_ID.toString(),
          customRoleId: ADMINS_ROLE_ID.toString(),
        },
      },
      roleRun([
        Permission.EditProjectTeamPermissions,
        Permission.IncidentMember,
      ]),
    );

    expect(step.result.executePort?.id).toBe("error");
    expect(lineOf(component, step)).toBe(
      `"Create One Team Custom Role" was refused. This workflow runs as the custom role "Team Provisioner", so its steps can do only what that role allows: This workflow can't give Admins: it has Project Admin, and the permissions this workflow runs with don't include that permission at the same or a broader scope.`,
    );
    expect(inserted()).toBeUndefined();
  });

  test("run as a custom role without Edit Team Permissions, the table's own list refuses it, naming what it takes", async () => {
    stubTeam(NEW_TEAM_ID, true);
    stubRole(RESPONDER_ROLE_ID, "Incident Responder", [
      Permission.IncidentMember,
    ]);
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamCustomRoleService);
    const component: CreateOneBaseModel<TeamCustomRole> = giveRole();

    const step: StepRun = await run(
      component,
      ARGUMENTS,
      roleRun([Permission.IncidentMember]),
    );

    const line: string = lineOf(component, step);

    expect(line).toContain(
      'This workflow runs as the custom role "Team Provisioner", so its steps can do only what that role allows',
    );
    expect(line).toContain("Edit Team Permissions");
    expect(inserted()).toBeUndefined();
  });

  test("even run as Project Owner, the Owners team's permissions can't be changed", async () => {
    stubTeam(OWNERS_TEAM_ID, false);
    stubRole(RESPONDER_ROLE_ID, "Incident Responder", [
      Permission.IncidentMember,
    ]);
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamCustomRoleService);

    const step: StepRun = await run(
      giveRole(),
      {
        json: {
          teamId: OWNERS_TEAM_ID.toString(),
          customRoleId: RESPONDER_ROLE_ID.toString(),
        },
      },
      OWNER_RUN,
    );

    expect(step.result.executePort?.id).toBe("error");
    expect(step.result.executePortReason).toContain(
      TEAM_NOT_EDITABLE_FOR_ROLES_MESSAGE,
    );
    expect(inserted()).toBeUndefined();
  });
});

describe('"Create One Team Permission": held to the grant ceiling of what the workflow runs as', () => {
  const grant: () => CreateOneBaseModel<TeamPermission> =
    (): CreateOneBaseModel<TeamPermission> => {
      return new CreateOneBaseModel<TeamPermission>(TeamPermissionService);
    };

  // The team holds no such permission yet: the service's duplicate check finds none.
  function teamHoldsNothingYet(): void {
    getJestSpyOn(TeamPermissionService, "findOneBy").mockResolvedValue(
      null as never,
    );
  }

  const GIVE_PROJECT_ADMIN: JSONObject = {
    json: {
      teamId: NEW_TEAM_ID.toString(),
      permission: Permission.ProjectAdmin,
      scope: PermissionScope.All,
    },
  };

  test("run as Project Owner, giving a team Project Admin reaches the table: a Project Owner may", async () => {
    stubTeam(NEW_TEAM_ID, true);
    teamHoldsNothingYet();
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamPermissionService);

    const step: StepRun = await run(grant(), GIVE_PROJECT_ADMIN, OWNER_RUN);

    expectReachedTheTable(step);
    expect(inserted()?.["permission"]).toBe(Permission.ProjectAdmin);
  });

  test("run as a custom role, giving what the role does not hold is refused, said of the workflow", async () => {
    stubTeam(NEW_TEAM_ID, true);
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamPermissionService);
    const component: CreateOneBaseModel<TeamPermission> = grant();

    const step: StepRun = await run(
      component,
      GIVE_PROJECT_ADMIN,
      roleRun([Permission.EditProjectTeamPermissions]),
    );

    expect(lineOf(component, step)).toContain(
      "This workflow cannot grant Project Admin because the permissions it runs with do not include that permission at an equal or broader scope.",
    );
    expect(inserted()).toBeUndefined();
  });

  test("run as a custom role, giving what the role holds reaches the table", async () => {
    stubTeam(NEW_TEAM_ID, true);
    teamHoldsNothingYet();
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamPermissionService);

    const step: StepRun = await run(
      grant(),
      {
        json: {
          teamId: NEW_TEAM_ID.toString(),
          permission: Permission.IncidentMember,
          scope: PermissionScope.All,
        },
      },
      roleRun([
        Permission.EditProjectTeamPermissions,
        Permission.IncidentMember,
      ]),
    );

    expectReachedTheTable(step);
    expect(inserted()?.["permission"]).toBe(Permission.IncidentMember);
  });
});

describe('"Create One Team Member": a team is joined only as far as what the workflow runs as reaches', () => {
  test("run as a custom role that may invite, putting someone on the owners' team is refused, said of the workflow", async () => {
    getJestSpyOn(TeamService, "findOneBy").mockImplementation((async () => {
      const team: Team = new Team(OWNERS_TEAM_ID);
      team.projectId = PROJECT_ID;
      team.isPermissionsEditable = false;
      return team;
    }) as never);
    // What joining the owners' team hands on: Project Owner.
    getJestSpyOn(TeamPermissionService, "findBy").mockImplementation(
      (async () => {
        const ownerRow: TeamPermission = new TeamPermission();
        ownerRow.teamId = OWNERS_TEAM_ID;
        ownerRow.projectId = PROJECT_ID;
        ownerRow.permission = Permission.ProjectOwner;
        ownerRow.scope = PermissionScope.All;
        ownerRow.labels = [];
        return [ownerRow];
      }) as never,
    );
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamMemberService);
    const component: CreateOneBaseModel<TeamMember> =
      new CreateOneBaseModel<TeamMember>(TeamMemberService);

    const step: StepRun = await run(
      component,
      {
        json: {
          teamId: OWNERS_TEAM_ID.toString(),
          userId: USER_ID.toString(),
          hasAcceptedInvitation: true,
        },
      },
      roleRun([Permission.InviteProjectTeamMembers]),
    );

    expect(step.result.executePort?.id).toBe("error");
    expect(lineOf(component, step)).toContain(
      "This workflow cannot grant Project Owner because the permissions it runs with do not include that permission at an equal or broader scope.",
    );
    expect(inserted()).toBeUndefined();
  });
});

describe("API keys stay off limits, whatever a workflow runs as", () => {
  test('"Update One API Key Permission" run as Project Owner is refused before any hook', async () => {
    const hook: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ApiKeyPermissionService,
      "onBeforeUpdate" as never,
    );
    const component: UpdateOneBaseModel<ApiKeyPermission> =
      new UpdateOneBaseModel<ApiKeyPermission>(ApiKeyPermissionService);

    const step: StepRun = await run(
      component,
      {
        query: { _id: ObjectID.generate().toString() },
        data: { permission: Permission.ProjectOwner },
      },
      OWNER_RUN,
    );

    expect(lineOf(component, step)).toBe(
      `"Update One API Key Permission" was refused. Workflow steps never change the project's API keys, single sign-on or SCIM settings, whatever the workflow runs as, so they can't change API Key Permissions. A person who manages them has to make this change.`,
    );
    expect(hook).not.toHaveBeenCalled();
  });
});
