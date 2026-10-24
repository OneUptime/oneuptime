import ObjectID from "../../../../../../Types/ObjectID";
import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import InBetween from "../../../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../../../Types/BaseDatabase/SortOrder";
import {
  TraceInsightErrorEvidence,
  TraceInsightEvidence,
} from "../../../../../../Types/AI/AIInsightEvidence";
import {
  PerformanceCodeLocation,
  PerformanceFinding,
} from "../../../../../../Types/AI/CodeFixTaskContext";
import Span, {
  SpanEvent,
  SpanEventType,
  SpanStatus,
} from "../../../../../../Models/AnalyticsModels/Span";
import Service from "../../../../../../Models/DatabaseModels/Service";
import SpanService from "../../../../../Services/SpanService";
import ServiceService from "../../../../../Services/ServiceService";
import TraceAggregationService, {
  ServiceLatencyProfile,
  ServiceLatencyProfileRow,
  ServiceSpanHealthRow,
  TraceAnalyticsTableRow,
} from "../../../../../Services/TraceAggregationService";
import QueryHelper from "../../../../../Types/Database/QueryHelper";
import FixPerformanceTaskTrigger, {
  MAX_ANALYZED_TRACE_SPANS,
} from "../../FixPerformanceTaskTrigger";
import LlmConversationPrivacy from "../../../../LlmObservability/LlmConversationPrivacy";
import logger from "../../../../Logger";
import CaptureSpan from "../../../../Telemetry/CaptureSpan";
import {
  sanitizeExceptionMessage,
  sanitizeStackTrace,
} from "../../../../Telemetry/ExceptionSanitizer";
import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../../../../../Utils/Markdown/FeedMarkdown";
import SpanTreeAnalyzer from "../../../../../../Utils/Traces/SpanTreeAnalyzer";
import {
  FailedSpanSample,
  FailedSpansReading,
  SlowRequestReading,
  TRACE_INSIGHT_FAILED_SAMPLE_SIZE,
  TRACE_INSIGHT_MAX_FINDINGS_PER_SERVICE,
  TRACE_INSIGHT_OPERATION_ROWS,
  TRACE_INSIGHT_STACK_TRACE_LINES,
  TRACE_INSIGHT_TOP_OPERATIONS,
  TRACE_INSIGHT_TYPE_BY_KIND,
  TraceFailureVerdict,
  TraceInsightKind,
  TraceInsightSpan,
  TraceInsightWindow,
  TraceOperationReading,
  TraceServiceReading,
  TraceTracingGap,
  describeSlowFindingCost,
  describeTraceError,
  formatTraceDuration,
  formatTracePercent,
  getFailedPercent,
  getOperationRequestSpans,
  getTraceInsightFingerprint,
  getTraceInsightSeverity,
  getTraceInsightTitle,
  getTraceInsightWindow,
  pickFailingOperations,
  pickFailingServices,
  pickNoChildSpanServices,
  pickSlowOperations,
  pickSlowServices,
  readFailedSpans,
  readSlowRequest,
} from "../../../../../../Utils/Traces/TraceInsight";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../Types";

/*
 * The Traces product's AI section's detector (Types/AI/TelemetryAi): slow
 * operations, failing operations, and the operations and services whose
 * traces cannot say why (Utils/Traces/TraceInsight holds every gate). It
 * feeds the lane's AI rules: OneUptime AI looks into each finding and opens
 * a pull request that fixes the code, or adds the tracing it lacks.
 *
 * One look a project an hour, for all three kinds at once, so the same
 * reads serve them and an operation is one finding of the kind that fits
 * it best:
 *
 *   1. every service's span counts and p99 over the hour, from the span
 *      table's two per-minute aggregates (getServiceSpanHealth,
 *      getServiceLatencyProfile) - served by projections, cheap whatever
 *      the project sends;
 *   2. for the few services that pass the gates - the three with the most
 *      failures, the three slowest, three whose spans are all roots - their
 *      operations over the hour (one table read of one service), then, for
 *      at most two operations each, their most recent failed spans or their
 *      slowest request's trace (500 spans at most, by its own projection).
 *
 * Deterministic: no LLM anywhere here. Read as root with the project scoped
 * explicitly, as every detector: the services whose telemetry holds a
 * company AI tool's private chats are left out (LlmConversationPrivacy),
 * since an insight is read by people who may not read those.
 *
 * The scanner runs one detector per insight type (InsightDetectors); the
 * three below share the look through the scan context they are handed, so
 * it runs once a tick, not three times.
 */

