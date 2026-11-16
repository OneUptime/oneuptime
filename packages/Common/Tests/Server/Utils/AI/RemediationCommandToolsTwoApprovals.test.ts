import ProjectService from "../../../../Server/Services/ProjectService";
import RemediationCommandToolkit, {
  RemediationCommandNeedingApproval,
  RemediationCommandToolkitOptions,
} from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerService from "../../../../Server/Services/RunnerService";
import logger from "../../../../Server/Utils/Logger";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import GitOpsInspector from "../../../../Server/Utils/AI/Remediation/GitOpsInspector";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * A RISKIER CHANGE NEVER RUNS WITHOUT ASKING WHERE TWO PEOPLE APPROVE ONE
 * (#6421).
 *
 * With Project.requireTwoApprovalsForRiskierFixes on, an unattended round
 * (FullAuto) never runs a kubectl or resource change the policy tiers
 * riskier - not on a cluster or resource that bypasses approvals, not when
 * its allowlist names the change: the change is kept for the round's
 * proposal, with the reason, so two people approve it. A riskier rollback
 * does not qualify either (it would run unattended). Safe changes run on
 * their own as before; Denied stays refused and is never proposed. The rule
 * is read before each change, and a read that fails holds the change.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b000000-0000-4000-8000-000000000001",
);
const RUN_ID: ObjectID = new ObjectID("2b000000-0000-4000-8000-000000000002");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "2b000000-0000-4000-8000-000000000003",
);
const CLUSTER_ID: string = "2b000000-0000-4000-8000-000000000004";
const RUNNER_ID: string = "2b000000-0000-4000-8000-000000000005";
const RESOURCE_ID: string = "2b000000-0000-4000-8000-000000000006";
const AGENT_ID: string = "2b000000-0000-4000-8000-000000000007";
const JOB_ID: ObjectID = new ObjectID("2b000000-0000-4000-8000-000000000008");

const KUBECTL_SAFE: string = "kubectl rollout restart deployment/web -n web";
const KUBECTL_RISKIER: string =
  "kubectl set image deployment/web web=nginx:1.27 -n web";
const KUBECTL_RISKIER_UNDO: string =
  "kubectl set image deployment/web web=nginx:1.26 -n web";
const DOCKER_SAFE: string = "docker restart web";
const DOCKER_RISKIER: string = "docker stop web";

const HELD_REASON: string =
  "it is a riskier change, and this project asks two people to approve one";

