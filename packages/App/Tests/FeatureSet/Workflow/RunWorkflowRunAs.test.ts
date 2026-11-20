import RunWorkflow, {
  RunStack,
  StorageMap,
} from "../../../FeatureSet/Workflow/Services/RunWorkflow";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import User from "Common/Models/DatabaseModels/User";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import ApiKeyPermissionService from "Common/Server/Services/ApiKeyPermissionService";
import ApiKeyService from "Common/Server/Services/ApiKeyService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserService from "Common/Server/Services/UserService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "Common/Server/Types/Workflow/ComponentCode";
import Components from "Common/Server/Types/Workflow/Components/Index";
import logger from "Common/Server/Utils/Logger";
import WorkflowPrincipal from "Common/Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "Common/Types/Email";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import WorkflowComponents from "Common/Types/Workflow/Components/Workflow";
import { WorkflowRunAs } from "Common/Types/Workflow/WorkflowRunAs";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT EACH RUN ACTS AS (#9695), as the runner works it out and records it:
 *
 *   - a workflow that runs as Default runs exactly as before: its steps get
 *     the default permissions, nothing is read about anyone, and its log
 *     says nothing new - the run's row says Default;
 *   - one that runs as Project Owner runs with it while the person who
 *     gave it still is one, says so as it starts, and its row names them;
 *   - once that person is not, the run does not start - no step runs - and
 *     it says why and who can put it right, and so does one woken from a
 *     Sleep step;
 *   - a raised run reads none of the project's global variables;
 *   - its Run Workflow step starts another raised workflow only if its own
 *     permissions include the other's.
 */

const WORKFLOW_ID: ObjectID = new ObjectID(
  "a9950000-0000-4000-8000-000000000001",
);
const WORKFLOW_LOG_ID: ObjectID = new ObjectID(
  "a9950000-0000-4000-8000-000000000002",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "a9950000-0000-4000-8000-000000000003",
);
const GIVER_ID: ObjectID = new ObjectID("a9950000-0000-4000-8000-0000000000a1");
const CALLED_WORKFLOW_ID: ObjectID = new ObjectID(
  "a9950000-0000-4000-8000-000000000004",
);

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

const COMPONENT: ComponentMetadata = {
  id: "RunAsTestComponent",
  title: "Run As test component",
  category: "Test",
  description: "A step that says what it was handed.",
  iconProp: IconProp.Workflow,
  componentType: ComponentType.Trigger,
  arguments: [
    {
      id: "team",
      name: "team",
      description: "A team, from a global variable.",
      required: false,
      type: ComponentInputType.Text,
    },
  ],
  returnValues: [],
  inPorts: [],
  outPorts: [],
};

const NODE: NodeDataProp = {
  error: "",
  id: "run-as-test",
  internalId: "run-as-test-internal",
  nodeType: NodeType.Node,
  metadata: COMPONENT,
  metadataId: COMPONENT.id,
  arguments: { team: "{{global.variables.TEAM}}" },
  returnValues: {},
  componentType: ComponentType.Trigger,
};

const registry: Record<string, ComponentCode | undefined> =
  Components as unknown as Record<string, ComponentCode | undefined>;

interface Seen {
  options?: RunOptions | undefined;
  args?: JSONObject | undefined;
}

function theWorkflow(setting?: {
  runAs?: WorkflowRunAs;
  runAsGivenByUserId?: ObjectID;
}): Workflow {
  const row: Workflow = new Workflow();
  row.id = WORKFLOW_ID;
  row.projectId = PROJECT_ID;
  row.isEnabled = true;
  row.name = "Give new teams their role";
  row.graph = { nodes: [], edges: [] };

  if (setting?.runAs) {
    row.runAs = setting.runAs;
  }

  if (setting?.runAsGivenByUserId) {
    row.runAsGivenByUserId = setting.runAsGivenByUserId;
  }

  return row;
}

// The person who gave the workflow its permissions, as they are now.
function givenGiver(permissions: Array<Permission>): void {
  const user: User = new User();
  user.id = GIVER_ID;
  user.name = new Name("Jane Doe");
  user.email = new Email("jane@example.com");
  user.isBlocked = false;
  user.isDisabled = false;

  jest.spyOn(UserService, "findOneById").mockResolvedValue(user as never);
  jest
    .spyOn(
      AccessTokenService,
      "getDatabaseCommonInteractionPropsByUserAndProject",
    )
    .mockResolvedValue({
      userId: GIVER_ID,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: permissions.map(
            (permission: Permission): UserPermission => {
              return {
                _type: "UserPermission",
                permission: permission,
                labelIds: [],
                isBlockPermission: false,
              };
            },
          ),
        },
      },
    } as DatabaseCommonInteractionProps as never);
}

