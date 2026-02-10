import type { NavigationContainerRef } from "@react-navigation/native";
import type { NotificationResponse } from "expo-notifications";

type RootParamList = Record<string, object | undefined>;

let navigationRef: NavigationContainerRef<RootParamList> | null = null;

export function setNavigationRef(
  ref: NavigationContainerRef<RootParamList>,
): void {
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

  switch (data.entityType) {
    case "incident":
      navigationRef.navigate("Incidents" as never, {
        screen: "IncidentDetail",
        params: { incidentId: data.entityId },
      } as never);
      break;
    case "alert":
      navigationRef.navigate("Alerts" as never, {
        screen: "AlertDetail",
        params: { alertId: data.entityId },
      } as never);
      break;
    case "incident-episode":
      navigationRef.navigate("IncidentEpisodes" as never, {
        screen: "IncidentEpisodeDetail",
        params: { episodeId: data.entityId },
      } as never);
      break;
    case "alert-episode":
      navigationRef.navigate("AlertEpisodes" as never, {
        screen: "AlertEpisodeDetail",
        params: { episodeId: data.entityId },
      } as never);
      break;
    default:
      break;
  }
}

export function handleNotificationResponse(
  response: NotificationResponse,
): void {
  const data =
    (response.notification.request.content.data as NotificationData) || {};
  const actionId = response.actionIdentifier;

  if (actionId === "ACKNOWLEDGE") {
    // Background acknowledge — could call API here in the future
    return;
  }

  // Default tap or VIEW action — navigate to entity
  navigateToEntity(data);
}
