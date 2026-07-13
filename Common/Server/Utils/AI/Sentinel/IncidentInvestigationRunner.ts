import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { Blue500 } from "../../../../Types/BrandColors";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../Services/IncidentInternalNoteService";
import IncidentService from "../../../Services/IncidentService";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../IncidentAIContextBuilder";
import SentinelInvestigationEngine from "./SentinelInvestigationEngine";
import SentinelInvestigationQueue from "./InvestigationQueue";
import SentinelMemory from "./SentinelMemory";
import InstrumentationTaskTrigger from "./InstrumentationTaskTrigger";
import { ObservabilityAssistantResult } from "../Chat/ObservabilityAssistant";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Sentinel — incident investigation.
 *
 * When a new incident is declared, wakes Sentinel to investigate it (read-only)
 * and post a cited root-cause analysis into the incident timeline + Slack/Teams
 * — before the on-call engineer has finished reading the page. The trigger only
 * records durable intent (a Queued AIRun via SentinelInvestigationQueue), so a
 * pod restart can no longer orphan an investigation; the heavy lifting (run
 * lifecycle, the agent loop, confidence gating) lives in the shared
 * SentinelInvestigationEngine. See Internal/Roadmap/AISentinelExecution.md.
 */
export default class SentinelIncidentInvestigationRunner {
  /*
   * Entry point called (fire-and-forget) from IncidentService.onCreateSuccess.
   * Cheap: gates + a Queued AIRun row; execution happens via the queue.
   * Never throws — all failures are logged.
   */
  @CaptureSpan()
  public static async investigateNewIncident(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const { incidentId, projectId } = data;

    try {
      if (
        !(await SentinelInvestigationEngine.isEnabledForProject(
          projectId,
          "Incident",
        ))
      ) {
        return;
      }

      await SentinelInvestigationQueue.enqueue({
        projectId,
        subjectIncidentId: incidentId,
      });
    } catch (error) {
      logger.error(
        `Sentinel: unexpected error enqueueing investigation for incident ${incidentId.toString()}: ${error}`,
      );
    }
  }

  /*
   * Execute a claimed run: assemble incident context and hand it to the
   * engine. Called by SentinelInvestigationQueue after a successful claim.
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
       * incident's monitors/labels so Sentinel can recognise "I've seen this
       * before" and reference the prior fix.
       */
      const priorCasesContext: string =
        await SentinelMemory.getPriorSimilarIncidentsContext({
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
       * retry policy rather than leaving it Running until the sweeper.
       */
      await SentinelInvestigationQueue.failOrRequeue({
        aiRunId,
        attemptCount,
        errorMessage: `Failed to build incident context: ${
          error instanceof Error ? error.message : String(error)
        }`,
        isPermanent: false,
      });
      return;
    }

    await SentinelInvestigationEngine.executeRun({
      aiRunId,
      projectId,
      attemptCount,
      request: {
        feature: "Sentinel Incident Investigation",
        contextSummary,
        postAnalysis: async (postData: {
          analysisMarkdown: string;
          isConfident: boolean;
          result: ObservabilityAssistantResult;
        }): Promise<void> => {
          await IncidentFeedService.createIncidentFeedItem({
            incidentId,
            projectId,
            incidentFeedEventType: IncidentFeedEventType.RootCause,
            displayColor: Blue500,
            feedInfoInMarkdown: postData.analysisMarkdown,
            /*
             * Quiet mode: an inconclusive investigation posts to the timeline
             * but does NOT loudly ping the workspace / on-call.
             */
            workspaceNotification: {
              sendWorkspaceNotification: postData.isConfident,
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
              `Sentinel: failed to post RCA internal note for incident ${incidentId.toString()}: ${error}`,
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
              `Sentinel: failed to record time-to-rca metric for incident ${incidentId.toString()}: ${error}`,
            );
          }

          /*
           * Inconclusive means the telemetry was insufficient — for
           * opted-in projects (Project.enableInstrumentationFixTasks,
           * default false), queue an ImproveInstrumentation fix task that
           * opens a PR adding the missing observability. Runs strictly
           * AFTER the analysis is posted, and the trigger never throws, so
           * the investigation can neither be blocked nor failed by it.
           */
          if (!postData.isConfident) {
            await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation(
              {
                projectId,
                incidentId,
              },
            );
          }
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
