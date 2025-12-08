/*
 * Different types of notification events for Status Page Subscribers
 * Each event type has different variables available for templates
 */

enum StatusPageSubscriberNotificationEventType {
  // Incident related events
  SubscriberIncidentCreated = "Subscriber Incident Created",
  SubscriberIncidentStateChanged = "Subscriber Incident State Changed",
  SubscriberIncidentNoteCreated = "Subscriber Incident Note Created",

  // Announcement related events
  SubscriberAnnouncementCreated = "Subscriber Announcement Created",

  // Scheduled Maintenance related events
  SubscriberScheduledMaintenanceCreated = "Subscriber Scheduled Maintenance Created",
  SubscriberScheduledMaintenanceStateChanged = "Subscriber Scheduled Maintenance State Changed",
  SubscriberScheduledMaintenanceNoteCreated = "Subscriber Scheduled Maintenance Note Created",
}

export default StatusPageSubscriberNotificationEventType;
