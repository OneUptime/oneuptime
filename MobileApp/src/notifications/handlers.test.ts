import type { NotificationResponse } from "expo-notifications";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * This module is the whole reason the app exists: it is the path a page takes
 * from the lock screen to the incident that caused it. Everything it can get
 * wrong is silent. React Navigation does not throw when asked for a route the
 * mounted navigator does not have - it warns at most and does nothing - so a
 * page delivered to the wrong navigator looks, from inside the app, exactly
 * like a page that was never tapped. The responder just ends up on Home.
 *
 * Two failures these tests exist to prevent:
 *
 * 1. Spending a payload against a navigator that cannot show it.
 *    NavigationContainer's onReady fires as soon as the AUTH stack mounts, so
 *    "ready" says nothing about whether the Incidents tab exists yet. A page
 *    tapped while signed out has to survive the sign-in, the two-factor
 *    challenge and the biometric unlock, all of which happen inside a
 *    container that has been "ready" the entire time.
 *
 * 2. Dropping an entityType the server actually sends. Common/Server/Utils/
 *    PushNotificationUtil.ts sends incident, alert, incident-episode,
 *    alert-episode, monitor and scheduled-maintenance. Five of those six have
 *    a screen in this app; a switch that quietly misses one is a page that
 *    opens the app and shows nothing.
 *
 * The navigator is a stand-in rather than a real NavigationContainer because
 * what is being asserted is the DECISION - deliver now, hold, or ignore - and
 * the two inputs that decision reads (isReady() and getRootState().routeNames)
 * are both cheap to state exactly. Rendering a real container would test React
 * Navigation instead.
 */

type HandlersModule = typeof import("./handlers");

/*
 * The route names each navigator registers, re-declared here rather than
 * derived from src/navigation/types.ts.
 *
 * Partly because those are types and erased at runtime, but mainly because
 * these strings ARE the contract handlers.ts depends on. A test that followed
 * a rename of the Incidents tab automatically would stay green on the day
 * every incident page in flight started going nowhere.
 */
const AUTH_STACK_ROUTES: Array<string> = [
  "ServerUrl",
  "Login",
  "SSOLogin",
  "ForgotPassword",
  "TwoFactor",
  "TwoFactorEnrolment",
  "BackupCodes",
];

const MAIN_TAB_ROUTES: Array<string> = [
  "Home",
  "Monitors",
  "Incidents",
  "Alerts",
  "OnCall",
  "Settings",
];

interface RecordedNavigation {
  routeName: string;
  screen: string;
  params: Record<string, unknown>;
}

interface FakeNavigationContainer {
  ref: unknown;
  navigations: Array<RecordedNavigation>;
  mount: (routeNames: Array<string> | null) => void;
}

/**
 * A stand-in for the NavigationContainer ref.
 *
 * `mount(null)` is the real state the container is in while the biometric lock
 * screen is up: that screen is a plain component, not a navigator, so nothing
 * registers with the container and getRootState() returns undefined. Handing
 * the same object a different route list is what the app does when it swaps
 * AuthStackNavigator out for MainTabNavigator - the ref does not change, only
 * what it is pointing at does, which is precisely why "ready" cannot be used
 * as a proxy for "can show an incident".
 */
function createNavigationContainer(
  initialRouteNames: Array<string> | null,
): FakeNavigationContainer {
  let routeNames: Array<string> | null = initialRouteNames;
  const navigations: Array<RecordedNavigation> = [];

  return {
    ref: {
      isReady: (): boolean => {
        return routeNames !== null;
      },
      getRootState: (): { routeNames: Array<string> } | undefined => {
        if (routeNames === null) {
          return undefined;
        }
        return { routeNames: routeNames };
      },
      navigate: (
        routeName: string,
        options: { screen: string; params: Record<string, unknown> },
      ): void => {
        navigations.push({
          routeName: routeName,
          screen: options.screen,
          params: options.params,
        });
      },
    },
    navigations: navigations,
    mount: (nextRouteNames: Array<string> | null): void => {
      routeNames = nextRouteNames;
    },
  };
}

const DEFAULT_ACTION: string = "expo.modules.notifications.actions.DEFAULT";

