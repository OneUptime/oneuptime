import type { NotificationResponse } from "expo-notifications";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A TEST PAGE'S PUSH (#7014, oncall/testPage.ts).
 *
 * A test page is about no record. Its push names the test page's own
 * category, and a tap - on the notification, or on "Acknowledge test page"
 * under it - opens the test page's own screen in On-Call, never a record's.
 * Only the test page's own action makes that screen acknowledge it, once per
 * tap; a real page's actions and a test page's are never read as each
 * other's. It is held through the sign-in, the lock and a project switch
 * like any tapped page.
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

const ACKNOWLEDGE_TEST_PAGE: string = "ACKNOWLEDGE_TEST_PAGE";
const ACKNOWLEDGE_PAGE: string = "ACKNOWLEDGE_PAGE";
const ESCALATE_PAGE: string = "ESCALATE_PAGE";
const MARK_PAGE_SEEN: string = "MARK_PAGE_SEEN";
const DEFAULT_ACTION: string = "expo.modules.notifications.actions.DEFAULT";

// A test page's push, as PushNotificationUtil.createTestPageNotification sends it.
const TEST_PAGE_PUSH: Record<string, unknown> = {
  type: "test-page",
  entityType: "test-page",
  entityId: "message-1",
  projectId: "proj-1",
  url: "https://oneuptime.example.com/api/user-on-call-log-timeline/acknowledge-page/message-1",
};

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

function dismissMock(): jest.Mock<(identifier: string) => Promise<void>> {
  return jest.requireMock<{
    dismissNotificationAsync: jest.Mock<(identifier: string) => Promise<void>>;
  }>("expo-notifications").dismissNotificationAsync;
}

function openURLMock(): jest.Mock<(url: string) => Promise<true>> {
  return jest.requireMock<{
    openURL: jest.Mock<(url: string) => Promise<true>>;
  }>("expo-linking").openURL;
}

async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 5; turn += 1) {
    await Promise.resolve();
  }
}

describe("a test page's push", () => {
  let handlers: HandlersModule;
  let container: FakeContainer;

  beforeEach(() => {
    handlers = loadHandlers();
    container = createContainer(MAIN_TAB_ROUTES);
    handlers.setNavigationRef(container.ref);
    dismissMock().mockClear();
    openURLMock().mockClear();
  });

  test("a tap opens the test page's own screen in On-Call, with nothing to do but show it", () => {
    handlers.handleNotificationResponse(tap(TEST_PAGE_PUSH));

    expect(container.navigations).toEqual([
      {
        routeName: "OnCall",
        screen: "TestPage",
        params: { messageId: "message-1", projectId: "proj-1" },
      },
    ]);
  });

  test("Acknowledge test page opens it with that tap's id, for the screen to acknowledge it once", () => {
    handlers.handleNotificationResponse(
      tap(TEST_PAGE_PUSH, ACKNOWLEDGE_TEST_PAGE, "n-80"),
    );

    expect(container.navigations).toEqual([
      {
        routeName: "OnCall",
        screen: "TestPage",
        params: {
          messageId: "message-1",
          projectId: "proj-1",
          acknowledgeRequestId: "n-80:ACKNOWLEDGE_TEST_PAGE",
        },
      },
    ]);
  });

  test("a second tap of the action, on another push, is a new request", () => {
    handlers.handleNotificationResponse(
      tap(TEST_PAGE_PUSH, ACKNOWLEDGE_TEST_PAGE, "n-81"),
    );
    handlers.handleNotificationResponse(
      tap(
        { ...TEST_PAGE_PUSH, entityId: "message-2" },
        ACKNOWLEDGE_TEST_PAGE,
        "n-82",
      ),
    );

    expect(
      container.navigations.map((navigation: RecordedNavigation) => {
        return navigation.params["acknowledgeRequestId"];
      }),
    ).toEqual(["n-81:ACKNOWLEDGE_TEST_PAGE", "n-82:ACKNOWLEDGE_TEST_PAGE"]);
    expect(container.navigations[1]?.params["messageId"]).toBe("message-2");
  });

  test("the action takes the answered notification away, which Android otherwise leaves in the shade", async () => {
    handlers.handleNotificationResponse(
      tap(TEST_PAGE_PUSH, ACKNOWLEDGE_TEST_PAGE, "n-83"),
    );
    await settle();

    expect(dismissMock()).toHaveBeenCalledTimes(1);
    expect(dismissMock()).toHaveBeenCalledWith("n-83");
  });

  test("a plain tap leaves the notification to the phone, as a page's does", async () => {
    handlers.handleNotificationResponse(tap(TEST_PAGE_PUSH));
    await settle();

    expect(dismissMock()).not.toHaveBeenCalled();
  });

  test("the push's own data can never make a tap acknowledge it - only the button tapped", () => {
    handlers.handleNotificationResponse(
      tap({
        ...TEST_PAGE_PUSH,
        testPageAction: "from-the-payload",
        pushAction: { kind: "acknowledge", id: "from-the-payload" },
      }),
    );

    expect(container.navigations).toEqual([
      {
        routeName: "OnCall",
        screen: "TestPage",
        params: { messageId: "message-1", projectId: "proj-1" },
      },
    ]);
  });

  test("its link is never opened in the browser: the app has its own screen for it", async () => {
    handlers.handleNotificationResponse(tap(TEST_PAGE_PUSH));
    await settle();

    expect(openURLMock()).not.toHaveBeenCalled();
  });
});

