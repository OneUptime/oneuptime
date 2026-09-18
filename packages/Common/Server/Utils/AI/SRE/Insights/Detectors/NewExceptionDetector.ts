import ObjectID from "../../../../../../Types/ObjectID";
import OneUptimeDate from "../../../../../../Types/Date";
import SortOrder from "../../../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../../../Types/JSON";
import IncludesNone from "../../../../../../Types/BaseDatabase/IncludesNone";
import { NON_ACTIONABLE_ERROR_CLASSES } from "../../../../../../Types/Telemetry/ErrorClass";
import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import AIInsightSeverity from "../../../../../../Types/AI/AIInsightSeverity";
import TelemetryException from "../../../../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../../../../Models/DatabaseModels/Service";
import TelemetryExceptionService from "../../../../../Services/TelemetryExceptionService";
import ServiceService from "../../../../../Services/ServiceService";
import QueryHelper from "../../../../../Types/Database/QueryHelper";
import logger from "../../../../Logger";
import { sanitizeExceptionMessage } from "../../../../Telemetry/ExceptionSanitizer";
import {
  EXCEPTION_LABEL_MESSAGE_MAX_LENGTH,
  buildExceptionFailureModeKey,
  buildExceptionLabel,
} from "./ExceptionIdentity";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../Types";

/*
 * NewException — a brand-new failure mode in the code: a telemetry
 * exception group whose FIRST occurrence is inside the lookback window and
 * that is already recurring (not a one-off blip). Postgres-only and cheap:
 * the exception groups table carries firstSeenAt and the lifetime
 * occurrence count, so no ClickHouse scan is needed at all. Deterministic —
 * no LLM anywhere in this detector.
 *
 * ONE INSIGHT PER FAILURE MODE, NOT PER EXCEPTION GROUP. Group identity at
 * ingest hashes the normalized STACK TRACE alongside the type and message, so
 * one logical failure raised from several call sites is several groups. This
 * detector used to file one insight per group, which filed the same finding
 * over and over — and because the title was the exceptionType alone, the rows
 * were not merely duplicated but indistinguishable (a service whose
 * instrumentation reports `exception.type = "401"` produced a wall of
 * identical "New exception: 401 in api" rows). Candidates are therefore
 * bucketed on the (entity, type, normalized message) failure mode, counts are
 * summed across the member groups, and the insight is fingerprinted on that
 * bucket — see ExceptionIdentity.
 */

/*
 * Only exceptions born within this window count as "new". 24h matches the
 * scanner's dedupe horizon: with a 15-minute scan tick every new exception
 * is seen many times within the window, and the fingerprint upsert
 * refreshes the same insight instead of duplicating it.
 */
export const NEW_EXCEPTION_LOOKBACK_HOURS: number = 24;

/*
 * A single occurrence is noise (a deploy hiccup, a one-off bad request).
 * Three occurrences means the failure path is being re-hit — worth a
 * human's attention. Applied per exception GROUP, before bucketing: a
 * failure mode must have at least one group that is genuinely recurring,
 * rather than qualifying by adding up single-occurrence stack variants.
 */
export const NEW_EXCEPTION_MIN_OCCURRENCE_COUNT: number = 3;

/*
 * At 50+ occurrences inside its first day the exception is hammering a hot
 * path — escalate to High so it sorts above the long tail. Measured on the
 * failure mode's summed count, which is what the insight reports.
 */
export const NEW_EXCEPTION_HIGH_SEVERITY_OCCURRENCE_COUNT: number = 50;

/*
 * How many exception GROUPS one tick reads. Higher than the candidate cap
 * because groups collapse into failure modes: a single noisy throw site can
 * easily own dozens of stack-trace variants, and reading only 25 of them
 * would let one loud failure mode crowd every other one out of the tick. It
 * is one indexed Postgres query either way.
 */
export const NEW_EXCEPTION_GROUP_SCAN_LIMIT: number = 100;

/*
 * Upper bound on candidates per scan tick, applied AFTER bucketing — a
 * project melting down does not need 500 insights, and the scanner
 * additionally caps new insights per tick.
 */
export const NEW_EXCEPTION_CANDIDATE_LIMIT: number = 25;

