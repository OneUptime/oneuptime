import ObjectID from "../../../../../Types/ObjectID";
import OneUptimeDate from "../../../../../Types/Date";
import ColumnLength from "../../../../../Types/Database/ColumnLength";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIInsightStatus, {
  AIInsightStatusHelper,
} from "../../../../../Types/AI/AIInsightStatus";
import AIInsightService from "../../../../Services/AIInsightService";
import { InsightCandidate } from "./Types";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

/*
 * AI Insights — the dedupe/upsert store between detectors and the
 * AIInsight table. Detectors re-emit the same finding on every scan
 * tick while the underlying signal persists; the store's job is to keep the
 * inbox quiet: one row per live finding (refreshed in place), a cooldown on
 * findings a human already dismissed, and a hard cap on how many NEW rows a
 * single scan may create.
 */

/*
 * G4/G11 volume guardrail: a single scan tick may create at most this many
 * NEW insights per project. A telemetry storm (deploy gone wrong, detector
 * mis-tuning) would otherwise flood the inbox — and every new insight fans
 * out into budgeted triage/fix work. Recurring findings still refresh their
 * existing rows beyond the cap; drops are logged, never silent.
 */
export const MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN: number = 10;

/*
 * G11 noise posture: a human dismissal is the strongest precision signal we
 * have, so a finding with the same fingerprint stays suppressed for this
 * many days after the dismissal instead of reappearing on the next tick.
 * After the cooldown (or after a Resolved insight's signal returns) a fresh
 * insight is warranted — a resolved issue that reappears is a regression.
 */
export const DISMISSED_COOLDOWN_DAYS: number = 7;

/*
 * Column-safety clamps: DatabaseService validates string columns against the
 * model's declared lengths and THROWS on overflow, and detectors embed raw
 * telemetry strings (a span name can be an entire SQL statement, exception
 * types and service names are unbounded). Clamping here — the single choke
 * point where candidates become rows — protects every current and future
 * detector. The fingerprint clamp is applied to the dedupe LOOKUP as well as
 * the insert, so a clamped fingerprint keeps refreshing the same row instead
 * of failing (or duplicating) on every tick. Values mirror the
 * AIInsight column definitions (LongText/ShortText).
 */
export const INSIGHT_FINGERPRINT_MAX_LENGTH: number = ColumnLength.LongText;
export const INSIGHT_TITLE_MAX_LENGTH: number = ColumnLength.LongText;
export const INSIGHT_SERVICE_NAME_MAX_LENGTH: number = ColumnLength.LongText;
export const INSIGHT_METRIC_NAME_MAX_LENGTH: number = ColumnLength.LongText;
export const INSIGHT_TRACE_ID_MAX_LENGTH: number = ColumnLength.ShortText;

export interface UpsertCandidatesResult {
  // Newly created insights (status Detected) — the scanner routes these.
  created: Array<AIInsight>;
  // Existing non-terminal insights refreshed in place.
  refreshed: number;
  // Candidates suppressed by the dismissed-fingerprint cooldown.
  suppressed: number;
  // Candidates dropped by MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN.
  droppedByCap: number;
}

