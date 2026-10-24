import ObjectID from "../../../../../../Types/ObjectID";
import SortOrder from "../../../../../../Types/BaseDatabase/SortOrder";
import IncludesNone from "../../../../../../Types/BaseDatabase/IncludesNone";
import PositiveNumber from "../../../../../../Types/PositiveNumber";
import { JSONObject } from "../../../../../../Types/JSON";
import { NON_ACTIONABLE_ERROR_CLASSES } from "../../../../../../Types/Telemetry/ErrorClass";
import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import { ExceptionStackTraceInsightEvidence } from "../../../../../../Types/AI/AIInsightEvidence";
import TelemetryException from "../../../../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../../../../Models/DatabaseModels/Service";
import TelemetryExceptionService from "../../../../../Services/TelemetryExceptionService";
import ServiceService from "../../../../../Services/ServiceService";
import QueryHelper from "../../../../../Types/Database/QueryHelper";
import { sanitizeExceptionMessage } from "../../../../Telemetry/ExceptionSanitizer";
import {
  EXCEPTION_STACK_TRACE_GROUP_SCAN_LIMIT,
  ExceptionStackTraceGroupReading,
  ExceptionStackTraceServicePick,
  ExceptionStackTraceWindow,
  buildExceptionStackTraceDetail,
  buildExceptionStackTraceEvidence,
  getExceptionStackTraceFingerprint,
  getExceptionStackTraceSeverity,
  getExceptionStackTraceTitle,
  getExceptionStackTraceWindow,
  pickServicesMissingStackTraces,
} from "../../../../../../Utils/Exceptions/ExceptionInsight";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../Types";

/*
 * ExceptionMissingStackTrace - a service whose exceptions over the last day
 * were recorded with no stack trace at all, 20 or more times together, so
 * no frame says which of its code raised them, and neither a person nor
 * OneUptime AI can fix them (Utils/Exceptions/ExceptionInsight). The
 * Exceptions product's AI section files it, and its pull request makes the
 * service record a stack trace with every exception.
 *
 * Postgres only, and cheap: an exception group keeps its stack trace once
 * any occurrence brought one (the ingest upsert), so a group whose stack
 * trace is still empty never had one. Deterministic - no LLM anywhere in
 * this detector.
 *
 * Only real failures count, as on the Issues list: groups that are not
 * resolved, not archived, and not a user error or an expected denial. Only
 * a service's: an exception whose telemetry names a host or a cluster is
 * nobody's code to change. The loudest services first, at most three a
 * look, each one finding - refreshed while it lasts, and one pull request.
 * The finding names no exception of its own (telemetryExceptionId), so the
 * investigation's verdict on it - about instrumentation - is never stamped
 * onto an exception's error class.
 */
