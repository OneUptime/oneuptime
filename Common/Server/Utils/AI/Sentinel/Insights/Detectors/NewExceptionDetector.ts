import ObjectID from "../../../../../../Types/ObjectID";
import OneUptimeDate from "../../../../../../Types/Date";
import SortOrder from "../../../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../../../Types/JSON";
import SentinelInsightType from "../../../../../../Types/AI/SentinelInsightType";
import SentinelInsightSeverity from "../../../../../../Types/AI/SentinelInsightSeverity";
import TelemetryException from "../../../../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../../../../Models/DatabaseModels/Service";
import TelemetryExceptionService from "../../../../../Services/TelemetryExceptionService";
import ServiceService from "../../../../../Services/ServiceService";
import QueryHelper from "../../../../../Types/Database/QueryHelper";
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
 * human's attention.
 */
export const NEW_EXCEPTION_MIN_OCCURRENCE_COUNT: number = 3;

/*
 * At 50+ occurrences inside its first day the exception is hammering a hot
 * path — escalate to High so it sorts above the long tail.
 */
export const NEW_EXCEPTION_HIGH_SEVERITY_OCCURRENCE_COUNT: number = 50;

/*
 * Upper bound on candidates per scan tick. Mirrors the TopExceptionsTool
 * cap — a project melting down does not need 500 insights, and the scanner
 * additionally caps new insights per tick.
 */
export const NEW_EXCEPTION_CANDIDATE_LIMIT: number = 25;

// Titles must stay scannable in a list — truncate long exception messages.
export const NEW_EXCEPTION_TITLE_MESSAGE_MAX_LENGTH: number = 80;

export interface NewExceptionDecision {
  qualifies: boolean;
  severity: SentinelInsightSeverity;
}

export default class NewExceptionDetector implements InsightDetector {
  public insightType: SentinelInsightType = SentinelInsightType.NewException;

  /*
   * Pure decision: does a lifetime occurrence count qualify, and how
   * urgent is it. The query already filters on the minimum count — this
   * re-check keeps the rule in one unit-testable place.
   */
  public static evaluateNewException(
    occurrenceCount: number,
  ): NewExceptionDecision {
    return {
      qualifies: occurrenceCount >= NEW_EXCEPTION_MIN_OCCURRENCE_COUNT,
      severity:
        occurrenceCount >= NEW_EXCEPTION_HIGH_SEVERITY_OCCURRENCE_COUNT
          ? SentinelInsightSeverity.High
          : SentinelInsightSeverity.Medium,
    };
  }

  /*
   * Human label for the exception: the type when present, else the first
   * NEW_EXCEPTION_TITLE_MESSAGE_MAX_LENGTH characters of the message.
   */
  public static buildExceptionLabel(
    exceptionType: string | undefined,
    message: string | undefined,
  ): string {
    if (exceptionType && exceptionType.trim().length > 0) {
      return exceptionType.trim();
    }
    const trimmedMessage: string = (message || "").trim();
    if (trimmedMessage.length === 0) {
      return "Unknown exception";
    }
    if (trimmedMessage.length <= NEW_EXCEPTION_TITLE_MESSAGE_MAX_LENGTH) {
      return trimmedMessage;
    }
    return `${trimmedMessage.slice(0, NEW_EXCEPTION_TITLE_MESSAGE_MAX_LENGTH)}…`;
  }

  /*
   * Stable dedupe key. Keyed on the exception GROUP id (not the message):
   * the group id is the ingest-side dedupe unit, so the insight refreshes
   * instead of duplicating across scan ticks.
   */
  public static buildFingerprint(telemetryExceptionId: string): string {
    return `new-exception:${telemetryExceptionId}`;
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
      occuranceCount: QueryHelper.greaterThanEqualTo(
        NEW_EXCEPTION_MIN_OCCURRENCE_COUNT,
      ),
    };

    /*
     * Root read with an explicit projectId in the query — the scanner is a
     * server-side worker (monitor-worker precedent), never a user ACL.
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
        },
        limit: NEW_EXCEPTION_CANDIDATE_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

    const candidates: Array<InsightCandidate> = [];

    for (const exception of exceptions) {
      const occurrenceCount: number = exception.occuranceCount || 0;
      const decision: NewExceptionDecision =
        NewExceptionDetector.evaluateNewException(occurrenceCount);

      if (!decision.qualifies || !exception.id) {
        continue;
      }

      const serviceName: string | null = await this.resolveServiceName(
        exception.primaryEntityId,
      );

      const label: string = NewExceptionDetector.buildExceptionLabel(
        exception.exceptionType,
        exception.message,
      );

      const firstSeenAtIso: string | undefined = exception.firstSeenAt
        ? exception.firstSeenAt.toISOString()
        : undefined;

      const detailLines: Array<string> = [
        "**New exception detected**",
        "",
        `- Exception: \`${label}\``,
      ];
      if (exception.message) {
        detailLines.push(`- Message: ${exception.message}`);
      }
      if (serviceName) {
        detailLines.push(`- Service: ${serviceName}`);
      }
      detailLines.push(
        `- First seen: ${firstSeenAtIso || "unknown"} (within the last ${NEW_EXCEPTION_LOOKBACK_HOURS}h)`,
        `- Occurrences so far: ${occurrenceCount}`,
      );

      candidates.push({
        insightType: SentinelInsightType.NewException,
        fingerprint: NewExceptionDetector.buildFingerprint(
          exception.id.toString(),
        ),
        title: `New exception: ${label}${serviceName ? ` in ${serviceName}` : ""}`,
        detailMarkdown: detailLines.join("\n"),
        severity: decision.severity,
        serviceName: serviceName || undefined,
        telemetryServiceId: serviceName ? exception.primaryEntityId : undefined,
        telemetryExceptionId: exception.id,
        evidence: {
          exception: {
            exceptionMessage: exception.message,
            exceptionType: exception.exceptionType,
            totalOccurrenceCount: occurrenceCount,
            firstSeenAt: firstSeenAtIso,
          },
        },
      });
    }

    return candidates;
  }

  /*
   * Best-effort service attribution: primaryEntityId is polymorphic
   * (Service/Host/DockerHost/...), and findOneById simply returns null for
   * the non-Service kinds (AIInvestigationAPI precedent) — the insight then
   * ships without a service name.
   */
  private async resolveServiceName(
    primaryEntityId: ObjectID | undefined,
  ): Promise<string | null> {
    if (!primaryEntityId) {
      return null;
    }
    const service: Service | null = await ServiceService.findOneById({
      id: primaryEntityId,
      select: { name: true },
      props: { isRoot: true },
    });
    return service?.name || null;
  }
}
