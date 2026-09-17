enum SpanMetricType {
  SpanCount = "oneuptime.span.count",
  SpanDuration = "oneuptime.span.duration",
  SpanErrorCount = "oneuptime.span.error.count",
  SpanErrorRate = "oneuptime.span.error.rate",
  SpanRequestRate = "oneuptime.span.request.rate",
  SpanP50Duration = "oneuptime.span.duration.p50",
  SpanP90Duration = "oneuptime.span.duration.p90",
  SpanP95Duration = "oneuptime.span.duration.p95",
  SpanP99Duration = "oneuptime.span.duration.p99",
  SpanStatusOk = "oneuptime.span.status.ok",
  SpanStatusError = "oneuptime.span.status.error",
  SpanStatusUnset = "oneuptime.span.status.unset",
  SpanThroughput = "oneuptime.span.throughput",
}

export default SpanMetricType;
