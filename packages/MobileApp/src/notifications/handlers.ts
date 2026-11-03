import type { NotificationResponse } from "expo-notifications";
import * as Linking from "expo-linking";
import { buildInboxDetailNavigation } from "../navigation/inboxNavigation";
import { getServerUrl } from "../storage/serverUrl";
import logger from "../utils/logger";
import {
  getDashboardPageOnServer,
  opensInBrowser,
} from "./browserDestinations";
import { getPushPageActionKind } from "./categories";
import {
  isPushPageActionRequest,
  type PushPageActionKind,
  type PushPageActionRequest,
} from "../oncall/pushPageAction";

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
  // Acknowledge or Escalate, tapped under a page's push (categories.ts).
  pushAction?: PushPageActionRequest;
  [key: string]: any;
}

/*
 * The action a page's push was answered with, for the record's screen to do
 * (oncall/pushPageAction.ts); nothing for a tap on the notification itself.
 */
function pushActionParams(data: NotificationData): {
  pushAction?: PushPageActionRequest;
} {
  return isPushPageActionRequest(data.pushAction)
    ? { pushAction: data.pushAction }
    : {};
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
    case "security-case":
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
          params: {
            incidentId: entityId,
            projectId,
            ...pushActionParams(data),
          },
        }),
      );
      break;
    case "alert":
      navigationRef.navigate(
        "Inbox",
        buildInboxDetailNavigation({
          name: "AlertDetail",
          params: { alertId: entityId, projectId, ...pushActionParams(data) },
        }),
      );
      break;
    case "incident-episode":
      navigationRef.navigate(
        "Inbox",
        buildInboxDetailNavigation({
          name: "IncidentEpisodeDetail",
          params: { episodeId: entityId, projectId, ...pushActionParams(data) },
        }),
      );
      break;
    case "alert-episode":
      navigationRef.navigate(
        "Inbox",
        buildInboxDetailNavigation({
          name: "AlertEpisodeDetail",
          params: { episodeId: entityId, projectId, ...pushActionParams(data) },
        }),
      );
      break;
    case "security-case":
      /*
       * A security case: one that opened or rose to the person's chosen
       * priority, one assigned to them or their team, or one whose playbook
       * waits for their approval (SecurityCaseNotifications sends all three
       * with entityType "security-case"). The case's screen leads with any
       * approval it is waiting for.
       */
      navigationRef.navigate(
        "Inbox",
        buildInboxDetailNavigation({
          name: "SecurityCaseDetail",
          params: { caseId: entityId, projectId },
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
    case "security-hunt":
      /*
       * The server pushes about scheduled maintenance and about a scheduled
       * hunt that found security events too, but this app has no screen for
       * either: navigateToEntity opens their dashboard page in the browser
       * instead (browserDestinations.ts), and nothing reaches here. Written
       * out so the next reader knows they were considered; route them here
       * when a screen for them lands.
       */
      break;
    default:
      break;
  }
}

/*
 * The record's dashboard page, in the browser, for a push about something
 * this app has no screen for - when the page is on the OneUptime this app
 * is signed in to. Anything else opens nothing.
 */
async function openDashboardPage(url: unknown): Promise<void> {
  try {
    const page: string | null = getDashboardPageOnServer(
      url,
      await getServerUrl(),
    );

    if (page) {
      await Linking.openURL(page);
    }
  } catch (error: unknown) {
    logger.warn("[PushNotifications] Could not open the push's page:", error);
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
     * also displace the next page that CAN be shown. A hunt's push and a
     * scheduled maintenance event's open their page in the browser instead.
     */
    if (opensInBrowser(data.entityType)) {
      void openDashboardPage(data["url"]);
    }
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

/*
 * Opens a security case named by a link inside the app - the alert a
 * playbook's Page On-Call step opened, an incident declared from a case - on
 * top of what the reader is looking at, so Back returns to it. A case in
 * another project opens there once the app has switched to it, as a tapped
 * page does. False when the app cannot show it now (signed out, behind the
 * lock), and the link is better opened in the browser.
 */
export function openSecurityCaseFromLink(
  projectId: string,
  caseId: string,
): boolean {
  if (!caseId || !isRouteMounted("Inbox")) {
    return false;
  }

  const projectResult: ProjectNavigationResult =
    projectNavigationGuard?.(projectId) ?? "ready";

  if (projectResult === "unavailable") {
    return true;
  }

  if (projectResult === "switching") {
    pendingNotificationData = {
      entityType: "security-case",
      entityId: caseId,
      projectId,
    };
    return true;
  }

  navigationRef.navigate("Inbox", {
    screen: "SecurityCaseDetail",
    initial: false,
    params: { caseId, projectId },
  });

  return true;
}

export function handleNotificationResponse(
  response: NotificationResponse,
): void {
  /*
   * An action comes from the button tapped and nothing else: a push's own
   * data never carries one onto the screen, so no payload can make a plain
   * tap acknowledge or escalate anything.
   */
  const data: NotificationData = {
    ...((response.notification.request.content.data as NotificationData) || {}),
  };
  delete data.pushAction;
  const actionKind: PushPageActionKind | null = getPushPageActionKind(
    response.actionIdentifier,
  );

  if (actionKind) {
    /*
     * Acknowledge or Escalate under a page's push: the record opens, and its
     * screen does the action once, as its own button would. The id is the
     * tap's, so a second tap on another push is a new action.
     */
    navigateToEntity({
      ...data,
      pushAction: {
        kind: actionKind,
        id: `${response.notification.request.identifier}:${response.actionIdentifier}`,
      },
    });
    return;
  }

  // A tap on the notification itself opens what it is about.
  navigateToEntity(data);
}
