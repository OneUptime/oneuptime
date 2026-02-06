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
    incidentNumber?: number;
    incidentNumberWithPrefix?: string;
  }): PushNotificationMessage {
    const { incidentTitle, projectName, incidentViewLink, incidentNumber, incidentNumberWithPrefix } =
      params;
    const displayNumber: string = incidentNumberWithPrefix || (incidentNumber ? `#${incidentNumber}` : "");
    const incidentIdentifier: string = displayNumber
      ? `${displayNumber} (${incidentTitle})`
      : incidentTitle;
    return PushNotificationUtil.applyDefaults({
      title: `New Incident${displayNumber ? ` ${displayNumber}` : ""}: ${incidentTitle}`,
      body: `A new incident has been created: ${incidentIdentifier} in ${projectName}. Click to view details.`,
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
    incidentNumber?: number;
    incidentNumberWithPrefix?: string;
  }): PushNotificationMessage {
    const {
      incidentTitle,
      projectName,
      newState,
      previousState,
      incidentViewLink,
      incidentNumber,
      incidentNumberWithPrefix,
    } = params;
    const displayNumber: string = incidentNumberWithPrefix || (incidentNumber ? `#${incidentNumber}` : "");
    const incidentIdentifier: string = displayNumber
      ? `${displayNumber} (${incidentTitle})`
      : incidentTitle;
    const stateChangeText: string = previousState
      ? `Incident ${incidentIdentifier} state changed from ${previousState} to ${newState}`
      : `Incident ${incidentIdentifier} state changed to ${newState}`;
    return PushNotificationUtil.applyDefaults({
      title: `Incident${displayNumber ? ` ${displayNumber}` : ""} Updated: ${incidentTitle}`,
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
    incidentNumber?: number;
    incidentNumberWithPrefix?: string;
  }): PushNotificationMessage {
    const {
      incidentTitle,
      projectName,
      isPrivateNote,
      incidentViewLink,
      incidentNumber,
      incidentNumberWithPrefix,
    } = params;
    const noteType: string = isPrivateNote ? "Private" : "Public";
    const displayNumber: string = incidentNumberWithPrefix || (incidentNumber ? `#${incidentNumber}` : "");
    const incidentIdentifier: string = displayNumber
      ? `${displayNumber} (${incidentTitle})`
      : incidentTitle;
    return PushNotificationUtil.applyDefaults({
      title: `${noteType} Note Added: Incident${displayNumber ? ` ${displayNumber}` : ""} - ${incidentTitle}`,
      body: `A ${noteType.toLowerCase()} note has been posted on incident ${incidentIdentifier} in ${projectName}. Click to view details.`,
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
    alertNumber?: number;
    alertNumberWithPrefix?: string;
  }): PushNotificationMessage {
    const { alertTitle, projectName, alertViewLink, alertNumber, alertNumberWithPrefix } = params;
    const displayNumber: string = alertNumberWithPrefix || (alertNumber ? `#${alertNumber}` : "");
    const alertIdentifier: string = displayNumber
      ? `${displayNumber} (${alertTitle})`
      : alertTitle;
    return PushNotificationUtil.applyDefaults({
      title: `New Alert${displayNumber ? ` ${displayNumber}` : ""}: ${alertTitle}`,
      body: `A new alert has been created: ${alertIdentifier} in ${projectName}. Click to view details.`,
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
    episodeNumber?: number;
    episodeNumberWithPrefix?: string;
  }): PushNotificationMessage {
    const {
      alertEpisodeTitle,
      projectName,
      alertEpisodeViewLink,
      episodeNumber,
      episodeNumberWithPrefix,
    } = params;
    const displayNumber: string = episodeNumberWithPrefix || (episodeNumber ? `#${episodeNumber}` : "");
    const episodeIdentifier: string = displayNumber
      ? `${displayNumber} (${alertEpisodeTitle})`
      : alertEpisodeTitle;
    return PushNotificationUtil.applyDefaults({
      title: `New Alert Episode${displayNumber ? ` ${displayNumber}` : ""}: ${alertEpisodeTitle}`,
      body: `A new alert episode has been created: ${episodeIdentifier} in ${projectName}. Click to view details.`,
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

  public static createIncidentEpisodeCreatedNotification(params: {
    incidentEpisodeTitle: string;
    projectName: string;
    incidentEpisodeViewLink: string;
    episodeNumber?: number;
    episodeNumberWithPrefix?: string;
  }): PushNotificationMessage {
    const {
      incidentEpisodeTitle,
      projectName,
      incidentEpisodeViewLink,
      episodeNumber,
      episodeNumberWithPrefix,
    } = params;
    const displayNumber: string = episodeNumberWithPrefix || (episodeNumber ? `#${episodeNumber}` : "");
    const episodeIdentifier: string = displayNumber
      ? `${displayNumber} (${incidentEpisodeTitle})`
      : incidentEpisodeTitle;
    return PushNotificationUtil.applyDefaults({
      title: `New Incident Episode${displayNumber ? ` ${displayNumber}` : ""}: ${incidentEpisodeTitle}`,
      body: `A new incident episode has been created: ${episodeIdentifier} in ${projectName}. Click to view details.`,
      clickAction: incidentEpisodeViewLink,
      url: incidentEpisodeViewLink,
      tag: "incident-episode-created",
      requireInteraction: true,
      data: {
        type: "incident-episode-created",
        incidentEpisodeTitle: incidentEpisodeTitle,
        projectName: projectName,
        url: incidentEpisodeViewLink,
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
    scheduledMaintenanceNumber?: number;
    scheduledMaintenanceNumberWithPrefix?: string;
  }): PushNotificationMessage {
    const { title, projectName, state, viewLink, scheduledMaintenanceNumber, scheduledMaintenanceNumberWithPrefix } =
      params;
    const displayNumber: string = scheduledMaintenanceNumberWithPrefix || (scheduledMaintenanceNumber ? `#${scheduledMaintenanceNumber}` : "");
    const maintenanceIdentifier: string = displayNumber
      ? `${displayNumber} (${title})`
      : title;
    return PushNotificationUtil.applyDefaults({
      title: `Scheduled Maintenance${displayNumber ? ` ${displayNumber}` : ""} ${state}: ${title}`,
      body: `Scheduled maintenance ${maintenanceIdentifier} ${state.toLowerCase()} in ${projectName}. Click to view details.`,
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
