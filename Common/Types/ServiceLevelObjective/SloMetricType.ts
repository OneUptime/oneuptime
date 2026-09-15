/*
 * Metric names an SLO evaluation posts, next to the SloHistory row it already
 * writes, so an SLO can be charted, alerted on and dashboarded like any other
 * metric - the same way monitors post `oneuptime.monitor.*`.
 *
 * The values are stored verbatim as metric names in ClickHouse. Renaming one
 * orphans every data point already written under the old name, so treat them
 * as a public, append-only contract.
 *
 * Rows carry `sloId`, `projectId` and `sloName` attributes plus the SLO's
 * labels, with primaryEntityId = the SLO id.
 */
enum SloMetricType {
  // Current SLI over the compliance window. Unit "%", aggregated with Avg.
  SliPercent = "oneuptime.slo.sli.percent",

  // The objective the SLI is measured against. Unit "%", aggregated with Avg.
  TargetPercent = "oneuptime.slo.target.percent",

  /*
   * Share of the error budget still unspent; negative once the budget is
   * exhausted. Unit "%", aggregated with Avg.
   */
  ErrorBudgetRemainingPercent = "oneuptime.slo.error.budget.remaining.percent",

  // Error budget still unspent, in seconds. Unit "seconds", aggregated with Avg.
  ErrorBudgetRemainingSeconds = "oneuptime.slo.error.budget.remaining.seconds",

  /*
   * How fast the budget is being consumed (1 = exhausted exactly at the end of
   * the window). Unit "x", aggregated with Max so a short spike is not averaged
   * away.
   */
  BurnRate = "oneuptime.slo.burn.rate",

  /*
   * Healthy = 0, AtRisk = 1, BudgetExhausted = 2. Not emitted on the Paused /
   * Misconfigured guard paths, which have no measurement behind them. Unit "",
   * aggregated with Max so the worst state in a bucket wins.
   */
  Status = "oneuptime.slo.status",
}

export default SloMetricType;
