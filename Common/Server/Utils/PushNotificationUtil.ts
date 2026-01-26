import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";

export default class PushNotificationUtil {
  public static readonly DEFAULT_ICON =
    "/dashboard/assets/img/OneUptimePNG/1.png";
  public static readonly DEFAULT_BADGE =
    "/dashboard/assets/img/OneUptimePNG/6.png";

  private static applyDefaults(
    notification: Partial<PushNotificationMessage>,
  ): PushNotificationMessage {
    return {
      icon: PushNotificationUtil.DEFAULT_ICON,
      badge: PushNotificationUtil.DEFAULT_BADGE,
      ...notification,
    } as PushNotificationMessage;
  }
  public static createIncidentCreatedNotification(params: {
    incidentTitle: string;
    projectName: string;
    incidentViewLink: string;
  }): PushNotificationMessage {
    const { incidentTitle, projectName, incidentViewLink } = params;
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

  public static createIncidentStateChangedNotification(params: {
    incidentTitle: string;
    projectName: string;
    newState: string;
    previousState?: string;
    incidentViewLink: string;
  }): PushNotificationMessage {
    const {
      incidentTitle,
      projectName,
      newState,
      previousState,
      incidentViewLink,
    } = params;
    const stateChangeText: string = previousState
      ? `Incident state changed from ${previousState} to ${newState}`
      : `Incident state changed to ${newState}`;
    return PushNotificationUtil.applyDefaults({
      title: `Incident Updated: ${incidentTitle}`,
      body: `${stateChangeText} in ${projectName}. Click to view details.`,
      clickAction: incidentViewLink,
      url: incidentViewLink,
      tag: "incident-state-changed",
      requireInteraction: true,
      data: {
        type: "incident-state-changed",
        incidentTitle: incidentTitle,
        projectName: projectName,
        newState: newState,
        previousState: previousState,
        url: incidentViewLink,
      },
    });
  }

  public static createIncidentNotePostedNotification(params: {
    incidentTitle: string;
    projectName: string;
    isPrivateNote: boolean;
    incidentViewLink: string;
  }): PushNotificationMessage {
    const { incidentTitle, projectName, isPrivateNote, incidentViewLink } =
      params;
    const noteType: string = isPrivateNote ? "Private" : "Public";
    return PushNotificationUtil.applyDefaults({
      title: `${noteType} Note Added: ${incidentTitle}`,
      body: `A ${noteType.toLowerCase()} note has been posted on incident in ${projectName}. Click to view details.`,
      clickAction: incidentViewLink,
      url: incidentViewLink,
      tag: "incident-note-posted",
      requireInteraction: true,
      data: {
        type: "incident-note-posted",
        incidentTitle: incidentTitle,
        projectName: projectName,
        isPrivateNote: isPrivateNote,
        url: incidentViewLink,
      },
    });
  }

  public static createAlertCreatedNotification(params: {
    alertTitle: string;
    projectName: string;
    alertViewLink: string;
  }): PushNotificationMessage {
    const { alertTitle, projectName, alertViewLink } = params;
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

  public static createAlertEpisodeCreatedNotification(params: {
    alertEpisodeTitle: string;
    projectName: string;
    alertEpisodeViewLink: string;
  }): PushNotificationMessage {
    const { alertEpisodeTitle, projectName, alertEpisodeViewLink } = params;
    return PushNotificationUtil.applyDefaults({
      title: `New Alert Episode: ${alertEpisodeTitle}`,
      body: `A new alert episode has been created in ${projectName}. Click to view details.`,
      clickAction: alertEpisodeViewLink,
      url: alertEpisodeViewLink,
      tag: "alert-episode-created",
      requireInteraction: true,
      data: {
        type: "alert-episode-created",
        alertEpisodeTitle: alertEpisodeTitle,
        projectName: projectName,
        url: alertEpisodeViewLink,
      },
    });
  }

  public static createMonitorStatusChangedNotification(params: {
    monitorName: string;
    projectName: string;
    newStatus: string;
    previousStatus?: string;
    monitorViewLink: string;
  }): PushNotificationMessage {
    const {
      monitorName,
      projectName,
      newStatus,
      previousStatus,
      monitorViewLink,
    } = params;
    const statusChangeText: string = previousStatus
      ? `Monitor status changed from ${previousStatus} to ${newStatus}`
      : `Monitor status changed to ${newStatus}`;
    return PushNotificationUtil.applyDefaults({
      title: `Monitor ${newStatus}: ${monitorName}`,
      body: `${statusChangeText} in ${projectName}. Click to view details.`,
      clickAction: monitorViewLink,
      url: monitorViewLink,
      tag: "monitor-status-changed",
      requireInteraction: true,
      data: {
        type: "monitor-status-changed",
        monitorName: monitorName,
        projectName: projectName,
        newStatus: newStatus,
        previousStatus: previousStatus,
        url: monitorViewLink,
      },
    });
  }

  public static createScheduledMaintenanceNotification(params: {
    title: string;
    projectName: string;
    state: string;
    viewLink: string;
  }): PushNotificationMessage {
    const { title, projectName, state, viewLink } = params;
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

  public static createGenericNotification(params: {
    title: string;
    body: string;
    clickAction?: string;
    tag?: string;
    requireInteraction?: boolean;
  }): PushNotificationMessage {
    const {
      title,
      body,
      clickAction,
      tag,
      requireInteraction = false,
    } = params;
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

  public static createMonitorProbeStatusNotification(params: {
    title: string;
    body: string;
    tag: string;
    monitorId: string;
    monitorName: string;
  }): PushNotificationMessage {
    const { title, body, tag, monitorId, monitorName } = params;
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

  public static createMonitorCreatedNotification(params: {
    monitorName: string;
    monitorId: string;
  }): PushNotificationMessage {
    const { monitorName, monitorId } = params;
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

  public static createOnCallPolicyAddedNotification(params: {
    policyName: string;
  }): PushNotificationMessage {
    const { policyName } = params;
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

  public static createOnCallPolicyRemovedNotification(params: {
    policyName: string;
  }): PushNotificationMessage {
    const { policyName } = params;
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

  public static createProbeDisconnectedNotification(params: {
    probeName: string;
  }): PushNotificationMessage {
    const { probeName } = params;
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

  public static createProbeStatusChangedNotification(params: {
    probeName: string;
    projectName: string;
    connectionStatus: string;
    clickAction?: string;
  }): PushNotificationMessage {
    const { probeName, projectName, connectionStatus, clickAction } = params;
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

  public static createAIAgentStatusChangedNotification(params: {
    aiAgentName: string;
    projectName: string;
    connectionStatus: string;
    clickAction?: string;
  }): PushNotificationMessage {
    const { aiAgentName, projectName, connectionStatus, clickAction } = params;
    const notification: Partial<PushNotificationMessage> = {
      title: `AI Agent ${connectionStatus}: ${aiAgentName}`,
      body: `AI Agent ${aiAgentName} is ${connectionStatus} in ${projectName}. Click to view details.`,
      tag: "ai-agent-status-changed",
      requireInteraction: true,
      data: {
        type: "ai-agent-status-changed",
        aiAgentName: aiAgentName,
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
