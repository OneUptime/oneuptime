import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  BROWSER_PUSH_PROBLEM_MESSAGES,
  BrowserIdentity,
  BrowserPushEnvironment,
  BrowserPushError,
  BrowserPushProblem,
  DASHBOARD_SERVICE_WORKER_URL,
  NotificationPermissionApi,
  askForNotificationPermission,
  decodeVapidPublicKey,
  getBrowserPushProblem,
  getDefaultDeviceName,
  getPushSubscription,
  getServiceWorkerRegistration,
  getThisBrowserDeviceId,
  isSubscribedWithKey,
  readBrowserPushEnvironment,
  setThisBrowserDeviceId,
  toBrowserPushError,
  waitForActiveServiceWorker,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/BrowserPushRegistration";

/*
 * Register Device (User Settings > Notification Methods > Push
 * Notifications) asks the browser for a name, for permission and for a push
 * subscription. Each of these used to fail in a way that left the person
 * stuck: "Chrome on Win32", "Permission to show notifications was denied."
 * with no way back, a dialog spinning forever when the worker never
 * installed, a refusal when the server's keys had changed.
 */

// A real VAPID public key: an uncompressed P-256 point, 65 bytes, 0x04 first.
const VAPID_PUBLIC_KEY: string =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

const OTHER_VAPID_PUBLIC_KEY: string =
  "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";

function expectProblem(error: unknown, problem: BrowserPushProblem): void {
  expect(error).toBeInstanceOf(BrowserPushError);
  expect((error as BrowserPushError).problem).toBe(problem);
  expect((error as BrowserPushError).message).toBe(
    BROWSER_PUSH_PROBLEM_MESSAGES[problem],
  );
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the promise to reject.");
}

