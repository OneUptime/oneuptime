import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import {
  OnCallPageAgainNotice,
  getOnCallPageAgainNoticeReason,
} from "../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import {
  OnCallPersonPageNotice,
  getOnCallPersonPagePushBody,
  getOnCallPersonPagePushTitle,
} from "../../Types/OnCallDutyPolicy/OnCallPersonPage";

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

  /*
   * The push of a page a person asked for (OnCallPersonPage): who paged and
   * the record in the title - "Alice Kim paged you: Incident INC-42",
   * "Alice Kim paged Platform: Incident INC-42" - and its title, project
   * and the message they wrote in the body. Tapped, it opens the record,
   * and it carries the record's own type and data, as any page's push does.
   */
  private static getPersonPageNotification(data: {
    recordLabel: string;
    recordTitle: string;
    projectName: string;
    notice: OnCallPersonPageNotice;
    viewLink: string;
    tag: string;
    data: { [key: string]: unknown };
  }): PushNotificationMessage {
    return PushNotificationUtil.applyDefaults({
      title: getOnCallPersonPagePushTitle({
        recordLabel: data.recordLabel,
        notice: data.notice,
      }),
      body: `${getOnCallPersonPagePushBody({
        recordTitle: data.recordTitle,
        projectName: data.projectName,
        notice: data.notice,
      })} Click to view details.`,
      clickAction: data.viewLink,
      url: data.viewLink,
      tag: data.tag,
      requireInteraction: true,
      data: data.data,
    });
  }
  public static createIncidentCreatedNotification(params: {
    incidentTitle: string;
    projectName: string;
    incidentViewLink: string;
    incidentNumber?: number;
    incidentNumberWithPrefix?: string;
    incidentId?: string;
    projectId?: string;
    // A page again (OnCallAcknowledgementTimeout): says it is still not resolved.
    pageAgain?: OnCallPageAgainNotice | undefined;
    /*
     * A page a person asked for (OnCallPersonPage): says who paged, and
     * the message they wrote, instead of "A new incident has been created".
     */
    personPage?: OnCallPersonPageNotice | undefined;
  }): PushNotificationMessage {
    const {
      incidentTitle,
      projectName,
      incidentViewLink,
      incidentNumber,
      incidentNumberWithPrefix,
      incidentId,
      projectId,
    } = params;
    const displayNumber: string =
      incidentNumberWithPrefix || (incidentNumber ? `#${incidentNumber}` : "");
    const incidentIdentifier: string = displayNumber
      ? `${displayNumber} (${incidentTitle})`
      : incidentTitle;

    if (params.personPage) {
      return PushNotificationUtil.getPersonPageNotification({
        recordLabel: `Incident${displayNumber ? ` ${displayNumber}` : ""}`,
        recordTitle: incidentTitle,
        projectName: projectName,
        notice: params.personPage,
        viewLink: incidentViewLink,
        tag: "incident-created",
        data: {
          type: "incident-created",
          entityType: "incident",
          entityId: incidentId,
          projectId: projectId,
          incidentTitle: incidentTitle,
          projectName: projectName,
          url: incidentViewLink,
        },
      });
    }

    return PushNotificationUtil.applyDefaults({
      title: params.pageAgain
        ? `Incident${displayNumber ? ` ${displayNumber}` : ""} still not resolved: ${incidentTitle}`
        : `New Incident${displayNumber ? ` ${displayNumber}` : ""}: ${incidentTitle}`,
      body: params.pageAgain
        ? `Incident ${incidentIdentifier} in ${projectName} is ${getOnCallPageAgainNoticeReason(params.pageAgain)}. Click to view details.`
        : `A new incident has been created: ${incidentIdentifier} in ${projectName}. Click to view details.`,
      clickAction: incidentViewLink,
      url: incidentViewLink,
      tag: "incident-created",
      requireInteraction: true,
      data: {
        type: "incident-created",
        entityType: "incident",
        entityId: incidentId,
        projectId: projectId,
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
    incidentId?: string;
    projectId?: string;
  }): PushNotificationMessage {
    const {
      incidentTitle,
      projectName,
      newState,
      previousState,
      incidentViewLink,
      incidentNumber,
      incidentNumberWithPrefix,
      incidentId,
      projectId,
    } = params;
    const displayNumber: string =
      incidentNumberWithPrefix || (incidentNumber ? `#${incidentNumber}` : "");
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
        entityType: "incident",
        entityId: incidentId,
        projectId: projectId,
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
    incidentId?: string;
    projectId?: string;
  }): PushNotificationMessage {
    const {
      incidentTitle,
      projectName,
      isPrivateNote,
      incidentViewLink,
      incidentNumber,
      incidentNumberWithPrefix,
      incidentId,
      projectId,
    } = params;
    const noteType: string = isPrivateNote ? "Private" : "Public";
    const displayNumber: string =
      incidentNumberWithPrefix || (incidentNumber ? `#${incidentNumber}` : "");
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
        entityType: "incident",
        entityId: incidentId,
        projectId: projectId,
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
    alertId?: string;
    projectId?: string;
    // A page again (OnCallAcknowledgementTimeout): says it is still not resolved.
    pageAgain?: OnCallPageAgainNotice | undefined;
    /*
     * A page a person asked for (OnCallPersonPage): says who paged, and
     * the message they wrote, instead of "A new alert has been created".
     */
    personPage?: OnCallPersonPageNotice | undefined;
  }): PushNotificationMessage {
    const {
      alertTitle,
      projectName,
      alertViewLink,
      alertNumber,
      alertNumberWithPrefix,
      alertId,
      projectId,
    } = params;
    const displayNumber: string =
      alertNumberWithPrefix || (alertNumber ? `#${alertNumber}` : "");
    const alertIdentifier: string = displayNumber
      ? `${displayNumber} (${alertTitle})`
      : alertTitle;

    if (params.personPage) {
      return PushNotificationUtil.getPersonPageNotification({
        recordLabel: `Alert${displayNumber ? ` ${displayNumber}` : ""}`,
        recordTitle: alertTitle,
        projectName: projectName,
        notice: params.personPage,
        viewLink: alertViewLink,
        tag: "alert-created",
        data: {
          type: "alert-created",
          entityType: "alert",
          entityId: alertId,
          projectId: projectId,
          alertTitle: alertTitle,
          projectName: projectName,
          url: alertViewLink,
        },
      });
    }

    return PushNotificationUtil.applyDefaults({
      title: params.pageAgain
        ? `Alert${displayNumber ? ` ${displayNumber}` : ""} still not resolved: ${alertTitle}`
        : `New Alert${displayNumber ? ` ${displayNumber}` : ""}: ${alertTitle}`,
      body: params.pageAgain
        ? `Alert ${alertIdentifier} in ${projectName} is ${getOnCallPageAgainNoticeReason(params.pageAgain)}. Click to view details.`
        : `A new alert has been created: ${alertIdentifier} in ${projectName}. Click to view details.`,
      clickAction: alertViewLink,
      url: alertViewLink,
      tag: "alert-created",
      requireInteraction: true,
      data: {
        type: "alert-created",
        entityType: "alert",
        entityId: alertId,
        projectId: projectId,
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
    alertEpisodeId?: string;
    projectId?: string;
    // A page again (OnCallAcknowledgementTimeout): says it is still not resolved.
    pageAgain?: OnCallPageAgainNotice | undefined;
  }): PushNotificationMessage {
    const {
      alertEpisodeTitle,
      projectName,
      alertEpisodeViewLink,
      episodeNumber,
      episodeNumberWithPrefix,
      alertEpisodeId,
      projectId,
    } = params;
    const displayNumber: string =
      episodeNumberWithPrefix || (episodeNumber ? `#${episodeNumber}` : "");
    const episodeIdentifier: string = displayNumber
      ? `${displayNumber} (${alertEpisodeTitle})`
      : alertEpisodeTitle;
    return PushNotificationUtil.applyDefaults({
      title: params.pageAgain
        ? `Alert Episode${displayNumber ? ` ${displayNumber}` : ""} still not resolved: ${alertEpisodeTitle}`
        : `New Alert Episode${displayNumber ? ` ${displayNumber}` : ""}: ${alertEpisodeTitle}`,
      body: params.pageAgain
        ? `Alert Episode ${episodeIdentifier} in ${projectName} is ${getOnCallPageAgainNoticeReason(params.pageAgain)}. Click to view details.`
        : `A new alert episode has been created: ${episodeIdentifier} in ${projectName}. Click to view details.`,
      clickAction: alertEpisodeViewLink,
      url: alertEpisodeViewLink,
      tag: "alert-episode-created",
      requireInteraction: true,
      data: {
        type: "alert-episode-created",
        entityType: "alert-episode",
        entityId: alertEpisodeId,
        projectId: projectId,
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
    incidentEpisodeId?: string;
    projectId?: string;
    // A page again (OnCallAcknowledgementTimeout): says it is still not resolved.
    pageAgain?: OnCallPageAgainNotice | undefined;
  }): PushNotificationMessage {
    const {
      incidentEpisodeTitle,
      projectName,
      incidentEpisodeViewLink,
      episodeNumber,
      episodeNumberWithPrefix,
      incidentEpisodeId,
      projectId,
    } = params;
    const displayNumber: string =
      episodeNumberWithPrefix || (episodeNumber ? `#${episodeNumber}` : "");
    const episodeIdentifier: string = displayNumber
      ? `${displayNumber} (${incidentEpisodeTitle})`
      : incidentEpisodeTitle;
    return PushNotificationUtil.applyDefaults({
      title: params.pageAgain
        ? `Incident Episode${displayNumber ? ` ${displayNumber}` : ""} still not resolved: ${incidentEpisodeTitle}`
        : `New Incident Episode${displayNumber ? ` ${displayNumber}` : ""}: ${incidentEpisodeTitle}`,
      body: params.pageAgain
        ? `Incident Episode ${episodeIdentifier} in ${projectName} is ${getOnCallPageAgainNoticeReason(params.pageAgain)}. Click to view details.`
        : `A new incident episode has been created: ${episodeIdentifier} in ${projectName}. Click to view details.`,
      clickAction: incidentEpisodeViewLink,
      url: incidentEpisodeViewLink,
      tag: "incident-episode-created",
      requireInteraction: true,
      data: {
        type: "incident-episode-created",
        entityType: "incident-episode",
        entityId: incidentEpisodeId,
        projectId: projectId,
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
    monitorId?: string;
    projectId?: string;
  }): PushNotificationMessage {
    const {
      monitorName,
      projectName,
      newStatus,
      previousStatus,
      monitorViewLink,
      monitorId,
      projectId,
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
        entityType: "monitor",
        entityId: monitorId,
        projectId: projectId,
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
    scheduledMaintenanceId?: string;
    projectId?: string;
  }): PushNotificationMessage {
    const {
      title,
      projectName,
      state,
      viewLink,
      scheduledMaintenanceNumber,
      scheduledMaintenanceNumberWithPrefix,
      scheduledMaintenanceId,
      projectId,
    } = params;
    const displayNumber: string =
      scheduledMaintenanceNumberWithPrefix ||
      (scheduledMaintenanceNumber ? `#${scheduledMaintenanceNumber}` : "");
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
        entityType: "scheduled-maintenance",
        entityId: scheduledMaintenanceId,
        projectId: projectId,
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

  /*
   * One push per probe transition for the monitors it took down (or brought
   * back), instead of one per monitor. The tag is shared by both directions,
   * so on web push a reconnect replaces the disconnect it resolves.
   */
  public static createProbeMonitorsStatusNotification(params: {
    probeName: string;
    projectName: string;
    connectionStatus: string;
    monitorCount: number;
    // One sentence: probe, count and project.
    summary: string;
    clickAction?: string;
  }): PushNotificationMessage {
    const {
      probeName,
      projectName,
      connectionStatus,
      monitorCount,
      summary,
      clickAction,
    } = params;
    const notification: Partial<PushNotificationMessage> = {
      title: `Probe ${connectionStatus}: ${probeName}`,
      body: summary,
      tag: "probe-monitors-status",
      requireInteraction: false,
      data: {
        type: "probe-monitors-status",
        probeName: probeName,
        projectName: projectName,
        connectionStatus: connectionStatus,
        monitorCount: monitorCount.toString(),
      },
    };

    if (clickAction) {
      notification.clickAction = clickAction;
      notification.url = clickAction;
      notification.data!["url"] = clickAction;
    }

    return PushNotificationUtil.applyDefaults(notification);
  }

  /*
   * A security case that needs the person: it opened or rose at their
   * priority, it was assigned to them or their team, or one of its playbook
   * steps waits for their approval (SecurityCaseNotifications). The On-Call
   * app (1.7.0 and later) opens the case's own screen from entityType,
   * entityId and projectId; an older one opens on its last screen. The link
   * opens the case in the browser.
   */
  public static createSecurityCaseNotification(params: {
    title: string;
    body: string;
    caseViewLink: string;
    // security-case-opened, security-case-assigned, security-playbook-approval
    type: string;
    securityCaseId: string;
    projectId: string;
    requireInteraction: boolean;
  }): PushNotificationMessage {
    return PushNotificationUtil.applyDefaults({
      title: params.title,
      body: params.body,
      clickAction: params.caseViewLink,
      url: params.caseViewLink,
      // One per case: a newer page about the case replaces the older one.
      tag: `security-case-${params.securityCaseId}`,
      requireInteraction: params.requireInteraction,
      data: {
        type: params.type,
        entityType: "security-case",
        entityId: params.securityCaseId,
        projectId: params.projectId,
        url: params.caseViewLink,
      },
    });
  }

  /*
   * A scheduled hunt found security events: opens the hunt's page on the
   * window its run read. One per hunt: a newer run's replaces the older.
   */
  public static createSecurityHuntNotification(params: {
    title: string;
    body: string;
    huntViewLink: string;
    securityHuntId: string;
    projectId: string;
  }): PushNotificationMessage {
    return PushNotificationUtil.applyDefaults({
      title: params.title,
      body: params.body,
      clickAction: params.huntViewLink,
      url: params.huntViewLink,
      tag: `security-hunt-${params.securityHuntId}`,
      requireInteraction: false,
      data: {
        type: "security-hunt-found",
        entityType: "security-hunt",
        entityId: params.securityHuntId,
        projectId: params.projectId,
        url: params.huntViewLink,
      },
    });
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
