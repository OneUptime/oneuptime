import ExceptionInstanceService from "./ExceptionInstanceService";
import LogService from "./LogService";
import SpanService from "./SpanService";
import TelemetryExceptionService from "./TelemetryExceptionService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "../Utils/Telemetry/TelemetryReadScope";
import ExceptionInstance from "../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../Models/AnalyticsModels/Log";
import Span from "../../Models/AnalyticsModels/Span";
import InBetween from "../../Types/BaseDatabase/InBetween";
import IncludesNone from "../../Types/BaseDatabase/IncludesNone";
import Query from "../../Types/BaseDatabase/Query";
import OneUptimeDate from "../../Types/Date";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "../../Types/Monitor/MonitorStepExceptionMonitor";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../Types/Monitor/MonitorStepLogMonitor";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "../../Types/Monitor/MonitorStepTraceMonitor";
import TelemetryRulePreviewUtil, {
  TelemetryRulePreviewAnswer,
  TelemetryRulePreviewRange,
} from "../../Types/Monitor/TelemetryRulePreview";
import ObjectID from "../../Types/ObjectID";

/*
 * The counts a Logs, Traces or Exceptions monitor's rule compares, one
 * window at a time over the hours before now (TelemetryRulePreviewUtil
 * says which windows). Each read is the monitor's own query - the one its
 * check runs (MonitorTelemetryMonitor) - with the preview's range in place
 * of the check's window, narrowed to the services the reader may read, and
 * counted per window in ClickHouse (AnalyticsDatabaseService.countPerWindow,
 * which stops at the interactive time limit).
 */
export default class TelemetryRulePreviewService {
  @CaptureSpan()
  public static async previewLogs(data: {
    projectId: ObjectID;
    logMonitor: MonitorStepLogMonitor;
    scope: TelemetryReadScope;
    now?: Date | undefined;
  }): Promise<TelemetryRulePreviewAnswer> {
    const range: TelemetryRulePreviewRange = TelemetryRulePreviewUtil.getRange({
      windowInSeconds: data.logMonitor.lastXSecondsOfLogs,
      now: data.now || OneUptimeDate.getCurrentDate(),
    });

    const query: Query<Log> = TelemetryReadScopeUtil.applyToQuery(
      MonitorStepLogMonitorUtil.toQuery(data.logMonitor),
      "primaryEntityId",
      data.scope,
    );

    query.projectId = data.projectId;
    query.time = new InBetween(range.startTime, range.endTime);

    return TelemetryRulePreviewService.toAnswer({
      range,
      windows: await LogService.countPerWindow({
        query,
        timeColumnName: "time",
        windowInSeconds: range.windowInSeconds,
        props: { isRoot: true },
      }),
    });
  }

  @CaptureSpan()
  public static async previewSpans(data: {
    projectId: ObjectID;
    traceMonitor: MonitorStepTraceMonitor;
    scope: TelemetryReadScope;
    now?: Date | undefined;
  }): Promise<TelemetryRulePreviewAnswer> {
    const range: TelemetryRulePreviewRange = TelemetryRulePreviewUtil.getRange({
      windowInSeconds: data.traceMonitor.lastXSecondsOfSpans,
      now: data.now || OneUptimeDate.getCurrentDate(),
    });

    const query: Query<Span> = TelemetryReadScopeUtil.applyToQuery(
      MonitorStepTraceMonitorUtil.toQuery(data.traceMonitor),
      "primaryEntityId",
      data.scope,
    );

    query.projectId = data.projectId;
    query.startTime = new InBetween(range.startTime, range.endTime);

    return TelemetryRulePreviewService.toAnswer({
      range,
      windows: await SpanService.countPerWindow({
        query,
        timeColumnName: "startTime",
        windowInSeconds: range.windowInSeconds,
        props: { isRoot: true },
      }),
    });
  }

  /*
   * Like the check, occurrences of exceptions marked resolved or archived
   * are not counted unless the monitor counts them too.
   */
  @CaptureSpan()
  public static async previewExceptions(data: {
    projectId: ObjectID;
    exceptionMonitor: MonitorStepExceptionMonitor;
    scope: TelemetryReadScope;
    now?: Date | undefined;
  }): Promise<TelemetryRulePreviewAnswer> {
    const range: TelemetryRulePreviewRange = TelemetryRulePreviewUtil.getRange({
      windowInSeconds: data.exceptionMonitor.lastXSecondsOfExceptions,
      now: data.now || OneUptimeDate.getCurrentDate(),
    });

    const query: Query<ExceptionInstance> = TelemetryReadScopeUtil.applyToQuery(
      MonitorStepExceptionMonitorUtil.toAnalyticsQuery(data.exceptionMonitor),
      "primaryEntityId",
      data.scope,
    );

    query.projectId = data.projectId;
    query.time = new InBetween(range.startTime, range.endTime);

    const excludeResolved: boolean = !data.exceptionMonitor.includeResolved;
    const excludeArchived: boolean = !data.exceptionMonitor.includeArchived;

    if (excludeResolved || excludeArchived) {
      const excludedFingerprints: Array<string> =
        await TelemetryExceptionService.getResolvedOrArchivedFingerprints({
          projectId: data.projectId,
          telemetryServiceIds: data.exceptionMonitor.telemetryServiceIds,
          resolved: excludeResolved,
          archived: excludeArchived,
        });

      if (excludedFingerprints.length > 0) {
        query.fingerprint = new IncludesNone(excludedFingerprints);
      }
    }

    return TelemetryRulePreviewService.toAnswer({
      range,
      windows: await ExceptionInstanceService.countPerWindow({
        query,
        timeColumnName: "time",
        windowInSeconds: range.windowInSeconds,
        props: { isRoot: true },
      }),
    });
  }

  private static toAnswer(data: {
    range: TelemetryRulePreviewRange;
    windows: Array<{ time: Date; count: number }>;
  }): TelemetryRulePreviewAnswer {
    return {
      buckets: data.windows.map((window: { time: Date; count: number }) => {
        return {
          time: OneUptimeDate.toString(window.time),
          value: window.count,
        };
      }),
      windowInSeconds: data.range.windowInSeconds,
      startTime: OneUptimeDate.toString(data.range.startTime),
      endTime: OneUptimeDate.toString(data.range.endTime),
    };
  }
}
