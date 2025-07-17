import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";

export default class PushNotificationUtil {
  public static readonly DEFAULT_ICON = "/dashboard/assets/img/OneUptimePNG/1.png";
  public static readonly DEFAULT_BADGE = "/dashboard/assets/img/OneUptimePNG/6.png";

  private static applyDefaults(
    notification: Partial<PushNotificationMessage>,
  ): PushNotificationMessage {
    return {
      icon: PushNotificationUtil.DEFAULT_ICON,
      badge: PushNotificationUtil.DEFAULT_BADGE,
      ...notification,
    } as PushNotificationMessage;
  }
  public static createIncidentCreatedNotification(
    incidentTitle: string,
    projectName: string,
    incidentViewLink: string,
  ): PushNotificationMessage {
    return PushNotificationUtil.applyDefaults({
      title: `New Incident: ${incidentTitle}`,
      body: `A new incident has been created in ${projectName}. Click to view details.`,
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
    });
  }

  public static createIncidentStateChangedNotification(
    incidentTitle: string,
    projectName: string,
    newState: string,
    incidentViewLink: string,
  ): PushNotificationMessage {
    return PushNotificationUtil.applyDefaults({
      title: `Incident Updated: ${incidentTitle}`,
      body: `Incident state changed to ${newState} in ${projectName}. Click to view details.`,
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
    });
  }

  public static createAlertCreatedNotification(
    alertTitle: string,
    projectName: string,
    alertViewLink: string,
  ): PushNotificationMessage {
    return PushNotificationUtil.applyDefaults({
      title: `New Alert: ${alertTitle}`,
      body: `A new alert has been created in ${projectName}. Click to view details.`,
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
    });
  }

  public static createMonitorStatusChangedNotification(
    monitorName: string,
    projectName: string,
    newStatus: string,
    monitorViewLink: string,
  ): PushNotificationMessage {
    return PushNotificationUtil.applyDefaults({
      title: `Monitor ${newStatus}: ${monitorName}`,
      body: `Monitor status changed to ${newStatus} in ${projectName}. Click to view details.`,
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
    });
  }

  public static createScheduledMaintenanceNotification(
    title: string,
    projectName: string,
    state: string,
    viewLink: string,
  ): PushNotificationMessage {
    return PushNotificationUtil.applyDefaults({
      title: `Scheduled Maintenance ${state}: ${title}`,
      body: `Scheduled maintenance ${state.toLowerCase()} in ${projectName}. Click to view details.`,
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
    });
  }

  public static createGenericNotification(
    title: string,
    body: string,
    clickAction?: string,
    tag?: string,
    requireInteraction: boolean = false,
  ): PushNotificationMessage {
    const notification: Partial<PushNotificationMessage> = {
      title: title,
      body: body,
      tag: tag || "OneUptime",
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

    return PushNotificationUtil.applyDefaults(notification);
  }

  public static createMonitorProbeStatusNotification(
    title: string,
    body: string,
    tag: string,
    monitorId: string,
    monitorName: string,
  ): PushNotificationMessage {
    return PushNotificationUtil.applyDefaults({
      title: title,
      body: body,
      tag: tag,
      requireInteraction: false,
      data: {
        type: "monitor-probe-status",
        monitorId: monitorId,
        monitorName: monitorName,
      },
    });
  }

  public static createMonitorCreatedNotification(
    monitorName: string,
    monitorId: string,
  ): PushNotificationMessage {
    return PushNotificationUtil.applyDefaults({
      title: "OneUptime: New Monitor Created",
      body: `New monitor was created: ${monitorName}`,
      tag: "monitor-created",
      requireInteraction: false,
      data: {
        type: "monitor-created",
        monitorId: monitorId,
        monitorName: monitorName,
      },
    });
  }

  public static createOnCallPolicyAddedNotification(
    policyName: string,
  ): PushNotificationMessage {
    return PushNotificationUtil.applyDefaults({
      title: "Added to On-Call Policy",
      body: `You have been added to the on-call duty policy ${policyName}.`,
      tag: "on-call-policy-added",
      requireInteraction: false,
      data: {
        type: "on-call-policy-added",
        policyName: policyName,
      },
    });
  }

  public static createOnCallPolicyRemovedNotification(
    policyName: string,
  ): PushNotificationMessage {
    return PushNotificationUtil.applyDefaults({
      title: "Removed from On-Call Policy",
      body: `You have been removed from the on-call duty policy ${policyName}.`,
      tag: "on-call-policy-removed",
      requireInteraction: false,
      data: {
        type: "on-call-policy-removed",
        policyName: policyName,
      },
    });
  }

  public static createProbeDisconnectedNotification(
    probeName: string,
  ): PushNotificationMessage {
    return PushNotificationUtil.applyDefaults({
      title: "OneUptime: Probe Disconnected",
      body: `Your probe ${probeName} is disconnected. It was last seen 5 minutes ago.`,
      tag: "probe-disconnected",
      requireInteraction: false,
      data: {
        type: "probe-disconnected",
        probeName: probeName,
      },
    });
  }

  public static createProbeStatusChangedNotification(
    probeName: string,
    projectName: string,
    connectionStatus: string,
    clickAction?: string,
  ): PushNotificationMessage {
    const notification: Partial<PushNotificationMessage> = {
      title: `Probe ${connectionStatus}: ${probeName}`,
      body: `Probe ${probeName} is ${connectionStatus} in ${projectName}. Click to view details.`,
      tag: "probe-status-changed",
      requireInteraction: true,
      data: {
        type: "probe-status-changed",
        probeName: probeName,
        projectName: projectName,
        connectionStatus: connectionStatus,
      },
    };

    if (clickAction) {
      notification.clickAction = clickAction;
      notification.url = clickAction;
      notification.data!["url"] = clickAction;
    }

    return PushNotificationUtil.applyDefaults(notification);
  }
}