function cluster(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID,
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: {
      id: RUNNER_ID,
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
      posture: { inCluster: true, allowWrites: true },
    },
    accessMethod: "in_cluster",
    aiAgent: null,
    automaticInvestigation: { incidents: false, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.BypassApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function resource(
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
    aiCommandAllowlist: [],
    agent: {
      agentId: AGENT_ID,
      connectionStatus: "connected",
      isOnline: true,
      posture: {
        resourceType: AiResourceType.DockerHost,
        resourceIdentifier: "web-1",
        allowWrites: true,
        writeTargets: [],
        protectedTargets: ["oneuptime-ai-agent"],
        reachable: true,
      },
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
    ...overrides,
  };
}

// The project's rule as each read gives it: on unless a test says otherwise.
let isRuleOn: boolean | "unreadable";
let liveCluster: KubernetesClusterAiAccessStatus;
let liveResource: ResourceAiAccessStatus;
let enqueueKubectl: jest.SpyInstance;
let enqueueResource: jest.SpyInstance;
let ruleReads: jest.SpyInstance;

function clusterToolkit(
  target: KubernetesClusterAiAccessStatus = cluster(),
): RemediationCommandToolkit {
  liveCluster = target;

  const options: RemediationCommandToolkitOptions = {
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    suggestionId: SUGGESTION_ID,
    mode: "FullAuto",
    allowlistPatterns: [],
    allowedRunnerIds: [],
    clusterTargets: [target],
    proposesRefusedCommands: true,
  };

  return new RemediationCommandToolkit(options);
}

function resourceToolkit(
  target: ResourceAiAccessStatus = resource(),
): RemediationCommandToolkit {
  liveResource = target;

  return new RemediationCommandToolkit({
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    suggestionId: SUGGESTION_ID,
    mode: "FullAuto",
    allowlistPatterns: [],
    allowedRunnerIds: [],
    clusterTargets: [],
    resourceTargets: [target],
    proposesRefusedCommands: true,
    resourceHold: { anyOrder: false },
  });
}

function execute(
  toolkit: RemediationCommandToolkit,
  args: JSONObject,
): Promise<ToolCallOutcome> {
  const tool: ObservabilityAssistantExtraTool | undefined = toolkit
    .buildTools()
    .find((candidate: ObservabilityAssistantExtraTool) => {
      return candidate.definition.name === "execute_remediation_command";
    });

  if (!tool) {
    throw new Error("execute_remediation_command is not offered.");
  }

  return tool.execute(args);
}

function kubectl(command: string, rollbackCommand?: string): JSONObject {
  return {
    stepType: "Kubectl",
    kubernetesClusterId: CLUSTER_ID,
    command,
    rationale: "web pods are crash-looping after a config change",
    expectedEffect: "fresh pods come up Running",
    ...(rollbackCommand ? { rollbackCommand } : {}),
  } as JSONObject;
}

function docker(command: string): JSONObject {
  return {
    stepType: "ResourceCommand",
    resourceId: RESOURCE_ID,
    command,
    rationale: "the web container is wedged after an OOM",
    expectedEffect: "web serves requests again",
  } as JSONObject;
}

function fakeJob(displayCommand: string): RunnerJob {
  return {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output: "done",
    payload: { displayCommand, program: "docker" },
  } as unknown as RunnerJob;
}

function held(
  toolkit: RemediationCommandToolkit,
): Array<RemediationCommandNeedingApproval> {
  return toolkit.getCommandsNeedingApproval();
}

beforeEach(() => {
  isRuleOn = true;
  jest.spyOn(GitOpsInspector, "inspectCommand").mockResolvedValue(null);
  jest.spyOn(GitOpsInspector, "captureRevertWatch").mockResolvedValue(null);
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });

  ruleReads = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (): Promise<never> => {
      if (isRuleOn === "unreadable") {
        throw new Error("the database is not reachable");
      }

      return { requireTwoApprovalsForRiskierFixes: isRuleOn } as never;
    }) as unknown as jest.SpyInstance;

  jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
    .mockImplementation(async (): Promise<never> => {
      return liveCluster as never;
    });
  jest
    .spyOn(ResourceAiAccessService, "getStatusForResource")
    .mockImplementation(async (): Promise<never> => {
      return liveResource as never;
    });
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({} as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([]);
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
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(RunnerJobService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(RunnerJobService, "findOneById").mockResolvedValue({
    id: JOB_ID,
    claimedAt: new Date(),
    startedAt: new Date(),
  } as unknown as RunnerJob);
  enqueueKubectl = jest
    .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
    .mockImplementation(async (args: unknown): Promise<never> => {
      return fakeJob(String((args as { command: string }).command)) as never;
    }) as unknown as jest.SpyInstance;
  enqueueResource = jest
    .spyOn(RunnerJobService, "enqueueAiResourceCommand")
    .mockImplementation(async (): Promise<never> => {
      return {
        ...fakeJob(DOCKER_SAFE),
        status: RunnerJobStatus.Pending,
      } as never;
    }) as unknown as jest.SpyInstance;
  jest
    .spyOn(RunnerJobService, "pollUntilTerminal")
    .mockImplementation(async (): Promise<never> => {
      return fakeJob(DOCKER_SAFE) as never;
    });
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(undefined as never);
  jest
    .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ResourceAiAccessService, "recordCommandOutcome")
    .mockResolvedValue(undefined);
  jest
    .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
    .mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a kubectl change, where the project asks two people to approve a riskier one", () => {
  it("a riskier change on a cluster that bypasses approvals is not run: it is kept for the proposal, with why", async () => {
    const toolkit: RemediationCommandToolkit = clusterToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectl(KUBECTL_RISKIER),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "this project asks two people to approve one, so it never runs unattended",
    );
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(toolkit.getExecutedCommands()).toHaveLength(0);
    expect(held(toolkit)).toHaveLength(1);
    expect(held(toolkit)[0]!.command.command).toBe(KUBECTL_RISKIER);
    expect(held(toolkit)[0]!.reason).toBe(HELD_REASON);
  });

  it("a riskier change the cluster's allowlist names is not run either", async () => {
    const toolkit: RemediationCommandToolkit = clusterToolkit(
      cluster({
        remediationMode: KubernetesAiRemediationMode.Automatic,
        kubectlAllowlist: ["kubectl set image deployment/web * -n web"],
      }),
    );

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectl(KUBECTL_RISKIER),
    );

    expect(outcome.success).toBe(false);
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(held(toolkit)[0]!.reason).toBe(HELD_REASON);
  });

  it("negative control: with the rule off, the same allowlisted change runs on its own", async () => {
    isRuleOn = false;
    const toolkit: RemediationCommandToolkit = clusterToolkit(
      cluster({
        remediationMode: KubernetesAiRemediationMode.Automatic,
        kubectlAllowlist: ["kubectl set image deployment/web * -n web"],
      }),
    );

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectl(KUBECTL_RISKIER),
    );

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    expect(held(toolkit)).toHaveLength(0);
  });

  it("negative control: with the rule off, a riskier change on a Bypass cluster runs on its own, as before", async () => {
    isRuleOn = false;
    const toolkit: RemediationCommandToolkit = clusterToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectl(KUBECTL_RISKIER),
    );

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
  });

  it("a safe change still runs on its own", async () => {
    const toolkit: RemediationCommandToolkit = clusterToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectl(KUBECTL_SAFE),
    );

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    expect(held(toolkit)).toHaveLength(0);
  });

  it("a safe change with a riskier rollback does not run: the rollback would run unattended, and it is not proposed for that", async () => {
    const toolkit: RemediationCommandToolkit = clusterToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectl(KUBECTL_SAFE, KUBECTL_RISKIER_UNDO),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "The rollbackCommand is a riskier change, and this project asks two people to approve one",
    );
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(held(toolkit)).toHaveLength(0);
  });

  it("a Denied change stays refused, and is never proposed for approval", async () => {
    const toolkit: RemediationCommandToolkit = clusterToolkit(
      cluster({ kubectlAllowlist: ["*"] }),
    );

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectl("kubectl delete namespace web"),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "Denied by the kubectl command policy",
    );
    expect(held(toolkit)).toHaveLength(0);
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });

  it("a rule that cannot be read holds a riskier change: nothing riskier runs unattended on a rule nobody could read", async () => {
    isRuleOn = "unreadable";
    const toolkit: RemediationCommandToolkit = clusterToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      kubectl(KUBECTL_RISKIER),
    );

    expect(outcome.success).toBe(false);
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(held(toolkit)[0]!.reason).toBe(HELD_REASON);
  });

  it("the rule is read before each change: turned on mid-run, it holds the next riskier change", async () => {
    isRuleOn = false;
    const toolkit: RemediationCommandToolkit = clusterToolkit();

    expect((await execute(toolkit, kubectl(KUBECTL_RISKIER))).success).toBe(
      true,
    );

    isRuleOn = true;
    const second: ToolCallOutcome = await execute(
      toolkit,
      kubectl("kubectl set image deployment/api api=api:2.1 -n web"),
    );

    expect(second.success).toBe(false);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    expect(held(toolkit)).toHaveLength(1);
    // Read as OneUptime, the column alone.
    expect(ruleReads).toHaveBeenCalledWith(
      expect.objectContaining({
        id: PROJECT_ID,
        select: { _id: true, requireTwoApprovalsForRiskierFixes: true },
        props: { isRoot: true },
      }),
    );
  });
});

