import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import AIRunType from "../../../../Types/AI/AIRunType";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunService from "../../../Services/AIRunService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
import ProjectService from "../../../Services/ProjectService";
import { Blue500 } from "../../../../Types/BrandColors";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../Services/IncidentInternalNoteService";
import IncidentService from "../../../Services/IncidentService";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../IncidentAIContextBuilder";
import { AI_INCIDENT_INVESTIGATION_FEATURE } from "../../../Services/AIService";
import AIInvestigationEngine from "./AIInvestigationEngine";
import AIInvestigationQueue from "./InvestigationQueue";
import AIConfidenceSignal, { ConfidenceSignal } from "./ConfidenceSignal";
import AIMemory from "./AIMemory";
import FixFromIncidentTaskTrigger from "./FixFromIncidentTaskTrigger";
import InstrumentationTaskTrigger from "./InstrumentationTaskTrigger";
import RemediationHandoff from "./RemediationHandoff";
import { ObservabilityAssistantResult } from "../Chat/ObservabilityAssistant";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — incident investigation.
 *
 * When a new incident is declared, wakes AI to investigate it (read-only)
 * and post a cited root-cause analysis into the incident timeline + Slack/Teams
 * — before the on-call engineer has finished reading the page. The trigger only
 * records durable intent (a Queued AIRun via AIInvestigationQueue), so a
 * pod restart can no longer orphan an investigation; the heavy lifting (run
 * lifecycle, the agent loop, confidence gating) lives in the shared
 * AIInvestigationEngine.
 */
/*
 * The cooldown default. Matches the alert lane: a monitor that was just
 * investigated does not need a second opinion minutes later.
 */
export const DEFAULT_INCIDENT_DEDUPE_WINDOW_MINUTES: number = 30;

const MAX_INCIDENT_DEDUPE_WINDOW_MINUTES: number = 24 * 60;

export interface IncidentGateDecision {
  investigate: boolean;
  reason: string;
  monitorId?: ObjectID | undefined;
}

export default class AIIncidentInvestigationRunner {
  /*
   * Entry point called (fire-and-forget) from IncidentService.onCreateSuccess.
   * Cheap: gates + a Queued AIRun row; execution happens via the queue.
   * Never throws — all failures are logged.
   *
   * Returns whether an investigation run was actually enqueued: the create
   * hook DEFERS auto-remediation when one was (the RCA-first ordering —
   * remediation is released by RemediationHandoff when the run settles) and
   * applies the rules immediately when none was, so remediation never
   * silently depends on the AI lane.
   */
  @CaptureSpan()
  public static async investigateNewIncident(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    const { incidentId, projectId } = data;

    try {
      if (
        !(await AIInvestigationEngine.isEnabledForProject(
          projectId,
          "Incident",
        ))
      ) {
        return false;
      }

      const gate: IncidentGateDecision = await this.shouldInvestigateIncident({
        incidentId,
        projectId,
      });

      if (!gate.investigate) {
        logger.debug(
          `AI: skipping investigation for incident ${incidentId.toString()} — ${gate.reason}.`,
        );
        return false;
      }

      const enqueuedRunId: ObjectID | null = await AIInvestigationQueue.enqueue(
        {
          projectId,
          subjectIncidentId: incidentId,
          subjectMonitorId: gate.monitorId,
        },
      );

      return enqueuedRunId !== null;
    } catch (error) {
      logger.error(
        `AI: unexpected error enqueueing investigation for incident ${incidentId.toString()}: ${error}`,
      );
      return false;
    }
  }

  /*
   * The incident cost gates, evaluated BEFORE anything expensive. Mirrors the
   * alert lane, with one deliberate difference: the severity floor is UNSET
   * by default here, so every incident is still investigated unless an
   * operator narrows it. An alert fires straight off a monitor and is noisy
   * by nature; an incident already cleared a human-authored threshold to
   * exist, so silently investigating fewer of them on upgrade would take away
   * analysis someone was relying on.
   *
   * An incident affects a SET of monitors rather than one, so the dedupe key
   * is "any of them" — a monitor storm that opens several incidents is
   * exactly the repeat work this suppresses.
   */
  @CaptureSpan()
  public static async shouldInvestigateIncident(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<IncidentGateDecision> {
    const { incidentId, projectId } = data;

    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: {
        monitors: {
          _id: true,
        },
        incidentSeverity: {
          order: true,
        },
      },
      props: { isRoot: true },
    });

