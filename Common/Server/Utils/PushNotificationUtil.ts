import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";

export default class PushNotificationUtil {
  public static createIncidentCreatedNotification(
    incidentTitle: string,
    projectName: string,
    incidentViewLink: string,
  ): PushNotificationMessage {
    return {
      title: `New Incident: ${incidentTitle}`,
      body: `A new incident has been created in ${projectName}. Click to view details.`,
      icon: "/icon-192x192.png",
      badge: "/badge-72x72.png",
      clickAction: incidentViewLink,
      url: incidentViewLink,
      tag: "incident-created",
      requireInteraction: true,
      data: {
        type: "incident-created",
        incidentTitle: incidentTitle,
        projectName: projectName,
        url: incidentViewLink,
      },
    };
  }

  public static createIncidentStateChangedNotification(
    incidentTitle: string,
    projectName: string,
    newState: string,
    incidentViewLink: string,
  ): PushNotificationMessage {
    return {
      title: `Incident Updated: ${incidentTitle}`,
      body: `Incident state changed to ${newState} in ${projectName}. Click to view details.`,
      icon: "/icon-192x192.png",
      badge: "/badge-72x72.png",
      clickAction: incidentViewLink,
      url: incidentViewLink,
      tag: "incident-state-changed",
      requireInteraction: true,
      data: {
        type: "incident-state-changed",
        incidentTitle: incidentTitle,
        projectName: projectName,
        newState: newState,
        url: incidentViewLink,
      },
    };
  }

  public static createAlertCreatedNotification(
    alertTitle: string,
    projectName: string,
    alertViewLink: string,
  ): PushNotificationMessage {
    return {
      title: `New Alert: ${alertTitle}`,
      body: `A new alert has been created in ${projectName}. Click to view details.`,
      icon: "/icon-192x192.png",
      badge: "/badge-72x72.png",
      clickAction: alertViewLink,
      url: alertViewLink,
      tag: "alert-created",
      requireInteraction: true,
      data: {
        type: "alert-created",
        alertTitle: alertTitle,
        projectName: projectName,
        url: alertViewLink,
      },
    };
  }

  public static createMonitorStatusChangedNotification(
    monitorName: string,
    projectName: string,
    newStatus: string,
    monitorViewLink: string,
  ): PushNotificationMessage {
    return {
      title: `Monitor ${newStatus}: ${monitorName}`,
      body: `Monitor status changed to ${newStatus} in ${projectName}. Click to view details.`,
      icon: "/icon-192x192.png",
      badge: "/badge-72x72.png",
      clickAction: monitorViewLink,
      url: monitorViewLink,
      tag: "monitor-status-changed",
      requireInteraction: true,
      data: {
        type: "monitor-status-changed",
        monitorName: monitorName,
        projectName: projectName,
        newStatus: newStatus,
        url: monitorViewLink,
      },
    };
  }

  public static createScheduledMaintenanceNotification(
    title: string,
    projectName: string,
    state: string,
    viewLink: string,
  ): PushNotificationMessage {
    return {
      title: `Scheduled Maintenance ${state}: ${title}`,
      body: `Scheduled maintenance ${state.toLowerCase()} in ${projectName}. Click to view details.`,
      icon: "/icon-192x192.png",
      badge: "/badge-72x72.png",
      clickAction: viewLink,
      url: viewLink,
      tag: "scheduled-maintenance",
      requireInteraction: false,
      data: {
        type: "scheduled-maintenance",
        title: title,
        projectName: projectName,
        state: state,
        url: viewLink,
      },
    };
  }

  public static createGenericNotification(
    title: string,
    body: string,
    clickAction?: string,
    tag?: string,
    requireInteraction: boolean = false,
  ): PushNotificationMessage {
    const notification: PushNotificationMessage = {
      title: title,
      body: body,
      icon: "/icon-192x192.png",
      badge: "/badge-72x72.png",
      tag: tag || "oneuptime-notification",
      requireInteraction: requireInteraction,
      data: {
        type: "generic",
      },
    };

    if (clickAction) {
      notification.clickAction = clickAction;
      notification.url = clickAction;
      notification.data!["url"] = clickAction;
    }

    return notification;
  }
}
