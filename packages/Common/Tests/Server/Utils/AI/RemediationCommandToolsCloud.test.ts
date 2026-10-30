import RemediationCommandToolkit, {
  RemediationCommandNeedingApproval,
  RemediationCommandToolkitOptions,
} from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import CloudAiTargets from "../../../../Server/Utils/AI/ResourceAccess/CloudAiTargets";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerService from "../../../../Server/Services/RunnerService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { getCloudAiAgentOwnTargets } from "../../../../Types/ResourceAiAgent/CloudAiAgentNames";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
  ResourceCommandTier,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { formatCloudReplacedValue } from "../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The remediation toolkit on a cloud account's round. Everything a
 * resource round guarantees holds (RemediationCommandToolsResource.test),
 * and three things more:
 *
 * - a change must name a resource of the account's inventory: the model
 *   hears why when it does not, and nothing is enqueued or kept;
 * - a change to a resource declared as code (CloudFormation, Terraform,
 *   Pulumi, ...) is only ever proposed, naming the code, because the next
 *   apply would put the old value back;
 * - the undo is OneUptime's to write: the model's rollbackCommand is not
 *   kept, and a change that ran gets the catalog's inverse with the value
 *   the agent reported it replaced — when that undo may run unattended.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const ACCOUNT_ROW_ID: string = "33333333-3333-4333-8333-333333333333";
const AGENT_ID: string = "44444444-4444-4444-8444-444444444444";
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const SCALE_OUT: string = `cloud scale-out ${ECS} --count 4`;

