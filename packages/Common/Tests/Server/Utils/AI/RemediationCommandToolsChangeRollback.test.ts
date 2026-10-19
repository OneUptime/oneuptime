import RemediationCommandToolkit, {
  ROLL_BACK_CHANGE_TOOL_NAME,
  RemediationCommandToolkitOptions,
} from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import ChangeRollback, {
  KubernetesRollbackResolution,
  readKubernetesRollbackTarget,
} from "../../../../Server/Utils/AI/Remediation/ChangeRollback";
import { RecordedChange } from "../../../../Server/Utils/AI/SRE/RecentChangesContext";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerService from "../../../../Server/Services/RunnerService";
import logger from "../../../../Server/Utils/Logger";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPolicyVerdict,
  MAX_PLAN_COMMANDS,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  KubectlCommandTier,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiAccessStatus } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Rollback first, in the remediation round: roll_back_change undoes a
 * Kubernetes rollout OneUptime recorded. The toolkit builds the command
 * from the recorded change (ChangeRollback) - the model only names the
 * change and says why - and then treats it exactly as a kubectl command the
 * model wrote:
 *
 * - offered only on a round that may change a cluster;
 * - Suggest: recorded as the plan's FIRST step, RequiresApproval, kept
 *   first (and not repeated) whatever propose_remediation_commands records
 *   before or after it, and counted toward the plan's size;
 * - FullAuto: run through execute_remediation_command's path - the same
 *   policy, mode, breaker and budget - as a SafeWrite on the cluster's agent;
 * - refused, with nothing recorded, when the change is on a cluster this
 *   round may not change, or when ChangeRollback refuses it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

