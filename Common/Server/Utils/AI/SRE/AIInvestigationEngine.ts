import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import {
  AIChatCitation,
  AIRunEventResultSummary,
} from "../../../../Types/AI/AIChatTypes";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunCodeFixRecommendation from "../../../../Types/AI/AIRunCodeFixRecommendation";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import Project from "../../../../Models/DatabaseModels/Project";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import AIRunService from "../../../Services/AIRunService";
import AIRunEventService from "../../../Services/AIRunEventService";
import ProjectService from "../../../Services/ProjectService";
import LlmProviderService from "../../../Services/LlmProviderService";
import AIInvestigationQueue from "./InvestigationQueue";
import AIConfidenceSignal, { ConfidenceSignal } from "./ConfidenceSignal";
import InvestigationTldr from "./InvestigationTldr";
import ObservabilityAssistant, {
  ObservabilityAssistantExtraTool,
  ObservabilityAssistantResult,
  ObservabilityAssistantStep,
  ObservabilityAssistantStepType,
} from "../Chat/ObservabilityAssistant";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — the shared autonomous-investigation engine.
 *
 * A single subject-agnostic core that powers "wake on signal" investigations
 * for both incidents and alerts (and, later, anomalies). It:
 *   1. records the run as an AIRun(Investigation) + AIRunEvents (audit trail),
 *   2. runs the existing read-only, tool-grounded, citation-minting agent loop
 *      (ObservabilityAssistant) with the AI persona and a larger budget,
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
 * Conditional recommendation persistence is idempotent, so transient
 * database failures can be retried without risking a second decision.
 */
const CODE_FIX_RECOMMENDATION_PERSIST_ATTEMPTS: number = 3;

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

