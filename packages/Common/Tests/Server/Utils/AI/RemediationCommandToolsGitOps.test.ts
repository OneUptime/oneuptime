import RemediationCommandToolkit, {
  ROLL_BACK_CHANGE_TOOL_NAME,
  RemediationCommandNeedingApproval,
  RemediationCommandToolkitOptions,
} from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import GitOpsInspector, {
  GitOpsCommandInspection,
} from "../../../../Server/Utils/AI/Remediation/GitOpsInspector";
import ChangeRollback, {
  readKubernetesRollbackTarget,
} from "../../../../Server/Utils/AI/Remediation/ChangeRollback";
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
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  AiRemediationCommandGitOps,
  AiRemediationRevertWatch,
  GitOpsController,
} from "../../../../Types/AutoRemediation/AiRemediationGitOps";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import KubectlPolicy from "../../../../Utils/AiRemediation/KubectlPolicy";
import { RecordedChange } from "../../../../Server/Utils/AI/SRE/RecentChangesContext";
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
 * GitOps in the remediation toolkit. Before a kubectl change runs or is
 * proposed, the toolkit reads who declares its object
 * (GitOpsInspector.inspectCommand) and records it on the command:
 *
 *   - a change Argo CD or Flux puts back never runs on its own, in any
 *     mode — Bypass approval included: it is recorded for one-click
 *     approval as a stopgap, and the model is told why and where the
 *     lasting fix goes;
 *   - a change they do not put back (a rollout restart) runs as before,
 *     and what it did to its object is recorded for verification to watch
 *     (GitOpsInspector.captureRevertWatch);
 *   - a change a Helm release puts back only at its next upgrade runs as
 *     the cluster's mode says, and says it does not last;
 *   - a proposed plan and a rollback-first proposal carry what was read,
 *     and the model is told to say so.
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
const CHANGE_ID: string = "99999999-9999-4999-8999-999999999999";

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
    proposesRefusedCommands: true,
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

function kubectl(command: string): JSONObject {
  return {
    stepType: "Kubectl",
    kubernetesClusterId: CLUSTER_ID.toString(),
    command,
    rationale: "the service needs it",
    expectedEffect: "the service recovers",
  } as JSONObject;
}

function gitOps(
  overrides: Partial<AiRemediationCommandGitOps> = {},
): AiRemediationCommandGitOps {
  return {
    controller: GitOpsController.ArgoCD,
    ownerKind: "Application",
    ownerName: "shop",
    evidence: "annotation argocd.argoproj.io/tracking-id",
    objectKind: "deployment",
    objectName: "web",
    objectNamespace: "web",
    putsBack: true,
    reconcilesOnItsOwn: true,
    summary:
      'Argo CD Application "shop" declares deployment/web (annotation argocd.argoproj.io/tracking-id), and this change edits its replica count: Argo CD puts it back to what git declares: within seconds when the Application has self-heal on, otherwise at its next sync. Treat it as a stopgap - the lasting fix is the same change in git (the manifest, Helm values or Kustomize overlay it is built from).',
    ...overrides,
  };
}

// What GitOpsInspector.inspectCommand found for a command.
function inspection(
  command: string,
  facts: AiRemediationCommandGitOps | undefined,
): GitOpsCommandInspection {
  return {
    watchTarget: {
      target: KubectlPolicy.getNamedObject(
        KubectlPolicy.evaluateCommand(command).args,
      )!,
      namespace: "web",
    },
    before: {
      found: true,
      object: { metadata: { name: "web" }, spec: { replicas: 1 } },
    },
    ...(facts ? { gitOps: facts } : {}),
  };
}

const WATCH: AiRemediationRevertWatch = {
  kind: "deployment",
  name: "web",
  namespace: "web",
  fields: [
    {
      path: "spec.template.metadata.annotations.kubectl.kubernetes.io/restartedAt",
      after: '"2026-10-20T10:00:00Z"',
    },
  ],
  capturedAt: "2026-10-20T10:00:05.000Z",
};

let inspect: SpyInstance<typeof GitOpsInspector.inspectCommand>;
let captureWatch: SpyInstance<typeof GitOpsInspector.captureRevertWatch>;
let enqueueKubectl: SpyInstance<
  typeof RunnerJobService.enqueueAiKubectlCommand
>;
let persistedPlans: Array<JSONObject>;

// The facts the inspector "reads" for each command, by command text.
function declares(
  facts: Record<string, AiRemediationCommandGitOps | undefined>,
): void {
  inspect.mockImplementation(
    async (data: { command: string }): Promise<GitOpsCommandInspection> => {
      return inspection(data.command, facts[data.command]);
    },
  );
}

