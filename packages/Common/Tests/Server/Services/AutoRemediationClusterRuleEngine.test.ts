import AutoRemediationRuleEngineService, {
  DEFAULT_VERIFICATION_WINDOW_MINUTES,
  MAX_CLUSTER_REMEDIATION_ROUNDS_PER_SUBJECT,
  MAX_SUGGESTIONS_PER_SUBJECT,
} from "../../../Server/Services/AutoRemediationRuleEngineService";
import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import ProjectService from "../../../Server/Services/ProjectService";
import AIInvestigationQueue from "../../../Server/Utils/AI/SRE/InvestigationQueue";
import logger from "../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Project from "../../../Models/DatabaseModels/Project";
import AIRunType from "../../../Types/AI/AIRunType";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

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
 * - a BypassApproval cluster never asks: round 1 and the follow-up are
 *   both FullAuto with auto-resolve, and the feed says approvals are
 *   bypassed.
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
