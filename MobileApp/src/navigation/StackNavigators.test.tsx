import React from "react";
import { Platform } from "react-native";
import {
  NavigationContainer,
  createNavigationContainerRef,
  type NavigationContainerRefWithCurrent,
  type ParamListBase,
} from "@react-navigation/native";
import { act, render, screen } from "@testing-library/react-native";
import { describe, expect, test, jest } from "@jest/globals";
import AlertsStackNavigator from "./AlertsStackNavigator";
import AuthStackNavigator from "./AuthStackNavigator";
import IncidentsStackNavigator from "./IncidentsStackNavigator";
import MonitorsStackNavigator from "./MonitorsStackNavigator";
import OnCallStackNavigator from "./OnCallStackNavigator";
import SettingsStackNavigator from "./SettingsStackNavigator";
import type {
  AlertsStackParamList,
  AuthStackParamList,
  IncidentsStackParamList,
  MonitorsStackParamList,
  OnCallStackParamList,
  SettingsStackParamList,
} from "./types";

/*
 * The six stacks, tested for the two things a stack can quietly get wrong.
 *
 * The first is a missing registration. Every route in navigation/types.ts is a
 * promise to the rest of the app: push notification handlers, the deep link
 * config on the NavigationContainer and every navigate() call are all written
 * against those param lists. React Navigation does not fail loudly when the
 * promise is broken - navigate() to a route no navigator declares logs to the
 * console and leaves the user exactly where they were. A responder taps the
 * page that woke them and nothing happens. This app has already lost its
 * monitor pages that way once, so each stack here is driven to every route its
 * param list declares and asked where it ended up.
 *
 * The second is the platform split. Each of these files carries a
 * `Platform.OS === "ios"` branch that turns on the large scrolling title, and
 * a matching branch on every pushed screen that turns it back off.
 * babel-preset-expo inlines Platform.OS per Jest project, so the branch cannot
 * be mocked - the ios project is the only place the iOS half exists and the
 * android project is the only place its absence can be observed. Both halves
 * are asserted below, each from its own project.
 *
 * Every screen is stubbed. What is under test is the navigator's wiring, and
 * the real screens would drag their hooks, their queries and the network into
 * a file about routing. The header itself is native (react-native-screens
 * renders RNSScreenStackHeaderConfig, whose `title` prop is fed straight from
 * the resolved options), so the titles are read back through the navigation
 * container's own getCurrentOptions() rather than out of the tree.
 */

/**
 * Builds a stand-in screen module. Declared as a function so it is hoisted
 * above the jest.mock calls babel lifts to the top of the file, and named with
 * the `mock` prefix that babel-plugin-jest-hoist requires of anything a
 * factory reaches out to.
 */
function mockScreenStub(testID: string): {
  __esModule: true;
  default: () => React.JSX.Element;
} {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text: TextComponent } = jest.requireActual("react-native") as {
    Text: React.ComponentType<Record<string, unknown>>;
  };

  return {
    __esModule: true,
    default: function ScreenStub(): React.JSX.Element {
      return ReactModule.createElement(TextComponent, { testID }, testID);
    },
  };
}

jest.mock("../screens/auth/ServerUrlScreen", () => {
  return mockScreenStub("screen-server-url");
});

jest.mock("../screens/auth/LoginScreen", () => {
  return mockScreenStub("screen-login");
});

jest.mock("../screens/auth/SSOLoginScreen", () => {
  return mockScreenStub("screen-sso-login");
});

jest.mock("../screens/auth/ForgotPasswordScreen", () => {
  return mockScreenStub("screen-forgot-password");
});

jest.mock("../screens/auth/TwoFactorScreen", () => {
  return mockScreenStub("screen-two-factor");
});

jest.mock("../screens/auth/TwoFactorEnrolmentScreen", () => {
  return mockScreenStub("screen-two-factor-enrolment");
});