export default class InsightStore {
  /*
   * Upsert one scan tick's candidates for one project. For each candidate,
   * the most recent insight with the same (projectId, fingerprint) decides
   * the outcome:
   *   - none                          → CREATE (subject to the per-scan cap)
   *   - non-terminal                  → REFRESH (never touches status)
   *   - Dismissed within the cooldown → suppress
   *   - Dismissed past the cooldown,
   *     or Resolved                   → CREATE (regression / recurrence)
   * All access is root-props: the scanner is a system actor with explicit
   * projectId scoping, not a per-user ACL consumer.
   */
  @CaptureSpan()
  public static async upsertCandidates(data: {
    projectId: ObjectID;
    candidates: Array<InsightCandidate>;
    now: Date;
  }): Promise<UpsertCandidatesResult> {
    const result: UpsertCandidatesResult = {
      created: [],
      refreshed: 0,
      suppressed: 0,
      droppedByCap: 0,
    };

    // No silent caps: dropped fingerprints are logged after the loop.
    const droppedFingerprints: Array<string> = [];

    for (const candidate of data.candidates) {
      /*
       * Per-candidate isolation: one failing candidate (transient DB error,
       * unexpected data) must not abort the batch — insights created earlier
       * in this tick are returned for routing either way, and the remaining
       * candidates still get their chance. Without this, a mid-batch failure
       * would strand already-created rows in Detected forever (refreshes
       * never touch status, so they would never be routed).
       */
      try {
        /*
         * The clamped fingerprint is the row's identity everywhere — lookup
         * and insert — so dedupe survives the clamp (see the constants).
         */
        const fingerprint: string = this.clampToColumn(
          candidate.fingerprint,
          INSIGHT_FINGERPRINT_MAX_LENGTH,
        );

        /*
         * Most recent row wins: (projectId, fingerprint) is deliberately NOT
         * unique — terminal rows accumulate as history — so sort by createdAt
         * to judge against the latest lifecycle state of this finding.
         */
        const existing: AIInsight | null = await AIInsightService.findOneBy({
          query: {
            projectId: data.projectId,
            fingerprint: fingerprint,
          },
          select: {
            _id: true,
            status: true,
            occurrenceCount: true,
            humanVerdictAt: true,
          },
          sort: { createdAt: SortOrder.Descending },
          props: { isRoot: true },
        });

        if (
          existing &&
          existing.status &&
          !AIInsightStatusHelper.isTerminalStatus(existing.status)
        ) {
          /*
           * REFRESH: the finding is still live and already has a row. The
           * evidence/severity are replaced with this tick's numbers (the
           * newest picture of the signal), but status is NEVER touched here —
           * routing (ActionRequired/FixOpened) happened when the row was
           * created and humans/fix flows own it from there.
           */
          await AIInsightService.updateOneById({
            id: existing.id!,
            data: {
              lastSeenAt: data.now,
              occurrenceCount: (existing.occurrenceCount || 1) + 1,
              severity: candidate.severity,
              detailMarkdown: candidate.detailMarkdown,
              evidence: candidate.evidence,
            },
            props: { isRoot: true },
          });

          result.refreshed++;
          continue;
        }

        if (existing && existing.status === AIInsightStatus.Dismissed) {
          /*
           * Cooldown is measured from the human's dismissal, inclusive at the
           * boundary (exactly DISMISSED_COOLDOWN_DAYS old still suppresses).
           * A Dismissed row without a verdict timestamp cannot prove the
           * cooldown elapsed, so it suppresses too — when in doubt, stay
           * quiet (G11 noise posture).
           */
          const cooldownMs: number = OneUptimeDate.getMillisecondsInDays(
            DISMISSED_COOLDOWN_DAYS,
          );

          const withinCooldown: boolean = existing.humanVerdictAt
            ? data.now.getTime() -
                OneUptimeDate.fromString(existing.humanVerdictAt).getTime() <=
              cooldownMs
            : true;

          if (withinCooldown) {
            logger.debug(
              `AI Insights: suppressing candidate ${fingerprint} for project ${data.projectId.toString()} — dismissed by a human within the last ${DISMISSED_COOLDOWN_DAYS} days.`,
            );

            result.suppressed++;
            continue;
          }
        }

        /*
         * CREATE: no live row for this fingerprint (never seen, Resolved, or
         * Dismissed long enough ago). Subject to the per-scan cap.
         */
        if (result.created.length >= MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN) {
          droppedFingerprints.push(fingerprint);
          result.droppedByCap++;
          continue;
        }

        const insight: AIInsight = new AIInsight();
        insight.projectId = data.projectId;
        insight.insightType = candidate.insightType;
        // Defensive initial state — the scanner routes it in the same tick.
        insight.status = AIInsightStatus.Detected;
        insight.severity = candidate.severity;
        insight.fingerprint = fingerprint;
        insight.title = this.clampToColumn(
          candidate.title,
          INSIGHT_TITLE_MAX_LENGTH,
        );
        insight.detailMarkdown = candidate.detailMarkdown;
        insight.evidence = candidate.evidence;
        insight.firstSeenAt = data.now;
        insight.lastSeenAt = data.now;
        insight.occurrenceCount = 1;

        if (candidate.serviceName) {
          insight.serviceName = this.clampToColumn(
            candidate.serviceName,
            INSIGHT_SERVICE_NAME_MAX_LENGTH,
          );
        }
        if (candidate.telemetryServiceId) {
          insight.telemetryServiceId = candidate.telemetryServiceId;
        }
        if (candidate.telemetryExceptionId) {
          insight.telemetryExceptionId = candidate.telemetryExceptionId;
        }
        if (candidate.traceId) {
          insight.traceId = this.clampToColumn(
            candidate.traceId,
            INSIGHT_TRACE_ID_MAX_LENGTH,
          );
        }
        if (candidate.metricName) {
          insight.metricName = this.clampToColumn(
            candidate.metricName,
            INSIGHT_METRIC_NAME_MAX_LENGTH,
          );
        }

        const created: AIInsight = await AIInsightService.create({
          data: insight,
          props: { isRoot: true },
        });

        result.created.push(created);
      } catch (error) {
        logger.error(
          `AI Insights: upsert failed for candidate ${candidate.fingerprint} (project ${data.projectId.toString()}) — continuing with the remaining candidates: ${error}`,
        );
      }
    }

    if (result.droppedByCap > 0) {
      logger.debug(
        `AI Insights: candidate fingerprints dropped by the per-scan cap for project ${data.projectId.toString()}: ${droppedFingerprints.join(", ")}`,
      );
      logger.info(
        `AI Insights: per-scan new-insight cap (${MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN}) reached for project ${data.projectId.toString()} — dropped ${result.droppedByCap} candidate(s) this tick. Recurring findings will re-surface on later ticks if their signal persists.`,
      );
    }

    return result;
  }

  /*
   * Hard code-unit slice to the column's declared length — the same measure
   * DatabaseService validates against, so a clamped value can never trip the
   * length check. No cosmetic ellipsis: detectors own presentation; this is
   * purely a data-safety guard, and it must be deterministic so a clamped
   * fingerprint stays stable across ticks.
   */
  private static clampToColumn(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }
    return value.slice(0, maxLength);
  }
}