// A run of THE workflow, its one step capturing what it is handed.
function prepare(row: Workflow): {
  runner: RunWorkflow;
  seen: Seen;
  persisted: RecordedSpy;
} {
  const seen: Seen = {};

  registry[COMPONENT.id] = {
    run: async (
      args: JSONObject,
      options: RunOptions,
    ): Promise<RunReturnType> => {
      seen.options = options;
      seen.args = args;
      return { returnValues: {}, executePort: undefined };
    },
  } as unknown as ComponentCode;

  const runner: RunWorkflow = new RunWorkflow();

  jest.spyOn(WorkflowService, "findOneById").mockResolvedValue(row as never);

  const persisted: RecordedSpy = jest
    .spyOn(WorkflowLogService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never) as unknown as RecordedSpy;

  const runStack: RunStack = {
    startWithComponentId: NODE.id,
    stack: {
      [NODE.id]: {
        node: NODE,
        outPorts: {},
      },
    },
  };

  jest.spyOn(runner, "makeRunStack").mockResolvedValue(runStack);

  const storageMap: StorageMap = {
    local: { variables: { ROLE: "responders" }, components: {} },
    global: { variables: { TEAM: "platform" } },
  };

  jest.spyOn(runner, "getVariables").mockResolvedValue({
    storageMap: storageMap,
    variables: [],
  });

  return { runner, seen, persisted };
}

async function run(runner: RunWorkflow): Promise<void> {
  await runner.runWorkflow({
    arguments: {},
    workflowId: WORKFLOW_ID,
    workflowLogId: WORKFLOW_LOG_ID,
    timeout: 5_000,
  });
}

// Every column the run wrote to its row, in order.
function writes(persisted: RecordedSpy): Array<Record<string, unknown>> {
  return persisted.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { data: Record<string, unknown> }).data;
  });
}

function lastWrite(persisted: RecordedSpy): Record<string, unknown> {
  const all: Array<Record<string, unknown>> = writes(persisted);
  return all[all.length - 1]!;
}

beforeEach(() => {
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  delete registry[COMPONENT.id];
  jest.restoreAllMocks();
});

describe("a workflow that runs as Default", () => {
  test("runs as before: its steps get the default permissions, and nobody is read", async () => {
    const readUser: RecordedSpy = jest.spyOn(
      UserService,
      "findOneById",
    ) as unknown as RecordedSpy;
    const { runner, seen } = prepare(theWorkflow());

    await run(runner);

    expect(seen.options?.runAs).toEqual({ runAs: WorkflowRunAs.Default });
    expect(readUser.mock.calls).toHaveLength(0);

    // Its steps act with the props they always had.
    const props: DatabaseCommonInteractionProps =
      WorkflowPrincipal.getPropsWithoutPlan({
        projectId: PROJECT_ID,
        workflowId: WORKFLOW_ID,
        runAs: seen.options?.runAs,
      });

    expect(props).toEqual(
      WorkflowPrincipal.getPropsWithoutPlan({
        projectId: PROJECT_ID,
        workflowId: WORKFLOW_ID,
      }),
    );
  });

  test("its row says it ran as Default, naming nobody, and its log says nothing new", async () => {
    const { runner, persisted } = prepare(theWorkflow());

    await run(runner);

    expect(writes(persisted)).toContainEqual({
      runAs: WorkflowRunAs.Default,
      runAsCustomRoleName: null,
      runAsGivenByUserId: null,
      runAsGivenByApiKeyId: null,
      runAsGivenByApiKeyName: null,
    });
    expect(String(lastWrite(persisted)["logs"])).not.toContain("Running as");
    expect(lastWrite(persisted)["workflowStatus"]).toBe(WorkflowStatus.Success);
  });

  test("reads the project's global variables, as before", async () => {
    const { runner, seen } = prepare(theWorkflow());

    await run(runner);

    expect(seen.args?.["team"]).toBe("platform");
  });
});