jest.mock("../screens/auth/BackupCodesScreen", () => {
  return mockScreenStub("screen-backup-codes");
});

jest.mock("../screens/AlertsScreen", () => {
  return mockScreenStub("screen-alerts-list");
});

jest.mock("../screens/AlertDetailScreen", () => {
  return mockScreenStub("screen-alert-detail");
});

jest.mock("../screens/AlertEpisodeDetailScreen", () => {
  return mockScreenStub("screen-alert-episode-detail");
});

jest.mock("../screens/IncidentsScreen", () => {
  return mockScreenStub("screen-incidents-list");
});

jest.mock("../screens/IncidentDetailScreen", () => {
  return mockScreenStub("screen-incident-detail");
});

jest.mock("../screens/IncidentEpisodeDetailScreen", () => {
  return mockScreenStub("screen-incident-episode-detail");
});

jest.mock("../screens/MonitorsScreen", () => {
  return mockScreenStub("screen-monitors-list");
});

jest.mock("../screens/MonitorDetailScreen", () => {
  return mockScreenStub("screen-monitor-detail");
});

jest.mock("../screens/OnCallOverviewScreen", () => {
  return mockScreenStub("screen-on-call-overview");
});

jest.mock("../screens/MyOnCallPoliciesScreen", () => {
  return mockScreenStub("screen-on-call-list");
});

jest.mock("../screens/WhoIsOnCallScreen", () => {
  return mockScreenStub("screen-who-is-on-call");
});

jest.mock("../screens/OnCallOverridesScreen", () => {
  return mockScreenStub("screen-on-call-overrides");
});

jest.mock("../screens/CreateOnCallOverrideScreen", () => {
  return mockScreenStub("screen-create-on-call-override");
});

jest.mock("../screens/MyOnCallPagesScreen", () => {
  return mockScreenStub("screen-my-on-call-pages");
});

jest.mock("../screens/OnCallCalendarFeedScreen", () => {
  return mockScreenStub("screen-on-call-calendar-feed");
});

jest.mock("../screens/SettingsScreen", () => {
  return mockScreenStub("screen-settings-list");
});

jest.mock("../screens/settings/ProjectsScreen", () => {
  return mockScreenStub("screen-projects-list");
});

jest.mock("../screens/settings/SSOProviderSelectScreen", () => {
  return mockScreenStub("screen-sso-provider-select");
});

/**
 * The options a navigator has actually resolved for the focused screen, which
 * is the merge of the navigator's screenOptions with the screen's own.
 */
interface ResolvedScreenOptions {
  title?: string;
  headerShown?: boolean;
  headerLargeTitle?: boolean;
  gestureEnabled?: boolean;
}

interface DeclaredRoute {
  /** The stub that has to be on screen once this route is the focused one. */
  testID: string;
  /**
   * What the route is opened with. The detail routes are meaningless without
   * their ids - they are what a push notification carries.
   */
  params?: Record<string, unknown>;
}

/**
 * A route on one of the five stacks that live inside the tab bar. Those all
 * show a header; the auth stack does not, which is why it keeps its own,
 * smaller shape.
 */
interface TitledRoute extends DeclaredRoute {
  /** The title the header shows for this screen. */
  title: string;
  /**
   * Whether this screen keeps iOS's large scrolling title. The list screens do;
   * anything pushed on top of them collapses back to the compact title so the
   * header does not re-expand halfway through a drill-down.
   */
  keepsIosLargeTitle: boolean;
}

interface StackUnderTest {
  /** How the describe block below names it. */
  name: string;
  /** The navigator itself. Elements are immutable, so one is enough. */
  element: React.JSX.Element;
  /**
   * Keyed by the param list so the compiler catches a route that is declared
   * in types.ts and forgotten here; the registration test catches one that is
   * declared in both and forgotten in the navigator.
   */
  routes: Record<string, TitledRoute>;
}

