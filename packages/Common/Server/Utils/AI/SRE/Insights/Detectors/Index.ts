import { InsightDetector } from "../Types";
import NewExceptionDetector from "./NewExceptionDetector";
import ExceptionSpikeDetector from "./ExceptionSpikeDetector";
import ErrorLogSpikeDetector from "./ErrorLogSpikeDetector";
import TraceLatencyRegressionDetector from "./TraceLatencyRegressionDetector";
import MetricDriftDetector from "./MetricDriftDetector";
import DeployRegressionDetector from "./DeployRegressionDetector";
import ProfileHotspotDetector from "./ProfileHotspotDetector";
import {
  TraceFailingOperationDetector,
  TraceMissingTracingDetector,
  TraceSlowOperationDetector,
} from "./TraceProblemDetector";
import {
  LogErrorPatternDetector,
  LogMissingLoggingDetector,
  LogNoisyPatternDetector,
} from "./LogProblemDetector";
import { TelemetryAiLane } from "../../../../../../Types/AI/TelemetryAi";

/*
 * The detector registry. All five deterministic sensors — no LLM in any of
 * them. Order matters for the scanner's per-project new-insight cap: the
 * signals most likely to be actionable code problems (exceptions, then
 * latency) come before the softer volume/drift signals, so when the cap
 * bites it drops the softest findings first. The scanner runs every
 * detector with per-detector error isolation — a detector that throws
 * must not silence its siblings.
 */
export default class InsightDetectors {
  public static getAllDetectors(): Array<InsightDetector> {
    return [
      new NewExceptionDetector(),
      new ExceptionSpikeDetector(),
      new TraceLatencyRegressionDetector(),
      new ErrorLogSpikeDetector(),
      new MetricDriftDetector(),
      new DeployRegressionDetector(),
    ];
  }

  /*
   * The detectors of a telemetry product's AI section (Types/AI/
   * TelemetryAi): they run while the lane's own switch is on - not with
   * "Watch telemetry for problems" - and file what the lane's AI rules then
   * decide about. Profiles: slow code. Traces: slow operations, failing
   * operations and missing tracing - one detector each, sharing one look at
   * the project's traces (TraceProblemDetector).
   */
  public static getTelemetryAiDetectors(
    lane: TelemetryAiLane,
  ): Array<InsightDetector> {
    switch (lane) {
      case TelemetryAiLane.Profile:
        return [new ProfileHotspotDetector()];
      case TelemetryAiLane.Trace:
        return [
          new TraceFailingOperationDetector(),
          new TraceSlowOperationDetector(),
          new TraceMissingTracingDetector(),
        ];
      // Logs: one detector each, sharing one look (LogProblemDetector).
      case TelemetryAiLane.Log:
        return [
          new LogErrorPatternDetector(),
          new LogMissingLoggingDetector(),
          new LogNoisyPatternDetector(),
        ];
      default:
        return [];
    }
  }
}
