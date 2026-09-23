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
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import { KUBECTL_ALWAYS_ASKS_SUMMARY } from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
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
 *   were started: cluster-level rounds settled AutoExecuted, distinct AI
 *   runs (rule-driven included) whose inline `ai-command-*` kubectl jobs
 *   name the cluster, AND unattended rounds still in flight (Planning,
 *   FullAuto) created before this one — runs and in-flight rounds unioned by
 *   suggestion id, the larger total winning. Ordering by creation is what
 *   lets rounds announced together decide among themselves: the earliest
 *   keep their slots, the later ones ask, whichever run starts first;
 * - another round holding the cluster — still running unattended (created
 *   before this one), or its fix still being verified, whatever subject it
 *   is for — downgrades this round, reported as its own reason;
 * - a failing breaker or in-flight query fails safe to Suggest, reported
 *   as a downgrade;
 * - the FullAuto persona tells a bypass run that riskier changes execute
 *   inline, and an Automatic run that they are refused inline and proposed
 *   for approval when the round ends — and on an Automatic cluster it only
 *   ever recommends a SAFE rollback (rollout undo), since a riskier undo is
 *   refused there; both keep the destructive-command refusal.
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
  downgradedByInFlightRound: false,
  inFlightRound: null,
  breakerCheckFailed: false,
};

