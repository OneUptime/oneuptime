import RemediationExecutionRunner, {
  ClusterBreakerState,
  ClusterModeResolution,
  buildClusterFullAutoPersona,
} from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import { MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR } from "../../../../Server/Services/AutoRemediationRuleEngineService";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationExecutionMode from "../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — how a cluster-level RemediationExecution run decides
 * whether its tools may execute (FullAuto) or only propose (Suggest):
 *
 * - FullAuto needs BOTH the suggestion's snapshot (the rule engine wrote
 *   FullAuto for the round) AND an unattended cluster mode (Automatic or
 *   BypassApproval) — a RequireApproval cluster is Suggest even if the
 *   snapshot says FullAuto, and a Suggest snapshot (an Automatic cluster's
 *   follow-up round) is Suggest even on a BypassApproval cluster;
 * - the per-cluster hourly circuit breaker downgrades EVERY unattended
 *   mode to Suggest, BypassApproval included: "never ask" does not extend
 *   to a flap loop running unattended writes — and the downgrade is
 *   reported on the resolution, because the caller has to tell the human
 *   why a promised unattended fix turned into an approval card;
 * - the breaker counts unattended kubectl runs on the cluster however they
 *   were started: cluster-level rounds settled AutoExecuted AND distinct AI
 *   runs (rule-driven included) whose inline `ai-command-*` kubectl jobs
 *   name the cluster — the larger of the two wins;
 * - a failing breaker query fails safe to Suggest, reported as a downgrade;
 * - the FullAuto persona tells a bypass run that riskier changes execute
 *   inline, and an Automatic run that they go to a human — and both keep
 *   the destructive-command refusal.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function cluster(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    runner: {
      id: "44444444-4444-4444-8444-444444444444",
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
      posture: { inCluster: true, allowWrites: true },
    },
    accessMethod: "in_cluster",
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

function suggestion(
  executionMode: AutoRemediationExecutionMode,
): AutoRemediationSuggestion {
  return {
    id: ObjectID.generate(),
    projectId: PROJECT_ID,
    kubernetesClusterId: CLUSTER_ID,
    executionMode,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    status: AutoRemediationSuggestionStatus.Planning,
  } as unknown as AutoRemediationSuggestion;
}

// An inline kubectl job row as the breaker reads it.
function inlineJob(suggestionId: ObjectID): RunnerJob {
  return {
    id: ObjectID.generate(),
    _id: ObjectID.generate().toString(),
    autoRemediationSuggestionId: suggestionId,
  } as unknown as RunnerJob;
}

function inlineJobsFromDistinctRuns(count: number): Array<RunnerJob> {
  const jobs: Array<RunnerJob> = [];
  for (let i: number = 0; i < count; i++) {
    jobs.push(inlineJob(ObjectID.generate()));
  }
  return jobs;
}

const NO_DOWNGRADE: Partial<ClusterModeResolution> = {
  downgradedByCircuitBreaker: false,
  downgradedByModeChange: false,
  breakerCheckFailed: false,
};

describe("RemediationExecutionRunner.resolveClusterMode", () => {
  let countBy: jest.SpyInstance;
  let jobFindBy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    countBy = jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jobFindBy = jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("runs FullAuto on a BypassApproval cluster with breaker headroom, reporting no downgrade", async () => {
    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster(),
      }),
    ).resolves.toEqual({
      mode: "FullAuto",
      autoExecutedInWindow: 0,
      ...NO_DOWNGRADE,
    });

    // Both breaker views are consulted, scoped to this cluster.
    expect(countBy).toHaveBeenCalledTimes(1);
    expect(countBy.mock.calls[0]![0]).toMatchObject({
      query: {
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        status: AutoRemediationSuggestionStatus.AutoExecuted,
      },
    });
    expect(
      (
        countBy.mock.calls[0]![0] as {
          query: { kubernetesClusterId: ObjectID };
        }
      ).query.kubernetesClusterId.toString(),
    ).toBe(CLUSTER_ID.toString());

    expect(jobFindBy).toHaveBeenCalledTimes(1);
    const jobQuery: Record<string, unknown> = (
      jobFindBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(jobQuery["origin"]).toBe(RunnerJobOrigin.AiRemediation);
    expect((jobQuery["kubernetesClusterId"] as ObjectID).toString()).toBe(
      CLUSTER_ID.toString(),
    );
    expect((jobQuery["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(jobQuery["stepId"]).toBeDefined();
    expect(jobQuery["createdAt"]).toBeDefined();
  });

  it("runs FullAuto on an Automatic cluster with breaker headroom", async () => {
    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster({
          remediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      }),
    ).resolves.toMatchObject({ mode: "FullAuto", ...NO_DOWNGRADE });
  });

  it("is Suggest on a RequireApproval cluster whose round asked to ask (Suggest snapshot), without touching the breaker — not a downgrade", async () => {
    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.Suggest),
        cluster: cluster({
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
        }),
      }),
    ).resolves.toEqual({
      mode: "Suggest",
      autoExecutedInWindow: null,
      ...NO_DOWNGRADE,
    });

    expect(countBy).not.toHaveBeenCalled();
    expect(jobFindBy).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    KubernetesAiRemediationMode.RequireApproval,
    KubernetesAiRemediationMode.Disabled,
  ])(
    "reports a FullAuto snapshot on a cluster now in %s as a mode-change downgrade, without touching the breaker",
    async (remediationMode: KubernetesAiRemediationMode) => {
      /*
       * The rule engine announced an unattended fix; the operator then
       * moved the cluster off an unattended mode. The round asks now, and
       * the caller has to correct the row and tell the human why.
       */
      await expect(
        RemediationExecutionRunner.resolveClusterMode({
          suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
          cluster: cluster({ remediationMode }),
        }),
      ).resolves.toEqual({
        mode: "Suggest",
        downgradedByCircuitBreaker: false,
        downgradedByModeChange: true,
        autoExecutedInWindow: null,
        breakerCheckFailed: false,
      });

      expect(countBy).not.toHaveBeenCalled();
      expect(jobFindBy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("no longer runs unattended"),
      );
    },
  );

  it("honours a Suggest snapshot even on a BypassApproval cluster, without touching the breaker", async () => {
    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.Suggest),
        cluster: cluster(),
      }),
    ).resolves.toMatchObject({ mode: "Suggest", ...NO_DOWNGRADE });

    expect(countBy).not.toHaveBeenCalled();
    expect(jobFindBy).not.toHaveBeenCalled();
  });

  it("downgrades a BypassApproval cluster to Suggest once the hourly breaker trips on settled cluster rounds, and says so on the resolution", async () => {
    countBy.mockResolvedValue(
      new PositiveNumber(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR),
    );

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster(),
      }),
    ).resolves.toEqual({
      mode: "Suggest",
      downgradedByCircuitBreaker: true,
      downgradedByModeChange: false,
      autoExecutedInWindow: MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR,
      breakerCheckFailed: false,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("circuit breaker"),
    );
  });

  it("downgrades once enough DISTINCT runs auto-executed kubectl on the cluster — rule-driven runs count too", async () => {
    // No cluster-level round settled, but three rule-driven runs each ran kubectl here.
    jobFindBy.mockResolvedValue(
      inlineJobsFromDistinctRuns(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR),
    );

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster({
          remediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      }),
    ).resolves.toEqual({
      mode: "Suggest",
      downgradedByCircuitBreaker: true,
      downgradedByModeChange: false,
      autoExecutedInWindow: MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR,
      breakerCheckFailed: false,
    });
  });

  it("counts several inline kubectl jobs from ONE run as one unattended fix", async () => {
    const oneRun: ObjectID = ObjectID.generate();
    jobFindBy.mockResolvedValue([
      inlineJob(oneRun),
      inlineJob(oneRun),
      inlineJob(oneRun),
      inlineJob(oneRun),
      inlineJob(oneRun),
    ]);

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster(),
      }),
    ).resolves.toEqual({
      mode: "FullAuto",
      autoExecutedInWindow: 1,
      ...NO_DOWNGRADE,
    });
  });

  it("still allows the run just under the breaker threshold", async () => {
    countBy.mockResolvedValue(
      new PositiveNumber(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR - 1),
    );
    jobFindBy.mockResolvedValue(
      inlineJobsFromDistinctRuns(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR - 1),
    );

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster(),
      }),
    ).resolves.toMatchObject({
      mode: "FullAuto",
      autoExecutedInWindow: MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR - 1,
    });
  });

  it("fails safe to Suggest when the settled-rounds query throws, reporting a failed check", async () => {
    countBy.mockRejectedValue(new Error("db down"));

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster(),
      }),
    ).resolves.toEqual({
      mode: "Suggest",
      downgradedByCircuitBreaker: true,
      downgradedByModeChange: false,
      autoExecutedInWindow: null,
      breakerCheckFailed: true,
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("circuit-breaker check failed"),
    );
  });

  it("fails safe to Suggest when the inline-job query throws", async () => {
    jobFindBy.mockRejectedValue(new Error("db down"));

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster(),
      }),
    ).resolves.toMatchObject({
      mode: "Suggest",
      downgradedByCircuitBreaker: true,
      breakerCheckFailed: true,
    });
  });
});