/**
 * The shape expo-notifications hands the app when a page is tapped. Cast
 * rather than built out in full: NotificationResponse carries a trigger, a
 * date and a request identifier that this module never reads, and inventing
 * plausible values for them would only obscure the one field that matters.
 */
function tap(
  data: Record<string, unknown>,
  actionIdentifier: string = DEFAULT_ACTION,
): NotificationResponse {
  return {
    actionIdentifier: actionIdentifier,
    notification: { request: { content: { data: data } } },
  } as unknown as NotificationResponse;
}

/**
 * A fresh copy of the module per test.
 *
 * The navigation ref and the pending payload are module-level `let`s, so
 * without this one test's parked page would be delivered by the next test's
 * navigator and both would pass for the wrong reason. `requireActual` rather
 * than a bare `require()`, which the lint rules here forbid, and a static
 * `await import()` is not an option - it throws
 * ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG under both Jest projects.
 */
function loadHandlers(): HandlersModule {
  jest.resetModules();
  return jest.requireActual<HandlersModule>("./handlers");
}

describe("a page tapped before the app can show it", () => {
  let handlers: HandlersModule;

  beforeEach(() => {
    handlers = loadHandlers();
  });

  test("is not spent against the auth stack, which has no Incidents route", () => {
    const container: FakeNavigationContainer =
      createNavigationContainer(AUTH_STACK_ROUTES);
    handlers.setNavigationRef(container.ref);

    handlers.handleNotificationResponse(
      tap({ entityType: "incident", entityId: "inc-1", projectId: "proj-1" }),
    );

    expect(container.navigations).toEqual([]);
  });

  test("is delivered to the incident once the tabs mount", () => {
    const container: FakeNavigationContainer =
      createNavigationContainer(AUTH_STACK_ROUTES);
    handlers.setNavigationRef(container.ref);

    handlers.handleNotificationResponse(
      tap({ entityType: "incident", entityId: "inc-1", projectId: "proj-1" }),
    );

    container.mount(MAIN_TAB_ROUTES);
    handlers.processPendingNotification();

    expect(container.navigations).toEqual([
      {
        routeName: "Incidents",
        screen: "IncidentDetail",
        params: { incidentId: "inc-1", projectId: "proj-1" },
      },
    ]);
  });

  test("survives the onReady that fires for the auth stack", () => {
    /*
     * The exact sequence that used to lose the page. NavigationContainer calls
     * onReady - and so processPendingNotification - while the responder is
     * still looking at the login screen. That call must not clear the payload:
     * the tabs it needs are several screens away.
     */
    const container: FakeNavigationContainer =
      createNavigationContainer(AUTH_STACK_ROUTES);
    handlers.setNavigationRef(container.ref);

    handlers.handleNotificationResponse(
      tap({ entityType: "alert", entityId: "alert-1", projectId: "proj-1" }),
    );

    handlers.processPendingNotification();
    handlers.processPendingNotification();

    expect(container.navigations).toEqual([]);

    container.mount(MAIN_TAB_ROUTES);
    handlers.processPendingNotification();

    expect(container.navigations).toEqual([
      {
        routeName: "Alerts",
        screen: "AlertDetail",
        params: { alertId: "alert-1", projectId: "proj-1" },
      },
    ]);
  });

  test("survives the biometric lock screen, where no navigator is mounted at all", () => {
    const container: FakeNavigationContainer = createNavigationContainer(null);
    handlers.setNavigationRef(container.ref);

    handlers.handleNotificationResponse(
      tap({ entityType: "incident", entityId: "inc-9", projectId: "proj-1" }),
    );
    handlers.processPendingNotification();

    expect(container.navigations).toEqual([]);

    container.mount(MAIN_TAB_ROUTES);
    handlers.processPendingNotification();

    expect(container.navigations).toEqual([
      {
        routeName: "Incidents",
        screen: "IncidentDetail",
        params: { incidentId: "inc-9", projectId: "proj-1" },
      },
    ]);
  });

  test("survives arriving before the navigation ref has been set at all", () => {
    /*
     * The cold-start order: expo-notifications replays the tap that launched
     * the process before RootNavigator has handed usePushNotifications a ref.
     */
    handlers.handleNotificationResponse(
      tap({ entityType: "incident", entityId: "inc-3", projectId: "proj-2" }),
    );

    const container: FakeNavigationContainer =
      createNavigationContainer(MAIN_TAB_ROUTES);
    handlers.setNavigationRef(container.ref);
    handlers.processPendingNotification();

    expect(container.navigations).toEqual([
      {
        routeName: "Incidents",
        screen: "IncidentDetail",
        params: { incidentId: "inc-3", projectId: "proj-2" },
      },
    ]);
  });

  test("survives a ref that claims to be ready before any navigator has registered", () => {
    /*
     * getRootState() is a separate question from isReady(), and it answers
     * undefined until a navigator registers itself with the container. Reading
     * routeNames off that without a guard would throw inside the notification
     * listener, which on Android takes out the page entirely.
     */
    const readyButEmpty: unknown = {
      isReady: (): boolean => {
        return true;
      },
      getRootState: (): undefined => {
        return undefined;
      },
      navigate: (): void => {
        throw new Error("navigate must not be called with no root state");
      },
    };
    handlers.setNavigationRef(readyButEmpty);

    expect((): void => {
      handlers.handleNotificationResponse(
        tap({ entityType: "incident", entityId: "inc-4", projectId: "proj-1" }),
      );
      handlers.processPendingNotification();
    }).not.toThrow();

    const container: FakeNavigationContainer =
      createNavigationContainer(MAIN_TAB_ROUTES);
    handlers.setNavigationRef(container.ref);
    handlers.processPendingNotification();

    expect(container.navigations).toHaveLength(1);
  });

  test("is delivered exactly once, not again on the next auth transition", () => {
    /*
     * RootNavigator re-runs processPendingNotification on every change to
     * auth, loading and biometric state. A payload that was not cleared on
     * delivery would yank the responder back to the same incident every time
     * one of those settled.
     */
    const container: FakeNavigationContainer =
      createNavigationContainer(MAIN_TAB_ROUTES);
    handlers.setNavigationRef(container.ref);

    handlers.handleNotificationResponse(
      tap({ entityType: "incident", entityId: "inc-5", projectId: "proj-1" }),
    );
    handlers.processPendingNotification();
    handlers.processPendingNotification();

    expect(container.navigations).toHaveLength(1);
  });
});

