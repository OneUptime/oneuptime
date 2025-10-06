export const WhatsAppTemplateIds = {
  AlertCreated: "oneuptime_alert_created",
  IncidentCreated: "oneuptime_incident_created",
  VerificationCode: "oneuptime_verification_code",
  IncidentCreatedOwnerNotification: "oneuptime_incident_created_owner_notification",
  IncidentNotePostedOwnerNotification:
    "oneuptime_incident_note_posted_owner_notification",
  IncidentStateChangedOwnerNotification:
    "oneuptime_incident_state_changed_owner_notification",
  IncidentOwnerAddedNotification: "oneuptime_incident_owner_added_notification",
  AlertCreatedOwnerNotification: "oneuptime_alert_created_owner_notification",
  AlertNotePostedOwnerNotification: "oneuptime_alert_note_posted_owner_notification",
  AlertStateChangedOwnerNotification:
    "oneuptime_alert_state_changed_owner_notification",
  AlertOwnerAddedNotification: "oneuptime_alert_owner_added_notification",
  MonitorOwnerAddedNotification: "oneuptime_monitor_owner_added_notification",
  MonitorCreatedOwnerNotification: "oneuptime_monitor_created_owner_notification",
  MonitorStatusChangedOwnerNotification:
    "oneuptime_monitor_status_changed_owner_notification",
  MonitorProbeStatusChangedNotification:
    "oneuptime_monitor_probe_status_changed_notification",
  MonitorNoProbesMonitoringNotification:
    "oneuptime_monitor_no_probes_monitoring_notification",
  ScheduledMaintenanceCreatedOwnerNotification:
    "oneuptime_scheduled_maintenance_created_owner_notification",
  ScheduledMaintenanceNotePostedOwnerNotification:
    "oneuptime_scheduled_maintenance_note_posted_owner_notification",
  ScheduledMaintenanceOwnerAddedNotification:
    "oneuptime_scheduled_maintenance_owner_added_notification",
  ScheduledMaintenanceStateChangedOwnerNotification:
    "oneuptime_scheduled_maintenance_state_changed_owner_notification",
  StatusPageAnnouncementCreatedOwnerNotification:
    "oneuptime_status_page_announcement_created_owner_notification",
  StatusPageCreatedOwnerNotification:
    "oneuptime_status_page_created_owner_notification",
  StatusPageOwnerAddedNotification:
    "oneuptime_status_page_owner_added_notification",
  ProbeStatusChangedOwnerNotification:
    "oneuptime_probe_status_changed_owner_notification",
  ProbeOwnerAddedNotification: "oneuptime_probe_owner_added_notification",
  OnCallUserIsOnRosterNotification: "oneuptime_oncall_user_is_on_roster_notification",
  OnCallUserIsNextNotification: "oneuptime_oncall_user_is_next_notification",
  OnCallUserAddedToPolicyNotification:
    "oneuptime_oncall_user_added_to_policy_notification",
  OnCallUserRemovedFromPolicyNotification:
    "oneuptime_oncall_user_removed_from_policy_notification",
  OnCallUserNoLongerActiveNotification:
    "oneuptime_oncall_user_no_longer_active_notification",
} as const;

