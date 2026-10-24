import ObjectID from "../../../../../../Types/ObjectID";
import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import InBetween from "../../../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../../../Types/BaseDatabase/SortOrder";
import { LogInsightEvidence } from "../../../../../../Types/AI/AIInsightEvidence";
import { PerformanceCodeLocation } from "../../../../../../Types/AI/CodeFixTaskContext";
import Span, { SpanStatus } from "../../../../../../Models/AnalyticsModels/Span";
import Service from "../../../../../../Models/DatabaseModels/Service";
import LogAggregationService, {
  ErrorPatternCodeLocation,
  ServiceLogHealthRow,
  ServiceLogPattern,
  ServiceLogPatterns,
  TopErrorPattern,
} from "../../../../../Services/LogAggregationService";
import SpanService from "../../../../../Services/SpanService";
import ServiceService from "../../../../../Services/ServiceService";
import TraceAggregationService, {
  ServiceSpanHealthRow,
  TraceAnalyticsTableRow,
} from "../../../../../Services/TraceAggregationService";
import QueryHelper from "../../../../../Types/Database/QueryHelper";
import LlmConversationPrivacy from "../../../../LlmObservability/LlmConversationPrivacy";
import logger from "../../../../Logger";
import CaptureSpan from "../../../../Telemetry/CaptureSpan";
import { sanitizeExceptionMessage } from "../../../../Telemetry/ExceptionSanitizer";
import LogExceptionExtractor from "../../../../Telemetry/LogExceptionExtractor";
import { MarkdownText } from "../../../../../../Utils/Markdown/FeedMarkdown";
import {
  FailedRequestLogsReading,
  LOG_INSIGHT_ERROR_PATTERN_ROWS,
  LOG_INSIGHT_FAILED_SAMPLE_SIZE,
  LOG_INSIGHT_INGEST_GRACE_MINUTES,
  LOG_INSIGHT_MAX_SERVICES_READ,
  LOG_INSIGHT_NOISY_PATTERN_ROWS,
  LOG_INSIGHT_NOISY_SAMPLE_SIZE,
  LOG_INSIGHT_SAMPLE_TRACE_IDS,
  LOG_INSIGHT_SILENT_OPERATIONS_PER_SERVICE,
  LOG_INSIGHT_TYPE_BY_KIND,
  LogInsightKind,
  LogInsightWindow,
  LogLoggingGap,
  LogNoisyPatternFinding,
  LogPatternReading,
  LogServiceReading,
  LogSilenceVerdict,
  buildLogInsightDetail,
  getLogInsightFingerprint,
  getLogInsightSeverity,
  getLogInsightTitle,
  getLogInsightWindow,
  maskLogPatternTokens,
  pickErrorLogServices,
  pickErrorPatterns,
  pickNoTraceContextServices,
  pickNoisyLogServices,
  pickNoisyPattern,
  pickSilentFailureServices,
  readFailedRequestLogs,
  toSilentFailureError,
} from "../../../../../../Utils/Logs/LogInsight";
import {
  FailedSpanSample,
  FailedSpansReading,
  TRACE_INSIGHT_OPERATION_ROWS,
  TraceFailureVerdict,
  TraceOperationReading,
  pickFailingOperations,
  readFailedSpans,
} from "../../../../../../Utils/Traces/TraceInsight";
import TraceProblemDetector from "./TraceProblemDetector";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../Types";

