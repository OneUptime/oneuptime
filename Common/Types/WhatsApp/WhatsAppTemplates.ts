type TemplateIdsMap = {
  readonly AlertCreated: "oneuptime_created_alert";
  readonly IncidentCreated: "oneuptime_created_incident";
  readonly VerificationCode: "oneuptime_verification_code";
  readonly TestNotification: "oneuptime_test_notification";
  readonly IncidentCreatedOwnerNotification: "oneuptime_incident_created_owner_notification";
  readonly IncidentNotePostedOwnerNotification: "oneuptime_incident_note_posted_owner_notification";
  readonly IncidentStateChangedOwnerNotification: "oneuptime_incident_state_change_owner_notification";
  readonly IncidentOwnerAddedNotification: "oneuptime_incident_owner_added_notification";
  readonly AlertCreatedOwnerNotification: "oneuptime_alert_created_owner_notification";
  readonly AlertNotePostedOwnerNotification: "oneuptime_alert_note_posted_owner_notification";
  readonly AlertStateChangedOwnerNotification: "oneuptime_alert_state_changed_owner_notification";
  readonly AlertOwnerAddedNotification: "oneuptime_alert_owner_added_notification";
  readonly MonitorOwnerAddedNotification: "oneuptime_monitor_owner_added_notification";
  readonly MonitorCreatedOwnerNotification: "oneuptime_monitor_created_owner_notification";
  readonly MonitorStatusChangedOwnerNotification: "oneuptime_monitor_status_changed_owner_notification";
  readonly MonitorProbeStatusChangedNotification: "oneuptime_monitor_probe_status_changed_notification";
  readonly MonitorNoProbesMonitoringNotification: "oneuptime_monitor_no_probes_monitoring_notification";
  readonly ScheduledMaintenanceCreatedOwnerNotification: "oneuptime_scheduled_maintenance_created_owner_notification";
  readonly ScheduledMaintenanceNotePostedOwnerNotification: "oneuptime_scheduled_maintenance_note_posted_owner_notification";
  readonly ScheduledMaintenanceOwnerAddedNotification: "oneuptime_scheduled_maintenance_owner_added_notification";
  readonly ScheduledMaintenanceStateChangedOwnerNotification: "oneuptime_scheduled_maintenance_state_changed_owner_notification";
  readonly StatusPageAnnouncementCreatedOwnerNotification: "oneuptime_status_page_announcement_created_owner_notification";
  readonly StatusPageCreatedOwnerNotification: "oneuptime_status_page_created_owner_notification";
  readonly StatusPageOwnerAddedNotification: "oneuptime_status_page_owner_added_notification";
  readonly ProbeStatusChangedOwnerNotification: "oneuptime_probe_status_changed_owner_notification";
  readonly ProbeOwnerAddedNotification: "oneuptime_probe_owner_added_notification";
  readonly OnCallUserIsOnRosterNotification: "oneuptime_oncall_user_is_on_roster_notification";
  readonly OnCallUserIsNextNotification: "oneuptime_oncall_user_is_next_notification";
  readonly OnCallUserAddedToPolicyNotification: "oneuptime_oncall_user_added_to_policy_notification";
  readonly OnCallUserRemovedFromPolicyNotification: "oneuptime_oncall_user_removed_from_policy_notification";
  readonly OnCallUserNoLongerActiveNotification: "oneuptime_oncall_user_no_longer_active_notification";
  readonly AIAgentStatusChangedOwnerNotification: "oneuptime_ai_agent_status_changed_owner_notification";
  readonly AIAgentOwnerAddedNotification: "oneuptime_ai_agent_owner_added_notification";
};

const templateIds: TemplateIdsMap = {
  AlertCreated: "oneuptime_created_alert",
  IncidentCreated: "oneuptime_created_incident",
  VerificationCode: "oneuptime_verification_code",
  TestNotification: "oneuptime_test_notification",
  IncidentCreatedOwnerNotification:
    "oneuptime_incident_created_owner_notification",
  IncidentNotePostedOwnerNotification:
    "oneuptime_incident_note_posted_owner_notification",
  IncidentStateChangedOwnerNotification:
    "oneuptime_incident_state_change_owner_notification",
  IncidentOwnerAddedNotification: "oneuptime_incident_owner_added_notification",
  AlertCreatedOwnerNotification: "oneuptime_alert_created_owner_notification",
  AlertNotePostedOwnerNotification:
    "oneuptime_alert_note_posted_owner_notification",
  AlertStateChangedOwnerNotification:
    "oneuptime_alert_state_changed_owner_notification",
  AlertOwnerAddedNotification: "oneuptime_alert_owner_added_notification",
  MonitorOwnerAddedNotification: "oneuptime_monitor_owner_added_notification",
  MonitorCreatedOwnerNotification:
    "oneuptime_monitor_created_owner_notification",
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
  OnCallUserIsOnRosterNotification:
    "oneuptime_oncall_user_is_on_roster_notification",
  OnCallUserIsNextNotification: "oneuptime_oncall_user_is_next_notification",
  OnCallUserAddedToPolicyNotification:
    "oneuptime_oncall_user_added_to_policy_notification",
  OnCallUserRemovedFromPolicyNotification:
    "oneuptime_oncall_user_removed_from_policy_notification",
  OnCallUserNoLongerActiveNotification:
    "oneuptime_oncall_user_no_longer_active_notification",
  AIAgentStatusChangedOwnerNotification:
    "oneuptime_ai_agent_status_changed_owner_notification",
  AIAgentOwnerAddedNotification: "oneuptime_ai_agent_owner_added_notification",
} as const;

