import LogService from "./LogService";
import SpanService from "./SpanService";
import { DbJSONResponse, Results } from "./AnalyticsDatabaseService";
import { Statement } from "../Utils/AnalyticsDatabase/Statement";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { TelemetryServiceFilter } from "../Utils/Telemetry/TelemetryReadScope";
import {
  NO_TRACE_HEALTH_SPANS,
  TraceHealthLogCounts,
  TraceHealthSpanCounts,
  TraceHealthWindow,
  buildLogLinkStatement,
  buildServiceSpanCountStatement,
  buildSpanHealthStatement,
  interpretTraceHealth,
  pickTraceHealthSamplePercent,
  readLogLinkCounts,
  readServiceSpanCount,
  readSpanHealthCounts,
} from "../Utils/Telemetry/TraceHealth";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { TraceHealthReport } from "../../Types/Telemetry/TraceHealth";

/*
 * Runs the trace health statements (Utils/Telemetry/TraceHealth) for one
 * service: its span count first, which picks the sample, then the trace
 * numbers and the log count together. A service with no span in the window
 * reads nothing more - there is nothing to measure, and the card is not
 * shown.
 */

export interface TraceHealthRequest extends TraceHealthWindow {
  projectId: ObjectID;
  // The service's spans the caller may read (TelemetryReadScopeUtil.toServiceFilter).
  spanFilter: TelemetryServiceFilter;
  // Its logs the caller may read; null when they may read none of them.
  logFilter: TelemetryServiceFilter | null;
}

async function readRows(
  service: { executeQuery: (statement: Statement) => Promise<Results> },
  statement: Statement,
): Promise<Array<JSONObject>> {
  // A read stopped at its time limit throws (QueryTimeoutException).
  const result: Results = await service.executeQuery(statement);
  const response: DbJSONResponse = await result.json<{
    data?: Array<JSONObject>;
  }>();

  return response.data || [];
}

export class TraceHealthService {
  @CaptureSpan()
  public static async getReport(
    request: TraceHealthRequest,
  ): Promise<TraceHealthReport> {
    const window: TraceHealthWindow = {
      startTime: request.startTime,
      endTime: request.endTime,
    };

    const serviceSpanCount: number = readServiceSpanCount(
      await readRows(
        SpanService,
        buildServiceSpanCountStatement({
          projectId: request.projectId,
          serviceFilter: request.spanFilter,
          ...window,
        }),
      ),
    );

    if (serviceSpanCount === 0) {
      return interpretTraceHealth({
        window,
        samplePercent: 100,
        spans: NO_TRACE_HEALTH_SPANS,
        logs: null,
      });
    }

    const samplePercent: number =
      pickTraceHealthSamplePercent(serviceSpanCount);
    const logFilter: TelemetryServiceFilter | null = request.logFilter;

    const [spans, logs]: [TraceHealthSpanCounts, TraceHealthLogCounts | null] =
      await Promise.all([
        readRows(
          SpanService,
          buildSpanHealthStatement({
            projectId: request.projectId,
            serviceFilter: request.spanFilter,
            samplePercent,
            ...window,
          }),
        ).then(readSpanHealthCounts),
        logFilter
          ? readRows(
              LogService,
              buildLogLinkStatement({
                projectId: request.projectId,
                serviceFilter: logFilter,
                ...window,
              }),
            ).then(readLogLinkCounts)
          : Promise.resolve(null),
      ]);

    return interpretTraceHealth({ window, samplePercent, spans, logs });
  }
}

export default TraceHealthService;
