import { InsightDetector } from "../Types";
import NewExceptionDetector from "./NewExceptionDetector";
import ExceptionSpikeDetector from "./ExceptionSpikeDetector";
import ErrorLogSpikeDetector from "./ErrorLogSpikeDetector";
import TraceLatencyRegressionDetector from "./TraceLatencyRegressionDetector";
import MetricDriftDetector from "./MetricDriftDetector";
import KubernetesCrashLoopDetector from "./KubernetesCrashLoopDetector";

/*
 * The detector registry. All six deterministic sensors — no LLM in any of
 * them. Order matters for the scanner's per-project new-insight cap: the
 * signals most likely to be actionable code problems (exceptions, then
 * crash loops, then latency) come before the softer volume/drift signals, so
 * when the cap bites it drops the softest findings first. The scanner runs
 * every detector with per-detector error isolation — a detector that throws
 * must not silence its siblings.
 *
 * KubernetesCrashLoopDetector sits second because a container that cannot
 * stay up is both maximally actionable and invisible to every other sensor
 * here: the other five read telemetry, and a workload stuck in
 * CrashLoopBackOff frequently emits none.
 */
export default class InsightDetectors {
  public static getAllDetectors(): Array<InsightDetector> {
    return [
      new NewExceptionDetector(),
      new KubernetesCrashLoopDetector(),
      new ExceptionSpikeDetector(),
      new TraceLatencyRegressionDetector(),
      new ErrorLogSpikeDetector(),
      new MetricDriftDetector(),
    ];
  }
}
