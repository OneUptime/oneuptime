import {
  APIRequestContext,
  BrowserContext,
  CDPSession,
  ConsoleMessage,
  expect,
  Locator,
  Page,
  test,
  Worker,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Register Device (User Settings > Notification Methods > Push
 * Notifications) in Chromium, against the offline fixture: the real Push
 * component, the Dashboard's real service worker and the service worker
 * script index.ejs ships.
 *
 * A customer reported two things, both reproduced here on the code before
 * the fix:
 *
 *   1. Register Device, allow the browser's prompt - and the page refreshed,
 *      and the new browser was not in the list. Registering installs the
 *      service worker, the worker takes control of the page, and index.ejs
 *      reloaded the page whenever its worker changed - the first time too.
 *   2. After a hard refresh, Register Device said "Project ID is invalid".
 *      The Dashboard sent the project as the ObjectID itself, which goes
 *      over the wire as { _type, value }. The fixture's register route
 *      refuses that as the real route did; the server now reads both
 *      (UserPushRegistration.test.ts in Common).
 *
 * Chromium here has no push service, and it refuses push in a context like
 * a Playwright one as it does in an incognito window. PushManager's
 * subscribe and getSubscription are stood in for, in the page and in the
 * worker (Fixture/PushServiceStandIn.js), answering as a browser with a push
 * service would: one subscription per browser, which a test can have the
 * push service replace or drop. The permission prompt, the service worker,
 * the page, the session cookies and the API requests are the real ones.
 *
 * The browser replaces a push subscription when the push service expires or
 * rotates it, and fires pushsubscriptionchange in the worker. The worker used
 * to re-subscribe without the server's key, which every browser refuses, and
 * PUT the result to /api/push-subscription, which never existed: the
 * browser's devices kept the dead subscription, and nothing said so. The
 * second half of this file runs the real worker through that event.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

// The key the fixture server's page is configured with (Fixture/server.js).
const VAPID_PUBLIC_KEY: string =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

// The lock the Dashboard refreshes its session under (Common/UI/Utils/API/API.ts).
const SESSION_REFRESH_LOCK: string = "oneuptime-session-refresh:dashboard";

const PUSH_SERVICE_STAND_IN: string = path.resolve(
  __dirname,
  "Fixture/PushServiceStandIn.js",
);

const ROUTE: string = `/dashboard/${PROJECT_ID}/user-settings/notification-methods`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/push-registration-ui",
);

// What the stand-in push service hands this browser first.
const SUBSCRIPTION: Record<string, unknown> = {
  endpoint: "https://fcm.googleapis.com/fcm/send/fixture-browser",
  expirationTime: null,
  keys: { p256dh: "BFixtureP256dhKey", auth: "FixtureAuthSecret" },
};

const BLOCKED_MESSAGE: string =
  "Notifications are blocked for OneUptime in this browser. Click the icon at the left of the address bar, allow notifications for this site, and then register this browser again. Private and incognito windows block them for every site: use a regular window.";

const DISMISSED_MESSAGE: string =
  "The browser's permission prompt closed without an answer. Register this browser again and choose Allow when the browser asks.";

interface StoredDevice {
  id: string;
  deviceName: string;
  deviceToken: string;
  isVerified: boolean;
}

// A subscription as the stand-in push service holds it.
interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  applicationServerKey: Array<number>;
}

interface FixtureState {
  devices: Array<StoredDevice>;
  registrations: Array<Record<string, unknown>>;
  testNotifications: Array<{
    deviceId: string;
    body: Record<string, unknown>;
  }>;
  subscriptionChanges: Array<{
    status: number;
    body: Record<string, unknown>;
  }>;
  sessionRefreshes: Array<{ status: number }>;
  subscribes: Array<{
    subscriber: string;
    applicationServerKey: Array<number>;
  }>;
  // This browser's subscription now, as a device token, or null.
  browserSubscription: string | null;
}

// A call to navigator.serviceWorker.register, and what came of it.
interface WorkerRegistrationCall {
  scriptURL: string;
  options: RegistrationOptions | null;
  outcome: string;
}