/*
 * The Logs product's AI section's detector (Types/AI/TelemetryAi): the
 * errors a service logs again and again, the logging it lacks, and the lines
 * that flood its logs (Utils/Logs/LogInsight holds every gate). It feeds the
 * lane's AI rules: OneUptime AI looks into each finding and opens a pull
 * request that fixes the code behind the error, logs what is not logged, or
 * logs the noisy line less.
 *
 * One look a project an hour, for all three kinds at once:
 *
 *   1. every service's logs over the hour - all of them, the errors and the
 *      ones with a trace id (one read of three columns) - and its spans and
 *      failed spans from its traces (served by a projection), joined by the
 *      service;
 *   2. for the few services that pass the gates, at most: the messages of
 *      the three with the most errors (and where their lines were logged),
 *      the failing operations of the three whose failures may go unlogged
 *      (their most recent failed requests, then the service's lines in
 *      those requests), and a sample of up to 100,000 lines of the three
 *      busiest.
 *
 * Deterministic: no LLM anywhere here. Read as root with the project scoped
 * explicitly, as every detector: the services whose telemetry holds a
 * company AI tool's private chats are left out (LlmConversationPrivacy),
 * since an insight is read by people who may not read those.
 *
 * A log line holds whatever the code put in it, so no line leaves here as it
 * was logged: a message is kept as its pattern (values masked by the
 * grouping), sanitized as an exception message is before it reaches a model
 * or a pull request (ExceptionSanitizer), with what is left of tokens masked
 * (maskLogPatternTokens); its search words only when the sanitizer leaves
 * them as they are; and of a line's attributes only the code.* ones that say
 * where it was logged.
 *
 * The scanner runs one detector per insight type (InsightDetectors); the
 * three below share the look through the scan context they are handed.
 */

// The fewest characters a message's search words need to narrow a search.
const SEARCH_TEXT_MIN_LENGTH: number = 6;

// Any masked value of a pattern: the grouping's, the sanitizer's, a token's.
const MASKED_VALUE: RegExp = /<[A-Za-z_]{1,32}>/g;

// Punctuation a masked value leaves at the edges of the words around it.
const EDGE_GLUE: ReadonlySet<string> = new Set<string>(
  " \t\r\n\"':,;=()[]{}".split(""),
);
const WHITESPACE_RUN: RegExp = /\s+/;

// A run of words without the glue at its two ends, read once from each end.
function trimGlue(text: string): string {
  let start: number = 0;
  let end: number = text.length;

  while (start < end && EDGE_GLUE.has(text.charAt(start))) {
    start++;
  }

  while (end > start && EDGE_GLUE.has(text.charAt(end - 1))) {
    end--;
  }

  return text.slice(start, end);
}

// The most characters of a code location kept, as the traces lane does.
const MAX_CODE_TEXT_LENGTH: number = 500;

function cut(text: string, length: number): string {
  return text.length > length ? text.substring(0, length) : text;
}

export default class LogProblemDetector {
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
      LogProblemDetector.looks.get(context);

    if (!look) {
      look = LogProblemDetector.lookNow(context).catch(
        (error: unknown): Array<InsightCandidate> => {
          logger.error(
            `LogProblemDetector: the look at project ${context.projectId.toString()}'s logs failed: ${error}`,
          );
          return [];
        },
      );
      LogProblemDetector.looks.set(context, look);
    }

