import {
  APIRequestContext,
  BrowserContext,
  CDPSession,
  ConsoleMessage,
  expect,
  Locator,
  Page,
  test,
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
 * subscribe and getSubscription are stood in for, answering as a browser
 * with a push service would. The permission prompt, the service worker,
 * the page and the API requests are the real ones.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

const ROUTE: string = `/dashboard/${PROJECT_ID}/user-settings/notification-methods`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/push-registration-ui",
);

// What the stand-in push service hands this browser.
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
}

interface FixtureState {
  devices: Array<StoredDevice>;
  registrations: Array<Record<string, unknown>>;
  testNotifications: Array<{
    deviceId: string;
    body: Record<string, unknown>;
  }>;
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

async function standInForThePushService(
  context: BrowserContext,
): Promise<void> {
  await context.addInitScript((subscription: Record<string, unknown>) => {
    type Stored = Record<string, unknown>;
    const pageWindow: Window & { __pushSubscription?: Stored | null } =
      window as Window & { __pushSubscription?: Stored | null };

    PushManager.prototype.subscribe = async function (
      options?: PushSubscriptionOptionsInit,
    ): Promise<PushSubscription> {
      if (!pageWindow.__pushSubscription) {
        const key: Uint8Array = options?.applicationServerKey as Uint8Array;

        pageWindow.__pushSubscription = {
          endpoint: subscription["endpoint"],
          expirationTime: null,
          options: {
            userVisibleOnly: true,
            applicationServerKey: key.buffer.slice(
              key.byteOffset,
              key.byteOffset + key.byteLength,
            ),
          },
          toJSON: (): Record<string, unknown> => {
            return subscription;
          },
          unsubscribe: async (): Promise<boolean> => {
            pageWindow.__pushSubscription = null;
            return true;
          },
        };
      }

      return pageWindow.__pushSubscription as unknown as PushSubscription;
    };

    PushManager.prototype.getSubscription =
      async (): Promise<PushSubscription | null> => {
        return (pageWindow.__pushSubscription ||
          null) as unknown as PushSubscription | null;
      };
  }, SUBSCRIPTION);
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
