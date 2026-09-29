import type { NotificationResponse } from "expo-notifications";
import { buildInboxDetailNavigation } from "../navigation/inboxNavigation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let navigationRef: any = null;
let pendingNotificationData: NotificationData | null = null;
export type ProjectNavigationResult = "ready" | "switching" | "unavailable";
let projectNavigationGuard:
  | ((projectId: string) => ProjectNavigationResult)
  | null = null;

export function setProjectNavigationGuard(
  guard: ((projectId: string) => ProjectNavigationResult) | null,
): void {
  projectNavigationGuard = guard;
}

export function setNavigationRef(ref: unknown): void {
  navigationRef = ref;
}

interface NotificationData {
  entityType?: string;
  entityId?: string;
  projectId?: string;
  [key: string]: any;
}

/*
 * The tab that owns the detail screen for an entityType, or null when this app
 * has no screen for it at all.
 *
 * This exists so a payload's destination can be named BEFORE executeNavigation
 * runs, which is what the mounted-route check below needs. Keep it in step
 * with the switch in executeNavigation: an entityType routed there but missing
 * here would be parked forever, and one named here but missing there would be
 * spent on a navigate() that goes nowhere.
 */
function tabRouteForEntityType(entityType: string): string | null {
  switch (entityType) {
    case "incident":
    case "incident-episode":
    case "alert":
    case "alert-episode":
      return "Inbox";
    case "monitor":
      return "Monitors";
    default:
      return null;
  }
}

/*
 * Whether the navigator mounted RIGHT NOW actually owns `routeName`.
 *
 * isReady() on its own is not enough, and trusting it is what threw pages
 * away. The auth stack and the main tabs are two different navigators swapped
 * into the same NavigationContainer, and the container's onReady fires as soon
 * as the AUTH stack mounts. Asking that stack for "Inbox" is not an error
 * - React Navigation warns at most and does nothing - so a page tapped from
 * the lock screen while signed out used to be consumed against a navigator
 * that could not show it, and the responder landed on Home with no idea which
 * incident had paged them.
 */
function isRouteMounted(routeName: string): boolean {
  if (!navigationRef?.isReady()) {
    return false;
  }

  /*
   * getRootState() is undefined until a navigator registers itself with the
   * container - which is exactly the state while the biometric lock screen is
   * up, since that screen is a plain component and not a navigator.
   */
  const routeNames: unknown = navigationRef.getRootState()?.routeNames;

  return Array.isArray(routeNames) && routeNames.includes(routeName);
}

function executeNavigation(data: NotificationData): void {
  const projectId: string = data.projectId ?? "";
  if (!data.entityId) {
    return;
  }
  const entityId: string = data.entityId;

  switch (data.entityType) {
    case "incident":
      navigationRef.navigate(
        "Inbox",
        buildInboxDetailNavigation({
          name: "IncidentDetail",
          params: { incidentId: entityId, projectId },
        }),
      );
      break;
    case "alert":
      navigationRef.navigate(
        "Inbox",
        buildInboxDetailNavigation({
          name: "AlertDetail",
          params: { alertId: entityId, projectId },
        }),
      );
      break;
    case "incident-episode":
      navigationRef.navigate(
        "Inbox",
        buildInboxDetailNavigation({
          name: "IncidentEpisodeDetail",
          params: { episodeId: entityId, projectId },
        }),
      );
      break;
    case "alert-episode":
      navigationRef.navigate(
        "Inbox",
        buildInboxDetailNavigation({
          name: "AlertEpisodeDetail",
          params: { episodeId: entityId, projectId },
        }),
      );
      break;
    case "monitor":
      /*
       * A monitor-status-changed page (PushNotificationUtil sends entityType
       * "monitor" with the monitor id and project id). This used to fall
       * through to the default and open the app on whatever tab it was last
       * on, which reads to the responder as the page having been for nothing.
       */
      navigationRef.navigate("Monitors", {
        screen: "MonitorDetail",
        initial: false,
        params: { monitorId: entityId, projectId },
      });
      break;
    case "scheduled-maintenance":
      /*
       * The server pages for scheduled maintenance too, but this app has no
       * screen that can show one - there is no scheduled-maintenance tab and
       * no detail route to navigate to. Opening the app where it already was
       * is the honest outcome. This case is written out rather than left to
       * the default so the next reader knows it was considered and is waiting
       * on a screen, not overlooked; route it here when that screen lands.
       */
      break;
    default:
      break;
  }
}

function navigateToEntity(data: NotificationData): void {
  if (!data.entityType || !data.entityId) {
    return;
  }

  const tabRoute: string | null = tabRouteForEntityType(data.entityType);

  if (tabRoute === null) {
    /*
     * Nothing in this app can show it. Parking it would hold a payload that
     * can never be spent, and the pending slot holds exactly one - so it would
     * also displace the next page that CAN be shown.
     */
    return;
  }

  if (!isRouteMounted(tabRoute)) {
    /*
     * Cold start, or signed out, or behind the biometric lock. Hold it:
     * RootNavigator re-runs processPendingNotification once auth and biometric
     * state settle, and this is the only copy of the page the responder tapped.
     */
    pendingNotificationData = data;
    return;
  }

  pendingNotificationData = data;
  processPendingNotification();
}

export function processPendingNotification(): void {
  if (!pendingNotificationData) {
    return;
  }

  const data: NotificationData = pendingNotificationData;
  const tabRoute: string | null = tabRouteForEntityType(data.entityType ?? "");

  if (tabRoute === null || !isRouteMounted(tabRoute)) {
    /*
     * Still nowhere to put it, so leave it parked rather than clearing it.
     * This runs from NavigationContainer's onReady - which fires for the auth
     * stack, long before the tabs exist - and again on every auth/biometric
     * transition. Clearing here was what lost the page.
     */
    return;
  }

  const projectResult: ProjectNavigationResult =
    projectNavigationGuard?.(data.projectId ?? "") ?? "ready";
  if (projectResult === "switching") {
    return;
  }
  pendingNotificationData = null;
  if (projectResult === "unavailable") {
    return;
  }
  executeNavigation(data);
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
