import AutoRemediationRuleEngineService, {
  DEFAULT_VERIFICATION_WINDOW_MINUTES,
  MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR,
  MAX_RESOURCE_REMEDIATION_ROUNDS_PER_SUBJECT,
  MAX_SUGGESTIONS_PER_SUBJECT,
  RESOURCE_BREAKER_LOCK_NAMESPACE,
  ResourceBreakerState,
  ResourceRoundHold,
  getResourceBreakerLockKey,
  getResourceRoundNameSnapshot,
  parseClusterRoundNameSnapshot,
} from "../../../Server/Services/AutoRemediationRuleEngineService";
import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import ProjectService from "../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
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
  INLINE_COMMAND_STEP_ID_PREFIX,
  RESOURCE_ALWAYS_ASKS_SUMMARY,
  RESOURCE_SAFE_CHANGES_SUMMARY,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import OneUptimeDate from "../../../Types/Date";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — resource-level remediation in the rule engine, the
 * lane an infrastructure resource's AI page (a Docker or Podman host, a
 * Docker Swarm, Proxmox, VMware or Ceph cluster, a database server, a host)
 * turns on without any AutoRemediationRule — built BESIDE the cluster lane:
 *
 * - it runs only when the signal has no cluster round (one started now, or
 *   one it already had) and no resource round yet: one AI fix lane per
 *   signal;
 * - the FIRST eligible linked resource in ALL_AI_RESOURCE_TYPES order —
 *   fixes on (mode not Disabled) and remediation-ready — gets ONE Planning
 *   CommandPlan suggestion that carries its resourceType and resourceId,
 *   snapshots the mode exactly like a cluster round (Automatic → FullAuto on
 *   round 1 with auto-resolve, RequireApproval → Suggest, BypassApproval →
 *   FullAuto every round), and enqueues a RemediationExecution run;
 * - another round holding the resource (or a failed check) makes an
 *   unattended round ask first, and the feed says why;
 * - a failed access lookup skips the lane quietly and rules still run;
 * - the follow-up round ("ask again") mirrors the cluster's: Suggest for
 *   Automatic and RequireApproval, FullAuto for BypassApproval, capped at
 *   MAX_RESOURCE_REMEDIATION_ROUNDS_PER_SUBJECT, asking first when forced;
 * - the per-resource breaker and hold read the resource's own rows and jobs
 *   (resourceType + resourceId), never a cluster's, and the breaker lock's
 *   namespace and key are the resource's own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const ALERT_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const RESOURCE_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_RESOURCE_ID: string = "34343434-3434-4343-8343-343434343434";
const AGENT_ID: string = "44444444-4444-4444-8444-444444444444";
const CLUSTER_ID: string = "35353535-3535-4353-8353-353535353535";
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const OTHER_SUGGESTION_ID: ObjectID = new ObjectID(
  "79797979-7979-4979-8979-797979797979",
);
const AI_RUN_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

function readyResource(
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  const resourceType: AiResourceType =
    overrides.resourceType || AiResourceType.DockerHost;

  return {
    resourceType,
    resourceId: RESOURCE_ID,
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: [],
    agent: {
      agentId: AGENT_ID,
      connectionStatus: "connected",
      isOnline: true,
      posture: {
        resourceType,
        resourceIdentifier: "web-1",
        allowWrites: true,
        writeTargets: [],
        protectedTargets: [],
        reachable: true,
      },
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
    ...overrides,
  };
}

function readyCluster(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID,
    clusterName: "prod-us",
    runner: {
      id: AGENT_ID,
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
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
  };
}

function fakeIncident(): Incident {
  return {
    id: INCIDENT_ID,
    _id: INCIDENT_ID.toString(),
    projectId: PROJECT_ID,
    title: "web-1 container keeps exiting",
    monitors: [],
    labels: [],
  } as unknown as Incident;
}

let createdSuggestions: Array<AutoRemediationSuggestion>;
let suggestionUpdates: Array<Record<string, unknown>>;
let enqueue: jest.SpyInstance;
let resourceStatuses: jest.SpyInstance;
let suggestionFindBy: jest.SpyInstance;

function mockBaseline(data: {
  existing?: Array<AutoRemediationSuggestion> | undefined;
  clusters?: Array<KubernetesClusterAiAccessStatus> | undefined;
  resources?: Array<ResourceAiAccessStatus> | undefined;
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
    enableAiCommandExecution: false,
  } as unknown as Project);
  /*
   * The first read is the subject's existing suggestions; every later read
   * is the in-flight check's (nothing holds the resource unless a test says
   * otherwise).
   */
  suggestionFindBy = jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockResolvedValueOnce(data.existing || [])
    .mockResolvedValue([]);
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
    .mockResolvedValue(data.clusters || []);
  resourceStatuses = jest
    .spyOn(ResourceAiAccessService, "getStatusesForSubject")
    .mockResolvedValue(data.resources || [readyResource()]);
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
  // The breaker and the hold read no AI jobs on the resource unless a test says so.
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
}