// Titles must stay scannable in a list — truncate long exception messages.
export const NEW_EXCEPTION_TITLE_MESSAGE_MAX_LENGTH: number =
  EXCEPTION_LABEL_MESSAGE_MAX_LENGTH;

export interface NewExceptionDecision {
  qualifies: boolean;
  severity: AIInsightSeverity;
}

/*
 * One failure mode: the exception groups that share an (entity, type,
 * normalized message) identity, rolled up into the numbers the insight
 * reports.
 */
export interface NewExceptionFailureMode {
  failureModeKey: string;
  // The loudest member group — what the insight links to and labels itself by.
  representative: TelemetryException;
  // The representative's id, narrowed once at bucket time.
  representativeExceptionId: ObjectID;
  // Summed lifetime occurrences across every member group.
  totalOccurrenceCount: number;
  // How many distinct exception groups (stack variants) rolled up here.
  groupCount: number;
  // Earliest firstSeenAt across the member groups.
  firstSeenAt: Date | undefined;
  // The representative's message, sanitized once.
  safeMessage: string;
}

export default class NewExceptionDetector implements InsightDetector {
  public insightType: AIInsightType = AIInsightType.NewException;

  /*
   * Pure decision: does an occurrence count qualify, and how urgent is it.
   * The query already filters on the minimum count — this re-check keeps the
   * rule in one unit-testable place.
   */
  public static evaluateNewException(
    occurrenceCount: number,
  ): NewExceptionDecision {
    return {
      qualifies: occurrenceCount >= NEW_EXCEPTION_MIN_OCCURRENCE_COUNT,
      severity:
        occurrenceCount >= NEW_EXCEPTION_HIGH_SEVERITY_OCCURRENCE_COUNT
          ? AIInsightSeverity.High
          : AIInsightSeverity.Medium,
    };
  }

  /*
   * Human label for the exception: the type AND the message, because either
   * one alone collides across findings (see ExceptionIdentity).
   */
  public static buildExceptionLabel(
    exceptionType: string | undefined,
    message: string | undefined,
  ): string {
    return buildExceptionLabel(
      exceptionType,
      message,
      NEW_EXCEPTION_TITLE_MESSAGE_MAX_LENGTH,
    );
  }

  /*
   * Stable dedupe key. Keyed on the FAILURE MODE (entity + exception type +
   * normalized message), never on the exception group id: group identity
   * includes the stack trace, so one failure raised from several call sites
   * would otherwise file one insight per call site.
   */
  public static buildFingerprint(failureModeKey: string): string {
    return `new-exception:${failureModeKey}`;
  }

