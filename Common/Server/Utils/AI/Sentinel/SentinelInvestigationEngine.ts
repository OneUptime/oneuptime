import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import {
  AIChatCitation,
  AIRunEventResultSummary,
} from "../../../../Types/AI/AIChatTypes";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import Project from "../../../../Models/DatabaseModels/Project";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import AIRunService from "../../../Services/AIRunService";
import AIRunEventService from "../../../Services/AIRunEventService";
import ProjectService from "../../../Services/ProjectService";
import LlmProviderService from "../../../Services/LlmProviderService";
import SentinelInvestigationQueue from "./InvestigationQueue";
import SentinelConfidenceSignal, { ConfidenceSignal } from "./ConfidenceSignal";
import ObservabilityAssistant, {
  ObservabilityAssistantResult,
  ObservabilityAssistantStep,
  ObservabilityAssistantStepType,
} from "../Chat/ObservabilityAssistant";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Sentinel — the shared autonomous-investigation engine.
 *
 * A single subject-agnostic core that powers "wake on signal" investigations
 * for both incidents and alerts (and, later, anomalies). It:
 *   1. records the run as an AIRun(Investigation) + AIRunEvents (audit trail),
 *   2. runs the existing read-only, tool-grounded, citation-minting agent loop
 *      (ObservabilityAssistant) with the Sentinel persona and a larger budget,
 *   3. brands the cited analysis, judges confidence via the structured
 *      ConfidenceSignal (deterministic evidence floor + one constrained
 *      classification call — G6: no control flow from free-form prose), and
 *   4. hands the finished analysis back to the caller to post to the subject's
 *      timeline.
 *
 * The investigation is strictly READ-ONLY: it can never mutate anything.
 * Enablement + provider gating is shared via isEnabledForProject().
 */

// Budgets — larger than an interactive chat-ops answer, small enough to stay cheap.
const MAX_LLM_CALLS: number = 8;
const MAX_TOOL_CALLS: number = 12;
const MAX_WALL_CLOCK_MS: number = 150 * 1000;
const MAX_OUTPUT_TOKENS: number = 2000;

/*
 * Failures a retry cannot fix within the run's usefulness window: missing/
 * broken provider configuration and budget exhaustion (both messages minted
 * by our own gating in AIService/LLMService, so they are stable to match).
 */
const PERMANENT_FAILURE_RE: RegExp =
  /no llm provider configured|llm provider type is not configured|token budget exhausted/i;

// Maps a live agent step to the AIRunEvent type persisted for the glass-box trail.
const STEP_EVENT_TYPE: Record<ObservabilityAssistantStepType, AIRunEventType> =
  {
    llm_started: AIRunEventType.LlmCallStarted,
    llm_completed: AIRunEventType.LlmCallCompleted,
    tool_started: AIRunEventType.ToolCallStarted,
    tool_completed: AIRunEventType.ToolCallCompleted,
    tool_failed: AIRunEventType.ToolCallFailed,
  };

const INVESTIGATION_PERSONA: string = `You are "Sentinel", OneUptime's autonomous AI Site Reliability Engineer. You have been woken automatically because a NEW signal (an incident or alert) was just declared in this project — no human has asked you a question yet. Investigate it proactively and produce a first-pass root cause analysis that the on-call engineer will read the moment they are paged.

Investigate like a senior on-call engineer:
- Start from the affected monitors/services named in the signal.
- Use your read tools to inspect the telemetry AROUND the signal's creation time: recent exceptions and their trends, error/latency metrics versus their normal range (use baseline_anomaly to judge a metric against its learned hour-of-week baseline quantitatively instead of eyeballing), failing traces, relevant logs, and recent changes / deploys.
- Form the single most likely root-cause hypothesis. If the evidence is inconclusive, say so plainly and list what you checked — do NOT guess a cause the data does not support.
- If the context lists past resolved incidents, check whether this is a RECURRENCE. If the current signal matches one, say so explicitly, reference that incident number, and note how it was resolved before — but still verify against the current telemetry.

Write your final answer as a concise incident-response note with exactly these sections (use these markdown headings):
**Summary** — one or two sentences a paged engineer can read in five seconds.
**Most likely root cause** — your hypothesis, with only the confidence the evidence actually supports, each factual claim carrying its [C#] citation. If you could not determine it, say so plainly and explain what is missing.
**Evidence** — the key findings that support or rule out the hypothesis, each cited.
**Suggested next steps** — concrete actions for the on-call engineer.

Keep it tight and skimmable. You are read-only: never claim to have changed anything.`;