export const WhatsAppTemplateIds: TemplateIdsMap = templateIds;

export type WhatsAppTemplateIdsDefinition = typeof WhatsAppTemplateIds;

export type WhatsAppTemplateIdsMap = WhatsAppTemplateIdsDefinition;

export type WhatsAppTemplateId =
  WhatsAppTemplateIdsDefinition[keyof WhatsAppTemplateIdsDefinition];

type WhatsAppTemplateMessagesDefinition = Readonly<
  Record<WhatsAppTemplateId, string>
>;

export const WhatsAppTemplateMessages: WhatsAppTemplateMessagesDefinition = {
  [WhatsAppTemplateIds.AlertCreated]: `A new alert #{{alert_number}} ({{alert_title}}) has been created for project {{project_name}}. To acknowledge this alert, open {{acknowledge_url}} to respond. For more information, please check out this alert {{alert_link}} on the OneUptime dashboard.`,
  [WhatsAppTemplateIds.IncidentCreated]: `A new incident #{{incident_number}} ({{incident_title}}) has been created for project {{project_name}}. To acknowledge this incident, open {{acknowledge_url}} to respond. For more information, please check out this incident {{incident_link}} on the OneUptime dashboard.`,
  [WhatsAppTemplateIds.VerificationCode]: `{{1}} is your verification code. For your security, do not share this code.`,
  [WhatsAppTemplateIds.TestNotification]: `This is a WhatsApp test message from OneUptime to verify your integration. No action is required.`,
  [WhatsAppTemplateIds.IncidentCreatedOwnerNotification]: `Incident #{{incident_number}} ({{incident_title}}) has been created for project {{project_name}}. View incident details using {{incident_link}} on the OneUptime dashboard for complete context.`,
  [WhatsAppTemplateIds.IncidentNotePostedOwnerNotification]: `A new note was posted on incident #{{incident_number}} ({{incident_title}}). Review the incident using {{incident_link}} on the OneUptime dashboard for more context.`,
  [WhatsAppTemplateIds.IncidentStateChangedOwnerNotification]: `Incident #{{incident_number}} ({{incident_title}}) state changed to {{incident_state}}. Track the incident status using {{incident_link}} on the OneUptime dashboard for more context.`,
  [WhatsAppTemplateIds.IncidentOwnerAddedNotification]: `You have been added as an owner of incident #{{incident_number}} ({{incident_title}}). Manage the incident using {{incident_link}} on the OneUptime dashboard.`,
  [WhatsAppTemplateIds.AlertCreatedOwnerNotification]: `Alert #{{alert_number}} ({{alert_title}}) has been created for project {{project_name}}. View alert details using {{alert_link}} on the OneUptime dashboard `,
  [WhatsAppTemplateIds.AlertNotePostedOwnerNotification]: `A new note was posted on alert #{{alert_number}} ({{alert_title}}). Review the alert using {{alert_link}} on the OneUptime dashboard for updates.`,
  [WhatsAppTemplateIds.AlertStateChangedOwnerNotification]: `Alert #{{alert_number}} ({{alert_title}}) state changed to {{alert_state}}. Track the alert status using {{alert_link}} on the OneUptime dashboard to stay informed.`,
  [WhatsAppTemplateIds.AlertOwnerAddedNotification]: `You have been added as an owner of alert #{{alert_number}} ({{alert_title}}). Manage the alert using {{alert_link}} on the OneUptime dashboard to take action.`,
  [WhatsAppTemplateIds.MonitorOwnerAddedNotification]: `You have been added as an owner of monitor {{monitor_name}}. Manage the monitor using {{monitor_link}} on the OneUptime dashboard to keep things running.`,
  [WhatsAppTemplateIds.MonitorCreatedOwnerNotification]: `Monitor {{monitor_name}} has been created. Check monitor {{monitor_link}} on the OneUptime dashboard `,
  [WhatsAppTemplateIds.MonitorStatusChangedOwnerNotification]: `Monitor {{monitor_name}} status changed to {{monitor_status}}. Check the monitor status using {{monitor_link}} on the OneUptime dashboard to stay informed.`,
  [WhatsAppTemplateIds.MonitorProbeStatusChangedNotification]: `Probes for monitor {{monitor_name}} are {{probe_status}}. Review probe details using {{monitor_link}} on the OneUptime dashboard for more insight.`,
  [WhatsAppTemplateIds.MonitorNoProbesMonitoringNotification]: `No probes are monitoring monitor {{monitor_name}}. Please check the monitor using {{monitor_link}} on the OneUptime dashboard to restore coverage.`,
  [WhatsAppTemplateIds.ScheduledMaintenanceCreatedOwnerNotification]: `Scheduled maintenance #{{event_number}} ({{event_title}}) has been created. View event details using {{maintenance_link}} on the OneUptime dashboard to prepare.`,
  [WhatsAppTemplateIds.ScheduledMaintenanceNotePostedOwnerNotification]: `A new note was posted on scheduled maintenance #{{event_number}} ({{event_title}}). Review the event using {{maintenance_link}} on the OneUptime dashboard for the latest updates.`,
  [WhatsAppTemplateIds.ScheduledMaintenanceOwnerAddedNotification]: `You have been added as an owner of scheduled maintenance #{{event_number}} ({{event_title}}). Please check the event using {{maintenance_link}} on the OneUptime dashboard.`,
  [WhatsAppTemplateIds.ScheduledMaintenanceStateChangedOwnerNotification]: `Scheduled maintenance #{{event_number}} ({{event_title}}) state changed to {{event_state}}. Track event status using {{maintenance_link}} on the OneUptime dashboard to stay aligned.`,
  [WhatsAppTemplateIds.StatusPageAnnouncementCreatedOwnerNotification]: `Announcement {{announcement_title}} was published on status page {{status_page_name}}. View the announcement using {{status_page_link}} on the OneUptime dashboard `,
  [WhatsAppTemplateIds.StatusPageCreatedOwnerNotification]: `Status page {{status_page_name}} has been created. View status page details using {{status_page_link}} on the OneUptime dashboard for full context.`,
  [WhatsAppTemplateIds.StatusPageOwnerAddedNotification]: `You have been added as an owner of status page {{status_page_name}}. Manage the status page using {{status_page_link}} on the OneUptime dashboard to stay engaged.`,
  [WhatsAppTemplateIds.ProbeStatusChangedOwnerNotification]: `Probe {{probe_name}} status is {{probe_status}}. Review the probe using {{probe_link}} on the OneUptime dashboard for specifics.`,
  [WhatsAppTemplateIds.ProbeOwnerAddedNotification]: `You have been added as an owner of probe {{probe_name}}. Manage the probe using {{probe_link}} on the OneUptime dashboard to take action.`,
  [WhatsAppTemplateIds.OnCallUserIsOnRosterNotification]: `You are now on-call for policy {{on_call_policy_name}} on schedule {{schedule_name}}. View the on-call schedule using {{schedule_link}} on the OneUptime dashboard to plan ahead.`,
  [WhatsAppTemplateIds.OnCallUserIsNextNotification]: `You are next on-call for policy {{on_call_policy_name}} on schedule {{schedule_name}}. Prepare for your shift using {{schedule_link}} on the OneUptime dashboard for the latest details.`,
  [WhatsAppTemplateIds.OnCallUserAddedToPolicyNotification]: `You have been added to on-call policy {{on_call_policy_name}} for {{on_call_context}}. Review the on-call policy using {{policy_link}} on the OneUptime dashboard for full guidelines.`,
  [WhatsAppTemplateIds.OnCallUserRemovedFromPolicyNotification]: `You have been removed from on-call policy {{on_call_policy_name}} for {{on_call_context}}. View on-call policies using {{policy_link}} on the OneUptime dashboard for updates.`,
  [WhatsAppTemplateIds.OnCallUserNoLongerActiveNotification]: `You are no longer on-call for policy {{on_call_policy_name}} on schedule {{schedule_name}}. Review your schedule using {{schedule_link}} on the OneUptime dashboard to stay informed.`,
  [WhatsAppTemplateIds.AIAgentStatusChangedOwnerNotification]: `AI Agent {{ai_agent_name}} status is {{ai_agent_status}}. Review the AI agent using {{ai_agent_link}} on the OneUptime dashboard for specifics.`,
  [WhatsAppTemplateIds.AIAgentOwnerAddedNotification]: `You have been added as an owner of AI Agent {{ai_agent_name}}. Manage the AI agent using {{ai_agent_link}} on the OneUptime dashboard to take action.`,
};

export const WhatsAppTemplateLanguage: Record<WhatsAppTemplateId, string> = {
  [WhatsAppTemplateIds.AlertCreated]: "en",
  [WhatsAppTemplateIds.IncidentCreated]: "en",
  [WhatsAppTemplateIds.VerificationCode]: "en",
  [WhatsAppTemplateIds.TestNotification]: "en",
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
  [WhatsAppTemplateIds.AIAgentStatusChangedOwnerNotification]: "en",
  [WhatsAppTemplateIds.AIAgentOwnerAddedNotification]: "en",
};

// Authentication templates that require OTP button components
export const AuthenticationTemplates: Set<WhatsAppTemplateId> = new Set([
  WhatsAppTemplateIds.VerificationCode,
]);

export function renderWhatsAppTemplate(
  templateId: WhatsAppTemplateId,
  variables: Record<string, string>,
): string {
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

    return variables[key] as string;
  });
}

export default WhatsAppTemplateMessages;