describe("RemediationExecutionRunner.getClusterBreakerState", () => {
  let countBy: jest.SpyInstance;
  let jobFindBy: jest.SpyInstance;

  beforeEach(() => {
    countBy = jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jobFindBy = jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("takes the larger of the settled-rounds count and the distinct-inline-runs count", async () => {
    countBy.mockResolvedValue(new PositiveNumber(1));
    jobFindBy.mockResolvedValue(inlineJobsFromDistinctRuns(2));

    const state: ClusterBreakerState =
      await RemediationExecutionRunner.getClusterBreakerState({
        clusterId: CLUSTER_ID.toString(),
        projectId: PROJECT_ID,
      });

    expect(state).toEqual({ autoExecutedInWindow: 2, hasHeadroom: true });

    countBy.mockResolvedValue(new PositiveNumber(3));
    jobFindBy.mockResolvedValue(inlineJobsFromDistinctRuns(1));

    await expect(
      RemediationExecutionRunner.getClusterBreakerState({
        clusterId: CLUSTER_ID.toString(),
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({ autoExecutedInWindow: 3, hasHeadroom: false });
  });

  it("has no headroom exactly at the limit and headroom one below it", async () => {
    jobFindBy.mockResolvedValue(
      inlineJobsFromDistinctRuns(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR),
    );
    await expect(
      RemediationExecutionRunner.getClusterBreakerState({
        clusterId: CLUSTER_ID.toString(),
      }),
    ).resolves.toMatchObject({ hasHeadroom: false });

    jobFindBy.mockResolvedValue(
      inlineJobsFromDistinctRuns(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR - 1),
    );
    await expect(
      RemediationExecutionRunner.getClusterBreakerState({
        clusterId: CLUSTER_ID.toString(),
      }),
    ).resolves.toMatchObject({ hasHeadroom: true });
  });

  it("scopes the inline-job read to the project only when a project is known", async () => {
    await RemediationExecutionRunner.getClusterBreakerState({
      clusterId: CLUSTER_ID.toString(),
    });

    const query: Record<string, unknown> = (
      jobFindBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["projectId"]).toBeUndefined();
    expect((query["kubernetesClusterId"] as ObjectID).toString()).toBe(
      CLUSTER_ID.toString(),
    );
  });

  it("propagates a failed read so callers fail safe", async () => {
    jobFindBy.mockRejectedValue(new Error("db down"));

    await expect(
      RemediationExecutionRunner.getClusterBreakerState({
        clusterId: CLUSTER_ID.toString(),
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("db down");
  });
});

describe("buildClusterFullAutoPersona", () => {
  it("tells an Automatic run to hand riskier fixes to a human", () => {
    const persona: string = buildClusterFullAutoPersona({
      bypassApproval: false,
    });

    expect(persona).toContain("turned on Automatic remediation");
    expect(persona).toContain("smallest safe change");
    expect(persona).toContain(
      "only safe kubectl changes (and allowlisted ones) execute inline",
    );
    expect(persona).toContain("need a human");
    expect(persona).toContain("riskier kubectl commands you could not run");
    expect(persona).not.toContain("bypass");
  });

  it("tells a BypassApproval run that riskier fixes execute inline and nobody is asked", () => {
    const persona: string = buildClusterFullAutoPersona({
      bypassApproval: true,
    });

    expect(persona).toContain("chose to bypass approvals entirely");
    expect(persona).toContain("safe AND riskier");
    expect(persona).toContain("nobody is asked");
    expect(persona).toContain("its operator bypassed approvals");
    expect(persona).not.toContain("need a human");
    expect(persona).not.toContain("smallest safe change");
    expect(persona).not.toContain("you could not run");
  });

  it("keeps the destructive-command refusal, the diagnose-first and rollback rules in both", () => {
    for (const bypassApproval of [true, false]) {
      const persona: string = buildClusterFullAutoPersona({ bypassApproval });
      expect(persona).toContain(
        "Destructive commands (deleting namespaces, volumes, nodes, secrets, CRDs; exec; apply; edit) are refused even with approval",
      );
      expect(persona).toContain("Diagnose first with run_kubectl");
      expect(persona).toContain("Always pass a rollbackCommand");
      expect(persona).toContain("**Actions taken**");
    }
  });
});