type RecordingWindow = Window & {
  __workerRegistrations?: Array<WorkerRegistrationCall>;
};

// What index.ejs logged on every page load when the browser refused its registration.
const REFUSED_REGISTRATION_LOG: RegExp = /SecurityError|registration failed/i;

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(
  async ({
    context,
    page,
    request,
  }: {
    context: BrowserContext;
    page: Page;
    request: APIRequestContext;
  }) => {
    await request.post("/__fixture/reset");
    await standInForThePushService(context);

    const errors: Array<string> = [];
    pageErrors.set(page, errors);
    page.on("pageerror", (error: Error) => {
      errors.push(error.message);
    });
  },
);

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

// The fixture server appends the same stand-in to the worker it serves.
async function standInForThePushService(
  context: BrowserContext,
): Promise<void> {
  await context.addInitScript({ path: PUSH_SERVICE_STAND_IN });
}

/*
 * Every call any script on the page makes to navigator.serviceWorker.register,
 * the page's own and Register Device's, with the scope it was given or the
 * error the browser refused it with.
 */
async function recordWorkerRegistrations(
  context: BrowserContext,
): Promise<void> {
  await context.addInitScript(() => {
    const calls: Array<WorkerRegistrationCall> = [];
    (window as RecordingWindow).__workerRegistrations = calls;

    const register: ServiceWorkerContainer["register"] =
      ServiceWorkerContainer.prototype.register;

    ServiceWorkerContainer.prototype.register = function (
      this: ServiceWorkerContainer,
      scriptURL: string | URL,
      options?: RegistrationOptions,
    ): Promise<ServiceWorkerRegistration> {
      const call: WorkerRegistrationCall = {
        scriptURL: String(scriptURL),
        options: options || null,
        outcome: "pending",
      };
      calls.push(call);

      return register.call(this, scriptURL, options).then(
        (registration: ServiceWorkerRegistration) => {
          call.outcome = `registered for ${new URL(registration.scope).pathname}`;
          return registration;
        },
        (error: Error) => {
          call.outcome = error.name;
          throw error;
        },
      );
    };
  });
}

async function workerRegistrations(
  page: Page,
): Promise<Array<WorkerRegistrationCall>> {
  return await page.evaluate((): Array<WorkerRegistrationCall> => {
    return (window as RecordingWindow).__workerRegistrations || [];
  });
}

async function fixtureState(request: APIRequestContext): Promise<FixtureState> {
  return (await (await request.get("/__fixture/state")).json()) as FixtureState;
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: false,
    animations: "disabled",
  });
}

function row(page: Page, deviceName: string): Locator {
  return page.locator("tbody tr").filter({ hasText: deviceName });
}

function dialog(page: Page): Locator {
  return page.getByTestId("modal");
}

async function openThePage(page: Page): Promise<void> {
  await page.goto(ROUTE);
  await expect(row(page, "iPhone 14 Pro Max")).toBeVisible();
}

/*
 * A mark that only this load of the page carries: gone after any reload,
 * whatever caused it.
 */
async function markThisLoad(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as Window & { __thisLoad?: boolean }).__thisLoad = true;
  });
}

async function isSameLoad(page: Page): Promise<boolean> {
  return await page.evaluate((): boolean => {
    return (window as Window & { __thisLoad?: boolean }).__thisLoad === true;
  });
}

async function controllingWorker(page: Page): Promise<string | null> {
  return await page.evaluate((): string | null => {
    return navigator.serviceWorker.controller?.scriptURL || null;
  });
}

async function registerThisBrowser(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Register Device" }).click();
  await dialog(page).getByRole("button", { name: "Register Device" }).click();
}

