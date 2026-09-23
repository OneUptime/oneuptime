import AutoRemediationRuleEngineService, {
  ClusterRoundHold,
  DEFAULT_VERIFICATION_WINDOW_MINUTES,
  MAX_CLUSTER_REMEDIATION_ROUNDS_PER_SUBJECT,
  MAX_SUGGESTIONS_PER_SUBJECT,
  getClusterRoundNameSnapshot,
  parseClusterRoundNameSnapshot,
} from "../../../Server/Services/AutoRemediationRuleEngineService";
import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunnerJobService from "../../../Server/Services/RunnerJobService";
import AIInvestigationQueue from "../../../Server/Utils/AI/SRE/InvestigationQueue";
import logger from "../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Project from "../../../Models/DatabaseModels/Project";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import AIRunType from "../../../Types/AI/AIRunType";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  KUBECTL_ALWAYS_ASKS_SUMMARY,
  KUBECTL_SAFE_CHANGES_SUMMARY,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

// A node taint always needs a human, in every mode (the canonical comment).
const TAINT_WORD_PATTERN: RegExp = /\btaint\b/;

/*
 * Contract under test — cluster-level remediation in the rule engine, the
 * lane a cluster's AI page turns on without any AutoRemediationRule:
 *
 * - every remediation-ready cluster the signal is about gets ONE Planning
 *   CommandPlan suggestion that carries the cluster id, snapshots the mode
 *   (Automatic → FullAuto with auto-resolve, RequireApproval → Suggest) and
 *   enqueues a RemediationExecution run linked back onto it;
 * - a cluster that is not ready, or already has a round on this subject,
 *   is skipped; the per-subject suggestion cap still applies;
 * - the cluster lane runs BEFORE rules and never depends on a rule
 *   matching; a rule read that returns nothing changes nothing;
 * - a failed access lookup skips the lane quietly;
 * - the follow-up round ("ask again") is Suggest for Automatic and
 *   RequireApproval clusters, FullAuto again for BypassApproval clusters,
 *   and stops at MAX_CLUSTER_REMEDIATION_ROUNDS_PER_SUBJECT for all;
 * - a BypassApproval cluster's rounds do not ask: round 1 and the follow-up
 *   are both FullAuto with auto-resolve, and the feed says approvals are
 *   bypassed — except for what always needs a human;
 * - the feed states exactly what each round does, in the canonical mode
 *   terms: an Automatic round runs safe (and allowlisted) changes on its
 *   own and a riskier change never runs on its own — a round that finds
 *   only riskier fixes proposes exactly those for one-click approval (the
 *   execution runner settles a round that ran nothing but refused riskier
 *   changes as an approval card for exactly those), and after safe fixes
 *   a riskier one is proposed only if verification fails; in both
 *   unattended modes a protected-namespace write, a node drain and a node
 *   taint always need a human, and the round becomes a proposal when the
 *   breaker trips or another unattended round holds the cluster;
 * - at most one UNATTENDED round per cluster at a time, whatever the
 *   subject: a round that would run unattended while another round on the
 *   same cluster is still running or verifying its fix is created asking
 *   first — the alert and the incident of one monitor never both change a
 *   cluster at once. A failed check asks first too;
 * - a follow-up forced to ask (its predecessor's rollback did not complete)
 *   asks first even on a BypassApproval cluster, and says why;
 * - the in-flight round check and the cluster-round name snapshot helpers
 *   classify exactly what they claim to.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const ALERT_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const AI_RUN_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

function readyCluster(
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
    },
    accessMethod: "in_cluster",
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

function fakeIncident(): Incident {
  return {
    id: INCIDENT_ID,
    _id: INCIDENT_ID.toString(),
    projectId: PROJECT_ID,
    title: "Pods stuck in Pending",
    monitors: [],
    labels: [],
  } as unknown as Incident;
}

let createdSuggestions: Array<AutoRemediationSuggestion>;
let suggestionUpdates: Array<Record<string, unknown>>;
let enqueue: jest.SpyInstance;

function mockBaseline(data: {
  existing?: Array<AutoRemediationSuggestion> | undefined;
  statuses?: Array<KubernetesClusterAiAccessStatus> | undefined;
}): void {
  createdSuggestions = [];
  suggestionUpdates = [];

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    enableAi: true,
    enableAutoRemediation: true,
    enableAiCommandExecution: true,
  } as unknown as Project);
  jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockResolvedValue(data.existing || []);
  jest
    .spyOn(AutoRemediationSuggestionService, "create")
    .mockImplementation(
      async (args: unknown): Promise<AutoRemediationSuggestion> => {
        const suggestion: AutoRemediationSuggestion = (
          args as { data: AutoRemediationSuggestion }
        ).data;
        suggestion.id = SUGGESTION_ID;
        createdSuggestions.push(suggestion);
        return suggestion;
      },
    );
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      suggestionUpdates.push((args as { data: Record<string, unknown> }).data);
      return undefined as never;
    });
  jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
    .mockResolvedValue(data.statuses || [readyCluster()]);
  enqueue = jest
    .spyOn(AIInvestigationQueue, "enqueue")
    .mockResolvedValue(AI_RUN_ID);
  jest.spyOn(AutoRemediationRuleService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockResolvedValue(undefined as never);
  /*
   * The in-flight check also reads the AI kubectl jobs on the cluster (a
   * rule-driven run that changed it holds it too): none unless a test
   * says otherwise.
   */
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
}