const WhatsAppTemplateMessages = {
  [WhatsAppTemplateIds.AlertCreated]: `This is a message from OneUptime. A new alert {{alert_title}} has been created for project {{project_name}}. To acknowledge this alert, open {{acknowledge_url}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.IncidentCreated]: `This is a message from OneUptime. A new incident {{incident_title}} has been created for project {{project_name}}. To acknowledge this incident, open {{acknowledge_url}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.VerificationCode]: `Your OneUptime verification code is {{verification_code}}. Enter this code in the dashboard to verify your WhatsApp number. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.IncidentCreatedOwnerNotification]: `This is a message from OneUptime. Incident {{incident_title}} has been created for project {{project_name}}. View incident details: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.IncidentNotePostedOwnerNotification]: `This is a message from OneUptime. A new note was posted on incident {{incident_title}}. Review the incident: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.IncidentStateChangedOwnerNotification]: `This is a message from OneUptime. Incident {{incident_title}} state changed to {{incident_state}}. Track the incident status: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.IncidentOwnerAddedNotification]: `This is a message from OneUptime. You have been added as an owner of incident {{incident_title}}. Manage the incident: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.AlertCreatedOwnerNotification]: `This is a message from OneUptime. Alert {{alert_title}} has been created for project {{project_name}}. View alert details: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.AlertNotePostedOwnerNotification]: `This is a message from OneUptime. A new note was posted on alert {{alert_title}}. Review the alert: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.AlertStateChangedOwnerNotification]: `This is a message from OneUptime. Alert {{alert_title}} state changed to {{alert_state}}. Track the alert status: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.AlertOwnerAddedNotification]: `This is a message from OneUptime. You have been added as an owner of alert {{alert_title}}. Manage the alert: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.MonitorOwnerAddedNotification]: `This is a message from OneUptime. You have been added as an owner of monitor {{monitor_name}}. Manage the monitor: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.MonitorCreatedOwnerNotification]: `This is a message from OneUptime. Monitor {{monitor_name}} has been created. View monitor details: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.MonitorStatusChangedOwnerNotification]: `This is a message from OneUptime. Monitor {{monitor_name}} status changed to {{monitor_status}}. Check monitor status: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.MonitorProbeStatusChangedNotification]: `This is a message from OneUptime. Probes for monitor {{monitor_name}} are {{probe_status}}. Review probe details: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.MonitorNoProbesMonitoringNotification]: `This is a message from OneUptime. No probes are monitoring monitor {{monitor_name}}. Investigate the monitor: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.ScheduledMaintenanceCreatedOwnerNotification]: `This is a message from OneUptime. Scheduled maintenance {{event_title}} has been created. View event details: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.ScheduledMaintenanceNotePostedOwnerNotification]: `This is a message from OneUptime. A new note was posted on scheduled maintenance {{event_title}}. Review the event: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.ScheduledMaintenanceOwnerAddedNotification]: `This is a message from OneUptime. You have been added as an owner of scheduled maintenance {{event_title}}. Manage the event: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.ScheduledMaintenanceStateChangedOwnerNotification]: `This is a message from OneUptime. Scheduled maintenance {{event_title}} state changed to {{event_state}}. Track event status: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.StatusPageAnnouncementCreatedOwnerNotification]: `This is a message from OneUptime. Announcement {{announcement_title}} was published on status page {{status_page_name}}. View the announcement: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.StatusPageCreatedOwnerNotification]: `This is a message from OneUptime. Status page {{status_page_name}} has been created. View status page details: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.StatusPageOwnerAddedNotification]: `This is a message from OneUptime. You have been added as an owner of status page {{status_page_name}}. Manage the status page: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.ProbeStatusChangedOwnerNotification]: `This is a message from OneUptime. Probe {{probe_name}} status is {{probe_status}}. Review the probe: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.ProbeOwnerAddedNotification]: `This is a message from OneUptime. You have been added as an owner of probe {{probe_name}}. Manage the probe: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.OnCallUserIsOnRosterNotification]: `This is a message from OneUptime. You are now on-call for policy {{on_call_policy_name}} on schedule {{schedule_name}}. View on-call schedule: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.OnCallUserIsNextNotification]: `This is a message from OneUptime. You are next on-call for policy {{on_call_policy_name}} on schedule {{schedule_name}}. Prepare for your shift: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.OnCallUserAddedToPolicyNotification]: `This is a message from OneUptime. You have been added to on-call policy {{on_call_policy_name}} for {{on_call_context}}. Review the on-call policy: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.OnCallUserRemovedFromPolicyNotification]: `This is a message from OneUptime. You have been removed from on-call policy {{on_call_policy_name}} for {{on_call_context}}. View on-call policies: {{action_link}}. For more information, visit your OneUptime dashboard.`,
  [WhatsAppTemplateIds.OnCallUserNoLongerActiveNotification]: `This is a message from OneUptime. You are no longer on-call for policy {{on_call_policy_name}} on schedule {{schedule_name}}. Review your schedule: {{action_link}}. For more information, visit your OneUptime dashboard.`,
} as const;

