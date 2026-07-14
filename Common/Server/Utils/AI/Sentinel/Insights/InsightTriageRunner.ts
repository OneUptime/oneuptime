import ObjectID from "../../../../../Types/ObjectID";
import OneUptimeDate from "../../../../../Types/Date";
import SentinelInsight from "../../../../../Models/DatabaseModels/SentinelInsight";
import SentinelInsightEvidence from "../../../../../Types/AI/SentinelInsightEvidence";
import SentinelInsightService from "../../../../Services/SentinelInsightService";
import { SENTINEL_INSIGHT_TRIAGE_FEATURE } from "../../../../Services/AIService";
import SentinelInvestigationEngine from "../SentinelInvestigationEngine";
import SentinelInvestigationQueue from "../InvestigationQueue";
import { ConfidenceSignal } from "../ConfidenceSignal";
import { ObservabilityAssistantResult } from "../../Chat/ObservabilityAssistant";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

/*
 * Sentinel — per-insight preventive triage.
 *
 * A deterministic detector filed a SentinelInsight; this runner executes the
 * budgeted, read-only Investigation AIRun that triages it: most likely root
 * cause, estimated blast radius, ONE recommended next action — every claim
 * cited. Structurally a sibling of IncidentInvestigationRunner: the queue
 * claims the run and dispatches here; the shared engine owns the run
 * lifecycle, the agent loop and the confidence signal.
 *
 * The difference is the OUTPUT SINK. Insights never page and never open
 * incidents (the roadmap's Preventive-lane rule), so postAnalysis writes the
 * summary onto the insight row and NOTHING else — the quiet inbox.
 */

/*
 * Cap on the rendered evidence JSON embedded in the triage prompt. Latency
 * evidence carries span-tree findings that can be large; the numbers matter,
 * an exhaustive span listing does not.
 */
const MAX_RENDERED_EVIDENCE_CHARS: number = 4000;

/*
 * The preventive-triage framing, prepended to the subject description. The
 * engine's persona is written for a just-declared incident/alert, so the
 * request context must recast the situation before the insight is described
 * (the engine embeds contextSummary into the investigation question — the
 * same mechanism the incident runner uses to convey its subject).
 */
const PREVENTIVE_TRIAGE_FRAMING: string = `IMPORTANT — this is PREVENTIVE TRIAGE, not an incident investigation: NO incident or alert exists and nobody has been paged. A deterministic statistical sensor (no AI involved) watched this project's telemetry and filed the finding described below, with the evidence it computed. Your job:
- Establish the most likely root cause of the finding.
- Estimate the blast radius: which services/users/operations are affected, and how badly.
- Recommend exactly ONE next action (the single most useful thing an engineer should do first).
Cite the evidence for every factual claim. If the telemetry cannot support a conclusion, say so plainly. Do not refer to "the incident" — there is none.`;