beforeEach(() => {
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
  const job: RunnerJob = {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output: "deployment.apps/web restarted",
    payload: {
      displayCommand: "kubectl rollout restart deployment/web -n web",
    },
  } as unknown as RunnerJob;
  enqueueKubectl = jest
    .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
    .mockResolvedValue(job);
  jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(job);
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(undefined as never);
  jest
    .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
    .mockResolvedValue(undefined);
  jest
    .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
    .mockResolvedValue([]);
  inspect = jest.spyOn(GitOpsInspector, "inspectCommand");
  declares({});
  captureWatch = jest
    .spyOn(GitOpsInspector, "captureRevertWatch")
    .mockResolvedValue(WATCH);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function execute(
  toolkit: RemediationCommandToolkit,
  command: string,
): Promise<ToolCallOutcome> {
  return getTool(toolkit, "execute_remediation_command").execute(
    kubectl(command),
  );
}

describe("execute_remediation_command on an object Argo CD or Flux declares", () => {
  const SCALE: string = "kubectl scale deployment/web --replicas=3 -n web";

  it("does not run a safe change they put back on an Automatic cluster, and keeps it for approval as a stopgap", async () => {
    declares({ [SCALE]: gitOps() });
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, SCALE);

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(gitOps().summary);
    expect(outcome.textForLlm).toContain(
      'So it was NOT executed: a change Argo CD Application "shop" puts back never runs on its own, in any mode',
    );
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(toolkit.getExecutedCommands()).toEqual([]);

    const kept: Array<RemediationCommandNeedingApproval> =
      toolkit.getCommandsNeedingApproval();
    expect(kept).toHaveLength(1);
    expect(kept[0]!.command.command).toBe(SCALE);
    expect(kept[0]!.command.gitOps).toEqual(gitOps());
    expect(kept[0]!.command.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(kept[0]!.reason).toBe(
      'Argo CD Application "shop" declares deployment/web and puts this change back — a stopgap until the same change is made where it is declared',
    );
  });

  it("does not run it on a cluster that bypasses approvals either", async () => {
    const SET_IMAGE: string =
      "kubectl set image deployment/web app=web:1 -n web";
    declares({
      [SET_IMAGE]: gitOps({
        controller: GitOpsController.Flux,
        ownerKind: "Kustomization",
        ownerName: "apps",
        ownerNamespace: "flux-system",
      }),
    });
    const toolkit: RemediationCommandToolkit = buildToolkit({
      clusterTargets: [
        cluster({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      ],
    });

    const outcome: ToolCallOutcome = await execute(toolkit, SET_IMAGE);

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      'a change Flux Kustomization "apps" (namespace flux-system) puts back never runs on its own, in any mode — Bypass approval and the cluster\'s allowlist included',
    );
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(toolkit.getCommandsNeedingApproval()).toHaveLength(1);
  });

  it("tells the model a change another rule refused would be put back even once approved", async () => {
    const PATCH: string = `kubectl patch deployment/web -n web -p '{"spec":{"replicas":3}}'`;
    declares({ [PATCH]: gitOps() });
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, PATCH);

    // A riskier change on an Automatic cluster: refused for that first.
    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("The command was NOT executed.");
    expect(outcome.textForLlm).not.toContain("So it was NOT executed");
    expect(outcome.textForLlm).toContain(`Note: ${gitOps().summary}`);
    expect(toolkit.getCommandsNeedingApproval()[0]!.command.gitOps).toEqual(
      gitOps(),
    );
  });

  it("runs a change they do not put back, records it, and watches what it did", async () => {
    const RESTART: string = "kubectl rollout restart deployment/web -n web";
    const facts: AiRemediationCommandGitOps = gitOps({
      putsBack: false,
      summary:
        'Argo CD Application "shop" declares deployment/web (annotation argocd.argoproj.io/tracking-id), but this change edits a restart annotation on its pod template, which is not something git declares, so it stays.',
    });
    declares({ [RESTART]: facts });
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, RESTART);

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain(`GitOps: ${facts.summary}`);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    expect(captureWatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        cluster: {
          clusterId: CLUSTER_ID.toString(),
          runnerId: RUNNER_ID.toString(),
          credentialId: undefined,
        },
        stepId: "ai-gitops-1-after",
      }),
    );

    const executed: AiRemediationCommand = toolkit.getExecutedCommands()[0]!;
    expect(executed.gitOps).toEqual(facts);
    expect(executed.revertWatch).toEqual(WATCH);

    // The record that lands carries both.
    const last: JSONObject = persistedPlans[persistedPlans.length - 1]!;
    const stored: JSONObject = (last["commands"] as Array<JSONObject>)[0]!;
    expect(stored["gitOps"]).toEqual(facts);
    expect(stored["revertWatch"]).toEqual(WATCH);
  });

  it("runs a change a Helm release puts back only at its next upgrade, saying so", async () => {
    const facts: AiRemediationCommandGitOps = gitOps({
      controller: GitOpsController.Helm,
      ownerKind: "release",
      ownerName: "web",
      reconcilesOnItsOwn: false,
      summary:
        "Helm release \"web\" declares deployment/web (annotation meta.helm.sh/release-name), and this change edits its replica count: nothing puts it back on its own, but the release's next helm upgrade does. Treat it as a stopgap - the lasting fix is the same change in the release's chart values.",
    });
    declares({ [SCALE]: facts });
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, SCALE);

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain(`GitOps: ${facts.summary}`);
    expect(enqueueKubectl).toHaveBeenCalledTimes(1);
    expect(toolkit.getExecutedCommands()[0]!.gitOps).toEqual(facts);
  });

  it("runs and watches a change on an object nobody was read declaring, exactly as before", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, SCALE);

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).not.toContain("GitOps:");
    expect(toolkit.getExecutedCommands()[0]!.gitOps).toBeUndefined();
    expect(toolkit.getExecutedCommands()[0]!.revertWatch).toEqual(WATCH);
  });

  it("runs a change whose object could not be read: the read never decides", async () => {
    inspect.mockResolvedValue(null);
    captureWatch.mockResolvedValue(null);
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await execute(toolkit, SCALE);

    expect(outcome.success).toBe(true);
    expect(toolkit.getExecutedCommands()[0]!.revertWatch).toBeUndefined();
  });

  it("reads through the cluster's own access target, before the change", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit();

    await execute(toolkit, SCALE);

    expect(inspect).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      cluster: {
        clusterId: CLUSTER_ID.toString(),
        runnerId: RUNNER_ID.toString(),
        credentialId: undefined,
      },
      command: SCALE,
      stepIdPrefix: "ai-gitops-1",
    });
    expect(inspect.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueKubectl.mock.invocationCallOrder[0]!,
    );
  });
});

