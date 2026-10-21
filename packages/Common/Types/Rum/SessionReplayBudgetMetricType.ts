/*
 * Metric names the session replay budget sweep posts every five minutes
 * (Common/Server/Utils/SessionReplay/SessionReplayBudgetMetrics.ts), so the
 * two storage budgets on the Replay Health page can be charted and alerted on
 * like any other metric - the same way monitors post `oneuptime.monitor.*`
 * and SLOs post `oneuptime.slo.*`. Without them a spent budget was only ever
 * visible to someone looking at the Health page: recorders are told to stop,
 * quietly, and recordings simply stop appearing.
 *
 * The values are stored verbatim as metric names in ClickHouse. Renaming one
 * orphans every point already written under the old name and silences every
 * monitor watching it, so treat them as a public, append-only contract.
 *
 * Every row is keyed to a RUM application (primaryEntityId = its id, type
 * RealUserMonitor), which is what lets a monitor scoped to that application
 * see it. The project series carry only a `projectId` attribute: the daily
 * limit belongs to the project, and the same value is posted under each
 * application that records, so nothing about the row may read as that
 * application's own usage. The application series also carry
 * `rumApplicationId` and `rumApplicationName`.
 */
enum SessionReplayBudgetMetricType {
  /*
   * Replay upload bytes the gate has charged since 00:00 UTC, for the whole
   * project (every application together). Unit "By".
   */
  ProjectDailyUsedBytes = "oneuptime.rum.session.replay.budget.project.daily.used.bytes",

  /*
   * The above as a percent of the deployment's daily limit, rounded down to
   * 0.01 so ">= 100" means exactly what the gate means by "spent". Not
   * capped: the request that crosses the limit stays charged. Unit "%".
   */
  ProjectDailyUsedPercent = "oneuptime.rum.session.replay.budget.project.daily.used.percent",

  /*
   * Replay upload bytes charged to one application's monthly budget since the
   * 1st (UTC). Only counted, and only posted, while the application has a
   * monthly budget. Unit "By".
   */
  ApplicationMonthlyUsedBytes = "oneuptime.rum.session.replay.budget.application.monthly.used.bytes",

  // The above as a percent of the application's monthly budget. Unit "%".
  ApplicationMonthlyUsedPercent = "oneuptime.rum.session.replay.budget.application.monthly.used.percent",
}

export default SessionReplayBudgetMetricType;
