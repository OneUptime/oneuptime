/*
 * REQUEST METRICS FROM TRACES, WITH NO CODE CHANGED: the step an
 * OpenTelemetry Collector takes to record a service's request metrics from
 * the traces passing through it - its span metrics connector (spanmetrics),
 * an exporter of the traces pipeline and a receiver of the metrics one. It
 * is the way past Metrics AI's Missing Metrics and Missing Request Metrics
 * findings (Utils/Metrics/MetricInsight) that changes no code: the
 * findings offer it beside Fix with AI, and the docs carry the same lines
 * (telemetry/metrics-explorer, "Record request metrics without changing
 * code").
 *
 * Why the collector, and not metrics OneUptime records from the traces it
 * stores (a trace recording rule over the span table):
 *
 *   - the collector counts every span the service sends, before anything
 *     samples them away; metrics recorded from the stored spans are short
 *     by whatever a sampler dropped - in the SDK, in a collector or in
 *     OneUptime's own pipeline rules - without saying so;
 *   - it records real metrics: a counter of calls and a histogram of their
 *     duration, in seconds, per service, operation, span kind and status,
 *     which every chart, metric monitor and SLO reads, and whose
 *     percentiles hold over any window. A recording rule writes one gauge a
 *     minute: its p95 of each minute cannot be read as an hour's;
 *   - nothing new runs in OneUptime: a rule would read the span table every
 *     minute, for each service, more with every service;
 *   - one step covers every service whose traces pass through the
 *     collector, and they are the names OneUptime's Kubernetes agent sends
 *     from eBPF already (traces.span.metrics.calls and
 *     traces.span.metrics.duration).
 *
 * The cost of it: a collector between the services and OneUptime. A
 * service that exports straight to OneUptime puts one in front first (the
 * OpenTelemetry docs' "Send through an OpenTelemetry Collector"), or takes
 * the pull request that adds the metrics in its code.
 *
 * The step's lines are the docs' collector config's own (receivers [otlp],
 * processors [batch], the exporter otlphttp), with spanmetrics added: the
 * connector keeps each span's resource on the metrics it records (the
 * connector.spanmetrics.excludeResourceMetrics feature gate is off by
 * default), and service.name on the resource is how OneUptime files them
 * under the service. Delta temporality, so a chart's sum over any window is
 * the requests of that window - as OneUptime adds up a histogram's buckets.
 * Pure: the Dashboard draws it, and the docs suites hold the docs to it.
 */

// The connector, as the collector names it, and the metrics it records.
export const SPAN_METRICS_CONNECTOR: string = "spanmetrics";
export const SPAN_METRICS_NAMESPACE: string = "traces.span.metrics";
export const SPAN_METRICS_CALLS_METRIC: string = `${SPAN_METRICS_NAMESPACE}.calls`;
export const SPAN_METRICS_DURATION_METRIC: string = `${SPAN_METRICS_NAMESPACE}.duration`;

/*
 * The names the step's lines give the collector's parts, as the docs'
 * collector config names them: the exporter that sends to OneUptime, the
 * receiver the services send to, and the processor every pipeline runs.
 */
export const SPAN_METRICS_ONEUPTIME_EXPORTER: string = "otlphttp";
export const SPAN_METRICS_RECEIVER: string = "otlp";
export const SPAN_METRICS_PROCESSOR: string = "batch";

// The collector config's lines that add the step.
export const SPAN_METRICS_COLLECTOR_STEP: string = [
  "connectors:",
  `  ${SPAN_METRICS_CONNECTOR}:`,
  "    histogram:",
  "      unit: s",
  "    aggregation_temporality: AGGREGATION_TEMPORALITY_DELTA",
  "",
  "service:",
  "  pipelines:",
  "    traces:",
  `      receivers: [${SPAN_METRICS_RECEIVER}]`,
  `      processors: [${SPAN_METRICS_PROCESSOR}]`,
  `      exporters: [${SPAN_METRICS_ONEUPTIME_EXPORTER}, ${SPAN_METRICS_CONNECTOR}]`,
  "    metrics:",
  `      receivers: [${SPAN_METRICS_RECEIVER}, ${SPAN_METRICS_CONNECTOR}]`,
  `      processors: [${SPAN_METRICS_PROCESSOR}]`,
  `      exporters: [${SPAN_METRICS_ONEUPTIME_EXPORTER}]`,
].join("\n");

/*
 * Where the docs say it: the Metrics Explorer page's section on Metrics AI,
 * under the heading of its own, and the OpenTelemetry page's section on
 * sending through a collector, for a service that sends straight to
 * OneUptime.
 */
export const SPAN_METRICS_DOCS_PATH: string =
  "/telemetry/metrics-explorer#record-request-metrics-without-changing-code";
export const SEND_THROUGH_COLLECTOR_DOCS_PATH: string =
  "/telemetry/open-telemetry#send-through-an-opentelemetry-collector";
