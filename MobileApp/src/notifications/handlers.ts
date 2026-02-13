import type { NotificationResponse } from "expo-notifications";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let navigationRef: any = null;

export function setNavigationRef(ref: unknown): void {
  navigationRef = ref;
}

interface NotificationData {
  entityType?: string;
  entityId?: string;
  projectId?: string;
  [key: string]: any;
}

function navigateToEntity(data: NotificationData): void {
  if (!navigationRef?.isReady() || !data.entityType || !data.entityId) {
    return;
  }

  const projectId: string = data.projectId ?? "";

  switch (data.entityType) {
    case "incident":
      navigationRef.navigate("Incidents", {
        screen: "IncidentDetail",
        params: { incidentId: data.entityId, projectId },
      });
      break;
    case "alert":
      navigationRef.navigate("Alerts", {
        screen: "AlertDetail",
        params: { alertId: data.entityId, projectId },
      });
      break;
    case "incident-episode":
      navigationRef.navigate("Incidents", {
        screen: "IncidentEpisodeDetail",
        params: { episodeId: data.entityId, projectId },
      });
      break;
    case "alert-episode":
      navigationRef.navigate("Alerts", {
        screen: "AlertEpisodeDetail",
        params: { episodeId: data.entityId, projectId },
      });
      break;
    default:
      break;
  }
}

export function handleNotificationResponse(
  response: NotificationResponse,
): void {
  const data: NotificationData =
    (response.notification.request.content.data as NotificationData) || {};
  const actionId: string = response.actionIdentifier;

  if (actionId === "ACKNOWLEDGE") {
    // Background acknowledge — could call API here in the future
    return;
  }

  // Default tap or VIEW action — navigate to entity
  navigateToEntity(data);
}
