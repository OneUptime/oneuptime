import RemediationCommandToolkit, {
  INLINE_COMMAND_STEP_ID_PREFIX,
  RemediationCommandNeedingApproval,
  RemediationCommandToolkitOptions,
} from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import RunnerJobService, {
  MAX_AI_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
  ResourceCommandEnqueueRefusedException,
} from "../../../../Server/Services/RunnerJobService";
import RunnerService from "../../../../Server/Services/RunnerService";
import { MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR } from "../../../../Server/Services/AutoRemediationRuleEngineService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPolicyVerdict,
  MAX_PLAN_COMMANDS,
  RESOURCE_ALWAYS_ASKS_SUMMARY,
  RESOURCE_NEVER_RUNS_SUMMARY,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  MAX_RESOURCE_COMMAND_TIMEOUT_MS,
  ResourceAiAccessStatus,
  ResourceAiAgentPosture,
  ResourceAiRemediationMode,
  ResourceCommandTier,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME } from "../../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import OneUptimeDate from "../../../../Types/Date";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the remediation toolkit on a RESOURCE round (a
 * Docker or Podman host, a Docker Swarm, Proxmox, VMware or Ceph cluster, a
 * database server, a host), mirroring what the kubectl branch guarantees on
 * a cluster round:
 *
 * - the round offers ResourceCommand steps on its resource and nothing else:
 *   no Runner, no cluster, no credential; the schema, the targets list and
 *   the tool descriptions say so, and carry the resource's own write guide;
 * - a read sent through the execute tool is refused and pointed at
 *   run_infrastructure_command (it would count as an executed fix);
 * - Denied never runs; the ladder (evaluateForAutoExecution with the
 *   resource's allowlist, bypass = BypassApproval) decides what runs
 *   unattended, and what a human's click would let run is KEPT for the
 *   round's proposal — riskier changes, what always needs a human, a mode
 *   changed to "ask", a tripped breaker, another round holding the resource;
 * - the resource is re-read LIVE before every change: fixes turned off, not
 *   ready, deleted or reached through another agent revoke it (and drop what
 *   was kept); a failed read refuses without revoking; the live mode and
 *   allowlist decide;
 * - the agent's reported write scope (read-only, protected targets,
 *   ONEUPTIME_AI_WRITE_TARGETS) refuses a change, or its rollback, before it
 *   is composed — never kept;
 * - the run's first change takes a per-resource breaker slot under the
 *   resource's own lock; later changes reuse it;
 * - the command is enqueued through enqueueAiResourceCommand with the
 *   inline step id and the resource's agent, recorded BEFORE and named on
 *   the record before the wait, and read like every resource job: NotRun is
 *   off the record, Unknown stays as "may have run".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const OTHER_SUGGESTION_ID: ObjectID = new ObjectID(
  "79797979-7979-4979-8979-797979797979",
);
const RESOURCE_ID: string = "33333333-3333-4333-8333-333333333333";
const AGENT_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_AGENT_ID: string = "45454545-4545-4545-8545-454545454545";
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const SAFE_WRITE: string = "docker restart web";
const SAFE_UNDO: string = "docker start web";
const RISKY_WRITE: string = "docker stop web";
const READ: string = "docker ps -a";

function posture(
  overrides: Partial<ResourceAiAgentPosture> = {},
): ResourceAiAgentPosture {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "web-1",
    allowWrites: true,
    writeTargets: [],
    protectedTargets: ["oneuptime-ai-agent"],
    reachable: true,
    ...overrides,
  };
}

