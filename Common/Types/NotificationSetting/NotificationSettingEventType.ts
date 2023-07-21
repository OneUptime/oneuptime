enum NotificationSettingEventType {

    // Incident
    SEND_INCIDENT_CREATED_OWNER_NOTIFICATION = "Send incident created notification when I am the owner of the incident",
    SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION = "Send incident note posted notification when I am the owner of the incident",
    SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION = "Send incident state changed notification when I am the owner of the incident",
    SEND_INCIDENT_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the incident",

    // Monitors
    SEND_MONITOR_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the monitor",
    SEND_MONITOR_CREATED_OWNER_NOTIFICATION = "Send monitor created notification when I am the owner of the monitor", 
    SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION = "Send monitor status changed notification when I am the owner of the monitor",

    // Scheduled Maintenance
    SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION = "Send scheduled maintenance created notification when I am the owner of the scheduled maintenance",
    SEND_SCHEDULED_MAINTENANCE_NOTE_POSTED_OWNER_NOTIFICATION = "Send scheduled maintenance note posted notification when I am the owner of the scheduled maintenance",
    SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the scheduled maintenance",
    SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION = "Send scheduled maintenance state changed notification when I am the owner of the scheduled maintenance",

    // Status Page
    SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION = "Send status page announcement created notification when I am the owner of the status page",
    SEND_STATUS_PAGE_CREATED_OWNER_NOTIFICATION = "Send status page created notification when I am the owner of the status page",
    SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the status page",
}

export default NotificationSettingEventType;