describe("RemediationExecutionRunner.resolveClusterMode", () => {
  let countBy: jest.SpyInstance;
  let jobFindBy: jest.SpyInstance;
  let suggestionFindBy: jest.SpyInstance;

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
    // No other round in flight on the cluster, none holding it.
    suggestionFindBy = jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([]);
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

    /*
     * Two job reads now: the breaker's inline-job count, then the hold
     * check's read of every AI run's kubectl jobs on the cluster (a
     * rule-driven run that changed it holds it too).
     */
    expect(jobFindBy).toHaveBeenCalledTimes(2);
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
        downgradedByInFlightRound: false,
        inFlightRound: null,
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
      downgradedByInFlightRound: false,
      inFlightRound: null,
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
      downgradedByInFlightRound: false,
      inFlightRound: null,
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
      downgradedByInFlightRound: false,
      inFlightRound: null,
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

  /*
   * In-flight rounds. A round that passed the breaker and is still
   * diagnosing has written nothing yet — no settled row, no inline job — so
   * without counting it every round announced in the same storm reads the
   * same stale count and all of them run unattended.
   */
  it("counts an unattended round still in flight (created before this one) against the breaker: 2 settled + 1 in flight trips it", async () => {
    const mine: AutoRemediationSuggestion = roundCreatedAt(
      new Date(Date.now() - 30 * 1000),
    );
    countBy.mockResolvedValue(new PositiveNumber(2));
    jobFindBy.mockResolvedValue(inlineJobsFromDistinctRuns(2));
    suggestionFindBy.mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        return isInFlightQuery(args)
          ? [roundCreatedAt(new Date(Date.now() - 60 * 1000))]
          : [];
      },
    );

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: mine,
        cluster: cluster(),
      }),
    ).resolves.toEqual({
      mode: "Suggest",
      downgradedByCircuitBreaker: true,
      downgradedByModeChange: false,
      downgradedByInFlightRound: false,
      inFlightRound: null,
      autoExecutedInWindow: MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR,
      breakerCheckFailed: false,
    });
  });

  it("negative control: the same in-flight round created AFTER this one does not count, and this round keeps its unattended slot", async () => {
    const mine: AutoRemediationSuggestion = roundCreatedAt(
      new Date(Date.now() - 60 * 1000),
    );
    countBy.mockResolvedValue(new PositiveNumber(2));
    jobFindBy.mockResolvedValue(inlineJobsFromDistinctRuns(2));
    suggestionFindBy.mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        return isInFlightQuery(args)
          ? [roundCreatedAt(new Date(Date.now() - 30 * 1000))]
          : [];
      },
    );

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: mine,
        cluster: cluster(),
      }),
    ).resolves.toMatchObject({
      mode: "FullAuto",
      autoExecutedInWindow: MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR - 1,
    });
  });

  it("never counts the round against itself", async () => {
    const mine: AutoRemediationSuggestion = roundCreatedAt(new Date());
    jobFindBy.mockResolvedValue([
      ...inlineJobsFromDistinctRuns(2),
      inlineJob(mine.id!),
    ]);
    suggestionFindBy.mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        return isInFlightQuery(args) ? [mine] : [];
      },
    );

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: mine,
        cluster: cluster(),
      }),
    ).resolves.toMatchObject({ mode: "FullAuto", autoExecutedInWindow: 2 });
  });

  it("lets at most one of two rounds announced together take the last slot, whichever run starts first", async () => {
    // Two Planning FullAuto rounds on the cluster, 2 of 3 slots used.
    const early: AutoRemediationSuggestion = roundCreatedAt(
      new Date(Date.now() - 2000),
    );
    const late: AutoRemediationSuggestion = roundCreatedAt(
      new Date(Date.now() - 1000),
    );
    countBy.mockResolvedValue(new PositiveNumber(2));
    jobFindBy.mockResolvedValue(inlineJobsFromDistinctRuns(2));
    suggestionFindBy.mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        return isInFlightQuery(args) ? [early, late] : [];
      },
    );

    const resolutions: Array<ClusterModeResolution> = await Promise.all([
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: late,
        cluster: cluster(),
      }),
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: early,
        cluster: cluster(),
      }),
    ]);

    const unattended: Array<ClusterModeResolution> = resolutions.filter(
      (resolution: ClusterModeResolution) => {
        return resolution.mode === "FullAuto";
      },
    );
    expect(unattended).toHaveLength(1);
    // The earlier round keeps the slot; the later one is the breaker downgrade.
    expect(resolutions[1]!.mode).toBe("FullAuto");
    expect(resolutions[0]!.downgradedByCircuitBreaker).toBe(true);
  });

  /*
   * One unattended round per cluster at a time, whatever the subject: an
   * alert and an incident of one monitor each get their own round on the
   * same cluster.
   */
  it("downgrades a round while another subject's round on the cluster is still being verified — the alert and the incident of one monitor", async () => {
    const holder: AutoRemediationSuggestion = {
      id: ObjectID.generate(),
      _id: ObjectID.generate().toString(),
      status: AutoRemediationSuggestionStatus.AutoExecuted,
      executionMode: AutoRemediationExecutionMode.FullAuto,
      verificationStatus: AutoRemediationVerificationStatus.Pending,
      verificationDeadlineAt: new Date(Date.now() + 10 * 60 * 1000),
      incidentId: ObjectID.generate(),
      ruleNameSnapshot: 'AI remediation for cluster "prod-us"',
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
    } as unknown as AutoRemediationSuggestion;
    suggestionFindBy.mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        return isInFlightQuery(args) ? [] : [holder];
      },
    );

    const resolution: ClusterModeResolution =
      await RemediationExecutionRunner.resolveClusterMode({
        suggestion: roundCreatedAt(new Date()),
        cluster: cluster({
          remediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      });

    expect(resolution.mode).toBe("Suggest");
    expect(resolution.downgradedByInFlightRound).toBe(true);
    expect(resolution.downgradedByCircuitBreaker).toBe(false);
    expect(resolution.inFlightRound?.suggestionId).toBe(holder.id!.toString());
    expect(resolution.inFlightRound?.description).toContain(
      "still being verified",
    );
  });

  it("downgrades a round while an earlier unattended round on the cluster is still running", async () => {
    const earlier: AutoRemediationSuggestion = {
      ...roundCreatedAt(new Date(Date.now() - 60 * 1000)),
      status: AutoRemediationSuggestionStatus.Planning,
      executionMode: AutoRemediationExecutionMode.FullAuto,
      alertId: ObjectID.generate(),
    } as unknown as AutoRemediationSuggestion;
    suggestionFindBy.mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        return isInFlightQuery(args) ? [] : [earlier];
      },
    );

    const resolution: ClusterModeResolution =
      await RemediationExecutionRunner.resolveClusterMode({
        suggestion: roundCreatedAt(new Date()),
        cluster: cluster(),
      });

    expect(resolution.mode).toBe("Suggest");
    expect(resolution.downgradedByInFlightRound).toBe(true);
    expect(resolution.inFlightRound?.description).toContain(
      "still running unattended",
    );
  });

  it("negative control: an unattended round created AFTER this one does not hold the cluster against it; a settled one never does", async () => {
    const later: AutoRemediationSuggestion = {
      ...roundCreatedAt(new Date(Date.now() + 60 * 1000)),
      status: AutoRemediationSuggestionStatus.Planning,
      executionMode: AutoRemediationExecutionMode.FullAuto,
    } as unknown as AutoRemediationSuggestion;
    const verified: AutoRemediationSuggestion = {
      ...roundCreatedAt(new Date(Date.now() - 20 * 60 * 1000)),
      status: AutoRemediationSuggestionStatus.AutoExecuted,
      verificationStatus: AutoRemediationVerificationStatus.Verified,
    } as unknown as AutoRemediationSuggestion;
    suggestionFindBy.mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        return isInFlightQuery(args) ? [] : [later, verified];
      },
    );

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: roundCreatedAt(new Date()),
        cluster: cluster(),
      }),
    ).resolves.toMatchObject({ mode: "FullAuto", ...NO_DOWNGRADE });
  });

  /*
   * A rule-driven FullAuto run carries no cluster id, only its kubectl jobs
   * do. One that changed the cluster holds it against a cluster round of
   * another subject (PR #3953 review, remediation-r2-04), exactly like a
   * cluster round would.
   */
  describe("a rule-driven run that changed the cluster", () => {
    const RULE_RUN_ID: ObjectID = new ObjectID(
      "abababab-abab-4bab-8bab-abababababab",
    );

    function ruleRun(
      overrides: Record<string, unknown> = {},
    ): AutoRemediationSuggestion {
      return {
        id: RULE_RUN_ID,
        _id: RULE_RUN_ID.toString(),
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        executionMode: AutoRemediationExecutionMode.FullAuto,
        verificationStatus: AutoRemediationVerificationStatus.Pending,
        verificationDeadlineAt: new Date(Date.now() + 10 * 60 * 1000),
        incidentId: ObjectID.generate(),
        ruleNameSnapshot: "Restart web on 5xx",
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
        ...overrides,
      } as unknown as AutoRemediationSuggestion;
    }

    function mockRuleRunOnCluster(
      run: AutoRemediationSuggestion,
      stepId: string = "ai-command-1",
    ): void {
      jobFindBy.mockImplementation(
        async (args: unknown): Promise<Array<RunnerJob>> => {
          const query: Record<string, unknown> =
            (args as { query?: Record<string, unknown> }).query || {};
          // The breaker's count reads inline jobs only; the hold read, all.
          if (query["stepId"] && !stepId.startsWith("ai-command-")) {
            return [];
          }
          return [
            {
              ...inlineJob(RULE_RUN_ID),
              stepId,
            } as unknown as RunnerJob,
          ];
        },
      );
      suggestionFindBy.mockImplementation(
        async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
          const query: Record<string, unknown> =
            (args as { query?: Record<string, unknown> }).query || {};
          // Only the read of the runs behind those jobs names ids.
          return query["_id"] ? [run] : [];
        },
      );
    }

    it("downgrades the round while that run's fix is still being verified", async () => {
      mockRuleRunOnCluster(ruleRun());

      const resolution: ClusterModeResolution =
        await RemediationExecutionRunner.resolveClusterMode({
          suggestion: roundCreatedAt(new Date()),
          cluster: cluster({
            remediationMode: KubernetesAiRemediationMode.Automatic,
          }),
        });

      expect(resolution.mode).toBe("Suggest");
      expect(resolution.downgradedByInFlightRound).toBe(true);
      expect(resolution.inFlightRound?.suggestionId).toBe(
        RULE_RUN_ID.toString(),
      );
      expect(resolution.inFlightRound?.description).toContain(
        "still being verified",
      );
    });

    it("downgrades the round while that run is still changing the cluster — even though it was created AFTER this round", async () => {
      mockRuleRunOnCluster(
        ruleRun({
          status: AutoRemediationSuggestionStatus.Planning,
          verificationStatus: undefined,
          verificationDeadlineAt: undefined,
          createdAt: new Date(Date.now() + 60 * 1000),
        }),
      );

      const resolution: ClusterModeResolution =
        await RemediationExecutionRunner.resolveClusterMode({
          suggestion: roundCreatedAt(new Date()),
          cluster: cluster(),
        });

      expect(resolution.mode).toBe("Suggest");
      expect(resolution.inFlightRound?.description).toBe(
        "is still changing it",
      );
    });

    it("holds through an approved plan's kubectl job too", async () => {
      mockRuleRunOnCluster(
        ruleRun({ status: AutoRemediationSuggestionStatus.Approved }),
        "ai-approved-1",
      );

      await expect(
        RemediationExecutionRunner.resolveClusterMode({
          suggestion: roundCreatedAt(new Date()),
          cluster: cluster(),
        }),
      ).resolves.toMatchObject({
        mode: "Suggest",
        downgradedByInFlightRound: true,
      });
    });

    it.each([
      [
        "its fix was verified",
        {
          verificationStatus: AutoRemediationVerificationStatus.Verified,
        },
        "ai-command-1",
      ],
      [
        "its verification deadline passed long ago",
        { verificationDeadlineAt: new Date(Date.now() - 60 * 60 * 1000) },
        "ai-command-1",
      ],
      ["its only job on the cluster is a rollback", {}, "ai-rollback-1"],
    ])(
      "negative control: the round keeps its unattended slot once %s",
      async (
        _label: string,
        overrides: Record<string, unknown>,
        stepId: string,
      ) => {
        mockRuleRunOnCluster(ruleRun(overrides), stepId);

        await expect(
          RemediationExecutionRunner.resolveClusterMode({
            suggestion: roundCreatedAt(new Date()),
            cluster: cluster(),
          }),
        ).resolves.toMatchObject({ mode: "FullAuto", ...NO_DOWNGRADE });
      },
    );

    it("negative control: the round's OWN kubectl jobs never hold the cluster against it", async () => {
      const self: AutoRemediationSuggestion = roundCreatedAt(new Date());
      jobFindBy.mockResolvedValue([
        {
          ...inlineJob(self.id!),
          stepId: "ai-command-1",
        } as unknown as RunnerJob,
      ]);
      suggestionFindBy.mockImplementation(
        async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
          const query: Record<string, unknown> =
            (args as { query?: Record<string, unknown> }).query || {};
          return query["_id"] ? [self] : [];
        },
      );

      await expect(
        RemediationExecutionRunner.resolveClusterMode({
          suggestion: self,
          cluster: cluster(),
        }),
      ).resolves.toMatchObject({ mode: "FullAuto", ...NO_DOWNGRADE });
    });
  });

  it("fails safe to Suggest when the in-flight round check itself fails, with no holder named", async () => {
    suggestionFindBy.mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        if (isInFlightQuery(args)) {
          return [];
        }
        throw new Error("db down");
      },
    );

    const resolution: ClusterModeResolution =
      await RemediationExecutionRunner.resolveClusterMode({
        suggestion: roundCreatedAt(new Date()),
        cluster: cluster(),
      });

    expect(resolution).toMatchObject({
      mode: "Suggest",
      downgradedByInFlightRound: true,
      inFlightRound: null,
      downgradedByCircuitBreaker: false,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("another AI round in flight"),
    );
  });
});