function account(
  mode: ResourceAiRemediationMode = ResourceAiRemediationMode.BypassApproval,
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ROW_ID,
    resourceName: "prod",
    isAiInvestigationEnabled: true,
    aiRemediationMode: mode,
    aiCommandAllowlist: [],
    agent: {
      agentId: AGENT_ID,
      connectionStatus: "connected",
      isOnline: true,
      posture: {
        resourceType: AiResourceType.AwsAccount,
        resourceIdentifier: "123456789012",
        allowWrites: true,
        writeTargets: [],
        protectedTargets: getCloudAiAgentOwnTargets({
          provider: "aws",
          accountId: "123456789012",
        }),
        reachable: true,
      },
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
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
    resourceTargets: [account()],
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

function cloudArgs(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return {
    stepType: "ResourceCommand",
    resourceId: ACCOUNT_ROW_ID,
    command: SCALE_OUT,
    rationale: "the web service is saturated",
    expectedEffect: "four tasks share the load",
    ...overrides,
  } as JSONObject;
}

function job(output: string): RunnerJob {
  return {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output,
    payload: { displayCommand: SCALE_OUT, program: "cloud" },
  } as unknown as RunnerJob;
}

let enqueue: jest.SpyInstance;
let liveStatus: jest.SpyInstance;
let inventory: jest.SpyInstance;

beforeEach(() => {
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
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(RunnerJobService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  enqueue = jest
    .spyOn(RunnerJobService, "enqueueAiResourceCommand")
    .mockResolvedValue({
      id: JOB_ID,
      _id: JOB_ID.toString(),
      status: RunnerJobStatus.Pending,
    } as unknown as RunnerJob);
  jest
    .spyOn(RunnerJobService, "pollUntilTerminal")
    .mockResolvedValue(
      job(
        `${formatCloudReplacedValue({ count: "2" })}\nECS service web: desired count 2 → 4`,
      ),
    );
  jest.spyOn(RunnerJobService, "findOneById").mockResolvedValue({
    id: JOB_ID,
    claimedAt: new Date(),
    startedAt: new Date(),
  } as unknown as RunnerJob);
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(undefined as never);
  jest
    .spyOn(ResourceAiAccessService, "recordCommandOutcome")
    .mockResolvedValue(undefined);
  jest
    .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
    .mockResolvedValue([]);
  liveStatus = jest
    .spyOn(ResourceAiAccessService, "getStatusForResource")
    .mockResolvedValue(account());
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ id: "resource-lock" } as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([]);
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
  inventory = jest.spyOn(CloudAiTargets, "checkChange").mockResolvedValue({
    refusal: null,
    target: {
      cloudResourceId: ObjectID.generate(),
      name: "web",
      providerResourceId: ECS,
      cloudTags: {},
      managedAsCode: null,
    },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("execute_remediation_command on a cloud account", () => {
  it("runs a change to a resource of the inventory and writes its exact undo from the agent's output", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "execute_remediation_command",
    ).execute(
      // The model's own guess at the undo is not kept.
      cloudArgs({ rollbackCommand: `cloud scale-in ${ECS} --count 1` }),
    );

    expect(outcome.success).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(inventory.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      cloudAccountId: new ObjectID(ACCOUNT_ROW_ID),
      tier: ResourceCommandTier.SafeWrite,
      command: SCALE_OUT,
    });

    const executed: AiRemediationCommand = toolkit.getExecutedCommands()[0]!;
    expect(executed).toMatchObject({
      stepType: RunbookStepType.ResourceCommand,
      resourceType: AiResourceType.AwsAccount,
      runnerNameSnapshot: "Cloud AI agent",
      command: SCALE_OUT,
      resourceCommandTier: ResourceCommandTier.SafeWrite,
      policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
      // The account bypasses approvals, so the riskier undo may run.
      rollbackCommand: `cloud scale-in ${ECS} --count 2`,
    });
    expect(executed.managedAsCode).toBeUndefined();
  });

  it("keeps no undo on an Automatic account, where a scale-in would ask first", async () => {
    liveStatus.mockResolvedValue(account(ResourceAiRemediationMode.Automatic));
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [account(ResourceAiRemediationMode.Automatic)],
    });

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "execute_remediation_command",
    ).execute(cloudArgs());

    expect(outcome.success).toBe(true);
    expect(toolkit.getExecutedCommands()[0]!.rollbackCommand).toBeUndefined();
  });

  it("refuses a change to a resource the inventory does not list, and keeps nothing", async () => {
    inventory.mockResolvedValue({
      refusal: `The resource ${ECS} is not in this AWS account's inventory, so OneUptime AI may not change it.`,
      target: null,
    });
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "execute_remediation_command",
    ).execute(cloudArgs());

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("not in this AWS account's inventory");
    expect(enqueue).not.toHaveBeenCalled();
    expect(toolkit.getCommandsNeedingApproval()).toHaveLength(0);
  });

  it("never runs a change while the inventory cannot be read", async () => {
    inventory.mockRejectedValue(new Error("database down"));
    const toolkit: RemediationCommandToolkit = buildToolkit();

    await expect(
      tool(toolkit, "execute_remediation_command").execute(cloudArgs()),
    ).rejects.toThrow("database down");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("keeps a change to a resource declared as code for a person, naming the code", async () => {
    inventory.mockResolvedValue({
      refusal: null,
      target: {
        cloudResourceId: ObjectID.generate(),
        name: "web",
        providerResourceId: ECS,
        cloudTags: { "aws:cloudformation:stack-name": "web-prod" },
        managedAsCode: 'CloudFormation stack "web-prod"',
      },
    });
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "execute_remediation_command",
    ).execute(cloudArgs());

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      'belongs to CloudFormation stack "web-prod"',
    );
    expect(outcome.textForLlm).toContain("It was NOT executed.");
    expect(enqueue).not.toHaveBeenCalled();

    const keptCommands: Array<RemediationCommandNeedingApproval> =
      toolkit.getCommandsNeedingApproval();
    expect(keptCommands).toHaveLength(1);
    expect(keptCommands[0]!.reason).toContain(
      'the resource belongs to CloudFormation stack "web-prod"',
    );
    expect(keptCommands[0]!.command.managedAsCode).toBe(
      'CloudFormation stack "web-prod"',
    );
  });

  it("never checks the inventory for a change of another resource's round", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      resourceTargets: [
        {
          ...account(),
          resourceType: AiResourceType.DockerHost,
          agent: {
            ...account().agent!,
            posture: {
              ...account().agent!.posture!,
              resourceType: AiResourceType.DockerHost,
              resourceIdentifier: "web-1",
              protectedTargets: ["oneuptime-ai-agent"],
            },
          },
        },
      ],
    });
    liveStatus.mockResolvedValue({
      ...account(),
      resourceType: AiResourceType.DockerHost,
    });

    await tool(toolkit, "execute_remediation_command").execute(
      cloudArgs({ command: "docker restart web" }),
    );

    expect(inventory).not.toHaveBeenCalled();
  });
});

describe("propose_remediation_commands on a cloud account", () => {
  it("records the code that declares a resource on its step, and no rollback the model wrote", async () => {
    inventory.mockResolvedValue({
      refusal: null,
      target: {
        cloudResourceId: ObjectID.generate(),
        name: "web",
        providerResourceId: ECS,
        cloudTags: { "pulumi:project": "web" },
        managedAsCode: "Pulumi",
      },
    });
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "propose_remediation_commands",
    ).execute({
      commands: [
        cloudArgs({ rollbackCommand: `cloud scale-in ${ECS} --count 1` }),
      ],
    } as JSONObject);

    expect(outcome.success).toBe(true);
    const plan: AiRemediationCommandPlan = toolkit.getProposedPlan()!;
    expect(plan.commands[0]).toMatchObject({
      command: SCALE_OUT,
      managedAsCode: "Pulumi",
      policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    });
    expect(plan.commands[0]!.rollbackCommand).toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses a plan whose step names a resource outside the inventory", async () => {
    inventory.mockResolvedValue({
      refusal: `The resource ${ECS} is not in this AWS account's inventory, so OneUptime AI may not change it.`,
      target: null,
    });
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const outcome: ToolCallOutcome = await tool(
      toolkit,
      "propose_remediation_commands",
    ).execute({ commands: [cloudArgs()] } as JSONObject);

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("not in this AWS account's inventory");
    expect(toolkit.getProposedPlan()).toBeNull();
  });
});
