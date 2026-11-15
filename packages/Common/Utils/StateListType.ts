/*
 * The lists a project orders (Utils/StateOrder), each by its records'
 * table. A module of its own, so what only names a list - DefaultRecordNames,
 * which every form loads, sign-in and sign-up pages included - loads none of
 * StateOrder's lists and rules with it.
 */
export enum StateListType {
  IncidentState = "IncidentState",
  AlertState = "AlertState",
  ScheduledMaintenanceState = "ScheduledMaintenanceState",
  MonitorStatus = "MonitorStatus",
  IncidentSeverity = "IncidentSeverity",
  AlertSeverity = "AlertSeverity",
  IncidentPostmortemStatus = "IncidentPostmortemStatus",
  SecurityCaseStatus = "SecurityCaseStatus",
  SecurityCasePriority = "SecurityCasePriority",
}