// The breaker's in-flight read: unattended Planning rounds on the cluster.
function isInFlightQuery(args: unknown): boolean {
  const query: Record<string, unknown> =
    (args as { query?: Record<string, unknown> }).query || {};
  return (
    query["status"] === AutoRemediationSuggestionStatus.Planning &&
    query["executionMode"] === AutoRemediationExecutionMode.FullAuto
  );
}

function roundCreatedAt(createdAt: Date): AutoRemediationSuggestion {
  const round: AutoRemediationSuggestion = suggestion(
    AutoRemediationExecutionMode.FullAuto,
  );
  (round as unknown as { createdAt: Date }).createdAt = createdAt;
  return round;
}

describe("RemediationExecutionRunner.getClusterBreakerState", () => {
  let countBy: jest.SpyInstance;
  let jobFindBy: jest.SpyInstance;

  beforeEach(() => {
    countBy = jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jobFindBy = jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
    // No unattended round in flight unless a test says otherwise.
    jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([]);
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

  it("tells a BypassApproval run that riskier fixes execute inline and nobody is asked — except for what needs a human in every mode", () => {
    const persona: string = buildClusterFullAutoPersona({
      bypassApproval: true,
    });

    expect(persona).toContain("chose to bypass approvals entirely");
    expect(persona).toContain("safe AND riskier");
    expect(persona).toContain("nobody is asked");
    expect(persona).toContain("its operator bypassed approvals");
    expect(persona).toContain("also run without a human on this cluster");
    /*
     * Changed with the PR #3953 round-two review: this persona used to say
     * nothing ever needs a human on a Bypass cluster. A protected-namespace
     * write and a node drain or taint always do, so it now says exactly
     * that (and nothing else "needs a human").
     */
    expect(persona).toContain("EXCEPT that");
    expect(persona).toContain(KUBECTL_ALWAYS_ASKS_SUMMARY);
    expect(persona).not.toContain(") need a human");
    expect(persona).not.toContain("smallest safe change");
    expect(persona).not.toContain("you could not run");
  });

  it("keeps the destructive-command refusal, the diagnose-first and rollback rules in both", () => {
    for (const bypassApproval of [true, false]) {
      const persona: string = buildClusterFullAutoPersona({ bypassApproval });
      // The shared wording of the Denied tier (KUBECTL_NEVER_RUNS_SUMMARY).
      expect(persona).toContain(
        "Destructive commands never run, even with approval: exec, cp, port-forward, run, apply, edit, deleting namespaces/volumes/nodes/secrets/CRDs",
      );
      expect(persona).toContain("Diagnose first with run_kubectl");
      expect(persona).toContain("Always pass a rollbackCommand");
      expect(persona).toContain("**Actions taken**");
    }
  });

  it("never recommends a rollback form an Automatic cluster refuses: rollout undo, not set image back", () => {
    const persona: string = buildClusterFullAutoPersona({
      bypassApproval: false,
    });

    /*
     * The planner refuses a RiskyWrite rollback outside Bypass approval
     * (rollbacks run unattended), so recommending `set image` back would
     * steer the model into a refusal and waste a tool call.
     */
    expect(persona).not.toContain("set image back");
    expect(persona).toContain(
      "kubectl rollout undo deployment/<name> -n <namespace>",
    );
    expect(persona).toContain("A rollback must itself be a safe change");
    expect(persona).toContain("undoes a set image/env/resources");
  });

  it("negative control: a Bypass-approval persona does not demand a safe rollback — the rule depends on the mode — and still leads with rollout undo", () => {
    const persona: string = buildClusterFullAutoPersona({
      bypassApproval: true,
    });

    /*
     * The rollback examples are rollout undo first on every cluster (known
     * follow-up 3); a Bypass cluster merely does not refuse a riskier undo.
     */
    expect(persona).toContain(
      "Undo examples: kubectl rollout undo deployment/<name> -n <namespace>",
    );
    expect(persona).not.toContain("A rollback must itself be a safe change");
  });

  it("tells an Automatic run to submit the riskier fix anyway — it is refused, recorded and proposed for one-click approval", () => {
    const persona: string = buildClusterFullAutoPersona({
      bypassApproval: false,
    });

    // Worded to cover what always needs a human too (PR #3953 review).
    expect(persona).toContain(
      "submit the exact kubectl command with execute_remediation_command anyway",
    );
    expect(persona).toContain("It will NOT run");
    expect(persona).toContain("one-click approval");
    expect(persona).toContain("do NOT hunt for a worse safe substitute");
  });
});
