import { InsightDetector } from "../Types";
import NewExceptionDetector from "./NewExceptionDetector";
import ExceptionSpikeDetector from "./ExceptionSpikeDetector";
import ErrorLogSpikeDetector from "./ErrorLogSpikeDetector";
import TraceLatencyRegressionDetector from "./TraceLatencyRegressionDetector";
import MetricDriftDetector from "./MetricDriftDetector";

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
    ];
  }
}