describe("the name a browser is registered under", () => {
  const WINDOWS_CHROME: string =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  const MAC_SAFARI: string =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

  test.each([
    [
      "Chrome on Windows (the customer's browser, once 'Chrome on Win32')",
      {
        userAgent: WINDOWS_CHROME,
      },
      "Chrome on Windows",
    ],
    [
      "Edge on Windows, which says Chrome as well",
      {
        userAgent: `${WINDOWS_CHROME} Edg/130.0.2849.68`,
      },
      "Edge on Windows",
    ],
    [
      "Opera on macOS, which says Chrome as well",
      {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/115.0.0.0",
      },
      "Opera on macOS",
    ],
    [
      "Firefox on Linux",
      {
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      },
      "Firefox on Linux",
    ],
    [
      "Firefox on Windows",
      {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
      },
      "Firefox on Windows",
    ],
    ["Safari on macOS", { userAgent: MAC_SAFARI }, "Safari on macOS"],
    [
      "Safari on an iPad asking for desktop sites, which says Macintosh",
      {
        userAgent: MAC_SAFARI,
        maxTouchPoints: 5,
      },
      "Safari on iPad",
    ],
    [
      "Safari on iPhone",
      {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      },
      "Safari on iPhone",
    ],
    [
      "Chrome on iPhone",
      {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
      },
      "Chrome on iPhone",
    ],
    [
      "Firefox on iPhone",
      {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15",
      },
      "Firefox on iPhone",
    ],
    [
      "Edge on iPad",
      {
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.0.2849.68 Mobile/15E148 Safari/605.1.15",
      },
      "Edge on iPad",
    ],
    [
      "Chrome on Android, which says Linux as well",
      {
        userAgent:
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      },
      "Chrome on Android",
    ],
    [
      "Samsung Internet on Android",
      {
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
      },
      "Samsung Internet on Android",
    ],
    [
      "Chrome on ChromeOS, which says Linux as well",
      {
        userAgent:
          "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      },
      "Chrome on ChromeOS",
    ],
    [
      "headless Chrome",
      {
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
      },
      "Chrome on Linux",
    ],
    [
      "Brave, which only says so in its brands",
      {
        userAgent: WINDOWS_CHROME,
        brands: [
          { brand: "Brave" },
          { brand: "Chromium" },
          { brand: "Not_A Brand" },
        ],
      },
      "Brave on Windows",
    ],
    [
      "Edge, when its brands say so",
      {
        userAgent: WINDOWS_CHROME,
        brands: [{ brand: "Microsoft Edge" }, { brand: "Chromium" }],
      },
      "Edge on Windows",
    ],
    [
      "Chrome, when its brands say so",
      {
        userAgent: WINDOWS_CHROME,
        brands: [{ brand: "Chromium" }, { brand: "Google Chrome" }],
      },
      "Chrome on Windows",
    ],
    [
      "a browser it does not know, on a system it does not know",
      {
        userAgent: "SomethingElse/1.0",
      },
      "Browser",
    ],
    [
      "a known browser on a system it does not know",
      {
        userAgent: "Mozilla/5.0 (Plan 9) Gecko/20100101 Firefox/131.0",
      },
      "Firefox",
    ],
    ["an empty user agent", { userAgent: "" }, "Browser"],
  ])("%s", (_name: string, identity: BrowserIdentity, expected: string) => {
    expect(getDefaultDeviceName(identity)).toBe(expected);
  });
});

describe("whether this browser can be registered at all", () => {
  const CAPABLE: BrowserPushEnvironment = {
    isSecureContext: true,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    isAppleMobile: false,
    isInstalledApp: false,
  };

  // Safari on an iPhone, opened from a link rather than the Home Screen.
  const IPHONE_SAFARI: BrowserPushEnvironment = {
    ...CAPABLE,
    hasPushManager: false,
    hasNotification: false,
    isAppleMobile: true,
  };

  test.each([
    ["a capable browser", CAPABLE, VAPID_PUBLIC_KEY, null],
    [
      "a server without a VAPID key",
      CAPABLE,
      "",
      BrowserPushProblem.NotConfigured,
    ],
    [
      "a server with a VAPID key that is not base64url",
      CAPABLE,
      "not a key!",
      BrowserPushProblem.NotConfigured,
    ],
    [
      "a server without a VAPID key, over plain HTTP",
      {
        ...CAPABLE,
        isSecureContext: false,
        hasServiceWorker: false,
      },
      "",
      BrowserPushProblem.NotConfigured,
    ],
    [
      "plain HTTP, where the browser hides service workers",
      {
        ...CAPABLE,
        isSecureContext: false,
        hasServiceWorker: false,
        hasPushManager: false,
      },
      VAPID_PUBLIC_KEY,
      BrowserPushProblem.InsecureConnection,
    ],
    [
      "Safari on an iPhone, not opened from the Home Screen",
      IPHONE_SAFARI,
      VAPID_PUBLIC_KEY,
      BrowserPushProblem.NeedsHomeScreen,
    ],
    [
      "the Home Screen app on an iPhone too old for web push",
      {
        ...IPHONE_SAFARI,
        isInstalledApp: true,
      },
      VAPID_PUBLIC_KEY,
      BrowserPushProblem.NotSupported,
    ],
    [
      "the Home Screen app on an iPhone with web push",
      {
        ...CAPABLE,
        isAppleMobile: true,
        isInstalledApp: true,
      },
      VAPID_PUBLIC_KEY,
      null,
    ],
    [
      "a desktop browser without the Push API",
      {
        ...CAPABLE,
        hasPushManager: false,
      },
      VAPID_PUBLIC_KEY,
      BrowserPushProblem.NotSupported,
    ],
    [
      "a desktop browser without notifications",
      {
        ...CAPABLE,
        hasNotification: false,
      },
      VAPID_PUBLIC_KEY,
      BrowserPushProblem.NotSupported,
    ],
    [
      "a desktop browser without service workers",
      {
        ...CAPABLE,
        hasServiceWorker: false,
      },
      VAPID_PUBLIC_KEY,
      BrowserPushProblem.NotSupported,
    ],
  ])(
    "%s",
    (
      _name: string,
      environment: BrowserPushEnvironment,
      vapidPublicKey: string,
      expected: BrowserPushProblem | null,
    ) => {
      expect(
        getBrowserPushProblem({
          environment: environment,
          vapidPublicKey: vapidPublicKey,
        }),
      ).toBe(expected);
    },
  );

  function fakeWindow(data: {
    userAgent: string;
    isSecureContext?: boolean | undefined;
    serviceWorker?: boolean;
    pushManager?: boolean;
    notification?: boolean;
    standalone?: boolean;
    displayModeStandalone?: boolean;
    maxTouchPoints?: number;
  }): Window {
    const browserNavigator: Record<string, unknown> = {
      userAgent: data.userAgent,
      maxTouchPoints: data.maxTouchPoints || 0,
    };

    if (data.serviceWorker !== false) {
      browserNavigator["serviceWorker"] = {};
    }

    if (data.standalone !== undefined) {
      browserNavigator["standalone"] = data.standalone;
    }

    const browserWindow: Record<string, unknown> = {
      isSecureContext: data.isSecureContext,
      navigator: browserNavigator,
      matchMedia: (query: string): { matches: boolean } => {
        return {
          matches:
            query === "(display-mode: standalone)" &&
            Boolean(data.displayModeStandalone),
        };
      },
    };

    if (data.pushManager !== false) {
      browserWindow["PushManager"] = function PushManager(): void {};
    }

    if (data.notification !== false) {
      browserWindow["Notification"] = function Notification(): void {};
    }

    return browserWindow as unknown as Window;
  }

  const IPHONE: string =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

  test("reads a desktop browser that has everything", () => {
    expect(
      readBrowserPushEnvironment(
        fakeWindow({
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          isSecureContext: true,
        }),
      ),
    ).toEqual({
      isSecureContext: true,
      hasServiceWorker: true,
      hasPushManager: true,
      hasNotification: true,
      isAppleMobile: false,
      isInstalledApp: false,
    });
  });

  test("reads Safari on an iPhone opened from a link", () => {
    expect(
      readBrowserPushEnvironment(
        fakeWindow({
          userAgent: IPHONE,
          isSecureContext: true,
          pushManager: false,
          notification: false,
          standalone: false,
        }),
      ),
    ).toEqual({
      isSecureContext: true,
      hasServiceWorker: true,
      hasPushManager: false,
      hasNotification: false,
      isAppleMobile: true,
      isInstalledApp: false,
    });
  });

  test("an iPhone that opened OneUptime from its Home Screen is an installed app", () => {
    expect(
      readBrowserPushEnvironment(
        fakeWindow({
          userAgent: IPHONE,
          isSecureContext: true,
          standalone: true,
        }),
      ).isInstalledApp,
    ).toBe(true);
  });

  test("an installed app on another system says so through display-mode", () => {
    expect(
      readBrowserPushEnvironment(
        fakeWindow({
          userAgent: IPHONE,
          isSecureContext: true,
          displayModeStandalone: true,
        }),
      ).isInstalledApp,
    ).toBe(true);
  });

  test("an iPad asking for desktop sites is an iPad", () => {
    expect(
      readBrowserPushEnvironment(
        fakeWindow({
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
          isSecureContext: true,
          maxTouchPoints: 5,
        }),
      ).isAppleMobile,
    ).toBe(true);
  });

  test("a plain HTTP page is not a secure context", () => {
    expect(
      readBrowserPushEnvironment(
        fakeWindow({
          userAgent: "Mozilla/5.0 Firefox/131.0",
          isSecureContext: false,
          serviceWorker: false,
        }),
      ),
    ).toMatchObject({ isSecureContext: false, hasServiceWorker: false });
  });

  test("a browser too old to know about secure contexts is not refused for it", () => {
    expect(
      readBrowserPushEnvironment(
        fakeWindow({
          userAgent: "Mozilla/5.0 Firefox/60.0",
          isSecureContext: undefined,
        }),
      ).isSecureContext,
    ).toBe(true);
  });
});

describe("the server's VAPID key", () => {
  test("decodes to the 65 bytes of a P-256 public key", () => {
    const key: Uint8Array | null = decodeVapidPublicKey(VAPID_PUBLIC_KEY);

    expect(key).not.toBeNull();
    expect(key!.length).toBe(65);
    expect(key![0]).toBe(0x04);
  });

  test("decodes the same with base64 padding and surrounding whitespace", () => {
    expect(decodeVapidPublicKey(`  ${VAPID_PUBLIC_KEY}=\n`)).toEqual(
      decodeVapidPublicKey(VAPID_PUBLIC_KEY),
    );
  });

  test.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["not base64url", "not a key!"],
    ["standard base64 rather than base64url", "ab+/cd=="],
  ])("is refused when %s", (_name: string, key: string | undefined) => {
    expect(decodeVapidPublicKey(key)).toBeNull();
  });
});

