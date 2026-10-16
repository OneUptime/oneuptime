import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../../../Models/DatabaseModels/TeamPermission";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../../../Server/Services/TeamPermissionService";
import TeamService from "../../../../../Server/Services/TeamService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ProjectReferenceCheck from "../../../../../Server/Utils/Database/ProjectReferenceCheck";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import WorkflowPrincipal from "../../../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Exception from "../../../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import UserType from "../../../../../Types/UserType";
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
 * A PROJECT MEMBER CANNOT MAKE ANYONE A PROJECT OWNER THROUGH A WORKFLOW STEP.
 *
 * A project member who cannot grant Project Owner, and cannot join the
 * owners' team as an accepted member, can still build a workflow: Project
 * Member is on the Workflow create list. A workflow whose graph writes an
 * identity row - a "Create One Team Permission" step granting Project Owner,
 * or a "Create One Team Member" step adding the builder to the owners' team
 * already accepted - must not do, when it runs, what its builder may not.
 *
 * Two things refuse it, and each is held here on its own:
 *
 *  - a step changes nobody's access at all: it creates, changes and deletes
 *    no team, team member, team permission, role or API key permission
 *    (WorkflowPrincipal.assertDoesNotChangeAccess - WorkflowStepsDoNotChange
 *    Access holds that rule for every such step, Project Admin grants
 *    included);
 *  - and were that rule ever lifted, a step still acts as a Project Admin of
 *    the workflow's project, never as root (WorkflowPrincipal), so the grant
 *    ceiling a person meets applies to it: a Project Admin holds no Project
 *    Owner row, so it cannot grant Project Owner, and it cannot add anyone to
 *    a team whose rows a Project Admin could not hand on (the owners' team).
 *
 * Either way the step is refused, takes its Error output, and writes nothing.
 *
 * The steps run here over the real TeamPermissionService / TeamMemberService
 * create pipeline - their onBeforeCreate grant ceiling and the real workflow
 * principal - with the database left out: the cross-project reference check
 * (a separate defence with its own tests) and the single team lookups the
 * ceiling makes are stubbed, and the would-be insert is caught just before it
 * is written, so a refused step is one that never reaches it. Billing is on,
 * on a plan that sells team management, so the plan is not what refuses these
 * steps. The last block holds the workflow principal to the ceiling directly,
 * with no pipeline at all.
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
  "7c000000-0000-4000-8000-000000000001",
);
// The project member who builds the workflow.
const MEMBER_USER_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-0000000000a1",
);
// A team whose permissions may be edited (the project's Members team).
const EDITABLE_TEAM_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-0000000000b1",
);
// The owners' team: it already holds Project Owner.
const OWNERS_TEAM_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-0000000000c1",
);

const GRANT_CEILING_SENTENCE: string =
  "You cannot grant Project Owner because your own access does not include that permission at an equal or broader scope.";

const ACCESS_RULE_SENTENCE: string =
  "Workflow steps don't change who has access to this project";

const ADMIN_CEILING_SENTENCE: string =
  "Workflow steps can do only what a Project Admin of this project can do";

/*
 * The first refusal lifted, to show the second still holds: the step acts
 * as a Project Admin and meets the grant ceiling.
 */
function liftAccessRule(): void {
  getJestSpyOn(
    WorkflowPrincipal,
    "assertDoesNotChangeAccess",
  ).mockImplementation((() => {
    return undefined;
  }) as never);
}

class PastTheChecks extends Error {
  public constructor() {
    super("Every check passed; the write would be made now.");
  }
}

interface StepRun {
  result: RunReturnType;
  lines: Array<string>;
}

type SpyInstance = ReturnType<typeof getJestSpyOn>;

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

function refusedLine(step: ComponentCode, lines: Array<string>): string {
  const title: string = step.getMetadata().title;
  const line: string | undefined = lines.find((candidate: string) => {
    return candidate.startsWith(`"${title}" was refused`);
  });

  expect(line).toBeDefined();

  return line!;
}