describe("AutoRemediationRuleEngineService cluster-level remediation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("starts a FullAuto command run for an Automatic cluster with no rule involved", async () => {
    mockBaseline({});

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(1);
    const suggestion: AutoRemediationSuggestion = createdSuggestions[0]!;
    expect(suggestion.kubernetesClusterId?.toString()).toBe(
      CLUSTER_ID.toString(),
    );
    expect(suggestion.autoRemediationRuleId).toBeUndefined();
    expect(suggestion.status).toBe(AutoRemediationSuggestionStatus.Planning);
    expect(suggestion.suggestionType).toBe(
      AutoRemediationSuggestionType.CommandPlan,
    );
    expect(suggestion.executionMode).toBe(
      AutoRemediationExecutionMode.FullAuto,
    );
    expect(suggestion.autoResolveOnRecovery).toBe(true);
    expect(suggestion.verificationWindowMinutes).toBe(
      DEFAULT_VERIFICATION_WINDOW_MINUTES,
    );
    expect(suggestion.ruleNameSnapshot).toBe(
      'AI remediation for cluster "prod-us"',
    );
    expect(suggestion.incidentId?.toString()).toBe(INCIDENT_ID.toString());

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
      subjectAutoRemediationSuggestionId: SUGGESTION_ID,
      remediationRunType: AIRunType.RemediationExecution,
    });
    expect(suggestionUpdates).toContainEqual({ aiRunId: AI_RUN_ID });
    expect(IncidentFeedService.createIncidentFeedItem).toHaveBeenCalledTimes(1);
  });

  it("starts a Suggest run without auto-resolve for a RequireApproval cluster, on an alert", async () => {
    mockBaseline({
      statuses: [
        readyCluster({
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
        }),
      ],
    });

    await AutoRemediationRuleEngineService.applyRulesToAlert({
      id: ALERT_ID,
      _id: ALERT_ID.toString(),
      projectId: PROJECT_ID,
      title: "Pods stuck in Pending",
    } as unknown as Alert);

    expect(createdSuggestions).toHaveLength(1);
    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.Suggest,
    );
    expect(createdSuggestions[0]!.autoResolveOnRecovery).toBe(false);
    expect(createdSuggestions[0]!.alertId?.toString()).toBe(
      ALERT_ID.toString(),
    );
    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      subjectAlertId: ALERT_ID,
    });
    expect(AlertFeedService.createAlertFeedItem).toHaveBeenCalledTimes(1);
  });

  it("starts a FullAuto run with auto-resolve for a BypassApproval cluster and says approvals are bypassed", async () => {
    mockBaseline({
      statuses: [
        readyCluster({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      ],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(1);
    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.FullAuto,
    );
    expect(createdSuggestions[0]!.autoResolveOnRecovery).toBe(true);
    expect(createdSuggestions[0]!.ruleNameSnapshot).toBe(
      'AI remediation for cluster "prod-us"',
    );
    expect(enqueue).toHaveBeenCalledTimes(1);

    const feed: jest.SpyInstance =
      IncidentFeedService.createIncidentFeedItem as unknown as jest.SpyInstance;
    expect(feed).toHaveBeenCalledTimes(1);
    const markdown: string = (
      feed.mock.calls[0]![0] as { feedInfoInMarkdown: string }
    ).feedInfoInMarkdown;
    expect(markdown).toContain("Approvals are bypassed");
    expect(markdown).not.toContain("riskier changes will ask");
    expect(markdown).not.toContain("for approval");
  });

  it("skips a cluster that is not remediation-ready", async () => {
    mockBaseline({
      statuses: [readyCluster({ isRemediationReady: false })],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does not start a second round for a cluster that already has a suggestion on this subject", async () => {
    mockBaseline({
      existing: [
        {
          id: SUGGESTION_ID,
          _id: SUGGESTION_ID.toString(),
          kubernetesClusterId: CLUSTER_ID,
        } as unknown as AutoRemediationSuggestion,
      ],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(0);
  });

  it("respects the per-subject suggestion cap", async () => {
    const existing: Array<AutoRemediationSuggestion> = [];
    for (let i: number = 0; i < MAX_SUGGESTIONS_PER_SUBJECT; i++) {
      existing.push({
        id: ObjectID.generate(),
        _id: ObjectID.generate().toString(),
      } as unknown as AutoRemediationSuggestion);
    }
    mockBaseline({ existing });

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(0);
    expect(AutoRemediationRuleService.findBy).not.toHaveBeenCalled();
  });

  it("settles the suggestion as NoneApplicable when the run cannot be queued", async () => {
    mockBaseline({});
    enqueue.mockResolvedValue(null);

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(1);
    expect(suggestionUpdates[0]).toMatchObject({
      status: AutoRemediationSuggestionStatus.NoneApplicable,
    });
  });

  it("skips the lane quietly when the access lookup fails and still evaluates rules", async () => {
    mockBaseline({});
    (
      KubernetesClusterAiAccessService.getStatusesForSubject as unknown as jest.SpyInstance
    ).mockRejectedValue(new Error("db down"));

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(0);
    expect(AutoRemediationRuleService.findBy).toHaveBeenCalledTimes(1);
  });
});

describe("AutoRemediationRuleEngineService.startFollowUpClusterRemediation", () => {
  let getStatusForCluster: jest.SpyInstance;

  beforeEach(() => {
    mockBaseline({});
    getStatusForCluster = jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(readyCluster());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("starts a Suggest round even on an Automatic cluster and labels it as round 2", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));

    const started: boolean =
      await AutoRemediationRuleEngineService.startFollowUpClusterRemediation({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        incidentId: INCIDENT_ID,
      });

    expect(started).toBe(true);
    expect(createdSuggestions).toHaveLength(1);
    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.Suggest,
    );
    expect(createdSuggestions[0]!.autoResolveOnRecovery).toBe(false);
    expect(createdSuggestions[0]!.ruleNameSnapshot).toContain("round 2");
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("runs the follow-up round unattended again on a BypassApproval cluster", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    getStatusForCluster.mockResolvedValue(
      readyCluster({
        remediationMode: KubernetesAiRemediationMode.BypassApproval,
      }),
    );

    const started: boolean =
      await AutoRemediationRuleEngineService.startFollowUpClusterRemediation({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        incidentId: INCIDENT_ID,
      });

    expect(started).toBe(true);
    expect(createdSuggestions).toHaveLength(1);
    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.FullAuto,
    );
    expect(createdSuggestions[0]!.autoResolveOnRecovery).toBe(true);
    expect(createdSuggestions[0]!.ruleNameSnapshot).toContain("round 2");

    const markdown: string = (
      (
        IncidentFeedService.createIncidentFeedItem as unknown as jest.SpyInstance
      ).mock.calls[0]![0] as { feedInfoInMarkdown: string }
    ).feedInfoInMarkdown;
    expect(markdown).toContain("round 2");
    expect(markdown).toContain("Approvals are bypassed");
    expect(markdown).not.toContain("for approval");
  });

  it("still stops the BypassApproval follow-up at the round cap", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(
        new PositiveNumber(MAX_CLUSTER_REMEDIATION_ROUNDS_PER_SUBJECT),
      );
    getStatusForCluster.mockResolvedValue(
      readyCluster({
        remediationMode: KubernetesAiRemediationMode.BypassApproval,
      }),
    );

    expect(
      await AutoRemediationRuleEngineService.startFollowUpClusterRemediation({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(false);
    expect(createdSuggestions).toHaveLength(0);
  });

  it("stops asking once the round cap is spent", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(
        new PositiveNumber(MAX_CLUSTER_REMEDIATION_ROUNDS_PER_SUBJECT),
      );

    const started: boolean =
      await AutoRemediationRuleEngineService.startFollowUpClusterRemediation({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        incidentId: INCIDENT_ID,
      });

    expect(started).toBe(false);
    expect(createdSuggestions).toHaveLength(0);
    expect(getStatusForCluster).not.toHaveBeenCalled();
  });

  it("does nothing when the cluster is no longer ready or auto-remediation is off", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    getStatusForCluster.mockResolvedValue(
      readyCluster({ isRemediationReady: false }),
    );

    expect(
      await AutoRemediationRuleEngineService.startFollowUpClusterRemediation({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        alertId: ALERT_ID,
      }),
    ).toBe(false);

    (
      ProjectService.findOneById as unknown as jest.SpyInstance
    ).mockResolvedValue({ enableAutoRemediation: false } as unknown as Project);

    expect(
      await AutoRemediationRuleEngineService.startFollowUpClusterRemediation({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        alertId: ALERT_ID,
      }),
    ).toBe(false);

    expect(createdSuggestions).toHaveLength(0);
  });
});

describe("AutoRemediationRuleEngineService cluster feed copy states exactly what each round does", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function incidentFeedMarkdown(): string {
    const feed: jest.SpyInstance =
      IncidentFeedService.createIncidentFeedItem as unknown as jest.SpyInstance;
    expect(feed).toHaveBeenCalledTimes(1);
    return (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
      .feedInfoInMarkdown;
  }

  async function followUp(mode: KubernetesAiRemediationMode): Promise<string> {
    mockBaseline({});
    jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(readyCluster({ remediationMode: mode }));

    expect(
      await AutoRemediationRuleEngineService.startFollowUpClusterRemediation({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(true);

    return incidentFeedMarkdown();
  }

  it("Automatic, round 1: safe changes run on their own; a riskier change never runs on its own — it is proposed for one-click approval", async () => {
    /*
     * Changed with the "Automatic proposes the riskier fix" fix: this copy
     * used to say a riskier change is "neither run nor proposed in this
     * round". A round that ran nothing but refused a riskier change now
     * ends as an approval card for it, so the copy promises exactly that.
     */
    mockBaseline({
      statuses: [
        readyCluster({
          remediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      ],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    const markdown: string = incidentFeedMarkdown();
    expect(markdown).toContain("Automatic remediation is on for this cluster");
    expect(markdown).toContain("on its own");
    /*
     * The shared SafeWrite wording (PR #3953 round-two review): one named
     * object, and never "delete a named pod or job" — deleting a job is a
     * riskier change.
     */
    expect(markdown).toContain(KUBECTL_SAFE_CHANGES_SUMMARY);
    expect(markdown).not.toContain("pod or job");
    expect(markdown).toContain("cluster's kubectl allowlist");
    expect(markdown).toContain("A riskier change never runs on its own");
    /*
     * Changed in the round-three review: "AI proposes it for your one-click
     * approval instead" was unconditional. The canonical Automatic
     * semantics have two cases — a round that finds only riskier fixes
     * proposes exactly those; after safe fixes, a riskier one is proposed
     * only if verification shows the service did not recover — and the
     * every-mode rules (a protected-namespace write, a node drain and a
     * node taint always need a human; the breaker or another round's hold
     * turns the round into a proposal) apply to Automatic too.
     */
    expect(markdown).toContain(
      "if the round finds only riskier fixes, AI proposes exactly those for your one-click approval",
    );
    expect(markdown).toContain(
      "a riskier fix is proposed only if verification shows the service did not recover",
    );
    expect(markdown).toContain(
      "riskier changes whose shape the cluster's kubectl allowlist names",
    );
    expect(markdown.toLowerCase()).toContain(
      KUBECTL_ALWAYS_ASKS_SUMMARY.toLowerCase(),
    );
    expect(markdown).toMatch(TAINT_WORD_PATTERN);
    expect(markdown).toContain("hourly circuit breaker for this cluster trips");
    expect(markdown).toContain(
      "another unattended OneUptime AI round already holds the cluster",
    );
    expect(markdown).toContain("destructive commands never run");
    expect(markdown).not.toContain("proposes it for your one-click approval");
    expect(markdown).not.toContain("neither run nor proposed");
    expect(markdown).not.toContain("asks first");
    expect(markdown).not.toContain("bypassed");
  });

  it("Automatic, round 2: the follow-up asks first — nothing runs until the new plan is approved", async () => {
    const markdown: string = await followUp(
      KubernetesAiRemediationMode.Automatic,
    );

    expect(markdown).toContain("round 2");
    expect(markdown).toContain("did not recover the service");
    expect(markdown).toContain("nothing runs until you approve the new plan");
    expect(markdown).not.toContain("on its own");
    expect(markdown).not.toContain("recommendations");
  });

  it("RequireApproval, round 1: nothing runs until the plan is approved", async () => {
    mockBaseline({
      statuses: [
        readyCluster({
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
        }),
      ],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    const markdown: string = incidentFeedMarkdown();
    expect(markdown).toContain("composing a kubectl fix");
    expect(markdown).toContain("Nothing runs until you approve the plan");
    expect(markdown).not.toContain("on its own");
  });

  it("RequireApproval, round 2: the follow-up asks again", async () => {
    const markdown: string = await followUp(
      KubernetesAiRemediationMode.RequireApproval,
    );

    expect(markdown).toContain("round 2");
    expect(markdown).toContain("nothing runs until you approve the new plan");
    expect(markdown).not.toContain("on its own");
  });

  it("BypassApproval, round 1 and 2: every allowed change runs on its own, riskier ones included, destructive never", async () => {
    mockBaseline({
      statuses: [
        readyCluster({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      ],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    const first: string = incidentFeedMarkdown();
    expect(first).toContain("Approvals are bypassed for this cluster");
    expect(first).toContain("safe or riskier");
    expect(first).toContain("without asking");
    expect(first).toContain("destructive commands never run");
    // Bypass approval still asks for what needs a human in every mode.
    expect(first).toContain(KUBECTL_ALWAYS_ASKS_SUMMARY);
    expect(first).toMatch(TAINT_WORD_PATTERN);
    /*
     * ...and a Bypass round still becomes a proposal when the breaker trips
     * or another unattended round holds the cluster (the canonical
     * KubernetesAiRemediationMode comment's Bypass exceptions).
     */
    expect(first).toContain("hourly circuit breaker for this cluster trips");
    expect(first).toContain(
      "another unattended OneUptime AI round already holds the cluster",
    );
    expect(first).toContain("this round becomes a proposal");
    expect(first).not.toContain("approve");
    expect(first).not.toContain("recommendations");

    jest.restoreAllMocks();

    const second: string = await followUp(
      KubernetesAiRemediationMode.BypassApproval,
    );
    expect(second).toContain("round 2");
    expect(second).toContain("runs on its own");
    expect(second).toContain("safe or riskier");
    expect(second).toContain("destructive commands never run");
    expect(second).toContain(KUBECTL_ALWAYS_ASKS_SUMMARY);
    expect(second).toContain("this round becomes a proposal");
    expect(second).not.toContain("approve");
  });
});

/*
 * The other rounds on the cluster, as the in-flight round check reads them
 * (its query names the cluster; the per-subject dedupe's does not).
 */
function mockRoundsOnCluster(
  rows: Array<Record<string, unknown>>,
  existing: Array<AutoRemediationSuggestion> = [],
): jest.SpyInstance {
  return (
    AutoRemediationSuggestionService.findBy as unknown as jest.SpyInstance
  ).mockImplementation(
    async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
      const query: Record<string, unknown> =
        (args as { query?: Record<string, unknown> }).query || {};
      return (query["kubernetesClusterId"]
        ? rows
        : existing) as unknown as Array<AutoRemediationSuggestion>;
    },
  );
}

function roundOnCluster(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const id: ObjectID = ObjectID.generate();
  return {
    id,
    _id: id.toString(),
    status: AutoRemediationSuggestionStatus.AutoExecuted,
    executionMode: AutoRemediationExecutionMode.FullAuto,
    verificationStatus: AutoRemediationVerificationStatus.Pending,
    verificationDeadlineAt: new Date(Date.now() + 10 * 60 * 1000),
    incidentId: INCIDENT_ID,
    ruleNameSnapshot: 'AI remediation for cluster "prod-us"',
    createdAt: new Date(Date.now() - 5 * 60 * 1000),
    ...overrides,
  };
}

describe("AutoRemediationRuleEngineService — one unattended round per cluster at a time", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function startAlertRound(): Promise<string> {
    await AutoRemediationRuleEngineService.applyRulesToAlert({
      id: ALERT_ID,
      _id: ALERT_ID.toString(),
      projectId: PROJECT_ID,
      title: "Pods stuck in Pending",
    } as unknown as Alert);

    const feed: jest.SpyInstance =
      AlertFeedService.createAlertFeedItem as unknown as jest.SpyInstance;
    expect(feed).toHaveBeenCalledTimes(1);
    return (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
      .feedInfoInMarkdown;
  }

  it("creates the alert's round ASKING FIRST while the incident's round on the same cluster is still being verified — the alert and the incident of one monitor", async () => {
    mockBaseline({});
    const holdRead: jest.SpyInstance = mockRoundsOnCluster([roundOnCluster()]);

    const markdown: string = await startAlertRound();

    expect(createdSuggestions).toHaveLength(1);
    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.Suggest,
    );
    expect(createdSuggestions[0]!.autoResolveOnRecovery).toBe(false);
    expect(markdown).toContain(
      "This round asks first because another OneUptime AI round on this cluster applied a fix that is still being verified",
    );
    expect(markdown).toContain("nothing runs until you approve the plan");
    expect(markdown).not.toContain("on its own");

    // The check read this cluster, in this project, across subjects.
    const query: Record<string, unknown> = (
      holdRead.mock.calls.find((call: Array<unknown>) => {
        return Boolean(
          (call[0] as { query: Record<string, unknown> }).query[
            "kubernetesClusterId"
          ],
        );
      })![0] as { query: Record<string, unknown> }
    ).query;
    expect((query["kubernetesClusterId"] as ObjectID).toString()).toBe(
      CLUSTER_ID.toString(),
    );
    expect((query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(query["incidentId"]).toBeUndefined();
    expect(query["alertId"]).toBeUndefined();
  });

  it("asks first while another round on the cluster is still running unattended — on a BypassApproval cluster too", async () => {
    mockBaseline({
      statuses: [
        readyCluster({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      ],
    });
    mockRoundsOnCluster([
      roundOnCluster({
        status: AutoRemediationSuggestionStatus.Planning,
        verificationStatus: undefined,
        verificationDeadlineAt: undefined,
        createdAt: new Date(Date.now() - 60 * 1000),
      }),
    ]);

    const markdown: string = await startAlertRound();

    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.Suggest,
    );
    expect(markdown).toContain("is still running unattended");
    expect(markdown).not.toContain("Approvals are bypassed");
  });

  it("creates the alert's round ASKING FIRST while a rule-driven run on the monitor's incident still has its fix on the cluster under verification", async () => {
    mockBaseline({});
    const ruleRunId: ObjectID = ObjectID.generate();
    (
      AutoRemediationSuggestionService.findBy as unknown as jest.SpyInstance
    ).mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        const query: Record<string, unknown> =
          (args as { query?: Record<string, unknown> }).query || {};
        if (!query["_id"]) {
          return [];
        }
        return [
          {
            id: ruleRunId,
            _id: ruleRunId.toString(),
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            executionMode: AutoRemediationExecutionMode.FullAuto,
            verificationStatus: AutoRemediationVerificationStatus.Pending,
            verificationDeadlineAt: new Date(Date.now() + 10 * 60 * 1000),
            incidentId: INCIDENT_ID,
            ruleNameSnapshot: "Restart web on 5xx",
            createdAt: new Date(Date.now() - 5 * 60 * 1000),
          },
        ] as unknown as Array<AutoRemediationSuggestion>;
      },
    );
    (RunnerJobService.findBy as unknown as jest.SpyInstance).mockResolvedValue([
      {
        id: ObjectID.generate(),
        autoRemediationSuggestionId: ruleRunId,
        stepId: "ai-command-1",
      } as unknown as RunnerJob,
    ]);

    const markdown: string = await startAlertRound();

    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.Suggest,
    );
    expect(markdown).toContain(
      "This round asks first because another OneUptime AI round on this cluster applied a fix that is still being verified",
    );
  });

  it("negative control: with no rule-driven kubectl job on the cluster the alert's round runs unattended", async () => {
    mockBaseline({});

    const markdown: string = await startAlertRound();

    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.FullAuto,
    );
    expect(markdown).toContain("Automatic remediation is on for this cluster");
  });

  it("asks first when the in-flight round check itself fails", async () => {
    mockBaseline({});
    (
      AutoRemediationSuggestionService.findBy as unknown as jest.SpyInstance
    ).mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        const query: Record<string, unknown> =
          (args as { query?: Record<string, unknown> }).query || {};
        if (query["kubernetesClusterId"]) {
          throw new Error("db down");
        }
        return [];
      },
    );

    const markdown: string = await startAlertRound();

    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.Suggest,
    );
    expect(markdown).toContain(
      "OneUptime AI could not confirm that no other AI round is changing this cluster",
    );
  });

  it.each([
    [
      "a verified fix",
      {
        verificationStatus: AutoRemediationVerificationStatus.Verified,
      },
    ],
    [
      "a fix whose verification deadline passed long ago (the verifier is not running)",
      {
        verificationDeadlineAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    ],
    [
      "a round stuck in Planning for hours",
      {
        status: AutoRemediationSuggestionStatus.Planning,
        verificationStatus: undefined,
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      },
    ],
    [
      "a round that only asks",
      {
        status: AutoRemediationSuggestionStatus.Planning,
        executionMode: AutoRemediationExecutionMode.Suggest,
        verificationStatus: undefined,
      },
    ],
  ])(
    "negative control: %s does not hold the cluster — the round runs unattended as its mode says",
    async (_label: string, overrides: Record<string, unknown>) => {
      mockBaseline({});
      mockRoundsOnCluster([roundOnCluster(overrides)]);

      const markdown: string = await startAlertRound();

      expect(createdSuggestions[0]!.executionMode).toBe(
        AutoRemediationExecutionMode.FullAuto,
      );
      expect(createdSuggestions[0]!.autoResolveOnRecovery).toBe(true);
      expect(markdown).toContain(
        "Automatic remediation is on for this cluster",
      );
    },
  );

  it("negative control: a cluster that asks for approval never needs the check — its round asks anyway", async () => {
    mockBaseline({
      statuses: [
        readyCluster({
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
        }),
      ],
    });
    const holdRead: jest.SpyInstance = mockRoundsOnCluster([roundOnCluster()]);

    await startAlertRound();

    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.Suggest,
    );
    expect(
      holdRead.mock.calls.some((call: Array<unknown>) => {
        return Boolean(
          (call[0] as { query: Record<string, unknown> }).query[
            "kubernetesClusterId"
          ],
        );
      }),
    ).toBe(false);
  });
});

describe("AutoRemediationRuleEngineService.startFollowUpClusterRemediation — forced to ask first", () => {
  beforeEach(() => {
    mockBaseline({});
    jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(
        readyCluster({
          remediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("asks first on a BypassApproval cluster when the previous round's rollback did not complete, and says why", async () => {
    const started: boolean =
      await AutoRemediationRuleEngineService.startFollowUpClusterRemediation({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        incidentId: INCIDENT_ID,
        forceSuggest: true,
      });

    expect(started).toBe(true);
    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.Suggest,
    );
    expect(createdSuggestions[0]!.autoResolveOnRecovery).toBe(false);
    expect(createdSuggestions[0]!.ruleNameSnapshot).toContain("round 2");

    const markdown: string = (
      (
        IncidentFeedService.createIncidentFeedItem as unknown as jest.SpyInstance
      ).mock.calls[0]![0] as { feedInfoInMarkdown: string }
    ).feedInfoInMarkdown;
    expect(markdown).toContain("round 2");
    expect(markdown).toContain(
      "This round asks first because the previous fix's rollback did not complete",
    );
    expect(markdown).not.toContain("Approvals are bypassed");
  });

  it("uses the reason it was given", async () => {
    await AutoRemediationRuleEngineService.startFollowUpClusterRemediation({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      incidentId: INCIDENT_ID,
      forceSuggest: true,
      forceSuggestReason: "a human must look first",
    });

    const markdown: string = (
      (
        IncidentFeedService.createIncidentFeedItem as unknown as jest.SpyInstance
      ).mock.calls[0]![0] as { feedInfoInMarkdown: string }
    ).feedInfoInMarkdown;
    expect(markdown).toContain("asks first because a human must look first");
  });

  it("negative control: without forceSuggest the BypassApproval follow-up runs unattended, as before", async () => {
    await AutoRemediationRuleEngineService.startFollowUpClusterRemediation({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      incidentId: INCIDENT_ID,
    });

    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.FullAuto,
    );
    expect(createdSuggestions[0]!.autoResolveOnRecovery).toBe(true);
  });
});

describe("AutoRemediationRuleEngineService.findRoundHoldingCluster", () => {
  const MINE: ObjectID = new ObjectID("12121212-1212-4212-8212-121212121212");
  const NOW: number = Date.now();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function holding(
    rows: Array<Record<string, unknown>>,
    data: {
      anyOrder?: boolean;
      subject?: { incidentId?: ObjectID; alertId?: ObjectID };
    } = {},
  ): Promise<ClusterRoundHold | null> {
    jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue(rows as unknown as Array<AutoRemediationSuggestion>);
    jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
    return AutoRemediationRuleEngineService.findRoundHoldingCluster({
      projectId: PROJECT_ID,
      clusterId: CLUSTER_ID.toString(),
      forRound: { suggestionId: MINE, createdAt: new Date(NOW - 1000) },
      ...data,
    });
  }

  it("never holds a cluster against the round itself", async () => {
    expect(
      await holding([
        roundOnCluster({
          id: MINE,
          _id: MINE.toString(),
          status: AutoRemediationSuggestionStatus.Planning,
        }),
      ]),
    ).toBeNull();
  });

  it("orders Planning unattended rounds: an earlier one holds, a later one does not — unless any order counts", async () => {
    const earlier: Record<string, unknown> = roundOnCluster({
      status: AutoRemediationSuggestionStatus.Planning,
      verificationStatus: undefined,
      createdAt: new Date(NOW - 5000),
    });
    const later: Record<string, unknown> = roundOnCluster({
      status: AutoRemediationSuggestionStatus.Planning,
      verificationStatus: undefined,
      createdAt: new Date(NOW),
    });

    expect((await holding([earlier]))?.description).toContain(
      "still running unattended",
    );
    expect(await holding([later])).toBeNull();
    expect(await holding([later], { anyOrder: true })).not.toBeNull();
  });

  it("holds for the same signal's round that is still composing — asking or not — only when a subject is given", async () => {
    const composing: Record<string, unknown> = roundOnCluster({
      status: AutoRemediationSuggestionStatus.Planning,
      executionMode: AutoRemediationExecutionMode.Suggest,
      verificationStatus: undefined,
    });

    const sameSignal: ClusterRoundHold | null = await holding([composing], {
      subject: { incidentId: INCIDENT_ID },
    });
    expect(sameSignal?.isSameSubject).toBe(true);
    expect(sameSignal?.description).toContain("same signal");

    expect(
      await holding([composing], { subject: { alertId: ALERT_ID } }),
    ).toBeNull();
    expect(await holding([composing])).toBeNull();
  });

  it("holds while an Approved (human-approved) fix is still being verified", async () => {
    expect(
      (
        await holding([
          roundOnCluster({ status: AutoRemediationSuggestionStatus.Approved }),
        ])
      )?.description,
    ).toContain("still being verified");
  });

  /*
   * A rule-driven run carries no cluster id; its kubectl jobs do. One that
   * changed the cluster holds it like a cluster round would (PR #3953
   * review, remediation-r2-04) — so "one unattended AI run per cluster at a
   * time" holds in both directions.
   */
  describe("a rule-driven run found through its kubectl jobs on the cluster", () => {
    const RULE_RUN: ObjectID = new ObjectID(
      "abababab-abab-4bab-8bab-abababababab",
    );

    function ruleRun(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        id: RULE_RUN,
        _id: RULE_RUN.toString(),
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        executionMode: AutoRemediationExecutionMode.FullAuto,
        verificationStatus: AutoRemediationVerificationStatus.Pending,
        verificationDeadlineAt: new Date(NOW + 10 * 60 * 1000),
        incidentId: INCIDENT_ID,
        ruleNameSnapshot: "Restart web on 5xx",
        createdAt: new Date(NOW - 5 * 60 * 1000),
        ...overrides,
      };
    }

    function holdingThroughJobs(data: {
      jobs: Array<{ suggestionId: ObjectID; stepId: string }>;
      runs: Array<Record<string, unknown>>;
      forRound?: ObjectID | undefined;
    }): {
      hold: Promise<ClusterRoundHold | null>;
      runRead: jest.SpyInstance;
    } {
      const runRead: jest.SpyInstance = jest
        .spyOn(AutoRemediationSuggestionService, "findBy")
        .mockImplementation(
          async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
            const query: Record<string, unknown> =
              (args as { query?: Record<string, unknown> }).query || {};
            // No cluster round on the cluster; the runs behind the jobs by id.
            return (query["kubernetesClusterId"]
              ? []
              : data.runs) as unknown as Array<AutoRemediationSuggestion>;
          },
        );
      jest.spyOn(RunnerJobService, "findBy").mockResolvedValue(
        data.jobs.map(
          (job: { suggestionId: ObjectID; stepId: string }): RunnerJob => {
            return {
              id: ObjectID.generate(),
              autoRemediationSuggestionId: job.suggestionId,
              stepId: job.stepId,
            } as unknown as RunnerJob;
          },
        ),
      );

      return {
        hold: AutoRemediationRuleEngineService.findRoundHoldingCluster({
          projectId: PROJECT_ID,
          clusterId: CLUSTER_ID.toString(),
          forRound: {
            suggestionId: data.forRound || MINE,
            createdAt: new Date(NOW - 1000),
          },
        }),
        runRead,
      };
    }

    it("holds while its fix on the cluster is still being verified, naming the run", async () => {
      const hold: ClusterRoundHold | null = await holdingThroughJobs({
        jobs: [{ suggestionId: RULE_RUN, stepId: "ai-command-1" }],
        runs: [ruleRun()],
      }).hold;

      expect(hold?.suggestionId).toBe(RULE_RUN.toString());
      expect(hold?.ruleNameSnapshot).toBe("Restart web on 5xx");
      expect(hold?.description).toBe(
        "applied a fix that is still being verified",
      );
    });

    it("holds while it is still running and already changed the cluster — created after the asking round, without anyOrder", async () => {
      const hold: ClusterRoundHold | null = await holdingThroughJobs({
        jobs: [{ suggestionId: RULE_RUN, stepId: "ai-command-2" }],
        runs: [
          ruleRun({
            status: AutoRemediationSuggestionStatus.Planning,
            verificationStatus: undefined,
            createdAt: new Date(NOW),
          }),
        ],
      }).hold;

      expect(hold?.description).toBe("is still changing it");
    });

    it("reads the runs behind the jobs by id, in this project, CommandPlan only", async () => {
      const lookup: {
        hold: Promise<ClusterRoundHold | null>;
        runRead: jest.SpyInstance;
      } = holdingThroughJobs({
        jobs: [{ suggestionId: RULE_RUN, stepId: "ai-command-1" }],
        runs: [ruleRun()],
      });
      await lookup.hold;

      const byId: Record<string, unknown> | undefined =
        lookup.runRead.mock.calls
          .map((call: Array<unknown>) => {
            return (call[0] as { query: Record<string, unknown> }).query;
          })
          .find((query: Record<string, unknown>) => {
            return Boolean(query["_id"]);
          });
      expect(byId).toBeDefined();
      expect((byId!["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(byId!["suggestionType"]).toBe(
        AutoRemediationSuggestionType.CommandPlan,
      );
    });

    it.each([
      [
        "its fix was verified",
        [{ stepId: "ai-command-1" }],
        { verificationStatus: AutoRemediationVerificationStatus.Verified },
      ],
      [
        "its only job on the cluster is a rollback of a failed fix",
        [{ stepId: "ai-rollback-1" }],
        {},
      ],
      ["it has no job on the cluster", [], {}],
    ])(
      "negative control: no hold when %s",
      async (
        _label: string,
        jobs: Array<{ stepId: string }>,
        overrides: Record<string, unknown>,
      ) => {
        const lookup: {
          hold: Promise<ClusterRoundHold | null>;
          runRead: jest.SpyInstance;
        } = holdingThroughJobs({
          jobs: jobs.map((job: { stepId: string }) => {
            return { suggestionId: RULE_RUN, stepId: job.stepId };
          }),
          runs: [ruleRun(overrides)],
        });

        expect(await lookup.hold).toBeNull();
      },
    );

    it("negative control: the asking run's own jobs never hold the cluster against it", async () => {
      expect(
        await holdingThroughJobs({
          jobs: [{ suggestionId: RULE_RUN, stepId: "ai-command-1" }],
          runs: [ruleRun()],
          forRound: RULE_RUN,
        }).hold,
      ).toBeNull();
    });

    it("negative control: a run the read returns that no job named is ignored", async () => {
      expect(
        await holdingThroughJobs({
          jobs: [{ suggestionId: ObjectID.generate(), stepId: "ai-command-1" }],
          runs: [ruleRun()],
        }).hold,
      ).toBeNull();
    });
  });

  it("propagates a failed read so callers fail safe", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockRejectedValue(new Error("db down"));

    await expect(
      AutoRemediationRuleEngineService.findRoundHoldingCluster({
        projectId: PROJECT_ID,
        clusterId: CLUSTER_ID.toString(),
      }),
    ).rejects.toThrow("db down");
  });
});

describe("cluster round name snapshots", () => {
  it("round-trips the server-written name, rounds included", () => {
    expect(getClusterRoundNameSnapshot("prod-us", 1)).toBe(
      'AI remediation for cluster "prod-us"',
    );
    expect(getClusterRoundNameSnapshot("prod-us", 2)).toBe(
      'AI remediation for cluster "prod-us" (round 2)',
    );
    expect(
      parseClusterRoundNameSnapshot(getClusterRoundNameSnapshot("prod-us", 2)),
    ).toEqual({ clusterName: "prod-us" });
    expect(
      parseClusterRoundNameSnapshot('AI remediation for cluster "a "b" c"'),
    ).toEqual({ clusterName: 'a "b" c' });
  });

  it("does not take an ordinary rule name for a cluster round", () => {
    expect(parseClusterRoundNameSnapshot("Restart the API service")).toBeNull();
    expect(
      parseClusterRoundNameSnapshot('Custom: AI remediation for cluster "x"'),
    ).toBeNull();
    expect(parseClusterRoundNameSnapshot(undefined)).toBeNull();
  });
});