/*
 * A real page's actions and a test page's are never read as each other's:
 * a page's Acknowledge acts on a record, and a test has none - and no
 * test page's answer may ever acknowledge an incident.
 */
describe("a real page's actions and a test page's are never confused", () => {
  let handlers: HandlersModule;
  let container: FakeContainer;

  beforeEach(() => {
    handlers = loadHandlers();
    container = createContainer(MAIN_TAB_ROUTES);
    handlers.setNavigationRef(container.ref);
  });

  test.each([ACKNOWLEDGE_PAGE, ESCALATE_PAGE, MARK_PAGE_SEEN])(
    "%s on a test page's push opens the test page's screen and asks it to do nothing - nor takes the unanswered notification away",
    async (action: string) => {
      dismissMock().mockClear();

      handlers.handleNotificationResponse(tap(TEST_PAGE_PUSH, action, "n-90"));
      await settle();

      expect(container.navigations).toEqual([
        {
          routeName: "OnCall",
          screen: "TestPage",
          params: { messageId: "message-1", projectId: "proj-1" },
        },
      ]);
      expect(dismissMock()).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["incident", "IncidentDetail", { incidentId: "inc-1" }],
    ["alert", "AlertDetail", { alertId: "inc-1" }],
    ["incident-episode", "IncidentEpisodeDetail", { episodeId: "inc-1" }],
    ["alert-episode", "AlertEpisodeDetail", { episodeId: "inc-1" }],
  ] as Array<[string, string, Record<string, string>]>)(
    "Acknowledge test page on a %s's push opens it as a tap would - it never acknowledges a record",
    async (entityType: string, screen: string, ids: Record<string, string>) => {
      dismissMock().mockClear();

      handlers.handleNotificationResponse(
        tap(
          { entityType, entityId: "inc-1", projectId: "proj-1" },
          ACKNOWLEDGE_TEST_PAGE,
          "n-91",
        ),
      );
      await settle();

      // Not answered: the page stays in the shade, with its own buttons.
      expect(dismissMock()).not.toHaveBeenCalled();

      expect(container.navigations).toEqual([
        {
          routeName: "Inbox",
          screen,
          params: { ...ids, projectId: "proj-1" },
        },
      ]);
      expect(container.navigations[0]?.params).not.toHaveProperty("pushAction");
      expect(container.navigations[0]?.params).not.toHaveProperty(
        "acknowledgeRequestId",
      );
    },
  );

  test("a page's Acknowledge still acknowledges its own record, as before", () => {
    handlers.handleNotificationResponse(
      tap(
        { entityType: "incident", entityId: "inc-1", projectId: "proj-1" },
        ACKNOWLEDGE_PAGE,
        "n-92",
      ),
    );

    expect(container.navigations[0]?.params).toEqual({
      incidentId: "inc-1",
      projectId: "proj-1",
      pushAction: { kind: "acknowledge", id: "n-92:ACKNOWLEDGE_PAGE" },
    });
  });
});

describe("a test page tapped before the app can show it", () => {
  test("is held through the sign-in and the lock, with its action, and delivered once", () => {
    const handlers: HandlersModule = loadHandlers();
    const container: FakeContainer = createContainer(AUTH_STACK_ROUTES);
    handlers.setNavigationRef(container.ref);

    handlers.handleNotificationResponse(
      tap(TEST_PAGE_PUSH, ACKNOWLEDGE_TEST_PAGE, "n-95"),
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
        routeName: "OnCall",
        screen: "TestPage",
        params: {
          messageId: "message-1",
          projectId: "proj-1",
          acknowledgeRequestId: "n-95:ACKNOWLEDGE_TEST_PAGE",
        },
      },
    ]);
  });

  test("waits while the app switches to the push's project, then opens it there", () => {
    const handlers: HandlersModule = loadHandlers();
    const container: FakeContainer = createContainer(MAIN_TAB_ROUTES);
    handlers.setNavigationRef(container.ref);
    let switching: boolean = true;
    handlers.setProjectNavigationGuard(() => {
      return switching ? "switching" : "ready";
    });

    handlers.handleNotificationResponse(
      tap(
        { ...TEST_PAGE_PUSH, projectId: "proj-2" },
        ACKNOWLEDGE_TEST_PAGE,
        "n-96",
      ),
    );
    expect(container.navigations).toEqual([]);

    switching = false;
    handlers.processPendingNotification();

    expect(container.navigations[0]?.params).toEqual({
      messageId: "message-1",
      projectId: "proj-2",
      acknowledgeRequestId: "n-96:ACKNOWLEDGE_TEST_PAGE",
    });
    handlers.setProjectNavigationGuard(null);
  });
});