const ALERTS_ROUTES: Record<keyof AlertsStackParamList, TitledRoute> = {
  AlertsList: {
    testID: "screen-alerts-list",
    title: "Alerts",
    keepsIosLargeTitle: true,
  },
  AlertDetail: {
    testID: "screen-alert-detail",
    params: { alertId: "alert-1", projectId: "project-1" },
    title: "Alert",
    keepsIosLargeTitle: false,
  },
  AlertEpisodeDetail: {
    testID: "screen-alert-episode-detail",
    params: { episodeId: "alert-episode-1", projectId: "project-1" },
    title: "Episode",
    keepsIosLargeTitle: false,
  },
};

const INCIDENTS_ROUTES: Record<keyof IncidentsStackParamList, TitledRoute> = {
  IncidentsList: {
    testID: "screen-incidents-list",
    title: "Incidents",
    keepsIosLargeTitle: true,
  },
  IncidentDetail: {
    testID: "screen-incident-detail",
    params: { incidentId: "incident-1", projectId: "project-1" },
    title: "Incident",
    keepsIosLargeTitle: false,
  },
  IncidentEpisodeDetail: {
    testID: "screen-incident-episode-detail",
    params: { episodeId: "incident-episode-1", projectId: "project-1" },
    title: "Episode",
    keepsIosLargeTitle: false,
  },
};

const MONITORS_ROUTES: Record<keyof MonitorsStackParamList, TitledRoute> = {
  MonitorsList: {
    testID: "screen-monitors-list",
    title: "Monitors",
    keepsIosLargeTitle: true,
  },
  MonitorDetail: {
    testID: "screen-monitor-detail",
    params: { monitorId: "monitor-1", projectId: "project-1" },
    title: "Monitor",
    keepsIosLargeTitle: false,
  },
};

/*
 * Declared in registration order, because the first entry is what the shared
 * tests below treat as the stack's landing screen. The tab now opens on the
 * overview - "am I on call and until when" - and the policy list it used to
 * open on is one row down.
 */
const ON_CALL_ROUTES: Record<keyof OnCallStackParamList, TitledRoute> = {
  OnCallOverview: {
    testID: "screen-on-call-overview",
    title: "On-Call",
    keepsIosLargeTitle: true,
  },
  OnCallList: {
    testID: "screen-on-call-list",
    title: "My On-Call Policies",
    keepsIosLargeTitle: true,
  },
  WhoIsOnCall: {
    testID: "screen-who-is-on-call",
    title: "Who's On Call",
    keepsIosLargeTitle: true,
  },
  OnCallOverrides: {
    testID: "screen-on-call-overrides",
    title: "Overrides",
    keepsIosLargeTitle: true,
  },
  CreateOnCallOverride: {
    testID: "screen-create-on-call-override",
    title: "New Override",

    /*
     * The one route in this stack presented as a modal rather than pushed. A
     * sheet that re-expanded into a large title on scroll would read as a
     * pushed screen, so it keeps the compact header.
     */
    keepsIosLargeTitle: false,
  },
  MyOnCallPages: {
    testID: "screen-my-on-call-pages",
    title: "Pages Sent To Me",
    keepsIosLargeTitle: true,
  },

  /*
   * Reachable from the overview's "More" section and, on its own stack, from
   * Settings - the same screen registered twice so each tab pushes within
   * itself rather than jumping the user to the other tab.
   */
  OnCallCalendarFeed: {
    testID: "screen-on-call-calendar-feed",
    title: "Calendar Feed",
    keepsIosLargeTitle: true,
  },
};