describe("routing each entityType the server sends", () => {
  let handlers: HandlersModule;
  let container: FakeNavigationContainer;

  beforeEach(() => {
    handlers = loadHandlers();
    container = createNavigationContainer(MAIN_TAB_ROUTES);
    handlers.setNavigationRef(container.ref);
  });

  test("an incident page opens the incident", () => {
    handlers.handleNotificationResponse(
      tap({ entityType: "incident", entityId: "inc-1", projectId: "proj-1" }),
    );

    expect(container.navigations).toEqual([
      {
        routeName: "Incidents",
        screen: "IncidentDetail",
        params: { incidentId: "inc-1", projectId: "proj-1" },
      },
    ]);
  });

  test("an alert page opens the alert", () => {
    handlers.handleNotificationResponse(
      tap({ entityType: "alert", entityId: "alert-1", projectId: "proj-1" }),
    );

    expect(container.navigations).toEqual([
      {
        routeName: "Alerts",
        screen: "AlertDetail",
        params: { alertId: "alert-1", projectId: "proj-1" },
      },
    ]);
  });

  test("an incident-episode page opens the episode under the Incidents tab", () => {
    handlers.handleNotificationResponse(
      tap({
        entityType: "incident-episode",
        entityId: "ep-1",
        projectId: "proj-1",
      }),
    );

    expect(container.navigations).toEqual([
      {
        routeName: "Incidents",
        screen: "IncidentEpisodeDetail",
        params: { episodeId: "ep-1", projectId: "proj-1" },
      },
    ]);
  });

  test("an alert-episode page opens the episode under the Alerts tab", () => {
    handlers.handleNotificationResponse(
      tap({
        entityType: "alert-episode",
        entityId: "ep-2",
        projectId: "proj-1",
      }),
    );

    expect(container.navigations).toEqual([
      {
        routeName: "Alerts",
        screen: "AlertEpisodeDetail",
        params: { episodeId: "ep-2", projectId: "proj-1" },
      },
    ]);
  });

  test("a monitor page opens the monitor rather than going nowhere", () => {
    /*
     * PushNotificationUtil.createMonitorStatusChangedNotification sends
     * entityType "monitor" with the monitor id and project id, and the app has
     * had a Monitors tab with a MonitorDetail screen the whole time. Before
     * this case existed the page fell through to the default and opened the
     * app on whatever tab it was last on.
     */
    handlers.handleNotificationResponse(
      tap({ entityType: "monitor", entityId: "mon-1", projectId: "proj-1" }),
    );

    expect(container.navigations).toEqual([
      {
        routeName: "Monitors",
        screen: "MonitorDetail",
        params: { monitorId: "mon-1", projectId: "proj-1" },
      },
    ]);
  });

  test("a scheduled-maintenance page navigates nowhere, because there is no screen for it", () => {
    /*
     * The server sends this one, and the app has no scheduled-maintenance
     * screen to send it to. Pinned so that adding that screen is a deliberate
     * act with a failing test attached, rather than something a reader has to
     * infer from a switch that happens not to mention it.
     */
    handlers.handleNotificationResponse(
      tap({
        entityType: "scheduled-maintenance",
        entityId: "sm-1",
        projectId: "proj-1",
      }),
    );

    expect(container.navigations).toEqual([]);
  });

  test("an entityType this build has never heard of navigates nowhere", () => {
    handlers.handleNotificationResponse(
      tap({
        entityType: "status-page-subscriber",
        entityId: "x-1",
        projectId: "proj-1",
      }),
    );

    expect(container.navigations).toEqual([]);
  });

  test("a page with no projectId still opens, with an empty projectId", () => {
    handlers.handleNotificationResponse(
      tap({ entityType: "incident", entityId: "inc-7" }),
    );

    expect(container.navigations).toEqual([
      {
        routeName: "Incidents",
        screen: "IncidentDetail",
        params: { incidentId: "inc-7", projectId: "" },
      },
    ]);
  });

  test("a payload with no entityType navigates nowhere", () => {
    handlers.handleNotificationResponse(tap({ entityId: "inc-8" }));

    expect(container.navigations).toEqual([]);
  });

  test("a payload with no entityId navigates nowhere", () => {
    handlers.handleNotificationResponse(tap({ entityType: "incident" }));

    expect(container.navigations).toEqual([]);
  });

  test("acknowledging from the notification shade does not open anything", () => {
    /*
     * ACKNOWLEDGE is declared with opensAppToForeground: false. Navigating on
     * it would drag a responder who deliberately acknowledged without looking
     * into the app.
     */
    handlers.handleNotificationResponse(
      tap(
        { entityType: "incident", entityId: "inc-1", projectId: "proj-1" },
        "ACKNOWLEDGE",
      ),
    );

    expect(container.navigations).toEqual([]);
  });
});