describe("a resource change, where the project asks two people to approve a riskier one", () => {
  it("a riskier change on a resource that bypasses approvals is kept for the proposal, with why", async () => {
    const toolkit: RemediationCommandToolkit = resourceToolkit();

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      docker(DOCKER_RISKIER),
    );

    expect(outcome.success).toBe(false);
    expect(enqueueResource).not.toHaveBeenCalled();
    expect(held(toolkit)).toHaveLength(1);
    expect(held(toolkit)[0]!.reason).toBe(HELD_REASON);
  });

  it("a riskier change the resource's allowlist names is kept too", async () => {
    const toolkit: RemediationCommandToolkit = resourceToolkit(
      resource({
        aiRemediationMode: ResourceAiRemediationMode.Automatic,
        aiCommandAllowlist: [DOCKER_RISKIER],
      }),
    );

    const outcome: ToolCallOutcome = await execute(
      toolkit,
      docker(DOCKER_RISKIER),
    );

    expect(outcome.success).toBe(false);
    expect(enqueueResource).not.toHaveBeenCalled();
    expect(held(toolkit)[0]!.reason).toBe(HELD_REASON);
  });

  it("negative control: with the rule off, the riskier change runs on a Bypass resource", async () => {
    isRuleOn = false;
    const toolkit: RemediationCommandToolkit = resourceToolkit();

    await execute(toolkit, docker(DOCKER_RISKIER));

    expect(enqueueResource).toHaveBeenCalledTimes(1);
    expect(held(toolkit)).toHaveLength(0);
  });

  it("a safe change still runs on its own", async () => {
    const toolkit: RemediationCommandToolkit = resourceToolkit();

    await execute(toolkit, docker(DOCKER_SAFE));

    expect(enqueueResource).toHaveBeenCalledTimes(1);
    expect(held(toolkit)).toHaveLength(0);
  });
});