export default class ExceptionMissingStackTraceDetector
  implements InsightDetector
{
  public insightType: AIInsightType = AIInsightType.ExceptionMissingStackTrace;

  public async detect(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    const window: ExceptionStackTraceWindow = getExceptionStackTraceWindow(
      context.now,
    );

    const query: JSONObject = {
      projectId: context.projectId,
      lastSeenAt: QueryHelper.greaterThanEqualTo(window.startTime),
      isResolved: false,
      isArchived: false,
      errorClass: new IncludesNone([...NON_ACTIONABLE_ERROR_CLASSES]),
      stackTrace: QueryHelper.equalToOrNull(""),
    };

    /*
     * Root read with the project in the query: the scanner is a system
     * actor. Loudest first, with a tie-break, so the groups read at the
     * limit are the same every look.
     */
    const exceptions: Array<TelemetryException> =
      await TelemetryExceptionService.findBy({
        query: query as never,
        select: {
          _id: true,
          message: true,
          exceptionType: true,
          occuranceCount: true,
          lastSeenAt: true,
          primaryEntityId: true,
        },
        sort: {
          occuranceCount: SortOrder.Descending,
          firstSeenAt: SortOrder.Ascending,
        },
        limit: EXCEPTION_STACK_TRACE_GROUP_SCAN_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

    if (exceptions.length === 0) {
      return [];
    }

    const services: Map<string, string> =
      await ExceptionMissingStackTraceDetector.readServiceNames({
        projectId: context.projectId,
        entityIds: exceptions
          .map((exception: TelemetryException): string => {
            return exception.primaryEntityId?.toString() || "";
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          }),
      });

    const readings: Array<ExceptionStackTraceGroupReading> = [];

    for (const exception of exceptions) {
      const serviceId: string = (
        exception.primaryEntityId?.toString() || ""
      ).toLowerCase();

      if (!exception.id || !serviceId || !services.has(serviceId)) {
        continue;
      }

      readings.push({
        telemetryExceptionId: exception.id.toString(),
        serviceId,
        exceptionType: sanitizeExceptionMessage(exception.exceptionType || ""),
        exceptionMessage: sanitizeExceptionMessage(exception.message || ""),
        occurrenceCount: exception.occuranceCount || 0,
        lastSeenAt: exception.lastSeenAt
          ? new Date(exception.lastSeenAt).toISOString()
          : window.endTime.toISOString(),
      });
    }

    const candidates: Array<InsightCandidate> = [];

    for (const pick of pickServicesMissingStackTraces(readings)) {
      const serviceName: string = services.get(pick.serviceId) || "";
      const evidence: ExceptionStackTraceInsightEvidence =
        buildExceptionStackTraceEvidence({
          pick,
          window,
          withStackTraceCount:
            await ExceptionMissingStackTraceDetector.countWithStackTrace({
              projectId: context.projectId,
              pick,
              window,
            }),
        });

      candidates.push({
        insightType: AIInsightType.ExceptionMissingStackTrace,
        fingerprint: getExceptionStackTraceFingerprint(pick.serviceId),
        title: getExceptionStackTraceTitle({ evidence, serviceName }),
        detailMarkdown: buildExceptionStackTraceDetail({
          serviceName,
          evidence,
        }).toString(),
        severity: getExceptionStackTraceSeverity(evidence),
        serviceName: serviceName || undefined,
        telemetryServiceId: new ObjectID(pick.serviceId),
        evidence: { exceptionStackTrace: evidence },
      });
    }

    return candidates;
  }

  /*
   * The names of the entities that are services, by id (lower case): a
   * host's or a cluster's id finds none.
   */
  private static async readServiceNames(data: {
    projectId: ObjectID;
    entityIds: Array<string>;
  }): Promise<Map<string, string>> {
    const ids: Array<string> = Array.from(new Set(data.entityIds));
    const names: Map<string, string> = new Map<string, string>();

    if (ids.length === 0) {
      return names;
    }

    const services: Array<Service> = await ServiceService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(ids),
      },
      select: { _id: true, name: true },
      limit: ids.length,
      skip: 0,
      props: { isRoot: true },
    });

    for (const service of services) {
      const id: string | undefined = service.id?.toString().toLowerCase();

      if (id) {
        names.set(id, service.name || "");
      }
    }

    return names;
  }

  /*
   * The service's exceptions of the same day that did carry a stack trace,
   * whatever their status: none says the service records every exception
   * without one.
   */
  private static async countWithStackTrace(data: {
    projectId: ObjectID;
    pick: ExceptionStackTraceServicePick;
    window: ExceptionStackTraceWindow;
  }): Promise<number> {
    const count: PositiveNumber = await TelemetryExceptionService.countBy({
      query: {
        projectId: data.projectId,
        primaryEntityId: new ObjectID(data.pick.serviceId),
        lastSeenAt: QueryHelper.greaterThanEqualTo(data.window.startTime),
        stackTrace: QueryHelper.notEquals(""),
      } as never,
      props: { isRoot: true },
    });

    return count.toNumber();
  }
}
