import RemediationExecutionRunner, {
  buildClusterFullAutoPersona,
} from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import { MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR } from "../../../../Server/Services/AutoRemediationRuleEngineService";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationExecutionMode from "../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
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
 *   to a flap loop running unattended writes;
 * - a failing breaker query fails safe to Suggest;
 * - the FullAuto persona tells a bypass run that riskier changes execute
 *   inline, and an Automatic run that they go to a human — and both keep
 *   the destructive-command refusal.
 */

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
    kubernetesClusterId: CLUSTER_ID,
    executionMode,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    status: AutoRemediationSuggestionStatus.Planning,
  } as unknown as AutoRemediationSuggestion;
}

describe("RemediationExecutionRunner.resolveClusterMode", () => {
  let countBy: jest.SpyInstance;

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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("runs FullAuto on a BypassApproval cluster with breaker headroom", async () => {
    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster(),
      }),
    ).resolves.toBe("FullAuto");

    expect(countBy).toHaveBeenCalledTimes(1);
    expect(countBy.mock.calls[0]![0]).toMatchObject({
      query: {
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        status: AutoRemediationSuggestionStatus.AutoExecuted,
      },
    });
  });

  it("runs FullAuto on an Automatic cluster with breaker headroom", async () => {
    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster({
          remediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      }),
    ).resolves.toBe("FullAuto");
  });

  it("is Suggest on a RequireApproval cluster whatever the snapshot says, without touching the breaker", async () => {
    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster({
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
        }),
      }),
    ).resolves.toBe("Suggest");

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster({
          remediationMode: KubernetesAiRemediationMode.Disabled,
        }),
      }),
    ).resolves.toBe("Suggest");

    expect(countBy).not.toHaveBeenCalled();
  });

  it("honours a Suggest snapshot even on a BypassApproval cluster", async () => {
    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.Suggest),
        cluster: cluster(),
      }),
    ).resolves.toBe("Suggest");

    expect(countBy).not.toHaveBeenCalled();
  });

  it("downgrades a BypassApproval cluster to Suggest once the hourly breaker trips", async () => {
    countBy.mockResolvedValue(
      new PositiveNumber(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR),
    );

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster(),
      }),
    ).resolves.toBe("Suggest");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("circuit breaker"),
    );
  });

  it("still allows the run just under the breaker threshold", async () => {
    countBy.mockResolvedValue(
      new PositiveNumber(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR - 1),
    );

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster(),
      }),
    ).resolves.toBe("FullAuto");
  });

  it("fails safe to Suggest when the breaker query throws", async () => {
    countBy.mockRejectedValue(new Error("db down"));

    await expect(
      RemediationExecutionRunner.resolveClusterMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        cluster: cluster(),
      }),
    ).resolves.toBe("Suggest");

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("circuit-breaker check failed"),
    );
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