export default class InsightTriageRunner {
  /*
   * Execute a claimed triage run: load the insight, build its description
   * and hand it to the shared engine. Called by SentinelInvestigationQueue
   * after a successful claim. Never throws — failures are handed to the
   * queue's retry policy so a claimed run is always finalized or requeued.
   */
  @CaptureSpan()
  public static async executeTriage(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    sentinelInsightId: ObjectID;
    attemptCount: number;
  }): Promise<void> {
    const { aiRunId, projectId, sentinelInsightId, attemptCount } = data;

    let contextSummary: string;
    try {
      const insight: SentinelInsight | null =
        await SentinelInsightService.findOneById({
          id: sentinelInsightId,
          select: {
            _id: true,
            insightType: true,
            severity: true,
            title: true,
            detailMarkdown: true,
            evidence: true,
            serviceName: true,
            traceId: true,
            metricName: true,
            firstSeenAt: true,
            lastSeenAt: true,
            occurrenceCount: true,
          },
          props: { isRoot: true },
        });

      if (!insight) {
        throw new Error(
          "Sentinel insight not found — it may have been deleted after the triage run was enqueued.",
        );
      }

      contextSummary = this.buildInsightSummary(insight);
    } catch (error) {
      /*
       * Context assembly failed — the run is claimed, so hand it to the
       * retry policy rather than leaving it Running until the sweeper.
       */
      await SentinelInvestigationQueue.failOrRequeue({
        aiRunId,
        attemptCount,
        errorMessage: `Failed to build insight context: ${
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
        feature: SENTINEL_INSIGHT_TRIAGE_FEATURE,
        contextSummary,
        postAnalysis: async (postData: {
          analysisMarkdown: string;
          confidence: ConfidenceSignal;
          result: ObservabilityAssistantResult;
        }): Promise<void> => {
          /*
           * The quiet inbox — deliberately the ONLY write: no feed items,
           * no workspace notification, no owner/on-call ping, no metrics,
           * and no instrumentation-task trigger. Insights never page and
           * never enter the notification pipeline (Preventive-lane rule);
           * the summary waits on the Insights page until a human looks.
           */
          await SentinelInsightService.updateOneById({
            id: sentinelInsightId,
            data: {
              triageSummaryMarkdown: postData.analysisMarkdown,
              triageCompletedAt: OneUptimeDate.getCurrentDate(),
            },
            props: { isRoot: true },
          });

          logger.debug(
            `Sentinel insights: triage summary posted for insight ${sentinelInsightId.toString()} (run ${aiRunId.toString()}, confident=${postData.confidence.confident} via ${postData.confidence.source}).`,
          );
        },
      },
    });
  }

  // Build the compact insight record that seeds the triage.
  private static buildInsightSummary(insight: SentinelInsight): string {
    const lines: Array<string> = [];

    lines.push(PREVENTIVE_TRIAGE_FRAMING);
    lines.push("");
    lines.push("# Sentinel finding");
    lines.push(`Finding type: ${insight.insightType || "N/A"}`);
    lines.push(`Title: ${insight.title || "N/A"}`);
    lines.push(`Severity: ${insight.severity || "N/A"}`);

    if (insight.serviceName) {
      lines.push(`Attributed service: ${insight.serviceName}`);
    }
    if (insight.metricName) {
      lines.push(`Metric: ${insight.metricName}`);
    }
    if (insight.traceId) {
      lines.push(`Representative trace id: ${insight.traceId}`);
    }
    if (insight.firstSeenAt) {
      lines.push(
        `First seen: ${OneUptimeDate.getDateAsFormattedString(insight.firstSeenAt)}`,
      );
    }
    if (insight.lastSeenAt) {
      lines.push(
        `Last seen: ${OneUptimeDate.getDateAsFormattedString(insight.lastSeenAt)}`,
      );
    }
    if (insight.occurrenceCount) {
      lines.push(`Times detected: ${insight.occurrenceCount}`);
    }

    if (insight.detailMarkdown) {
      lines.push("");
      lines.push(
        "## Detector's evidence (deterministic, computed at detect time)",
      );
      lines.push(insight.detailMarkdown);
    }

    const renderedEvidence: string = this.renderEvidence(insight.evidence);
    if (renderedEvidence) {
      lines.push("");
      lines.push("## Raw evidence values");
      lines.push(renderedEvidence);
    }

    return lines.join("\n");
  }

  /*
   * Render the stored evidence JSON compactly: one line per populated
   * section, values verbatim (the numbers ARE the evidence), capped so a
   * large span-tree finding cannot flood the prompt.
   */
  private static renderEvidence(
    evidence: SentinelInsightEvidence | undefined,
  ): string {
    if (!evidence) {
      return "";
    }

    const lines: Array<string> = [];

    const sections: Array<keyof SentinelInsightEvidence> = [
      "exception",
      "logSpike",
      "latency",
      "metricDrift",
    ];

    for (const section of sections) {
      const value: SentinelInsightEvidence[keyof SentinelInsightEvidence] =
        evidence[section];

      if (!value) {
        continue;
      }

      let rendered: string;
      try {
        rendered = JSON.stringify(value);
      } catch {
        continue;
      }

      if (rendered.length > MAX_RENDERED_EVIDENCE_CHARS) {
        rendered = `${rendered.substring(0, MAX_RENDERED_EVIDENCE_CHARS)}… (truncated)`;
      }

      lines.push(`- ${section}: ${rendered}`);
    }

    return lines.join("\n");
  }
}
