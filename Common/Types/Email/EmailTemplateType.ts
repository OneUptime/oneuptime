enum EmailTemplateType {
    SIGNUP_EMAIL = 'Signup Email',
    SUBSCRIBER_INCIDENT_CREATED = 'Subscriber Incident Created',
    SUBSCRIBER_INCIDENT_ACKNOWLEDGED = 'Subscriber Incident Acknowledged',
    SUBSCRIBER_INCIDENT_RESOLVED ='Subscriber Incident Resolved',
    INVESTIGATION_NOTE_CREATED = 'Investigation Note Created',
    SUBSCRIBER_SCHEDULED_MAINTENANCE_CREATED = 'Subscriber Scheduled Maintenance Created',
    SUBSCRIBER_SCHEDULED_MAINTENANCE_NOTE_CREATED = 'Subscriber Scheduled Maintenance Note Created',
    SUBSCRIBER_SCHEDULED_MAINTENANCE_RESOLVED = 'Subscriber Scheduled Maintenance Resolved',
    SUBSCRIBER_SCHEDULED_MAINTENANCE_CANCELLED = 'Subscriber Scheduled Maintenance Cancelled',
    SUBSCRIBER_ANNOUNCEMENT_NOTIFICATION_CREATED = 'Subscriber Announcement Notification Created'
}

export default EmailTemplateType;