const SETTINGS_ROUTES: Record<keyof SettingsStackParamList, TitledRoute> = {
  SettingsList: {
    testID: "screen-settings-list",
    title: "Settings",
    keepsIosLargeTitle: true,
  },
  ProjectsList: {
    testID: "screen-projects-list",
    title: "Projects",
    keepsIosLargeTitle: true,
  },
  SSOProviderSelect: {
    testID: "screen-sso-provider-select",
    params: {
      projectId: "project-1",
      projectName: "Acme Production",
      providers: [
        {
          _id: "provider-1",
          name: "Okta",
          kind: "project",
        },
      ],
    },
    title: "SSO Login",
    keepsIosLargeTitle: true,
  },

  /*
   * The same screen the On-Call stack registers. Settings offers it too so
   * that "Calendar feed" tapped from Settings pushes onto the Settings stack
   * instead of throwing the user into the On-Call tab.
   */
  OnCallCalendarFeed: {
    testID: "screen-on-call-calendar-feed",
    title: "Calendar Feed",
    keepsIosLargeTitle: true,
  },
};

const CONTENT_STACKS: Array<StackUnderTest> = [
  { name: "Alerts", element: <AlertsStackNavigator />, routes: ALERTS_ROUTES },
  {
    name: "Incidents",
    element: <IncidentsStackNavigator />,
    routes: INCIDENTS_ROUTES,
  },
  {
    name: "Monitors",
    element: <MonitorsStackNavigator />,
    routes: MONITORS_ROUTES,
  },
  {
    name: "On-Call",
    element: <OnCallStackNavigator />,
    routes: ON_CALL_ROUTES,
  },
  {
    name: "Settings",
    element: <SettingsStackNavigator />,
    routes: SETTINGS_ROUTES,
  },
];

async function renderStack(
  navigator: React.JSX.Element,
): Promise<NavigationContainerRefWithCurrent<ParamListBase>> {
  const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
    createNavigationContainerRef<ParamListBase>();

  /*
   * Awaited because React 19's `act` is asynchronous, which makes
   * @testing-library/react-native's render return a promise; not awaiting it
   * leaves the tree half-mounted and the ref unattached.
   */
  await render(
    <NavigationContainer ref={navigationRef}>{navigator}</NavigationContainer>,
  );

  return navigationRef;
}

/**
 * Ask the navigator for a route by name, the way a push notification handler
 * or a deep link does - with no compile-time guarantee that the route exists.
 * A name the navigator does not know leaves the user where they were, which is
 * precisely the failure these tests are looking for.
 */
async function goTo(
  navigationRef: NavigationContainerRefWithCurrent<ParamListBase>,
  routeName: string,
  params?: Record<string, unknown>,
): Promise<void> {
  /*
   * The ref is typed against ParamListBase, so navigate() collapses its
   * overloads to `never` and refuses a plain string. Naming the untyped shape
   * here is the point of the helper: this is the call a notification handler
   * makes, with a route name it worked out at runtime.
   */
  const navigateByName: (
    name: string,
    params?: Record<string, unknown>,
  ) => void = navigationRef.navigate as unknown as (
    name: string,
    params?: Record<string, unknown>,
  ) => void;

  await act(async (): Promise<void> => {
    navigateByName(routeName, params);
  });
}

function currentOptions(
  navigationRef: NavigationContainerRefWithCurrent<ParamListBase>,
): ResolvedScreenOptions {
  return (navigationRef.getCurrentOptions() ?? {}) as ResolvedScreenOptions;
}