function resource(
  overrides: Partial<ResourceAiAccessStatus> = {},
  postureOverrides: Partial<ResourceAiAgentPosture> = {},
): ResourceAiAccessStatus {
  const resourceType: AiResourceType =
    overrides.resourceType || AiResourceType.DockerHost;

  return {
    resourceType,
    resourceId: RESOURCE_ID,
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: [],
    agent: {
      agentId: AGENT_ID,
      connectionStatus: "connected",
      isOnline: true,
      posture: posture({ resourceType, ...postureOverrides }),
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
    ...overrides,
  };
}

function buildToolkit(
  overrides: Partial<RemediationCommandToolkitOptions> = {},
): RemediationCommandToolkit {
  return new RemediationCommandToolkit({
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    suggestionId: SUGGESTION_ID,
    mode: "FullAuto",
    allowlistPatterns: [],
    allowedRunnerIds: [],
    clusterTargets: [],
    resourceTargets: [resource()],
    proposesRefusedCommands: true,
    resourceHold: { anyOrder: false },
    ...overrides,
  });
}

function tool(
  toolkit: RemediationCommandToolkit,
  name: string,
): ObservabilityAssistantExtraTool {
  const found: ObservabilityAssistantExtraTool | undefined = toolkit
    .buildTools()
    .find((candidate: ObservabilityAssistantExtraTool) => {
      return candidate.definition.name === name;
    });
  if (!found) {
    throw new Error(`${name} is not offered.`);
  }
  return found;
}

function execute(
  toolkit: RemediationCommandToolkit,
  args: JSONObject,
): Promise<ToolCallOutcome> {
  return tool(toolkit, "execute_remediation_command").execute(args);
}

function resourceArgs(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return {
    stepType: "ResourceCommand",
    resourceId: RESOURCE_ID,
    command: SAFE_WRITE,
    rationale: "the web container is wedged after an OOM",
    expectedEffect: "web serves requests again",
    ...overrides,
  } as JSONObject;
}

function fakeJob(overrides: Partial<Record<string, unknown>> = {}): RunnerJob {
  return {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output: "web",
    payload: { displayCommand: SAFE_WRITE, program: "docker" },
    ...overrides,
  } as unknown as RunnerJob;
}

let enqueue: jest.SpyInstance;
let persist: jest.SpyInstance;
let liveStatus: jest.SpyInstance;
let lock: jest.SpyInstance;
let release: jest.SpyInstance;
let poll: jest.SpyInstance;
let jobCount: jest.SpyInstance;
let suggestionCount: jest.SpyInstance;
let suggestionFindBy: jest.SpyInstance;
let recordOutcome: jest.SpyInstance;
let claimRead: jest.SpyInstance;

function mockHappyPath(): void {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue({
      id: SUGGESTION_ID,
      _id: SUGGESTION_ID.toString(),
      status: AutoRemediationSuggestionStatus.Planning,
    } as unknown as AutoRemediationSuggestion);
  persist = jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jobCount = jest
    .spyOn(RunnerJobService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  enqueue = jest
    .spyOn(RunnerJobService, "enqueueAiResourceCommand")
    .mockResolvedValue(fakeJob({ status: RunnerJobStatus.Pending }));
  poll = jest
    .spyOn(RunnerJobService, "pollUntilTerminal")
    .mockResolvedValue(fakeJob());
  claimRead = jest.spyOn(RunnerJobService, "findOneById").mockResolvedValue({
    id: JOB_ID,
    claimedAt: new Date(),
    startedAt: new Date(),
  } as unknown as RunnerJob);
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(undefined as never);
  recordOutcome = jest
    .spyOn(ResourceAiAccessService, "recordCommandOutcome")
    .mockResolvedValue(undefined);
  jest
    .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
    .mockResolvedValue([]);
  liveStatus = jest
    .spyOn(ResourceAiAccessService, "getStatusForResource")
    .mockResolvedValue(resource());
  lock = jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ id: "resource-lock" } as unknown as SemaphoreMutex);
  release = jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  suggestionCount = jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  suggestionFindBy = jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockResolvedValue([]);
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
}

function expectNothingRanOrRecorded(
  toolkit: RemediationCommandToolkit,
  outcome: ToolCallOutcome,
): void {
  expect(outcome.success).toBe(false);
  expect(enqueue).not.toHaveBeenCalled();
  expect(persist).not.toHaveBeenCalled();
  expect(toolkit.getExecutedCommands()).toHaveLength(0);
}

function kept(
  toolkit: RemediationCommandToolkit,
): Array<RemediationCommandNeedingApproval> {
  return toolkit.getCommandsNeedingApproval();
}

beforeEach(() => {
  mockHappyPath();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the tools a resource round offers", () => {
  it("offers the targets list and the execute tool in FullAuto — ResourceCommand on the resource only", () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    expect(toolkit.isResourceRound()).toBe(true);
    expect(
      toolkit.buildTools().map((candidate: ObservabilityAssistantExtraTool) => {
        return candidate.definition.name;
      }),
    ).toEqual(["list_command_targets", "execute_remediation_command"]);

    const executeTool: ObservabilityAssistantExtraTool = tool(
      toolkit,
      "execute_remediation_command",
    );
    const schema: JSONObject = executeTool.definition.inputSchema as JSONObject;
    const properties: JSONObject = schema["properties"] as JSONObject;

    expect((properties["stepType"] as JSONObject)["enum"]).toEqual([
      "ResourceCommand",
    ]);
    expect(Object.keys(properties).sort()).toEqual(
      [
        "command",
        "expectedEffect",
        "rationale",
        "resourceId",
        "rollbackCommand",
        "stepType",
        "timeoutInMs",
      ].sort(),
    );
    expect(schema["required"]).toContain("resourceId");

    const description: string = executeTool.definition.description;
    expect(description).toContain("stepType ResourceCommand");
    expect(description).toContain(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME);
    expect(description).toContain(RESOURCE_ALWAYS_ASKS_SUMMARY);
    expect(description).toContain(RESOURCE_NEVER_RUNS_SUMMARY);
    expect(description).toContain(
      ResourceCommandPolicy.getWriteCommandGuide(AiResourceType.DockerHost),
    );
    expect(description).toContain(`resourceId: ${RESOURCE_ID}`);
    expect(description).not.toContain("kubectl");

    expect(
      tool(toolkit, "list_command_targets").definition.description,
    ).toContain("the infrastructure resource this round is about");
  });

  it("offers the propose tool in Suggest, with the same ResourceCommand schema and the write guide", () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const proposeTool: ObservabilityAssistantExtraTool = tool(
      toolkit,
      "propose_remediation_commands",
    );
    const items: JSONObject = (
      (proposeTool.definition.inputSchema as JSONObject)[
        "properties"
      ] as JSONObject
    )["commands"] as JSONObject;
    const itemSchema: JSONObject = items["items"] as JSONObject;

    expect(
      ((itemSchema["properties"] as JSONObject)["stepType"] as JSONObject)[
        "enum"
      ],
    ).toEqual(["ResourceCommand"]);
    expect(itemSchema["required"]).toContain("resourceId");
    expect(proposeTool.definition.description).toContain(
      ResourceCommandPolicy.getWriteCommandGuide(AiResourceType.DockerHost),
    );
    expect(proposeTool.definition.description).toContain(
      RESOURCE_NEVER_RUNS_SUMMARY,
    );
  });

  it("a round without resource targets is not a resource round, and its schema is unchanged", () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: undefined,
    });

    expect(toolkit.isResourceRound()).toBe(false);
    const properties: JSONObject = (
      tool(toolkit, "execute_remediation_command").definition
        .inputSchema as JSONObject
    )["properties"] as JSONObject;
    expect((properties["stepType"] as JSONObject)["enum"]).toEqual([
      "Bash",
      "SSH",
      "Kubectl",
    ]);
    expect(properties["resourceId"]).toBeUndefined();
  });

  /*
   * A Kubernetes or rule round never offered ResourceCommand: to it the
   * step type is as unknown as before the resource lane existed, and its
   * refusal lists exactly the step types it offers — the words it always
   * had ("stepType must be one of: Bash, SSH, Kubectl.").
   */
  it("a non-resource round refuses a ResourceCommand step with the original words", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [],
    });

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toBe(
      "stepType must be one of: Bash, SSH, Kubectl.",
    );
    expectNothingRanOrRecorded(toolkit, outcome);
  });

  it("a non-resource round refuses an unknown step type naming only Bash, SSH and Kubectl — never ResourceCommand", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [],
    });

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({ stepType: "kubectl" }),
    );

    expect(outcome.textForLlm).toBe(
      "stepType must be one of: Bash, SSH, Kubectl.",
    );
    expectNothingRanOrRecorded(toolkit, outcome);
  });

  it("a resource round refuses an unknown step type naming only ResourceCommand", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({ stepType: "Docker" }),
    );

    expect(outcome.textForLlm).toBe(
      "stepType must be one of: ResourceCommand.",
    );
    expectNothingRanOrRecorded(toolkit, outcome);
  });
});