test("the first registration installs the service worker without reloading the page, and lists this browser", async ({
  page,
  context,
  request,
}: {
  page: Page;
  context: BrowserContext;
  request: APIRequestContext;
}) => {
  await context.grantPermissions(["notifications"]);
  await openThePage(page);

  // The page does not install the worker itself, so there is none yet.
  expect(
    await page.evaluate(async (): Promise<boolean> => {
      return Boolean(await navigator.serviceWorker.getRegistration());
    }),
  ).toBe(false);
  expect(await controllingWorker(page)).toBeNull();

  await markThisLoad(page);

  await page.getByRole("button", { name: "Register Device" }).click();
  await expect(dialog(page).getByRole("textbox")).toHaveValue(
    "Chrome on Windows",
  );
  await dialog(page).getByRole("button", { name: "Register Device" }).click();

  await expect(page.getByTestId("modal-title")).toHaveText(
    "Browser Registered",
  );

  // The worker took control of the page: the moment index.ejs used to reload it.
  await expect
    .poll(async () => {
      return await controllingWorker(page);
    })
    .toMatch(/\/dashboard\/sw\.js$/);
  expect(await isSameLoad(page)).toBe(true);

  expect((await fixtureState(request)).registrations).toEqual([
    {
      projectId: PROJECT_ID,
      deviceToken: JSON.stringify(SUBSCRIPTION),
      deviceType: "web",
      deviceName: "Chrome on Windows",
    },
  ]);

  await screenshot(page, "registered-dialog-synthetic");

  await dialog(page).getByTestId("modal-footer-close-button").click();

  await expect(row(page, "Chrome on Windows")).toContainText("This browser");
  await expect(row(page, "iPhone 14 Pro Max")).not.toContainText(
    "This browser",
  );
  expect(await isSameLoad(page)).toBe(true);

  await screenshot(page, "device-list-synthetic");

  // And it is still there, and still this browser, on the next visit.
  await page.reload();
  await expect(row(page, "Chrome on Windows")).toContainText("This browser");
});

