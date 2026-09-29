import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../../../../Server/Utils/AI/IncidentAIContextBuilder";
import AlertAIContextBuilder, {
  AlertContextData,
} from "../../../../Server/Utils/AI/AlertAIContextBuilder";
import AIMemory from "../../../../Server/Utils/AI/SRE/AIMemory";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import ClusterAccessContext from "../../../../Server/Utils/AI/ClusterAccess/ClusterAccessContext";
import {
  INVESTIGATION_MAX_WALL_CLOCK_MS,
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../../Server/Utils/AI/ClusterAccess/KubectlInvestigationToolkit";
import ResourceAccessContext from "../../../../Server/Utils/AI/ResourceAccess/ResourceAccessContext";
import {
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
} from "../../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Infrastructure access (Docker, Podman, Swarm, Proxmox, VMware, Ceph,
 * databases, hosts) reaches an investigation through the same four wires
 * cluster access does — the tools, the persona addendum, the context block
 * and the shared wall clock — BESIDE the cluster wiring, never instead of
 * it:
 *
 * - with no linked resource, every request is exactly what it was (the
 *   cluster addendum alone, the kubectl tools alone);
 * - the cluster rules come first, the infrastructure rules after;
 * - a failed resource lookup never fails the run and never takes the
 *   cluster access away (and the other way round).
 */

const projectId: ObjectID = ObjectID.generate();
const aiRunId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const CLUSTER_ID: string = "33333333-3333-4333-8333-333333333333";
const RUNNER_ID: string = "44444444-4444-4444-8444-444444444444";
const DOCKER_ID: string = "55555555-5555-4555-8555-555555555555";
const AGENT_ID: string = "66666666-6666-4666-8666-666666666666";
const HOST_ID: string = "77777777-7777-4777-8777-777777777777";

type SubjectKind = "incident" | "alert";

const SUBJECT_KINDS: Array<SubjectKind> = ["incident", "alert"];

function clusterStatus(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID,
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: {
      id: RUNNER_ID,
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
      posture: { inCluster: true, allowWrites: false },
    },
    accessMethod: "in_cluster",
    aiAgent: null,
    automaticInvestigation: { incidents: false, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
  };
}

function resourceStatus(
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: DOCKER_ID,
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: [],
    agent: { agentId: AGENT_ID, connectionStatus: "connected", isOnline: true },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: false,
    ...overrides,
  };
}

function unreachableHost(): ResourceAiAccessStatus {
  return resourceStatus({
    resourceType: AiResourceType.Host,
    resourceId: HOST_ID,
    resourceName: "db-host",
    agent: null,
    isInvestigationReady: false,
    gaps: [
      {
        code: "ai_agent_not_connected",
        title: "No Host AI agent is connected",
        nextStep: "Install the Host AI agent.",
        blocksInvestigation: true,
        blocksRemediation: true,
      },
    ],
  });
}

function sentRequest(executeRun: jest.SpyInstance): InvestigationRequest {
  return (executeRun.mock.calls[0]![0] as { request: InvestigationRequest })
    .request;
}

function toolNames(request: InvestigationRequest): Array<string> {
  return (request.extraTools || []).map(
    (tool: ObservabilityAssistantExtraTool) => {
      return tool.definition.name;
    },
  );
}

async function investigate(kind: SubjectKind): Promise<void> {
  if (kind === "incident") {
    const incident: Incident = new Incident(incidentId);
    incident.title = "web-1 is restarting";
    jest
      .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
      .mockResolvedValue({
        incident,
        stateTimeline: [],
        internalNotes: [],
        publicNotes: [],
        workspaceMessages: [],
      } as unknown as IncidentContextData);
    jest
      .spyOn(AIMemory, "getPriorSimilarIncidentsContext")
      .mockResolvedValue("");

    await AIIncidentInvestigationRunner.executeInvestigation({
      aiRunId,
      projectId,
      incidentId,
      attemptCount: 1,
    });
    return;
  }

  const alert: Alert = new Alert(alertId);
  alert.title = "[Docker] Container restarting";
  jest.spyOn(AlertAIContextBuilder, "buildAlertContext").mockResolvedValue({
    alert,
    stateTimeline: [],
    internalNotes: [],
  } as unknown as AlertContextData);

  await AIAlertInvestigationRunner.executeInvestigation({
    aiRunId,
    projectId,
    alertId,
    attemptCount: 1,
  });
}