describe("list_command_targets on a resource round", () => {
  it("lists the resource, its programs, mode, write scope and allowlist — and no Runner", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [resource({ aiCommandAllowlist: ["docker stop web"] })],
    });

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "list_command_targets",
    ).execute({});

    expect(outcome.success).toBe(true);
    expect(outcome.result?.rowCount).toBe(1);
    expect(outcome.textForLlm).toContain("Resource");
    expect(outcome.textForLlm).toContain(RESOURCE_ID);
    expect(outcome.textForLlm).toContain("ResourceCommand");
    expect(outcome.textForLlm).toContain("its Docker AI agent");
    expect(outcome.textForLlm).toContain("Automatic:");
    expect(outcome.textForLlm).toContain("docker stop web");
    expect(outcome.textForLlm).toContain("oneuptime-ai-agent");
    expect(
      RunnerService.getOnlineAiCommandRunnersForProject,
    ).not.toHaveBeenCalled();
  });

  it("says so when the resource no longer allows remediation", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [resource({ isRemediationReady: false })],
    });

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "list_command_targets",
    ).execute({});

    expect(outcome.result?.rowCount).toBe(0);
    expect(outcome.textForLlm).toContain("no longer allows AI remediation");
  });
});

describe("execute_remediation_command on a resource round", () => {
  it("runs a safe change through the resource chokepoint, recorded before it runs", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({ rollbackCommand: SAFE_UNDO, timeoutInMs: 45000 }),
    );

    expect(outcome.success).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      origin: RunnerJobOrigin.AiRemediation,
      autoRemediationSuggestionId: SUGGESTION_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: new ObjectID(RESOURCE_ID),
      stepId: `${INLINE_COMMAND_STEP_ID_PREFIX}1`,
      targetResourceAiAgentId: new ObjectID(AGENT_ID),
      command: SAFE_WRITE,
      timeoutInMs: 45000,
      claimTimeoutInMs: 60000,
    });

    // The durable record lands before the job exists.
    expect(persist.mock.invocationCallOrder[0]!).toBeLessThan(
      enqueue.mock.invocationCallOrder[0]!,
    );

    const executed: AiRemediationCommand = toolkit.getExecutedCommands()[0]!;
    expect(executed).toMatchObject({
      sequence: 1,
      stepType: RunbookStepType.ResourceCommand,
      runnerId: AGENT_ID,
      runnerNameSnapshot: "Docker AI agent",
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
      resourceNameSnapshot: "web-1",
      resourceCommandTier: ResourceCommandTier.SafeWrite,
      command: SAFE_WRITE,
      rollbackCommand: SAFE_UNDO,
      policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
      wasAutoExecuted: true,
    });
    expect(executed.credentialId).toBeUndefined();
    expect(executed.kubernetesClusterId).toBeUndefined();
    expect(executed.execution).toMatchObject({
      status: AiRemediationCommandExecutionStatus.Succeeded,
      runnerJobId: JOB_ID.toString(),
      exitCode: 0,
    });

    expect(outcome.result?.citationLabel).toBe(
      'Executed on Docker host "web-1": docker restart web',
    );
    expect(outcome.textForLlm).toContain(
      '<tool_result source="untrusted_resource_output">',
    );
    expect(recordOutcome).toHaveBeenCalledWith({
      resourceType: AiResourceType.DockerHost,
      resourceId: new ObjectID(RESOURCE_ID),
      succeeded: true,
      errorMessage: undefined,
    });

    // The job id was on the record before the wait began.
    const recorded: Array<JSONObject> = persist.mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return (call[0] as { data: { commandPlan: JSONObject } }).data
          .commandPlan;
      },
    );
    expect(
      recorded.some((plan: JSONObject): boolean => {
        const commands: Array<JSONObject> = plan[
          "commands"
        ] as Array<JSONObject>;
        return (
          (commands[0]!["execution"] as JSONObject)["runnerJobId"] ===
            JOB_ID.toString() &&
          (commands[0]!["execution"] as JSONObject)["status"] ===
            AiRemediationCommandExecutionStatus.Pending
        );
      }),
    ).toBe(true);
  });

  it("takes the resource's own breaker lock for its first change, releases it once the job exists, and not again for the next change", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    await execute(toolkit, resourceArgs());

    expect(lock).toHaveBeenCalledTimes(1);
    expect(lock.mock.calls[0]![0]).toMatchObject({
      namespace: "AutoRemediationResourceBreaker",
      key: `DockerHost:${RESOURCE_ID}`,
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.invocationCallOrder[0]!).toBeGreaterThan(
      enqueue.mock.invocationCallOrder[0]!,
    );
    expect(release.mock.invocationCallOrder[0]!).toBeLessThan(
      poll.mock.invocationCallOrder[0]!,
    );

    await execute(toolkit, resourceArgs({ command: "docker restart api" }));

    expect(lock).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls[1]![0]).toMatchObject({
      stepId: `${INLINE_COMMAND_STEP_ID_PREFIX}2`,
    });
  });

  it("refuses a read and points at run_infrastructure_command", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({ command: READ }),
    );

    expect(outcome.textForLlm).toContain("is read-only");
    expect(outcome.textForLlm).toContain(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME);
    expectNothingRanOrRecorded(toolkit, outcome);
    expect(kept(toolkit)).toHaveLength(0);
  });

  it.each([
    ["docker exec web sh"],
    ["docker rm -f web"],
    ["docker restart web; rm -rf /"],
    ["sudo docker restart web"],
    ["systemctl restart nginx"],
  ])("refuses a denied command outright: %s", async (command: string) => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({ command }),
    );

    expect(outcome.textForLlm).toContain(
      "Denied by the Docker host command policy",
    );
    expect(outcome.textForLlm).toContain("can never run");
    expectNothingRanOrRecorded(toolkit, outcome);
    expect(kept(toolkit)).toHaveLength(0);
  });

  it("refuses a step that names a credential: the agent never gets one", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({ credentialId: "55555555-5555-4555-8555-555555555555" }),
    );

    expect(outcome.textForLlm).toContain("never carries a credential");
    expectNothingRanOrRecorded(toolkit, outcome);
  });

  it.each([
    ["an unknown resourceId", { resourceId: OTHER_AGENT_ID }],
    ["no resourceId", { resourceId: undefined }],
  ])(
    "refuses %s",
    async (_label: string, overrides: Record<string, unknown>) => {
      const toolkit: RemediationCommandToolkit = buildToolkit();

      const outcome: ToolCallOutcome = await execute(
        toolkit,
        resourceArgs(overrides),
      );

      expect(outcome.textForLlm).toContain("resourceId is required");
      expectNothingRanOrRecorded(toolkit, outcome);
    },
  );

  it("matches the resourceId case-insensitively", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({ resourceId: RESOURCE_ID.toUpperCase() }),
    );

    expect(outcome.success).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it.each([["Bash"], ["SSH"], ["Kubectl"]])(
    "refuses a %s step: a resource round runs resource commands only",
    async (stepType: string) => {
      const toolkit: RemediationCommandToolkit = buildToolkit();

      const outcome: ToolCallOutcome = await execute(
        toolkit,
        resourceArgs({ stepType, runnerId: AGENT_ID }),
      );

      expect(outcome.textForLlm).toContain("use stepType ResourceCommand");
      expectNothingRanOrRecorded(toolkit, outcome);
    },
  );

  it("refuses a riskier change on an Automatic resource and KEEPS it for the proposal", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({ command: RISKY_WRITE, rollbackCommand: SAFE_UNDO }),
    );

    expect(outcome.textForLlm).toContain("The command was NOT executed");
    expect(outcome.textForLlm).toContain(
      "OneUptime AI proposes it for one-click approval",
    );
    expectNothingRanOrRecorded(toolkit, outcome);

    const keptCommands: Array<RemediationCommandNeedingApproval> =
      kept(toolkit);
    expect(keptCommands).toHaveLength(1);
    expect(keptCommands[0]!.reason).toContain("riskier change");
    expect(keptCommands[0]!.command).toMatchObject({
      stepType: RunbookStepType.ResourceCommand,
      command: RISKY_WRITE,
      resourceCommandTier: ResourceCommandTier.RiskyWrite,
      policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
      wasAutoExecuted: false,
    });

    // The same change twice is kept once.
    await execute(
      toolkit,
      resourceArgs({ command: RISKY_WRITE, rollbackCommand: SAFE_UNDO }),
    );
    expect(kept(toolkit)).toHaveLength(1);
  });

  it("runs a riskier change the resource's allowlist names", async () => {
    liveStatus.mockResolvedValue(
      resource({ aiCommandAllowlist: ["docker stop *"] }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [resource({ aiCommandAllowlist: ["docker stop *"] })],
    });

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({ command: RISKY_WRITE }),
    );

    expect(outcome.success).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(toolkit.getExecutedCommands()[0]!.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
  });

  it("uses the LIVE allowlist, not the run's snapshot", async () => {
    liveStatus.mockResolvedValue(
      resource({ aiCommandAllowlist: ["docker stop web"] }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({ command: RISKY_WRITE }),
    );

    expect(outcome.success).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("runs a riskier change on a BypassApproval resource, rollback included", async () => {
    const bypass: ResourceAiAccessStatus = resource({
      aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
    });
    liveStatus.mockResolvedValue(bypass);
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [bypass],
    });

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({
        command: "docker start web",
        rollbackCommand: RISKY_WRITE,
      }),
    );

    expect(outcome.success).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(toolkit.getExecutedCommands()[0]!.rollbackCommand).toBe(RISKY_WRITE);
  });

  it("keeps a change that always needs a human even on a bypassed, allowlisted resource", async () => {
    const host: ResourceAiAccessStatus = resource({
      resourceType: AiResourceType.Host,
      aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
      aiCommandAllowlist: ["kill -TERM 1234"],
    });
    liveStatus.mockResolvedValue(host);
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [host],
    });

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({ command: "kill -TERM 1234" }),
    );

    expect(outcome.textForLlm).toContain("always needs a human, in every mode");
    expectNothingRanOrRecorded(toolkit, outcome);
    expect(kept(toolkit)).toHaveLength(1);
    expect(kept(toolkit)[0]!.reason).toContain("always needs a human");
  });

  it("keeps every change on a resource that asks for approval", async () => {
    const askFirst: ResourceAiAccessStatus = resource({
      aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    });
    liveStatus.mockResolvedValue(askFirst);
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [askFirst],
    });

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain(
      'Docker host "web-1" requires human approval for every change',
    );
    expectNothingRanOrRecorded(toolkit, outcome);
    expect(kept(toolkit)[0]!.reason).toBe(
      'Docker host "web-1" asks for approval of every change',
    );
  });

  it("keeps a change when the operator moved the resource to ask for approval mid-run", async () => {
    liveStatus.mockResolvedValue(
      resource({
        aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
      }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain(
      "was changed to ask for approval during this run",
    );
    expectNothingRanOrRecorded(toolkit, outcome);
    expect(kept(toolkit)[0]!.reason).toContain(
      "was changed to ask for approval during the round",
    );
  });

  /*
   * Automatic runs only a signal's FIRST round unattended. A follow-up that
   * started under Bypass approval must stop running changes once the
   * operator moves the resource to Automatic mid-run — Automatic is still
   * an "unattended" mode, but not for round 2.
   */
  it("keeps a change on a follow-up round when the operator moved the resource from Bypass approval to Automatic mid-run", async () => {
    liveStatus.mockResolvedValue(
      resource({ aiRemediationMode: ResourceAiRemediationMode.Automatic }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [
        resource({
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        }),
      ],
      resourceRoundNumber: 2,
    });

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain(
      "was changed to Automatic during this run, and Automatic asks for approval of every change after a signal's first round (this is round 2)",
    );
    expectNothingRanOrRecorded(toolkit, outcome);
    expect(kept(toolkit)[0]!.reason).toContain(
      "was changed to Automatic during the round",
    );
  });

  it("negative control: the same move on round 1 keeps running safe changes (Automatic runs round 1 unattended)", async () => {
    liveStatus.mockResolvedValue(
      resource({ aiRemediationMode: ResourceAiRemediationMode.Automatic }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [
        resource({
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        }),
      ],
      resourceRoundNumber: 1,
    });

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.success).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("negative control: a follow-up round on a resource still on Bypass approval keeps running", async () => {
    const bypass: ResourceAiAccessStatus = resource({
      aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
    });
    liveStatus.mockResolvedValue(bypass);
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [bypass],
      resourceRoundNumber: 2,
    });

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.success).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "fixes turned off",
      resource({
        isRemediationReady: false,
        aiRemediationMode: ResourceAiRemediationMode.Disabled,
        gaps: [
          {
            code: "remediation_disabled",
            title: "AI fixes are turned off for this Docker host",
            nextStep: "Turn them on.",
            blocksInvestigation: false,
            blocksRemediation: true,
          },
        ],
      }),
      "no longer allows AI remediation (AI fixes are turned off for this Docker host)",
    ],
    [
      "the agent was replaced",
      resource({
        agent: {
          agentId: OTHER_AGENT_ID,
          connectionStatus: "connected",
          isOnline: true,
          posture: posture(),
        },
      }),
      "is no longer reached through the AI agent this run started with",
    ],
    ["the resource was deleted", null, "no longer exists in this project"],
  ])(
    "revokes the resource when %s — and drops what was kept for it",
    async (
      _label: string,
      live: ResourceAiAccessStatus | null,
      expected: string,
    ) => {
      const toolkit: RemediationCommandToolkit = buildToolkit();

      // Kept while the resource still allowed remediation.
      await execute(toolkit, resourceArgs({ command: RISKY_WRITE }));
      expect(kept(toolkit)).toHaveLength(1);

      liveStatus.mockResolvedValue(live);

      const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

      expect(outcome.textForLlm).toContain(expected);
      expect(outcome.textForLlm).toContain(
        "Do NOT run any further command on this Docker host",
      );
      expectNothingRanOrRecorded(toolkit, outcome);
      expect(kept(toolkit)).toHaveLength(0);
      expect(toolkit.getResourceTargets()).toHaveLength(0);
    },
  );

  it("refuses without revoking when the live status cannot be read", async () => {
    liveStatus.mockRejectedValue(new Error("db down"));
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain(
      'Could not confirm that Docker host "web-1" still allows AI remediation',
    );
    expectNothingRanOrRecorded(toolkit, outcome);
    expect(kept(toolkit)).toHaveLength(0);
    expect(toolkit.getResourceTargets()).toHaveLength(1);
  });

  it.each([
    [
      "a protected target",
      { protectedTargets: ["web"] },
      "which the Docker AI agent protects",
    ],
    [
      "a target outside ONEUPTIME_AI_WRITE_TARGETS",
      { writeTargets: ["api*"] },
      "outside the targets the Docker AI agent may change (ONEUPTIME_AI_WRITE_TARGETS=api*)",
    ],
  ])(
    "refuses — never keeps — a change to %s",
    async (
      _label: string,
      postureOverrides: Partial<ResourceAiAgentPosture>,
      expected: string,
    ) => {
      const scoped: ResourceAiAccessStatus = resource({}, postureOverrides);
      liveStatus.mockResolvedValue(scoped);
      const toolkit: RemediationCommandToolkit = buildToolkit({
        resourceTargets: [scoped],
      });

      const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

      expect(outcome.textForLlm).toContain(expected);
      expect(outcome.textForLlm).toContain(
        "The command was neither run nor recorded.",
      );
      expectNothingRanOrRecorded(toolkit, outcome);
      expect(kept(toolkit)).toHaveLength(0);
    },
  );

  it("refuses when the agent's LIVE posture narrowed the write scope mid-run", async () => {
    liveStatus.mockResolvedValue(resource({}, { protectedTargets: ["web"] }));
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain("which the Docker AI agent protects");
    expectNothingRanOrRecorded(toolkit, outcome);
  });

  it("refuses a change whose rollback the agent would refuse", async () => {
    const scoped: ResourceAiAccessStatus = resource(
      {},
      { writeTargets: ["web"] },
    );
    liveStatus.mockResolvedValue(scoped);
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [scoped],
    });

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({ rollbackCommand: "docker start api" }),
    );

    expect(outcome.textForLlm).toContain(
      "The rollbackCommand would be refused when it has to run",
    );
    expectNothingRanOrRecorded(toolkit, outcome);
  });

  it.each([
    [
      "a riskier rollback on an Automatic resource",
      { command: SAFE_UNDO, rollbackCommand: RISKY_WRITE },
      "is a risky change",
    ],
    [
      "a denied rollback",
      { rollbackCommand: "docker rm -f web" },
      "The rollbackCommand is denied",
    ],
  ])(
    "refuses %s",
    async (
      _label: string,
      overrides: Record<string, unknown>,
      expected: string,
    ) => {
      const toolkit: RemediationCommandToolkit = buildToolkit();

      const outcome: ToolCallOutcome = await execute(
        toolkit,
        resourceArgs(overrides),
      );

      expect(outcome.textForLlm).toContain(expected);
      expectNothingRanOrRecorded(toolkit, outcome);
    },
  );

  it("refuses a rollback that always needs a human, even on a bypassed resource", async () => {
    const host: ResourceAiAccessStatus = resource({
      resourceType: AiResourceType.Host,
      aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
    });
    liveStatus.mockResolvedValue(host);
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [host],
    });

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({
        command: "systemctl restart nginx",
        rollbackCommand: "kill -TERM 1234",
      }),
    );

    expect(outcome.textForLlm).toContain("always needs a human");
    expect(outcome.textForLlm).toContain("rollbacks run unattended");
    expectNothingRanOrRecorded(toolkit, outcome);
  });

  it("keeps the change when the resource's hourly breaker has tripped", async () => {
    suggestionCount.mockResolvedValue(
      new PositiveNumber(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain(
      'The hourly circuit breaker for Docker host "web-1" tripped',
    );
    expect(enqueue).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(kept(toolkit)[0]!.reason).toContain("hourly circuit breaker");
  });

  it("keeps the change when the breaker lock cannot be had", async () => {
    lock.mockRejectedValue(new Error("redis down"));
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain(
      'Could not check the hourly limit on unattended AI fixes for Docker host "web-1"',
    );
    expect(enqueue).not.toHaveBeenCalled();
    expect(kept(toolkit)[0]!.reason).toContain("could not be checked");
  });

  it("keeps the change when another round holds the resource", async () => {
    suggestionFindBy.mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;
        // The hold read (the breaker's in-flight read filters on Planning).
        if (typeof query["status"] === "string") {
          return [];
        }
        return [
          {
            id: OTHER_SUGGESTION_ID,
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Pending,
            verificationDeadlineAt: OneUptimeDate.addRemoveMinutes(
              OneUptimeDate.getCurrentDate(),
              5,
            ),
          } as unknown as AutoRemediationSuggestion,
        ];
      },
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain(
      'Another OneUptime AI run on Docker host "web-1" applied a fix that is still being verified',
    );
    expect(enqueue).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(kept(toolkit)[0]!.reason).toContain("another OneUptime AI run");
  });

  it("refuses at the project's hourly limit on infrastructure commands, counted on ResourceCommand rows", async () => {
    jobCount.mockResolvedValue(
      new PositiveNumber(MAX_AI_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain(
      "hourly limit on AI commands on its infrastructure",
    );
    expect(enqueue).not.toHaveBeenCalled();
    expect(
      (jobCount.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toMatchObject({
      projectId: PROJECT_ID,
      origin: RunnerJobOrigin.AiRemediation,
      stepType: RunbookStepType.ResourceCommand,
    });
  });

  it("stops the moment a human dismissed the suggestion", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue({
        id: SUGGESTION_ID,
        status: AutoRemediationSuggestionStatus.Dismissed,
      } as unknown as AutoRemediationSuggestion);
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain("dismissed or already settled");
    expectNothingRanOrRecorded(toolkit, outcome);
  });

  it("clamps the timeout to the resource agent's maximum", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    await execute(toolkit, resourceArgs({ timeoutInMs: 290_000 }));

    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      timeoutInMs: MAX_RESOURCE_COMMAND_TIMEOUT_MS,
    });
  });

  it("takes a command that certainly never ran off the record, and says so", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: undefined,
        output: "",
        errorMessage: "Refused: the agent is read-only.",
      }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      '"docker restart web" did NOT run on Docker host "web-1": Refused: the agent is read-only.',
    );
    expect(outcome.textForLlm).toContain("Nothing changed on the Docker host");
    expect(toolkit.getExecutedCommands()).toHaveLength(0);
    // The job exists: its sequence is never reused.
    await execute(toolkit, resourceArgs());
    expect(enqueue.mock.calls[1]![0]).toMatchObject({
      stepId: `${INLINE_COMMAND_STEP_ID_PREFIX}2`,
    });
  });

  it("tells the model the agent is not picking commands up when none claimed the job", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.TimedOut,
        exitCode: undefined,
        output: "",
        errorMessage: undefined,
      }),
    );
    claimRead.mockResolvedValue({ id: JOB_ID } as unknown as RunnerJob);
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain("its AI agent is not picking them up");
    expect(toolkit.getExecutedCommands()).toHaveLength(0);
  });

  it("a command the chokepoint refused never ran", async () => {
    enqueue.mockRejectedValue(
      new ResourceCommandEnqueueRefusedException(
        "switch_off",
        'AI fixes are turned off for Docker host "web-1", so this command was not enqueued.',
      ),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("did NOT run");
    expect(outcome.textForLlm).toContain("AI fixes are turned off");
    expect(toolkit.getExecutedCommands()).toHaveLength(0);
  });

  it("a command the agent took with no result back stays on the record as 'may have run'", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.TimedOut,
        exitCode: undefined,
        output: "",
        errorMessage: undefined,
      }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      resourceArgs({ rollbackCommand: SAFE_UNDO }),
    );

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain(
      'RESULT UNKNOWN on Docker host "web-1"',
    );
    expect(outcome.textForLlm).toContain(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME);
    expect(outcome.textForLlm).toContain(
      "its rollbackCommand is not run blind",
    );
    expect(outcome.result?.citationLabel).toBe(
      'Sent to Docker host "web-1", result unknown: docker restart web',
    );
    const executed: AiRemediationCommand = toolkit.getExecutedCommands()[0]!;
    expect(executed.execution?.status).toBe(
      AiRemediationCommandExecutionStatus.Failed,
    );
    expect(executed.execution?.runnerJobId).toBe(JOB_ID.toString());
  });

  it("a broken wait after the enqueue is 'may have run' too", async () => {
    poll.mockRejectedValue(new Error("lost the database connection"));
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain("RESULT UNKNOWN");
    expect(outcome.textForLlm).toContain("Waiting for its result failed");
    expect(toolkit.getExecutedCommands()[0]!.execution?.runnerJobId).toBe(
      JOB_ID.toString(),
    );
  });

  it("a program the agent killed at its timeout may have changed the resource", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: undefined,
        output: "",
        errorMessage: "Killed (timeout 30s)",
      }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain("MAY have changed the resource");
    expect(toolkit.getExecutedCommands()).toHaveLength(1);
  });

  it("a change that ran and failed is on the record, and only an access failure becomes the resource's last error", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output: "[stderr]\nError response from daemon: No such container: web",
        errorMessage: "Exit code 1",
      }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("FAILED");
    expect(toolkit.getExecutedCommands()[0]!.execution?.status).toBe(
      AiRemediationCommandExecutionStatus.Failed,
    );
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it(`sends at most the run's command budget`, async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    for (let i: number = 0; i < 5; i++) {
      await execute(toolkit, resourceArgs());
    }

    const outcome: ToolCallOutcome = await execute(toolkit, resourceArgs());

    expect(outcome.textForLlm).toContain("command budget");
    expect(enqueue).toHaveBeenCalledTimes(5);
  });
});