test("the page registers no service worker of its own: Register Device's, with the default scope, is the only one", async ({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) => {
  await context.grantPermissions(["notifications"]);
  await recordWorkerRegistrations(context);

  const consoleMessages: Array<string> = [];
  page.on("console", (message: ConsoleMessage) => {
    consoleMessages.push(message.text());
  });

  await openThePage(page);
  // index.ejs registered the worker, with scope "/", from the load event.
  await page.waitForLoadState("load");

  expect(await workerRegistrations(page)).toEqual([]);

  await registerThisBrowser(page);
  await expect(page.getByTestId("modal-title")).toHaveText(
    "Browser Registered",
  );

  expect(await workerRegistrations(page)).toEqual([
    {
      scriptURL: "/dashboard/sw.js",
      options: null,
      outcome: "registered for /dashboard/",
    },
  ]);

  expect(
    consoleMessages.filter((text: string): boolean => {
      return REFUSED_REGISTRATION_LOG.test(text);
    }),
  ).toEqual([]);
});

test("the registered dialog sends a test notification to the device it just registered", async ({
  page,
  context,
  request,
}: {
  page: Page;
  context: BrowserContext;
  request: APIRequestContext;
}) => {
  await context.grantPermissions(["notifications"]);
  await openThePage(page);
  await registerThisBrowser(page);

  await expect(page.getByTestId("modal-title")).toHaveText(
    "Browser Registered",
  );

  await dialog(page)
    .getByRole("button", { name: "Send Test Notification" })
    .click();

  await expect(page.getByTestId("modal-title")).toHaveText(
    "Test Notification Sent Successfully",
  );

  const state: FixtureState = await fixtureState(request);
  const registered: StoredDevice | undefined = state.devices.find(
    (device: StoredDevice): boolean => {
      return device.deviceName === "Chrome on Windows";
    },
  );

  expect(registered).toBeDefined();
  expect(state.testNotifications).toEqual([
    { deviceId: registered!.id, body: { projectId: PROJECT_ID } },
  ]);
});

test("registering the same browser again says it is already registered, and adds nothing", async ({
  page,
  context,
  request,
}: {
  page: Page;
  context: BrowserContext;
  request: APIRequestContext;
}) => {
  await context.grantPermissions(["notifications"]);
  await openThePage(page);
  await registerThisBrowser(page);

  await expect(page.getByTestId("modal-title")).toHaveText(
    "Browser Registered",
  );
  await dialog(page).getByTestId("modal-footer-close-button").click();
  await expect(row(page, "Chrome on Windows")).toBeVisible();

  await registerThisBrowser(page);

  await expect(page.getByTestId("modal-title")).toHaveText(
    "This Browser Is Already Registered",
  );
  await screenshot(page, "already-registered-synthetic");

  const state: FixtureState = await fixtureState(request);

  // The same subscription both times: one browser, one device.
  expect(state.registrations).toHaveLength(2);
  expect(state.registrations[1]!["deviceToken"]).toBe(
    state.registrations[0]!["deviceToken"],
  );
  expect(state.devices).toHaveLength(2);
});

test("after a hard refresh, which loads the page past its service worker, the browser registers", async ({
  page,
  context,
  request,
}: {
  page: Page;
  context: BrowserContext;
  request: APIRequestContext;
}) => {
  await context.grantPermissions(["notifications"]);
  await openThePage(page);

  // Where the customer was after the first attempt: the worker installed, nothing registered.
  await page.evaluate(async (): Promise<void> => {
    await navigator.serviceWorker.register("/dashboard/sw.js");
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(async () => {
      return await controllingWorker(page);
    })
    .toMatch(/\/dashboard\/sw\.js$/);

  // Shift+Refresh.
  const devtools: CDPSession = await context.newCDPSession(page);
  await Promise.all([
    page.waitForEvent("load"),
    devtools.send("Page.reload", { ignoreCache: true }),
  ]);
  await expect(row(page, "iPhone 14 Pro Max")).toBeVisible();
  expect(await controllingWorker(page)).toBeNull();

  await markThisLoad(page);
  await registerThisBrowser(page);

  await expect(page.getByTestId("modal-title")).toHaveText(
    "Browser Registered",
  );
  expect(await isSameLoad(page)).toBe(true);

  const state: FixtureState = await fixtureState(request);

  expect(state.registrations).toHaveLength(1);
  expect(state.registrations[0]!["projectId"]).toBe(PROJECT_ID);
  expect(state.devices).toHaveLength(2);
});

test("a permission prompt closed without an answer: the dialog says to choose Allow, and registers nothing", async ({
  page,
  request,
}: {
  page: Page;
  request: APIRequestContext;
}) => {
  // Not granted: headless Chromium closes the prompt unanswered.
  await openThePage(page);
  await registerThisBrowser(page);

  await expect(dialog(page).getByText(DISMISSED_MESSAGE)).toBeVisible();
  // The name is still there to register with when they try again.
  await expect(dialog(page).getByRole("textbox")).toHaveValue(
    "Chrome on Windows",
  );

  expect((await fixtureState(request)).registrations).toEqual([]);
  expect(
    await page.evaluate(async (): Promise<boolean> => {
      return Boolean(await navigator.serviceWorker.getRegistration());
    }),
  ).toBe(false);
});

test("notifications blocked for the site: the dialog says how to unblock them, and registers nothing", async ({
  page,
  context,
  request,
}: {
  page: Page;
  context: BrowserContext;
  request: APIRequestContext;
}) => {
  // What a browser answers, at once and without a prompt, for a blocked site.
  await context.addInitScript(() => {
    Object.defineProperty(Notification, "permission", {
      get: (): NotificationPermission => {
        return "denied";
      },
    });
    Notification.requestPermission =
      async (): Promise<NotificationPermission> => {
        return "denied";
      };
  });

  await openThePage(page);
  await registerThisBrowser(page);

  await expect(dialog(page).getByText(BLOCKED_MESSAGE)).toBeVisible();
  await screenshot(page, "blocked-synthetic");

  expect((await fixtureState(request)).registrations).toEqual([]);
});

test("a newer service worker taking over from the one that served the page still reloads it", async ({
  page,
  context,
  request,
}: {
  page: Page;
  context: BrowserContext;
  request: APIRequestContext;
}) => {
  await context.grantPermissions(["notifications"]);
  await openThePage(page);
  await registerThisBrowser(page);
  await expect(page.getByTestId("modal-title")).toHaveText(
    "Browser Registered",
  );

  // The next visit is served by the worker from the start.
  await page.reload();
  await expect(row(page, "Chrome on Windows")).toBeVisible();
  expect(await controllingWorker(page)).toMatch(/\/dashboard\/sw\.js$/);

  await markThisLoad(page);

  // A deployment: the server now serves a different worker.
  await request.post("/__fixture/sw-revision");

  await Promise.all([
    page.waitForEvent("load"),
    page
      .evaluate(async (): Promise<void> => {
        const registration: ServiceWorkerRegistration | undefined =
          await navigator.serviceWorker.getRegistration();
        await registration?.update();
      })
      .catch(() => {
        // The reload can take the page away before update() answers.
      }),
  ]);

  await expect(row(page, "Chrome on Windows")).toBeVisible();
  expect(await isSameLoad(page)).toBe(false);
});

// What Register Device and the worker send: PushSubscription.toJSON(), stringified.
function deviceToken(subscription: StoredSubscription): string {
  return JSON.stringify({
    endpoint: subscription.endpoint,
    expirationTime: null,
    keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
  });
}

function registeredBrowser(state: FixtureState): StoredDevice {
  return state.devices.find((device: StoredDevice): boolean => {
    return device.deviceName === "Chrome on Windows";
  })!;
}

// The session cookies, set in the browser as signing in sets them.
async function signIn(context: BrowserContext): Promise<void> {
  expect((await context.request.post("/__fixture/sign-in")).ok()).toBe(true);
}

async function registerAndClose(page: Page): Promise<void> {
  await registerThisBrowser(page);
  await expect(page.getByTestId("modal-title")).toHaveText(
    "Browser Registered",
  );
  await dialog(page).getByTestId("modal-footer-close-button").click();
  await expect(row(page, "Chrome on Windows")).toBeVisible();
}

async function dashboardWorker(context: BrowserContext): Promise<Worker> {
  const isDashboardWorker: (worker: Worker) => boolean = (
    worker: Worker,
  ): boolean => {
    return new URL(worker.url()).pathname === "/dashboard/sw.js";
  };

  return (
    context.serviceWorkers().find(isDashboardWorker) ||
    (await context.waitForEvent("serviceworker", {
      predicate: isDashboardWorker,
    }))
  );
}

// What the worker keeps in IndexedDB (sw.js.template), read the way it reads it.
async function workerMemory(worker: Worker): Promise<Record<string, unknown>> {
  return await worker.evaluate(async (): Promise<Record<string, unknown>> => {
    const scope: { readPushState: (name: string) => Promise<unknown> } =
      self as unknown as {
        readPushState: (name: string) => Promise<unknown>;
      };

    return {
      vapidPublicKey: await scope.readPushState("vapidPublicKey"),
      registeredSubscription: await scope.readPushState(
        "registeredSubscription",
      ),
    };
  });
}

// Once Register Device has told the worker the server's key, and it knows what it registered.
async function workerHasTheKey(worker: Worker): Promise<void> {
  await expect
    .poll(async () => {
      return await workerMemory(worker);
    })
    .toEqual({
      vapidPublicKey: VAPID_PUBLIC_KEY,
      registeredSubscription: {
        deviceToken: JSON.stringify(SUBSCRIPTION),
        isGone: false,
      },
    });
}

/*
 * pushsubscriptionchange, as the browser fires it in the worker. Given the
 * subscriptions, the event names the one replaced and its replacement
 * (Chrome 138+, Safari, Firefox 137+); without, it names neither, as
 * Firefox did before 137. The worker's work goes on after this returns:
 * finishSubscriptionChange waits for it.
 */
async function startSubscriptionChange(
  worker: Worker,
  subscriptions?: {
    oldSubscription: StoredSubscription | null;
    newSubscription: StoredSubscription | null;
  },
): Promise<void> {
  await worker.evaluate(
    (
      named: {
        oldSubscription: StoredSubscription | null;
        newSubscription: StoredSubscription | null;
      } | null,
    ): void => {
      const scope: {
        __pushServiceStandIn: { toSubscription: (stored: unknown) => unknown };
        __subscriptionChange?: Promise<unknown>;
      } = self as unknown as {
        __pushServiceStandIn: { toSubscription: (stored: unknown) => unknown };
        __subscriptionChange?: Promise<unknown>;
      };

      const event: Event = new Event("pushsubscriptionchange");
      let work: Promise<unknown> = Promise.resolve();

      Object.defineProperty(event, "waitUntil", {
        value: (promise: Promise<unknown>): void => {
          work = promise;
        },
      });

      if (named) {
        Object.defineProperty(event, "oldSubscription", {
          value: scope.__pushServiceStandIn.toSubscription(
            named.oldSubscription,
          ),
        });
        Object.defineProperty(event, "newSubscription", {
          value: scope.__pushServiceStandIn.toSubscription(
            named.newSubscription,
          ),
        });
      }

      self.dispatchEvent(event);
      scope.__subscriptionChange = work;
    },
    subscriptions || null,
  );
}

async function finishSubscriptionChange(worker: Worker): Promise<void> {
  await worker.evaluate(async (): Promise<void> => {
    await (self as unknown as { __subscriptionChange?: Promise<unknown> })
      .__subscriptionChange;
  });
}

async function changeSubscription(
  worker: Worker,
  subscriptions?: {
    oldSubscription: StoredSubscription | null;
    newSubscription: StoredSubscription | null;
  },
): Promise<void> {
  await startSubscriptionChange(worker, subscriptions);
  await finishSubscriptionChange(worker);
}

async function replaceSubscription(request: APIRequestContext): Promise<{
  oldSubscription: StoredSubscription;
  newSubscription: StoredSubscription;
}> {
  return await (await request.post("/__fixture/push-service/replace")).json();
}

test.describe("when the browser replaces its push subscription", () => {
  test.beforeEach(async ({ context }: { context: BrowserContext }) => {
    await context.grantPermissions(["notifications"]);
  });

  test("an event that names both subscriptions (Chrome 138+, Safari, Firefox 137+): the worker reports them, and the device carries the new one", async ({
    page,
    context,
    request,
  }: {
    page: Page;
    context: BrowserContext;
    request: APIRequestContext;
  }) => {
    await signIn(context);
    await openThePage(page);
    await registerAndClose(page);

    const worker: Worker = await dashboardWorker(context);
    await workerHasTheKey(worker);

    const replaced: {
      oldSubscription: StoredSubscription;
      newSubscription: StoredSubscription;
    } = await replaceSubscription(request);
    await changeSubscription(worker, replaced);

    const state: FixtureState = await fixtureState(request);

    expect(state.subscriptionChanges).toEqual([
      {
        status: 200,
        body: {
          oldDeviceToken: JSON.stringify(SUBSCRIPTION),
          newDeviceToken: deviceToken(replaced.newSubscription),
        },
      },
    ]);
    expect(registeredBrowser(state)).toMatchObject({
      deviceToken: deviceToken(replaced.newSubscription),
      isVerified: true,
    });

    // The worker remembers the new one, for the next change.
    expect(await workerMemory(worker)).toMatchObject({
      registeredSubscription: {
        deviceToken: deviceToken(replaced.newSubscription),
        isGone: false,
      },
    });
  });

  test("an event that names neither, as before Firefox 137: the worker subscribes again with the key the Dashboard gave it, and renews the device it registered", async ({
    page,
    context,
    request,
  }: {
    page: Page;
    context: BrowserContext;
    request: APIRequestContext;
  }) => {
    await signIn(context);
    await openThePage(page);
    await registerAndClose(page);

    const worker: Worker = await dashboardWorker(context);
    await workerHasTheKey(worker);

    await request.post("/__fixture/push-service/drop");
    await changeSubscription(worker);

    const state: FixtureState = await fixtureState(request);

    // Subscribed with the server's key - not applicationServerKey: null.
    expect(state.subscribes).toEqual([
      {
        subscriber: "page",
        applicationServerKey: Array.from(
          Buffer.from(VAPID_PUBLIC_KEY, "base64url"),
        ),
      },
      {
        subscriber: "worker",
        applicationServerKey: Array.from(
          Buffer.from(VAPID_PUBLIC_KEY, "base64url"),
        ),
      },
    ]);
    expect(state.browserSubscription).not.toBe(JSON.stringify(SUBSCRIPTION));
    expect(state.subscriptionChanges).toEqual([
      {
        status: 200,
        body: {
          oldDeviceToken: JSON.stringify(SUBSCRIPTION),
          newDeviceToken: state.browserSubscription,
        },
      },
    ]);
    expect(registeredBrowser(state)).toMatchObject({
      deviceToken: state.browserSubscription,
      isVerified: true,
    });
  });

  test("the access token has expired, as it has whenever no Dashboard is open: the worker refreshes the session once the Dashboard's own refresh is done, and the change goes through", async ({
    page,
    context,
    request,
  }: {
    page: Page;
    context: BrowserContext;
    request: APIRequestContext;
  }) => {
    await signIn(context);
    await openThePage(page);
    await registerAndClose(page);

    const worker: Worker = await dashboardWorker(context);
    await workerHasTheKey(worker);

    // The access token cookie lives for minutes; the refresh token outlives it.
    await context.clearCookies({ name: "user-token" });

    // A Dashboard tab refreshing its session at that moment holds the lock.
    await page.evaluate((lockName: string): Promise<void> => {
      return new Promise<void>((acquired: () => void): void => {
        void navigator.locks.request(lockName, (): Promise<void> => {
          return new Promise<void>((release: () => void): void => {
            (
              window as Window & { __releaseSessionLock?: () => void }
            ).__releaseSessionLock = release;
            acquired();
          });
        });
      });
    }, SESSION_REFRESH_LOCK);

    const replaced: {
      oldSubscription: StoredSubscription;
      newSubscription: StoredSubscription;
    } = await replaceSubscription(request);
    await startSubscriptionChange(worker, replaced);

    // Turned away, the worker waits for the tab's refresh rather than racing it.
    await expect
      .poll(async () => {
        return (await fixtureState(request)).subscriptionChanges.map(
          (change: { status: number }) => {
            return change.status;
          },
        );
      })
      .toEqual([401]);
    await expect
      .poll(async () => {
        return await page.evaluate(
          async (lockName: string): Promise<number> => {
            return ((await navigator.locks.query()).pending || []).filter(
              (lock: LockInfo): boolean => {
                return lock.name === lockName;
              },
            ).length;
          },
          SESSION_REFRESH_LOCK,
        );
      })
      .toBe(1);
    expect((await fixtureState(request)).sessionRefreshes).toEqual([]);

    await page.evaluate((): void => {
      (window as Window & { __releaseSessionLock?: () => void })
        .__releaseSessionLock!();
    });
    await finishSubscriptionChange(worker);

    const state: FixtureState = await fixtureState(request);

    expect(state.sessionRefreshes).toEqual([{ status: 200 }]);
    expect(
      state.subscriptionChanges.map((change: { status: number }) => {
        return change.status;
      }),
    ).toEqual([401, 200]);
    expect(registeredBrowser(state).deviceToken).toBe(
      deviceToken(replaced.newSubscription),
    );
  });

  test("signed out when the browser replaced it: the change is reported the next time the Dashboard opens, signed in", async ({
    page,
    context,
    request,
  }: {
    page: Page;
    context: BrowserContext;
    request: APIRequestContext;
  }) => {
    // No session at all: nothing the worker sends can get through.
    await openThePage(page);
    await registerAndClose(page);

    const worker: Worker = await dashboardWorker(context);
    await workerHasTheKey(worker);

    const replaced: {
      oldSubscription: StoredSubscription;
      newSubscription: StoredSubscription;
    } = await replaceSubscription(request);
    await changeSubscription(worker, replaced);

    let state: FixtureState = await fixtureState(request);

    expect(
      state.subscriptionChanges.map((change: { status: number }) => {
        return change.status;
      }),
    ).toEqual([401]);
    expect(state.sessionRefreshes).toEqual([{ status: 401 }]);
    expect(registeredBrowser(state).deviceToken).toBe(
      JSON.stringify(SUBSCRIPTION),
    );

    await signIn(context);
    await page.reload();
    await expect(row(page, "Chrome on Windows")).toBeVisible();

    await expect
      .poll(async () => {
        return registeredBrowser(await fixtureState(request)).deviceToken;
      })
      .toBe(deviceToken(replaced.newSubscription));

    state = await fixtureState(request);

    expect(state.subscriptionChanges[1]).toEqual({
      status: 200,
      body: {
        oldDeviceToken: JSON.stringify(SUBSCRIPTION),
        newDeviceToken: deviceToken(replaced.newSubscription),
      },
    });
  });

  test("lost while notifications are blocked: the device is reported as no longer receiving them, and the list says so", async ({
    page,
    context,
    request,
  }: {
    page: Page;
    context: BrowserContext;
    request: APIRequestContext;
  }) => {
    await signIn(context);
    await openThePage(page);
    await registerAndClose(page);

    const worker: Worker = await dashboardWorker(context);
    await workerHasTheKey(worker);

    await context.clearPermissions();

    const dropped: { oldSubscription: StoredSubscription } = await (
      await request.post("/__fixture/push-service/drop")
    ).json();
    await changeSubscription(worker, {
      oldSubscription: dropped.oldSubscription,
      newSubscription: null,
    });

    const state: FixtureState = await fixtureState(request);

    // No subscription without permission: the worker did not get one.
    expect(
      state.subscribes.map((subscribe: { subscriber: string }) => {
        return subscribe.subscriber;
      }),
    ).toEqual(["page"]);
    expect(state.subscriptionChanges).toEqual([
      {
        status: 200,
        body: {
          oldDeviceToken: JSON.stringify(SUBSCRIPTION),
          newDeviceToken: null,
        },
      },
    ]);
    expect(registeredBrowser(state).isVerified).toBe(false);

    await page.reload();
    await expect(row(page, "Chrome on Windows")).toContainText(
      "Not receiving notifications",
    );
    await expect(row(page, "iPhone 14 Pro Max")).not.toContainText(
      "Not receiving notifications",
    );

    await screenshot(page, "not-receiving-synthetic");
  });

  test("a subscription the push service no longer accepts while the browser still holds it: the list says so, and Register Device renews it", async ({
    page,
    context,
    request,
  }: {
    page: Page;
    context: BrowserContext;
    request: APIRequestContext;
  }) => {
    await signIn(context);
    await openThePage(page);
    await registerAndClose(page);

    // A page to this browser came back 410 (UserPushService.markWebPushSubscriptionAsGone).
    await request.post("/__fixture/push-service/gone");
    await page.reload();
    await expect(row(page, "Chrome on Windows")).toContainText(
      "Not receiving notifications",
    );

    await registerThisBrowser(page);

    // Not "already registered": it did not work, and now it does.
    await expect(page.getByTestId("modal-title")).toHaveText(
      "Browser Registered",
    );
    await dialog(page).getByTestId("modal-footer-close-button").click();
    await expect(row(page, "Chrome on Windows")).toContainText("This browser");
    await expect(row(page, "Chrome on Windows")).not.toContainText(
      "Not receiving notifications",
    );

    const state: FixtureState = await fixtureState(request);

    expect(state.browserSubscription).not.toBe(JSON.stringify(SUBSCRIPTION));
    expect(state.subscriptionChanges[0]).toEqual({
      status: 200,
      body: {
        oldDeviceToken: JSON.stringify(SUBSCRIPTION),
        newDeviceToken: state.browserSubscription,
      },
    });
    // The device it had, renewed: the phone and this browser, as before.
    expect(state.devices).toHaveLength(2);
    expect(registeredBrowser(state)).toMatchObject({
      deviceToken: state.browserSubscription,
      isVerified: true,
    });
  });
});