  public async detect(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    const firstSeenSince: Date = OneUptimeDate.addRemoveHours(
      context.now,
      -1 * NEW_EXCEPTION_LOOKBACK_HOURS,
    );

    const query: JSONObject = {
      projectId: context.projectId,
      firstSeenAt: QueryHelper.greaterThanEqualTo(firstSeenSince),
      isResolved: false,
      isArchived: false,
      /*
       * Muted fault domains never file an insight. A user-error or an
       * expected-denial group is not a defect in this code, so triaging it
       * would spend an LLM budget grant to be told exactly what the
       * emitting code already declared. Mirrors the Issues list scope, so
       * the inbox and the list agree on what counts as a real failure.
       */
      errorClass: new IncludesNone([...NON_ACTIONABLE_ERROR_CLASSES]),
      occuranceCount: QueryHelper.greaterThanEqualTo(
        NEW_EXCEPTION_MIN_OCCURRENCE_COUNT,
      ),
    };

    /*
     * Root read with an explicit projectId in the query — the scanner is a
     * server-side worker (monitor-worker precedent), never a user ACL.
     *
     * firstSeenAt is a deterministic tie-break on the LIMIT boundary:
     * occuranceCount is incremented on every ingested event, so the long
     * tail of a noisy endpoint sits densely tied right at the cut and an
     * untie-broken ORDER BY hands back an arbitrary, shifting subset each
     * tick. Bucketing already keeps that churn from filing duplicates; the
     * tie-break keeps the tick itself reproducible.
     */
    const exceptions: Array<TelemetryException> =
      await TelemetryExceptionService.findBy({
        query: query as never,
        select: {
          _id: true,
          message: true,
          exceptionType: true,
          occuranceCount: true,
          firstSeenAt: true,
          primaryEntityId: true,
        },
        sort: {
          occuranceCount: SortOrder.Descending,
          firstSeenAt: SortOrder.Ascending,
        },
        limit: NEW_EXCEPTION_GROUP_SCAN_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

    const failureModes: Array<NewExceptionFailureMode> =
      NewExceptionDetector.bucketIntoFailureModes(exceptions);

    const candidates: Array<InsightCandidate> = [];

    // Service names are resolved once per entity, not once per group.
    const serviceNameCache: Map<string, string | null> = new Map();

    for (const failureMode of failureModes) {
      const decision: NewExceptionDecision =
        NewExceptionDetector.evaluateNewException(
          failureMode.totalOccurrenceCount,
        );

      if (!decision.qualifies) {
        continue;
      }

      const serviceName: string | null = await this.resolveServiceName(
        failureMode.representative.primaryEntityId,
        serviceNameCache,
      );

      const label: string = NewExceptionDetector.buildExceptionLabel(
        failureMode.representative.exceptionType,
        failureMode.safeMessage,
      );

      const firstSeenAtIso: string | undefined = failureMode.firstSeenAt
        ? failureMode.firstSeenAt.toISOString()
        : undefined;

      const detailLines: Array<string> = [
        "**New exception detected**",
        "",
        `- Exception: \`${label}\``,
      ];
      if (failureMode.safeMessage) {
        detailLines.push(`- Message: ${failureMode.safeMessage}`);
      }
      if (serviceName) {
        detailLines.push(`- Service: ${serviceName}`);
      }
      detailLines.push(
        `- First seen: ${firstSeenAtIso || "unknown"} (within the last ${NEW_EXCEPTION_LOOKBACK_HOURS}h)`,
        `- Occurrences so far: ${failureMode.totalOccurrenceCount}`,
      );
      if (failureMode.groupCount > 1) {
        detailLines.push(
          `- Raised from ${failureMode.groupCount} distinct stack traces (same exception type and message — counted together as one failure mode)`,
        );
      }

      candidates.push({
        insightType: AIInsightType.NewException,
        fingerprint: NewExceptionDetector.buildFingerprint(
          failureMode.failureModeKey,
        ),
        title: `New exception: ${label}${serviceName ? ` in ${serviceName}` : ""}`,
        detailMarkdown: detailLines.join("\n"),
        severity: decision.severity,
        serviceName: serviceName || undefined,
        telemetryServiceId: serviceName
          ? failureMode.representative.primaryEntityId
          : undefined,
        telemetryExceptionId: failureMode.representativeExceptionId,
        evidence: {
          exception: {
            exceptionMessage: failureMode.safeMessage,
            exceptionType: failureMode.representative.exceptionType,
            totalOccurrenceCount: failureMode.totalOccurrenceCount,
            distinctExceptionGroupCount: failureMode.groupCount,
            firstSeenAt: firstSeenAtIso,
          },
        },
      });

      if (candidates.length >= NEW_EXCEPTION_CANDIDATE_LIMIT) {
        // No silent caps — say what this tick left on the floor.
        if (failureModes.length > candidates.length) {
          logger.debug(
            `AI Insights: NewException capped at ${NEW_EXCEPTION_CANDIDATE_LIMIT} candidates for project ${context.projectId.toString()} — ${
              failureModes.length - candidates.length
            } further failure mode(s) this tick were not emitted. They re-surface on later ticks while their exceptions stay inside the ${NEW_EXCEPTION_LOOKBACK_HOURS}h window.`,
          );
        }
        break;
      }
    }

    return candidates;
  }

  /*
   * Roll the tick's exception groups up into failure modes, loudest first.
   *
   * The representative is the group with the highest lifetime occurrence
   * count (ties broken by the earliest firstSeenAt, then by id, so the choice
   * is deterministic rather than dependent on row order). It supplies the
   * label and the exception the insight links to — but NOT the fingerprint,
   * which is the bucket key, so a representative that changes as counts move
   * can never file a second insight for the same failure mode.
   */
  public static bucketIntoFailureModes(
    exceptions: Array<TelemetryException>,
  ): Array<NewExceptionFailureMode> {
    const buckets: Map<string, NewExceptionFailureMode> = new Map();

    for (const exception of exceptions) {
      const exceptionId: ObjectID | undefined = exception.id || undefined;

      if (!exceptionId) {
        continue;
      }

      const failureModeKey: string = buildExceptionFailureModeKey({
        primaryEntityId: exception.primaryEntityId,
        exceptionType: exception.exceptionType,
        message: exception.message,
      });

      const occurrenceCount: number = exception.occuranceCount || 0;
      const existing: NewExceptionFailureMode | undefined =
        buckets.get(failureModeKey);

      if (!existing) {
        buckets.set(failureModeKey, {
          failureModeKey: failureModeKey,
          representative: exception,
          representativeExceptionId: exceptionId,
          totalOccurrenceCount: occurrenceCount,
          groupCount: 1,
          firstSeenAt: exception.firstSeenAt,
          /*
           * The message flows into the insight title/detail/evidence, and
           * from there into the triage LLM prompt — sanitize it once here so
           * no interpolated user data (IDs, emails, domains) rides along. The
           * raw message stays on the exception row for the dashboard.
           */
          safeMessage: sanitizeExceptionMessage(exception.message || ""),
        });
        continue;
      }

      existing.totalOccurrenceCount += occurrenceCount;
      existing.groupCount++;

      if (
        exception.firstSeenAt &&
        (!existing.firstSeenAt || exception.firstSeenAt < existing.firstSeenAt)
      ) {
        existing.firstSeenAt = exception.firstSeenAt;
      }

      if (
        NewExceptionDetector.isBetterRepresentative(
          exception,
          existing.representative,
        )
      ) {
        existing.representative = exception;
        existing.representativeExceptionId = exceptionId;
        existing.safeMessage = sanitizeExceptionMessage(
          exception.message || "",
        );
      }
    }

    /*
     * Loudest first, ties broken on the key — the candidate cap cuts this
     * list, so the order decides what a tick emits and it must not depend on
     * the arbitrary order rows came back in.
     */
    return Array.from(buckets.values()).sort(
      (a: NewExceptionFailureMode, b: NewExceptionFailureMode): number => {
        if (a.totalOccurrenceCount !== b.totalOccurrenceCount) {
          return b.totalOccurrenceCount - a.totalOccurrenceCount;
        }
        return a.failureModeKey < b.failureModeKey ? -1 : 1;
      },
    );
  }

  // Loudest wins; ties go to the older group, then to the lower id.
  private static isBetterRepresentative(
    candidate: TelemetryException,
    current: TelemetryException,
  ): boolean {
    const candidateCount: number = candidate.occuranceCount || 0;
    const currentCount: number = current.occuranceCount || 0;

    if (candidateCount !== currentCount) {
      return candidateCount > currentCount;
    }

    if (candidate.firstSeenAt && current.firstSeenAt) {
      const candidateTime: number = candidate.firstSeenAt.getTime();
      const currentTime: number = current.firstSeenAt.getTime();
      if (candidateTime !== currentTime) {
        return candidateTime < currentTime;
      }
    }

    return (candidate.id?.toString() || "") < (current.id?.toString() || "");
  }

  /*
   * Best-effort service attribution: primaryEntityId is polymorphic
   * (Service/Host/DockerHost/...), and findOneById simply returns null for
   * the non-Service kinds (AIInvestigationAPI precedent) — the insight then
   * ships without a service name. Cached per tick: a project's exceptions
   * cluster on a handful of services, and the lookup is the only per-
   * candidate IO left in this detector.
   */
  private async resolveServiceName(
    primaryEntityId: ObjectID | undefined,
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    if (!primaryEntityId) {
      return null;
    }

    const cacheKey: string = primaryEntityId.toString();
    const cached: string | null | undefined = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const service: Service | null = await ServiceService.findOneById({
      id: primaryEntityId,
      select: { name: true },
      props: { isRoot: true },
    });

    const serviceName: string | null = service?.name || null;
    cache.set(cacheKey, serviceName);
    return serviceName;
  }
}
