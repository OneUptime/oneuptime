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
import AIConfidenceSignal from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import {
  InvestigationEvidenceCheckedEntry,
  parseInvestigationReport,
  ParsedInvestigationReport,
} from "../../../../Utils/AI/InvestigationReport";
import ObservabilityAssistant, {
  ObservabilityAssistantExtraTool,
  ObservabilityAssistantRequest,
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

/*
 * IP-6: the report posted to the incident timeline describes a kubectl
 * call as a kubectl command — it succeeded, or kubectl returned an error —
 * never in rows, and the footer never counts cluster calls as queries run
 * across the customer's telemetry. The dashboard parses the same text, so
 * the server block must still read as the server's.
 */
describe("AIInvestigationEngine's posted report and kubectl", () => {
  function citation(
    id: string,
    toolName: string,
    rowCount: number,
    label: string,
  ): AIChatCitation {
    return { id, toolName, label, rowCount, queryArguments: {} };
  }

  function result(
    citations: Array<AIChatCitation>,
    toolCallCount: number,
  ): ObservabilityAssistantResult {
    return {
      contentInMarkdown: "**Summary** — the pod is pending [C1].",
      citations,
      totalTokens: 100,
      llmCallCount: 2,
      toolCallCount,
      modelName: "gpt-4.1-mini",
    };
  }

  const MIXED_CITATIONS: Array<AIChatCitation> = [
    citation("C1", "query_metrics", 5, "Max(latency)"),
    citation(
      "C2",
      RUN_KUBECTL_TOOL_NAME,
      0,
      'kubectl get pods -n web on cluster "prod-us"',
    ),
    citation(
      "C3",
      RUN_KUBECTL_TOOL_NAME,
      1,
      'kubectl describe pod web-1 -n web on cluster "prod-us"',
    ),
    citation(
      "C4",
      LIST_CLUSTER_ACCESS_TOOL_NAME,
      2,
      "Clusters OneUptime AI can inspect",
    ),
  ];

  test("describes each kubectl citation by its outcome, never in rows", () => {
    // 2 telemetry queries; 1 listing + 3 run_kubectl (one never ran).
    const markdown: string = AIInvestigationEngine.buildBrandedMarkdown(
      result(MIXED_CITATIONS, 6),
      "**Summary** — the pod is pending [C1].",
      4,
    );

    expect(markdown).toContain(
      '- **[C2]** kubectl get pods -n web on cluster "prod-us" — kubectl returned an error',
    );
    expect(markdown).toContain(
      '- **[C3]** kubectl describe pod web-1 -n web on cluster "prod-us" — succeeded',
    );
    expect(markdown).toContain(
      "- **[C4]** Clusters OneUptime AI can inspect — 2 cluster(s)",
    );
    // Negative control: a telemetry query keeps its rows.
    expect(markdown).toContain("- **[C1]** Max(latency) — 5 row(s)");
    expect(markdown).not.toMatch(/kubectl[^\n]*row\(s\)/);
    expect(markdown).not.toMatch(/Clusters OneUptime AI can inspect — 2 row/);
  });

  test("counts telemetry queries and kubectl commands apart in the footer", () => {
    const markdown: string = AIInvestigationEngine.buildBrandedMarkdown(
      result(MIXED_CITATIONS, 6),
      "**Summary** — x.",
      4,
    );

    expect(markdown).toContain(
      "*Investigated automatically by OneUptime AI — read-only, 2 queries run across your own telemetry and 2 kubectl commands run on your Kubernetes clusters using gpt-4.1-mini. This is an AI-generated first pass; verify before acting.*",
    );
    expect(markdown).not.toContain("6 queries");
  });

  // Negative control: a telemetry-only report is unchanged.
  test("keeps the telemetry-only footer as it was", () => {
    const markdown: string = AIInvestigationEngine.buildBrandedMarkdown(
      result([citation("C1", "search_logs", 3, "Logs")], 1),
      "**Summary** — x.",
    );

    expect(markdown).toContain("- **[C1]** Logs — 3 row(s)");
    expect(markdown).toContain(
      "— read-only, 1 query run across your own telemetry using gpt-4.1-mini.",
    );
  });

  test("never says 0 queries for a report built only from kubectl", () => {
    const markdown: string = AIInvestigationEngine.buildBrandedMarkdown(
      result(
        [
          citation(
            "C1",
            RUN_KUBECTL_TOOL_NAME,
            1,
            'kubectl describe pod web-1 -n web on cluster "prod-us"',
          ),
        ],
        1,
      ),
      "**Summary** — x [C1].",
      1,
    );

    expect(markdown).toContain(
      "— read-only, 1 kubectl command run on your Kubernetes clusters using gpt-4.1-mini.",
    );
    expect(markdown).not.toContain("quer");
  });

  test("names neither when the cluster calls ran nothing and no telemetry was queried", () => {
    const markdown: string = AIInvestigationEngine.buildBrandedMarkdown(
      result(
        [
          citation(
            "C1",
            LIST_CLUSTER_ACCESS_TOOL_NAME,
            1,
            "Clusters OneUptime AI can inspect",
          ),
        ],
        2,
      ),
      "**Summary** — x.",
      2,
    );

    expect(markdown).toContain(
      "— read-only, no telemetry queries or kubectl commands run using gpt-4.1-mini.",
    );
  });

  /*
   * The dashboard reads the posted text back: a footer whose query count
   * is 0, or lower than the block's row entries, makes the block the
   * model's. Every shape above must still be the server's block.
   */
  test.each<[string, Array<AIChatCitation>, number, number]>([
    ["mixed", MIXED_CITATIONS, 6, 4],
    [
      "kubectl only",
      [
        citation("C1", RUN_KUBECTL_TOOL_NAME, 1, "kubectl get pods"),
        citation("C2", RUN_KUBECTL_TOOL_NAME, 0, "kubectl get nodes"),
      ],
      2,
      2,
    ],
    [
      "a cluster listing only",
      [citation("C1", LIST_CLUSTER_ACCESS_TOOL_NAME, 1, "Clusters")],
      1,
      1,
    ],
    ["telemetry only", [citation("C1", "search_logs", 3, "Logs")], 1, 0],
  ])(
    "keeps the %s evidence block the server's when the dashboard parses it",
    (
      _label: string,
      citations: Array<AIChatCitation>,
      toolCallCount: number,
      clusterToolCallCount: number,
    ) => {
      const report: ParsedInvestigationReport = parseInvestigationReport(
        AIInvestigationEngine.buildBrandedMarkdown(
          result(citations, toolCallCount),
          "**Summary** — the pod is pending.\n\n**Most likely root cause** — x.",
          clusterToolCallCount,
        ),
      );

      expect(report.bodyMarkdown).not.toContain("Evidence checked");
      expect(report.footer?.modelName).toBe("gpt-4.1-mini");
      /*
       * A run without evidence items shows only what the parser reads
       * back: every cited call — kubectl and cluster listings included —
       * stays an evidence line.
       */
      expect(
        report.evidenceChecked.map(
          (entry: InvestigationEvidenceCheckedEntry): string => {
            return entry.citationId;
          },
        ),
      ).toEqual(
        citations.map((cited: AIChatCitation): string => {
          return cited.id;
        }),
      );
    },
  );

  test("the engine posts the report with the cluster calls it counted", async () => {
    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockResolvedValue({} as unknown as AIRunEvent);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    jest
      .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
      .mockResolvedValue({
        confident: true,
        codeFixRecommended: false,
        source: "classification",
      });
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockImplementation(
        async (
          data: ObservabilityAssistantRequest,
        ): Promise<ObservabilityAssistantResult> => {
          for (const toolName of [
            "query_metrics",
            LIST_CLUSTER_ACCESS_TOOL_NAME,
            RUN_KUBECTL_TOOL_NAME,
            RUN_KUBECTL_TOOL_NAME,
          ]) {
            await data.onStep!({ type: "tool_started", toolName });
          }
          return result(
            [
              citation("C1", "query_metrics", 5, "Max(latency)"),
              citation("C2", RUN_KUBECTL_TOOL_NAME, 1, "kubectl get pods"),
            ],
            4,
          );
        },
      );
    const postAnalysis: jest.Mock = jest.fn(async (): Promise<void> => {});

    try {
      await AIInvestigationEngine.executeRun({
        aiRunId,
        projectId,
        attemptCount: 1,
        request: {
          feature: "Test Investigation",
          contextSummary: "# Subject",
          postAnalysis:
            postAnalysis as unknown as InvestigationRequest["postAnalysis"],
        },
      });

      expect(postAnalysis).toHaveBeenCalledTimes(1);
      const posted: string = (
        postAnalysis.mock.calls[0]![0] as { analysisMarkdown: string }
      ).analysisMarkdown;
      expect(posted).toContain(
        "read-only, 1 query run across your own telemetry and 1 kubectl command run on your Kubernetes clusters",
      );
      expect(posted).toContain("- **[C2]** kubectl get pods — succeeded");
    } finally {
      jest.restoreAllMocks();
    }
  });
});
