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
import ObservabilityAssistant, {
  ObservabilityAssistantExtraTool,
  ObservabilityAssistantResult,
  ObservabilityAssistantStep,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import {
  INVESTIGATION_MAX_WALL_CLOCK_MS,
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../../Server/Utils/AI/ClusterAccess/KubectlInvestigationToolkit";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import Incident from "../../../../Models/DatabaseModels/Incident";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Cluster access reaches an investigation through four separate wires, and
 * losing any one of them is silent — the run still reports, it just stops
 * inspecting the cluster (or starts doing so without telling the model the
 * rules):
 *
 *   1. extraTools: list_cluster_access + run_kubectl, only for a cluster
 *      that is investigation-ready;
 *   2. additionalInstructions: the persona addendum naming the clusters;
 *   3. the "# Cluster access" block of the context summary;
 *   4. maxWallClockMs: the SAME wall clock the kubectl toolkit plans every
 *      command's wait against.
 *
 * The incident and alert runners are separate code paths, so both are
 * pinned — and pinned to wire the same thing. A failed access lookup never
 * fails the run: it degrades to a telemetry-only investigation.
 */

const projectId: ObjectID = ObjectID.generate();
const aiRunId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const CLUSTER_ID: string = "33333333-3333-4333-8333-333333333333";
const RUNNER_ID: string = "44444444-4444-4444-8444-444444444444";

type SubjectKind = "incident" | "alert";

const SUBJECT_KINDS: Array<SubjectKind> = ["incident", "alert"];

function readyStatus(
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
      posture: { inCluster: true, allowWrites: false },
    },
    accessMethod: "in_cluster",
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
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
    incident.title = "Pods stuck in Pending";
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
  alert.title = "[K8s] Pods Stuck in Pending";
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

describe("Investigation runners wire cluster access", () => {
  let executeRun: jest.SpyInstance;
  let getStatuses: jest.SpyInstance;
  let failOrRequeue: jest.SpyInstance;

  beforeEach(() => {
    executeRun = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);
    getStatuses = jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([readyStatus()]);
    failOrRequeue = jest
      .spyOn(AIInvestigationQueue, "failOrRequeue")
      .mockResolvedValue("noop");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(SUBJECT_KINDS)(
    "a %s investigation gets the kubectl tools, the persona addendum, the context block and the shared wall clock",
    async (kind: SubjectKind) => {
      await investigate(kind);

      expect(getStatuses).toHaveBeenCalledWith(
        kind === "incident"
          ? { projectId, incidentId }
          : { projectId, alertId },
      );
      expect(executeRun).toHaveBeenCalledTimes(1);

      const request: InvestigationRequest = sentRequest(executeRun);
      expect(toolNames(request)).toEqual([
        LIST_CLUSTER_ACCESS_TOOL_NAME,
        RUN_KUBECTL_TOOL_NAME,
      ]);
      expect(request.additionalInstructions).toContain(
        'can inspect directly: "prod-us"',
      );
      expect(request.contextSummary).toContain("# Cluster access");
      expect(request.contextSummary).toContain(
        `- Cluster "prod-us" (clusterId: ${CLUSTER_ID}): kubectl READ access available via run_kubectl`,
      );
      expect(request.maxWallClockMs).toBe(INVESTIGATION_MAX_WALL_CLOCK_MS);
      expect(failOrRequeue).not.toHaveBeenCalled();
    },
  );

  test("both runners wire the same cluster access for the same statuses", async () => {
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
    expect(alertRequest.maxWallClockMs).toBe(incidentRequest.maxWallClockMs);

    const clusterBlock: (summary: string) => string = (
      summary: string,
    ): string => {
      return summary.slice(summary.indexOf("# Cluster access"));
    };
    expect(clusterBlock(alertRequest.contextSummary)).toBe(
      clusterBlock(incidentRequest.contextSummary),
    );
  });

  test.each(SUBJECT_KINDS)(
    "a %s investigation's kubectl tools are bound to this run and its deadline",
    async (kind: SubjectKind) => {
      const NOW_MS: number = 1_700_000_000_000;
      const now: jest.SpyInstance = jest
        .spyOn(Date, "now")
        .mockReturnValue(NOW_MS);
      const enqueue: jest.SpyInstance = jest.spyOn(
        RunnerJobService,
        "enqueueAiKubectlCommand",
      );

      await investigate(kind);

      const runKubectl: ObservabilityAssistantExtraTool = (
        sentRequest(executeRun).extraTools || []
      ).find((tool: ObservabilityAssistantExtraTool) => {
        return tool.definition.name === RUN_KUBECTL_TOOL_NAME;
      })!;

      // The run's wall clock has run out: the toolkit refuses on its own.
      now.mockReturnValue(NOW_MS + INVESTIGATION_MAX_WALL_CLOCK_MS + 1);
      const outcome: ToolCallOutcome = await runKubectl.execute({
        clusterId: CLUSTER_ID,
        command: "kubectl get pods -n web",
        rationale: "see pod phases",
      });

      expect(outcome.success).toBe(false);
      expect(outcome.textForLlm).toContain("Not enough time is left");
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  test.each(SUBJECT_KINDS)(
    "a %s linked only to an unreachable cluster gets no tools, but is told why",
    async (kind: SubjectKind) => {
      getStatuses.mockResolvedValue([
        readyStatus({
          isInvestigationReady: false,
          runner: null,
          accessMethod: "none",
          gaps: [
            {
              code: "no_runner_bound",
              title: "No Runner can reach this cluster",
              description: "None is bound.",
              nextStep: "Install the in-cluster Runner.",
              blocks: "both",
            },
          ],
        }),
      ]);

      await investigate(kind);

      const request: InvestigationRequest = sentRequest(executeRun);
      expect(request.extraTools).toBeUndefined();
      expect(request.additionalInstructions).toContain(
        'CANNOT reach with kubectl: "prod-us"',
      );
      expect(request.contextSummary).toContain(
        "NO kubectl access — No Runner can reach this cluster",
      );
      expect(request.maxWallClockMs).toBe(INVESTIGATION_MAX_WALL_CLOCK_MS);
    },
  );

  test.each(SUBJECT_KINDS)(
    "a %s whose access lookup fails is investigated with OneUptime data only, never failed",
    async (kind: SubjectKind) => {
      getStatuses.mockRejectedValue(new Error("database unavailable"));

      await investigate(kind);

      expect(executeRun).toHaveBeenCalledTimes(1);
      const request: InvestigationRequest = sentRequest(executeRun);
      expect(request.extraTools).toBeUndefined();
      expect(request.additionalInstructions).toBeUndefined();
      expect(request.contextSummary).not.toContain("# Cluster access");
      expect(request.maxWallClockMs).toBe(INVESTIGATION_MAX_WALL_CLOCK_MS);
      expect(failOrRequeue).not.toHaveBeenCalled();
    },
  );

  test.each(SUBJECT_KINDS)(
    "a %s about no cluster carries no cluster wiring at all",
    async (kind: SubjectKind) => {
      getStatuses.mockResolvedValue([]);

      await investigate(kind);

      const request: InvestigationRequest = sentRequest(executeRun);
      expect(request.extraTools).toBeUndefined();
      expect(request.additionalInstructions).toBeUndefined();
      expect(request.contextSummary).not.toContain("# Cluster access");
    },
  );
});

/*
 * additionalInstructions is how the cluster rules reach the model. It is
 * appended to whichever persona the run uses — the default investigator,
 * or a remediation run's override — and leaves the persona alone when
 * absent.
 */
describe("AIInvestigationEngine appends additionalInstructions to the persona", () => {
  let answerQuestion: jest.SpyInstance;
  let createEvent: jest.SpyInstance;

  function makeResult(): ObservabilityAssistantResult {
    return {
      contentInMarkdown: "**Summary** — the root cause.",
      citations: [],
      totalTokens: 100,
      llmCallCount: 1,
      toolCallCount: 0,
    };
  }

  function executeRun(overrides: Partial<InvestigationRequest>): Promise<void> {
    return AIInvestigationEngine.executeRun({
      aiRunId,
      projectId,
      attemptCount: 1,
      request: {
        feature: "Test Investigation",
        contextSummary: "# Subject",
        postAnalysis: async (): Promise<void> => {},
        ...overrides,
      },
    });
  }

  function systemInstructions(): string {
    return (answerQuestion.mock.calls[0]![0] as { systemInstructions: string })
      .systemInstructions;
  }

  beforeEach(() => {
    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    createEvent = jest
      .spyOn(AIRunEventService, "create")
      .mockResolvedValue({} as unknown as AIRunEvent);
    jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    answerQuestion = jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(makeResult());
    // A lost Completed transition ends the run before any posting.
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("appended to the default persona", async () => {
    await executeRun({ additionalInstructions: "CLUSTER RULES" });

    expect(systemInstructions()).toContain("You are OneUptime AI");
    expect(systemInstructions().endsWith("\n\nCLUSTER RULES")).toBe(true);
  });

  test("appended to a persona override", async () => {
    await executeRun({
      personaOverride: "REMEDIATION PERSONA",
      additionalInstructions: "CLUSTER RULES",
    });

    expect(systemInstructions()).toBe("REMEDIATION PERSONA\n\nCLUSTER RULES");
  });

  test("the persona is unchanged without additional instructions", async () => {
    await executeRun({});
    const defaultPersona: string = systemInstructions();

    answerQuestion.mockClear();
    await executeRun({ personaOverride: "REMEDIATION PERSONA" });

    expect(defaultPersona).toContain("You are OneUptime AI");
    expect(defaultPersona.endsWith("\n\n")).toBe(false);
    expect(defaultPersona).not.toContain("undefined");
    expect(systemInstructions()).toBe("REMEDIATION PERSONA");
  });

  /*
   * The persisted trail is what the panel counts kubectl from: a command
   * that ran is a ToolCallCompleted with its rowCount (1 succeeded, 0
   * kubectl returned an error); one that never ran is a ToolCallFailed
   * carrying the toolkit's category message — never a citation.
   */
  test("persists a kubectl call that ran as completed and one that never ran as failed", async () => {
    answerQuestion.mockImplementation(
      async (data: {
        onStep: (step: ObservabilityAssistantStep) => Promise<void>;
      }): Promise<ObservabilityAssistantResult> => {
        await data.onStep({
          type: "tool_completed",
          toolName: RUN_KUBECTL_TOOL_NAME,
          rowCount: 0,
          citationId: "C1",
          citationLabel: 'kubectl get pods -n web on cluster "prod-us"',
        });
        await data.onStep({
          type: "tool_failed",
          toolName: RUN_KUBECTL_TOOL_NAME,
          errorMessage:
            'kubectl was not run on cluster "prod-us": its Runner did not pick up the command in time.',
        });
        return makeResult();
      },
    );

    await executeRun({});

    const events: Array<AIRunEvent> = createEvent.mock.calls.map(
      (call: Array<unknown>): AIRunEvent => {
        return (call[0] as { data: AIRunEvent }).data;
      },
    );
    const completed: AIRunEvent | undefined = events.find(
      (event: AIRunEvent) => {
        return event.eventType === AIRunEventType.ToolCallCompleted;
      },
    );
    const failed: AIRunEvent | undefined = events.find((event: AIRunEvent) => {
      return event.eventType === AIRunEventType.ToolCallFailed;
    });

    expect(completed?.toolName).toBe(RUN_KUBECTL_TOOL_NAME);
    expect(completed?.resultSummary?.rowCount).toBe(0);
    expect(completed?.citationId).toBe("C1");
    expect(failed?.toolName).toBe(RUN_KUBECTL_TOOL_NAME);
    expect(failed?.citationId).toBeUndefined();
    expect(failed?.resultSummary?.errorMessage).toBe(
      'kubectl was not run on cluster "prod-us": its Runner did not pick up the command in time.',
    );
  });
});
