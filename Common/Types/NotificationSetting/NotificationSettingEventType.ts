enum NotificationSettingEventType {

    // Incident
    SEND_INCIDENT_CREATED_OWNER_NOTIFICATION = "Send Incident Created Owner Notification",
    SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION = "Send Incident Note Posted Owner Notification",
    SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION = "Send Incident State Changed Owner Notification",
    SEND_INCIDENT_OWNER_ADDED_NOTIFICATION = "Send Incident Owner Added Notification",

    // Monitors
    SEND_MONITOR_OWNER_ADDED_NOTIFICATION = "Send Monitor Owner Added Notification",
    SEND_MONITOR_CREATED_OWNER_NOTIFICATION = "Send Monitor Created Owner Notification",
    SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION = "Send Monitor Status Changed Owner Notification",

    // Scheduled Maintenance
    SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION = "Send Scheduled Maintenance Created Owner Notification",
    SEND_SCHEDULED_MAINTENANCE_NOTE_POSTED_OWNER_NOTIFICATION = "Send Scheduled Maintenance Note Posted Owner Notification",
    SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION = "Send Scheduled Maintenance Owner Added Notification",
    SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION = "Send Scheduled Maintenance State Changed Owner Notification",

    // Status Page
    SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION = "Send Status Page Announcement Created Owner Notification",
    SEND_STATUS_PAGE_CREATED_OWNER_NOTIFICATION = "Send Status Page Created Owner Notification",
    SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION = "Send Status Page Owner Added Notification",
}

export default NotificationSettingEventType;
