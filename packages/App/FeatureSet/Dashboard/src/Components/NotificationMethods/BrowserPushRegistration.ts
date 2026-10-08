import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What Register Device (Push.tsx) needs from the browser: a name for it,
 * whether it can receive push notifications at all, permission to show them,
 * and a push subscription from OneUptime's service worker. Each step either
 * succeeds or throws a BrowserPushError saying what the person can do about
 * it - "Permission to show notifications was denied." told nobody how to
 * undo the denial, and a worker that never installed left the dialog
 * spinning for good.
 */

/*
 * Registered with its default scope, /dashboard/, here and nowhere else: the
 * Dashboard's pages (views/index.ejs) do not register it themselves.
 */
export const DASHBOARD_SERVICE_WORKER_URL: string = "/dashboard/sw.js";

/*
 * Installing the worker downloads a handful of files (sw.js.template's
 * STATIC_ASSETS). Long enough for a slow connection, short enough that the
 * dialog never spins forever.
 */
export const SERVICE_WORKER_TIMEOUT_IN_MS: number = 30000;

export enum BrowserPushProblem {
  NotConfigured = "NotConfigured",
  InsecureConnection = "InsecureConnection",
  NeedsHomeScreen = "NeedsHomeScreen",
  NotSupported = "NotSupported",
  PermissionBlocked = "PermissionBlocked",
  PermissionDismissed = "PermissionDismissed",
  PushServiceUnavailable = "PushServiceUnavailable",
  ServiceWorkerFailed = "ServiceWorkerFailed",
  TimedOut = "TimedOut",
}

export const BROWSER_PUSH_PROBLEM_MESSAGES: Record<BrowserPushProblem, string> =
  {
    [BrowserPushProblem.NotConfigured]: translationKey(
      "Push notifications are not set up on this OneUptime server. An administrator needs to set the VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables.",
    ),
    [BrowserPushProblem.InsecureConnection]: translationKey(
      "Browsers only allow push notifications over a secure connection. Open OneUptime over HTTPS to register this browser.",
    ),
    [BrowserPushProblem.NeedsHomeScreen]: translationKey(
      "On iPhone and iPad, push notifications work once OneUptime is on your Home Screen. In Safari, tap Share, then Add to Home Screen, open OneUptime from your Home Screen and register it there. You can also install the OneUptime On-Call app.",
    ),
    [BrowserPushProblem.NotSupported]: translationKey(
      "This browser cannot receive push notifications here. Use a regular (not private) window of a recent Chrome, Edge, Firefox or Safari, or install the OneUptime On-Call app.",
    ),
    [BrowserPushProblem.PermissionBlocked]: translationKey(
      "Notifications are blocked for OneUptime in this browser. Click the icon at the left of the address bar, allow notifications for this site, and then register this browser again. Private and incognito windows block them for every site: use a regular window.",
    ),
    [BrowserPushProblem.PermissionDismissed]: translationKey(
      "The browser's permission prompt closed without an answer. Register this browser again and choose Allow when the browser asks.",
    ),
    [BrowserPushProblem.PushServiceUnavailable]: translationKey(
      "This browser could not reach its push service. Private and incognito windows cannot receive push notifications, and some browsers have push turned off. Try a regular window or another browser.",
    ),
    [BrowserPushProblem.ServiceWorkerFailed]: translationKey(
      "OneUptime's service worker could not be installed in this browser, so push notifications cannot be delivered to it. Reload the page and try again.",
    ),
    [BrowserPushProblem.TimedOut]: translationKey(
      "This browser took too long to set up push notifications. Reload the page and try again.",
    ),
  };

export class BrowserPushError extends Error {
  public readonly problem: BrowserPushProblem;

  public constructor(problem: BrowserPushProblem) {
    super(BROWSER_PUSH_PROBLEM_MESSAGES[problem]);
    this.name = "BrowserPushError";
    this.problem = problem;
  }
}

/*
 * The name a newly registered browser is given until the person changes it:
 * "Chrome on Windows". navigator.platform ("Win32", "MacIntel") is not a
 * name anybody recognises, and its "Chrome" test also caught Edge and Opera.
 */
export interface BrowserIdentity {
  userAgent: string;
  // navigator.userAgentData.brands, which only Chromium browsers have.
  brands?: Array<{ brand: string }> | undefined;
  // navigator.maxTouchPoints: an iPad asking for desktop sites says it is a Mac.
  maxTouchPoints?: number | undefined;
}

// Brave says nothing about itself in its user agent, only here.
const BROWSERS_BY_BRAND: Array<{ brand: string; name: string }> = [
  { brand: "Microsoft Edge", name: "Edge" },
  { brand: "Opera", name: "Opera" },
  { brand: "Brave", name: "Brave" },
  { brand: "Google Chrome", name: "Chrome" },
];

