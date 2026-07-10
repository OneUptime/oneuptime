import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import {
  AIChatCitation,
  AIRunEventResultSummary,
} from "../../../../Types/AI/AIChatTypes";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import Project from "../../../../Models/DatabaseModels/Project";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import AIRunService from "../../../Services/AIRunService";
import AIRunEventService from "../../../Services/AIRunEventService";
import ProjectService from "../../../Services/ProjectService";
import LlmProviderService from "../../../Services/LlmProviderService";
import AIService, { AutonomousBudgetStatus } from "../../../Services/AIService";
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
 *   3. brands the cited analysis, judges confidence, and
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
 * G4 cost guardrail: at most this many investigations may be Running per
 * project at once. An alert storm then costs at most this many concurrent
 * runs; the skipped signals still get their normal (non-AI) handling. Stuck
 * runs can't pin the cap forever — the 12-min stale sweeper releases them.
 */
const MAX_CONCURRENT_INVESTIGATIONS_PER_PROJECT: number = 3;

/*
 * Sentinel's own contract: it writes exactly this phrase when it cannot
 * determine a cause. We match it deterministically to drive "quiet mode" —
 * a non-answer should never loudly page the on-call.
 */
const INCONCLUSIVE_RE: RegExp = /inconclusive[^.\n]*insufficient signal/i;

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
**Most likely root cause** — your hypothesis, with only the confidence the evidence actually supports, each factual claim carrying its [C#] citation. If you could not determine it, write "Inconclusive — insufficient signal" and explain what is missing.
**Evidence** — the key findings that support or rule out the hypothesis, each cited.
**Suggested next steps** — concrete actions for the on-call engineer.

Keep it tight and skimmable. You are read-only: never claim to have changed anything.`;

// Which signal an investigation is about — each has its own per-project opt-in.
export type SentinelSubjectType = "Incident" | "Alert";

export interface InvestigationRequest {
  projectId: ObjectID;
  // Label recorded on LlmLog, e.g. "Sentinel Incident Investigation".
  feature: string;
  // A compact markdown summary of the subject that seeds the investigation.
  contextSummary: string;
  /*
   * The subject that triggered this run — links the AIRun so the live panel can
   * find "the investigation for this incident/alert". Exactly one is set.
   */
  subjectIncidentId?: ObjectID | undefined;
  subjectAlertId?: ObjectID | undefined;
  /*
   * The monitor behind the subject alert, when there is one — recorded on the
   * AIRun as the dedupe key for the per-monitor investigation window.
   */
  subjectMonitorId?: ObjectID | undefined;
  /*
   * Called with the finished, branded, cited analysis so the caller can post it
   * to the subject's timeline. `isConfident` is false when Sentinel reported it
   * could not determine the cause — callers use it to post QUIETLY (no loud
   * workspace ping) rather than paging a non-answer.
   */
  postAnalysis: (data: {
    analysisMarkdown: string;
    isConfident: boolean;
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
   * Run one investigation end-to-end. Never throws — failures are logged and
   * recorded on the AIRun.
   */
  @CaptureSpan()
  public static async investigate(
    request: InvestigationRequest,
  ): Promise<void> {
    const { projectId } = request;

    /*
     * G4 concurrency cap. The count-then-create is not atomic, so a burst of
     * simultaneous triggers can briefly overshoot by a run or two — acceptable
     * for a cost guardrail; the cap bounds sustained concurrency.
     */
    try {
      const runningCount: number = (
        await AIRunService.countBy({
          query: {
            projectId,
            runType: AIRunType.Investigation,
            status: AIRunStatus.Running,
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (runningCount >= MAX_CONCURRENT_INVESTIGATIONS_PER_PROJECT) {
        logger.debug(
          `Sentinel: skipping investigation for project ${projectId.toString()} — ${runningCount} investigations already running (cap: ${MAX_CONCURRENT_INVESTIGATIONS_PER_PROJECT}).`,
        );
        return;
      }
    } catch (error) {
      logger.error(
        `Sentinel: concurrency-cap check failed, skipping investigation: ${error}`,
      );
      return;
    }

    /*
     * G4 daily budget: skip quietly BEFORE creating the run, so an exhausted
     * budget produces a debug log instead of a run marked Error. The same
     * check inside AIService.executeWithLogging is the hard backstop for runs
     * that cross the limit mid-flight.
     */
    try {
      const budget: AutonomousBudgetStatus =
        await AIService.getAutonomousDailyBudgetStatus(projectId);

      if (budget.exhausted) {
        logger.debug(
          `Sentinel: skipping investigation for project ${projectId.toString()} — daily autonomous token budget exhausted (${budget.usedTokensToday} of ${budget.limitInTokens} tokens used today).`,
        );
        return;
      }
    } catch (error) {
      logger.error(
        `Sentinel: budget check failed, skipping investigation: ${error}`,
      );
      return;
    }

    // Record the run up front so it is auditable even if it fails.
    const run: AIRun = new AIRun();
    run.projectId = projectId;
    run.runType = AIRunType.Investigation;
    run.status = AIRunStatus.Running;
    run.startedAt = OneUptimeDate.getCurrentDate();
    run.lastHeartbeatAt = OneUptimeDate.getCurrentDate();

    if (request.subjectIncidentId) {
      run.triggeredByIncidentId = request.subjectIncidentId;
    }
    if (request.subjectAlertId) {
      run.triggeredByAlertId = request.subjectAlertId;
    }
    if (request.subjectMonitorId) {
      run.monitorId = request.subjectMonitorId;
    }

    let createdRun: AIRun;
    try {
      createdRun = await AIRunService.create({
        data: run,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(`Sentinel: failed to create investigation run: ${error}`);
      return;
    }

    const aiRunId: ObjectID = createdRun.id!;
    let sequence: number = 0;

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

      // Keep the run visibly alive for the stale-run sweeper + live UI.
      if (step.type === "llm_started") {
        await this.touchHeartbeat(aiRunId);
      }
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

      await AIRunService.updateOneBy({
        query: { _id: aiRunId.toString(), status: AIRunStatus.Running },
        data: {
          status: AIRunStatus.Completed,
          completedAt: OneUptimeDate.getCurrentDate(),
          lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
          llmCallCount: result.llmCallCount,
          toolCallCount: result.toolCallCount,
          totalTokens: result.totalTokens,
        } as never,
        props: { isRoot: true },
      });

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

      const isConfident: boolean = !INCONCLUSIVE_RE.test(analysis);

      await request.postAnalysis({
        analysisMarkdown: this.buildBrandedMarkdown(result, analysis),
        isConfident,
        result,
      });

      logger.debug(
        `Sentinel: investigation complete (run ${aiRunId.toString()}, confident=${isConfident}, ${result.llmCallCount} LLM calls, ${result.toolCallCount} tools, ${result.totalTokens} tokens).`,
      );
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      await AIRunService.updateOneBy({
        query: { _id: aiRunId.toString(), status: AIRunStatus.Running },
        data: {
          status: AIRunStatus.Error,
          completedAt: OneUptimeDate.getCurrentDate(),
          errorMessage: message.substring(0, 480),
        } as never,
        props: { isRoot: true },
      });

      await this.emitEvent({
        projectId,
        aiRunId,
        sequence: sequence++,
        eventType: AIRunEventType.RunFailed,
      });

      logger.error(
        `Sentinel: investigation failed (run ${aiRunId.toString()}): ${message}`,
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
