import AIInsightStatus, {
  AIInsightStatusHelper,
} from "Common/Types/AI/AIInsightStatus";
import AIInsightType from "Common/Types/AI/AIInsightType";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * "WITHOUT CHANGING CODE" ON A MISSING METRICS FINDING - the way past Metrics
 * AI's Missing Metrics and Missing Request Metrics findings that changes no
 * code: an OpenTelemetry Collector records the service's request metrics
 * from the traces it already sends (Common/Utils/Metrics/
 * SpanMetricsCollectorStep, which says why the collector's span metrics
 * step and not metrics OneUptime records from the stored spans). Drawn
 * beside Fix with AI, the pull request that adds the metrics in its code
 * (SpanMetricsStepPanel). React-free, so App's tests and the offline
 * browser suite read these exact strings.
 */

// The findings whose problem the step answers: no metrics for the requests.
export const SPAN_METRICS_STEP_INSIGHT_TYPES: ReadonlyArray<AIInsightType> = [
  AIInsightType.MetricMissingMetrics,
  AIInsightType.MetricMissingRequestMetrics,
];

/*
 * Whether a finding offers the step: one of those kinds, still open, and
 * not being fixed in code already - a pull request that adds the metrics
 * makes the step one more set of the same metrics.
 */
export function doesInsightOfferSpanMetricsStep(insight: {
  insightType?: string | undefined;
  status?: AIInsightStatus | null | undefined;
  fixAiRunId?: unknown;
}): boolean {
  return (
    (SPAN_METRICS_STEP_INSIGHT_TYPES as ReadonlyArray<string>).includes(
      insight.insightType || "",
    ) &&
    !insight.fixAiRunId &&
    Boolean(insight.status) &&
    !AIInsightStatusHelper.isTerminalStatus(insight.status as AIInsightStatus)
  );
}

// What the panel and its dialog say.
export const SPAN_METRICS_STEP_COPY: {
  panelTitle: string;
  panelDescription: string;
  panelBody: string;
  showStep: string;
  modalTitle: string;
  modalDescription: string;
  addStepTitle: string;
  addStepDescription: string;
  restartTitle: string;
  restartDescription: string;
  noCollector: string;
  noCollectorLink: string;
  learnMore: string;
  close: string;
} = {
  panelTitle: translationKey("Without changing code"),
  panelDescription: translationKey(
    "Record these metrics from the traces the service already sends.",
  ),
  panelBody: translationKey(
    "Add a span metrics step to the OpenTelemetry Collector its traces go through. It records the requests, errors and duration of every operation as metrics, for every service at once.",
  ),
  showStep: translationKey("Show the collector step"),
  modalTitle: translationKey("Record request metrics from traces"),
  modalDescription: translationKey(
    "No code changes: the OpenTelemetry Collector records them from the spans passing through it.",
  ),
  addStepTitle: translationKey("Add the span metrics step"),
  addStepDescription: translationKey(
    "In the collector's config, add spanmetrics as an exporter of the traces pipeline and as a receiver of the metrics pipeline. Keep your own receivers, processors and the exporter that sends to OneUptime, named otlphttp here.",
  ),
  restartTitle: translationKey("Restart the collector"),
  restartDescription: translationKey(
    "Within a few minutes, each service whose traces pass through it sends traces.span.metrics.calls and traces.span.metrics.duration, and OneUptime no longer finds this problem.",
  ),
  noCollector: translationKey(
    "Do your services send straight to OneUptime? Put a collector in front of them first.",
  ),
  noCollectorLink: translationKey("Send through an OpenTelemetry Collector"),
  learnMore: translationKey("How the span metrics step works"),
  close: translationKey("Close"),
};

// The data-testids of the panel's parts.
export const SPAN_METRICS_STEP_TEST_IDS: {
  panel: string;
  show: string;
  modal: string;
  code: string;
  collectorDocs: string;
  docs: string;
} = {
  panel: "span-metrics-step",
  show: "span-metrics-step-show",
  modal: "span-metrics-step-modal",
  code: "span-metrics-step-code",
  collectorDocs: "span-metrics-step-collector-docs",
  docs: "span-metrics-step-docs",
};
