import type { NotificationResponse } from "expo-notifications";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Two things a tapped push can now ask for besides opening its record:
 *
 * - Acknowledge or Escalate, tapped under a page's push on the lock screen
 *   (notifications/categories.ts). The record opens with the action in its
 *   params - held through a cold start, the sign-in and the biometric lock
 *   like any tapped page - and the record's screen does it once.
 * - The dashboard page of something the app has no screen for: a scheduled
 *   hunt that found security events, a scheduled maintenance event. It opens
 *   in the browser, and only when it is a page of the OneUptime the app is
 *   signed in to.
 *
 * The navigator is a stand-in, as in handlers.test.ts: what is asserted is
 * where the push is sent and what it carries.
 */

jest.mock("expo-linking", () => {
  return {
    openURL: jest.fn(async () => {
      return true;
    }),
  };
});

jest.mock("../storage/serverUrl", () => {
  return {
    getServerUrl: jest.fn(async () => {
      return "https://oneuptime.example.com";
    }),
  };
});

type HandlersModule = typeof import("./handlers");

interface RecordedNavigation {
  routeName: string;
  screen: string;
  params: Record<string, unknown>;
}

interface FakeContainer {
  ref: unknown;
  navigations: Array<RecordedNavigation>;
  mount: (routeNames: Array<string> | null) => void;
}

const MAIN_TAB_ROUTES: Array<string> = [
  "Home",
  "Monitors",
  "Inbox",
  "OnCall",
  "Settings",
];
const AUTH_STACK_ROUTES: Array<string> = ["ServerUrl", "Login", "SSOLogin"];

function createContainer(initial: Array<string> | null): FakeContainer {
  let routeNames: Array<string> | null = initial;
  const navigations: Array<RecordedNavigation> = [];

  return {
    ref: {
      isReady: (): boolean => {
        return routeNames !== null;
      },
      getRootState: (): { routeNames: Array<string> } | undefined => {
        return routeNames === null ? undefined : { routeNames };
      },
      navigate: (
        routeName: string,
        options: {
          screen?: string;
          params?: Record<string, unknown>;
          state?: {
            index?: number;
            routes: Array<{ name: string; params?: Record<string, unknown> }>;
          };
        },
      ): void => {
        const routes: Array<{
          name: string;
          params?: Record<string, unknown>;
        }> = options.state?.routes ?? [];
        const destination:
          | { name: string; params?: Record<string, unknown> }
          | undefined = routes[options.state?.index ?? routes.length - 1];
        navigations.push({
          routeName,
          screen: options.screen ?? destination?.name ?? "",
          params: options.params ?? destination?.params ?? {},
        });
      },
    },
    navigations,
    mount: (next: Array<string> | null): void => {
      routeNames = next;
    },
  };
}

const ACKNOWLEDGE_PAGE: string = "ACKNOWLEDGE_PAGE";
const ESCALATE_PAGE: string = "ESCALATE_PAGE";
const DEFAULT_ACTION: string = "expo.modules.notifications.actions.DEFAULT";

function tap(
  data: Record<string, unknown>,
  actionIdentifier: string = DEFAULT_ACTION,
  identifier: string = "notification-1",
): NotificationResponse {
  return {
    actionIdentifier,
    notification: { request: { identifier, content: { data } } },
  } as unknown as NotificationResponse;
}

function loadHandlers(): HandlersModule {
  jest.resetModules();
  return jest.requireActual<HandlersModule>("./handlers");
}

function openURLMock(): jest.Mock<(url: string) => Promise<true>> {
  return jest.requireMock<{
    openURL: jest.Mock<(url: string) => Promise<true>>;
  }>("expo-linking").openURL;
}

function serverUrlMock(): jest.Mock<() => Promise<string>> {
  return jest.requireMock<{ getServerUrl: jest.Mock<() => Promise<string>> }>(
    "../storage/serverUrl",
  ).getServerUrl;
}

// Lets the browser check's promise (the stored server address) settle.
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 5; turn += 1) {
    await Promise.resolve();
  }
}

