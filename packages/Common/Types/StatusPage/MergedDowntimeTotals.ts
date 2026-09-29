/*
 * What MonitorStatusTimelineService.getMergedDowntimeSeconds returns for a
 * SET of monitors - a monitor group, a status page group, the whole page.
 * Both figures are unions, so an instant counts once however many of the
 * monitors it covers.
 *
 * Kept here rather than next to the query because the status page's browser
 * reads it too: the overview payload carries one per monitor group (see
 * MonitorGroupMergedDowntimeUtil), and a monitor group's uptime percentage
 * is measured from it.
 */
export interface MergedDowntimeTotals {
  // Seconds at least one of the monitors was recorded, in any status.
  coveredSeconds: number;
  // Seconds at least one of them spent in a downtime status.
  downtimeSeconds: number;
}