for (const stack of CONTENT_STACKS) {
  const routeNames: Array<string> = Object.keys(stack.routes);
  const firstRouteName: string = routeNames[0];
  const routesWithParams: Array<[string, TitledRoute]> = Object.entries(
    stack.routes,
  ).filter(([, route]: [string, TitledRoute]): boolean => {
    return route.params !== undefined;
  });

  describe(`The ${stack.name} stack`, () => {
    test("opens on its landing screen", async () => {
      const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
        await renderStack(stack.element);

      expect(navigationRef.getCurrentRoute()?.name).toBe(firstRouteName);
      expect(
        screen.getByTestId(stack.routes[firstRouteName].testID),
      ).toBeTruthy();
    });

    test("every route its param list declares is somewhere to go", async () => {
      const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
        await renderStack(stack.element);

      for (const routeName of routeNames) {
        const route: TitledRoute = stack.routes[routeName];

        await goTo(navigationRef, routeName, route.params);

        expect(navigationRef.getCurrentRoute()?.name).toBe(routeName);
        expect(screen.getByTestId(route.testID)).toBeTruthy();
      }
    });

    test("a route it does not have leaves the responder where they were", async () => {
      /*
       * The other half of the registration test, and the reason the one above
       * is worth anything: an unknown route name is not an exception, it is
       * silence. If navigating to nonsense moved the stack, the assertions
       * above would pass for a navigator that accepts everything.
       */
      const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
        await renderStack(stack.element);

      await goTo(navigationRef, "ARouteThatWasNeverRegistered");

      expect(navigationRef.getCurrentRoute()?.name).toBe(firstRouteName);
    });

    test("every screen is titled", async () => {
      const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
        await renderStack(stack.element);

      for (const routeName of routeNames) {
        const route: TitledRoute = stack.routes[routeName];

        await goTo(navigationRef, routeName, route.params);

        expect(currentOptions(navigationRef).title).toBe(route.title);
      }
    });

    /*
     * Registered only where there is something to carry. Every route on the
     * On-Call stack is reached from a tap on the screen before it and takes
     * nothing, and a test that iterates an empty list and asserts nothing is
     * worse than no test at all - it reports green for work it never did.
     */
    if (routesWithParams.length > 0) {
      test("the params a route is opened with survive the trip", async () => {
        /*
         * A push notification carries the incident id and the project id and
         * nothing else; if the params were dropped on the way in, the screen
         * would mount with no idea what it is showing.
         */
        const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
          await renderStack(stack.element);

        for (const [routeName, route] of routesWithParams) {
          await goTo(navigationRef, routeName, route.params);

          expect(navigationRef.getCurrentRoute()?.params).toEqual(route.params);
        }
      });
    }

    /*
     * Same reasoning: only the stacks that can push a second screen have a
     * back gesture worth testing.
     */
    if (routeNames.length > 1) {
      test("a screen pushed on top can be backed out of", async () => {
        /*
         * The drill-down has to be reversible. A stack that pushes a detail
         * screen it cannot pop strands the responder on it, and the only way
         * out is force-quitting the app that is supposed to be paging them.
         */
        const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
          await renderStack(stack.element);
        const pushedName: string = routeNames[1];
        const pushed: TitledRoute = stack.routes[pushedName];

        await goTo(navigationRef, pushedName, pushed.params);

        expect(navigationRef.canGoBack()).toBe(true);

        await act(async (): Promise<void> => {
          navigationRef.goBack();
        });

        expect(navigationRef.getCurrentRoute()?.name).toBe(firstRouteName);
        expect(
          screen.getByTestId(stack.routes[firstRouteName].testID),
        ).toBeTruthy();
      });
    }

    test("the header is the one this platform asks for", async () => {
      /*
       * iOS gets the large scrolling title on the list screens and loses it on
       * anything pushed above them. Android has no such concept, and the
       * option must stay unset there rather than being handed a value the
       * platform will ignore today and interpret tomorrow.
       */
      const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
        await renderStack(stack.element);

      for (const routeName of routeNames) {
        const route: TitledRoute = stack.routes[routeName];

        await goTo(navigationRef, routeName, route.params);

        if (Platform.OS === "ios") {
          expect(currentOptions(navigationRef).headerLargeTitle).toBe(
            route.keepsIosLargeTitle,
          );
        } else {
          expect(
            currentOptions(navigationRef).headerLargeTitle,
          ).toBeUndefined();
        }
      }
    });
  });
}

const AUTH_ROUTES: Record<keyof AuthStackParamList, DeclaredRoute> = {
  ServerUrl: { testID: "screen-server-url" },
  Login: { testID: "screen-login" },
  SSOLogin: { testID: "screen-sso-login" },
  ForgotPassword: { testID: "screen-forgot-password" },
  TwoFactor: { testID: "screen-two-factor" },
  TwoFactorEnrolment: { testID: "screen-two-factor-enrolment" },
  BackupCodes: {
    testID: "screen-backup-codes",
    params: { mode: "show" },
  },
};