function cluster(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: {
      id: RUNNER_ID.toString(),
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
    remediationMode: KubernetesAiRemediationMode.Automatic,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/*
 * The cluster AI pages as they stand "now". The toolkit re-reads a
 * cluster's page before every inline kubectl change; by default the page
 * says exactly what the toolkit was built with (nothing changed mid-run).
 */
const liveClusterStatuses: Map<string, KubernetesClusterAiAccessStatus> =
  new Map<string, KubernetesClusterAiAccessStatus>();

function buildToolkit(
  overrides: Partial<RemediationCommandToolkitOptions> = {},
): RemediationCommandToolkit {
  const options: RemediationCommandToolkitOptions = {
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    suggestionId: SUGGESTION_ID,
    mode: "FullAuto",
    allowlistPatterns: [],
    allowedRunnerIds: [],
    clusterTargets: [cluster()],
    ...overrides,
  };

  for (const target of options.clusterTargets || []) {
    liveClusterStatuses.set(target.clusterId, target);
  }

  return new RemediationCommandToolkit(options);
}

function getTool(
  toolkit: RemediationCommandToolkit,
  name: string,
): ObservabilityAssistantExtraTool {
  const tool: ObservabilityAssistantExtraTool | undefined = toolkit
    .buildTools()
    .find((candidate: ObservabilityAssistantExtraTool) => {
      return candidate.definition.name === name;
    });
  if (!tool) {
    throw new Error(`Tool ${name} not offered by this toolkit.`);
  }
  return tool;
}

function fakeJob(overrides: Partial<Record<string, unknown>> = {}): RunnerJob {
  return {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output: "deployment.apps/api rolled back",
    payload: {
      displayCommand: "kubectl rollout undo deployment/api -n web",
    },
    ...overrides,
  } as unknown as RunnerJob;
}

let persistedPlans: Array<JSONObject>;
let enqueueKubectl: SpyInstance<
  typeof RunnerJobService.enqueueAiKubectlCommand
>;

function mockHappyPath(): void {
  persistedPlans = [];
  liveClusterStatuses.clear();
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
    .mockImplementation(
      async (data: {
        clusterId: ObjectID;
      }): Promise<KubernetesClusterAiAccessStatus | null> => {
        return liveClusterStatuses.get(data.clusterId.toString()) || null;
      },
    );
  // The write-time circuit-breaker slot: a lock, and a cluster with headroom.
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({} as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([]);
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue({
      id: SUGGESTION_ID,
      _id: SUGGESTION_ID.toString(),
      status: AutoRemediationSuggestionStatus.Planning,
    } as unknown as AutoRemediationSuggestion);
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      persistedPlans.push(
        (args as { data: { commandPlan: JSONObject } }).data.commandPlan,
      );
      return undefined as never;
    });
  jest
    .spyOn(RunnerJobService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  enqueueKubectl = jest
    .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
    .mockResolvedValue(fakeJob());
  jest.spyOn(RunnerJobService, "enqueueAiCommand");
  jest
    .spyOn(RunnerJobService, "pollUntilTerminal")
    .mockResolvedValue(fakeJob());
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(undefined as never);
  jest
    .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
    .mockResolvedValue(undefined);
  jest
    .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
    .mockResolvedValue([]);
}

const CHANGE_ID: string = "99999999-9999-4999-8999-999999999999";

function recordedRollout(
  overrides: Partial<RecordedChange["fields"]> = {},
): RecordedChange {
  return {
    id: CHANGE_ID,
    time: new Date("2026-10-19T09:48:00.000Z"),
    eventType: "deployment",
    title: "Rolled out web/api",
    fields: {
      kubernetesClusterId: CLUSTER_ID.toString(),
      kubernetesNamespace: "web",
      kubernetesDeployment: "api",
      previousReplicaSet: "api-5b8c2d",
      ...overrides,
    },
  };
}

let resolveTarget: SpyInstance<typeof ChangeRollback.resolveKubernetesTarget>;

function resolvesTo(resolution: KubernetesRollbackResolution): void {
  resolveTarget.mockResolvedValue(resolution);
}

function rollBack(
  toolkit: RemediationCommandToolkit,
  changeId: string = CHANGE_ID,
): Promise<ToolCallOutcome> {
  return getTool(toolkit, ROLL_BACK_CHANGE_TOOL_NAME).execute({
    changeId: ` ${changeId} `,
    reason: "Errors jumped right after this rollout.",
  });
}

function toolNames(toolkit: RemediationCommandToolkit): Array<string> {
  return toolkit.buildTools().map((tool: ObservabilityAssistantExtraTool) => {
    return tool.definition.name;
  });
}

function kubectl(command: string): JSONObject {
  return {
    stepType: "Kubectl",
    kubernetesClusterId: CLUSTER_ID.toString(),
    command,
    rationale: "more replicas for the load",
    expectedEffect: "latency recovers",
  } as JSONObject;
}

beforeEach(() => {
  mockHappyPath();
  resolveTarget = jest.spyOn(ChangeRollback, "resolveKubernetesTarget");
  resolvesTo(readKubernetesRollbackTarget(recordedRollout()));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("roll_back_change is offered", () => {
  it("on a round that may change a cluster, in either mode", () => {
    expect(toolNames(buildToolkit({ mode: "FullAuto" }))).toContain(
      ROLL_BACK_CHANGE_TOOL_NAME,
    );
    expect(toolNames(buildToolkit({ mode: "Suggest" }))).toContain(
      ROLL_BACK_CHANGE_TOOL_NAME,
    );
  });

  it("on no round without a cluster: a host-only rule round, a resource round", () => {
    expect(toolNames(buildToolkit({ clusterTargets: [] }))).not.toContain(
      ROLL_BACK_CHANGE_TOOL_NAME,
    );
    expect(
      toolNames(
        buildToolkit({
          clusterTargets: [],
          resourceTargets: [
            {
              resourceType: AiResourceType.DockerHost,
              resourceId: ObjectID.generate().toString(),
            } as unknown as ResourceAiAccessStatus,
          ],
        }),
      ),
    ).not.toContain(ROLL_BACK_CHANGE_TOOL_NAME);
  });

  it("takes only the change and the reason: the command is not the model's to write", () => {
    const tool: ObservabilityAssistantExtraTool = getTool(
      buildToolkit(),
      ROLL_BACK_CHANGE_TOOL_NAME,
    );
    const schema: JSONObject = tool.definition.inputSchema as JSONObject;

    expect(Object.keys(schema["properties"] as JSONObject)).toEqual([
      "changeId",
      "reason",
    ]);
    expect(schema["required"]).toEqual(["changeId", "reason"]);
  });
});

describe("roll_back_change in a Suggest round", () => {
  it("records the rollback it builds as the plan's first step, for a human's click", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const outcome: ToolCallOutcome = await rollBack(toolkit);

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain(
      'Recorded "kubectl rollout undo deployment/api -n web" as the first step of the plan',
    );
    expect(resolveTarget).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      changeId: CHANGE_ID,
    });
    expect(enqueueKubectl).not.toHaveBeenCalled();

    const plan: AiRemediationCommandPlan | null = toolkit.getProposedPlan();
    expect(plan?.commands).toHaveLength(1);
    const step: AiRemediationCommand = plan!.commands[0]!;
    expect(step.sequence).toBe(1);
    expect(step.stepType).toBe(RunbookStepType.Kubectl);
    expect(step.command).toBe("kubectl rollout undo deployment/api -n web");
    expect(step.kubernetesClusterId).toBe(CLUSTER_ID.toString());
    expect(step.kubectlTier).toBe(KubectlCommandTier.SafeWrite);
    expect(step.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(step.rationale).toBe(
      'Roll back the change OneUptime recorded on Deployment web/api at 2026-10-19T09:48:00.000Z: "Rolled out web/api". Errors jumped right after this rollout.',
    );
    expect(step.expectedEffect).toBe(
      "Deployment web/api runs the ReplicaSet it ran before the change (api-5b8c2d), and the service recovers.",
    );
    expect(step.rollbackCommand).toBeUndefined();
    expect(step.rolledBackChangeId).toBe(CHANGE_ID);
  });

  it("keeps the rollback first when a plan is proposed after it, without repeating it", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    await rollBack(toolkit);
    const proposed: ToolCallOutcome = await getTool(
      toolkit,
      "propose_remediation_commands",
    ).execute({
      commands: [
        kubectl("kubectl rollout undo deployment/api -n web"),
        kubectl("kubectl scale deployment/api --replicas=6 -n web"),
      ],
    });

    expect(proposed.success).toBe(true);
    expect(proposed.textForLlm).toContain(
      `after the rollback recorded with ${ROLL_BACK_CHANGE_TOOL_NAME}`,
    );
    expect(
      toolkit.getProposedPlan()!.commands.map((step: AiRemediationCommand) => {
        return [step.sequence, step.command];
      }),
    ).toEqual([
      [1, "kubectl rollout undo deployment/api -n web"],
      [2, "kubectl scale deployment/api --replicas=6 -n web"],
    ]);
    // Only the rollback OneUptime built says which change it rolls back.
    expect(
      toolkit.getProposedPlan()!.commands.map((step: AiRemediationCommand) => {
        return step.rolledBackChangeId;
      }),
    ).toEqual([CHANGE_ID, undefined]);
  });

  it("puts itself before a plan proposed earlier", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    await getTool(toolkit, "propose_remediation_commands").execute({
      commands: [kubectl("kubectl scale deployment/api --replicas=6 -n web")],
    });
    await rollBack(toolkit);

    expect(
      toolkit.getProposedPlan()!.commands.map((step: AiRemediationCommand) => {
        return [step.sequence, step.command];
      }),
    ).toEqual([
      [1, "kubectl rollout undo deployment/api -n web"],
      [2, "kubectl scale deployment/api --replicas=6 -n web"],
    ]);
  });

  it("counts toward the plan's size", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    await rollBack(toolkit);
    const tooMany: ToolCallOutcome = await getTool(
      toolkit,
      "propose_remediation_commands",
    ).execute({
      commands: Array.from(
        { length: MAX_PLAN_COMMANDS },
        (_value: unknown, index: number) => {
          return kubectl(
            `kubectl scale deployment/api --replicas=${index + 2} -n web`,
          );
        },
      ),
    });

    expect(tooMany.success).toBe(false);
    expect(tooMany.textForLlm).toBe(
      `A plan may contain at most ${MAX_PLAN_COMMANDS} commands, and the rollback you recorded with ${ROLL_BACK_CHANGE_TOOL_NAME} is one of them — trim the rest to ${MAX_PLAN_COMMANDS - 1}.`,
    );
    expect(toolkit.getProposedPlan()!.commands).toHaveLength(1);
  });
});

