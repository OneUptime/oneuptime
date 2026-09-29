enum ExceptionMetricType {
  ExceptionCount = "oneuptime.exception.count",
  ExceptionRate = "oneuptime.exception.rate",
  ExceptionCountByType = "oneuptime.exception.count.by.type",
  ExceptionCountByService = "oneuptime.exception.count.by.service",
  UnresolvedExceptionCount = "oneuptime.exception.unresolved.count",
  ResolvedExceptionCount = "oneuptime.exception.resolved.count",
  MutedExceptionCount = "oneuptime.exception.muted.count",
  ExceptionFirstSeenTime = "oneuptime.exception.first.seen.time",
  ExceptionLastSeenTime = "oneuptime.exception.last.seen.time",
  ExceptionOccurrenceCount = "oneuptime.exception.occurrence.count",
  ExceptionAffectedServiceCount = "oneuptime.exception.affected.service.count",
}

export default ExceptionMetricType;