// Which signal an investigation is about — each has its own per-project opt-in.
export type SentinelSubjectType = "Incident" | "Alert";

export interface InvestigationRequest {
  // Label recorded on LlmLog, e.g. "Sentinel Incident Investigation".
  feature: string;
  // A compact markdown summary of the subject that seeds the investigation.
  contextSummary: string;
  /*
   * Called with the finished, branded, cited analysis so the caller can post
   * it to the subject's timeline. `confidence` is the structured,
   * server-verified G6 signal (see ConfidenceSignal.ts) — callers must route
   * every control-flow decision through its helpers
   * (shouldSendWorkspaceNotification / shouldEnqueueInstrumentationTask),
   * never through the analysis prose; the helpers encode each consumer's
   * fail direction when the classification itself failed.
   */
  postAnalysis: (data: {
    analysisMarkdown: string;
    confidence: ConfidenceSignal;
    result: ObservabilityAssistantResult;
  }) => Promise<void>;
}

export default class SentinelInvestigationEngine {
  /*
   * Shared gate: AI enabled, the subject's auto-investigation opt-in on, and an
   * LLM provider configured. Incidents and alerts each have their own opt-in so
   * they can be enabled independently. Runs before any (subject-specific)
   * context assembly.
   */
  @CaptureSpan()
  public static async isEnabledForProject(
    projectId: ObjectID,
    subjectType: SentinelSubjectType,
  ): Promise<boolean> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        enableAi: true,
        enableAutomaticIncidentInvestigation: true,
        enableAutomaticAlertInvestigation: true,
      },
      props: { isRoot: true },
    });

    if (!project) {
      return false;
    }

    if (project.enableAi === false) {
      return false;
    }

    const isOptedIn: boolean =
      subjectType === "Alert"
        ? project.enableAutomaticAlertInvestigation === true
        : project.enableAutomaticIncidentInvestigation === true;

    if (!isOptedIn) {
      return false;
    }

    const llmProvider: LlmProvider | null =
      await LlmProviderService.getLLMProviderForProject(projectId);

    if (!llmProvider) {
      logger.debug(
        `Sentinel: skipping investigation for project ${projectId.toString()} — no LLM provider configured.`,
      );
      return false;
    }

    return true;
  }

  /*
   * Execute an already-CLAIMED (Running) investigation run end-to-end.
   * Called by SentinelInvestigationQueue after a successful CAS claim —
   * cap/budget gating and run creation live in the queue now. Never throws;
   * failures are handed to the queue's retry policy (failOrRequeue).
   */
  @CaptureSpan()
  public static async executeRun(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    attemptCount: number;
    request: InvestigationRequest;
  }): Promise<void> {
    const { aiRunId, projectId, request } = data;

    /*
     * Retried runs already have events from earlier attempts; continue the
     * sequence so the glass-box trail stays ordered and shows every attempt.
     */
    let sequence: number = 0;
    try {
      sequence = (
        await AIRunEventService.countBy({
          query: { aiRunId },
          props: { isRoot: true },
        })
      ).toNumber();
    } catch (error) {
      logger.error(
        `Sentinel: failed to read event count for run ${aiRunId.toString()}; starting sequence at 0: ${error}`,
      );
    }

    await this.emitEvent({
      projectId,
      aiRunId,
      sequence: sequence++,
      eventType: AIRunEventType.RunStarted,
    });

    /*
     * Live narration: persist each LLM/tool step as an AIRunEvent so the UI can
     * "watch it think" by polling the run's events. Best-effort, ordered.
     */
    const onStep: (step: ObservabilityAssistantStep) => Promise<void> = async (
      step: ObservabilityAssistantStep,
    ): Promise<void> => {
      const resultSummary: AIRunEventResultSummary | undefined =
        step.rowCount !== undefined ||
        step.durationMs !== undefined ||
        step.errorMessage !== undefined
          ? {
              rowCount: step.rowCount,
              durationInMs: step.durationMs,
              errorMessage: step.errorMessage,
            }
          : undefined;

      await this.emitEvent({
        projectId,
        aiRunId,
        sequence: sequence++,
        eventType: STEP_EVENT_TYPE[step.type],
        toolName: step.toolName,
        toolArguments: step.toolArguments,
        resultSummary,
        citationId: step.citationId,
      });

      /*
       * Keep the run visibly alive for the stale-run sweeper + live UI on
       * EVERY step — a slow self-hosted LLM call can approach the sweeper's
       * timeout, so the heartbeat must be as frequent as we can make it.
       */
      await this.touchHeartbeat(aiRunId);
    };

    try {
      const result: ObservabilityAssistantResult =
        await ObservabilityAssistant.answerQuestion({
          projectId,
          // System run — full read access to the project's telemetry.
          props: { isRoot: true },
          feature: request.feature,
          systemInstructions: INVESTIGATION_PERSONA,
          question: `A new signal has just been declared and you have been woken to investigate it. Investigate now and produce your root cause analysis.\n\n${request.contextSummary}`,
          maxLlmCalls: MAX_LLM_CALLS,
          maxToolCalls: MAX_TOOL_CALLS,
          maxWallClockMs: MAX_WALL_CLOCK_MS,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          onStep,
        });

      /*
       * Atomic Running -> Completed. If we did NOT win this transition,
       * another actor moved the run while we executed — most likely the
       * stale sweeper falsely requeued it (slow LLM call outlasting the
       * heartbeat window) and a second attempt is or will be running. In
       * that case DO NOT post the analysis: the winning attempt will, and
       * posting here would duplicate the RCA in the feed and workspace.
       */
      const completedCount: number = await AIRunService.attemptStatusTransition(
        {
          aiRunId,
          fromStatus: AIRunStatus.Running,
          set: {
            status: AIRunStatus.Completed,
            completedAt: OneUptimeDate.getCurrentDate(),
            lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
            llmCallCount: result.llmCallCount,
            toolCallCount: result.toolCallCount,
            totalTokens: result.totalTokens,
          },
        },
      );

      if (completedCount === 0) {
        logger.warn(
          `Sentinel: run ${aiRunId.toString()} finished but was no longer Running (likely requeued as stale mid-flight); skipping postAnalysis to avoid a duplicate RCA.`,
        );
        return;
      }

      await this.emitEvent({
        projectId,
        aiRunId,
        sequence: sequence++,
        eventType: AIRunEventType.RunCompleted,
      });

      const analysis: string = (result.contentInMarkdown || "").trim();

      if (!analysis) {
        logger.debug(
          `Sentinel: investigation (run ${aiRunId.toString()}) produced no analysis; nothing posted.`,
        );
        return;
      }

      /*
       * G6: judge confidence via the structured signal — the deterministic
       * evidence floor over this run's own server-minted citations, then
       * (only when the floor passes) one constrained classification call.
       * Budget accounting: that call fires AFTER the agent loop finished, so
       * it is deliberately OUTSIDE the per-run caps above (MAX_LLM_CALLS /
       * MAX_OUTPUT_TOKENS govern the loop, whose counts were already
       * persisted at the Completed transition). It is still metered in
       * LlmLog under an AUTONOMOUS_AI_FEATURES feature, so the G4 daily
       * autonomous budget covers it; a budget rejection degrades the signal
       * to "classification-failed" — never a run failure. Running it after
       * the WON Completed transition also means a falsely-requeued duplicate
       * attempt can never double-spend it.
       */
      const confidence: ConfidenceSignal =
        await SentinelConfidenceSignal.computeConfidenceSignal({
          projectId,
          aiRunId,
          analysisMarkdown: analysis,
          evidence: SentinelConfidenceSignal.evidenceFromCitations(
            result.citations || [],
          ),
        });

      await request.postAnalysis({
        analysisMarkdown: this.buildBrandedMarkdown(result, analysis),
        confidence,
        result,
      });

      logger.debug(
        `Sentinel: investigation complete (run ${aiRunId.toString()}, confident=${confidence.confident} via ${confidence.source}, ${result.llmCallCount} LLM calls, ${result.toolCallCount} tools, ${result.totalTokens} tokens).`,
      );
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      await this.emitEvent({
        projectId,
        aiRunId,
        sequence: sequence++,
        eventType: AIRunEventType.RunFailed,
      });

      /*
       * Hand the failure to the queue's retry policy: transient errors
       * requeue while attempts remain; permanent ones finalize as Error
       * since retrying cannot help. Classification is by message, NOT by
       * exception type: LLMService wraps transient provider failures (429s,
       * 5xx, timeouts) in BadDataException too, so type-based classification
       * would wrongly make the exact failures retries exist for permanent.
       * Only configuration/budget gating — which a retry cannot change
       * within the run's usefulness window — counts as permanent.
       */
      await SentinelInvestigationQueue.failOrRequeue({
        aiRunId,
        attemptCount: data.attemptCount,
        errorMessage: message,
        isPermanent: PERMANENT_FAILURE_RE.test(message),
      });

      logger.error(
        `Sentinel: investigation attempt ${data.attemptCount} failed (run ${aiRunId.toString()}): ${message}`,
      );
    }
  }

  // Wrap the agent's analysis with Sentinel branding + an evidence list.
  private static buildBrandedMarkdown(
    result: ObservabilityAssistantResult,
    analysisMarkdown: string,
  ): string {
    let markdown: string = `## 🧠 Sentinel — Automated Root Cause Analysis\n\n${analysisMarkdown}`;

    const citations: Array<AIChatCitation> = result.citations || [];

    if (citations.length > 0) {
      markdown += `\n\n**Evidence checked**`;
      for (const citation of citations.slice(0, 15)) {
        markdown += `\n- **[${citation.id}]** ${citation.label} — ${citation.rowCount} row(s)`;
      }
    }

    markdown += `\n\n---\n*Investigated automatically by OneUptime Sentinel — read-only, ${result.toolCallCount} quer${
      result.toolCallCount === 1 ? "y" : "ies"
    } run across your own telemetry${
      result.modelName ? ` using ${result.modelName}` : ""
    }. This is an AI-generated first pass; verify before acting.*`;

    return markdown;
  }

  // Refresh lastHeartbeatAt so a long-running investigation isn't swept as stale.
  private static async touchHeartbeat(aiRunId: ObjectID): Promise<void> {
    try {
      await AIRunService.updateOneBy({
        query: { _id: aiRunId.toString(), status: AIRunStatus.Running },
        data: {
          lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
        } as never,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(`Sentinel: heartbeat update failed: ${error}`);
    }
  }

  private static async emitEvent(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    sequence: number;
    eventType: AIRunEventType;
    toolName?: string | undefined;
    toolArguments?: JSONObject | undefined;
    resultSummary?: AIRunEventResultSummary | undefined;
    citationId?: string | undefined;
  }): Promise<void> {
    try {
      const event: AIRunEvent = new AIRunEvent();
      event.projectId = data.projectId;
      event.aiRunId = data.aiRunId;
      event.sequence = data.sequence;
      event.eventType = data.eventType;

      if (data.toolName) {
        event.toolName = data.toolName;
      }
      if (data.toolArguments) {
        event.toolArguments = data.toolArguments;
      }
      if (data.resultSummary) {
        event.resultSummary = data.resultSummary;
      }
      if (data.citationId) {
        event.citationId = data.citationId;
      }

      await AIRunEventService.create({
        data: event,
        props: { isRoot: true },
      });
    } catch (error) {
      // Events are best-effort telemetry — never fail the run because of them.
      logger.error(`Sentinel: failed to emit AIRunEvent: ${error}`);
    }
  }
}