describe("asking for permission to show notifications", () => {
  function notificationApi(data: {
    permission: NotificationPermission;
    answer?: NotificationPermission;
    rejects?: boolean;
    callbackOnly?: boolean;
  }): NotificationPermissionApi & { requestPermission: jest.Mock } {
    return {
      permission: data.permission,
      requestPermission: jest.fn(
        (
          callback?: (permission: NotificationPermission) => void,
        ): Promise<NotificationPermission> | void => {
          if (data.callbackOnly) {
            callback?.(data.answer || "default");
            return undefined;
          }

          if (data.rejects) {
            return Promise.reject(new Error("The prompt could not be shown."));
          }

          return Promise.resolve(data.answer || "default");
        },
      ),
    };
  }

  test("a browser that already allows them is not asked again", async () => {
    const api: NotificationPermissionApi & { requestPermission: jest.Mock } =
      notificationApi({ permission: "granted" });

    await expect(askForNotificationPermission(api)).resolves.toBeUndefined();
    expect(api.requestPermission).not.toHaveBeenCalled();
  });

  test("a browser that blocked them is told how to unblock them, and not asked: it would never show the prompt", async () => {
    const api: NotificationPermissionApi & { requestPermission: jest.Mock } =
      notificationApi({ permission: "denied" });

    expectProblem(
      await rejectionOf(askForNotificationPermission(api)),
      BrowserPushProblem.PermissionBlocked,
    );
    expect(api.requestPermission).not.toHaveBeenCalled();
  });

  test("allowed at the prompt", async () => {
    const api: NotificationPermissionApi & { requestPermission: jest.Mock } =
      notificationApi({ permission: "default", answer: "granted" });

    await expect(askForNotificationPermission(api)).resolves.toBeUndefined();
    expect(api.requestPermission).toHaveBeenCalledTimes(1);
  });

  test("blocked at the prompt", async () => {
    expectProblem(
      await rejectionOf(
        askForNotificationPermission(
          notificationApi({ permission: "default", answer: "denied" }),
        ),
      ),
      BrowserPushProblem.PermissionBlocked,
    );
  });

  test("the prompt closed without an answer", async () => {
    expectProblem(
      await rejectionOf(
        askForNotificationPermission(
          notificationApi({ permission: "default", answer: "default" }),
        ),
      ),
      BrowserPushProblem.PermissionDismissed,
    );
  });

  test("a prompt the browser could not show reads as closed without an answer", async () => {
    expectProblem(
      await rejectionOf(
        askForNotificationPermission(
          notificationApi({ permission: "default", rejects: true }),
        ),
      ),
      BrowserPushProblem.PermissionDismissed,
    );
  });

  test("an older Safari that answers through a callback", async () => {
    await expect(
      askForNotificationPermission(
        notificationApi({
          permission: "default",
          answer: "granted",
          callbackOnly: true,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

type Listener = () => void;

class FakeWorker {
  public scriptURL: string;
  public state: string;
  public listeners: Array<Listener> = [];

  public constructor(scriptURL: string, state: string) {
    this.scriptURL = scriptURL;
    this.state = state;
  }

  public addEventListener(_type: string, listener: Listener): void {
    this.listeners.push(listener);
  }

  public removeEventListener(_type: string, listener: Listener): void {
    this.listeners = this.listeners.filter((item: Listener): boolean => {
      return item !== listener;
    });
  }

  public moveTo(state: string): void {
    this.state = state;

    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

interface FakeRegistration {
  scope: string;
  installing: FakeWorker | null;
  waiting: FakeWorker | null;
  active: FakeWorker | null;
}

const OUR_WORKER_URL: string = "https://oneuptime.example/dashboard/sw.js";

describe("finding OneUptime's service worker registration", () => {
  function container(data: {
    existing?: FakeRegistration | undefined;
    getRegistrationFails?: boolean;
    registerFails?: boolean;
  }): {
    getRegistration: jest.Mock;
    register: jest.Mock;
    created: FakeRegistration;
  } {
    const created: FakeRegistration = {
      scope: "https://oneuptime.example/dashboard/",
      installing: new FakeWorker(OUR_WORKER_URL, "installing"),
      waiting: null,
      active: null,
    };

    return {
      created: created,
      getRegistration: jest.fn(async (): Promise<unknown> => {
        if (data.getRegistrationFails) {
          throw new Error("InvalidStateError");
        }

        return data.existing;
      }),
      register: jest.fn(async (): Promise<unknown> => {
        if (data.registerFails) {
          throw new TypeError(
            "Failed to register a ServiceWorker: A bad HTTP response code (404) was received when fetching the script.",
          );
        }

        return created;
      }),
    };
  }

  test("a browser without one registers it, with its default scope", async () => {
    const serviceWorkers: ReturnType<typeof container> = container({});

    const registration: ServiceWorkerRegistration =
      await getServiceWorkerRegistration(
        serviceWorkers as unknown as ServiceWorkerContainer,
        DASHBOARD_SERVICE_WORKER_URL,
      );

    expect(registration).toBe(serviceWorkers.created);
    expect(serviceWorkers.register.mock.calls).toEqual([["/dashboard/sw.js"]]);
  });

  test("the one already there is used, so the page is not handed to a second registration", async () => {
    const existing: FakeRegistration = {
      scope: "https://oneuptime.example/dashboard/",
      installing: null,
      waiting: null,
      active: new FakeWorker(OUR_WORKER_URL, "activated"),
    };
    const serviceWorkers: ReturnType<typeof container> = container({
      existing,
    });

    expect(
      await getServiceWorkerRegistration(
        serviceWorkers as unknown as ServiceWorkerContainer,
        DASHBOARD_SERVICE_WORKER_URL,
      ),
    ).toBe(existing);
    expect(serviceWorkers.register).not.toHaveBeenCalled();
  });

  test("the one already there is used whatever its scope, where a server allowed '/'", async () => {
    const existing: FakeRegistration = {
      scope: "https://oneuptime.example/",
      installing: null,
      waiting: null,
      active: new FakeWorker(OUR_WORKER_URL, "activated"),
    };
    const serviceWorkers: ReturnType<typeof container> = container({
      existing,
    });

    expect(
      await getServiceWorkerRegistration(
        serviceWorkers as unknown as ServiceWorkerContainer,
        DASHBOARD_SERVICE_WORKER_URL,
      ),
    ).toBe(existing);
    expect(serviceWorkers.register).not.toHaveBeenCalled();
  });

  test("one still installing is used", async () => {
    const existing: FakeRegistration = {
      scope: "https://oneuptime.example/dashboard/",
      installing: new FakeWorker(OUR_WORKER_URL, "installing"),
      waiting: null,
      active: null,
    };
    const serviceWorkers: ReturnType<typeof container> = container({
      existing,
    });

    expect(
      await getServiceWorkerRegistration(
        serviceWorkers as unknown as ServiceWorkerContainer,
        DASHBOARD_SERVICE_WORKER_URL,
      ),
    ).toBe(existing);
  });

  test("another site's worker over the page is not ours: OneUptime's is registered", async () => {
    const serviceWorkers: ReturnType<typeof container> = container({
      existing: {
        scope: "https://oneuptime.example/",
        installing: null,
        waiting: null,
        active: new FakeWorker(
          "https://oneuptime.example/other-sw.js",
          "activated",
        ),
      },
    });

    expect(
      await getServiceWorkerRegistration(
        serviceWorkers as unknown as ServiceWorkerContainer,
        DASHBOARD_SERVICE_WORKER_URL,
      ),
    ).toBe(serviceWorkers.created);
  });

  test("a worker script the browser cannot fetch is a service worker failure", async () => {
    expectProblem(
      await rejectionOf(
        getServiceWorkerRegistration(
          container({
            registerFails: true,
          }) as unknown as ServiceWorkerContainer,
          DASHBOARD_SERVICE_WORKER_URL,
        ),
      ),
      BrowserPushProblem.ServiceWorkerFailed,
    );
  });

  test("a browser that cannot say what is registered is a service worker failure", async () => {
    expectProblem(
      await rejectionOf(
        getServiceWorkerRegistration(
          container({
            getRegistrationFails: true,
          }) as unknown as ServiceWorkerContainer,
          DASHBOARD_SERVICE_WORKER_URL,
        ),
      ),
      BrowserPushProblem.ServiceWorkerFailed,
    );
  });
});

describe("waiting for the service worker to be active", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  function registration(data: Partial<FakeRegistration>): FakeRegistration {
    return {
      scope: "https://oneuptime.example/dashboard/",
      installing: null,
      waiting: null,
      active: null,
      ...data,
    };
  }

  test("one already active needs no wait", async () => {
    await expect(
      waitForActiveServiceWorker(
        registration({
          active: new FakeWorker(OUR_WORKER_URL, "activated"),
        }) as unknown as ServiceWorkerRegistration,
      ),
    ).resolves.toBeUndefined();
  });

  test("a new worker is waited for until it activates, and stops being listened to", async () => {
    const worker: FakeWorker = new FakeWorker(OUR_WORKER_URL, "installing");
    const pending: FakeRegistration = registration({ installing: worker });

    let isActive: boolean = false;
    const waiting: Promise<void> = waitForActiveServiceWorker(
      pending as unknown as ServiceWorkerRegistration,
    ).then(() => {
      isActive = true;
    });

    worker.moveTo("installed");
    await Promise.resolve();
    expect(isActive).toBe(false);

    pending.installing = null;
    pending.active = worker;
    worker.moveTo("activating");
    await waiting;

    expect(isActive).toBe(true);
    expect(worker.listeners).toHaveLength(0);
  });

  test("a worker that fails to install (it becomes redundant) is a failure, not a wait forever", async () => {
    const worker: FakeWorker = new FakeWorker(OUR_WORKER_URL, "installing");
    const waiting: Promise<void> = waitForActiveServiceWorker(
      registration({
        installing: worker,
      }) as unknown as ServiceWorkerRegistration,
    );

    worker.moveTo("redundant");

    expectProblem(
      await rejectionOf(waiting),
      BrowserPushProblem.ServiceWorkerFailed,
    );
    expect(worker.listeners).toHaveLength(0);
  });

  test("a worker that never activates times out", async () => {
    jest.useFakeTimers();

    const worker: FakeWorker = new FakeWorker(OUR_WORKER_URL, "installing");
    const waiting: Promise<unknown> = rejectionOf(
      waitForActiveServiceWorker(
        registration({
          installing: worker,
        }) as unknown as ServiceWorkerRegistration,
        30000,
      ),
    );

    jest.advanceTimersByTime(29999);
    worker.moveTo("installed");
    jest.advanceTimersByTime(1);

    expectProblem(await waiting, BrowserPushProblem.TimedOut);
    expect(worker.listeners).toHaveLength(0);
  });

  test("a registration with no worker at all is a failure", async () => {
    expectProblem(
      await rejectionOf(
        waitForActiveServiceWorker(
          registration({}) as unknown as ServiceWorkerRegistration,
        ),
      ),
      BrowserPushProblem.ServiceWorkerFailed,
    );
  });
});

describe("this browser's push subscription", () => {
  interface FakeSubscription {
    options: { applicationServerKey: ArrayBuffer | null } | undefined;
    unsubscribe: jest.Mock;
  }

  function subscription(key: string | null | "unknown"): FakeSubscription {
    const bytes: Uint8Array | null =
      key && key !== "unknown" ? decodeVapidPublicKey(key) : null;

    return {
      options:
        key === "unknown"
          ? undefined
          : {
              applicationServerKey: bytes
                ? (bytes.buffer.slice(0) as ArrayBuffer)
                : null,
            },
      unsubscribe: jest.fn(async (): Promise<boolean> => {
        return true;
      }),
    };
  }

  function pushManager(data: {
    existing: FakeSubscription | null;
    subscribeError?: Error;
  }): {
    getSubscription: jest.Mock;
    subscribe: jest.Mock;
    subscribed: FakeSubscription;
  } {
    const subscribed: FakeSubscription = subscription(VAPID_PUBLIC_KEY);

    return {
      subscribed: subscribed,
      getSubscription: jest.fn(async (): Promise<unknown> => {
        return data.existing;
      }),
      subscribe: jest.fn(async (): Promise<unknown> => {
        if (data.subscribeError) {
          throw data.subscribeError;
        }

        return data.existing && !data.existing.unsubscribe.mock.calls.length
          ? data.existing
          : subscribed;
      }),
    };
  }

  function domException(name: string, message: string): Error {
    const error: Error = new Error(message);
    error.name = name;
    return error;
  }

  test("a browser without one subscribes for the server's key, to show what it is sent", async () => {
    const manager: ReturnType<typeof pushManager> = pushManager({
      existing: null,
    });

    expect(
      await getPushSubscription({
        pushManager: manager as unknown as PushManager,
        vapidPublicKey: VAPID_PUBLIC_KEY,
      }),
    ).toBe(manager.subscribed);

    expect(manager.subscribe).toHaveBeenCalledTimes(1);

    const options: {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    } = manager.subscribe.mock.calls[0]![0] as never;

    expect(options.userVisibleOnly).toBe(true);
    expect(Array.from(options.applicationServerKey)).toEqual(
      Array.from(decodeVapidPublicKey(VAPID_PUBLIC_KEY)!),
    );
  });

  test("one made for the same key is kept: registering again is not a new device", async () => {
    const existing: FakeSubscription = subscription(VAPID_PUBLIC_KEY);
    const manager: ReturnType<typeof pushManager> = pushManager({ existing });

    expect(
      await getPushSubscription({
        pushManager: manager as unknown as PushManager,
        vapidPublicKey: VAPID_PUBLIC_KEY,
      }),
    ).toBe(existing);
    expect(existing.unsubscribe).not.toHaveBeenCalled();
  });

  test("one made for another key - the server's keys changed - is replaced", async () => {
    const existing: FakeSubscription = subscription(OTHER_VAPID_PUBLIC_KEY);
    const manager: ReturnType<typeof pushManager> = pushManager({ existing });

    expect(
      await getPushSubscription({
        pushManager: manager as unknown as PushManager,
        vapidPublicKey: VAPID_PUBLIC_KEY,
      }),
    ).toBe(manager.subscribed);
    expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
    expect(existing.unsubscribe.mock.invocationCallOrder[0]!).toBeLessThan(
      manager.subscribe.mock.invocationCallOrder[0]!,
    );
  });

  test("one whose key the browser does not say is left for subscribe() to judge", async () => {
    const existing: FakeSubscription = subscription("unknown");
    const manager: ReturnType<typeof pushManager> = pushManager({ existing });

    await getPushSubscription({
      pushManager: manager as unknown as PushManager,
      vapidPublicKey: VAPID_PUBLIC_KEY,
    });

    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(manager.subscribe).toHaveBeenCalledTimes(1);
  });

  test("a push service that refuses (Chrome in an incognito window) says so", async () => {
    expectProblem(
      await rejectionOf(
        getPushSubscription({
          pushManager: pushManager({
            existing: null,
            subscribeError: domException(
              "AbortError",
              "Registration failed - permission denied",
            ),
          }) as unknown as PushManager,
          vapidPublicKey: VAPID_PUBLIC_KEY,
        }),
      ),
      BrowserPushProblem.PushServiceUnavailable,
    );
  });

  test("permission taken away (Firefox refuses subscribe) says how to give it back", async () => {
    expectProblem(
      await rejectionOf(
        getPushSubscription({
          pushManager: pushManager({
            existing: null,
            subscribeError: domException(
              "NotAllowedError",
              "The request is not allowed.",
            ),
          }) as unknown as PushManager,
          vapidPublicKey: VAPID_PUBLIC_KEY,
        }),
      ),
      BrowserPushProblem.PermissionBlocked,
    );
  });

  test("any other failure is passed on as it is", async () => {
    const failure: Error = domException(
      "InvalidStateError",
      "Something else went wrong.",
    );

    expect(
      await rejectionOf(
        getPushSubscription({
          pushManager: pushManager({
            existing: null,
            subscribeError: failure,
          }) as unknown as PushManager,
          vapidPublicKey: VAPID_PUBLIC_KEY,
        }),
      ),
    ).toBe(failure);
  });

  test("a server key that is not one is refused before the browser is asked", async () => {
    const manager: ReturnType<typeof pushManager> = pushManager({
      existing: null,
    });

    expectProblem(
      await rejectionOf(
        getPushSubscription({
          pushManager: manager as unknown as PushManager,
          vapidPublicKey: "",
        }),
      ),
      BrowserPushProblem.NotConfigured,
    );
    expect(manager.getSubscription).not.toHaveBeenCalled();
  });

  test("keys are compared byte for byte, whatever view holds them", () => {
    const key: Uint8Array = decodeVapidPublicKey(VAPID_PUBLIC_KEY)!;
    const padded: Uint8Array = new Uint8Array(key.length + 2);
    padded.set(key, 1);

    expect(
      isSubscribedWithKey(
        {
          options: {
            applicationServerKey: new DataView(padded.buffer, 1, key.length),
          },
        } as unknown as PushSubscription,
        key,
      ),
    ).toBe(true);

    expect(
      isSubscribedWithKey(
        {
          options: { applicationServerKey: key.buffer.slice(0, 64) },
        } as unknown as PushSubscription,
        key,
      ),
    ).toBe(false);
  });

  test("an error that is already a BrowserPushError is kept", () => {
    const error: BrowserPushError = new BrowserPushError(
      BrowserPushProblem.TimedOut,
    );

    expect(toBrowserPushError(error)).toBe(error);
  });
});

describe("remembering which device this browser is", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("per project", () => {
    setThisBrowserDeviceId({ projectId: "project-a", deviceId: "device-1" });
    setThisBrowserDeviceId({ projectId: "project-b", deviceId: "device-2" });

    expect(getThisBrowserDeviceId("project-a")).toBe("device-1");
    expect(getThisBrowserDeviceId("project-b")).toBe("device-2");
    expect(getThisBrowserDeviceId("project-c")).toBeNull();
  });

  test("registering again in a project replaces what was remembered", () => {
    setThisBrowserDeviceId({ projectId: "project-a", deviceId: "device-1" });
    setThisBrowserDeviceId({ projectId: "project-a", deviceId: "device-3" });

    expect(getThisBrowserDeviceId("project-a")).toBe("device-3");
  });

  test("without a project there is nothing to remember", () => {
    setThisBrowserDeviceId({ projectId: undefined, deviceId: "device-1" });

    expect(getThisBrowserDeviceId(undefined)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  test("a browser with storage switched off is not an error", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: storage is disabled");
    });
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage is disabled");
    });

    expect(() => {
      setThisBrowserDeviceId({ projectId: "project-a", deviceId: "device-1" });
    }).not.toThrow();
    expect(getThisBrowserDeviceId("project-a")).toBeNull();
  });
});

test("every problem has something to tell the person", () => {
  for (const problem of Object.values(BrowserPushProblem)) {
    const error: BrowserPushError = new BrowserPushError(problem);

    expect(BROWSER_PUSH_PROBLEM_MESSAGES[problem]).toMatch(/\.$/);
    expect(error.message).toBe(BROWSER_PUSH_PROBLEM_MESSAGES[problem]);
    expect(error.problem).toBe(problem);
  }
});
