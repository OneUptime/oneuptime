/*
 * Whose reminder rules apply: an incident's, an alert's or a scheduled
 * maintenance event's. Each has its own Reminder Rules page and its own
 * Reminders card on the record's Settings page.
 *
 * Kept free of React, so copy modules and App tests can name a scope
 * without loading the countdown.
 */
enum ReminderRuleScope {
  Incident = "Incident",
  Alert = "Alert",
  ScheduledMaintenance = "ScheduledMaintenance",
}

export default ReminderRuleScope;