// What a failed span's attributes say it answered with, newest names first.
const STATUS_CODE_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "http.response.status_code",
  "http.status_code",
  "rpc.grpc.status_code",
];

const FILE_PATH_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "code.filepath",
  "code.file.path",
];

const FUNCTION_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "code.function",
  "code.function.name",
];

const LINE_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "code.lineno",
  "code.line.number",
];

/*
 * Text read off a span is cut before it is sanitized or stored: an error
 * message or a stack trace is whatever the failing code wrote, and may be
 * long.
 */
const MAX_ERROR_TEXT_LENGTH: number = 2000;
const MAX_STACK_LINE_LENGTH: number = 500;

// The services the stage-one reads list, busiest first.
const MAX_SERVICES_READ: number = 200;

function firstAttribute(
  attributes: Record<string, unknown> | undefined,
  keys: ReadonlyArray<string>,
): string | undefined {
  for (const key of keys) {
    const value: unknown = attributes?.[key];

    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return undefined;
}

function cut(text: string, length: number): string {
  return text.length > length ? text.substring(0, length) : text;
}

export default class TraceProblemDetector {
  // One look per scan context: the three detectors share it.
  private static looks: WeakMap<
    InsightScanContext,
    Promise<Array<InsightCandidate>>
  > = new WeakMap<InsightScanContext, Promise<Array<InsightCandidate>>>();

  /*
   * The look's findings for this scan: run on the first detector's call,
   * handed to the others. Never rejects: a look that failed finds nothing,
   * and says why in the log.
   */
  public static look(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    let look: Promise<Array<InsightCandidate>> | undefined =
      TraceProblemDetector.looks.get(context);

    if (!look) {
      look = TraceProblemDetector.lookNow(context).catch(
        (error: unknown): Array<InsightCandidate> => {
          logger.error(
            `TraceProblemDetector: the look at project ${context.projectId.toString()}'s traces failed: ${error}`,
          );
          return [];
        },
      );
      TraceProblemDetector.looks.set(context, look);
    }

    return look;
  }

  /*
   * Every service's reading from the two aggregates, joined on the service.
   * A latency profile that may be partial is not used (a p99 over part of
   * the hour is wrong, not smaller): no service is slow this look. Pure.
   */
  public static toServiceReadings(data: {
    health: Array<ServiceSpanHealthRow>;
    latency: Array<ServiceLatencyProfileRow> | null;
  }): Array<TraceServiceReading> {
    const p99ByService: Map<string, number> = new Map<string, number>();

    for (const row of data.latency || []) {
      if (row.primaryEntityId) {
        p99ByService.set(
          row.primaryEntityId.trim().toLowerCase(),
          row.p99DurationMs,
        );
      }
    }

    return data.health.map(
      (row: ServiceSpanHealthRow): TraceServiceReading => {
        const serviceId: string = row.primaryEntityId.trim().toLowerCase();

        return {
          serviceId,
          spanCount: row.spanCount,
          failedSpanCount: row.failedSpanCount,
          rootSpanCount: row.rootSpanCount,
          p99Ms: p99ByService.get(serviceId) || 0,
        };
      },
    );
  }

  // A row of a service's operations table, as the gates read it. Pure.
  public static toOperationReading(
    row: TraceAnalyticsTableRow,
  ): TraceOperationReading {
    return {
      name: row.groupValues["name"] || "",
      spanCount: row.count,
      failedSpanCount: row.errorCount,
      p50Ms: row.p50DurationMs,
      p99Ms: row.p99DurationMs,
    };
  }

  // One failed span, as the failing reading reads it: sanitized, cut. Pure.
  public static toFailedSpanSample(span: Span): FailedSpanSample {
    const events: Array<SpanEvent> = Array.isArray(span.events)
      ? (span.events as Array<SpanEvent>)
      : [];
    const attributes: Record<string, unknown> =
      (span.attributes as Record<string, unknown> | undefined) || {};

    const exception: SpanEvent | undefined = events.find(
      (event: SpanEvent): boolean => {
        return event?.name === SpanEventType.Exception;
      },
    );
    const hasFaultEvent: boolean = events.some((event: SpanEvent): boolean => {
      return event?.name === SpanEventType.Fault;
    });

    const exceptionAttributes: Record<string, unknown> =
      (exception?.attributes as Record<string, unknown> | undefined) || {};

    const sample: FailedSpanSample = {
      traceId: span.traceId?.toString() || "",
      spanId: span.spanId?.toString() || "",
      hasException: Boolean(exception) || span.hasException === true,
      hasFaultEvent,
    };

    const statusMessage: string = (span.statusMessage || "").trim();

    if (statusMessage) {
      sample.statusMessage = sanitizeExceptionMessage(
        cut(statusMessage, MAX_ERROR_TEXT_LENGTH),
      );
    }

    const exceptionType: string | undefined = firstAttribute(
      exceptionAttributes,
      ["exception.type"],
    );

    if (exceptionType) {
      sample.exceptionType = cut(exceptionType, MAX_ERROR_TEXT_LENGTH);
    }

    const exceptionMessage: string | undefined = firstAttribute(
      exceptionAttributes,
      ["exception.message"],
    );

    if (exceptionMessage) {
      sample.exceptionMessage = sanitizeExceptionMessage(
        cut(exceptionMessage, MAX_ERROR_TEXT_LENGTH),
      );
    }

    const stackTrace: string | undefined = firstAttribute(
      exceptionAttributes,
      ["exception.stacktrace"],
    );

    if (stackTrace) {
      // Cut before anything reads it: a stack trace can be very long.
      sample.stackTrace = sanitizeStackTrace(
        cut(stackTrace, MAX_STACK_LINE_LENGTH * TRACE_INSIGHT_STACK_TRACE_LINES)
          .split("\n")
          .slice(0, TRACE_INSIGHT_STACK_TRACE_LINES)
          .map((line: string): string => {
            return cut(line, MAX_STACK_LINE_LENGTH);
          })
          .join("\n"),
      );
    }

    const statusCode: string | undefined = firstAttribute(
      attributes,
      STATUS_CODE_ATTRIBUTE_KEYS,
    );

    if (statusCode) {
      sample.statusCode = cut(statusCode, 32);
    }

    const filePath: string | undefined = firstAttribute(
      attributes,
      FILE_PATH_ATTRIBUTE_KEYS,
    );

    if (filePath) {
      const line: number = parseInt(
        firstAttribute(attributes, LINE_ATTRIBUTE_KEYS) || "",
        10,
      );
      const functionName: string | undefined = firstAttribute(
        attributes,
        FUNCTION_ATTRIBUTE_KEYS,
      );

      sample.codeLocation = {
        filePath: cut(filePath, 500),
        ...(functionName ? { functionName: cut(functionName, 500) } : {}),
        ...(Number.isFinite(line) ? { lineNumber: line } : {}),
      };
    }

    return sample;
  }

  // A trace's spans, as the slow-request reading reads them. Pure.
  public static toTraceInsightSpans(
    spans: Array<Span>,
  ): Array<TraceInsightSpan> {
    const analyzable: Array<TraceInsightSpan> =
      FixPerformanceTaskTrigger.toAnalyzableSpans(spans);

    return analyzable.map(
      (span: TraceInsightSpan, index: number): TraceInsightSpan => {
        const source: Span | undefined = spans[index];

        return {
          ...span,
          kind: source?.kind?.toString() || undefined,
          serviceId:
            source?.primaryEntityId?.toString().toLowerCase() || undefined,
        };
      },
    );
  }

  // The insight a finding becomes. Pure.
  public static buildCandidate(data: {
    serviceId: string;
    serviceName: string;
    evidence: TraceInsightEvidence;
  }): InsightCandidate {
    const kind: TraceInsightKind = data.evidence.kind as TraceInsightKind;

    return {
      insightType: TRACE_INSIGHT_TYPE_BY_KIND[kind],
      fingerprint: getTraceInsightFingerprint({
        kind,
        serviceId: data.serviceId,
        operationName: data.evidence.operationName,
        gap: data.evidence.gap as TraceTracingGap | undefined,
      }),
      title: getTraceInsightTitle({
        evidence: data.evidence,
        serviceName: data.serviceName,
      }),
      detailMarkdown: TraceProblemDetector.buildDetail({
        serviceName: data.serviceName,
        evidence: data.evidence,
      }).toString(),
      severity: getTraceInsightSeverity(data.evidence),
      serviceName: data.serviceName,
      telemetryServiceId: new ObjectID(data.serviceId),
      traceId: data.evidence.sampleTraceId,
      evidence: { trace: data.evidence },
    };
  }

  /*
   * The evidence as a person reads it on the insight: real numbers only.
   * Every name is written into Markdown escaped (mdText): an operation's
   * name, a query or an error message is the service's, not ours.
   */
  public static buildDetail(data: {
    serviceName: string;
    evidence: TraceInsightEvidence;
  }): MarkdownText {
    const evidence: TraceInsightEvidence = data.evidence;
    const lines: Array<MarkdownText> = [];

    switch (evidence.kind) {
      case TraceInsightKind.Slow:
        lines.push(mdText`**Slow operation in ${data.serviceName}**`);
        break;
      case TraceInsightKind.Failing:
        lines.push(mdText`**Failing operation in ${data.serviceName}**`);
        break;
      default:
        lines.push(mdText`**Missing tracing in ${data.serviceName}**`);
    }

    lines.push(FeedMarkdown.empty());

    if (evidence.operationName) {
      lines.push(mdText`- Operation: \`${evidence.operationName}\``);
    }

    const latency: string =
      evidence.p99Ms !== undefined
        ? `, p50 ${formatTraceDuration(evidence.p50Ms || 0)}, p99 ${formatTraceDuration(evidence.p99Ms)}`
        : "";

    lines.push(
      mdText`- Over the hour: ${evidence.spanCount.toLocaleString("en-US")} spans${latency}`,
    );

    if (evidence.failedSpanCount !== undefined) {
      lines.push(
        mdText`- Failed: ${evidence.failedSpanCount.toLocaleString("en-US")} (${formatTracePercent(
          getFailedPercent({
            spanCount: evidence.spanCount,
            failedSpanCount: evidence.failedSpanCount,
          }),
        )})`,
      );
    }

    if (evidence.sampleTraceId) {
      lines.push(
        evidence.sampleDurationMs
          ? mdText`- Request read: trace \`${evidence.sampleTraceId}\`, ${formatTraceDuration(evidence.sampleDurationMs)}`
          : mdText`- Request read: trace \`${evidence.sampleTraceId}\``,
      );
    }

    if (evidence.performanceFindings && evidence.performanceFindings.length) {
      lines.push(FeedMarkdown.empty(), mdText`**What the request repeats**`);

      for (const finding of evidence.performanceFindings) {
        lines.push(mdText`- ${describeSlowFindingCost(finding)}`);

        if (finding.normalizedDbStatement) {
          lines.push(mdText`  - Query: \`${finding.normalizedDbStatement}\``);
        }
      }
    }

    if (evidence.gap === TraceTracingGap.UntracedTime) {
      lines.push(
        mdText`- Untraced: ${formatTraceDuration(evidence.untracedMs || 0)} in \`${evidence.untracedSpanName || ""}\` itself, with no span under it`,
      );
    }

    if (evidence.gap === TraceTracingGap.SilentFailures) {
      lines.push(
        mdText`- The most recent failures recorded no error message and no exception`,
      );
    }

    if (evidence.gap === TraceTracingGap.NoChildSpans) {
      lines.push(
        mdText`- Every span was its trace's only span: nothing is recorded inside a request`,
      );

      if (evidence.topOperations && evidence.topOperations.length > 0) {
        lines.push(
          mdText`- Busiest operations: ${FeedMarkdown.join(
            evidence.topOperations.map(
              (operation: { name: string; spanCount: number }): MarkdownText => {
                return mdText`\`${operation.name}\` (${operation.spanCount.toLocaleString("en-US")})`;
              },
            ),
            ", ",
          )}`,
        );
      }
    }

    if (evidence.error) {
      lines.push(mdText`- Failed with: ${describeTraceError(evidence.error)}`);
      lines.push(
        mdText`- In ${evidence.error.sampleMatches} of the ${evidence.error.sampleSize} most recent failures`,
      );
    }

    for (const location of evidence.codeLocations || []) {
      lines.push(
        mdText`- Code: \`${location.filePath}${location.lineNumber ? `:${location.lineNumber}` : ""}\``,
      );
    }

    return FeedMarkdown.join(lines, "\n");
  }

  @CaptureSpan()
  private static async lookNow(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    const window: TraceInsightWindow = getTraceInsightWindow(context.now);

    const excludedServiceIds: Set<string> = new Set<string>(
      (
        await LlmConversationPrivacy.getRestrictedServiceIds(context.projectId)
      ).map((id: string): string => {
        return id.trim().toLowerCase();
      }),
    );

    const [health, latency]: [
      Array<ServiceSpanHealthRow>,
      ServiceLatencyProfile,
    ] = await Promise.all([
      TraceAggregationService.getServiceSpanHealth({
        projectId: context.projectId,
        startTime: window.startTime,
        endTime: window.endTime,
        limit: MAX_SERVICES_READ,
      }),
      TraceAggregationService.getServiceLatencyProfile({
        projectId: context.projectId,
        startTime: window.startTime,
        endTime: window.endTime,
        limit: MAX_SERVICES_READ,
      }),
    ]);

    if (latency.isPartial) {
      logger.info(
        `TraceProblemDetector: project ${context.projectId.toString()}'s latency profile may be partial this look - no service is read as slow.`,
      );
    }

    const readings: Array<TraceServiceReading> =
      TraceProblemDetector.toServiceReadings({
        health,
        latency: latency.isPartial ? null : latency.rows,
      });

    const failing: Array<string> = pickFailingServices(
      readings,
      excludedServiceIds,
    );
    const noChildSpans: Array<string> = pickNoChildSpanServices(
      readings,
      excludedServiceIds,
    );
    // A service that records nothing inside its requests: that says it all.
    const slow: Array<string> = pickSlowServices(
      readings,
      excludedServiceIds,
    ).filter((id: string): boolean => {
      return !noChildSpans.includes(id);
    });

    const serviceIds: Array<string> = Array.from(
      new Set<string>([...failing, ...slow, ...noChildSpans]),
    );

    if (serviceIds.length === 0) {
      return [];
    }

    // Only ids that are the project's services: a host's id is none.
    const services: Array<Service> = await ServiceService.findBy({
      query: {
        projectId: context.projectId,
        _id: QueryHelper.any(serviceIds),
      },
      select: { _id: true, name: true },
      limit: serviceIds.length,
      skip: 0,
      props: { isRoot: true },
    });

    const readingsById: Map<string, TraceServiceReading> = new Map<
      string,
      TraceServiceReading
    >();

    for (const reading of readings) {
      readingsById.set(reading.serviceId, reading);
    }

    const candidates: Array<InsightCandidate> = [];

    for (const serviceId of serviceIds) {
      const service: Service | undefined = services.find(
        (row: Service): boolean => {
          return row.id?.toString().toLowerCase() === serviceId;
        },
      );

      if (!service) {
        continue;
      }

      try {
        candidates.push(
          ...(await TraceProblemDetector.lookAtService({
            projectId: context.projectId,
            serviceId,
            serviceName: service.name || "this service",
            window,
            reading: readingsById.get(serviceId),
            isFailing: failing.includes(serviceId),
            isSlow: slow.includes(serviceId),
            hasNoChildSpans: noChildSpans.includes(serviceId),
          })),
        );
      } catch (error) {
        logger.error(
          `TraceProblemDetector: service ${serviceId} of project ${context.projectId.toString()} could not be read - continuing with the others: ${error}`,
        );
      }
    }

    return candidates;
  }

  /*
   * One service's findings: its failing operations first, then its slow
   * ones, then - when its spans are all roots - that. At most two, and one
   * per operation.
   */
  private static async lookAtService(data: {
    projectId: ObjectID;
    serviceId: string;
    serviceName: string;
    window: TraceInsightWindow;
    reading: TraceServiceReading | undefined;
    isFailing: boolean;
    isSlow: boolean;
    hasNoChildSpans: boolean;
  }): Promise<Array<InsightCandidate>> {
    const found: Array<InsightCandidate> = [];
    const operationsFound: Set<string> = new Set<string>();

    const keep: (evidence: TraceInsightEvidence) => void = (
      evidence: TraceInsightEvidence,
    ): void => {
      if (found.length >= TRACE_INSIGHT_MAX_FINDINGS_PER_SERVICE) {
        return;
      }

      const operation: string = SpanTreeAnalyzer.normalizeSpanName(
        evidence.operationName || "",
      );

      if (evidence.operationName && operationsFound.has(operation)) {
        return;
      }

      operationsFound.add(operation);
      found.push(
        TraceProblemDetector.buildCandidate({
          serviceId: data.serviceId,
          serviceName: data.serviceName,
          evidence,
        }),
      );
    };

    if (data.isFailing) {
      for (const evidence of await TraceProblemDetector.readFailingOperations(
        data,
      )) {
        keep(evidence);
      }
    }

    if (data.isSlow && found.length < TRACE_INSIGHT_MAX_FINDINGS_PER_SERVICE) {
      for (const evidence of await TraceProblemDetector.readSlowOperations({
        ...data,
        skip: operationsFound,
      })) {
        keep(evidence);
      }
    }

    if (
      data.hasNoChildSpans &&
      data.reading &&
      found.length < TRACE_INSIGHT_MAX_FINDINGS_PER_SERVICE
    ) {
      keep(
        await TraceProblemDetector.readNoChildSpans({
          ...data,
          reading: data.reading,
        }),
      );
    }

    return found;
  }

  // A service's operations over the hour, ordered by one column.
  private static async readOperations(data: {
    projectId: ObjectID;
    serviceId: string;
    window: TraceInsightWindow;
    sortBy: "p99" | "errorCount" | "count";
    limit: number;
  }): Promise<Array<TraceOperationReading>> {
    const rows: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable({
        projectId: data.projectId,
        startTime: data.window.startTime,
        endTime: data.window.endTime,
        bucketSizeInMinutes: 60,
        chartType: "table",
        metric: "count",
        groupBy: ["name"],
        serviceIds: [new ObjectID(data.serviceId)],
        limit: data.limit,
        tableSort: { column: data.sortBy, direction: "desc" },
      });

    return rows.map(TraceProblemDetector.toOperationReading);
  }

  private static async readFailingOperations(data: {
    projectId: ObjectID;
    serviceId: string;
    window: TraceInsightWindow;
  }): Promise<Array<TraceInsightEvidence>> {
    const operations: Array<TraceOperationReading> = pickFailingOperations(
      await TraceProblemDetector.readOperations({
        ...data,
        sortBy: "errorCount",
        limit: TRACE_INSIGHT_OPERATION_ROWS,
      }),
    );

    const evidence: Array<TraceInsightEvidence> = [];

    for (const operation of operations) {
      const failedSpans: Array<Span> = await SpanService.findBy({
        query: {
          projectId: data.projectId,
          primaryEntityId: new ObjectID(data.serviceId),
          name: operation.name,
          statusCode: SpanStatus.Error,
          startTime: new InBetween(data.window.startTime, data.window.endTime),
        } as never,
        select: {
          traceId: true,
          spanId: true,
          statusMessage: true,
          hasException: true,
          events: true,
          attributes: true,
          durationUnixNano: true,
        } as never,
        sort: { startTime: SortOrder.Descending } as never,
        limit: TRACE_INSIGHT_FAILED_SAMPLE_SIZE,
        skip: 0,
        props: { isRoot: true },
      });

      const samples: Array<FailedSpanSample> = failedSpans.map(
        TraceProblemDetector.toFailedSpanSample,
      );
      const reading: FailedSpansReading = readFailedSpans(samples);

      if (reading.verdict === TraceFailureVerdict.Expected) {
        continue;
      }

      const sampleSpan: Span | undefined = failedSpans.find(
        (span: Span): boolean => {
          return span.spanId?.toString() === reading.sample?.spanId;
        },
      );

      const base: TraceInsightEvidence = {
        serviceId: data.serviceId,
        kind:
          reading.verdict === TraceFailureVerdict.Silent
            ? TraceInsightKind.MissingTracing
            : TraceInsightKind.Failing,
        operationName: operation.name,
        windowStartTime: data.window.startTime.toISOString(),
        windowEndTime: data.window.endTime.toISOString(),
        spanCount: operation.spanCount,
        failedSpanCount: operation.failedSpanCount,
        p50Ms: operation.p50Ms,
        p99Ms: operation.p99Ms,
      };

      if (reading.verdict === TraceFailureVerdict.Silent) {
        base.gap = TraceTracingGap.SilentFailures;
      }

      if (reading.sample?.traceId) {
        base.sampleTraceId = reading.sample.traceId;
        base.sampleSpanId = reading.sample.spanId;
      }

      if (sampleSpan?.durationUnixNano) {
        base.sampleDurationMs =
          Number(sampleSpan.durationUnixNano) / 1_000_000;
      }

      if (reading.error) {
        base.error = reading.error as TraceInsightErrorEvidence;
      }

      const location: PerformanceCodeLocation | undefined =
        reading.sample?.codeLocation;

      if (location) {
        base.codeLocations = [location];
      }

      evidence.push(base);
    }

    return evidence;
  }

  private static async readSlowOperations(data: {
    projectId: ObjectID;
    serviceId: string;
    window: TraceInsightWindow;
    // Operations already found failing: one finding each.
    skip: Set<string>;
  }): Promise<Array<TraceInsightEvidence>> {
    const operations: Array<TraceOperationReading> = pickSlowOperations(
      await TraceProblemDetector.readOperations({
        ...data,
        sortBy: "p99",
        limit: TRACE_INSIGHT_OPERATION_ROWS,
      }),
    ).filter((operation: TraceOperationReading): boolean => {
      return !data.skip.has(SpanTreeAnalyzer.normalizeSpanName(operation.name));
    });

    const evidence: Array<TraceInsightEvidence> = [];

    for (const operation of operations) {
      // Its slowest span in the hour: the request worth reading.
      const slowest: Array<Span> = await SpanService.findBy({
        query: {
          projectId: data.projectId,
          primaryEntityId: new ObjectID(data.serviceId),
          name: operation.name,
          startTime: new InBetween(data.window.startTime, data.window.endTime),
        } as never,
        select: {
          traceId: true,
          spanId: true,
          durationUnixNano: true,
        } as never,
        sort: { durationUnixNano: SortOrder.Descending } as never,
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });

      const traceId: string = slowest[0]?.traceId?.toString() || "";
      const spanId: string = slowest[0]?.spanId?.toString() || "";

      if (!traceId || !spanId) {
        continue;
      }

      const traceSpans: Array<Span> = await SpanService.findBy({
        query: {
          projectId: data.projectId,
          traceId: traceId,
        } as never,
        select: {
          spanId: true,
          parentSpanId: true,
          name: true,
          kind: true,
          primaryEntityId: true,
          startTimeUnixNano: true,
          endTimeUnixNano: true,
          durationUnixNano: true,
          attributes: true,
        } as never,
        sort: { startTimeUnixNano: SortOrder.Ascending } as never,
        limit: MAX_ANALYZED_TRACE_SPANS,
        skip: 0,
        props: { isRoot: true },
      });

      const request: Array<TraceInsightSpan> = getOperationRequestSpans({
        spans: TraceProblemDetector.toTraceInsightSpans(traceSpans),
        operationSpanId: spanId,
        serviceId: data.serviceId,
      });

      if (request.length === 0) {
        continue;
      }

      const reading: SlowRequestReading = readSlowRequest(request);

      if (reading.fixable.length === 0 && !reading.untraced) {
        continue;
      }

      const base: TraceInsightEvidence = {
        serviceId: data.serviceId,
        kind:
          reading.fixable.length > 0
            ? TraceInsightKind.Slow
            : TraceInsightKind.MissingTracing,
        operationName: operation.name,
        windowStartTime: data.window.startTime.toISOString(),
        windowEndTime: data.window.endTime.toISOString(),
        spanCount: operation.spanCount,
        p50Ms: operation.p50Ms,
        p99Ms: operation.p99Ms,
        sampleTraceId: traceId,
        sampleSpanId: spanId,
        sampleDurationMs: reading.requestMs,
      };

      if (reading.fixable.length > 0) {
        base.performanceFindings = reading.fixable;

        const locations: Array<PerformanceCodeLocation> =
          FixPerformanceTaskTrigger.collectCodeLocations(
            request,
            reading.fixable as Array<PerformanceFinding>,
          );

        if (locations.length > 0) {
          base.codeLocations = locations;
        }
      } else if (reading.untraced) {
        base.gap = TraceTracingGap.UntracedTime;
        base.untracedSpanName = reading.untraced.spanName;
        base.untracedMs = reading.untraced.untracedMs;
        base.sampleDurationMs = reading.untraced.requestMs;
      }

      evidence.push(base);
    }

    return evidence;
  }

  private static async readNoChildSpans(data: {
    projectId: ObjectID;
    serviceId: string;
    window: TraceInsightWindow;
    reading: TraceServiceReading;
  }): Promise<TraceInsightEvidence> {
    const busiest: Array<TraceOperationReading> =
      await TraceProblemDetector.readOperations({
        ...data,
        sortBy: "count",
        limit: TRACE_INSIGHT_TOP_OPERATIONS,
      });

    const evidence: TraceInsightEvidence = {
      serviceId: data.serviceId,
      kind: TraceInsightKind.MissingTracing,
      gap: TraceTracingGap.NoChildSpans,
      windowStartTime: data.window.startTime.toISOString(),
      windowEndTime: data.window.endTime.toISOString(),
      spanCount: data.reading.spanCount,
    };

    if (data.reading.p99Ms > 0) {
      evidence.p99Ms = data.reading.p99Ms;
    }

    const topOperations: Array<{ name: string; spanCount: number }> = busiest
      .filter((operation: TraceOperationReading): boolean => {
        return Boolean(operation.name);
      })
      .slice(0, TRACE_INSIGHT_TOP_OPERATIONS)
      .map((operation: TraceOperationReading) => {
        return { name: operation.name, spanCount: operation.spanCount };
      });

    if (topOperations.length > 0) {
      evidence.topOperations = topOperations;
    }

    return evidence;
  }
}

/*
 * The scanner's detectors for the Traces lane, one per insight type: each
 * hands back its own kind of the shared look's findings.
 */
abstract class TraceProblemKindDetector implements InsightDetector {
  public abstract insightType: AIInsightType;

  public async detect(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    return (await TraceProblemDetector.look(context)).filter(
      (candidate: InsightCandidate): boolean => {
        return candidate.insightType === this.insightType;
      },
    );
  }
}

export class TraceSlowOperationDetector extends TraceProblemKindDetector {
  public insightType: AIInsightType = AIInsightType.TraceSlowOperation;
}

export class TraceFailingOperationDetector extends TraceProblemKindDetector {
  public insightType: AIInsightType = AIInsightType.TraceFailingOperation;
}

export class TraceMissingTracingDetector extends TraceProblemKindDetector {
  public insightType: AIInsightType = AIInsightType.TraceMissingTracing;
}