export type WhatsAppTemplateId =
  (typeof WhatsAppTemplateIds)[keyof typeof WhatsAppTemplateIds];

export const WhatsAppTemplateLanguage: Record<WhatsAppTemplateId, string> = {
  [WhatsAppTemplateIds.AlertCreated]: "en",
  [WhatsAppTemplateIds.IncidentCreated]: "en",
  [WhatsAppTemplateIds.VerificationCode]: "en",
  [WhatsAppTemplateIds.IncidentCreatedOwnerNotification]: "en",
  [WhatsAppTemplateIds.IncidentNotePostedOwnerNotification]: "en",
  [WhatsAppTemplateIds.IncidentStateChangedOwnerNotification]: "en",
  [WhatsAppTemplateIds.IncidentOwnerAddedNotification]: "en",
  [WhatsAppTemplateIds.AlertCreatedOwnerNotification]: "en",
  [WhatsAppTemplateIds.AlertNotePostedOwnerNotification]: "en",
  [WhatsAppTemplateIds.AlertStateChangedOwnerNotification]: "en",
  [WhatsAppTemplateIds.AlertOwnerAddedNotification]: "en",
  [WhatsAppTemplateIds.MonitorOwnerAddedNotification]: "en",
  [WhatsAppTemplateIds.MonitorCreatedOwnerNotification]: "en",
  [WhatsAppTemplateIds.MonitorStatusChangedOwnerNotification]: "en",
  [WhatsAppTemplateIds.MonitorProbeStatusChangedNotification]: "en",
  [WhatsAppTemplateIds.MonitorNoProbesMonitoringNotification]: "en",
  [WhatsAppTemplateIds.ScheduledMaintenanceCreatedOwnerNotification]: "en",
  [WhatsAppTemplateIds.ScheduledMaintenanceNotePostedOwnerNotification]: "en",
  [WhatsAppTemplateIds.ScheduledMaintenanceOwnerAddedNotification]: "en",
  [WhatsAppTemplateIds.ScheduledMaintenanceStateChangedOwnerNotification]: "en",
  [WhatsAppTemplateIds.StatusPageAnnouncementCreatedOwnerNotification]: "en",
  [WhatsAppTemplateIds.StatusPageCreatedOwnerNotification]: "en",
  [WhatsAppTemplateIds.StatusPageOwnerAddedNotification]: "en",
  [WhatsAppTemplateIds.ProbeStatusChangedOwnerNotification]: "en",
  [WhatsAppTemplateIds.ProbeOwnerAddedNotification]: "en",
  [WhatsAppTemplateIds.OnCallUserIsOnRosterNotification]: "en",
  [WhatsAppTemplateIds.OnCallUserIsNextNotification]: "en",
  [WhatsAppTemplateIds.OnCallUserAddedToPolicyNotification]: "en",
  [WhatsAppTemplateIds.OnCallUserRemovedFromPolicyNotification]: "en",
  [WhatsAppTemplateIds.OnCallUserNoLongerActiveNotification]: "en",
};

export const renderWhatsAppTemplate = (
  templateId: WhatsAppTemplateId,
  variables: Record<string, string>,
): string => {
  const template: string | undefined = WhatsAppTemplateMessages[templateId];

  if (!template) {
    throw new Error(`WhatsApp template ${templateId} is not defined.`);
  }

  return template.replace(/\{\{(.*?)\}\}/g, (_match: string, key: string) => {
    if (variables[key] === undefined) {
      throw new Error(
        `Missing variable "${key}" for WhatsApp template ${templateId}.`,
      );
    }

    return variables[key];
  });
};

export default WhatsAppTemplateMessages;