describe("Investigation runners wire infrastructure access beside cluster access", () => {
  let executeRun: jest.SpyInstance;
  let clusterStatuses: jest.SpyInstance;
  let resourceStatuses: jest.SpyInstance;
  let failOrRequeue: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    executeRun = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);
    clusterStatuses = jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([]);
    resourceStatuses = jest
      .spyOn(ResourceAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([resourceStatus()]);
    failOrRequeue = jest
      .spyOn(AIInvestigationQueue, "failOrRequeue")
      .mockResolvedValue("noop");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(SUBJECT_KINDS)(
    "a %s investigation gets the infrastructure tools, addendum, context block and the shared wall clock",
    async (kind: SubjectKind) => {
      await investigate(kind);

      expect(resourceStatuses).toHaveBeenCalledWith(
        kind === "incident"
          ? { projectId, incidentId }
          : { projectId, alertId },
      );

      const request: InvestigationRequest = sentRequest(executeRun);

      expect(toolNames(request)).toEqual([
        LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
        RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
      ]);
      expect(request.additionalInstructions).toBe(
        ResourceAccessContext.buildPersonaAddendum([resourceStatus()]),
      );
      expect(request.contextSummary).toContain("# Infrastructure access");
      expect(request.contextSummary).toContain(
        `- Docker host "web-1" (resourceId: ${DOCKER_ID}): READ access via run_infrastructure_command`,
      );
      expect(request.contextSummary).not.toContain("# Cluster access");
      expect(request.maxWallClockMs).toBe(INVESTIGATION_MAX_WALL_CLOCK_MS);
      expect(failOrRequeue).not.toHaveBeenCalled();
    },
  );

  test.each(SUBJECT_KINDS)(
    "a %s linked to a cluster and a resource gets both, cluster rules first",
    async (kind: SubjectKind) => {
      clusterStatuses.mockResolvedValue([clusterStatus()]);

      await investigate(kind);

      const request: InvestigationRequest = sentRequest(executeRun);

      expect(toolNames(request)).toEqual([
        LIST_CLUSTER_ACCESS_TOOL_NAME,
        RUN_KUBECTL_TOOL_NAME,
        LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
        RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
      ]);
      expect(request.additionalInstructions).toBe(
        `${ClusterAccessContext.buildPersonaAddendum([
          clusterStatus(),
        ])}\n\n${ResourceAccessContext.buildPersonaAddendum([
          resourceStatus(),
        ])}`,
      );

      const summary: string = request.contextSummary;
      expect(summary.indexOf("# Cluster access")).toBeGreaterThan(-1);
      expect(summary.indexOf("# Infrastructure access")).toBeGreaterThan(
        summary.indexOf("# Cluster access"),
      );
    },
  );

  test.each(SUBJECT_KINDS)(
    "a %s with no linked resource is wired exactly as before",
    async (kind: SubjectKind) => {
      clusterStatuses.mockResolvedValue([clusterStatus()]);
      resourceStatuses.mockResolvedValue([]);

      await investigate(kind);

      const request: InvestigationRequest = sentRequest(executeRun);

      expect(toolNames(request)).toEqual([
        LIST_CLUSTER_ACCESS_TOOL_NAME,
        RUN_KUBECTL_TOOL_NAME,
      ]);
      // Byte for byte the cluster addendum alone — nothing appended.
      expect(request.additionalInstructions).toBe(
        ClusterAccessContext.buildPersonaAddendum([clusterStatus()]),
      );
      expect(request.contextSummary).not.toContain("# Infrastructure access");
    },
  );

  test.each(SUBJECT_KINDS)(
    "a %s about nothing reachable carries no access wiring at all",
    async (kind: SubjectKind) => {
      resourceStatuses.mockResolvedValue([]);

      await investigate(kind);

      const request: InvestigationRequest = sentRequest(executeRun);
      expect(request.extraTools).toBeUndefined();
      expect(request.additionalInstructions).toBeUndefined();
      expect(request.contextSummary).not.toContain("# Infrastructure access");
      expect(request.contextSummary).not.toContain("# Cluster access");
    },
  );

  test.each(SUBJECT_KINDS)(
    "a %s linked only to a resource without an agent gets no tools, but is told why and what to install",
    async (kind: SubjectKind) => {
      resourceStatuses.mockResolvedValue([unreachableHost()]);

      await investigate(kind);

      const request: InvestigationRequest = sentRequest(executeRun);
      expect(request.extraTools).toBeUndefined();
      expect(request.additionalInstructions).toContain(
        'CANNOT inspect directly: Host "db-host"',
      );
      expect(request.additionalInstructions).toContain(
        "the operator should install the Host AI agent",
      );
      expect(request.contextSummary).toContain(
        "NO direct access — No Host AI agent is connected. Install the Host AI agent.",
      );
    },
  );

  test.each(SUBJECT_KINDS)(
    "a %s whose resource lookup fails keeps its cluster access and still runs",
    async (kind: SubjectKind) => {
      clusterStatuses.mockResolvedValue([clusterStatus()]);
      resourceStatuses.mockRejectedValue(new Error("database unavailable"));

      await investigate(kind);

      expect(executeRun).toHaveBeenCalledTimes(1);
      const request: InvestigationRequest = sentRequest(executeRun);
      expect(toolNames(request)).toEqual([
        LIST_CLUSTER_ACCESS_TOOL_NAME,
        RUN_KUBECTL_TOOL_NAME,
      ]);
      expect(request.additionalInstructions).toBe(
        ClusterAccessContext.buildPersonaAddendum([clusterStatus()]),
      );
      expect(request.contextSummary).not.toContain("# Infrastructure access");
      expect(failOrRequeue).not.toHaveBeenCalled();
    },
  );

  test.each(SUBJECT_KINDS)(
    "a %s whose cluster lookup fails keeps its infrastructure access",
    async (kind: SubjectKind) => {
      clusterStatuses.mockRejectedValue(new Error("cluster table unavailable"));

      await investigate(kind);

      const request: InvestigationRequest = sentRequest(executeRun);
      expect(toolNames(request)).toEqual([
        LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
        RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
      ]);
      expect(failOrRequeue).not.toHaveBeenCalled();
    },
  );

  test.each(SUBJECT_KINDS)(
    "a %s whose infrastructure context cannot be written drops the tools too, never the run",
    async (kind: SubjectKind) => {
      jest
        .spyOn(ResourceAccessContext, "buildContextSection")
        .mockImplementation((): string => {
          throw new Error("cannot render");
        });

      await investigate(kind);

      expect(executeRun).toHaveBeenCalledTimes(1);
      const request: InvestigationRequest = sentRequest(executeRun);
      expect(request.extraTools).toBeUndefined();
      expect(request.additionalInstructions).toBeUndefined();
      expect(failOrRequeue).not.toHaveBeenCalled();
    },
  );

  test("both runners wire the same infrastructure access for the same statuses", async () => {
    resourceStatuses.mockResolvedValue([resourceStatus(), unreachableHost()]);

    await investigate("incident");
    await investigate("alert");

    const incidentRequest: InvestigationRequest = (
      executeRun.mock.calls[0]![0] as { request: InvestigationRequest }
    ).request;
    const alertRequest: InvestigationRequest = (
      executeRun.mock.calls[1]![0] as { request: InvestigationRequest }
    ).request;

    expect(toolNames(alertRequest)).toEqual(toolNames(incidentRequest));
    expect(alertRequest.additionalInstructions).toBe(
      incidentRequest.additionalInstructions,
    );

    const block: (summary: string) => string = (summary: string): string => {
      return summary.slice(summary.indexOf("# Infrastructure access"));
    };
    expect(block(alertRequest.contextSummary)).toBe(
      block(incidentRequest.contextSummary),
    );
  });

  test.each(SUBJECT_KINDS)(
    "a %s investigation's infrastructure tools are bound to this run and its deadline",
    async (kind: SubjectKind) => {
      const NOW_MS: number = 1_700_000_000_000;
      const now: jest.SpyInstance = jest
        .spyOn(Date, "now")
        .mockReturnValue(NOW_MS);
      const enqueue: jest.SpyInstance = jest.spyOn(
        RunnerJobService,
        "enqueueAiResourceCommand",
      );

      await investigate(kind);

      const runCommand: ObservabilityAssistantExtraTool = (
        sentRequest(executeRun).extraTools || []
      ).find((tool: ObservabilityAssistantExtraTool) => {
        return tool.definition.name === RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME;
      })!;

      // The run's wall clock has run out: the toolkit refuses on its own.
      now.mockReturnValue(NOW_MS + INVESTIGATION_MAX_WALL_CLOCK_MS + 1);
      const outcome: ToolCallOutcome = await runCommand.execute({
        resourceId: DOCKER_ID,
        command: "docker ps -a",
        rationale: "see the containers",
      });

      expect(outcome.success).toBe(false);
      expect(outcome.textForLlm).toContain("Not enough time is left");
      expect(enqueue).not.toHaveBeenCalled();
    },
  );
});
