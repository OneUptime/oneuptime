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
 */
export const DISMISSED_COOLDOWN_DAYS: number = 7;

/*
 * The same idea for the other human terminal state, with a much shorter
 * clock: a resolved issue that comes back IS a regression worth re-filing,
 * but it has to actually come back first.
 *
 * WITHOUT THIS, RESOLVE DID NOT STICK. Detectors emit on a standing
 * condition, not on an event — NewException re-emits an unchanged candidate
 * on all ~96 ticks of the 24h window after the exception's firstSeenAt, and
 * resolving an insight changes nothing the detector looks at. So a Resolved
 * row (terminal, therefore never refreshed) fell straight through to CREATE
 * and a byte-identical insight reappeared within 15 minutes, complete with
 * its own triage LLM run. Resolving again just minted another one.
 *
 * 24 hours is chosen to cover NEW_EXCEPTION_LOOKBACK_HOURS: it outlasts the
 * window in which a NewException candidate is re-emitted from the same
 * evidence, so that finding stays closed, while the standing-condition
 * detectors (spikes, drift) can still re-file a day later if their signal
 * genuinely returns.
 */
export const RESOLVED_COOLDOWN_HOURS: number = 24;

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
   *   - Resolved within the cooldown  → suppress
   *   - either, past its cooldown     → CREATE (regression / recurrence)
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
            // The cooldown fallback when no verdict was ever stamped.
            lastSeenAt: true,
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
              /*
               * The title is refreshed with the rest of the picture, not
               * frozen at creation. Detectors put live numbers in it (a spike
               * multiplier, a latency factor) and the label itself sharpens as
               * more of the failure is observed — a row left showing "at 5.2x"
               * beside a High severity and a 12x detail body reads as a bug.
               */
              title: this.clampToColumn(
                candidate.title,
                INSIGHT_TITLE_MAX_LENGTH,
              ),
              detailMarkdown: candidate.detailMarkdown,
              evidence: candidate.evidence,
            },
            props: { isRoot: true },
          });

          result.refreshed++;
          continue;
        }

        if (
          existing &&
          existing.status &&
          AIInsightStatusHelper.isTerminalStatus(existing.status)
        ) {
          /*
           * Both human terminal states get a cooldown, measured from the
           * human's action and inclusive at the boundary (a cooldown exactly
           * elapsed still suppresses). They differ only in length: a
           * dismissal says "this is not worth my time" (7 days), a resolve
           * says "handled" (24 hours — long enough that the detector stops
           * re-emitting the very evidence the human just closed).
           */
          const isDismissed: boolean =
            existing.status === AIInsightStatus.Dismissed;

          const cooldownMs: number = isDismissed
            ? OneUptimeDate.getMillisecondsInDays(DISMISSED_COOLDOWN_DAYS)
            : OneUptimeDate.getMillisecondsInHours(RESOLVED_COOLDOWN_HOURS);

          /*
           * humanVerdictAt is the moment the human acted. It can be missing
           * (defensive) and, on a Confirm-then-Resolve, it holds the CONFIRM
           * time — resolveInsight leaves an existing verdict alone. lastSeenAt
           * is the fallback: refreshes stop the moment a row goes terminal, so
           * it is pinned to the last tick before the human closed it, which is
           * never later than the close. Neither available → suppress; a
           * terminal row we cannot date must not be re-filed every 15 minutes
           * (G11 noise posture: when in doubt, stay quiet).
           */
          const closedAt: Date | undefined = existing.humanVerdictAt
            ? OneUptimeDate.fromString(existing.humanVerdictAt)
            : existing.lastSeenAt
              ? OneUptimeDate.fromString(existing.lastSeenAt)
              : undefined;

          const withinCooldown: boolean = closedAt
            ? data.now.getTime() - closedAt.getTime() <= cooldownMs
            : true;

          if (withinCooldown) {
            logger.debug(
              `AI Insights: suppressing candidate ${fingerprint} for project ${data.projectId.toString()} — ${
                isDismissed
                  ? `dismissed by a human within the last ${DISMISSED_COOLDOWN_DAYS} days`
                  : `resolved by a human within the last ${RESOLVED_COOLDOWN_HOURS} hours`
              }.`,
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
