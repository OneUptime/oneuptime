import {
  BrowserPushError,
  BrowserPushProblem,
  DASHBOARD_SERVICE_WORKER_URL,
  askForNotificationPermission,
  getBrowserPushProblem,
  getPushSubscription,
  getServiceWorkerRegistration,
  readBrowserPushEnvironment,
  replacePushSubscription,
  sendPushConfigurationToServiceWorker,
  setThisBrowserDeviceId,
  waitForActiveServiceWorker,
} from "./BrowserPushRegistration";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import { APP_API_URL, VAPID_PUBLIC_KEY } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";

/*
 * REGISTER THIS BROWSER FOR PUSH NOTIFICATIONS - the one way it is done,
 * for every place that offers it: User Settings > Notification Methods >
 * Push Notifications' Register Device (Push.tsx), and the on-call guided
 * setup's "Use this browser" (#7149). Each step either succeeds or throws:
 * a BrowserPushError saying what the person can do about it (a server
 * without push keys, an insecure page, a blocked or dismissed permission
 * prompt, a worker that would not install), or an Error in the server's
 * words.
 *
 * Call it straight from the person's click: the permission prompt is asked
 * first, and browsers only show it for a page the person just used.
 */

export interface RegisteredBrowser {
  deviceId: string;
  // The browser was registered in this project already.
  alreadyRegistered: boolean;
}

export const SUBSCRIPTION_NOT_RENEWED_MESSAGE: string =
  "This browser's push subscription could not be renewed. Reload the page and register this browser again.";

/*
 * What stops this browser from being registered, known before anything is
 * asked of the person: a server without push keys, an insecure page, a
 * browser without push, an iPhone that has not added OneUptime to its Home
 * Screen. Permission is asked for, and answered, when it is registered.
 */
export function getProblemBeforeAsking(): BrowserPushProblem | null {
  return getBrowserPushProblem({
    environment: readBrowserPushEnvironment(window),
    vapidPublicKey: VAPID_PUBLIC_KEY,
  });
}

/*
 * Replaces a subscription the push service no longer accepts
 * (replacePushSubscription), and has the devices registered with it carry the
 * new one: what the service worker reports when the browser replaces a
 * subscription itself (sw.js.template). Throws what went wrong.
 */
async function renewGoneSubscription(data: {
  registration: ServiceWorkerRegistration;
  subscription: PushSubscription;
}): Promise<void> {
  const goneDeviceToken: string = JSON.stringify(data.subscription);

  const subscription: PushSubscription = await replacePushSubscription({
    pushManager: data.registration.pushManager,
    subscription: data.subscription,
    vapidPublicKey: VAPID_PUBLIC_KEY,
  });

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        "/user-push/subscription-change",
      ),
      data: {
        oldDeviceToken: goneDeviceToken,
        newDeviceToken: JSON.stringify(subscription),
      },
    });

  if (response.isFailure()) {
    throw new Error(API.getFriendlyMessage(response));
  }

  // No device took the new subscription: the one found still receives nothing.
  if (
    !((response as HTTPResponse<JSONObject>).data["devicesUpdated"] as number)
  ) {
    throw new Error(SUBSCRIPTION_NOT_RENEWED_MESSAGE);
  }
}

export async function registerThisBrowserForPush(data: {
  projectId: string;
  deviceName: string;
}): Promise<RegisteredBrowser> {
  const problem: BrowserPushProblem | null = getProblemBeforeAsking();

  if (problem) {
    throw new BrowserPushError(problem);
  }

  // First, while this is still the person's click: browsers only prompt then.
  await askForNotificationPermission(window.Notification);

  const registration: ServiceWorkerRegistration =
    await getServiceWorkerRegistration(
      window.navigator.serviceWorker,
      DASHBOARD_SERVICE_WORKER_URL,
    );

  await waitForActiveServiceWorker(registration);

  const subscription: PushSubscription = await getPushSubscription({
    pushManager: registration.pushManager,
    vapidPublicKey: VAPID_PUBLIC_KEY,
  });

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        "/user-push/register",
      ),
      data: {
        // A string: the ObjectID itself is written as { _type, value }.
        projectId: data.projectId,
        deviceToken: JSON.stringify(subscription),
        deviceType: PushDeviceType.Web,
        deviceName: data.deviceName,
      },
    });

  if (response.isFailure()) {
    throw new Error(API.getFriendlyMessage(response));
  }

  const result: JSONObject = (response as HTTPResponse<JSONObject>).data;
  const deviceId: string = result["deviceId"]
    ? result["deviceId"].toString()
    : "";
  let alreadyRegistered: boolean = result["alreadyRegistered"] === true;

  /*
   * Registered already, but the device no longer receives notifications:
   * the push service stopped accepting the subscription this browser still
   * holds. Registering it again as it is would change nothing.
   */
  if (alreadyRegistered && result["isVerified"] === false) {
    await renewGoneSubscription({
      registration: registration,
      subscription: subscription,
    });

    alreadyRegistered = false;
  }

  // So the worker can renew the subscription when the browser replaces it.
  sendPushConfigurationToServiceWorker({
    registration: registration,
    vapidPublicKey: VAPID_PUBLIC_KEY,
  });

  if (deviceId) {
    setThisBrowserDeviceId({ projectId: data.projectId, deviceId: deviceId });
  }

  return { deviceId: deviceId, alreadyRegistered: alreadyRegistered };
}