    return look;
  }

  /*
   * Every service's reading: its logs, joined on the service with its spans
   * (none when it sends none, or the trace read failed). Pure.
   */
  public static toServiceReadings(data: {
    logHealth: Array<ServiceLogHealthRow>;
    spanHealth: Array<ServiceSpanHealthRow>;
  }): Array<LogServiceReading> {
    const spansByService: Map<string, ServiceSpanHealthRow> = new Map<
      string,
      ServiceSpanHealthRow
    >();

    for (const row of data.spanHealth) {
      const id: string = (row.primaryEntityId || "").trim().toLowerCase();

      if (id) {
        spansByService.set(id, row);
      }
    }

    return data.logHealth
      .map((row: ServiceLogHealthRow): LogServiceReading => {
        const serviceId: string = (row.primaryEntityId || "")
          .trim()
          .toLowerCase();
        const spans: ServiceSpanHealthRow | undefined =
          spansByService.get(serviceId);

        return {
          serviceId,
          logCount: row.logCount,
          errorLogCount: row.errorLogCount,
          tracedLogCount: row.tracedLogCount,
          spanCount: spans?.spanCount || 0,
          failedSpanCount: spans?.failedSpanCount || 0,
        };
      })
      .filter((reading: LogServiceReading): boolean => {
        return reading.serviceId.length > 0;
      });
  }

  /*
   * A message as the evidence may keep it: its pattern sanitized - as an
   * exception message is before it reaches a model or a pull request - with
   * what is left of tokens masked. Pure.
   */
  public static sanitizePattern(pattern: string): string {
    return maskLogPatternTokens(sanitizeExceptionMessage(pattern || "")).trim();
  }

  /*
   * The words a message's lines can be searched by: the longest run of its
   * own words - taken from the SANITIZED pattern, so no value the sanitizer
   * masks is ever searched for in the open - that its newest line holds as
   * written (a run across a collapsed line break would match nothing), else
   * the longest single word it holds. "" when none is long enough to narrow
   * a search. Pure.
   */
  public static getSearchText(data: {
    pattern: string;
    sampleBody: string;
  }): string {
    const sanitized: string = LogProblemDetector.sanitizePattern(data.pattern);
    const candidates: Array<string> = [];

    for (const segment of sanitized.split(MASKED_VALUE)) {
      const run: string = trimGlue(segment);

      if (run) {
        candidates.push(run);
      }

      for (const word of segment.split(WHITESPACE_RUN)) {
        const trimmed: string = trimGlue(word);

        if (trimmed) {
          candidates.push(trimmed);
        }
      }
    }

    candidates.sort((a: string, b: string): number => {
      return b.length - a.length;
    });

    return (
      candidates.find((candidate: string): boolean => {
        return (
          candidate.length >= SEARCH_TEXT_MIN_LENGTH &&
          data.sampleBody.includes(candidate)
        );
      }) || ""
    );
  }

  // A row of a service's error messages, as the gates read it. Pure.
  public static toErrorPatternReading(row: TopErrorPattern): LogPatternReading {
    return {
      pattern: LogProblemDetector.sanitizePattern(row.pattern),
      count: row.count,
      severities: [...row.severities],
      searchText: LogProblemDetector.getSearchText({
        pattern: row.pattern,
        sampleBody: row.sampleBody,
      }),
      traceCount: row.traceCount,
      sampleTraceIds: row.sampleTraceIds.slice(0, LOG_INSIGHT_SAMPLE_TRACE_IDS),
      hasException: LogExceptionExtractor.bodyHoldsStackTrace(row.sampleBody),
    };
  }

  // A row of a service's sampled messages, as the noisy gate reads it. Pure.
  public static toServicePatternReading(
    row: ServiceLogPattern,
  ): LogPatternReading {
    return {
      pattern: LogProblemDetector.sanitizePattern(row.pattern),
      count: row.count,
      severities: [...row.severities],
      searchText: LogProblemDetector.getSearchText({
        pattern: row.pattern,
        sampleBody: row.sampleBody,
      }),
      traceCount: 0,
      sampleTraceIds: [],
      hasException: false,
    };
  }

  // Where a message's lines were logged, as the evidence keeps it. Pure.
  public static toCodeLocations(
    rows: Array<ErrorPatternCodeLocation>,
  ): Array<PerformanceCodeLocation> {
    const locations: Array<PerformanceCodeLocation> = [];
    const seen: Set<string> = new Set<string>();

    for (const row of rows) {
      const filePath: string = cut(
        (row.filePath || "").trim(),
        MAX_CODE_TEXT_LENGTH,
      );

      if (!filePath) {
        continue;
      }

      const lineNumber: number = parseInt((row.lineNumber || "").trim(), 10);
      const functionName: string = cut(
        (row.functionName || "").trim(),
        MAX_CODE_TEXT_LENGTH,
      );
      const key: string = `${filePath}\u0000${functionName}\u0000${lineNumber}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      locations.push({
        filePath,
        ...(functionName ? { functionName } : {}),
        ...(Number.isFinite(lineNumber) && lineNumber > 0
          ? { lineNumber }
          : {}),
      });
    }

    return locations;
  }

  // The insight a finding becomes. Pure.
  public static buildCandidate(data: {
    serviceId: string;
    serviceName: string;
    evidence: LogInsightEvidence;
  }): InsightCandidate {
    const kind: LogInsightKind = data.evidence.kind as LogInsightKind;
    const traceId: string | undefined =
      data.evidence.sampleTraceId || data.evidence.sampleTraceIds?.[0];

    return {
      insightType: LOG_INSIGHT_TYPE_BY_KIND[kind],
      fingerprint: getLogInsightFingerprint({
        kind,
        serviceId: data.serviceId,
        pattern: data.evidence.pattern,
        gap: data.evidence.gap as LogLoggingGap | undefined,
        operationName: data.evidence.operationName,
      }),
      title: getLogInsightTitle({
        evidence: data.evidence,
        serviceName: data.serviceName,
      }),
      detailMarkdown: LogProblemDetector.buildDetail({
        serviceName: data.serviceName,
        evidence: data.evidence,
      }).toString(),
      severity: getLogInsightSeverity(data.evidence),
      serviceName: data.serviceName,
      telemetryServiceId: new ObjectID(data.serviceId),
      ...(traceId ? { traceId } : {}),
      evidence: { log: data.evidence },
    };
  }

  /*
   * The evidence as a person reads it on the insight
   * (Utils/Logs/LogInsight buildLogInsightDetail, pure, so the browser
   * suite draws what the detector writes).
   */
  public static buildDetail(data: {
    serviceName: string;
    evidence: LogInsightEvidence;
  }): MarkdownText {
    return buildLogInsightDetail(data);
  }

  // A traced service's logs with no trace context, from its reading. Pure.
  public static buildNoTraceContextEvidence(data: {
    serviceId: string;
    window: LogInsightWindow;
    reading: LogServiceReading;
  }): LogInsightEvidence {
    return {
      serviceId: data.serviceId,
      kind: LogInsightKind.MissingLogging,
      gap: LogLoggingGap.NoTraceContext,
      windowStartTime: data.window.startTime.toISOString(),
      windowEndTime: data.window.endTime.toISOString(),
      logCount: data.reading.logCount,
      errorLogCount: data.reading.errorLogCount,
      tracedLogCount: data.reading.tracedLogCount,
      serviceSpanCount: data.reading.spanCount,
    };
  }

  @CaptureSpan()
  private static async lookNow(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    const window: LogInsightWindow = getLogInsightWindow(context.now);

    const excludedServiceIds: Set<string> = new Set<string>(
      (
        await LlmConversationPrivacy.getRestrictedServiceIds(context.projectId)
      ).map((id: string): string => {
        return id.trim().toLowerCase();
      }),
    );

    const [logHealth, spanHealth]: [
      Array<ServiceLogHealthRow>,
      Array<ServiceSpanHealthRow>,
    ] = await Promise.all([
      LogAggregationService.getServiceLogHealth({
        projectId: context.projectId,
        startTime: window.startTime,
        endTime: window.endTime,
        limit: LOG_INSIGHT_MAX_SERVICES_READ,
      }),
      /*
       * The traces only add what logs cannot say alone: without them the
       * logs' own findings are still read.
       */
      TraceAggregationService.getServiceSpanHealth({
        projectId: context.projectId,
        startTime: window.startTime,
        endTime: window.endTime,
        limit: LOG_INSIGHT_MAX_SERVICES_READ,
      }).catch((error: unknown): Array<ServiceSpanHealthRow> => {
        logger.error(
          `LogProblemDetector: project ${context.projectId.toString()}'s spans could not be read - only what its logs say alone is looked for: ${error}`,
        );
        return [];
      }),
    ]);

    const readings: Array<LogServiceReading> =
      LogProblemDetector.toServiceReadings({ logHealth, spanHealth });

    const errors: Array<string> = pickErrorLogServices(
      readings,
      excludedServiceIds,
    );
    const silent: Array<string> = pickSilentFailureServices(
      readings,
      excludedServiceIds,
    );
    const noTraceContext: Array<string> = pickNoTraceContextServices(
      readings,
      excludedServiceIds,
    );
    const noisy: Array<string> = pickNoisyLogServices(
      readings,
      excludedServiceIds,
    );

    const serviceIds: Array<string> = Array.from(
      new Set<string>([...errors, ...silent, ...noTraceContext, ...noisy]),
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

    const readingsById: Map<string, LogServiceReading> = new Map<
      string,
      LogServiceReading
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
      const reading: LogServiceReading | undefined =
        readingsById.get(serviceId);

      if (!service || !reading) {
        continue;
      }

      try {
        candidates.push(
          ...(await LogProblemDetector.lookAtService({
            projectId: context.projectId,
            serviceId,
            serviceName: service.name || "this service",
            window,
            reading,
            hasErrors: errors.includes(serviceId),
            mayFailSilently: silent.includes(serviceId),
            lacksTraceContext: noTraceContext.includes(serviceId),
            isBusy: noisy.includes(serviceId),
          })),
        );
      } catch (error) {
        logger.error(
          `LogProblemDetector: service ${serviceId} of project ${context.projectId.toString()} could not be read - continuing with the others: ${error}`,
        );
      }
    }

    return candidates;
  }

  /*
   * One service's findings: its error logs first, then the logging it lacks,
   * then its noisy log - at most two, one and one. Each kind's read failing
   * leaves the others.
   */
  private static async lookAtService(data: {
    projectId: ObjectID;
    serviceId: string;
    serviceName: string;
    window: LogInsightWindow;
    reading: LogServiceReading;
    hasErrors: boolean;
    mayFailSilently: boolean;
    lacksTraceContext: boolean;
    isBusy: boolean;
  }): Promise<Array<InsightCandidate>> {
    const found: Array<LogInsightEvidence> = [];

    const readKind: (
      kind: string,
      read: () => Promise<Array<LogInsightEvidence>>,
    ) => Promise<void> = async (
      kind: string,
      read: () => Promise<Array<LogInsightEvidence>>,
    ): Promise<void> => {
      try {
        found.push(...(await read()));
      } catch (error) {
        logger.error(
          `LogProblemDetector: the ${kind} read of service ${data.serviceId} failed - continuing with its other reads: ${error}`,
        );
      }
    };

    if (data.hasErrors) {
      await readKind("error log", (): Promise<Array<LogInsightEvidence>> => {
        return LogProblemDetector.readErrorLogs(data);
      });
    }

    if (data.mayFailSilently) {
      await readKind(
        "silent failure",
        async (): Promise<Array<LogInsightEvidence>> => {
          const evidence: LogInsightEvidence | null =
            await LogProblemDetector.readSilentFailure(data);

          return evidence ? [evidence] : [];
        },
      );
    } else if (data.lacksTraceContext) {
      found.push(LogProblemDetector.buildNoTraceContextEvidence(data));
    }

    if (data.isBusy) {
      await readKind(
        "noisy log",
        async (): Promise<Array<LogInsightEvidence>> => {
          const evidence: LogInsightEvidence | null =
            await LogProblemDetector.readNoisyLog(data);

          return evidence ? [evidence] : [];
        },
      );
    }

    return found.map((evidence: LogInsightEvidence): InsightCandidate => {
      return LogProblemDetector.buildCandidate({
        serviceId: data.serviceId,
        serviceName: data.serviceName,
        evidence,
      });
    });
  }

  private static async readErrorLogs(data: {
    projectId: ObjectID;
    serviceId: string;
    window: LogInsightWindow;
    reading: LogServiceReading;
  }): Promise<Array<LogInsightEvidence>> {
    const rows: Array<TopErrorPattern> =
      await LogAggregationService.getTopErrorPatterns({
        projectId: data.projectId,
        startTime: data.window.startTime,
        endTime: data.window.endTime,
        serviceIds: [new ObjectID(data.serviceId)],
        excludeExceptionRecords: true,
        limit: LOG_INSIGHT_ERROR_PATTERN_ROWS,
      });

    // Each reading beside the pattern its lines are grouped by.
    const rowsByReading: Map<LogPatternReading, TopErrorPattern> = new Map<
      LogPatternReading,
      TopErrorPattern
    >();

    for (const row of rows) {
      rowsByReading.set(LogProblemDetector.toErrorPatternReading(row), row);
    }

    const evidence: Array<LogInsightEvidence> = [];

    for (const reading of pickErrorPatterns(
      Array.from(rowsByReading.keys()),
    )) {
      const row: TopErrorPattern = rowsByReading.get(reading)!;
      let codeLocations: Array<PerformanceCodeLocation> = [];

      try {
        codeLocations = LogProblemDetector.toCodeLocations(
          await LogAggregationService.getErrorPatternCodeLocations({
            projectId: data.projectId,
            startTime: data.window.startTime,
            endTime: data.window.endTime,
            serviceIds: [new ObjectID(data.serviceId)],
            excludeExceptionRecords: true,
            pattern: row.pattern,
            limit: 3,
          }),
        );
      } catch (error) {
        logger.debug(
          `LogProblemDetector: where an error log of service ${data.serviceId} was written could not be read; the finding goes without it: ${error}`,
        );
      }

      const item: LogInsightEvidence = {
        serviceId: data.serviceId,
        kind: LogInsightKind.Error,
        windowStartTime: data.window.startTime.toISOString(),
        windowEndTime: data.window.endTime.toISOString(),
        logCount: data.reading.logCount,
        errorLogCount: data.reading.errorLogCount,
        pattern: reading.pattern,
        patternCount: reading.count,
        severities: reading.severities,
      };

      if (reading.searchText) {
        item.searchText = reading.searchText;
      }

      if (reading.traceCount > 0) {
        item.traceCount = reading.traceCount;
      }

      if (reading.sampleTraceIds.length > 0) {
        item.sampleTraceIds = reading.sampleTraceIds;
      }

      if (codeLocations.length > 0) {
        item.codeLocations = codeLocations;
      }

      evidence.push(item);
    }

    return evidence;
  }

  // A service's operations over the hour, the most failures first.
  private static async readFailingOperations(data: {
    projectId: ObjectID;
    serviceId: string;
    window: LogInsightWindow;
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
        limit: TRACE_INSIGHT_OPERATION_ROWS,
        tableSort: { column: "errorCount", direction: "desc" },
      });

    return pickFailingOperations(
      rows.map(TraceProblemDetector.toOperationReading),
    );
  }

  /*
   * The first of the service's failing operations whose most recent failed
   * requests wrote no log line - failures the code meant (a refused
   * request recorded as a fault) left aside - or null.
   */
  private static async readSilentFailure(data: {
    projectId: ObjectID;
    serviceId: string;
    window: LogInsightWindow;
    reading: LogServiceReading;
  }): Promise<LogInsightEvidence | null> {
    const operations: Array<TraceOperationReading> = (
      await LogProblemDetector.readFailingOperations(data)
    ).slice(0, LOG_INSIGHT_SILENT_OPERATIONS_PER_SERVICE);

    /*
     * The newest minutes are left out: a request that failed a moment ago
     * may have logged a line that is not read in yet.
     */
    const failedBefore: Date = new Date(
      data.window.endTime.getTime() - LOG_INSIGHT_INGEST_GRACE_MINUTES * 60_000,
    );

    for (const operation of operations) {
      const failedSpans: Array<Span> = await SpanService.findBy({
        query: {
          projectId: data.projectId,
          primaryEntityId: new ObjectID(data.serviceId),
          name: operation.name,
          statusCode: SpanStatus.Error,
          startTime: new InBetween(data.window.startTime, failedBefore),
        } as never,
        select: {
          traceId: true,
          spanId: true,
          statusMessage: true,
          hasException: true,
          events: true,
          attributes: true,
        } as never,
        sort: { startTime: SortOrder.Descending } as never,
        limit: LOG_INSIGHT_FAILED_SAMPLE_SIZE,
        skip: 0,
        props: { isRoot: true },
      });

      const samples: Array<FailedSpanSample> = failedSpans.map(
        TraceProblemDetector.toFailedSpanSample,
      );
      const failures: FailedSpansReading = readFailedSpans(samples);

      if (
        failures.verdict === TraceFailureVerdict.Expected ||
        failures.verdict === TraceFailureVerdict.Unread
      ) {
        continue;
      }

      const failedTraceIds: Array<string> = samples
        .map((sample: FailedSpanSample): string => {
          return sample.traceId;
        })
        .filter((traceId: string): boolean => {
          return traceId.length > 0;
        });

      const silence: FailedRequestLogsReading = readFailedRequestLogs({
        failedTraceIds,
        logCountsByTraceId:
          await LogAggregationService.getServiceLogCountsByTrace({
            projectId: data.projectId,
            serviceId: new ObjectID(data.serviceId),
            startTime: data.window.startTime,
            endTime: data.window.endTime,
            traceIds: failedTraceIds,
          }),
      });

      if (silence.verdict !== LogSilenceVerdict.Silent) {
        continue;
      }

      const evidence: LogInsightEvidence = {
        serviceId: data.serviceId,
        kind: LogInsightKind.MissingLogging,
        gap: LogLoggingGap.SilentFailures,
        windowStartTime: data.window.startTime.toISOString(),
        windowEndTime: data.window.endTime.toISOString(),
        logCount: data.reading.logCount,
        errorLogCount: data.reading.errorLogCount,
        tracedLogCount: data.reading.tracedLogCount,
        operationName: operation.name,
        operationSpanCount: operation.spanCount,
        failedSpanCount: operation.failedSpanCount,
        failedSampleSize: silence.sampleSize,
      };

      if (silence.sampleTraceId) {
        evidence.sampleTraceId = silence.sampleTraceId;
      }

      const error: LogInsightEvidence["error"] = toSilentFailureError(
        failures.error,
      );

      if (error) {
        evidence.error = error;
      }

      const location: PerformanceCodeLocation | undefined =
        failures.sample?.codeLocation;

      if (location) {
        evidence.codeLocations = [location];
      }

      return evidence;
    }

    return null;
  }

  // A busy service's noisy log, from a sample of its lines, or null.
  private static async readNoisyLog(data: {
    projectId: ObjectID;
    serviceId: string;
    window: LogInsightWindow;
    reading: LogServiceReading;
  }): Promise<LogInsightEvidence | null> {
    const sample: ServiceLogPatterns =
      await LogAggregationService.getServiceLogPatterns({
        projectId: data.projectId,
        serviceId: new ObjectID(data.serviceId),
        startTime: data.window.startTime,
        endTime: data.window.endTime,
        sampleSize: LOG_INSIGHT_NOISY_SAMPLE_SIZE,
        limit: LOG_INSIGHT_NOISY_PATTERN_ROWS,
      });

    const finding: LogNoisyPatternFinding | null = pickNoisyPattern({
      readings: sample.patterns.map(LogProblemDetector.toServicePatternReading),
      sampledLogCount: sample.sampledLogCount,
      logCount: data.reading.logCount,
    });

    if (!finding) {
      return null;
    }

    const evidence: LogInsightEvidence = {
      serviceId: data.serviceId,
      kind: LogInsightKind.Noisy,
      windowStartTime: data.window.startTime.toISOString(),
      windowEndTime: data.window.endTime.toISOString(),
      logCount: data.reading.logCount,
      errorLogCount: data.reading.errorLogCount,
      pattern: finding.reading.pattern,
      patternCount: finding.estimatedCount,
      patternPercent: Math.round(finding.percent * 10) / 10,
      sampledLogCount: sample.sampledLogCount,
      severities: finding.reading.severities,
    };

    if (finding.reading.searchText) {
      evidence.searchText = finding.reading.searchText;
    }

    return evidence;
  }
}

/*
 * The scanner's detectors for the Logs lane, one per insight type: each
 * hands back its own kind of the shared look's findings.
 */
abstract class LogProblemKindDetector implements InsightDetector {
  public abstract insightType: AIInsightType;

  public async detect(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    return (await LogProblemDetector.look(context)).filter(
      (candidate: InsightCandidate): boolean => {
        return candidate.insightType === this.insightType;
      },
    );
  }
}

export class LogErrorPatternDetector extends LogProblemKindDetector {
  public insightType: AIInsightType = AIInsightType.LogErrorPattern;
}

export class LogMissingLoggingDetector extends LogProblemKindDetector {
  public insightType: AIInsightType = AIInsightType.LogMissingLogging;
}

export class LogNoisyPatternDetector extends LogProblemKindDetector {
  public insightType: AIInsightType = AIInsightType.LogNoisyPattern;
}