describe("roll_back_change refuses, recording nothing", () => {
  it("a change rolled out on a cluster this round may not change", async () => {
    const otherCluster: string = ObjectID.generate().toString();
    resolvesTo(
      readKubernetesRollbackTarget(
        recordedRollout({ kubernetesClusterId: otherCluster }),
      ),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const outcome: ToolCallOutcome = await rollBack(toolkit);

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toBe(
      `Nothing was rolled back: the change was rolled out on a cluster this round may not change (kubernetesClusterId ${otherCluster}). Leave the rollback in your recommendations for a human.`,
    );
    expect(toolkit.getProposedPlan()).toBeNull();
  });

  it("a change on a cluster that stopped being remediation-ready", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
      clusterTargets: [cluster({ isRemediationReady: false })],
    });

    expect((await rollBack(toolkit)).success).toBe(false);
    expect(toolkit.getProposedPlan()).toBeNull();
  });

  it("what ChangeRollback refuses, in its words", async () => {
    resolvesTo({ refusal: "This change names no Kubernetes Deployment." });
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "FullAuto",
    });

    const outcome: ToolCallOutcome = await rollBack(toolkit);

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toBe(
      "Nothing was rolled back: This change names no Kubernetes Deployment.",
    );
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(toolkit.getExecutedCommands()).toHaveLength(0);
  });
});

describe("roll_back_change in a FullAuto round", () => {
  it("runs the rollback through the execute path, as a safe change on the cluster's agent", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "FullAuto",
    });

    const outcome: ToolCallOutcome = await rollBack(toolkit);

    expect(outcome.success).toBe(true);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    const enqueued: Record<string, unknown> = enqueueKubectl.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(enqueued["origin"]).toBe(RunnerJobOrigin.AiRemediation);
    expect(enqueued["command"]).toBe(
      "kubectl rollout undo deployment/api -n web",
    );
    expect((enqueued["kubernetesClusterId"] as ObjectID).toString()).toBe(
      CLUSTER_ID.toString(),
    );

    const executed: Array<AiRemediationCommand> = toolkit.getExecutedCommands();
    expect(executed).toHaveLength(1);
    expect(executed[0]!.kubectlTier).toBe(KubectlCommandTier.SafeWrite);
    expect(executed[0]!.rationale).toContain(
      "Roll back the change OneUptime recorded on Deployment web/api",
    );
  });

  it("asks rather than runs on a cluster that requires approval", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "FullAuto",
      clusterTargets: [
        cluster({
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
        }),
      ],
    });

    const outcome: ToolCallOutcome = await rollBack(toolkit);

    expect(outcome.success).toBe(false);
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });
});