describe("The auth stack", () => {
  test("starts on the screen RootNavigator points it at", async () => {
    /*
     * RootNavigator picks between these two on every cold start: a handset
     * that has never been told which OneUptime to talk to has to configure the
     * server first, and one that has must not be asked again.
     */
    const configured: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack(<AuthStackNavigator initialRoute="Login" />);

    expect(configured.getCurrentRoute()?.name).toBe("Login");
    expect(screen.getByTestId("screen-login")).toBeTruthy();
    expect(screen.queryByTestId("screen-server-url")).toBeNull();
  });

  test("starts on the server prompt when there is no server yet", async () => {
    const unconfigured: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack(<AuthStackNavigator initialRoute="ServerUrl" />);

    expect(unconfigured.getCurrentRoute()?.name).toBe("ServerUrl");
    expect(screen.getByTestId("screen-server-url")).toBeTruthy();
  });

  test("every route AuthStackParamList declares is somewhere to go", async () => {
    /*
     * The sign-in flow branches more than any other part of the app - SSO, a
     * forgotten password, a two factor challenge, a forced enrolment - and a
     * branch whose screen was never registered strands a responder on the
     * login screen with no way forward and no error.
     */
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack(<AuthStackNavigator initialRoute="Login" />);

    for (const [routeName, route] of Object.entries(AUTH_ROUTES)) {
      await goTo(navigationRef, routeName, route.params);

      expect(navigationRef.getCurrentRoute()?.name).toBe(routeName);
      expect(screen.getByTestId(route.testID)).toBeTruthy();
    }
  });

  test("no screen in the flow draws a header", async () => {
    /*
     * Every auth screen paints its own full-bleed layout, so a system header
     * on top of one of them is a visible defect rather than a cosmetic one.
     */
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack(<AuthStackNavigator initialRoute="ServerUrl" />);

    for (const [routeName, route] of Object.entries(AUTH_ROUTES)) {
      await goTo(navigationRef, routeName, route.params);

      expect(currentOptions(navigationRef).headerShown).toBe(false);
      expect(navigationRef.getCurrentRoute()?.name).toBe(routeName);
    }
  });

  test("the backup codes cannot be swiped away", async () => {
    /*
     * The only screen in the app where the back gesture is off, and the reason
     * is destructive: the recovery codes on it exist in memory and nowhere
     * else - the server keeps digests - so a reflexive swipe back loses them
     * permanently. The way off the screen is the Continue button, which stays
     * disabled until the user confirms they have saved them.
     */
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack(<AuthStackNavigator initialRoute="Login" />);

    await goTo(navigationRef, "BackupCodes", { mode: "show" });

    expect(currentOptions(navigationRef).gestureEnabled).toBe(false);
  });

  test("the rest of the flow can still be backed out of", async () => {
    /*
     * The counterweight: disabling the gesture everywhere would trap someone
     * who opened the wrong sign-in method, so the exception has to stay an
     * exception.
     */
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack(<AuthStackNavigator initialRoute="Login" />);

    await goTo(navigationRef, "ForgotPassword");

    expect(currentOptions(navigationRef).gestureEnabled).not.toBe(false);
  });

  test("which mode the backup codes screen was opened in is preserved", async () => {
    /*
     * `mode` decides whether the screen shows codes that must be written down
     * or merely offers to create some. Losing it would show the offer to
     * someone who is holding the only copy of their codes.
     */
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack(<AuthStackNavigator initialRoute="Login" />);

    await goTo(navigationRef, "BackupCodes", { mode: "offer" });

    expect(navigationRef.getCurrentRoute()?.params).toEqual({ mode: "offer" });
  });
});