describe("a workflow that runs as Project Owner", () => {
  test("while the person who gave it is a Project Owner, its steps run as one, and the run says so and names them", async () => {
    givenGiver([Permission.ProjectOwner]);
    const { runner, seen, persisted } = prepare(
      theWorkflow({
        runAs: WorkflowRunAs.ProjectOwner,
        runAsGivenByUserId: GIVER_ID,
      }),
    );

    await run(runner);

    expect(seen.options?.runAs?.runAs).toBe(WorkflowRunAs.ProjectOwner);
    expect(seen.options?.runAs?.givenByUserId?.toString()).toBe(
      GIVER_ID.toString(),
    );
    expect(writes(persisted)).toContainEqual({
      runAs: WorkflowRunAs.ProjectOwner,
      runAsCustomRoleName: null,
      runAsGivenByUserId: GIVER_ID,
      runAsGivenByApiKeyId: null,
      runAsGivenByApiKeyName: null,
    });
    expect(String(lastWrite(persisted)["logs"])).toContain(
      "Running as Project Owner, with the permissions Jane Doe gave this workflow.",
    );
    expect(lastWrite(persisted)["workflowStatus"]).toBe(WorkflowStatus.Success);
  });

  test("reads none of the project's global variables, only its own", async () => {
    givenGiver([Permission.ProjectOwner]);
    const { runner, seen } = prepare(
      theWorkflow({
        runAs: WorkflowRunAs.ProjectOwner,
        runAsGivenByUserId: GIVER_ID,
      }),
    );

    await run(runner);

    expect(seen.args?.["team"]).not.toBe("platform");
  });

  test("once the person who gave it is no longer a Project Owner, it does not run: no step runs, and the run says why", async () => {
    givenGiver([Permission.ProjectAdmin]);
    const { runner, seen, persisted } = prepare(
      theWorkflow({
        runAs: WorkflowRunAs.ProjectOwner,
        runAsGivenByUserId: GIVER_ID,
      }),
    );

    await run(runner);

    const reason: string =
      "This workflow didn't run: it runs as Project Owner, which Jane Doe gave it, and Jane Doe is no longer a Project Owner of this project. One of the Project Owners needs to open the workflow's Settings and choose Run As again.";

    expect(seen.options).toBeUndefined();
    expect(lastWrite(persisted)["workflowStatus"]).toBe(WorkflowStatus.Error);
    expect(String(lastWrite(persisted)["logs"])).toContain(reason);
    expect(
      (lastWrite(persisted)["stepTrace"] as JSONObject)["runErrorMessage"],
    ).toBe(reason);
  });

  test("nor does one nobody is recorded as having given", async () => {
    const { runner, seen, persisted } = prepare(
      theWorkflow({ runAs: WorkflowRunAs.ProjectOwner }),
    );

    await run(runner);

    expect(seen.options).toBeUndefined();
    expect(String(lastWrite(persisted)["logs"])).toContain(
      "the person who gave it those permissions is no longer in this project",
    );
  });

  test("a run woken from a Sleep step checks again, and does not carry on once its giver is no Project Owner", async () => {
    givenGiver([Permission.ProjectAdmin]);
    const { runner, seen, persisted } = prepare(
      theWorkflow({
        runAs: WorkflowRunAs.ProjectOwner,
        runAsGivenByUserId: GIVER_ID,
      }),
    );

    const asleep: WorkflowLog = new WorkflowLog();
    asleep.logs = "Workflow suspended.";
    asleep.isTestRun = false;
    asleep.resumeData = {
      pendingStack: [NODE.id],
      executedComponents: [],
      componentReturnValues: {},
    };

    jest
      .spyOn(WorkflowLogService, "findOneById")
      .mockResolvedValue(asleep as never);

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5_000,
      isResume: true,
    });

    expect(seen.options).toBeUndefined();
    expect(lastWrite(persisted)["workflowStatus"]).toBe(WorkflowStatus.Error);
    expect(String(lastWrite(persisted)["logs"])).toContain(
      "Jane Doe is no longer a Project Owner of this project",
    );
  });
});