const savedPlanEnvironment: Record<string, string | undefined> = {};
let currentPlanSpy: SpyInstance;

// The row a service's create would insert, caught just before it is written.
function stopBeforeInsert<TBaseModel extends BaseModel>(
  service: DatabaseService<TBaseModel>,
): () => Record<string, unknown> | undefined {
  let row: Record<string, unknown> | undefined = undefined;

  // The unique-value checks find no clash, without a database.
  getJestSpyOn(service, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );

  getJestSpyOn(service, "assertCreateWillInsert").mockImplementation(((
    data: unknown,
  ): never => {
    row = { ...(data as Record<string, unknown>) };
    throw new PastTheChecks();
  }) as never);

  return (): Record<string, unknown> | undefined => {
    return row;
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

beforeEach(() => {
  setTestBillingEnabled(true);

  // A plan that sells team management, so the plan is not what refuses.
  currentPlanSpy = getJestSpyOn(ProjectService, "getCurrentPlan");
  currentPlanSpy.mockImplementation((async () => {
    return { plan: PlanType.Enterprise, isSubscriptionUnpaid: false };
  }) as never);

  /*
   * The cross-project reference check (that the team/project the row names are
   * this project's) is a separate defence with its own tests. Stub it so these
   * tests isolate the grant ceiling that onBeforeCreate runs after it.
   */
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe('"Create One Team Permission" step', () => {
  // The ceiling reads the team to check its permissions may be edited.
  function stubEditableTeam(): void {
    getJestSpyOn(TeamService, "findOneBy").mockImplementation((async () => {
      const team: Team = new Team(EDITABLE_TEAM_ID);
      team.projectId = PROJECT_ID;
      team.isPermissionsEditable = true;
      return team;
    }) as never);
  }

  test("is the component a member drops on the canvas", () => {
    const component: CreateOneBaseModel<TeamPermission> =
      new CreateOneBaseModel<TeamPermission>(TeamPermissionService);

    expect(component.getMetadata().id).toBe("team-permission-create-one");
  });

  test("granting Project Owner is refused, naming the step, and writes nothing", async () => {
    stubEditableTeam();
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamPermissionService);

    const component: CreateOneBaseModel<TeamPermission> =
      new CreateOneBaseModel<TeamPermission>(TeamPermissionService);

    const step: StepRun = await run(component, {
      json: {
        teamId: EDITABLE_TEAM_ID.toString(),
        permission: Permission.ProjectOwner,
        scope: PermissionScope.All,
      },
    });

    // Error output, not success.
    expect(step.result.executePort?.id).toBe("error");

    // The run log names the step and why, in plain words.
    const line: string = refusedLine(component, step.lines);
    expect(line).toContain(ACCESS_RULE_SENTENCE);
    expect(line).toContain("so they can't create Team Permissions");

    // Refused before the would-be insert: nothing was written.
    expect(inserted()).toBeUndefined();

    // The step asked for the project's plan - it acts on the project, not as root.
    expect(currentPlanSpy).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("with that refusal lifted, the Project Admin ceiling still refuses Project Owner", async () => {
    liftAccessRule();
    stubEditableTeam();
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamPermissionService);

    const component: CreateOneBaseModel<TeamPermission> =
      new CreateOneBaseModel<TeamPermission>(TeamPermissionService);

    const step: StepRun = await run(component, {
      json: {
        teamId: EDITABLE_TEAM_ID.toString(),
        permission: Permission.ProjectOwner,
        scope: PermissionScope.All,
      },
    });

    expect(step.result.executePort?.id).toBe("error");

    // The run log names the step and the ceiling, in plain words.
    const line: string = refusedLine(component, step.lines);
    expect(line).toContain(ADMIN_CEILING_SENTENCE);
    expect(line).toContain(GRANT_CEILING_SENTENCE);

    // The ceiling threw before the would-be insert: nothing was written.
    expect(inserted()).toBeUndefined();
  });
});

describe('"Create One Team Member" step', () => {
  function stubOwnersTeam(): void {
    getJestSpyOn(TeamService, "findOneBy").mockImplementation((async () => {
      const team: Team = new Team(OWNERS_TEAM_ID);
      team.projectId = PROJECT_ID;
      team.isPermissionsEditable = false;
      return team;
    }) as never);
  }

  // What adding someone to the owners' team would hand on: Project Owner.
  function stubOwnersTeamHoldsOwner(): void {
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
  }

  test("is the component a member drops on the canvas", () => {
    const component: CreateOneBaseModel<TeamMember> =
      new CreateOneBaseModel<TeamMember>(TeamMemberService);

    expect(component.getMetadata().id).toBe("team-member-create-one");
  });

  test("adding the member to the owners' team, accepted, is refused and writes nothing", async () => {
    stubOwnersTeam();
    stubOwnersTeamHoldsOwner();
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamMemberService);

    const component: CreateOneBaseModel<TeamMember> =
      new CreateOneBaseModel<TeamMember>(TeamMemberService);

    const step: StepRun = await run(component, {
      json: {
        teamId: OWNERS_TEAM_ID.toString(),
        userId: MEMBER_USER_ID.toString(),
        hasAcceptedInvitation: true,
      },
    });

    expect(step.result.executePort?.id).toBe("error");

    const line: string = refusedLine(component, step.lines);
    expect(line).toContain(ACCESS_RULE_SENTENCE);
    expect(line).toContain("so they can't create Team Members");

    // Refused before the membership could be written.
    expect(inserted()).toBeUndefined();
  });

  test("with that refusal lifted, the Project Admin ceiling still keeps the member off the owners' team", async () => {
    liftAccessRule();
    stubOwnersTeam();
    stubOwnersTeamHoldsOwner();
    const inserted: () => Record<string, unknown> | undefined =
      stopBeforeInsert(TeamMemberService);

    const component: CreateOneBaseModel<TeamMember> =
      new CreateOneBaseModel<TeamMember>(TeamMemberService);

    const step: StepRun = await run(component, {
      json: {
        teamId: OWNERS_TEAM_ID.toString(),
        userId: MEMBER_USER_ID.toString(),
        hasAcceptedInvitation: true,
      },
    });

    expect(step.result.executePort?.id).toBe("error");

    const line: string = refusedLine(component, step.lines);
    expect(line).toContain(ADMIN_CEILING_SENTENCE);
    expect(line).toContain(GRANT_CEILING_SENTENCE);

    // The ceiling threw before the membership could be written.
    expect(inserted()).toBeUndefined();
  });
});

describe("the workflow principal, held to the grant ceiling directly", () => {
  function workflowProps(): DatabaseCommonInteractionProps {
    const props: DatabaseCommonInteractionProps =
      WorkflowPrincipal.getPropsWithoutPlan({
        projectId: PROJECT_ID,
        workflowId: ObjectID.generate(),
        workflowName: "Member's automation",
      });

    // A workflow step is never root and names no person.
    expect(props.isRoot).toBeUndefined();
    expect(props.isMasterAdmin).toBeUndefined();
    expect(props.userId).toBeUndefined();
    expect(props.userType).toBe(UserType.Workflow);

    return props;
  }

  test("cannot grant Project Owner, by the words the server refuses it with", () => {
    expect(() => {
      TeamPermissionService.assertCanGrantPermission({
        permission: Permission.ProjectOwner,
        scope: PermissionScope.All,
        props: workflowProps(),
      });
    }).toThrow(GRANT_CEILING_SENTENCE);
  });

  test("cannot add anyone to a team that holds Project Owner", async () => {
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

    await expect(
      TeamPermissionService.assertCanGrantTeamPermissions({
        teamId: OWNERS_TEAM_ID,
        projectId: PROJECT_ID,
        props: workflowProps(),
      }),
    ).rejects.toThrow(NotAuthorizedException);
  });
});