describe("propose_remediation_commands on a resource round", () => {
  function propose(
    toolkit: RemediationCommandToolkit,
    commands: Array<JSONObject>,
  ): Promise<ToolCallOutcome> {
    return tool(toolkit, "propose_remediation_commands").execute({
      commands,
    } as JSONObject);
  }

  it("records a plan of resource commands, every one RequiresApproval, with the resource and the tier", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const outcome: ToolCallOutcome = await propose(toolkit, [
      resourceArgs({ command: RISKY_WRITE, rollbackCommand: SAFE_UNDO }),
      resourceArgs({ command: SAFE_WRITE }),
    ]);

    expect(outcome.success).toBe(true);
    const plan: AiRemediationCommandPlan = toolkit.getProposedPlan()!;
    expect(plan.commands).toHaveLength(2);
    expect(plan.commands[0]).toMatchObject({
      sequence: 1,
      stepType: RunbookStepType.ResourceCommand,
      runnerId: AGENT_ID,
      runnerNameSnapshot: "Docker AI agent",
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
      resourceNameSnapshot: "web-1",
      resourceCommandTier: ResourceCommandTier.RiskyWrite,
      policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
      rollbackCommand: SAFE_UNDO,
    });
    expect(plan.commands[1]!.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    // Nothing is enqueued while planning.
    expect(enqueue).not.toHaveBeenCalled();
    expect(liveStatus).not.toHaveBeenCalled();
  });

  it("refuses the whole plan when a step is a read, denied, credentialed or out of scope", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
      resourceTargets: [resource({}, { protectedTargets: ["api"] })],
    });

    const outcome: ToolCallOutcome = await propose(toolkit, [
      resourceArgs({ command: READ }),
      resourceArgs({ command: "docker exec web sh" }),
      resourceArgs({ credentialId: "55555555-5555-4555-8555-555555555555" }),
      resourceArgs({ command: "docker restart api" }),
      resourceArgs(),
    ]);

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("The plan was NOT recorded");
    expect(outcome.textForLlm).toContain("Command 1:");
    expect(outcome.textForLlm).toContain("is read-only — it is not a fix");
    expect(outcome.textForLlm).toContain("Command 2: Denied");
    expect(outcome.textForLlm).toContain("Command 3: A ResourceCommand never");
    expect(outcome.textForLlm).toContain("Command 4:");
    expect(outcome.textForLlm).toContain("protects");
    expect(outcome.textForLlm).not.toContain("Command 5:");
    expect(toolkit.getProposedPlan()).toBeNull();
  });

  it(`caps a plan at ${MAX_PLAN_COMMANDS} commands`, async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });
    const commands: Array<JSONObject> = [];
    for (let i: number = 0; i <= MAX_PLAN_COMMANDS; i++) {
      commands.push(resourceArgs());
    }

    const outcome: ToolCallOutcome = await propose(toolkit, commands);

    expect(outcome.success).toBe(false);
    expect(toolkit.getProposedPlan()).toBeNull();
  });
});