function feedMarkdowns(): Array<string> {
  const feed: jest.SpyInstance =
    IncidentFeedService.createIncidentFeedItem as unknown as jest.SpyInstance;
  return feed.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
  });
}

describe("AutoRemediationRuleEngineService resource-level remediation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("starts a FullAuto command run for an Automatic resource with no rule and no cluster", async () => {
    mockBaseline({});

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(1);
    const suggestion: AutoRemediationSuggestion = createdSuggestions[0]!;
    expect(suggestion.resourceType).toBe(AiResourceType.DockerHost);
    expect(suggestion.resourceId?.toString()).toBe(RESOURCE_ID);
    expect(suggestion.kubernetesClusterId).toBeUndefined();
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
      'AI remediation for Docker host "web-1"',
    );
    expect(suggestion.incidentId?.toString()).toBe(INCIDENT_ID.toString());

    expect(resourceStatuses).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      alertId: undefined,
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
      subjectAutoRemediationSuggestionId: SUGGESTION_ID,
      remediationRunType: AIRunType.RemediationExecution,
    });
    expect(suggestionUpdates).toContainEqual({ aiRunId: AI_RUN_ID });

    const markdowns: Array<string> = feedMarkdowns();
    expect(markdowns).toHaveLength(1);
    expect(markdowns[0]).toContain(
      'OneUptime AI is fixing Docker host "web-1"',
    );
    expect(markdowns[0]).toContain("Automatic remediation is on");
    expect(markdowns[0]).toContain(RESOURCE_SAFE_CHANGES_SUMMARY);
    expect(markdowns[0]).toContain("Docker AI agent");
    expect(markdowns[0]).toContain(
      "If the hourly circuit breaker for this Docker host trips",
    );
    expect(markdowns[0]).not.toContain("kubectl");
  });

  it("does not need the project's AI command execution opt-in (the resource's own mode is the consent)", async () => {
    mockBaseline({});

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    // The baseline project has enableAiCommandExecution: false.
    expect(createdSuggestions).toHaveLength(1);
  });

  it("starts a Suggest run without auto-resolve for a RequireApproval resource, on an alert", async () => {
    mockBaseline({
      resources: [
        readyResource({
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
          resourceType: AiResourceType.Host,
        }),
      ],
    });

    await AutoRemediationRuleEngineService.applyRulesToAlert({
      id: ALERT_ID,
      _id: ALERT_ID.toString(),
      projectId: PROJECT_ID,
      title: "nginx is down",
    } as unknown as Alert);

    expect(createdSuggestions).toHaveLength(1);
    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.Suggest,
    );
    expect(createdSuggestions[0]!.autoResolveOnRecovery).toBe(false);
    expect(createdSuggestions[0]!.alertId?.toString()).toBe(
      ALERT_ID.toString(),
    );
    expect(createdSuggestions[0]!.ruleNameSnapshot).toBe(
      'AI remediation for host "web-1"',
    );
    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      subjectAlertId: ALERT_ID,
    });

    const alertFeed: jest.SpyInstance =
      AlertFeedService.createAlertFeedItem as unknown as jest.SpyInstance;
    expect(alertFeed).toHaveBeenCalledTimes(1);
    expect(
      (alertFeed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    ).toContain("Nothing runs until you approve the plan");
  });

  it("starts a FullAuto run with auto-resolve for a BypassApproval resource and says approvals are bypassed — except what always asks", async () => {
    mockBaseline({
      resources: [
        readyResource({
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        }),
      ],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.FullAuto,
    );
    expect(createdSuggestions[0]!.autoResolveOnRecovery).toBe(true);

    const markdown: string = feedMarkdowns()[0]!;
    expect(markdown).toContain("Approvals are bypassed for this Docker host");
    expect(markdown).toContain(RESOURCE_ALWAYS_ASKS_SUMMARY);
    expect(markdown).toContain("destructive commands never run");
  });

  it("picks the FIRST eligible resource in ALL_AI_RESOURCE_TYPES order, and only one", async () => {
    mockBaseline({
      resources: [
        readyResource({
          resourceType: AiResourceType.Host,
          resourceId: OTHER_RESOURCE_ID,
          resourceName: "web-2",
        }),
        readyResource({
          resourceType: AiResourceType.PodmanHost,
          resourceName: "pod-1",
        }),
      ],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(1);
    expect(createdSuggestions[0]!.resourceType).toBe(AiResourceType.PodmanHost);
    expect(createdSuggestions[0]!.ruleNameSnapshot).toBe(
      'AI remediation for Podman host "pod-1"',
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "not remediation-ready",
      { isRemediationReady: false } as Partial<ResourceAiAccessStatus>,
    ],
    [
      "fixes off",
      {
        aiRemediationMode: ResourceAiRemediationMode.Disabled,
      } as Partial<ResourceAiAccessStatus>,
    ],
    [
      "an unknown type",
      {
        resourceType: "Printer" as AiResourceType,
      } as Partial<ResourceAiAccessStatus>,
    ],
  ])(
    "skips a resource that is %s and falls through to the next eligible one",
    async (_label: string, overrides: Partial<ResourceAiAccessStatus>) => {
      mockBaseline({
        resources: [
          readyResource({ ...overrides }),
          readyResource({
            resourceType: AiResourceType.Host,
            resourceId: OTHER_RESOURCE_ID,
            resourceName: "web-2",
          }),
        ],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(createdSuggestions).toHaveLength(1);
      expect(createdSuggestions[0]!.resourceId?.toString()).toBe(
        OTHER_RESOURCE_ID,
      );
    },
  );

  it("starts nothing when no linked resource is eligible", async () => {
    mockBaseline({
      resources: [readyResource({ isRemediationReady: false })],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("never runs when a cluster round started for the signal: the cluster lane is the signal's lane", async () => {
    mockBaseline({ clusters: [readyCluster()] });

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(1);
    expect(createdSuggestions[0]!.kubernetesClusterId?.toString()).toBe(
      CLUSTER_ID,
    );
    expect(createdSuggestions[0]!.resourceId).toBeUndefined();
    // The resource lane never even looked.
    expect(resourceStatuses).not.toHaveBeenCalled();
  });

  it.each([
    ["a cluster round", { kubernetesClusterId: new ObjectID(CLUSTER_ID) }],
    [
      "a resource round",
      {
        resourceType: AiResourceType.Host,
        resourceId: new ObjectID(OTHER_RESOURCE_ID),
      },
    ],
  ])(
    "does not start a resource round when the signal already has %s",
    async (_label: string, fields: Record<string, unknown>) => {
      mockBaseline({
        existing: [
          {
            id: OTHER_SUGGESTION_ID,
            _id: OTHER_SUGGESTION_ID.toString(),
            ...fields,
          } as unknown as AutoRemediationSuggestion,
        ],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(createdSuggestions).toHaveLength(0);
      expect(resourceStatuses).not.toHaveBeenCalled();
    },
  );

  it("selects the resource columns of the subject's existing suggestions", async () => {
    mockBaseline({});

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(suggestionFindBy.mock.calls[0]![0]).toMatchObject({
      select: expect.objectContaining({
        kubernetesClusterId: true,
        resourceType: true,
        resourceId: true,
      }),
    });
  });

  it("respects the per-subject suggestion cap", async () => {
    const existing: Array<AutoRemediationSuggestion> = [];
    for (let i: number = 0; i < MAX_SUGGESTIONS_PER_SUBJECT; i++) {
      existing.push({
        id: ObjectID.generate(),
        _id: ObjectID.generate().toString(),
        autoRemediationRuleId: ObjectID.generate(),
      } as unknown as AutoRemediationSuggestion);
    }
    mockBaseline({ existing });

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(0);
    expect(resourceStatuses).not.toHaveBeenCalled();
  });

  it("settles the suggestion as NoneApplicable when the run cannot be queued", async () => {
    mockBaseline({});
    enqueue.mockResolvedValue(null);

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(1);
    expect(suggestionUpdates[0]).toMatchObject({
      status: AutoRemediationSuggestionStatus.NoneApplicable,
    });
    expect(feedMarkdowns()).toHaveLength(0);
  });

  it("skips the lane quietly when the infrastructure access lookup fails, and still evaluates rules", async () => {
    mockBaseline({});
    resourceStatuses.mockRejectedValue(new Error("db down"));

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(0);
    expect(AutoRemediationRuleService.findBy).toHaveBeenCalledTimes(1);
  });

  it("still evaluates rules when starting the resource round throws", async () => {
    mockBaseline({});
    jest
      .spyOn(AutoRemediationSuggestionService, "create")
      .mockRejectedValue(new Error("insert failed"));

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(AutoRemediationRuleService.findBy).toHaveBeenCalledTimes(1);
  });

  it("asks first when another unattended round already holds the resource, and the feed says so", async () => {
    mockBaseline({});
    suggestionFindBy.mockReset();
    suggestionFindBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: OTHER_SUGGESTION_ID,
          _id: OTHER_SUGGESTION_ID.toString(),
          status: AutoRemediationSuggestionStatus.AutoExecuted,
          verificationStatus: AutoRemediationVerificationStatus.Pending,
          verificationDeadlineAt: OneUptimeDate.addRemoveMinutes(
            OneUptimeDate.getCurrentDate(),
            10,
          ),
          createdAt: OneUptimeDate.getSomeMinutesAgo(5),
        } as unknown as AutoRemediationSuggestion,
      ])
      .mockResolvedValue([]);

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions).toHaveLength(1);
    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.Suggest,
    );
    expect(createdSuggestions[0]!.autoResolveOnRecovery).toBe(false);
    const markdown: string = feedMarkdowns()[0]!;
    expect(markdown).toContain(
      "This round asks first because another OneUptime AI round on this Docker host applied a fix that is still being verified",
    );
  });

  it("asks first when the hold cannot be checked", async () => {
    mockBaseline({});
    suggestionFindBy.mockReset();
    suggestionFindBy
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue([]);

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.Suggest,
    );
    expect(feedMarkdowns()[0]).toContain(
      "OneUptime AI could not confirm that no other AI round is changing this Docker host",
    );
  });
});

describe("AutoRemediationRuleEngineService.startFollowUpResourceRemediation", () => {
  let getStatusForResource: jest.SpyInstance;
  let countBy: jest.SpyInstance;

  beforeEach(() => {
    mockBaseline({});
    suggestionFindBy.mockReset();
    suggestionFindBy.mockResolvedValue([]);
    getStatusForResource = jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockResolvedValue(readyResource());
    countBy = jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function followUp(
    overrides: Partial<{
      forceSuggest: boolean;
      forceSuggestReason: string;
      incidentId: ObjectID | undefined;
      alertId: ObjectID | undefined;
      resourceType: AiResourceType;
    }> = {},
  ): Promise<boolean> {
    return AutoRemediationRuleEngineService.startFollowUpResourceRemediation({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: new ObjectID(RESOURCE_ID),
      incidentId: INCIDENT_ID,
      ...overrides,
    });
  }

  it("starts a Suggest round even on an Automatic resource and labels it as round 2", async () => {
    expect(await followUp()).toBe(true);

    expect(createdSuggestions).toHaveLength(1);
    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.Suggest,
    );
    expect(createdSuggestions[0]!.autoResolveOnRecovery).toBe(false);
    expect(createdSuggestions[0]!.ruleNameSnapshot).toBe(
      'AI remediation for Docker host "web-1" (round 2)',
    );
    expect(createdSuggestions[0]!.resourceId?.toString()).toBe(RESOURCE_ID);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(feedMarkdowns()[0]).toContain(
      'OneUptime AI is composing another fix for Docker host "web-1"** (round 2)',
    );

    // The rounds are counted on this resource, for this subject.
    expect(countBy.mock.calls[0]![0]).toMatchObject({
      query: {
        incidentId: INCIDENT_ID,
        resourceType: AiResourceType.DockerHost,
        resourceId: new ObjectID(RESOURCE_ID),
      },
    });
  });

  it("runs the follow-up round unattended again on a BypassApproval resource", async () => {
    getStatusForResource.mockResolvedValue(
      readyResource({
        aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
      }),
    );

    expect(await followUp()).toBe(true);

    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.FullAuto,
    );
    expect(createdSuggestions[0]!.autoResolveOnRecovery).toBe(true);
    expect(feedMarkdowns()[0]).toContain(
      'OneUptime AI is applying another fix on Docker host "web-1"** (round 2)',
    );
  });

  it("asks first even on a BypassApproval resource when the previous rollback did not complete, and says why", async () => {
    getStatusForResource.mockResolvedValue(
      readyResource({
        aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
      }),
    );

    expect(await followUp({ forceSuggest: true })).toBe(true);

    expect(createdSuggestions[0]!.executionMode).toBe(
      AutoRemediationExecutionMode.Suggest,
    );
    expect(feedMarkdowns()[0]).toContain(
      "This round asks first because the previous fix's rollback did not complete, so its change may still be applied",
    );
  });

  it(`stops at ${MAX_RESOURCE_REMEDIATION_ROUNDS_PER_SUBJECT} rounds per subject`, async () => {
    countBy.mockResolvedValue(
      new PositiveNumber(MAX_RESOURCE_REMEDIATION_ROUNDS_PER_SUBJECT),
    );

    expect(await followUp()).toBe(false);
    expect(createdSuggestions).toHaveLength(0);
    expect(getStatusForResource).not.toHaveBeenCalled();
  });

  it.each([
    ["deleted", null],
    [
      "no longer remediation-ready",
      readyResource({ isRemediationReady: false }),
    ],
    [
      "fixes off",
      readyResource({ aiRemediationMode: ResourceAiRemediationMode.Disabled }),
    ],
  ])(
    "does not ask again when the resource is %s",
    async (_label: string, status: ResourceAiAccessStatus | null) => {
      getStatusForResource.mockResolvedValue(status);

      expect(await followUp()).toBe(false);
      expect(createdSuggestions).toHaveLength(0);
    },
  );

  it("does not ask again when auto-remediation was turned off for the project", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAutoRemediation: false,
    } as unknown as Project);

    expect(await followUp()).toBe(false);
    expect(createdSuggestions).toHaveLength(0);
  });

  it("needs a subject and a known resource type", async () => {
    expect(await followUp({ incidentId: undefined })).toBe(false);
    expect(await followUp({ resourceType: "Printer" as AiResourceType })).toBe(
      false,
    );
    expect(createdSuggestions).toHaveLength(0);
  });

  it("never throws: a failed lookup is no follow-up", async () => {
    getStatusForResource.mockRejectedValue(new Error("db down"));

    expect(await followUp()).toBe(false);
  });
});