describe("a payload that cannot be shown never displaces one that can", () => {
  let handlers: HandlersModule;
  let container: FakeNavigationContainer;

  /*
   * There is exactly one pending slot. Anything parked in it that the app can
   * never act on is not merely useless - it evicts the page the responder is
   * actually waiting on, which is a worse outcome than dropping it outright.
   */
  beforeEach(() => {
    handlers = loadHandlers();
    container = createNavigationContainer(AUTH_STACK_ROUTES);
    handlers.setNavigationRef(container.ref);

    handlers.handleNotificationResponse(
      tap({ entityType: "incident", entityId: "inc-1", projectId: "proj-1" }),
    );
  });

  test("a scheduled-maintenance page arriving behind it is dropped, not parked", () => {
    handlers.handleNotificationResponse(
      tap({
        entityType: "scheduled-maintenance",
        entityId: "sm-1",
        projectId: "proj-1",
      }),
    );

    container.mount(MAIN_TAB_ROUTES);
    handlers.processPendingNotification();

    expect(container.navigations).toEqual([
      {
        routeName: "Incidents",
        screen: "IncidentDetail",
        params: { incidentId: "inc-1", projectId: "proj-1" },
      },
    ]);
  });

  test("a payload missing its entityId arriving behind it is dropped, not parked", () => {
    handlers.handleNotificationResponse(tap({ entityType: "incident" }));

    container.mount(MAIN_TAB_ROUTES);
    handlers.processPendingNotification();

    expect(container.navigations).toEqual([
      {
        routeName: "Incidents",
        screen: "IncidentDetail",
        params: { incidentId: "inc-1", projectId: "proj-1" },
      },
    ]);
  });
});