describe("Acknowledge and Escalate under a page's push", () => {
  let handlers: HandlersModule;
  let container: FakeContainer;

  beforeEach(() => {
    handlers = loadHandlers();
    container = createContainer(MAIN_TAB_ROUTES);
    handlers.setNavigationRef(container.ref);
  });

  test.each([
    ["incident", "IncidentDetail", { incidentId: "inc-1" }],
    ["alert", "AlertDetail", { alertId: "inc-1" }],
    ["incident-episode", "IncidentEpisodeDetail", { episodeId: "inc-1" }],
    ["alert-episode", "AlertEpisodeDetail", { episodeId: "inc-1" }],
  ] as Array<[string, string, Record<string, string>]>)(
    "Acknowledge on a %s's push opens it with the action for its screen",
    (entityType: string, screen: string, ids: Record<string, string>) => {
      handlers.handleNotificationResponse(
        tap(
          { entityType, entityId: "inc-1", projectId: "proj-1" },
          ACKNOWLEDGE_PAGE,
          "n-42",
        ),
      );

      expect(container.navigations).toEqual([
        {
          routeName: "Inbox",
          screen,
          params: {
            ...ids,
            projectId: "proj-1",
            pushAction: { kind: "acknowledge", id: "n-42:ACKNOWLEDGE_PAGE" },
          },
        },
      ]);
    },
  );

  test("Escalate opens the record with Escalate for its screen to ask about", () => {
    handlers.handleNotificationResponse(
      tap(
        { entityType: "incident", entityId: "inc-9", projectId: "proj-1" },
        ESCALATE_PAGE,
        "n-43",
      ),
    );

    expect(container.navigations[0]?.params).toEqual({
      incidentId: "inc-9",
      projectId: "proj-1",
      pushAction: { kind: "escalate", id: "n-43:ESCALATE_PAGE" },
    });
  });

  test("a plain tap on the same push opens the record with no action", () => {
    handlers.handleNotificationResponse(
      tap({ entityType: "incident", entityId: "inc-1", projectId: "proj-1" }),
    );

    expect(container.navigations[0]?.params).toEqual({
      incidentId: "inc-1",
      projectId: "proj-1",
    });
  });

  test("an action can never come from the push's own data - only from the button tapped", () => {
    handlers.handleNotificationResponse(
      tap({
        entityType: "incident",
        entityId: "inc-1",
        projectId: "proj-1",
        pushAction: { kind: "acknowledge", id: "from-the-payload" },
      }),
    );

    expect(container.navigations[0]?.params).toEqual({
      incidentId: "inc-1",
      projectId: "proj-1",
    });
  });

  test("an action on something with no page actions - a monitor - opens it as a tap would", () => {
    handlers.handleNotificationResponse(
      tap(
        { entityType: "monitor", entityId: "mon-1", projectId: "proj-1" },
        ACKNOWLEDGE_PAGE,
      ),
    );

    expect(container.navigations).toEqual([
      {
        routeName: "Monitors",
        screen: "MonitorDetail",
        params: { monitorId: "mon-1", projectId: "proj-1" },
      },
    ]);
  });
});

describe("an action tapped before the app can show the record", () => {
  test("is held through the sign-in and the lock, with its action, and delivered once", () => {
    const handlers: HandlersModule = loadHandlers();
    const container: FakeContainer = createContainer(AUTH_STACK_ROUTES);
    handlers.setNavigationRef(container.ref);

    handlers.handleNotificationResponse(
      tap(
        { entityType: "alert", entityId: "alert-1", projectId: "proj-1" },
        ACKNOWLEDGE_PAGE,
        "n-50",
      ),
    );
    handlers.processPendingNotification();
    expect(container.navigations).toEqual([]);

    // Behind the biometric lock: nothing registered with the container yet.
    container.mount(null);
    handlers.processPendingNotification();
    expect(container.navigations).toEqual([]);

    container.mount(MAIN_TAB_ROUTES);
    handlers.processPendingNotification();
    handlers.processPendingNotification();

    expect(container.navigations).toEqual([
      {
        routeName: "Inbox",
        screen: "AlertDetail",
        params: {
          alertId: "alert-1",
          projectId: "proj-1",
          pushAction: { kind: "acknowledge", id: "n-50:ACKNOWLEDGE_PAGE" },
        },
      },
    ]);
  });

  test("waits while the app switches to the push's project, then opens it with its action", () => {
    const handlers: HandlersModule = loadHandlers();
    const container: FakeContainer = createContainer(MAIN_TAB_ROUTES);
    handlers.setNavigationRef(container.ref);
    let switching: boolean = true;
    handlers.setProjectNavigationGuard(() => {
      return switching ? "switching" : "ready";
    });

    handlers.handleNotificationResponse(
      tap(
        { entityType: "incident", entityId: "inc-2", projectId: "proj-2" },
        ESCALATE_PAGE,
        "n-51",
      ),
    );
    expect(container.navigations).toEqual([]);

    switching = false;
    handlers.processPendingNotification();

    expect(container.navigations[0]?.params).toEqual({
      incidentId: "inc-2",
      projectId: "proj-2",
      pushAction: { kind: "escalate", id: "n-51:ESCALATE_PAGE" },
    });
    handlers.setProjectNavigationGuard(null);
  });
});

