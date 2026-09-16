/**
 * The `SloHistory.metricName` values the SLO evaluation worker writes on
 * every run — one ClickHouse row per series per evaluation.
 *
 * These strings are PERSISTED: 400 days of history rows already carry them,
 * and the dashboard SLO widget, the SLO charts and the overview's burn-down
 * all select rows by them. Renaming a member's value would silently orphan
 * every existing row (charts would read "no history" for a year), so the
 * values are frozen — add a member for a new series, never edit one.
 *
 * They used to be three separately typed string literals in the worker, the
 * charts page and the widget helper. Common/Tests/Utils/Slo/SloHistoryMetricName.test.ts
 * pins the worker's writes and the widget's reads to these values.
 *
 * Not to be confused with SloMetricType, which names the `oneuptime.slo.*`
 * telemetry metrics posted alongside (a different table, a different
 * retention and a different consumer).
 */
enum SloHistoryMetricName {
  SliPercent = "sli.percent",
  ErrorBudgetRemainingPercent = "error.budget.remaining.percent",
  BurnRate = "burn.rate",
}

export default SloHistoryMetricName;