describe("a Run Workflow step starting a workflow that runs as Project Owner", () => {
  const EXECUTE_WORKFLOW: ComponentMetadata = WorkflowComponents.find(
    (component: ComponentMetadata) => {
      return component.id === ComponentID.WorkflowRun;
    },
  )!;

  const STEP: NodeDataProp = {
    id: "workflow-run-1",
    internalId: "runner-workflow-run-1",
    nodeType: NodeType.Node,
    componentType: ComponentType.Component,
    metadataId: ComponentID.WorkflowRun,
    metadata: EXECUTE_WORKFLOW,
    error: "",
    arguments: {},
    returnValues: {},
  };

  function partway(runAs: WorkflowRunAs): {
    runner: RunWorkflow;
    enqueue: RecordedSpy;
  } {
    const runner: RunWorkflow = new RunWorkflow();
    const state: Record<string, unknown> = runner as never;

    state["workflowId"] = WORKFLOW_ID;
    state["projectId"] = PROJECT_ID;
    state["workflowLogId"] = WORKFLOW_LOG_ID;
    state["callChain"] = [];
    state["runAs"] = { runAs: runAs };

    const called: Workflow = new Workflow();
    called._id = CALLED_WORKFLOW_ID.toString();
    called.projectId = PROJECT_ID;
    called.isEnabled = true;
    called.name = "Promote a person";
    called.runAs = WorkflowRunAs.ProjectOwner;

    jest
      .spyOn(WorkflowService, "findOneById")
      .mockResolvedValue(called as never);

    const enqueue: RecordedSpy = jest
      .spyOn(QueueWorkflow, "addWorkflowToQueue")
      .mockResolvedValue(undefined) as unknown as RecordedSpy;

    return { runner, enqueue };
  }

  async function step(runner: RunWorkflow): Promise<RunReturnType> {
    return await runner.runComponent(
      {
        workflowId: CALLED_WORKFLOW_ID.toString(),
        arguments: '{"userId": "someone"}',
      },
      STEP,
      (): void => {
        // The step reports through its Error port.
      },
    );
  }

  test("from a workflow that runs as Default: refused, naming it, and never queued", async () => {
    const { runner, enqueue } = partway(WorkflowRunAs.Default);

    const result: RunReturnType = await step(runner);

    expect(result.executePort?.id).toBe("error");
    expect((result.returnValues as JSONObject)["error"]).toBe(
      `"Promote a person" runs as Project Owner, which this workflow's own permissions don't include, so this workflow can't start it. Start it from a workflow that runs with the same permissions or more.`,
    );
    expect(enqueue.mock.calls).toHaveLength(0);
  });

  test("from a workflow that runs as Project Owner: queued", async () => {
    const { runner, enqueue } = partway(WorkflowRunAs.ProjectOwner);

    const result: RunReturnType = await step(runner);

    expect(result.executePort?.id).not.toBe("error");
    expect(enqueue.mock.calls).toHaveLength(1);
  });
});

/*
 * A WORKFLOW AN API KEY GAVE ITS RUN AS (#9765): every run, and every wake
 * from a Sleep step, reads the key again before its first step - deleted
 * (revoked), expired or narrowed, and the run does not start.
 */