describe("propose_remediation_commands", () => {
  it("records who declares each change's object, and tells the model to say so", async () => {
    const UNDO: string = "kubectl rollout undo deployment/web -n web";
    const RESTART: string = "kubectl rollout restart deployment/api -n web";
    declares({ [UNDO]: gitOps() });
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "propose_remediation_commands",
    ).execute({ commands: [kubectl(UNDO), kubectl(RESTART)] });

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain(
      `Who declares what these commands change:\n- Command 1: ${gitOps().summary}`,
    );
    expect(outcome.textForLlm).toContain(
      "a change its owner puts back is a stopgap, never the fix",
    );
    expect(
      toolkit
        .getProposedPlan()!
        .commands.map((command: AiRemediationCommand) => {
          return command.gitOps;
        }),
    ).toEqual([gitOps(), undefined]);
    expect(enqueueKubectl).not.toHaveBeenCalled();
  });

  it("says nothing more when nobody declares what the plan changes", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "propose_remediation_commands",
    ).execute({
      commands: [kubectl("kubectl rollout restart deployment/web -n web")],
    });

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).not.toContain("Who declares");
  });
});

describe(`${ROLL_BACK_CHANGE_TOOL_NAME} of a deploy git declares`, () => {
  function rollout(): RecordedChange {
    return {
      id: CHANGE_ID,
      time: new Date("2026-10-19T09:48:00.000Z"),
      eventType: "deployment",
      title: "Rolled out web/web",
      fields: {
        kubernetesClusterId: CLUSTER_ID.toString(),
        kubernetesNamespace: "web",
        kubernetesDeployment: "web",
      },
    };
  }

  beforeEach(() => {
    jest
      .spyOn(ChangeRollback, "resolveKubernetesTarget")
      .mockResolvedValue(readKubernetesRollbackTarget(rollout()));
  });

  it("proposes the undo with who declares it, and says the lasting rollback is in git", async () => {
    declares({ "kubectl rollout undo deployment/web -n web": gitOps() });
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      ROLL_BACK_CHANGE_TOOL_NAME,
    ).execute({ changeId: CHANGE_ID, reason: "Errors began with it." });

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain(`Note: ${gitOps().summary}`);
    expect(outcome.textForLlm).toContain(
      "The lasting rollback is reverting that deploy where it is declared",
    );
    expect(toolkit.getProposedPlan()!.commands[0]!.gitOps).toEqual(gitOps());
  });

  it("does not run the undo on its own on an Automatic cluster: Argo CD would put the bad deploy back", async () => {
    declares({ "kubectl rollout undo deployment/web -n web": gitOps() });
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      ROLL_BACK_CHANGE_TOOL_NAME,
    ).execute({ changeId: CHANGE_ID, reason: "Errors began with it." });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("So it was NOT executed");
    expect(enqueueKubectl).not.toHaveBeenCalled();
    expect(toolkit.getCommandsNeedingApproval()[0]!.command.command).toBe(
      "kubectl rollout undo deployment/web -n web",
    );
  });
});