// In order: every Chromium browser also says "Chrome", and nearly all say "Safari".
const BROWSERS_BY_USER_AGENT: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bEdg(e|A|iOS)?\//, name: "Edge" },
  { pattern: /\b(OPR|OPT|Opera)\//, name: "Opera" },
  { pattern: /\bSamsungBrowser\//, name: "Samsung Internet" },
  { pattern: /\b(Firefox|FxiOS)\//, name: "Firefox" },
  { pattern: /\b(Chrome|CriOS|Chromium|HeadlessChrome)\//, name: "Chrome" },
  { pattern: /\bSafari\//, name: "Safari" },
];

export function getBrowserName(identity: BrowserIdentity): string {
  for (const candidate of BROWSERS_BY_BRAND) {
    const isBranded: boolean = (identity.brands || []).some(
      (brand: { brand: string }): boolean => {
        return brand.brand === candidate.brand;
      },
    );

    if (isBranded) {
      return candidate.name;
    }
  }

  for (const candidate of BROWSERS_BY_USER_AGENT) {
    if (candidate.pattern.test(identity.userAgent)) {
      return candidate.name;
    }
  }

  return "Browser";
}

// In order: Android and ChromeOS both say "Linux" as well.
const OPERATING_SYSTEMS_BY_USER_AGENT: Array<{
  pattern: RegExp;
  name: string;
}> = [
  { pattern: /\biPhone\b/, name: "iPhone" },
  { pattern: /\biPod\b/, name: "iPod touch" },
  { pattern: /\biPad\b/, name: "iPad" },
  { pattern: /\bAndroid\b/, name: "Android" },
  { pattern: /\bCrOS\b/, name: "ChromeOS" },
  { pattern: /\bWindows\b/, name: "Windows" },
  { pattern: /\b(Macintosh|Mac OS X)\b/, name: "macOS" },
  { pattern: /\bLinux\b/, name: "Linux" },
];

const MACINTOSH_PATTERN: RegExp = /\bMacintosh\b/;

export function getOperatingSystemName(
  identity: BrowserIdentity,
): string | null {
  // Of the "Macintosh" browsers, only an iPad has a touch screen.
  if (
    MACINTOSH_PATTERN.test(identity.userAgent) &&
    (identity.maxTouchPoints || 0) > 1
  ) {
    return "iPad";
  }

  for (const candidate of OPERATING_SYSTEMS_BY_USER_AGENT) {
    if (candidate.pattern.test(identity.userAgent)) {
      return candidate.name;
    }
  }

  return null;
}

export function getDefaultDeviceName(identity: BrowserIdentity): string {
  const browserName: string = getBrowserName(identity);
  const operatingSystemName: string | null = getOperatingSystemName(identity);

  return operatingSystemName
    ? `${browserName} on ${operatingSystemName}`
    : browserName;
}

export function readBrowserIdentity(
  browserNavigator: Navigator,
): BrowserIdentity {
  const userAgentData: { brands?: Array<{ brand: string }> } | undefined = (
    browserNavigator as Navigator & {
      userAgentData?: { brands?: Array<{ brand: string }> };
    }
  ).userAgentData;

  return {
    userAgent: browserNavigator.userAgent || "",
    brands: userAgentData?.brands,
    maxTouchPoints: browserNavigator.maxTouchPoints,
  };
}

/*
 * Whether this browser can receive push notifications at all, before the
 * person is asked anything.
 */
export interface BrowserPushEnvironment {
  isSecureContext: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  // iPhone, iPad or iPod touch, where only a Home Screen web app gets push.
  isAppleMobile: boolean;
  // Opened from the Home Screen (or installed as an app).
  isInstalledApp: boolean;
}

export function readBrowserPushEnvironment(
  browserWindow: Window,
): BrowserPushEnvironment {
  const browserNavigator: Navigator & { standalone?: boolean } =
    browserWindow.navigator;

  const operatingSystemName: string | null = getOperatingSystemName(
    readBrowserIdentity(browserNavigator),
  );

  let isInstalledApp: boolean = browserNavigator.standalone === true;

  if (!isInstalledApp && typeof browserWindow.matchMedia === "function") {
    isInstalledApp = browserWindow.matchMedia(
      "(display-mode: standalone)",
    ).matches;
  }

  return {
    // Absent only in browsers too old to have secure contexts at all.
    isSecureContext: browserWindow.isSecureContext !== false,
    hasServiceWorker: "serviceWorker" in browserNavigator,
    hasPushManager: "PushManager" in browserWindow,
    hasNotification: "Notification" in browserWindow,
    isAppleMobile:
      operatingSystemName === "iPhone" ||
      operatingSystemName === "iPad" ||
      operatingSystemName === "iPod touch",
    isInstalledApp: isInstalledApp,
  };
}

export function getBrowserPushProblem(data: {
  environment: BrowserPushEnvironment;
  vapidPublicKey: string;
}): BrowserPushProblem | null {
  if (!decodeVapidPublicKey(data.vapidPublicKey)) {
    return BrowserPushProblem.NotConfigured;
  }

  // An insecure page has no navigator.serviceWorker, so this goes first.
  if (!data.environment.isSecureContext) {
    return BrowserPushProblem.InsecureConnection;
  }

  if (
    data.environment.hasServiceWorker &&
    data.environment.hasPushManager &&
    data.environment.hasNotification
  ) {
    return null;
  }

  if (data.environment.isAppleMobile && !data.environment.isInstalledApp) {
    return BrowserPushProblem.NeedsHomeScreen;
  }

  return BrowserPushProblem.NotSupported;
}

const BASE64URL_PATTERN: RegExp = /^[A-Za-z0-9_-]+={0,2}$/;

/*
 * The VAPID public key (base64url, as the server is configured with it) as
 * the bytes PushManager.subscribe takes. Null for a key that is missing or
 * not base64url.
 */
export function decodeVapidPublicKey(
  vapidPublicKey: string | undefined,
): Uint8Array<ArrayBuffer> | null {
  const key: string = (vapidPublicKey || "").trim();

  if (!key || !BASE64URL_PATTERN.test(key)) {
    return null;
  }

  const base64: string = (key + "=".repeat((4 - (key.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  let binary: string;

  try {
    binary = atob(base64);
  } catch {
    return null;
  }

  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(binary.length);

  for (let index: number = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export interface NotificationPermissionApi {
  permission: NotificationPermission;
  /*
   * Promise-based everywhere push works; older Safari only called the
   * callback.
   */
  requestPermission: (
    callback?: (permission: NotificationPermission) => void,
  ) => Promise<NotificationPermission> | void;
}

/*
 * Asks for permission to show notifications, unless they are allowed
 * already, and says what to do when they are not.
 *
 * A site whose notifications are blocked is asked too: the browser answers
 * "denied" at once, without a prompt. Notification.permission is not
 * trusted for that on its own, because it is not always true - Chromium
 * reports "denied" in a context where requestPermission grants.
 *
 * Call it first, straight from the click: browsers only open the prompt for
 * a page the person just interacted with.
 */
export async function askForNotificationPermission(
  notificationApi: NotificationPermissionApi,
): Promise<void> {
  if (notificationApi.permission === "granted") {
    return;
  }

  const answer: NotificationPermission =
    await new Promise<NotificationPermission>(
      (resolve: (permission: NotificationPermission) => void) => {
        const promise: Promise<NotificationPermission> | void =
          notificationApi.requestPermission(resolve);

        if (promise) {
          promise.then(resolve, () => {
            resolve("default");
          });
        }
      },
    );

  if (answer === "granted") {
    return;
  }

  throw new BrowserPushError(
    answer === "denied"
      ? BrowserPushProblem.PermissionBlocked
      : BrowserPushProblem.PermissionDismissed,
  );
}

function getNewestWorker(
  registration: ServiceWorkerRegistration,
): ServiceWorker | null {
  return registration.installing || registration.waiting || registration.active;
}

function isWorkerScript(worker: ServiceWorker, scriptUrl: string): boolean {
  try {
    return (
      new URL(worker.scriptURL).pathname ===
      new URL(scriptUrl, worker.scriptURL).pathname
    );
  } catch {
    return false;
  }
}

/*
 * The registration of OneUptime's service worker for this page: the one
 * already there when there is one, so a page it controls is not handed over
 * to a second registration of the same worker (a change of controller the
 * page reloads for), or a new one.
 */
export async function getServiceWorkerRegistration(
  container: Pick<ServiceWorkerContainer, "getRegistration" | "register">,
  scriptUrl: string,
): Promise<ServiceWorkerRegistration> {
  try {
    const existing: ServiceWorkerRegistration | undefined =
      await container.getRegistration();

    const existingWorker: ServiceWorker | null = existing
      ? getNewestWorker(existing)
      : null;

    if (
      existing &&
      existingWorker &&
      isWorkerScript(existingWorker, scriptUrl)
    ) {
      return existing;
    }

    return await container.register(scriptUrl);
  } catch {
    // A script that failed to download or parse, or a scope that is refused.
    throw new BrowserPushError(BrowserPushProblem.ServiceWorkerFailed);
  }
}

/*
 * Resolves once the registration has an active worker - PushManager.subscribe
 * refuses a registration without one. A worker that fails to install becomes
 * redundant and never activates: that, and a worker that is still not
 * active when the time runs out, are errors rather than a dialog that waits
 * forever.
 */
export function waitForActiveServiceWorker(
  registration: ServiceWorkerRegistration,
  timeoutInMs: number = SERVICE_WORKER_TIMEOUT_IN_MS,
): Promise<void> {
  return new Promise<void>(
    (resolve: () => void, reject: (error: BrowserPushError) => void) => {
      if (registration.active) {
        resolve();
        return;
      }

      const worker: ServiceWorker | null =
        registration.installing || registration.waiting;

      if (!worker) {
        reject(new BrowserPushError(BrowserPushProblem.ServiceWorkerFailed));
        return;
      }

      const settle: (error?: BrowserPushError) => void = (
        error?: BrowserPushError,
      ): void => {
        clearTimeout(timer);
        worker.removeEventListener("statechange", onStateChange);

        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const onStateChange: () => void = (): void => {
        if (registration.active) {
          settle();
        } else if (worker.state === "redundant") {
          settle(new BrowserPushError(BrowserPushProblem.ServiceWorkerFailed));
        }
      };

      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        settle(new BrowserPushError(BrowserPushProblem.TimedOut));
      }, timeoutInMs);

      worker.addEventListener("statechange", onStateChange);
    },
  );
}

function getBytes(key: ArrayBuffer | ArrayBufferView): Uint8Array {
  return key instanceof ArrayBuffer
    ? new Uint8Array(key)
    : new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
}

/*
 * Whether a subscription was made for this server key. Unknown (the browser
 * does not say) counts as yes: subscribe() then returns it if it was, and
 * says so if it was not.
 */
export function isSubscribedWithKey(
  subscription: PushSubscription,
  applicationServerKey: Uint8Array,
): boolean {
  const subscribedKey: ArrayBuffer | ArrayBufferView | null | undefined =
    subscription.options?.applicationServerKey;

  if (!subscribedKey) {
    return true;
  }

  const bytes: Uint8Array = getBytes(subscribedKey);

  return (
    bytes.length === applicationServerKey.length &&
    bytes.every((byte: number, index: number): boolean => {
      return byte === applicationServerKey[index];
    })
  );
}

/*
 * This browser's push subscription for OneUptime. One it already has is
 * reused (registering twice is not two devices), unless it was made for
 * another server key - the server's keys were changed since - in which case
 * the push service would refuse every notification sent to it, so it is
 * replaced.
 */
export async function getPushSubscription(data: {
  pushManager: PushManager;
  vapidPublicKey: string;
}): Promise<PushSubscription> {
  const applicationServerKey: Uint8Array<ArrayBuffer> | null =
    decodeVapidPublicKey(data.vapidPublicKey);

  if (!applicationServerKey) {
    throw new BrowserPushError(BrowserPushProblem.NotConfigured);
  }

  try {
    const existing: PushSubscription | null =
      await data.pushManager.getSubscription();

    if (existing && !isSubscribedWithKey(existing, applicationServerKey)) {
      await existing.unsubscribe();
    }

    return await data.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey,
    });
  } catch (error) {
    throw toBrowserPushError(error);
  }
}

/*
 * What the browser's own errors mean for the person. NotAllowedError is a
 * permission taken away (Firefox raises it from subscribe); AbortError is
 * the push service saying no, which is what Chrome says in an incognito
 * window. Anything else passes through for the caller's generic message.
 */
export function toBrowserPushError(error: unknown): unknown {
  if (error instanceof BrowserPushError) {
    return error;
  }

  const name: string | undefined = (error as { name?: unknown } | null)
    ?.name as string | undefined;

  if (name === "NotAllowedError") {
    return new BrowserPushError(BrowserPushProblem.PermissionBlocked);
  }

  if (name === "AbortError") {
    return new BrowserPushError(BrowserPushProblem.PushServiceUnavailable);
  }

  return error;
}

/*
 * Which row of the device table is this browser: the device it was
 * registered as in a project, remembered here so the table can say so. Local
 * storage is per browser, and is cleared when the person signs out.
 */
const THIS_BROWSER_DEVICE_KEY_PREFIX: string = "this_browser_push_device_";

export function getThisBrowserDeviceId(
  projectId: string | undefined,
): string | null {
  if (!projectId) {
    return null;
  }

  try {
    return (
      window.localStorage.getItem(THIS_BROWSER_DEVICE_KEY_PREFIX + projectId) ||
      null
    );
  } catch {
    // Storage switched off: the table just does not say which row this is.
    return null;
  }
}

export function setThisBrowserDeviceId(data: {
  projectId: string | undefined;
  deviceId: string;
}): void {
  if (!data.projectId) {
    return;
  }

  try {
    window.localStorage.setItem(
      THIS_BROWSER_DEVICE_KEY_PREFIX + data.projectId,
      data.deviceId,
    );
  } catch {
    // As above.
  }
}