describe("a workflow that runs as Project Owner, given by an API key", () => {
  const KEY_ID: ObjectID = new ObjectID("a9950000-0000-4000-8000-0000000000b1");

  function keyedWorkflow(): Workflow {
    const row: Workflow = theWorkflow({ runAs: WorkflowRunAs.ProjectOwner });
    row.runAsGivenByApiKeyId = KEY_ID;
    return row;
  }

  // The key as the run reads it: its row, and its permissions now.
  function givenKey(data: {
    permissions: Array<Permission>;
    exists?: boolean;
    expiresAt?: Date;
  }): void {
    const key: ApiKey = new ApiKey();
    key.id = KEY_ID;
    key.name = "Terraform";
    key.expiresAt =
      data.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    jest
      .spyOn(ApiKeyService, "findOneBy")
      .mockResolvedValue((data.exists === false ? null : key) as never);
    jest
      .spyOn(ApiKeyPermissionService, "findPermissionsByApiKeyId")
      .mockResolvedValue(
        data.permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }) as never,
      );
  }

  test("while the key holds Project Owner, its steps run as one, and the run names the key - no person", async () => {
    givenKey({ permissions: [Permission.ProjectOwner] });
    const readUser: RecordedSpy = jest.spyOn(
      UserService,
      "findOneById",
    ) as unknown as RecordedSpy;
    const { runner, seen, persisted } = prepare(keyedWorkflow());

    await run(runner);

    expect(seen.options?.runAs?.runAs).toBe(WorkflowRunAs.ProjectOwner);
    expect(seen.options?.runAs?.givenByApiKeyId?.toString()).toBe(
      KEY_ID.toString(),
    );
    expect(seen.options?.runAs?.givenByUserId).toBeUndefined();
    expect(readUser.mock.calls).toHaveLength(0);
    expect(writes(persisted)).toContainEqual({
      runAs: WorkflowRunAs.ProjectOwner,
      runAsCustomRoleName: null,
      runAsGivenByUserId: null,
      runAsGivenByApiKeyId: KEY_ID,
      runAsGivenByApiKeyName: "Terraform",
    });
    expect(String(lastWrite(persisted)["logs"])).toContain(
      'Running as Project Owner, with the permissions the API key "Terraform" gave this workflow.',
    );
    expect(lastWrite(persisted)["workflowStatus"]).toBe(WorkflowStatus.Success);
  });

  test("its steps' audit entries say so: what it ran as, and the key's permissions (#9766)", async () => {
    givenKey({ permissions: [Permission.ProjectOwner] });
    const { runner, seen } = prepare(keyedWorkflow());

    await run(runner);

    expect(
      WorkflowPrincipal.getPropsWithoutPlan({
        projectId: PROJECT_ID,
        workflowId: WORKFLOW_ID,
        runAs: seen.options?.runAs,
      }).workflowRunAsAudit,
    ).toEqual({
      runAs: WorkflowRunAs.ProjectOwner,
      givenByApiKeyId: KEY_ID,
      givenByName: "Terraform",
    });
  });

  test("once the key is deleted, it does not run: no step runs, and the run says why", async () => {
    givenKey({ permissions: [Permission.ProjectOwner], exists: false });
    const { runner, seen, persisted } = prepare(keyedWorkflow());

    await run(runner);

    expect(seen.options).toBeUndefined();
    expect(lastWrite(persisted)["workflowStatus"]).toBe(WorkflowStatus.Error);
    expect(String(lastWrite(persisted)["logs"])).toContain(
      "the API key that gave it those permissions was deleted",
    );
  });

  test("once the key has expired, it does not run", async () => {
    givenKey({
      permissions: [Permission.ProjectOwner],
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    const { runner, seen, persisted } = prepare(keyedWorkflow());

    await run(runner);

    expect(seen.options).toBeUndefined();
    expect(String(lastWrite(persisted)["logs"])).toContain(
      'which the API key "Terraform" gave it, and that key has expired',
    );
  });

  test("once the key is narrowed, it does not run", async () => {
    givenKey({ permissions: [Permission.ProjectAdmin] });
    const { runner, seen, persisted } = prepare(keyedWorkflow());

    await run(runner);

    expect(seen.options).toBeUndefined();
    expect(String(lastWrite(persisted)["logs"])).toContain(
      'which the API key "Terraform" gave it, and that key no longer has Project Owner',
    );
  });

  test("a run woken from a Sleep step reads the key again, and does not carry on once it is narrowed", async () => {
    givenKey({ permissions: [Permission.ProjectAdmin] });
    const { runner, seen, persisted } = prepare(keyedWorkflow());

    const asleep: WorkflowLog = new WorkflowLog();
    asleep.logs = "Workflow suspended.";
    asleep.isTestRun = false;
    asleep.resumeData = {
      pendingStack: [NODE.id],
      executedComponents: [],
      componentReturnValues: {},
    };

    jest
      .spyOn(WorkflowLogService, "findOneById")
      .mockResolvedValue(asleep as never);

    await runner.runWorkflow({
      arguments: {},
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      timeout: 5_000,
      isResume: true,
    });

    expect(seen.options).toBeUndefined();
    expect(lastWrite(persisted)["workflowStatus"]).toBe(WorkflowStatus.Error);
    expect(String(lastWrite(persisted)["logs"])).toContain(
      "that key no longer has Project Owner",
    );
  });
});