describe("a push about something the app has no screen for opens its page", () => {
  const PROJECT_ID: string = "6f8a1c2e-1111-4a6e-9c55-0d2b3c4e5f60";
  const HUNT_PAGE: string = `https://oneuptime.example.com/dashboard/${PROJECT_ID}/security-events/hunts/0b6f1e9c-2222-4d1a-8e33-9a0b1c2d3e4f`;
  let handlers: HandlersModule;
  let container: FakeContainer;

  beforeEach(() => {
    handlers = loadHandlers();
    container = createContainer(MAIN_TAB_ROUTES);
    handlers.setNavigationRef(container.ref);
  });

  test("a hunt that found security events opens the hunt's page in the browser, and navigates nowhere", async () => {
    handlers.handleNotificationResponse(
      tap({
        type: "security-hunt-found",
        entityType: "security-hunt",
        entityId: "0b6f1e9c-2222-4d1a-8e33-9a0b1c2d3e4f",
        projectId: PROJECT_ID,
        url: HUNT_PAGE,
      }),
    );
    await settle();

    expect(openURLMock()).toHaveBeenCalledWith(HUNT_PAGE);
    expect(container.navigations).toEqual([]);
  });

  test("so does a scheduled maintenance event", async () => {
    const page: string = `https://oneuptime.example.com/dashboard/${PROJECT_ID}/scheduled-maintenance-events/1`;

    handlers.handleNotificationResponse(
      tap({
        entityType: "scheduled-maintenance",
        entityId: "sm-1",
        projectId: PROJECT_ID,
        url: page,
      }),
    );
    await settle();

    expect(openURLMock()).toHaveBeenCalledWith(page);
  });

  test("it opens even before the app can show anything - signed out, behind the lock - since the app shows nothing for it", async () => {
    container.mount(null);

    handlers.handleNotificationResponse(
      tap({
        entityType: "security-hunt",
        entityId: "hunt-1",
        projectId: PROJECT_ID,
        url: HUNT_PAGE,
      }),
    );
    await settle();

    expect(openURLMock()).toHaveBeenCalledWith(HUNT_PAGE);
  });

  test("a page on another server - or no page at all - opens nothing", async () => {
    for (const url of [
      `https://phishing.example.net/dashboard/${PROJECT_ID}/security-events/hunts/1`,
      "javascript:alert(1)",
      undefined,
    ]) {
      handlers.handleNotificationResponse(
        tap({
          entityType: "security-hunt",
          entityId: "hunt-1",
          projectId: PROJECT_ID,
          ...(url ? { url } : {}),
        }),
      );
    }
    await settle();

    expect(openURLMock()).not.toHaveBeenCalled();
    expect(container.navigations).toEqual([]);
  });

  test("the server's address is read when the push is tapped: a different OneUptime opens nothing", async () => {
    serverUrlMock().mockResolvedValueOnce("https://other.example.com");

    handlers.handleNotificationResponse(
      tap({
        entityType: "security-hunt",
        entityId: "hunt-1",
        projectId: PROJECT_ID,
        url: HUNT_PAGE,
      }),
    );
    await settle();

    expect(openURLMock()).not.toHaveBeenCalled();
  });

  test("a browser that cannot open it, or a store that cannot be read, is no crash", async () => {
    openURLMock().mockRejectedValueOnce(new Error("No browser"));
    handlers.handleNotificationResponse(
      tap({ entityType: "security-hunt", entityId: "h", url: HUNT_PAGE }),
    );
    await settle();

    serverUrlMock().mockRejectedValueOnce(new Error("Storage unavailable"));
    handlers.handleNotificationResponse(
      tap({ entityType: "security-hunt", entityId: "h", url: HUNT_PAGE }),
    );
    await settle();

    expect(container.navigations).toEqual([]);
  });

  test("a push the app has a screen for never goes to the browser", async () => {
    handlers.handleNotificationResponse(
      tap({
        entityType: "incident",
        entityId: "inc-1",
        projectId: PROJECT_ID,
        url: `https://oneuptime.example.com/dashboard/${PROJECT_ID}/incidents/inc-1`,
      }),
    );
    await settle();

    expect(openURLMock()).not.toHaveBeenCalled();
    expect(container.navigations).toHaveLength(1);
  });

  test("a page the app cannot show never takes the slot of one it can", async () => {
    container.mount(AUTH_STACK_ROUTES);
    handlers.handleNotificationResponse(
      tap({ entityType: "incident", entityId: "inc-1", projectId: "proj-1" }),
    );
    handlers.handleNotificationResponse(
      tap({ entityType: "security-hunt", entityId: "h", url: HUNT_PAGE }),
    );
    await settle();

    container.mount(MAIN_TAB_ROUTES);
    handlers.processPendingNotification();

    expect(container.navigations).toEqual([
      {
        routeName: "Inbox",
        screen: "IncidentDetail",
        params: { incidentId: "inc-1", projectId: "proj-1" },
      },
    ]);
  });
});