const INVESTIGATION_PERSONA: string = `You are OneUptime AI, OneUptime's autonomous AI Site Reliability Engineer. You have been woken automatically because a NEW signal (an incident or alert) was just declared in this project — no human has asked you a question yet. Investigate it proactively and produce a first-pass root cause analysis that the on-call engineer will read the moment they are paged.

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
export type AISubjectType = "Incident" | "Alert";

export interface InvestigationRequest {
  // Label recorded on LlmLog, e.g. "AI Incident Investigation".
  feature: string;
  /*
   * The subject lane used for per-incident / per-alert autonomous budgets.
   * Insight triage is intentionally subjectless and leaves both unset.
   */
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
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
  /*
   * Incident and alert RCA runs opt into a persisted code-fix decision.
   * Other users of this engine (insight triage and remediation) omit it and
   * remain NotRecommended throughout their lifecycle.
   */
  persistCodeFixRecommendation?: boolean | undefined;
  /*
   * Incident and alert RCA runs opt into the AI-written TL;DR that the
   * dashboard panel shows above the report. Display-only and best-effort:
   * a failed generation leaves the run without one and changes nothing else.
   * Engine users with no panel (insight triage, remediation) omit it.
   */
  persistAnalysisTldr?: boolean | undefined;
  /*
   * Runs only after a Recommended decision and its exact analysis snapshot
   * have been durably committed. Incident/alert runners use this for the
   * optional automatic FixFromIncident lane; persistence failure means the
   * callback is never invoked.
   */
  onCodeFixRecommended?:
    | ((data: { analysisMarkdown: string }) => Promise<void>)
    | undefined;
  /*
   * Optional: called exactly once when THIS attempt settles the run into a
   * terminal state — Completed (with or without an analysis, and even when
   * only postAnalysis failed afterwards) or Error once retries are
   * exhausted. NOT called when the attempt was requeued (a later attempt
   * settles) or when another actor won the terminal transition (that actor
   * settles). The investigation runners use it to hand the subject to
   * auto-remediation AFTER the RCA had its chance to post (RCA-first
   * ordering — see RemediationHandoff). Errors are logged, never allowed
   * to fail the run.
   */
  onSettled?: (() => Promise<void>) | undefined;
  /*
   * Optional overrides for non-investigation run kinds that reuse this
   * engine (remediation planning/execution). Defaults preserve the classic
   * investigation behavior exactly.
   */
  // Replaces INVESTIGATION_PERSONA as the appended system instructions.
  personaOverride?: string | undefined;
  // Replaces the "A new signal has just been declared..." user preamble.
  questionOverride?: string | undefined;
  /*
   * Run-scoped tools grafted onto the loop (see
   * ObservabilityAssistantExtraTool). The read-only toolbox is always
   * present; extras are additive and own their own authorization.
   */
  extraTools?: Array<ObservabilityAssistantExtraTool> | undefined;
  maxLlmCalls?: number | undefined;
  maxToolCalls?: number | undefined;
  maxWallClockMs?: number | undefined;
  maxOutputTokens?: number | undefined;
}

export default class AIInvestigationEngine {
  /*
   * Shared gate: AI enabled, the subject's auto-investigation opt-in on, and an
   * LLM provider configured. Incidents and alerts each have their own opt-in so
   * they can be enabled independently. Runs before any (subject-specific)
   * context assembly.
   */
  @CaptureSpan()
  public static async isEnabledForProject(
    projectId: ObjectID,
    subjectType: AISubjectType,
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
        `AI: skipping investigation for project ${projectId.toString()} — no LLM provider configured.`,
      );
      return false;
    }

    return true;
  }

  /*
   * Execute an already-CLAIMED (Running) investigation run end-to-end.
   * Called by AIInvestigationQueue after a successful CAS claim —
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
        `AI: failed to read event count for run ${aiRunId.toString()}; starting sequence at 0: ${error}`,
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
      await this.touchHeartbeat(aiRunId, data.attemptCount);
    };

    /*
     * Whether THIS attempt won the Running -> Completed transition. Once it
     * did, the run is terminally settled by this attempt no matter what
     * happens afterwards (a postAnalysis failure does not un-complete it),
     * so the settlement callback must still fire from the catch block.
     */
    let settledAsCompleted: boolean = false;

    try {
      const result: ObservabilityAssistantResult =
        await ObservabilityAssistant.answerQuestion({
          projectId,
          incidentId: request.incidentId,
          alertId: request.alertId,
          aiRunId,
          // System run — full read access to the project's telemetry.
          props: { isRoot: true },
          feature: request.feature,
          systemInstructions: request.personaOverride ?? INVESTIGATION_PERSONA,
          question: `${
            request.questionOverride ??
            "A new signal has just been declared and you have been woken to investigate it. Investigate now and produce your root cause analysis."
          }\n\n${request.contextSummary}`,
          maxLlmCalls: request.maxLlmCalls ?? MAX_LLM_CALLS,
          maxToolCalls: request.maxToolCalls ?? MAX_TOOL_CALLS,
          maxWallClockMs: request.maxWallClockMs ?? MAX_WALL_CLOCK_MS,
          maxOutputTokens: request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
          onStep,
          extraTools: request.extraTools,
          /*
           * The chat-facing AI-meta tools are hidden from the investigator:
           * "the latest investigation" for this subject IS this in-flight
           * run, so the model would poll its own unfinished status ("check
           * again in a minute") and burn budget instead of investigating.
           */
          excludeToolNames: ["get_ai_investigation", "start_investigation"],
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
          expectedAttemptCount: data.attemptCount,
          set: {
            status: AIRunStatus.Completed,
            ...(request.persistCodeFixRecommendation === true
              ? {
                  codeFixRecommendation: AIRunCodeFixRecommendation.Pending,
                }
              : {}),
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
          `AI: run ${aiRunId.toString()} finished but was no longer Running (likely requeued as stale mid-flight); skipping postAnalysis to avoid a duplicate RCA.`,
        );
        return;
      }

      settledAsCompleted = true;

      const analysis: string = (result.contentInMarkdown || "").trim();

      if (!analysis) {
        logger.debug(
          `AI: investigation (run ${aiRunId.toString()}) produced no analysis; nothing posted.`,
        );

        if (request.persistCodeFixRecommendation === true) {
          await this.finalizeCodeFixRecommendation({
            aiRunId,
            recommendation: AIRunCodeFixRecommendation.NotRecommended,
          });
        }

        /*
         * No analysis is still a settled run — the subject must not lose
         * its deferred remediation because the model had nothing to say.
         */
        await this.emitEvent({
          projectId,
          aiRunId,
          sequence: sequence++,
          eventType: AIRunEventType.RunCompleted,
        });

        await this.invokeOnSettled(request, aiRunId);
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
      /*
       * The display-only TL;DR (see InvestigationTldr) runs CONCURRENTLY with
       * the classification: both are post-loop calls over the same analysis,
       * so serializing them would add their latencies to the delay before the
       * RCA reaches the on-call engineer. Neither call throws — the TL;DR
       * degrades to null and the report is published regardless.
       */
      const [confidence, analysisTldr]: [ConfidenceSignal, string | null] =
        await Promise.all([
          AIConfidenceSignal.computeConfidenceSignal({
            projectId,
            aiRunId,
            incidentId: request.incidentId,
            alertId: request.alertId,
            analysisMarkdown: analysis,
            evidence: AIConfidenceSignal.evidenceFromCitations(
              result.citations || [],
            ),
          }),
          request.persistAnalysisTldr === true
            ? InvestigationTldr.generateTldr({
                projectId,
                aiRunId,
                incidentId: request.incidentId,
                alertId: request.alertId,
                /*
                 * Summarize the model's own analysis, not the branded form —
                 * the branding wrapper is boilerplate plus an evidence list,
                 * and a summary of it would waste the TL;DR on both.
                 */
                analysisMarkdown: analysis,
              }).catch((error: unknown): null => {
                /*
                 * generateTldr is total by construction, but it sits in a
                 * Promise.all inside the main try: a rejection would land in
                 * the catch below AFTER the Completed transition was won, so
                 * the run would be failed and the report never posted at all
                 * — a cosmetic line of text destroying the whole RCA. Belt
                 * and braces, because the blast radius is that asymmetric.
                 */
                logger.error(
                  `AI: TL;DR generation threw for run ${aiRunId.toString()}; publishing the report without one: ${error}`,
                );
                return null;
              })
            : Promise.resolve(null),
        ]);

      /*
       * Persist the TL;DR BEFORE the report is posted, so the panel can never
       * render the report for a beat without its summary. Best-effort: a
       * write failure is logged and the report still posts.
       */
      if (analysisTldr) {
        await this.persistAnalysisTldr({ aiRunId, analysisTldr });
      }

      /*
       * Build the posted form exactly once. The same immutable string is
       * handed to the subject feed, persisted with the recommendation, and
       * supplied to the automatic fix trigger by the subject runner.
       */
      const investigationAnalysisMarkdown: string = this.buildBrandedMarkdown(
        result,
        analysis,
      );

      await request.postAnalysis({
        analysisMarkdown: investigationAnalysisMarkdown,
        confidence,
        result,
      });

      /*
       * Only expose the manual Fix PR action after the cited analysis has
       * actually been posted. The same structured, fail-closed decision also
       * gates the automatic FixFromIncident lane in the subject runner.
       */
      if (request.persistCodeFixRecommendation === true) {
        if (AIConfidenceSignal.isCodeFixRecommended(confidence)) {
          const recommendationPersisted: boolean =
            await this.finalizeCodeFixRecommendation({
              aiRunId,
              recommendation: AIRunCodeFixRecommendation.Recommended,
              investigationAnalysisMarkdown,
            });

          if (recommendationPersisted && request.onCodeFixRecommended) {
            try {
              await request.onCodeFixRecommended({
                analysisMarkdown: investigationAnalysisMarkdown,
              });
            } catch (error) {
              logger.error(
                `AI: post-recommendation follow-up failed for run ${aiRunId.toString()}: ${error}`,
              );
            }
          }
        } else {
          await this.finalizeCodeFixRecommendation({
            aiRunId,
            recommendation: AIRunCodeFixRecommendation.NotRecommended,
          });
        }
      }

      /*
       * RunCompleted is the durable publication-settlement signal, not just
       * the earlier status CAS. The dashboard keeps polling a Completed run
       * until either the matching report exists or this final event proves
       * that finalization ended without one. Recommendation settlement and
       * its post-persistence callback have finished before this event. If
       * confidence/postAnalysis throws, the catch path emits RunFailed.
       */
      await this.emitEvent({
        projectId,
        aiRunId,
        sequence: sequence++,
        eventType: AIRunEventType.RunCompleted,
      });

      logger.debug(
        `AI: investigation complete (run ${aiRunId.toString()}, confident=${confidence.confident} via ${confidence.source}, ${result.llmCallCount} LLM calls, ${result.toolCallCount} tools, ${result.totalTokens} tokens).`,
      );

      // The run is settled and the RCA posted — release deferred follow-ups.
      await this.invokeOnSettled(request, aiRunId);
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      /*
       * A failure after the Running -> Completed transition (classification
       * or posting the RCA) must not strand the panel in Pending forever or
       * offer a PR without a posted analysis. Fail closed.
       */
      if (settledAsCompleted && request.persistCodeFixRecommendation === true) {
        await this.finalizeCodeFixRecommendation({
          aiRunId,
          recommendation: AIRunCodeFixRecommendation.NotRecommended,
        });
      }

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
      const outcome: "requeued" | "finalized" | "noop" =
        await AIInvestigationQueue.failOrRequeue({
          aiRunId,
          attemptCount: data.attemptCount,
          errorMessage: message,
          isPermanent: PERMANENT_FAILURE_RE.test(message),
        });

      /*
       * Settle-once discipline: fire the settlement callback when this
       * attempt terminally owns the run — either it already won the
       * Completed transition (the error came from confidence/postAnalysis
       * afterwards; failOrRequeue no-ops on a Completed run) or this
       * failOrRequeue finalized it as Error. A requeued attempt is NOT
       * settled (the retry owns it), and "noop" without a won Completed
       * means another actor moved the run and owns settlement.
       */
      const ownsTerminalOutcome: boolean =
        settledAsCompleted || outcome === "finalized";

      if (ownsTerminalOutcome) {
        /*
         * Emit terminal failure only after ownership is established. A stale
         * or requeued attempt can finish after the retry's RunStarted; letting
         * it append RunFailed would falsely look like the retry settled.
         */
        await this.emitEvent({
          projectId,
          aiRunId,
          sequence: sequence++,
          eventType: AIRunEventType.RunFailed,
        });

        await this.invokeOnSettled(request, aiRunId);
      }

      logger.error(
        `AI: investigation attempt ${data.attemptCount} failed (run ${aiRunId.toString()}): ${message}`,
      );
    }
  }

  /*
   * Fire the caller's settlement callback, exactly at the points where this
   * attempt terminally settled the run. Best-effort by contract: the run is
   * already settled, so a hand-off failure is logged and swallowed.
   */
  private static async invokeOnSettled(
    request: InvestigationRequest,
    aiRunId: ObjectID,
  ): Promise<void> {
    if (!request.onSettled) {
      return;
    }

    try {
      await request.onSettled();
    } catch (error) {
      logger.error(
        `AI: post-settlement follow-up failed for run ${aiRunId.toString()}: ${error}`,
      );
    }
  }

  /*
   * Store the display-only TL;DR on the run. Unlike the code-fix decision
   * this authorizes nothing, so it is not retried: a failed write (or a run
   * that is no longer Completed) simply leaves the panel showing the report
   * with no summary above it.
   */
  private static async persistAnalysisTldr(data: {
    aiRunId: ObjectID;
    analysisTldr: string;
  }): Promise<void> {
    try {
      const updatedCount: number =
        await AIRunService.setInvestigationAnalysisTldr(data);

      if (updatedCount === 0) {
        logger.warn(
          `AI: could not store the TL;DR for run ${data.aiRunId.toString()} — it was no longer Completed.`,
        );
      }
    } catch (error) {
      logger.error(
        `AI: failed to store the TL;DR for run ${data.aiRunId.toString()}: ${error}`,
      );
    }
  }

  /*
   * Resolve the recommendation exactly once. Pending is written by the
   * winning Completed CAS, so this conditional update cannot race a stale
   * attempt or overwrite a decision another actor already settled. A
   * Recommended decision carries the exact analysis snapshot it classified;
   * manual and automatic fix tasks never have to re-read mutable feed state.
   *
   * Best-effort like the event trail: transient database errors are retried,
   * but recommendation persistence never turns a completed investigation
   * into a failed run. A zero-row update is safe (the row was already settled
   * or removed) and is logged rather than retried.
   */
  private static async finalizeCodeFixRecommendation(
    data:
      | {
          aiRunId: ObjectID;
          recommendation: AIRunCodeFixRecommendation.Recommended;
          investigationAnalysisMarkdown: string;
        }
      | {
          aiRunId: ObjectID;
          recommendation: AIRunCodeFixRecommendation.NotRecommended;
        },
  ): Promise<boolean> {
    for (
      let attempt: number = 1;
      attempt <= CODE_FIX_RECOMMENDATION_PERSIST_ATTEMPTS;
      attempt++
    ) {
      try {
        const updatedCount: number =
          await AIRunService.finalizeInvestigationCodeFixRecommendation(
            data.recommendation === AIRunCodeFixRecommendation.Recommended
              ? {
                  aiRunId: data.aiRunId,
                  recommendation: data.recommendation,
                  taskContext: {
                    sourceInvestigationRunId: data.aiRunId.toString(),
                    sourceInvestigationAnalysisMarkdown:
                      data.investigationAnalysisMarkdown,
                  },
                }
              : {
                  aiRunId: data.aiRunId,
                  recommendation: data.recommendation,
                },
          );

        if (updatedCount === 0) {
          logger.warn(
            `AI: code-fix recommendation for run ${data.aiRunId.toString()} was no longer Pending; leaving the existing decision unchanged.`,
          );
          return false;
        }
        return true;
      } catch (error) {
        if (attempt === CODE_FIX_RECOMMENDATION_PERSIST_ATTEMPTS) {
          logger.error(
            `AI: failed to persist code-fix recommendation for run ${data.aiRunId.toString()} after ${attempt} attempts: ${error}`,
          );
          return false;
        }

        logger.warn(
          `AI: failed to persist code-fix recommendation for run ${data.aiRunId.toString()} (attempt ${attempt}/${CODE_FIX_RECOMMENDATION_PERSIST_ATTEMPTS}); retrying: ${error}`,
        );
      }
    }

    return false;
  }

  // Wrap the agent's analysis with AI branding + an evidence list.
  private static buildBrandedMarkdown(
    result: ObservabilityAssistantResult,
    analysisMarkdown: string,
  ): string {
    let markdown: string = `## 🧠 AI — Automated Root Cause Analysis\n\n${analysisMarkdown}`;

    const citations: Array<AIChatCitation> = result.citations || [];

    if (citations.length > 0) {
      markdown += `\n\n**Evidence checked**`;
      for (const citation of citations.slice(0, 15)) {
        markdown += `\n- **[${citation.id}]** ${citation.label} — ${citation.rowCount} row(s)`;
      }
    }

    markdown += `\n\n---\n*Investigated automatically by OneUptime AI — read-only, ${result.toolCallCount} quer${
      result.toolCallCount === 1 ? "y" : "ies"
    } run across your own telemetry${
      result.modelName ? ` using ${result.modelName}` : ""
    }. This is an AI-generated first pass; verify before acting.*`;

    return markdown;
  }

  // Refresh lastHeartbeatAt so a long-running investigation isn't swept as stale.
  private static async touchHeartbeat(
    aiRunId: ObjectID,
    attemptCount: number,
  ): Promise<void> {
    try {
      await AIRunService.attemptStatusTransition({
        aiRunId,
        fromStatus: AIRunStatus.Running,
        expectedAttemptCount: attemptCount,
        set: {
          status: AIRunStatus.Running,
          lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
        },
      });
    } catch (error) {
      logger.error(`AI: heartbeat update failed: ${error}`);
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
      logger.error(`AI: failed to emit AIRunEvent: ${error}`);
    }
  }
}
