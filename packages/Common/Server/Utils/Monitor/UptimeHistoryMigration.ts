/*
 * The data migration that puts Monitor.firstMeasuredAt right for a monitor's
 * uptime history (issue #8960; App's
 * BackfillMonitorFirstMeasuredAtForUptimeHistory). Uptime leaves a monitor's
 * time before its first check out only once its DataMigrations row is
 * there: the statements behind status pages and the Dashboard ask for it in
 * SQL (MonitorStatusTimelineService.getMeasuredFromCte), and an SLO reads it
 * before it measures its monitors (MonitorMeasuredFrom). Never rename it:
 * the row's name is what an install that has run it holds.
 *
 * Its own module, with nothing to load, so whatever reads it - a test that
 * mocks the service included - reads the name itself.
 */
export const FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME: string =
  "BackfillMonitorFirstMeasuredAtForUptimeHistory";