    if (!incident) {
      return { investigate: false, reason: "incident not found" };
    }

    const monitorIds: Array<ObjectID> = (incident.monitors || [])
      .map((monitor: { _id?: string }) => {
        return monitor._id ? new ObjectID(monitor._id) : null;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return id !== null;
      });

    // The first affected monitor is the run's dedupe key for the next incident.
    const primaryMonitorId: ObjectID | undefined = monitorIds[0];

    // One project read serves both the severity floor and the dedupe window.
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        incidentInvestigationMinimumSeverityId: true,
        incidentInvestigationDedupeWindowMinutes: true,
      },
      props: { isRoot: true },
    });

    /*
     * Severity floor. Only filters KNOWN-low-severity incidents: an incident
     * whose severity order cannot be determined passes, as does every
     * incident when no floor is configured.
     */
    const floorOrder: number | null = await this.getSeverityFloorOrder(
      project?.incidentInvestigationMinimumSeverityId,
    );
    const incidentOrder: number | undefined = incident.incidentSeverity?.order;

    if (
      floorOrder !== null &&
      incidentOrder !== undefined &&
      incidentOrder > floorOrder
    ) {
      return {
        investigate: false,
        reason: `severity order ${incidentOrder} is below the investigation floor (order ${floorOrder})`,
        monitorId: primaryMonitorId,
      };
    }

    /*
     * Per-monitor dedupe window: per-project override, defaulting to 30
     * minutes, clamped to at most a day; 0 disables the cooldown. An incident
     * affecting no monitor has no dedupe key.
     */
    const dedupeWindowMinutes: number = Math.min(
      MAX_INCIDENT_DEDUPE_WINDOW_MINUTES,
      Math.max(
        0,
        project?.incidentInvestigationDedupeWindowMinutes ??
          DEFAULT_INCIDENT_DEDUPE_WINDOW_MINUTES,
      ),
    );

    if (monitorIds.length > 0 && dedupeWindowMinutes > 0) {
      const windowStart: Date =
        OneUptimeDate.getSomeMinutesAgo(dedupeWindowMinutes);

      const recentRunCount: number = (
        await AIRunService.countBy({
          query: {
            projectId,
            monitorId: QueryHelper.any(monitorIds),
            runType: AIRunType.Investigation,
            triggeredByIncidentId: QueryHelper.notNull(),
            triggeredByAlertId: QueryHelper.isNull(),
            createdAt: QueryHelper.greaterThan(windowStart),
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (recentRunCount > 0) {
        return {
          investigate: false,
          reason: `a monitor affected by this incident was already investigated within the last ${dedupeWindowMinutes} minutes`,
          monitorId: primaryMonitorId,
        };
      }
    }

    return {
      investigate: true,
      reason: "passed severity and dedupe gates",
      monitorId: primaryMonitorId,
    };
  }

  /*
   * The severity `order` value that still qualifies for investigation (lower
   * order = higher severity; an incident qualifies when its order <= floor).
   * Returns null when no floor applies — which, unlike the alert lane, is the
   * default: no configured minimum means investigate everything.
   */
  private static async getSeverityFloorOrder(
    minimumSeverityId: ObjectID | undefined,
  ): Promise<number | null> {
    if (!minimumSeverityId) {
      return null;
    }

    const floorSeverity: IncidentSeverity | null =
      await IncidentSeverityService.findOneById({
        id: minimumSeverityId,
        select: { order: true },
        props: { isRoot: true },
      });

    /*
     * A configured severity that has since been deleted must not silently
     * become "investigate nothing" — fall back to no floor.
     */
    if (!floorSeverity || floorSeverity.order === undefined) {
      return null;
    }

    return floorSeverity.order;
  }

  /*
   * Execute a claimed run: assemble incident context and hand it to the
   * engine. Called by AIInvestigationQueue after a successful claim.
   * Never throws — failures are handed to the queue's retry policy so a
   * claimed run is always finalized or requeued.
   */
  @CaptureSpan()
  public static async executeInvestigation(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    incidentId: ObjectID;
    attemptCount: number;
  }): Promise<void> {
    const { aiRunId, projectId, incidentId, attemptCount } = data;

    let contextSummary: string;
    try {
      const contextData: IncidentContextData =
        await IncidentAIContextBuilder.buildIncidentContext({
          incidentId,
          includeWorkspaceMessages: false,
        });

      /*
       * Recurrence memory: pull in past resolved incidents that share this
       * incident's monitors/labels so AI can recognise "I've seen this
       * before" and reference the prior fix.
       */
      const priorCasesContext: string =
        await AIMemory.getPriorSimilarIncidentsContext({
          projectId,
          currentIncidentId: incidentId,
          monitorNames: (contextData.incident.monitors || [])
            .map((m: { name?: string }) => {
              return m.name || "";
            })
            .filter(Boolean),
          labelNames: (contextData.incident.labels || [])
            .map((l: { name?: string }) => {
              return l.name || "";
            })
            .filter(Boolean),
        });

      contextSummary =
        this.buildIncidentSummary(contextData) + priorCasesContext;
    } catch (error) {
      /*
       * Context assembly failed — the run is claimed, so hand it to the
       * retry policy rather than leaving it Running until the sweeper. When
       * this failure FINALIZED the run (retries exhausted), the incident is
       * terminally settled here and must still be released to
       * auto-remediation (RCA-first ordering).
       */
      const outcome: "requeued" | "finalized" | "noop" =
        await AIInvestigationQueue.failOrRequeue({
          aiRunId,
          attemptCount,
          errorMessage: `Failed to build incident context: ${
            error instanceof Error ? error.message : String(error)
          }`,
          isPermanent: false,
        });

      if (outcome === "finalized") {
        await RemediationHandoff.runForSettledInvestigation({
          projectId,
          incidentId,
        });
      }
      return;
    }

    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId,
      attemptCount,
      request: {
        // Persisted LlmLog label — owned by AIService (G4 budget list).
        feature: AI_INCIDENT_INVESTIGATION_FEATURE,
        incidentId,
        contextSummary,
        persistCodeFixRecommendation: true,
        postAnalysis: async (postData: {
          analysisMarkdown: string;
          confidence: ConfidenceSignal;
          result: ObservabilityAssistantResult;
        }): Promise<void> => {
          await IncidentFeedService.createIncidentFeedItem({
            incidentId,
            projectId,
            aiRunId,
            incidentFeedEventType: IncidentFeedEventType.RootCause,
            displayColor: Blue500,
            feedInfoInMarkdown: postData.analysisMarkdown,
            /*
             * Quiet mode: an inconclusive investigation posts to the timeline
             * but does NOT loudly ping the workspace / on-call. Fail
             * direction (G6): when the confidence classification itself
             * failed, the ping SENDS — quiet mode fails louder, not silent.
             */
            workspaceNotification: {
              sendWorkspaceNotification:
                AIConfidenceSignal.shouldSendWorkspaceNotification(
                  postData.confidence,
                ),
            },
          });

          /*
           * Also file the RCA as an incident internal note, where responders
           * collaborate. The RootCause feed item above, with its quiet-mode
           * gating, must stay the single notification source, so:
           * ignoreHooks skips the note service's "posted private note" feed
           * item + unconditional workspace ping (workflow triggers and
           * realtime updates still fire), and isOwnerNotified stops the
           * note-posted owner-notification cron from paging owners about it.
           * Best-effort: a note failure must not fail the run after the feed
           * item already posted.
           */
          try {
            const note: IncidentInternalNote = new IncidentInternalNote();
            note.incidentId = incidentId;
            note.projectId = projectId;
            note.note = postData.analysisMarkdown;
            note.isOwnerNotified = true;

            await IncidentInternalNoteService.create({
              data: note,
              props: { isRoot: true, ignoreHooks: true },
            });
          } catch (error) {
            logger.error(
              `AI: failed to post RCA internal note for incident ${incidentId.toString()}: ${error}`,
            );
          }

          /*
           * Measurement layer: record the time-to-rca metric (seconds from
           * incident creation to this analysis post, with the same base
           * attribute shape as every other incident metric). Best-effort —
           * metrics must never break the RCA post.
           */
          try {
            await IncidentService.recordTimeToRootCausePostedMetric({
              incidentId,
            });
          } catch (error) {
            logger.error(
              `AI: failed to record time-to-rca metric for incident ${incidentId.toString()}: ${error}`,
            );
          }

          /*
           * Inconclusive means the telemetry was insufficient — for
           * opted-in projects (the incident instrumentation-fix setting,
           * default false), queue an ImproveInstrumentation fix task that
           * opens a PR adding the missing observability. Runs strictly
           * AFTER the analysis is posted, and the trigger never throws, so
           * the investigation can neither be blocked nor failed by it.
           * Fail direction (G6): only a POSITIVE inconclusive verdict
           * (deterministic floor or classification) enqueues — a failed
           * classification does NOT create a PR.
           */
          if (
            AIConfidenceSignal.shouldEnqueueInstrumentationTask(
              postData.confidence,
            )
          ) {
            await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation(
              {
                projectId,
                incidentId,
              },
            );
          }
        },
        /*
         * The engine calls this only after it atomically persists Recommended
         * with the exact posted analysis snapshot. That durable decision is
         * the prerequisite for the optional automatic FixFromIncident task;
         * the trigger then applies the incident lane's independent opt-in and
         * remaining repository, budget and dedupe gates.
         */
        onCodeFixRecommended: async (data: {
          analysisMarkdown: string;
        }): Promise<void> => {
          await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation(
            {
              projectId,
              investigationRunId: aiRunId,
              analysisMarkdown: data.analysisMarkdown,
              incidentId,
            },
          );
        },
        /*
         * RCA-first ordering: auto-remediation for this incident was
         * deferred at creation because this investigation was enqueued —
         * release it now that the run has settled (any terminal outcome).
         */
        onSettled: async (): Promise<void> => {
          await RemediationHandoff.runForSettledInvestigation({
            projectId,
            incidentId,
          });
        },
      },
    });
  }

  // Build a compact incident record to seed the investigation.
  private static buildIncidentSummary(
    contextData: IncidentContextData,
  ): string {
    const { incident, internalNotes } = contextData;

    const lines: Array<string> = [];
    lines.push("# Incident");
    lines.push(`Title: ${incident.title || "N/A"}`);

    if (incident.description) {
      lines.push(`Description: ${incident.description}`);
    }

    lines.push(`Severity: ${incident.incidentSeverity?.name || "N/A"}`);
    lines.push(
      `Current state: ${incident.currentIncidentState?.name || "N/A"}`,
    );
    lines.push(
      `Declared at: ${
        incident.createdAt
          ? OneUptimeDate.getDateAsFormattedString(incident.createdAt)
          : "N/A"
      }`,
    );

    if (incident.monitors && incident.monitors.length > 0) {
      lines.push(
        `Affected monitors: ${incident.monitors
          .map((m: { name?: string }) => {
            return m.name;
          })
          .filter(Boolean)
          .join(", ")}`,
      );
    }

    if (incident.labels && incident.labels.length > 0) {
      lines.push(
        `Labels: ${incident.labels
          .map((l: { name?: string }) => {
            return l.name;
          })
          .filter(Boolean)
          .join(", ")}`,
      );
    }

    if (incident.rootCause) {
      lines.push(`Root cause (as recorded so far): ${incident.rootCause}`);
    }

    const recentNotes: Array<string> = (internalNotes || [])
      .slice(-5)
      .map((note: { note?: string }) => {
        return note.note ? `- ${note.note}` : "";
      })
      .filter(Boolean);

    if (recentNotes.length > 0) {
      lines.push("");
      lines.push("Recent internal notes:");
      lines.push(...recentNotes);
    }

    return lines.join("\n");
  }
}