describe("AutoRemediationRuleEngineService.getResourceBreakerState", () => {
  let findBy: jest.SpyInstance;
  let countBy: jest.SpyInstance;
  let jobs: jest.SpyInstance;

  beforeEach(() => {
    findBy = jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([]);
    countBy = jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jobs = jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function state(
    forRound?: { suggestionId: ObjectID; createdAt?: Date } | undefined,
  ): Promise<ResourceBreakerState> {
    return AutoRemediationRuleEngineService.getResourceBreakerState({
      resourceType: AiResourceType.Host,
      resourceId: RESOURCE_ID,
      projectId: PROJECT_ID,
      forRound,
    });
  }

  it("reads the resource's own rounds and inline jobs — never a cluster's", async () => {
    const result: ResourceBreakerState = await state();

    expect(result).toEqual({ autoExecutedInWindow: 0, hasHeadroom: true });

    const inFlightQuery: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(inFlightQuery).toMatchObject({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.Host,
      resourceId: new ObjectID(RESOURCE_ID),
      suggestionType: AutoRemediationSuggestionType.CommandPlan,
      status: AutoRemediationSuggestionStatus.Planning,
      executionMode: AutoRemediationExecutionMode.FullAuto,
    });
    expect(inFlightQuery["kubernetesClusterId"]).toBeUndefined();

    expect(
      (countBy.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toMatchObject({
      resourceType: AiResourceType.Host,
      resourceId: new ObjectID(RESOURCE_ID),
      status: AutoRemediationSuggestionStatus.AutoExecuted,
    });

    const jobQuery: Record<string, unknown> = (
      jobs.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(jobQuery).toMatchObject({
      resourceType: AiResourceType.Host,
      resourceId: new ObjectID(RESOURCE_ID),
      origin: RunnerJobOrigin.AiRemediation,
    });
    expect(jobQuery["kubernetesClusterId"]).toBeUndefined();
    expect(String(JSON.stringify(jobQuery["stepId"]))).toContain(
      INLINE_COMMAND_STEP_ID_PREFIX,
    );
  });

  it("trips at the limit on settled rounds", async () => {
    countBy.mockResolvedValue(
      new PositiveNumber(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR),
    );

    expect(await state()).toEqual({
      autoExecutedInWindow: MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR,
      hasHeadroom: false,
    });
  });

  it("counts distinct runs with inline jobs, and in-flight rounds created before the asking one — never itself", async () => {
    const earlier: Date = OneUptimeDate.getSomeMinutesAgo(10);
    const later: Date = OneUptimeDate.getSomeMinutesAgo(1);
    const self: ObjectID = new ObjectID("abababab-abab-4bab-8bab-abababababab");
    const runA: ObjectID = ObjectID.generate();
    const runB: ObjectID = ObjectID.generate();

    jobs.mockResolvedValue([
      { id: ObjectID.generate(), autoRemediationSuggestionId: runA },
      { id: ObjectID.generate(), autoRemediationSuggestionId: runA },
      { id: ObjectID.generate(), autoRemediationSuggestionId: self },
    ] as unknown as Array<RunnerJob>);
    findBy.mockResolvedValue([
      { id: runB, createdAt: earlier },
      // Created after the asking round: not counted against it.
      { id: ObjectID.generate(), createdAt: later },
    ] as unknown as Array<AutoRemediationSuggestion>);

    const result: ResourceBreakerState = await state({
      suggestionId: self,
      createdAt: OneUptimeDate.getSomeMinutesAgo(5),
    });

    expect(result.autoExecutedInWindow).toBe(2);
    expect(result.hasHeadroom).toBe(true);
  });

  it("throws on a failed read, so callers fail safe", async () => {
    countBy.mockRejectedValue(new Error("db down"));

    await expect(state()).rejects.toThrow("db down");
  });
});

describe("AutoRemediationRuleEngineService.findRoundHoldingResource", () => {
  let findBy: jest.SpyInstance;
  let jobs: jest.SpyInstance;

  beforeEach(() => {
    findBy = jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([]);
    jobs = jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function hold(
    overrides: Partial<{
      anyOrder: boolean;
      forRound: { suggestionId: ObjectID; createdAt?: Date };
      subject: { incidentId?: ObjectID; alertId?: ObjectID };
    }> = {},
  ): Promise<ResourceRoundHold | null> {
    return AutoRemediationRuleEngineService.findRoundHoldingResource({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
      ...overrides,
    });
  }

  it("nothing holds a resource with no other round and no jobs", async () => {
    expect(await hold()).toBeNull();

    expect(
      (findBy.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toMatchObject({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: new ObjectID(RESOURCE_ID),
    });
    expect(
      (jobs.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toMatchObject({
      resourceType: AiResourceType.DockerHost,
      resourceId: new ObjectID(RESOURCE_ID),
      origin: RunnerJobOrigin.AiRemediation,
    });
  });

  it("a fix still being verified holds it", async () => {
    findBy.mockResolvedValueOnce([
      {
        id: OTHER_SUGGESTION_ID,
        status: AutoRemediationSuggestionStatus.Approved,
        verificationStatus: AutoRemediationVerificationStatus.Pending,
        verificationDeadlineAt: OneUptimeDate.addRemoveMinutes(
          OneUptimeDate.getCurrentDate(),
          5,
        ),
        ruleNameSnapshot: 'AI remediation for Docker host "web-1"',
      },
    ] as unknown as Array<AutoRemediationSuggestion>);

    expect(await hold()).toMatchObject({
      suggestionId: OTHER_SUGGESTION_ID.toString(),
      description: "applied a fix that is still being verified",
      ruleNameSnapshot: 'AI remediation for Docker host "web-1"',
    });
  });

  it("an unattended round still running holds it only when it was created first, unless anyOrder", async () => {
    const running: AutoRemediationSuggestion = {
      id: OTHER_SUGGESTION_ID,
      status: AutoRemediationSuggestionStatus.Planning,
      executionMode: AutoRemediationExecutionMode.FullAuto,
      createdAt: OneUptimeDate.getSomeMinutesAgo(1),
    } as unknown as AutoRemediationSuggestion;

    findBy.mockResolvedValue([running]);

    const olderRound: { suggestionId: ObjectID; createdAt: Date } = {
      suggestionId: SUGGESTION_ID,
      createdAt: OneUptimeDate.getSomeMinutesAgo(5),
    };

    expect(await hold({ forRound: olderRound })).toBeNull();
    expect(await hold({ forRound: olderRound, anyOrder: true })).toMatchObject({
      description: "is still running unattended",
    });
  });

  it("the asking round never holds itself", async () => {
    findBy.mockResolvedValue([
      {
        id: SUGGESTION_ID,
        status: AutoRemediationSuggestionStatus.Planning,
        executionMode: AutoRemediationExecutionMode.FullAuto,
        createdAt: OneUptimeDate.getSomeMinutesAgo(1),
      },
    ] as unknown as Array<AutoRemediationSuggestion>);

    expect(
      await hold({ forRound: { suggestionId: SUGGESTION_ID }, anyOrder: true }),
    ).toBeNull();
  });

  it("a run that already changed the resource (a forward job there) holds it while it runs", async () => {
    findBy.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: OTHER_SUGGESTION_ID,
        status: AutoRemediationSuggestionStatus.Planning,
        executionMode: AutoRemediationExecutionMode.Suggest,
        createdAt: OneUptimeDate.getSomeMinutesAgo(1),
      },
    ] as unknown as Array<AutoRemediationSuggestion>);
    jobs.mockResolvedValue([
      {
        id: ObjectID.generate(),
        autoRemediationSuggestionId: OTHER_SUGGESTION_ID,
        stepId: `${INLINE_COMMAND_STEP_ID_PREFIX}1`,
      },
    ] as unknown as Array<RunnerJob>);

    expect(await hold()).toMatchObject({
      suggestionId: OTHER_SUGGESTION_ID.toString(),
      description: "is still changing it",
    });
  });

  it("a rollback job does not make its run hold the resource", async () => {
    jobs.mockResolvedValue([
      {
        id: ObjectID.generate(),
        autoRemediationSuggestionId: OTHER_SUGGESTION_ID,
        stepId: "ai-rollback-1",
      },
    ] as unknown as Array<RunnerJob>);

    expect(await hold()).toBeNull();
    // No second suggestion read was needed.
    expect(findBy).toHaveBeenCalledTimes(1);
  });

  it("a round of the same signal still composing holds it for a subject-aware caller", async () => {
    findBy.mockResolvedValue([
      {
        id: OTHER_SUGGESTION_ID,
        status: AutoRemediationSuggestionStatus.Planning,
        executionMode: AutoRemediationExecutionMode.Suggest,
        incidentId: INCIDENT_ID,
        createdAt: OneUptimeDate.getSomeMinutesAgo(1),
      },
    ] as unknown as Array<AutoRemediationSuggestion>);

    expect(await hold({ subject: { incidentId: INCIDENT_ID } })).toMatchObject({
      description: "is still working on this same signal",
      isSameSubject: true,
    });
  });
});

describe("resource round names and the breaker lock", () => {
  it("names a round after its resource, with the round number from round 2", () => {
    expect(
      getResourceRoundNameSnapshot(AiResourceType.DatabaseServer, "orders", 1),
    ).toBe('AI remediation for database server "orders"');
    expect(
      getResourceRoundNameSnapshot(AiResourceType.ProxmoxCluster, "pve", 2),
    ).toBe('AI remediation for Proxmox cluster "pve" (round 2)');
  });

  it("a resource round's name is never read as a deleted cluster round's", () => {
    for (const type of [
      AiResourceType.DockerSwarmCluster,
      AiResourceType.ProxmoxCluster,
      AiResourceType.CephCluster,
      AiResourceType.Host,
    ]) {
      expect(
        parseClusterRoundNameSnapshot(
          getResourceRoundNameSnapshot(type, "x", 2),
        ),
      ).toBeNull();
    }
  });

  it("the breaker lock has its own namespace, keyed by type and (lowercased) id", () => {
    expect(RESOURCE_BREAKER_LOCK_NAMESPACE).toBe(
      "AutoRemediationResourceBreaker",
    );
    expect(RESOURCE_BREAKER_LOCK_NAMESPACE).not.toBe(
      "AutoRemediationClusterBreaker",
    );
    expect(
      getResourceBreakerLockKey(
        AiResourceType.Host,
        "ABCDEFAB-3333-4333-8333-333333333333",
      ),
    ).toBe("Host:abcdefab-3333-4333-8333-333333333333");
  });
});
