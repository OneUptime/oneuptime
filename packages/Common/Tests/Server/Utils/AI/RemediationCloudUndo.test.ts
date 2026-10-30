import RemediationCommandToolkit from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import CommandPlanExecutor from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { AiRemediationCommandPolicyVerdict } from "../../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
  ResourceCommandTier,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import { formatCloudReplacedValue } from "../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import { getCloudAiAgentOwnTargets } from "../../../../Types/ResourceAiAgent/CloudAiAgentNames";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A cloud change that ran gets its exact undo: the catalog's inverse with
 * the value the Cloud AI agent reported the change replaced — written by
 * OneUptime, never the model's guess — and kept as the change's
 * rollbackCommand only when it may run unattended, as a written rollback
 * must: never one a person always approves, a riskier one only where the
 * account bypasses approvals, and inside the agent's write scope. The
 * inline lane (RemediationCommandToolkit) and the approved lane
 * (CommandPlanExecutor) share the rule.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ACCOUNT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const EC2: string =
  "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc1234def567890";

function status(
  mode: ResourceAiRemediationMode,
  posture: {
    writeTargets?: Array<string>;
    protectedTargets?: Array<string>;
  } = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ID.toString(),
    resourceName: "prod",
    isAiInvestigationEnabled: true,
    aiRemediationMode: mode,
    aiCommandAllowlist: [],
    agent: {
      agentId: ObjectID.generate().toString(),
      connectionStatus: "connected",
      isOnline: true,
      posture: {
        resourceType: AiResourceType.AwsAccount,
        resourceIdentifier: "123456789012",
        allowWrites: true,
        writeTargets: posture.writeTargets || [],
        protectedTargets:
          posture.protectedTargets ||
          getCloudAiAgentOwnTargets({
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

function ran(command: string, output: string): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: ObjectID.generate().toString(),
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ID.toString(),
    resourceNameSnapshot: "prod",
    resourceCommandTier: ResourceCommandTier.SafeWrite,
    command,
    timeoutInMs: 30000,
    rationale: "capacity",
    expectedEffect: "more tasks",
    policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
    execution: {
      status: AiRemediationCommandExecutionStatus.Succeeded,
      output,
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the exact undo of a cloud change", () => {
  test("a safe undo (a start after a stop) is the rollback in every unattended mode", () => {
    for (const mode of [
      ResourceAiRemediationMode.Automatic,
      ResourceAiRemediationMode.BypassApproval,
      ResourceAiRemediationMode.RequireApproval,
    ]) {
      const command: AiRemediationCommand = ran(
        `cloud stop-instance ${EC2}`,
        `${formatCloudReplacedValue({ state: "running" })}\nstopped`,
      );

      RemediationCommandToolkit.applyCloudUndo({
        command,
        resource: status(mode),
      });

      expect(command.rollbackCommand).toBe(`cloud start-instance ${EC2}`);
    }
  });

  test("a riskier undo (a scale-in after a scale-out) is the rollback only where approvals are bypassed", () => {
    const output: string = `${formatCloudReplacedValue({ count: "2" })}\nECS service web: 2 → 4`;
    const automatic: AiRemediationCommand = ran(
      `cloud scale-out ${ECS} --count 4`,
      output,
    );
    const bypass: AiRemediationCommand = ran(
      `cloud scale-out ${ECS} --count 4`,
      output,
    );

    RemediationCommandToolkit.applyCloudUndo({
      command: automatic,
      resource: status(ResourceAiRemediationMode.Automatic),
    });
    RemediationCommandToolkit.applyCloudUndo({
      command: bypass,
      resource: status(ResourceAiRemediationMode.BypassApproval),
    });

    expect(automatic.rollbackCommand).toBeUndefined();
    expect(bypass.rollbackCommand).toBe(`cloud scale-in ${ECS} --count 2`);
  });

  test("an undo a person always approves is never a rollback, whatever the mode", () => {
    // start-instance is undone by stop-instance, which always asks a person.
    const command: AiRemediationCommand = ran(
      `cloud start-instance ${EC2}`,
      `${formatCloudReplacedValue({ state: "stopped" })}\nstarted`,
    );

    RemediationCommandToolkit.applyCloudUndo({
      command,
      resource: status(ResourceAiRemediationMode.BypassApproval),
    });

    expect(command.rollbackCommand).toBeUndefined();
  });

  test("the model's own rollback is replaced, and none is kept when the value is unknown", () => {
    const command: AiRemediationCommand = {
      ...ran(`cloud scale-out ${ECS} --count 4`, "ECS service web: 2 → 4"),
      rollbackCommand: `cloud scale-in ${ECS} --count 1`,
    };

    RemediationCommandToolkit.applyCloudUndo({
      command,
      resource: status(ResourceAiRemediationMode.BypassApproval),
    });

    expect(command.rollbackCommand).toBeUndefined();
  });

  test("a change with nothing to undo has no rollback", () => {
    const command: AiRemediationCommand = ran(
      `cloud restart-service ${ECS}`,
      formatCloudReplacedValue({}),
    );

    RemediationCommandToolkit.applyCloudUndo({
      command,
      resource: status(ResourceAiRemediationMode.BypassApproval),
    });

    expect(command.rollbackCommand).toBeUndefined();
  });

  test("an undo outside the agent's write targets is not kept", () => {
    const command: AiRemediationCommand = ran(
      `cloud scale-out ${ECS} --count 4`,
      `${formatCloudReplacedValue({ count: "2" })}\n`,
    );

    RemediationCommandToolkit.applyCloudUndo({
      command,
      resource: status(ResourceAiRemediationMode.BypassApproval, {
        writeTargets: ["arn:aws:ecs:*:*:service/staging/*"],
      }),
    });

    expect(command.rollbackCommand).toBeUndefined();
  });

  test("another kind of resource is left alone", () => {
    const command: AiRemediationCommand = {
      ...ran("docker stop web", ""),
      resourceType: AiResourceType.DockerHost,
      rollbackCommand: "docker start web",
    };

    RemediationCommandToolkit.applyCloudUndo({
      command,
      resource: {
        ...status(ResourceAiRemediationMode.Automatic),
        resourceType: AiResourceType.DockerHost,
      },
    });

    expect(command.rollbackCommand).toBe("docker start web");
  });
});

describe("an approved cloud change that ran", () => {
  type Attach = (data: {
    suggestion: AutoRemediationSuggestion;
    command: AiRemediationCommand;
  }) => Promise<void>;

  const attach: Attach = (
    CommandPlanExecutor as unknown as { attachCloudUndo: Attach }
  ).attachCloudUndo.bind(CommandPlanExecutor);

  function suggestion(): AutoRemediationSuggestion {
    const model: AutoRemediationSuggestion = new AutoRemediationSuggestion();
    model.id = ObjectID.generate();
    model.projectId = PROJECT_ID;
    return model;
  }

  test("gets its undo under the account's settings as they are now", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockResolvedValue(status(ResourceAiRemediationMode.BypassApproval));

    const command: AiRemediationCommand = ran(
      `cloud scale-out ${ECS} --count 4`,
      `${formatCloudReplacedValue({ count: "3" })}\n`,
    );

    await attach({ suggestion: suggestion(), command });

    expect(command.rollbackCommand).toBe(`cloud scale-in ${ECS} --count 3`);
    expect(read.mock.calls[0]![0].resourceType).toBe(AiResourceType.AwsAccount);
    expect(read.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
  });

  test("gets none when the account's status cannot be read", async () => {
    jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockRejectedValue(new Error("database down"));

    const command: AiRemediationCommand = {
      ...ran(
        `cloud scale-out ${ECS} --count 4`,
        `${formatCloudReplacedValue({ count: "3" })}\n`,
      ),
      rollbackCommand: `cloud scale-in ${ECS} --count 1`,
    };

    await attach({ suggestion: suggestion(), command });

    expect(command.rollbackCommand).toBeUndefined();
  });

  test("another kind of step is left alone, without a read", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ResourceAiAccessService,
      "getStatusForResource",
    );

    const command: AiRemediationCommand = {
      ...ran("kubectl rollout restart deployment/web", ""),
      stepType: RunbookStepType.Kubectl,
      resourceType: undefined,
      rollbackCommand: "kubectl rollout undo deployment/web",
    };

    await attach({ suggestion: suggestion(), command });

    expect(command.rollbackCommand).toBe("kubectl rollout undo deployment/web");
    expect(read).not.toHaveBeenCalled();
  });
});