describe("the resource write scope, as the toolkit reads the agent's posture", () => {
  it("never refuses a read or a denied command (the policy handles the latter)", () => {
    const readOnly: ResourceAiAccessStatus = resource(
      {},
      { allowWrites: false },
    );
    expect(
      RemediationCommandToolkit.getResourceWriteScopeRefusal({
        resource: readOnly,
        command: READ,
      }),
    ).toBeNull();
    expect(
      RemediationCommandToolkit.getResourceWriteScopeRefusal({
        resource: readOnly,
        command: "docker exec web sh",
      }),
    ).toBeNull();
  });

  it("refuses every write of a read-only agent, naming the switch", () => {
    expect(
      RemediationCommandToolkit.getResourceWriteScopeRefusal({
        resource: resource({}, { allowWrites: false }),
        command: SAFE_WRITE,
      }),
    ).toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
  });

  it("refuses every write when the agent reported no posture", () => {
    const status: ResourceAiAccessStatus = resource();
    status.agent!.posture = null;

    expect(
      RemediationCommandToolkit.getResourceWriteScopeRefusal({
        resource: status,
        command: SAFE_WRITE,
      }),
    ).toContain("read-only");
    expect(RemediationCommandToolkit.describeResourceWriteScope(status)).toBe(
      "not reported by the agent yet, so it runs no change",
    );
  });

  it("describes the scope in the words of the agent's settings", () => {
    expect(
      RemediationCommandToolkit.describeResourceWriteScope(
        resource({}, { allowWrites: false }),
      ),
    ).toContain(
      "read-only (ONEUPTIME_AI_ALLOW_WRITES is not true on the agent)",
    );
    expect(
      RemediationCommandToolkit.describeResourceWriteScope(
        resource({}, { writeTargets: ["web*", "api"] }),
      ),
    ).toContain(
      "changes only targets matching ONEUPTIME_AI_WRITE_TARGETS=web*,api",
    );
    expect(
      RemediationCommandToolkit.describeResourceWriteScope(resource()),
    ).toContain("never its protected targets (oneuptime-ai-agent)");
  });

  it("names where the agent's write access is set, for an approval refusal", () => {
    expect(
      RemediationCommandToolkit.getResourceScopeRefusalNextStep(
        AiResourceType.Host,
      ),
    ).toContain("Host AI agent's write access");
  });
});
