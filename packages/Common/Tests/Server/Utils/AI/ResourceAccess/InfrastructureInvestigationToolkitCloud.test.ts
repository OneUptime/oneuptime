import InfrastructureInvestigationToolkit from "../../../../../Server/Utils/AI/ResourceAccess/InfrastructureInvestigationToolkit";
import ResourceCommandJobRunner from "../../../../../Server/Utils/AI/ResourceAccess/ResourceCommandJobRunner";
import CloudLiveRead from "../../../../../Server/Utils/CloudConnection/CloudLiveRead";
import { RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME } from "../../../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import { ObservabilityAssistantExtraTool } from "../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../../Server/Utils/AI/Toolbox/Index";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import AiResourceType from "../../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * An investigation of a cloud account: its live reads (describe,
 * recent-events, target-health, quota-usage, read-logs) run on the server
 * through the account's read-only connection, so the account is offered
 * with no agent; whoami is the agent's own read and asks for one. A change
 * is never run, and what a read returns is cited and fenced as untrusted
 * cloud output like an agent's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RUN_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ACCOUNT_ROW_ID: string = "33333333-3333-4333-8333-333333333333";
const AGENT_ID: string = "77777777-7777-4777-8777-777777777777";
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";

function account(
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ROW_ID,
    resourceName: "prod",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: [],
    agent: null,
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: false,
    ...overrides,
  };
}

function toolkit(
  resources: Array<ResourceAiAccessStatus>,
  overrides: Partial<
    ConstructorParameters<typeof InfrastructureInvestigationToolkit>[0]
  > = {},
): InfrastructureInvestigationToolkit {
  return new InfrastructureInvestigationToolkit({
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    resources,
    ...overrides,
  });
}

function run(
  kit: InfrastructureInvestigationToolkit,
  command: string,
): Promise<ToolCallOutcome> {
  const found: ObservabilityAssistantExtraTool | undefined = kit
    .buildTools()
    .find((candidate: ObservabilityAssistantExtraTool): boolean => {
      return candidate.definition.name === RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME;
    });

  if (!found) {
    throw new Error("no run tool");
  }

  return found.execute({
    resourceId: ACCOUNT_ROW_ID,
    command,
    rationale: "see why the service is failing",
  } as JSONObject);
}

let liveRead: jest.SpyInstance;
let agentJob: jest.SpyInstance;

beforeEach(() => {
  liveRead = jest.spyOn(CloudLiveRead, "run").mockResolvedValue({
    ok: true,
    displayCommand: `cloud describe ${ECS}`,
    output: "ECS service web: desired 2, running 1, pending 1",
    redactionCount: 0,
    isTruncated: false,
  });
  agentJob = jest.spyOn(ResourceCommandJobRunner, "run");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a cloud account in an investigation", () => {
  it("is offered without an agent, since its reads run on the server", () => {
    const kit: InfrastructureInvestigationToolkit = toolkit([account()]);

    expect(kit.getReadyResources()).toHaveLength(1);
  });

  it("is not offered to a remediation round without its agent", () => {
    const kit: InfrastructureInvestigationToolkit = toolkit([account()], {
      readinessCheck: "remediation",
    });

    expect(kit.getReadyResources()).toHaveLength(0);
  });

  it("runs a live read through the account's connection, cited and fenced as cloud output", async () => {
    const kit: InfrastructureInvestigationToolkit = toolkit([account()]);

    const outcome: ToolCallOutcome = await run(kit, `cloud describe ${ECS}`);

    expect(outcome.success).toBe(true);
    expect(liveRead).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      cloudAccountId: new ObjectID(ACCOUNT_ROW_ID),
      command: `cloud describe ${ECS}`,
    });
    expect(agentJob).not.toHaveBeenCalled();
    expect(outcome.textForLlm).toContain(
      '<tool_result source="untrusted_cloud_output">',
    );
    expect(outcome.textForLlm).toContain("desired 2, running 1");
    expect(outcome.result?.citationLabel).toBe(
      `\`cloud describe ${ECS}\` on AWS account "prod"`,
    );
    expect(outcome.result?.rowCount).toBe(1);
    expect(kit.getCommandsRun()).toBe(1);
  });

  it("reports a read that could not run as no evidence, in the read's own words", async () => {
    liveRead.mockResolvedValue({
      ok: false,
      displayCommand: `cloud describe ${ECS}`,
      output: "",
      errorMessage:
        "The connection's role may not call ecs:DescribeServices on this account",
      redactionCount: 0,
      isTruncated: false,
    });
    const kit: InfrastructureInvestigationToolkit = toolkit([account()]);

    const outcome: ToolCallOutcome = await run(kit, `cloud describe ${ECS}`);

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("ecs:DescribeServices");
    expect(outcome.textForLlm).toContain("Nothing from it is evidence.");
    expect(kit.getCommandsRun()).toBe(1);
  });

  it("asks for the agent for whoami when none is connected, naming the reads that need none", async () => {
    const kit: InfrastructureInvestigationToolkit = toolkit([account()]);

    const outcome: ToolCallOutcome = await run(kit, "cloud whoami");

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("no Cloud AI agent is connected");
    expect(outcome.textForLlm).toContain("describe");
    expect(liveRead).not.toHaveBeenCalled();
    expect(agentJob).not.toHaveBeenCalled();
  });

  it("never runs a change, and says how a person can", async () => {
    const kit: InfrastructureInvestigationToolkit = toolkit([account()]);

    const outcome: ToolCallOutcome = await run(
      kit,
      `cloud scale-out ${ECS} --count 4`,
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("read-only investigation");
    expect(liveRead).not.toHaveBeenCalled();
    expect(agentJob).not.toHaveBeenCalled();
  });

  it("counts a live read against the run's command limit", async () => {
    const kit: InfrastructureInvestigationToolkit = toolkit([account()], {
      maxCommands: 1,
    });

    await run(kit, `cloud describe ${ECS}`);
    const second: ToolCallOutcome = await run(kit, `cloud describe ${ECS}`);

    expect(second.success).toBe(false);
    expect(second.textForLlm).toContain(
      "already sent 1 infrastructure commands",
    );
    expect(liveRead).toHaveBeenCalledTimes(1);
    expect(kit.getCommandsRun()).toBe(1);
  });

  it("runs whoami on the account's agent when one is connected", async () => {
    agentJob.mockResolvedValue({
      jobId: ObjectID.generate().toString(),
      succeeded: true,
      exitCode: 0,
      output:
        "[stdout]\narn:aws:sts::123456789012:assumed-role/OneUptimeAiAgentTask/x",
      redactionCount: 0,
      isTruncated: false,
      displayCommand: "cloud whoami",
      executed: true,
      runState: "Ran",
      claimTimedOut: false,
      isAccessFailure: false,
    } as never);
    const kit: InfrastructureInvestigationToolkit = toolkit([
      account({
        agent: {
          agentId: AGENT_ID,
          connectionStatus: "connected",
          isOnline: true,
        },
      }),
    ]);

    const outcome: ToolCallOutcome = await run(kit, "cloud whoami");

    expect(outcome.success).toBe(true);
    expect(agentJob).toHaveBeenCalledTimes(1);
    expect(liveRead).not.toHaveBeenCalled();
  });
});
